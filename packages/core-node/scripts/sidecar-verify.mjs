// sidecar 构建与发布前的共同校验：
//   1. 检查 Bun 最低版本（避免误用本机其他应用自带的旧版 Bun，例如缺 util.markAsUncloneable 的 1.2.x）
//   2. 真正启动打好的 tibi-core 跑一次 --stdio system.status 冒烟测试（验证依赖加载、SQLite 建库和 JSON-RPC）
//   3. macOS 发布前解包 .app.tar.gz 校验 codesign --verify --deep --strict 与 tibi-core 可运行性
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MIN_BUN_VERSION = '1.4.0';

export function parseSemver(raw) {
  const m = String(raw ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function assertMinBunVersion(versionText, minVersion = MIN_BUN_VERSION, bunPath = '') {
  const actual = parseSemver(versionText);
  const required = parseSemver(minVersion);
  if (!actual || !required) {
    throw new Error(`无法识别 Bun 版本（收到：${JSON.stringify(versionText)}，要求 >= ${minVersion}）`);
  }
  if (compareSemver(actual, required) < 0) {
    const where = bunPath ? `（当前路径：${bunPath}）` : '';
    throw new Error(
      `Bun 版本过低：当前 ${actual.join('.')} < 最低要求 ${minVersion}${where}。` +
      `旧版 Bun 缺少 undici 等依赖所需的 Node API，打出的 tibi-core 会在启动时崩溃；请安装 Bun >= ${minVersion} 并确保它在 PATH 前面。`,
    );
  }
  return actual.join('.');
}

export function checkHostBun(minVersion = MIN_BUN_VERSION) {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(`找不到可用的 bun 命令：${probe.error?.message ?? probe.stderr?.trim() ?? `exit ${probe.status}`}`);
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const loc = spawnSync(whichCmd, ['bun'], { encoding: 'utf8' });
  const bunPath = loc.status === 0 ? loc.stdout.trim().split(/\r?\n/)[0] : '';
  const version = assertMinBunVersion(probe.stdout, minVersion, bunPath);
  return { version, bunPath };
}

/** 用临时数据库启动一次 tibi-core，验证能正常响应 system.status */
export async function smokeTestSidecar(binaryPath, { timeoutMs = 15_000 } = {}) {
  if (!existsSync(binaryPath)) throw new Error(`找不到 sidecar 文件：${binaryPath}`);
  const dir = mkdtempSync(join(tmpdir(), 'tibi-sidecar-smoke-'));
  const dbPath = join(dir, 'smoke.db');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ['--stdio', '--no-mcp', '--db', dbPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
        if (err) reject(err);
        else resolve(value);
      };

      const timer = setTimeout(() => {
        finish(new Error(`sidecar 冒烟测试超时（${timeoutMs}ms）：${binaryPath}${stderr.trim() ? `\n${stderr.trim()}` : ''}`));
      }, timeoutMs);

      child.on('error', err => {
        finish(new Error(`无法启动 sidecar（${binaryPath}）：${err.message}`));
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        stdout += chunk;
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let frame;
          try { frame = JSON.parse(trimmed); } catch { continue; }
          if (frame.id !== 1) continue;
          if (frame.error) {
            finish(new Error(`sidecar system.status 返回错误：${frame.error.message ?? JSON.stringify(frame.error)}`));
            return;
          }
          if (!frame.result?.db_path) {
            finish(new Error(`sidecar system.status 缺少 db_path：${trimmed}`));
            return;
          }
          finish(null, frame.result);
          return;
        }
      });

      child.on('exit', (code, signal) => {
        if (settled) return;
        const why = signal ? `信号 ${signal}` : `退出码 ${code}`;
        const detail = stderr.trim() || stdout.trim();
        finish(new Error(`sidecar 冒烟测试启动即退出（${why}）：${binaryPath}${detail ? `\n${detail}` : ''}`));
      });

      child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"system.status","params":{}}\n');
      child.stdin.end();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 发布前校验 macOS 更新包（.app.tar.gz）：严格验签 +（本机同架构时）启动 tibi-core 冒烟测试 */
export async function verifyMacAppArchive(archivePath, { platformKey = '' } = {}) {
  if (process.platform !== 'darwin') return;
  if (!existsSync(archivePath)) throw new Error(`找不到 macOS 更新包：${archivePath}`);
  const dir = mkdtempSync(join(tmpdir(), 'tibi-verify-app-'));
  try {
    const extract = spawnSync('tar', ['-xzf', archivePath, '-C', dir], { encoding: 'utf8' });
    if (extract.status !== 0) {
      throw new Error(`解压 ${archivePath} 失败：${extract.stderr?.trim() || `exit ${extract.status}`}`);
    }
    const appName = readdirSync(dir).find(n => n.endsWith('.app'));
    if (!appName) throw new Error(`${archivePath} 中找不到 .app 目录`);
    const appPath = join(dir, appName);

    const sign = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
    if (sign.status !== 0) {
      throw new Error(`${archivePath} 代码签名校验失败：\n${sign.stderr?.trim() || `exit ${sign.status}`}`);
    }

    const corePath = join(appPath, 'Contents', 'MacOS', 'tibi-core');
    if (!existsSync(corePath)) throw new Error(`${archivePath} 中缺少 Contents/MacOS/tibi-core`);

    const hostKey = process.arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64';
    const archMatches = !platformKey || platformKey === hostKey;
    if (archMatches) {
      await smokeTestSidecar(corePath);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
