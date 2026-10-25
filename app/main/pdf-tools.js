'use strict';
// PDF tools: pure byte-level functions (testable) + ipc wiring (registerPdfTools).
const fs = require('fs');
const path = require('path');
const { PDFDocument, degrees } = require('pdf-lib');

// ---------- ranges ----------

function parseTokens(str, pageCount) {
  const text = String(str == null ? '' : str).trim();
  if (!text) throw new Error('Enter the pages you want, for example 1-3, 5, 8-');
  const out = [];
  for (const raw of text.split(',')) {
    const tok = raw.replace(/\s+/g, '');
    if (!tok) throw new Error('There is an empty entry in the page list. Remove the extra comma.');
    const m = /^(\d+)(?:(-)(\d*))?$/.exec(tok);
    if (!m) throw new Error(`"${raw.trim()}" is not a valid page or range. Use numbers like 1-3, 5, 8-`);
    const start = parseInt(m[1], 10);
    const end = !m[2] ? start : m[3] === '' ? pageCount : parseInt(m[3], 10);
    if (start < 1) throw new Error('Page numbers start at 1.');
    if (start > pageCount) throw new Error(`Page ${start} does not exist. This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    if (end > pageCount) throw new Error(`Page ${end} does not exist. This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    if (end < start) throw new Error(`The range ${start}-${end} goes backwards. Write it as ${end}-${start}.`);
    const g = [];
    for (let p = start; p <= end; p++) g.push(p - 1);
    out.push(g);
  }
  return out;
}

/** "1-3, 5, 8-" -> sorted unique 0-based indices. Throws Error with a human message. */
function parseRanges(str, pageCount) {
  const set = new Set(parseTokens(str, pageCount).flat());
  return [...set].sort((a, b) => a - b);
}

/** "1-3,4,7-9" -> [[0,1,2],[3],[6,7,8]] (one group per comma entry, order kept). */
function parseRangeGroups(str, pageCount) {
  return parseTokens(str, pageCount);
}

// ---------- byte operations ----------

async function load(bytes) {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/encrypt/i.test(msg)) throw new Error('This PDF is password-protected and could not be unlocked.');
    throw new Error('This file could not be read as a PDF. It may be damaged. (' + msg.slice(0, 120) + ')');
  }
}

async function pagesToPdf(src, indices) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

