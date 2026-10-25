'use strict';
// Extension -> kind table (shared by main + pdf-tools) and the pure save-decision rules.
const fs = require('fs');
const path = require('path');

const KINDS = {
  word: { label: 'Document', newExt: 'docx', opens: ['docx', 'doc', 'odt', 'rtf', 'txt'], icon: 'word.png' },
  cell: { label: 'Spreadsheet', newExt: 'xlsx', opens: ['xlsx', 'xls', 'ods', 'csv'], icon: 'cell.png' },
  slide: { label: 'Presentation', newExt: 'pptx', opens: ['pptx', 'ppt', 'odp'], icon: 'slide.png' },
  pdf: { label: 'PDF', newExt: null, opens: ['pdf'], icon: 'pdf.png' },
};
const LEGACY = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };
const ALL_EXTS = Object.values(KINDS).flatMap((k) => k.opens);

/** Lowercase extension without the dot ('' if none). Accepts a path or a bare name. */
const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
const kindOfExt = (ext) => Object.keys(KINDS).find((k) => KINDS[k].opens.includes(String(ext).toLowerCase())) || null;
const kindOfPath = (p) => kindOfExt(extOf(p));

/**
 * What to do with an editor save.
 *  - tab has a path and the saved ext equals the tab's ext -> write in place
 *  - otherwise show a Save dialog; rebind the tab to the result only when the saved ext is the
 *    same kind AND (the tab has no path yet OR the tab is legacy doc/xls/ppt saved as its OOXML sibling).
 */
function decideSave({ tabPath, tabExt, tabKind, ext }) {
  if (tabPath && ext === tabExt) return { action: 'write' };
  const rebind = kindOfExt(ext) === tabKind && (!tabPath || LEGACY[tabExt] === ext);
  return { action: 'dialog', rebind };
}

// ---- open by content: magic bytes first, extension only as the fallback ----
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const u16 = (s) => Buffer.from(s, 'utf16le');
const ODF = { text: 'odt', spreadsheet: 'ods', presentation: 'odp' };

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

/** Entry names of a ZIP from its central directory ([] if unreadable), plus the ODF mimetype if the first entry is one. */
function zipInfo(fd, size) {
  const names = [];
  const tail = readAt(fd, Math.max(0, size - 65557), Math.min(size, 65557));
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd >= 0 && tail.length >= eocd + 22) {
    const cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff < size && cdSize <= 16 << 20) {
      const cd = readAt(fd, cdOff, cdSize);
      for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
        const n = cd.readUInt16LE(p + 28), m = cd.readUInt16LE(p + 30), c = cd.readUInt16LE(p + 32);
        names.push(cd.toString('utf8', p + 46, p + 46 + n));
        p += 46 + n + m + c;
      }
    }
  }
  let mimetype = '';
  const lh = readAt(fd, 0, 30);
  if (lh.length === 30 && lh.readUInt16LE(8) === 0) { // ODF: first entry "mimetype", stored uncompressed
    const n = lh.readUInt16LE(26), m = lh.readUInt16LE(28);
    if (readAt(fd, 30, n).toString() === 'mimetype') mimetype = readAt(fd, 30 + n + m, Math.min(lh.readUInt32LE(22), 100)).toString();
  }
  return { names, mimetype };
}

/**
 * Detect the real format from the file's first bytes: -> { kind, ext } or null when inconclusive
 * (caller falls back to the extension). `ext` is what the engine needs as the file's format.
 * Limit: OLE streams are found by a name scan of the first 64KB; a huge .doc whose directory sits past that falls back to the extension.
 */
function sniffKind(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 65536);
    if (head.length === 0) return null;
    if (head.subarray(0, 4).toString('latin1') === '%PDF') return { kind: 'pdf', ext: 'pdf' };
    if (head.subarray(0, 5).toString('latin1') === '{\\rtf') return { kind: 'word', ext: 'rtf' };
    if (head.subarray(0, 8).equals(OLE)) {
      if (head.includes(u16('WordDocument'))) return { kind: 'word', ext: 'doc' };
      if (head.includes(u16('Workbook')) || head.includes(u16('Book'))) return { kind: 'cell', ext: 'xls' };
      if (head.includes(u16('PowerPoint Document'))) return { kind: 'slide', ext: 'ppt' };
      return null;
    }
    if (head.readUInt32LE(0) === 0x04034b50) {
      const { names, mimetype } = zipInfo(fd, size);
      const m = /^application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)$/.exec(mimetype);
      if (m) return { kind: kindOfExt(ODF[m[1]]), ext: ODF[m[1]] };
      if (names.some((n) => n.startsWith('word/'))) return { kind: 'word', ext: 'docx' };
      if (names.some((n) => n.startsWith('xl/'))) return { kind: 'cell', ext: 'xlsx' };
      if (names.some((n) => n.startsWith('ppt/'))) return { kind: 'slide', ext: 'pptx' };
      return null;
    }
    // no NUL bytes in the first 8KB -> plain text
    if (!head.subarray(0, 8192).includes(0)) return { kind: 'word', ext: 'txt' };
    return null;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

/** The kind + ext to open `file` with: content first (csv stays csv: it is plain text too), extension as fallback. */
function resolveKind(file) {
  const ext = extOf(file);
  const s = sniffKind(file);
  if (s && s.ext === 'txt' && (ext === 'csv' || ext === 'txt')) return { kind: kindOfExt(ext), ext };
  if (s) return s;
  const kind = kindOfExt(ext);
  return kind ? { kind, ext } : null;
}

module.exports = { KINDS, LEGACY, ALL_EXTS, extOf, kindOfExt, kindOfPath, decideSave, sniffKind, resolveKind };
