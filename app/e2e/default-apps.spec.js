'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const L = require('./lib');

// Home shows "Set as default" exactly when Explorer opens a main type elsewhere (reads the real UserChoice).
test('Home default-apps strip matches the Windows defaults', async () => {
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    const others = await sp.evaluate(() => window.shell.defaultStatus());
    expect(Array.isArray(others)).toBe(true);
    const strip = sp.locator('#default-slot .default-strip');
    if (!others.length) return expect(strip).toHaveCount(0);
    await expect(strip.getByRole('button', { name: 'Set as default' })).toBeVisible();
    for (const ext of others) await expect(strip).toContainText('.' + ext);
    const shot = path.join(app.testDir, 'default-strip.png');
    await strip.screenshot({ path: shot });
    console.log(`[default-apps] ${others.join(' ')} -> ${shot}`);
  } finally {
    await app.kill();
  }
});
