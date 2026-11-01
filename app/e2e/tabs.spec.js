'use strict';
// Tabs: switch animations (editor page + tab capsule + back to home), tab colour/bold persistence, tear-out windows.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const TEMPLATE_DOCX = path.join(L.APP_DIR, 'templates', 'new.docx');
const fixtureDocx = () => { const f = path.join(L.tmpdir('fx'), 'tabs-fixture.docx'); fs.copyFileSync(TEMPLATE_DOCX, f); return f; };
const shellPages = (app) => app.pages().filter((p) => /renderer\/index\.html/.test(p.url()));
const windowCount = (app) => app.mainEval("process.mainModule.require('electron').BrowserWindow.getAllWindows().length");
const hookState = (p) => p.evaluate(() => { if (!window.__e2eHook) { window.__e2eHook = true; window.shell.onState((s) => { window.__e2eState = s; }); } });
const stateOf = (p) => p.evaluate(() => window.__e2eState);
const untilState = (p, pred, what) => L.until(async () => { const s = await stateOf(p); return s && pred(s) ? s : null; }, { what });

/** Poll the page for `ms`, recording animations on <html> and its computed opacity. */
const sampleRoot = (page, ms = 500) => page.evaluate(async (ms) => {
  const out = []; const t0 = performance.now(); const r = document.documentElement;
  while (performance.now() - t0 < ms) {
    out.push({ anims: document.getAnimations().filter((a) => a.effect && a.effect.target === r).length, op: getComputedStyle(r).opacity });
    await new Promise((res) => setTimeout(res, 30));
  }
  return out;
}, ms);

test('T1: switching tabs is instant: editor shown as painted, sliding capsule, no home replay', async () => {
  const app = await L.launch({ args: ['--new=docx', '--new=xlsx'] });
  try {
    const e1 = await app.nextEditor();
    const e2 = await app.nextEditor([e1]);
    await L.waitEditor(e1); await L.waitEditor(e2);
    const sp = app.shellPage();
    const st = await app.waitState((s) => s.tabs.length === 2, 'two tabs');
    const [t1, t2] = st.tabs.map((t) => t.id);
    const act = (id) => sp.evaluate((i) => window.shell.activate(i), id);

    // --- the capsule glides: intermediate transforms between two tabs, final position == active tab
    const pill = () => sp.evaluate(() => {
      const p = document.querySelector('#tabs .tab-pill'), a = document.querySelector('#tabs .tab.active');
      return { tf: getComputedStyle(p).transform, w: p.offsetWidth, tw: a.offsetWidth, left: a.offsetLeft, on: p.classList.contains('on'), parent: p.parentElement.id };
    });
    await act(t2); await app.waitState((s) => s.activeId === t2, 'active t2');
    await L.sleep(500);
    let fin = await pill();
    expect(fin.parent).toBe('tabs');
    expect(fin.on).toBe(true);
    expect(fin.w).toBe(fin.tw);
    expect(fin.tf).toBe(`matrix(1, 0, 0, 1, ${fin.left}, 0)`);
    const seen = new Set();
    const poll = sp.evaluate(async () => { // collect transforms while it glides
      const p = document.querySelector('#tabs .tab-pill'); const o = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 600) { o.push(getComputedStyle(p).transform); await new Promise((r) => setTimeout(r, 20)); }
      return o;
    });
    await act(t1);
    (await poll).forEach((x) => seen.add(x));
    expect(seen.size).toBeGreaterThan(3); // start, end and in-between frames
    fin = await pill();
    expect(fin.tf).toBe(`matrix(1, 0, 0, 1, ${fin.left}, 0)`);

    // --- editor pages: shown as painted, never faded or slid (no animation on <html>, opacity stays 1 through every switch)
    for (const id of ['home', t1, t2, t1]) {
      const runs = [e1, e2].map((p) => sampleRoot(p));
      await act(id);
      for (const fr of await Promise.all(runs)) expect(fr.filter((f) => f.anims || f.op !== '1'), `switch to ${id}`).toEqual([]);
    }

    // --- editor -> home: the page is already painted behind the view, so no entrance replay
    const homeRun = sp.evaluate(async () => {
      const out = []; const t0 = performance.now();
      while (performance.now() - t0 < 500) {
        const pg = document.querySelector('#main .page');
        out.push({ cls: pg ? pg.className : '', anims: document.getAnimations().filter((a) => a.animationName === 'rise-in').length });
        await new Promise((r) => setTimeout(r, 30));
      }
      return out;
    });
    await act('home');
    const hf = await homeRun;
    expect(hf.some((f) => /enter/.test(f.cls) || f.anims > 0)).toBe(false);
    // every tab has its own view-transition name (duplicates abort the add/close transition)
    const names = await sp.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => t.style.viewTransitionName));
    expect(new Set(names).size).toBe(names.length);
    expect(app.log(/\[kiroku\]\s+(load-failed|crash)/)).toEqual([]);
  } finally { await app.kill(); }
});

