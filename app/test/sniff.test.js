'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sniffKind, resolveKind } = require('../main/kinds');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-sniff-'));
const put = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };

/** Tiny stored-only ZIP: entries = [[name, content?]]. CRCs are zero (the sniffer never inflates). */
function zip(entries) {
  const locals = [], cds = [];
  let off = 0;
  for (const [name, data = ''] of entries) {
    const n = Buffer.from(name), d = Buffer.from(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(d.length, 20); cd.writeUInt32LE(d.length, 24);
    cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, n, d); cds.push(cd, n);
    off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(cds);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const ole = (stream) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), Buffer.from('Root Entry', 'utf16le'), Buffer.alloc(40), Buffer.from(stream, 'utf16le'), Buffer.alloc(64)]);

test('sniffKind: pdf, rtf, text, junk', () => {
  assert.deepEqual(sniffKind(put('a', '%PDF-1.7\n...')), { kind: 'pdf', ext: 'pdf' });
  assert.deepEqual(sniffKind(put('b', String.raw`{\rtf1\ansi hi}`)), { kind: 'word', ext: 'rtf' });
  assert.deepEqual(sniffKind(put('c', 'just some notes\r\nline two')), { kind: 'word', ext: 'txt' });
  assert.equal(sniffKind(put('d', Buffer.from([1, 2, 0, 3, 4, 5]))), null);
  assert.equal(sniffKind(put('e', '')), null);
  assert.equal(sniffKind(path.join(dir, 'missing')), null);
});

test('sniffKind: OLE legacy formats by stream name', () => {
  assert.deepEqual(sniffKind(put('w', ole('WordDocument'))), { kind: 'word', ext: 'doc' });
  assert.deepEqual(sniffKind(put('x1', ole('Workbook'))), { kind: 'cell', ext: 'xls' });
  assert.deepEqual(sniffKind(put('x2', ole('Book'))), { kind: 'cell', ext: 'xls' });
  assert.deepEqual(sniffKind(put('p', ole('PowerPoint Document'))), { kind: 'slide', ext: 'ppt' });
  assert.equal(sniffKind(put('o', ole('Other'))), null);
});

test('sniffKind: ZIP by entry names and ODF mimetype', () => {
  assert.deepEqual(sniffKind(put('d1', zip([['[Content_Types].xml'], ['word/document.xml']]))), { kind: 'word', ext: 'docx' });
  assert.deepEqual(sniffKind(put('d2', zip([['[Content_Types].xml'], ['xl/workbook.xml']]))), { kind: 'cell', ext: 'xlsx' });
  assert.deepEqual(sniffKind(put('d3', zip([['[Content_Types].xml'], ['ppt/presentation.xml']]))), { kind: 'slide', ext: 'pptx' });
  for (const [m, ext, kind] of [['text', 'odt', 'word'], ['spreadsheet', 'ods', 'cell'], ['presentation', 'odp', 'slide']]) {
    assert.deepEqual(sniffKind(put('o' + ext, zip([['mimetype', `application/vnd.oasis.opendocument.${m}`], ['content.xml']]))), { kind, ext });
  }
  assert.equal(sniffKind(put('z', zip([['readme.txt', 'x']]))), null);
});

test('resolveKind: content beats a misleading extension; extension is the fallback', () => {
  const docx = zip([['[Content_Types].xml'], ['word/document.xml']]);
  assert.deepEqual(resolveKind(put('report.bin', docx)), { kind: 'word', ext: 'docx' });
  assert.deepEqual(resolveKind(put('report', docx)), { kind: 'word', ext: 'docx' });
  assert.deepEqual(resolveKind(put('sheet.docx', zip([['xl/workbook.xml']]))), { kind: 'cell', ext: 'xlsx' });
  assert.deepEqual(resolveKind(put('real.pdf.txt', '%PDF-1.4')), { kind: 'pdf', ext: 'pdf' });
  assert.deepEqual(resolveKind(put('data.csv', 'a,b\n1,2\n')), { kind: 'cell', ext: 'csv' }); // text keeps csv/txt
  assert.deepEqual(resolveKind(put('notes.txt', 'hello')), { kind: 'word', ext: 'txt' });
  assert.deepEqual(resolveKind(put('notes.md', 'hello')), { kind: 'word', ext: 'txt' });
  assert.deepEqual(resolveKind(put('empty.xlsx', '')), { kind: 'cell', ext: 'xlsx' }); // inconclusive -> extension
  assert.deepEqual(resolveKind(put('odd.docx', Buffer.from([0, 1, 2, 3]))), { kind: 'word', ext: 'docx' });
  assert.equal(resolveKind(put('tool.exe', Buffer.from([0x4d, 0x5a, 0, 0]))), null);
});
