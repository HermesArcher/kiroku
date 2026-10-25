'use strict';
// Rail music player: no folder yet -> play opens the folder picker -> songs play with a live spectrum; the folder is remembered.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

// 2 s of 16-bit mono 440 Hz sine as a WAV (no encoder needed)
function wav(file) {
  const rate = 22050, n = rate * 2, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), 44 + i * 2);
  fs.writeFileSync(file, b);
}

test('P1: pick a music folder, play with a live spectrum, folder remembered', async () => {
  const testDir = L.tmpdir('music'); // test mode answers every folder dialog with testDir
  wav(path.join(testDir, '02 - Second - Song.wav'));
  wav(path.join(testDir, '01 - Test Artist - Tone #1.wav'));
  const app = await L.launch({ testDir });
  try {
    const shell = await L.until(() => app.shellPage(), { what: 'shell page' });
    const read = () => shell.evaluate(() => ({
      state: document.querySelector('#pl-state').textContent, title: document.querySelector('#pl-title').textContent, no: document.querySelector('#pl-no').textContent,
      live: [...document.querySelectorAll('#eq i')].filter((b) => parseFloat(b.style.transform.slice(7)) > 0.1).length,
    }));
    await L.until(async () => (await read()).state === 'No folder', { what: 'empty player' });
    await shell.click('#pl-play');
    const on = await L.until(async () => { const r = await read(); return r.state === 'Now playing' && r.live > 0 && r; }, { what: 'playing with spectrum' });
    expect(on.title).toBe('Test Artist — Tone #1');
    expect(on.no).toBe('01/02');
    await shell.click('#pl-next');
    await L.until(async () => (await read()).title === 'Second — Song', { what: 'next track' });
    expect(JSON.parse(fs.readFileSync(path.join(app.userData, 'settings.json'), 'utf8')).musicDir).toBe(testDir);
  } finally { await app.kill(); }
});
