import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { publicFiles, root, mime } from './public-files.mjs';
const port = Number(process.env.PORT || 4187);
const files = new Set(await publicFiles());
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.has(file) || !['GET','HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
  try {
    const path = new URL(file,root);
    const [body, metadata] = await Promise.all([readFile(path), stat(path)]);
    res.writeHead(200, {'Content-Type':mime(file),'Cache-Control':'no-store','Last-Modified':metadata.mtime.toUTCString()}).end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
});
server.listen(port, '127.0.0.1', () => console.log('Мой киносписок: http://127.0.0.1:' + port + '/'));
