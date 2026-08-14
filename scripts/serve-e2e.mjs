import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const candidates = extname(relative) ? [relative] : [`${relative}.html`, relative];
    let body;
    let file;
    for (const candidate of candidates) {
      const resolved = resolve(root, candidate);
      if (!resolved.startsWith(`${root}/`)) continue;
      try {
        body = await readFile(resolved);
        file = resolved;
        break;
      } catch {}
    }
    if (!body || !file) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(port, '127.0.0.1');
