'use strict';
// Command line -> actions, plus the Windows jump-list tasks that launch with the same switches.
const path = require('path');

const SWITCHES = { '--writer': 'word', '--sheet': 'cell', '--slides': 'slide' };
const NEW_EXT = { docx: 'word', xlsx: 'cell', pptx: 'slide' };

/**
 * argv (process.argv or a second instance's argv) -> [{ type: 'new', kind } | { type: 'pdf' } | { type: 'open', path }].
 * argv[0] is the exe. In dev (appDir given) the app dir is argv[1] on first launch but Electron moves it behind the
 * switches on a second instance, so it is dropped wherever it sits. A bare "--" ends switches.
 */
function parseArgs(argv, cwd, appDir) {
  const out = [];
  let rest = false, skipDir = !!appDir;
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i], low = a.toLowerCase();
    let m;
    if (!rest && a === '--') rest = true;
    else if (!rest && low === '--source-app-id') continue; // Electron adds this VALUELESS switch; the arg after it is the first real positional (the file when packaged)
    else if (!rest && SWITCHES[low]) out.push({ type: 'new', kind: SWITCHES[low] });
    else if (!rest && low === '--pdf') out.push({ type: 'pdf' });
    else if (!rest && (m = low.match(/^--new=(docx|xlsx|pptx)$/))) out.push({ type: 'new', kind: NEW_EXT[m[1]] });
    else if (rest || !a.startsWith('-')) {
      const p = path.resolve(cwd, a);
      if (skipDir && p === path.resolve(cwd, appDir)) skipDir = false;
      else out.push({ type: 'open', path: p });
    }
  }
  return out;
}

/** app.setUserTasks entries. In dev the exe is electron, so the app dir goes first. */
function userTasks(execPath, appDir, defaultApp) {
  const pre = defaultApp ? `"${appDir}" ` : '';
  const task = (title, sw, description) => ({
    program: execPath, arguments: pre + sw, iconPath: execPath, iconIndex: 0, title, description,
  });
  return [
    task('New document', '--writer', 'Start a blank document'),
    task('New spreadsheet', '--sheet', 'Start a blank spreadsheet'),
    task('New presentation', '--slides', 'Start a blank presentation'),
    task('Open PDF', '--pdf', 'Choose a PDF to open'),
  ];
}

module.exports = { parseArgs, userTasks };
