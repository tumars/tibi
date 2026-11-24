import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 纯 ESM 打包校验脚本，不带独立 .d.ts
import { assertMinBunVersion, smokeTestSidecar } from '../scripts/sidecar-verify.mjs';

describe('sidecar-verify', () => {
  it('校验 Bun 最低版本：拒绝 1.2.17，放行 >= 1.4.0 及未来大版本', () => {
    expect(() => assertMinBunVersion('1.2.17', '1.4.0', '/Users/test/.cherrystudio/bin/bun')).toThrow(/1\.2\.17.*1\.4\.0/);
    expect(() => assertMinBunVersion('1.3.99')).toThrow(/Bun 版本过低/);
    expect(() => assertMinBunVersion('')).toThrow(/无法识别 Bun 版本/);
    expect(assertMinBunVersion('1.4.0')).toBe('1.4.0');
    expect(assertMinBunVersion('1.4.5\n')).toBe('1.4.5');
    expect(assertMinBunVersion('1.5.0-canary.1')).toBe('1.5.0');
    expect(assertMinBunVersion('2.0.0')).toBe('2.0.0');
  });

  it.skipIf(process.platform === 'win32')('冒烟测试：正常 sidecar 通过，启动崩溃的 sidecar 带出 stderr 失败', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-verify-test-'));
    try {
      const okBin = join(dir, 'ok-core');
      writeFileSync(
        okBin,
        `#!/bin/sh\nread line\necho '{"jsonrpc":"2.0","id":1,"result":{"version":"0.1.3","db_path":"/tmp/smoke.db"}}'\n`,
      );
      chmodSync(okBin, 0o755);
      const res = await smokeTestSidecar(okBin);
      expect(res.db_path).toBe('/tmp/smoke.db');

      const badBin = join(dir, 'bad-core');
      writeFileSync(
        badBin,
        `#!/bin/sh\necho "TypeError: Q.util.markAsUncloneable is not a function" >&2\nexit 1\n`,
      );
      chmodSync(badBin, 0o755);
      await expect(smokeTestSidecar(badBin)).rejects.toThrow(/markAsUncloneable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