test('T2: tab colour + bold persist per file (IPC), tinted capsule renders, survives restart', async () => {
  const file = fixtureDocx();
  const app = await L.launch({ args: [file] });
  let userData;
  try {
    userData = app.userData;
    await app.nextEditor();
    const st = await app.waitState((s) => s.tabs.length === 1, 'tab');
    const id = st.tabs[0].id;
    expect(st.tabs[0]).toMatchObject({ color: null, bold: false });
    const sp = app.shellPage();
    await sp.evaluate((i) => window.shell.setTabStyle(i, { color: '#9BCB2A', bold: true }), id);
    const s2 = await app.waitState((s) => s.tabs[0].color === '#9BCB2A' && s.tabs[0].bold, 'style applied');
    expect(s2.tabs[0].color).toBe('#9BCB2A');
    const tab = sp.locator(`#tabs .tab[data-id="${id}"]`);
    await expect(tab).toHaveClass(/tinted/);
    await expect(tab).toHaveClass(/bold/);
    const css = await tab.evaluate((el) => { const c = getComputedStyle(el); return { tc: el.style.getPropertyValue('--tc'), bg: c.backgroundColor, fw: getComputedStyle(el.querySelector('.tab-title')).fontWeight }; });
    expect(css.tc).toBe('#9BCB2A');
    expect(css.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(Number(css.fw)).toBeGreaterThanOrEqual(700);
    // a colour outside the palette is rejected
    await sp.evaluate((i) => window.shell.setTabStyle(i, { color: '#123456' }), id);
    await app.waitState((s) => s.tabs[0].color === null, 'invalid colour dropped');
    await sp.evaluate((i) => window.shell.setTabStyle(i, { color: '#F0653F' }), id);
    await app.waitState((s) => s.tabs[0].color === '#F0653F', 'coral');
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    expect(Object.values(saved.tabStyles)).toEqual([{ color: '#F0653F', bold: true }]);
  } finally { await app.kill(); }

  const app2 = await L.launch({ args: [file], userData, testDir: L.tmpdir('out2') });
  try {
    const st = await app2.waitState((s) => s.tabs.length === 1, 'tab after restart');
    expect(st.tabs[0]).toMatchObject({ color: '#F0653F', bold: true });
    await expect(app2.shellPage().locator('#tabs .tab.tinted.bold')).toHaveCount(1);
  } finally { await app2.kill(); }
});

test('T3: move to new window keeps the document (no reload, unsaved edits + JS state), then back', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>Tear-out survivor 4242</p>');
    await app.waitState((s) => s.tabs[0].dirty, 'dirty');
    const id = (await app.state()).tabs[0].id;
    await ed.evaluate(() => { window.__tearMarker = 'alive'; window.__tearOrigin = performance.timeOrigin; });
    const nav0 = app.log(/\[kiroku\] loaded t1/).length;
    expect(await windowCount(app)).toBe(1);

    await app.shellPage().evaluate((i) => window.shell.moveTab(i, 'new'), id);
    await L.until(async () => (await windowCount(app)) === 2, { what: 'second window' });
    const sp2 = await L.until(() => shellPages(app).find((p) => p !== app.shellPage()), { what: 'second shell page' });
    await sp2.waitForLoadState('domcontentloaded');
    await L.until(() => sp2.evaluate(() => !!window.shell), { what: 'shell in window 2' });
    await hookState(sp2);
    const s2 = await untilState(sp2, (s) => s.tabs.length === 1 && s.activeId === id && s.main === false, 'moved tab active in window 2');
    expect(s2.tabs[0]).toMatchObject({ id, dirty: true });
    expect((await app.state()).tabs).toEqual([]); // main window lost it
    await expect(sp2.locator('#tabs .tab[data-id="home"]')).toHaveCount(1); // own Home tab

    // same page, not reloaded: JS global + time origin survive, no second load logged, edits still there
    expect(await ed.evaluate(() => performance.timeOrigin === window.__tearOrigin)).toBe(true);
    expect(await ed.evaluate(() => window.__tearMarker)).toBe('alive');
    expect(app.log(/\[kiroku\] loaded t1/).length).toBe(nav0);
    expect((await untilState(sp2, (s) => s.tabs[0].dirty, 'still dirty')).tabs[0].dirty).toBe(true);
    // ... and it still saves from the new window (dialog parented to that window), with the text typed before the move
    await L.ctrlS(ed);
    const file = path.join(app.testDir, 'Document 1.docx');
    await L.waitFile(file);
    expect(L.unzipEntry(file, 'word/document.xml')).toContain('Tear-out survivor 4242');

    // move back through the secondary window's own IPC: window 2 closes, marker still alive
    await sp2.evaluate((i) => window.shell.moveTab(i, 'main'), id);
    await L.until(async () => (await windowCount(app)) === 1, { what: 'window 2 closed' });
    const back = await app.waitState((s) => s.tabs.length === 1 && s.activeId === id, 'tab back in main');
    expect(back.tabs[0].id).toBe(id);
    expect(await ed.evaluate(() => window.__tearMarker)).toBe('alive');
  } finally { await app.kill(); }
});

