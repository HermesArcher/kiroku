'use strict';
// Copy ../engine/dist -> engine-dist and decompress x2t.wasm.br in place (same filename, raw wasm).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const src = path.resolve(__dirname, '..', '..', 'engine', 'dist');
const dst = path.resolve(__dirname, '..', 'engine-dist');
const x2t = path.join(dst, 'sdkjs', 'common', 'wasm', 'x2t', 'x2t.wasm.br');

if (!fs.existsSync(src)) { console.error(`engine build not found: ${src}`); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });

const raw = fs.readFileSync(x2t);
if (!raw.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) {
  const wasm = zlib.brotliDecompressSync(raw);
  fs.writeFileSync(x2t, wasm);
  console.log(`x2t.wasm.br: ${(raw.length / 1048576).toFixed(1)} MB -> ${(wasm.length / 1048576).toFixed(1)} MB (raw wasm)`);
}
console.log(`engine-dist ready: ${dst}`);
