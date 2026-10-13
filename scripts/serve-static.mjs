// 仅用于静态产物测试：按 Pages 项目子路径挂载，绝无识别或导出 API。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const prefix = '/ancient-text-transcriber/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.txt': 'text/plain' };
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200).end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.env.STATIC_TEST_PORT || 4173), '127.0.0.1', () => console.log('Static Pages path test server ready.'));
