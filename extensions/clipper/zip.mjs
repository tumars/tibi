// 打包剪藏插件：node extensions/clipper/zip.mjs → extensions/clipper/dist/tibi-clipper-<版本>.zip
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
mkdirSync(join(dir, 'dist'), { recursive: true });
const out = join('dist', `tibi-clipper-${version}.zip`);
execFileSync('zip', ['-r', '-X', out, 'manifest.json', 'background.js', 'icons'], { cwd: dir, stdio: 'inherit' });
console.log(out);
