'use strict';
// Pure helpers for tab colours (persisted per file path) and tear-out windows. No electron here: unit-tested in test/tab-logic.test.js.

const TAB_COLORS = [
  { name: 'Aqua', hex: '#22AFC4' }, { name: 'Lime', hex: '#9BCB2A' }, { name: 'Lilac', hex: '#8B79E0' },
  { name: 'Coral', hex: '#F0653F' }, { name: 'Sky', hex: '#1FA6D8' }, { name: 'Sand', hex: '#D9B26A' },
];
const HEXES = new Set(TAB_COLORS.map((c) => c.hex.toLowerCase()));
const MAX_STYLES = 300;

// untrusted patch -> { color: '#RRGGBB' | null, bold: boolean } (only palette colours are accepted)
function normalizeStyle(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hex = typeof r.color === 'string' ? r.color.toLowerCase() : '';
  const color = HEXES.has(hex) ? TAB_COLORS.find((c) => c.hex.toLowerCase() === hex).hex : null;
  return { color, bold: r.bold === true };
}

const styleKey = (p) => String(p).toLowerCase();

// Per-file tab styles kept inside settings.json (settings.tabStyles) through the store's getSettings/setSettings.
function createTabStyles(store) {
  const all = () => { const t = store.getSettings().tabStyles; return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; };
  return {
    get(p) {
      if (!p) return { color: null, bold: false };
      return normalizeStyle(all()[styleKey(p)]);
    },
    // empty style (no colour, not bold) removes the entry; the map is capped, oldest entries drop first
    set(p, style) {
      if (!p) return;
      const next = { ...all() };
      const k = styleKey(p);
      const s = normalizeStyle(style);
      delete next[k];
      if (s.color || s.bold) next[k] = s;
      const keys = Object.keys(next);
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_STYLES))) delete next[old];
      store.setSettings({ tabStyles: next });
    },
  };
}

// Which window's tab strip is under a screen point? rects: [{ id, x, y, width, height }]. `barH` = strip height.
function stripAt(rects, p, barH, exceptId) {
  const hit = rects.find((r) => r.id !== exceptId && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + barH);
  return hit ? hit.id : null;
}

// Bounds for a torn-out window: top-left of the new window just left/above the cursor, kept inside the display's work area.
function placeWindow(point, src, wa, min = { width: 960, height: 600 }) {
  const width = Math.min(Math.max(Math.round(src.width * 0.8), min.width), wa.width);
  const height = Math.min(Math.max(Math.round(src.height * 0.8), min.height), wa.height);
  const wantX = point ? point.x - 120 : src.x + 40;
  const wantY = point ? point.y - 20 : src.y + 40;
  const x = Math.min(Math.max(wantX, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(wantY, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

module.exports = { TAB_COLORS, normalizeStyle, createTabStyles, stripAt, placeWindow };
