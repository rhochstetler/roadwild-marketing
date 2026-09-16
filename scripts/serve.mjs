#!/usr/bin/env node
/**
 * Local preview of site/ on :4173. No dependencies on purpose -- this repo
 * ships static HTML, and a static site that needs a toolchain to look at is
 * already on its way to not being one.
 *
 * This is NOT Netlify: the redirects in netlify.toml do not apply here, so
 * /functions/* and the app routes 404 locally. That is expected.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  // /about serves photographs. Without these the local preview hands back
  // application/octet-stream and every picture on the page is a broken icon,
  // which looks like a bad path rather than a missing mime type.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  // Extensionless URLs resolve to .html, the way Netlify serves them.
  if (!path.extname(rel)) rel += '.html';

  const file = path.join(SITE, rel);
  // Never serve outside site/.
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${rel}\n`);
  }
}).listen(PORT, () => {
  console.log(`site/ → http://localhost:${PORT}`);
});
