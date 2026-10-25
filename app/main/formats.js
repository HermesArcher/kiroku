'use strict';
// Save As: every format x2t can write per editor kind, and the "this may lose formatting" rule.
// Legacy binary doc/xls/ppt are NOT here on purpose: x2t reads them but cannot write them.
// ("pdfa" is not listed: this build's PDF export always writes PDF/A, so it is the same file as PDF.)
// Probed on the real engine (2026-10-21): x2t aborts on html / epub / fb2 and refuses png / jpg (code 88), so those are not offered
// even though they are in LOSSY (the rule stays correct if a later x2t build can write them).
const FORMATS = {
  word: [
    ['docx', 'Word Document'], ['docm', 'Word Macro-Enabled Document'], ['dotx', 'Word Template'],
    ['odt', 'OpenDocument Text'], ['ott', 'OpenDocument Text Template'], ['rtf', 'Rich Text Format'],
    ['txt', 'Plain Text'], ['pdf', 'PDF'],
  ],
  cell: [
    ['xlsx', 'Excel Workbook'], ['xlsm', 'Excel Macro-Enabled Workbook'], ['xltx', 'Excel Template'],
    ['ods', 'OpenDocument Spreadsheet'], ['ots', 'OpenDocument Spreadsheet Template'], ['csv', 'CSV (comma separated)'], ['pdf', 'PDF'],
  ],
  slide: [
    ['pptx', 'PowerPoint Presentation'], ['pptm', 'PowerPoint Macro-Enabled Presentation'], ['potx', 'PowerPoint Template'],
    ['odp', 'OpenDocument Presentation'], ['otp', 'OpenDocument Presentation Template'], ['pdf', 'PDF'],
  ],
  pdf: [['pdf', 'PDF']],
};

// Formats that drop formatting, structure or most of the document.
const LOSSY = new Set(['txt', 'csv', 'rtf', 'html', 'epub', 'fb2', 'png', 'jpg']);
const ODF = new Set(['odt', 'ott', 'ods', 'ots', 'odp', 'otp']); // lossy for documents that use features ODF lacks

const formatsFor = (kind) => FORMATS[kind] || [];
const isSupported = (kind, ext) => formatsFor(kind).some(([e]) => e === ext);
const labelOf = (kind, ext) => (formatsFor(kind).find(([e]) => e === ext) || [ext, `${String(ext).toUpperCase()} file`])[1];

/** Saving a document whose own format is `fromExt` as `toExt` may lose formatting. Same format never does. */
function isLossy(fromExt, toExt) {
  if (!toExt || fromExt === toExt) return false;
  if (LOSSY.has(toExt)) return true;
  return ODF.has(toExt) && !ODF.has(fromExt); // ODF -> other ODF sibling keeps its structure
}

/** Save dialog filters: the format the editor produced first (it is the default pick), then the rest of the kind's list. */
function dialogFilters(kind, ext) {
  const list = formatsFor(kind).slice();
  if (!isSupported(kind, ext)) list.unshift([ext, `${String(ext).toUpperCase()} file`]);
  list.sort((a, b) => (b[0] === ext) - (a[0] === ext));
  return list.map(([e, name]) => ({ name: `${name} (*.${e})`, extensions: [e] }));
}

function warningText(fromExt, toExt) {
  return `Saving as ${String(toExt).toUpperCase()} may lose formatting. Keep working in ${String(fromExt).toUpperCase()} and save a copy?`;
}

module.exports = { FORMATS, LOSSY, ODF, formatsFor, isSupported, labelOf, isLossy, dialogFilters, warningText };
