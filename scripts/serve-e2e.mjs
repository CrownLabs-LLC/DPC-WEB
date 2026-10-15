import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import preferenceConfig from '../api/email-preferences-config.js';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/email-preferences-config') {
      res.status = code => { res.statusCode = code; return res; };
      res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      preferenceConfig(req, res);
      return;
    }
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
    // Match the deployed route's security headers in the real browser suite.
    if (pathname === '/email-preferences' || pathname === '/email-preferences.html' || pathname === '/welcome' || pathname === '/welcome.html' || pathname === '/app' || pathname === '/app.html') {
      const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
      for (const { key, value } of config.headers.find(rule => rule.source === pathname).headers) res.setHeader(key, value);
    }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(port, '127.0.0.1');
