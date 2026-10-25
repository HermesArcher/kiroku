'use strict';
// Backups settings (Settings > Backups): closed choice lists, so a hand-edited settings.json can't
// set a 0 s interval or a 0-day keep. Mirrors engine/lib/history/backup-settings.ts (same lists, same snapping).
const INTERVALS_SEC = [30, 60, 120, 180];
const KEEP_VERSIONS = [3, 5, 10];
const KEEP_DAYS = [1, 7, 30];
const DEFAULTS = Object.freeze({ autosave: true, intervalSec: 60, keepVersions: 3, keepDays: 7 });

function snap(v, allowed, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return allowed.reduce((best, a) => (Math.abs(a - n) < Math.abs(best - n) ? a : best), allowed[0]);
}

/** Any input -> a valid settings object; fields missing from `raw` come from `base`. */
function normalizeBackup(raw, base = DEFAULTS) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    autosave: typeof r.autosave === 'boolean' ? r.autosave : base.autosave,
    intervalSec: snap(r.intervalSec, INTERVALS_SEC, base.intervalSec),
    keepVersions: snap(r.keepVersions, KEEP_VERSIONS, base.keepVersions),
    keepDays: snap(r.keepDays, KEEP_DAYS, base.keepDays),
  };
}

module.exports = { normalizeBackup, DEFAULTS, INTERVALS_SEC, KEEP_VERSIONS, KEEP_DAYS };