async function merge(bytesList) {
  if (!bytesList || bytesList.length < 2) throw new Error('Choose at least two PDFs to merge.');
  const out = await PDFDocument.create();
  for (const b of bytesList) {
    const src = await load(b);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return out.save();
}

async function splitEach(bytes) {
  const src = await load(bytes);
  const res = [];
  for (const i of src.getPageIndices()) res.push(await pagesToPdf(src, [i]));
  return res;
}

async function splitGroups(bytes, groups) {
  const src = await load(bytes);
  const res = [];
  for (const g of groups) res.push(await pagesToPdf(src, g));
  return res;
}

async function extract(bytes, indices) {
  const src = await load(bytes);
  if (!indices || !indices.length) throw new Error('No pages selected.');
  return pagesToPdf(src, indices);
}

async function remove(bytes, indices) {
  const src = await load(bytes);
  const drop = new Set(indices || []);
  const keep = src.getPageIndices().filter((i) => !drop.has(i));
  if (!keep.length) throw new Error('That would delete every page. Keep at least one page.');
  return pagesToPdf(src, keep);
}

async function rotate(bytes, deg, indices) {
  if (![90, 180, 270].includes(deg)) throw new Error('Rotation must be 90, 180 or 270 degrees.');
  const doc = await load(bytes);
  const targets = indices && indices.length ? indices : doc.getPageIndices();
  for (const i of targets) {
    const page = doc.getPage(i);
    page.setRotation(degrees((((page.getRotation().angle + deg) % 360) + 360) % 360));
  }
  return doc.save();
}

async function imagesToPdf(list) {
  if (!list || !list.length) throw new Error('Choose at least one image.');
  const doc = await PDFDocument.create();
  for (const { bytes, ext } of list) {
    const e = String(ext || '').toLowerCase().replace('.', '');
    let img;
    try {
      if (e === 'png') img = await doc.embedPng(bytes);
      // pdf-lib reads imageData.buffer from offset 0: copy so a small file's pooled Node Buffer is not misparsed.
      else if (e === 'jpg' || e === 'jpeg') img = await doc.embedJpg(new Uint8Array(bytes));
      else throw new Error('Only PNG and JPG images are supported (got ".' + e + '").');
    } catch (err) {
      if (/Only PNG/.test(err.message)) throw err;
      throw new Error('An image could not be read. It may be damaged or not really a ' + e.toUpperCase() + ' file.');
    }
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return doc.save();
}

// ---------- ipc ----------

const baseName = (p) => path.basename(p, path.extname(p));
const safeName = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

/** Write via temp file + rename so an existing file (even one of the inputs) is only replaced after success. */
function writeAtomic(target, bytes) {
  const tmp = target + '.kiroku-' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let n = 2; ; n++) {
    const c = path.join(dir, `${name} (${n})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

function humanError(e) {
  const code = e && e.code;
  if (code === 'ENOENT') return 'A file could not be found. It may have been moved or deleted.';
  if (code === 'EACCES' || code === 'EPERM') return 'Could not write the file. It may be open in another program or the folder is read-only.';
  if (code === 'EBUSY') return 'The file is in use by another program. Close it and try again.';
  return String((e && e.message) || e);
}

// isShell(event) -> boolean: when given, only calls from a Kiroku shell renderer are served.
function registerPdfTools(ipcMain, electron, isShell) {
  const { dialog, BrowserWindow } = electron;
  const parent = () => (BrowserWindow && BrowserWindow.getFocusedWindow && BrowserWindow.getFocusedWindow()) || undefined;
  const readPdf = (p) => fs.readFileSync(p);

  const handle = (op, fn) =>
    ipcMain.handle('pdf:' + op, async (e, args) => {
      if (isShell && !isShell(e)) return { ok: false, error: 'forbidden' };
      try {
        return await fn(args || {});
      } catch (e) {
        return { ok: false, error: humanError(e) };
      }
    });

  const need = (p, label) => {
    if (typeof p !== 'string' || !p) throw new Error('Choose ' + label + ' first.');
    return p;
  };

  async function pageCountOf(p) {
    return (await load(readPdf(need(p, 'a PDF')))).getPageCount();
  }

  async function saveOne(defaultName, defaultDir, bytes) {
    const r = await dialog.showSaveDialog(parent(), {
      title: 'Save PDF',
      defaultPath: path.join(defaultDir, safeName(defaultName)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const out = /\.pdf$/i.test(r.filePath) ? r.filePath : r.filePath + '.pdf';
    writeAtomic(out, bytes);
    return { ok: true, output: out };
  }

  handle('pick', async ({ type, multi }) => {
    const image = type === 'image';
    const r = await dialog.showOpenDialog(parent(), {
      title: image ? 'Choose images' : 'Choose PDF files',
      properties: ['openFile', ...(multi ? ['multiSelections'] : [])],
      filters: image
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
        : [{ name: 'PDF', extensions: ['pdf'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle('info', async ({ path: p }) => ({ pages: await pageCountOf(p) }));

  handle('merge', async ({ paths }) => {
    if (!Array.isArray(paths) || paths.length < 2) throw new Error('Choose at least two PDFs to merge.');
    const bytes = await merge(paths.map(readPdf));
    return saveOne(baseName(paths[0]) + ' (merged).pdf', path.dirname(paths[0]), bytes);
  });

  handle('split', async ({ path: p, mode, ranges }) => {
    need(p, 'a PDF');
    const data = readPdf(p);
    let parts;
    let label;
    if (mode === 'ranges') {
      const n = (await load(data)).getPageCount();
      const groups = parseRangeGroups(ranges, n);
      parts = await splitGroups(data, groups);
      label = groups.map((g) => (g.length > 1 ? `pages ${g[0] + 1}-${g[g.length - 1] + 1}` : `page ${g[0] + 1}`));
    } else {
      parts = await splitEach(data);
      label = parts.map((_, i) => `page ${i + 1}`);
    }
    const r = await dialog.showOpenDialog(parent(), {
      title: 'Choose a folder for the split files',
      defaultPath: path.dirname(p),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const dir = r.filePaths[0];
    const outputs = parts.map((bytes, i) => {
      const name = mode === 'ranges' ? `${baseName(p)} - part ${i + 1} (${label[i]}).pdf` : `${baseName(p)} - page ${i + 1}.pdf`;
      const out = uniquePath(path.join(dir, safeName(name)));
      writeAtomic(out, bytes);
      return out;
    });
    return { ok: true, output: outputs };
  });

  handle('extract', async ({ path: p, ranges }) => {
    need(p, 'a PDF');
    const data = readPdf(p);
    const idx = parseRanges(ranges, (await load(data)).getPageCount());
    const bytes = await extract(data, idx);
    return saveOne(`${baseName(p)} (pages ${String(ranges).replace(/\s+/g, '')}).pdf`, path.dirname(p), bytes);
  });

  handle('delete', async ({ path: p, ranges }) => {
    need(p, 'a PDF');
    const data = readPdf(p);
    const idx = parseRanges(ranges, (await load(data)).getPageCount());
    const bytes = await remove(data, idx);
    return saveOne(`${baseName(p)} (removed ${String(ranges).replace(/\s+/g, '')}).pdf`, path.dirname(p), bytes);
  });

  handle('rotate', async ({ path: p, degrees: deg, ranges }) => {
    need(p, 'a PDF');
    const data = readPdf(p);
    const idx = ranges && String(ranges).trim() ? parseRanges(ranges, (await load(data)).getPageCount()) : null;
    const bytes = await rotate(data, Number(deg), idx);
    return saveOne(`${baseName(p)} (rotated).pdf`, path.dirname(p), bytes);
  });

  handle('images', async ({ paths }) => {
    if (!Array.isArray(paths) || !paths.length) throw new Error('Choose at least one image.');
    const bytes = await imagesToPdf(paths.map((q) => ({ bytes: fs.readFileSync(q), ext: path.extname(q) })));
    return saveOne(paths.length === 1 ? baseName(paths[0]) + '.pdf' : 'Images.pdf', path.dirname(paths[0]), bytes);
  });
}

module.exports = {
  registerPdfTools,
  parseRanges,
  parseRangeGroups,
  merge,
  splitEach,
  splitGroups,
  extract,
  remove,
  rotate,
  imagesToPdf,
};
