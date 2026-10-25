'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const L = require('./lib');

// ONLYOFFICE's license asks downstream builds to keep its logo; Kiroku shows it in each editor's About pane.
test('About pane shows the ONLYOFFICE logo, header does not', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    const frame = await L.until(() => ed.frames().find((f) => /documenteditor\/main\//.test(f.url())), { what: 'editor frame' });
    await expect(frame.locator('#header-logo')).toBeHidden();
    await frame.evaluate(() => document.querySelector('#left-btn-about').click());
    const logo = frame.locator('#about-menu-panel .asc-about-office');
    await expect(logo).toBeVisible({ timeout: 30000 });
    expect((await logo.boundingBox()).height).toBeGreaterThan(30);
    const shot = path.join(app.testDir, 'about.png');
    await frame.locator('#about-menu-panel').screenshot({ path: shot });
    console.log(`[about] screenshot ${shot}`);
  } finally {
    await app.kill();
  }
});
