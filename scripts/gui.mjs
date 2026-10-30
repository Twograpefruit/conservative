import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeFile = path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'),
  'opencode-gui',
  'runtime.json',
);

function open(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

let url = '';
try {
  const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
  url = runtime?.bff?.url ?? '';
} catch {
  /* not running yet */
}

if (!url) {
  const port = process.env.OCG_PORT || '4311';
  url = `http://127.0.0.1:${port}`;
}

const health = await fetch(`${url}/api/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.error(`[gui] 后端未运行（${url}）。请先执行: npm run build && npm start`);
  process.exit(1);
}
console.log(`[gui] opening ${url}`);
open(url);
console.log('[gui] 若浏览器没有自动打开，手动访问上面的地址。');
void here;
