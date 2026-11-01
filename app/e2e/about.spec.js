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

test('Settings > About shows the ONLYOFFICE logo in light and dark', async () => {
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    await sp.click('#nav .nav-item[data-nav="settings"]');
    const logo = sp.locator('dl.about .oo-logo img');
    for (const theme of ['light', 'dark']) {
      // A CDP attach pins prefers-color-scheme, so emulate it rather than flipping nativeTheme.
      await sp.emulateMedia({ colorScheme: theme });
      await expect(logo).toBeVisible();
      await L.until(() => logo.evaluate((img) => img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(matchMedia('(prefers-color-scheme: dark)').matches ? 'logo-white.svg' : 'logo.svg')), { what: `${theme} logo loaded` });
      expect((await logo.boundingBox()).height).toBeGreaterThanOrEqual(24);
      const shot = path.join(app.testDir, `settings-about-${theme}.png`);
      await sp.locator('dl.about').screenshot({ path: shot });
      console.log(`[about] screenshot ${shot}`);
    }
  } finally {
    await app.kill();
  }
});
