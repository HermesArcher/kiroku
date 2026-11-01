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

test('P2: themed player, shuffle and volume popover work and survive restart', async () => {
  const testDir = L.tmpdir('player-controls');
  for (let i = 1; i <= 4; i++) wav(path.join(testDir, `${i} - Artist - Track ${i}.wav`));
  const userData = L.tmpdir('player-settings');
  let app = await L.launch({ testDir, userData });
  try {
    let shell = app.shellPage();
    // Observe the real media element without adding a test hook to the shipped renderer.
    await shell.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.Audio = function (...args) { return (window.__testAudio = new NativeAudio(...args)); };
      window.Audio.prototype = NativeAudio.prototype;
    });
    await shell.reload();
    await shell.emulateMedia({ colorScheme: null });
    await shell.click('#pl-play');
    await expect(shell.locator('#pl-state')).toHaveText('Now playing');
    await shell.click('#pl-play');
    await expect(shell.locator('#pl-state')).toHaveText('Paused');
    await shell.evaluate(() => { Math.random = () => 0; });
    await shell.click('#pl-shuffle');
    await expect(shell.locator('#pl-shuffle')).toHaveAttribute('aria-pressed', 'true');
    const order = [];
    for (let i = 0; i < 4; i++) {
      order.push(await shell.locator('#pl-no').textContent());
      await shell.click('#pl-next');
    }
    expect(new Set(order).size).toBe(4); // no repeat before all four tracks have played
    expect(order).not.toEqual(['01/04', '02/04', '03/04', '04/04']);
    await expect(shell.locator('#pl-no')).toHaveText(order[0]);
    await shell.click('#pl-prev');
    await expect(shell.locator('#pl-no')).toHaveText(order[3]);
    await shell.click('#pl-next');
    await shell.click('#pl-play');
    await L.until(async () => (await shell.locator('#pl-no').textContent()) === order[1], { what: 'automatic advance follows shuffle' });
    await shell.click('#pl-play');
    await shell.click('#pl-shuffle');
    await shell.click('#pl-next');
    await expect(shell.locator('#pl-no')).toHaveText('04/04'); // normal numeric order restored

    const slider = shell.locator('#pl-volume');
    await expect(shell.locator('#pl-volume-popup')).toBeHidden();
    await shell.click('#pl-volume-button');
    await expect(shell.locator('#pl-volume-button')).toHaveAttribute('aria-expanded', 'true');
    await slider.press('Home');
    expect(await shell.evaluate(() => window.__testAudio.volume)).toBe(0);
    await slider.press('ArrowDown');
    await expect(slider).toHaveValue('0');
    await slider.press('End');
    await slider.press('ArrowUp');
    expect(await shell.evaluate(() => window.__testAudio.volume)).toBe(1);
    const box = await slider.boundingBox();
    await shell.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await shell.mouse.up();
    await expect(slider).toHaveValue('50');
    expect(await shell.evaluate(() => window.__testAudio.volume)).toBe(0.5);
    await slider.hover();
    await shell.mouse.wheel(0, 100);
    await expect(slider).toHaveValue('45');
    expect(await shell.evaluate(() => window.__testAudio.volume)).toBe(0.45);
    await slider.press('Escape');
    await expect(shell.locator('#pl-volume-popup')).toBeHidden();
    await shell.click('#pl-volume-button');
    await shell.click('#pl-shuffle'); // outside click closes the popover
    await expect(shell.locator('#pl-volume-popup')).toBeHidden();

    const colors = [];
    for (const theme of ['light', 'dark']) {
      await shell.evaluate((theme) => window.shell.setSettings({ theme }), theme);
      await L.until(() => shell.evaluate((theme) => matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'), theme));
      colors.push(await shell.locator('#player').evaluate((el) => getComputedStyle(el).backgroundImage));
      const bounds = await shell.locator('#player').boundingBox();
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(await shell.evaluate(() => innerHeight));
      await shell.screenshot({ path: path.join(app.testDir, `player-${theme}.png`) });
      await shell.click('#pl-volume-button');
      await shell.screenshot({ path: path.join(app.testDir, `player-${theme}-volume.png`) });
      await slider.press('Escape');
    }
    expect(colors[0]).not.toBe(colors[1]);
    await L.until(() => shell.evaluate(() => JSON.parse(localStorage.getItem('kiroku.player')).vol === 0.45));
    // A normal close flushes Chromium's localStorage; force-killing the process does not.
    await app.mainEval("setTimeout(() => process.mainModule.require('electron').app.quit(), 50); 'quitting'");
    await L.until(() => app.exited, { what: 'normal app shutdown' });
    await app.kill();
    app = await L.launch({ testDir, userData });
    shell = app.shellPage();
    await expect(shell.locator('#pl-volume')).toHaveValue('45');
    await expect(shell.locator('#pl-shuffle')).toHaveAttribute('aria-pressed', 'true');
    await expect(shell.locator('#pl-no')).toHaveText('04/04');
    await app.mainEval("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].setSize(960, 600)");
    await shell.click('#pl-volume-button');
    const compact = await shell.locator('#player').boundingBox();
    expect(compact.y).toBeGreaterThanOrEqual(0);
    expect(compact.y + compact.height).toBeLessThanOrEqual(await shell.evaluate(() => innerHeight));
    await expect(shell.locator('#pl-volume')).toBeVisible();
    await shell.screenshot({ path: path.join(testDir, 'player-compact.png') });
    console.log(`Player screenshots: ${testDir}`);
  } finally { await app.kill(); }
});
