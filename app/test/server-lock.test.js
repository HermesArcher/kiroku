'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer, KEY_HEADER } = require('../main/server');

const req = (port, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('server: loopback only, exact Host, per-run key required', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-lock-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'INDEX');
  const srv = createServer({ root, port: 0 });
  const port = await srv.start();
  t.after(() => srv.close());

  assert.equal(srv.server.address().address, '127.0.0.1');
  assert.match(srv.key, /^[0-9a-f]{64}$/); // 32 random bytes
  assert.notEqual(createServer({ root, port: 0 }).key, srv.key);

  const ok = { [KEY_HEADER]: srv.key };
  assert.equal(await req(port, ok), 200);
  assert.equal(await req(port, { ...ok, Host: `localhost:${port}` }), 200);
  assert.equal(await req(port, {}), 403); // curl-style: no key
  assert.equal(await req(port, { [KEY_HEADER]: 'x'.repeat(64) }), 403);
  assert.equal(await req(port, { [KEY_HEADER]: srv.key.slice(0, 10) }), 403);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `127.0.0.1.evil.example:${port}`, `[::1]:${port}`]) {
    assert.equal(await req(port, { ...ok, Host: host }), 403, host);
  }
});
