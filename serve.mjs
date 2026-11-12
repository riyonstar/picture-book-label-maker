// 依存なしの静的サーバー。
//   npm run dev      … プロジェクト直下を配信（http://localhost:5173/）
//   npm run preview  … dist を /ehon-label-maker/ 配下で配信（GitHub Pages のサブパスを再現）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const dir = path.resolve(root, arg('dir', '.'));
const port = Number(arg('port', '5173'));
const host = arg('host', '127.0.0.1');
let base = arg('base', '/');
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (base !== '/' && pathname === base.slice(0, -1)) {
    res.writeHead(301, { Location: base });
    return res.end();
  }
  if (!pathname.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found（このサーバーは ' + base + ' 配下のみ配信します）');
  }
  pathname = pathname.slice(base.length);

  let file = path.join(dir, pathname);
  if (!file.startsWith(dir)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(port, host, () => {
  console.log(`配信中: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${base}`);
  console.log(`ディレクトリ: ${path.relative(process.cwd(), dir) || '.'}`);
});
