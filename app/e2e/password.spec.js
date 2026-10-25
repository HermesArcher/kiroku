'use strict';
// Password-protected OOXML: x2t writes/reads ECMA-376 agile encryption, the shell never sees the password.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const SECRET = 's3cret-Pa55';

test('Protect > Add password: Ctrl+S writes an encrypted container; reopening asks for the password', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  const file = path.join(app.testDir, 'Document 1.docx');
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>Top secret kiroku text</p>');
    await app.waitState((s) => s.tabs[0].dirty, 'dirty after edit');
    // File > Protect is available (isPasswordSupport) and the dialog's handler is the guarded setter
    expect(await L.inEditor(ed, (win, api) => api.asc_isProtectionSupport())).toBe(true);
    const protectItem = await ed.frames().find((f) => /documenteditor/.test(f.url())).evaluate(() => { const tab = document.querySelector('a#protect'); const panel = document.querySelector('#protection-panel'); return tab && panel && getComputedStyle(tab).display !== 'none' ? panel.textContent : 'missing'; });
    expect(protectItem).toContain('Encrypt'); // the Protection tab with Encrypt / Change password is in the toolbar
    // the real UI: Protection tab > Encrypt > password twice > OK
    const fr = ed.frames().find((f) => /documenteditor/.test(f.url()));
    await fr.click('a#protect');
    await fr.click('#protection-panel >> text=Encrypt');
    const pw = fr.locator('.asc-window input[type=password]');
    await pw.nth(1).waitFor({ state: 'visible' });
    await pw.nth(0).fill(SECRET);
    await pw.nth(1).fill(SECRET);
    await fr.click('.asc-window button:has-text("OK")');
    await L.sleep(800);
    await L.ctrlS(ed);
    await L.waitFile(file);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('d0cf11e0'); // OLE container, not a zip
    expect(bytes.includes(Buffer.from('EncryptionInfo', 'utf16le'))).toBe(true);
    expect(bytes.includes(Buffer.from('EncryptedPackage', 'utf16le'))).toBe(true);
    expect(bytes.includes(Buffer.from('Top secret'))).toBe(false); // the text is not readable in the file
    await app.waitState((s) => !s.tabs[0].dirty && s.tabs[0].path, 'clean after save');
    await app.kill();

    // reopen: the password prompt appears; a wrong password is refused, the right one opens the document
    const app2 = await L.launch({ args: [file], userData: app.userData, testDir: L.tmpdir('out2') });
    try {
      const ed2 = await app2.nextEditor();
      const input = ed2.locator('#kiroku-password-input');
      await input.waitFor({ state: 'visible', timeout: 60000 });
      await input.fill('wrong-password');
      await ed2.locator('#kiroku-password-ok').click();
      await expect(ed2.locator('#kiroku-password-dialog')).toContainText('not right', { timeout: 60000 });
      await ed2.locator('#kiroku-password-input').fill(SECRET);
      await ed2.locator('#kiroku-password-ok').click();
      await L.waitEditor(ed2);
      const text = await L.inEditor(ed2, (win, api) => {
        const doc = api.WordControl && api.WordControl.m_oLogicDocument;
        return doc ? doc.GetText ? doc.GetText({}) : '' : '';
      });
      expect(await L.fatalDialog(ed2)).toBeNull();
      // save again: still encrypted (the password is kept for the session)
      const before = L.mtime(file);
      await L.pasteHtml(ed2, '<p>second edit</p>');
      await L.ctrlS(ed2);
      await L.waitFile(file, { after: before });
      expect(fs.readFileSync(file).subarray(0, 4).toString('hex')).toBe('d0cf11e0');
      expect(text).toContain('Top secret kiroku text'); // decrypted content came through
    } finally { await app2.kill(); }
  } finally { await app.kill(); }
});

test('cancelling the password prompt closes the tab and never opens the file', async () => {
  // make a protected file with the engine itself: encrypt via the editor, then open it and cancel
  const app = await L.launch({ args: ['--new=docx'] });
  const file = path.join(app.testDir, 'Document 1.docx');
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>private</p>');
    await L.inEditor(ed, (win, api, pw) => api.asc_setCurrentPassword(pw), SECRET);
    await L.ctrlS(ed);
    await L.waitFile(file);
    await app.kill();
    const app2 = await L.launch({ args: [file], userData: app.userData, testDir: L.tmpdir('out3') });
    try {
      const ed2 = await app2.nextEditor();
      await ed2.locator('#kiroku-password-cancel').click({ timeout: 60000 });
      await app2.waitState((s) => s.tabs.length === 0, 'tab closed after cancel');
    } finally { await app2.kill(); }
  } finally { await app.kill(); }
});
