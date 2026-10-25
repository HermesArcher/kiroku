'use strict';
// 127.0.0.1-only static server for the editor engine.
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', wasm: 'application/wasm',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
};
const X2T = '/sdkjs/common/wasm/x2t/x2t.wasm.br';
const WASM_MAGIC = Buffer.from([0, 0x61, 0x73, 0x6d]);
const PREFERRED_PORT = 47615;
const KEY_HEADER = 'x-kiroku-key';

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * Loopback only, plus two guards against other local programs / web pages: the Host header must be exactly
 * 127.0.0.1:<port> or localhost:<port> (DNS rebinding), and every request must carry this run's secret in
 * X-Kiroku-Key (main injects it into the app's own sessions). Anything else gets 403.
 */
function createServer({ root, port = PREFERRED_PORT, key = crypto.randomBytes(32).toString('hex') }) {
  root = path.resolve(root);
  const keyBuf = Buffer.from(key);
  const keyOk = (v) => { const b = Buffer.from(String(v || '')); return b.length === keyBuf.length && crypto.timingSafeEqual(b, keyBuf); };
  const hostOk = (h) => { const a = server.address(); return !!a && (h === `127.0.0.1:${a.port}` || h === `localhost:${a.port}`); };
  const wasmCache = new Map(); // file -> raw wasm bytes (packaged copy is already raw; dev copy is brotli)

  function resolveFile(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch { return null; }
    if (decoded.includes('\0')) return null;
    const full = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    if (decoded.endsWith('/')) return path.join(full, 'index.html');
    if (isFile(full)) return full;
    if (!path.extname(full) && isFile(full + '.html')) return full + '.html';
    return full;
  }

  function wasmBytes(file) {
    let b = wasmCache.get(file);
    if (!b) {
      const raw = fs.readFileSync(file);
      b = raw.subarray(0, 4).equals(WASM_MAGIC) ? raw : zlib.brotliDecompressSync(raw);
      wasmCache.set(file, b);
    }
    return b;
  }

  const server = http.createServer((req, res) => {
    if (!hostOk(req.headers.host) || !keyOk(req.headers[KEY_HEADER])) { res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const urlPath = (req.url || '/').split(/[?#]/)[0];
    const file = resolveFile(urlPath);
    if (!file || !isFile(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const ext = path.extname(file).slice(1).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === 'html' ? 'no-cache' : 'max-age=604800',
    };
    try {
      if (urlPath === X2T) {
        const b = wasmBytes(file);
        res.writeHead(200, { ...headers, 'Content-Length': b.length });
        res.end(req.method === 'HEAD' ? undefined : b);
        return;
      }
      headers['Content-Length'] = fs.statSync(file).size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  const listen = (p) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });

  return {
    server,
    key,
    async start() {
      try { await listen(port); } catch (e) {
        if (port === 0 || (e.code !== 'EADDRINUSE' && e.code !== 'EACCES')) throw e;
        await listen(0);
      }
      return server.address().port;
    },
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}

module.exports = { createServer, PREFERRED_PORT, KEY_HEADER };
