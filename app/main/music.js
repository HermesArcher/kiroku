'use strict';
// Music for the rail player: every audio file in the folder the user picked (settings.musicDir, top level only).
// "Artist - Title.mp3" splits into artist/title; an optional "01 - " / "01. " order prefix is dropped from the title.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm)$/i;

function trackOf(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}\s*[-.)]\s+/, '').trim();
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { artist: '', title: base };
}

function listMusic(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => AUDIO.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((n) => ({ src: pathToFileURL(path.join(dir, n)).href, ...trackOf(n) }));
}

module.exports = { listMusic, trackOf };