test('T4: drag a tab down out of the strip -> new window; drag it onto the main strip -> re-docked', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await app.waitState((s) => s.tabs.length === 1, 'tab');
    const id = (await app.state()).tabs[0].id;
    await ed.waitForLoadState('domcontentloaded');
    await ed.evaluate(() => { window.__dragMarker = 7; });
    const sp = app.shellPage();
    // the OS cursor is not ours to move: tests feed main the "cursor" through a global (test mode only)
    const cursorAt = (pick, dx, dy) => app.mainEval(`(() => { const { BrowserWindow } = process.mainModule.require('electron');
      const all = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id); const b = all[${pick}].getBounds();
      globalThis.__kirokuCursor = { x: b.x + ${dx}, y: b.y + ${dy} }; })()`);
    await cursorAt(0, 500, 400); // inside the main window body, below the strip

    const drag = async (page, to) => {
      const box = await page.locator(`#tabs .tab[data-id="${id}"]`).boundingBox();
      const x = box.x + 60, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y + 40, { steps: 4 });
      await page.mouse.move(x + 20, y + to, { steps: 6 });
      expect(await page.locator('.tab.ghost').count()).toBe(1); // the floating clone
      await page.mouse.up();
    };
    await drag(sp, 130);
    await L.until(async () => (await windowCount(app)) === 2, { what: 'tear-out window' });
    const sp2 = await L.until(() => shellPages(app).find((p) => p !== sp), { what: 'second shell page' });
    await L.until(() => sp2.evaluate(() => !!window.shell), { what: 'shell in window 2' });
    await hookState(sp2);
    await untilState(sp2, (s) => s.tabs.length === 1 && s.main === false, 'tab in window 2');
    expect((await app.state()).tabs).toEqual([]);
    expect(await sp.locator('.tab.ghost').count()).toBe(0);
    expect(await ed.evaluate(() => window.__dragMarker)).toBe(7);

    // drag it from window 2 onto the main window's tab strip
    await cursorAt(0, 300, 12); // main window (lowest id), on its tab strip
    await drag(sp2, 130);
    await L.until(async () => (await windowCount(app)) === 1, { what: 'window 2 closed after re-dock' });
    await app.waitState((s) => s.tabs.length === 1 && s.activeId === id, 'docked in main');
    expect(await ed.evaluate(() => window.__dragMarker)).toBe(7);
  } finally { await app.kill(); }
});
