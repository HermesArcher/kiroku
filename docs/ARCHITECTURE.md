# Kiroku — architecture

Offline office suite for Windows: an Electron shell around the ONLYOFFICE 9.3 web editors as packaged
by [ranuts/document](https://github.com/ranuts/document) (AGPL-3.0). No cloud, no network.

```
kiroku/
  assets-src/icons/      icon masters (scripts/make-icons.js builds every app icon from them)
  engine.patch           Kiroku's changes to the engine; scripts/engine.sh applies it
  engine/                (not committed) ranuts/document at a pinned commit + engine.patch. `pnpm run build` -> engine/dist
  app/                   Electron app
    main/main.js         windows, tabs, IPC, single-instance, file open/save, menus
    main/server.js       127.0.0.1 static server for the engine
    main/store.js        settings.json + recent lists in app.getPath('userData')
    main/kinds.js        extension -> kind table (shared by main + pdf-tools)
    main/pdf-tools.js    PDF tools: `registerPdfTools(ipcMain, electron, isShell)`
    main/music.js        rail player track list for the user's music folder
    preload/shell.js     exposes window.shell (API below) to renderer/index.html
    preload/editor.js    exposes window.kiroku (API below) to engine editor pages
    renderer/            index.html + app.js + styles.css: tab strip, Home, PDF tools, Settings, music player
    build/               icons + installer.nsh (Default-apps registration)
    scripts/             make-icons.js, prepare-engine.js (engine/dist -> app/engine-dist)
    test/                node:test unit tests; e2e/ Playwright tests that drive the real app
```

## Kinds and extensions
| kind  | label        | new ext | opens                         | icon      |
|-------|--------------|---------|-------------------------------|-----------|
| word  | Document     | docx    | docx doc odt rtf txt          | word.png  |
| cell  | Spreadsheet  | xlsx    | xlsx xls ods csv              | cell.png  |
| slide | Presentation | pptx    | pptx ppt odp                  | slide.png |
| pdf   | PDF          | —       | pdf                           | pdf.png   |
**Open by content** (`kinds.js` `sniffKind`/`resolveKind`): `%PDF` -> pdf; `{\rtf` -> rtf; OLE `D0 CF 11 E0 A1 B1 1A E1` -> doc/xls/ppt by stream name (`WordDocument`, `Workbook`/`Book`, `PowerPoint Document`, first 64KB);
ZIP -> central-directory names `word/` `xl/` `ppt/`, or ODF `mimetype`; no NUL bytes -> text (csv/txt keep their extension, else txt). Inconclusive -> extension. The sniffed ext becomes `tab.ext` and the name handed to the editor in `editor:boot` (so `report.bin` boots as `report.docx`); saves still go to the original path.
Legacy saves: doc->docx, xls->xlsx, ppt->pptx (engine default). New tab titles: "Document 1.docx", "Spreadsheet 1.xlsx", "Presentation 1.pptx" (counter per kind per session).

## Engine served by main/server.js
- `http://127.0.0.1:<port>/` root = engine dist (dev: `../engine/dist`; packaged: `process.resourcesPath/engine`).
  Preferred port 47615 (stable origin keeps IndexedDB/localStorage), fallback to a free port.
- Extensionless path `/editor` -> `editor.html` (also `/history` -> `history.html`); `/` -> `index.html`.
- `sdkjs/common/wasm/x2t/x2t.wasm.br` is DEcompressed in place by `scripts/prepare-engine.js`
  (copy engine/dist -> app/engine-dist, then brotli-decompress that one file, keep its name).
  Server serves it as `application/octet-stream` with NO Content-Encoding. Dev mode serves
  `../engine/dist` and must decompress that file on the fly (zlib.brotliDecompressSync, cache in memory).
- Editor tab URL: `http://127.0.0.1:<port>/editor?locale=<settings.language>`
- All non-local network requests from every session are cancelled (webRequest) — fully offline.
- Locked: loopback bind only; `Host` must be exactly `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard); every request needs the per-run secret in `X-Kiroku-Key` (32 random bytes hex, made in `createServer`, exposed as `engine.key`). Main adds the header to requests for the engine origin in every session
  (`session.defaultSession` + `app.on('session-created')`). Missing/wrong key or Host -> 403 (curl and other programs get nothing).

## Command line + jump list (`main/args.js`)
`Kiroku.exe [switches] [files...]`: `--writer` / `--sheet` / `--slides` (new blank document / spreadsheet / presentation), `--new=docx|xlsx|pptx` (same), `--pdf` (native PDF picker -> tabs),
other non-dash args are files (`--` ends switches). A second launch hands its switches/files to the running instance. Packaged builds register Windows jump-list tasks
(`app.setUserTasks`): New document, New spreadsheet, New presentation, Open PDF -> `process.execPath` + the switch. `parseArgs(argv, cwd, appDir)`: appDir is set in dev (electron is the exe; its app dir argument is dropped wherever Electron puts it).

## window.kiroku  (preload/editor.js -> engine page; contextBridge, sandbox: true)
```ts
interface KirokuBridge {
  // What this tab should show. Called once by the engine at boot.
  // Every plan also carries `backup` (Settings > Backups, see below); the engine applies it before the first autosave session.
  boot(): Promise<({ kind: 'new'; ext: 'docx' | 'xlsx' | 'pptx' } | { kind: 'open'; name: string; bytes: Uint8Array } | { kind: 'none' }) & { backup?: Backup }>;
  // Every save/export the editor produces. Main writes it to disk.
  save(name: string, bytes: Uint8Array): Promise<'written' | 'cancelled' | 'unavailable'>;
  // Unsaved-changes flag flips (drives the tab dot and close prompts).
  setDirty(dirty: boolean): void;
  // Backups (optional for older shells): current values, write back one change (the /history autosave switch), live updates.
  getBackup(): Promise<Backup>;
  setBackup(patch: Partial<Backup>): Promise<Backup>;
  onBackup(cb: (b: Backup) => void): void;   // main pushes 'editor:backup' to every editor view when Settings changes
  abandon(): void;                            // close this tab (the user cancelled a password prompt)
}
type Backup = { autosave: boolean; intervalSec: 30 | 60 | 120 | 180; keepVersions: 3 | 5 | 10; keepDays: 1 | 7 | 30 };
```
`kind: 'none'` = page loaded without a pending boot (e.g. `/editor?saved=<id>` from the recovery page) — engine keeps its normal URL behaviour.
Main save rules (ipc `editor:save`, tab found by `event.sender`):
- ext = extension of `name`. If tab has a path and ext == tab's ext -> atomic write (tmp + rename) to path -> 'written'.
- Else show the Save As dialog (default dir = tab path dir or Documents; default name = tab base name + ext). Its filters are
  every format x2t can write for the tab's kind (`main/formats.js` FORMATS), the editor's pick first. Cancel -> 'cancelled'.
  If the user picks another listed format in the dialog, main calls `window.__kirokuExport(ext)` in the page and writes those bytes.
  If the final format `isLossy(tab.ext, ext)` (txt, csv, rtf, html, epub, fb2, png, jpg, and ODF from a non-ODF document) a
  message box asks "Saving as <FMT> may lose formatting. Keep working in <NATIVE> and save a copy?" [Save copy | Cancel];
  Cancel -> 'cancelled'. On write: if ext's kind == tab kind, the format is not lossy, and (tab has no path OR tab ext is
  legacy doc/xls/ppt and ext is its OOXML sibling) -> rebind tab (path, title, ext) and add to recent. Every other export
  (PDF, ODT, TXT, templates, macro-enabled…) leaves the tab bound to its own file.
  Offered formats (probed on the engine): word docx docm dotx odt ott rtf txt pdf; cell xlsx xlsm xltx ods ots csv pdf;
  slide pptx pptm potx odp otp pdf. Not offered: doc/xls/ppt (x2t cannot write them), pdfa (same bytes as pdf here),
  html/epub/fb2 (x2t aborts), png/jpg (x2t refuses, code 88). Test mode: `KIROKU_TEST_SAVE_EXT=<ext>` makes the stubbed dialog pick that extension.
- Write errors -> error dialog, return 'unavailable'.
Engine also exposes `window.__kirokuExport(ext): Promise<{name, base64}|null>` (live export in any format, used by Save As above) and `window.__kirokuSave(): Promise<'written'|'cancelled'|'unavailable'|'failed'>` — exports the
document in its own format and routes it through `kiroku.save`; main calls it via executeJavaScript for
"Save" in close prompts.

## window.shell  (preload/shell.js -> renderer/index.html)
```ts
interface ShellBridge {
  onState(cb: (s: { tabs: Tab[]; activeId: 'home' | string }) => void): void; // fires on every change + once right after subscribe
  activate(id: 'home' | string): void;
  close(id: string): void;              // runs the dirty prompt in main
  newMenu(): void;                      // native popup menu: Document / Spreadsheet / Presentation (for the "+" button)
  newDoc(kind: 'word' | 'cell' | 'slide'): void;
  openDialog(): void;                   // native open dialog (all supported types, multi) -> tabs
  openPaths(paths: string[]): void;     // already-open path -> activate that tab instead of reopening
  pathForFile(file: File): string;      // webUtils.getPathForFile, for drag & drop
  getRecent(): Promise<Recent[]>;       // newest first, pinned first; exists = fs.existsSync at call time
  removeRecent(path: string): Promise<void>;
  pinRecent(path: string, pinned: boolean): Promise<void>;
  clearRecent(): Promise<void>;         // keeps pinned (files and folders)
  getRecentFolders(): Promise<RecentFolder[]>; // folders of opened files; pinned first, then newest; cap 12; exists = fs.existsSync
  pinRecentFolder(path: string, pinned: boolean): Promise<void>;
  removeRecentFolder(path: string): Promise<void>;
  openDialogAt(dir: string): void;      // native Open dialog with defaultPath = dir (recent-folder click)
  searchFiles(query: string): Promise<{ engine: 'everything' | 'folders'; hits: { path: string; name: string; kind: 'word' | 'cell' | 'slide' | 'pdf' }[] }>; // see "Search" below
  showInFolder(path: string): void;
  onRecentChanged(cb: () => void): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>; // theme applied immediately via nativeTheme.themeSource
  openDefaultApps(): void;              // ms-settings:defaultapps?registeredAppUser=Kiroku (fallback ms-settings:defaultapps)
  defaultStatus(): Promise<string[]>;   // of docx/xlsx/pptx/pdf, those whose UserChoice ProgId isn't Kiroku.* (Home "Set as default" strip)
  // --- tabs / multi-window (additive; every call acts for the window that sent it) ---
  tabMenu(id: string): void;            // native context menu for a doc tab: Tab colour > None/Aqua/Lime/Lilac/Coral/Sky/Sand, Bold title, Move to new window | Move back to main window, Close tab
  setTabStyle(id: string, patch: { color?: string | null; bold?: boolean }): void; // colour must be a palette hex (#22AFC4 #9BCB2A #8B79E0 #F0653F #1FA6D8 #D9B26A) else null; persisted per file path in settings.json (tabStyles)
  moveTab(id: string, where: 'new' | 'main' | 'drop'): void; // 'new' = tear out into a new window; 'main' = re-dock into the main window; 'drop' = after a drag: tab strip of the window under the cursor -> dock there, otherwise new window (a lone tab in a torn-out window stays)
  openRecovery(): void;                 // opens http://127.0.0.1:<port>/history in a new tab (kind 'recovery', title 'Recovered files')
  getInfo(): Promise<{ version: string; packaged: boolean; userData: string }>;
  music(): Promise<{ dir: string | null; tracks: Track[] }>; // audio files in settings.musicDir (top level only, main/music.js)
  pickMusic(): Promise<{ dir: string; tracks: Track[] } | null>; // folder dialog; saves settings.musicDir; null = cancelled
  pdf(op: string, args?: any): Promise<any>; // ipcRenderer.invoke('pdf:' + op, args) — handlers live in main/pdf-tools.js
}
type Tab = { id: string; title: string; kind: 'word' | 'cell' | 'slide' | 'pdf' | 'recovery'; dirty: boolean; path: string | null; color: string | null; bold: boolean };
// onState payload is per window: { tabs: Tab[] /* only this window's tabs */, activeId, main: boolean /* true = the main window */ }
type Recent = { path: string; name: string; kind: 'word' | 'cell' | 'slide' | 'pdf'; openedAt: number; pinned: boolean; exists: boolean };
type RecentFolder = { path: string; name: string; openedAt: number; pinned: boolean; exists: boolean };
type Track = { src: string /* file:// URL */; title: string; artist: string }; // "01 - Artist - Title.mp3" -> Artist / Title
type Settings = {
  theme: 'system' | 'light' | 'dark'; language: string /* editor UI locale, default 'en' */;
  recentFilter: 'all' | 'word' | 'cell' | 'slide' | 'pdf'; // Home > Recent kind filter, persisted, default 'all'
  encryptRecent: boolean;       // set via setSettings({ encryptRecent }); true only while safeStorage is available
  canEncryptRecent: boolean;    // read-only: safeStorage.isEncryptionAvailable()
  backup: Backup;               // Settings > Backups; setSettings({ backup: <partial> }) merges and snaps to the allowed values (main/backup.js)
};
```

Recent storage (main/store.js, `createStore(dir, { safeStorage })`): plain mode = `recent.json` (files) + `recent-folders.json`; `encryptRecent` on = one `recent.enc` (safeStorage-encrypted `{files, folders}`) and both plain files deleted. Toggling writes the new copy before deleting the old; an undecryptable `recent.enc` is never deleted. Folders are derived from `recent.json` when no folder list exists yet.

Search (main/search.js `searchSmart`): if Everything's `es.exe` is found (PATH, `%ProgramFiles%\Everything`, `%ProgramFiles(x86)%\Everything`, `%LOCALAPPDATA%\Programs\Everything`) it is run as `es.exe -n 50 ext:<supported exts> <query>` with a 1.5 s timeout (local IPC only, no network); any failure (not running, non-zero exit, timeout) falls back to the folder walk over Documents/Desktop/Downloads. `engine` says which one answered; Home shows it as a mono caption in the "bonus" group label.

## Windows and tabs (main/main.js)
- Several Kiroku windows may exist: the main window plus torn-out ones (same shell renderer, own Home tab). `win` in main.js is the LAST-FOCUSED window; new tabs, dialogs and second-instance file opens go there.
- Tear-out / re-dock re-parents the tab's existing WebContentsView (removeChildView -> addChildView): no reload, unsaved edits and page state survive.
- Closing a torn-out window runs the unsaved-changes prompts for its own tabs only; closing the main window prompts for every tab, then quits (torn-out windows close with it). A torn-out window with no tabs left closes itself.
- Editor tab switches are instant: the view is shown with the frame it last painted, in place. Only the tab-strip capsule glides (180ms). No in-page enter animation: it can only start after the view is visible, which showed a blank frame then a slide.
- Test hook (KIROKU_TEST_DIR set only): `globalThis.__kirokuCursor = {x, y}` in main overrides the OS cursor for `moveTab(id, 'drop')`.

## PDF tools (main/pdf-tools.js, pdf-lib 1.17.1; ipc channel 'pdf:<op>')
Handlers answer only a Kiroku shell page (top frame of renderer/index.html, any shell window): `registerPdfTools(ipcMain, electron, isShell)`; others get { ok:false, error:'forbidden' }.
Each op takes plain JSON args, asks for the output location with a native Save/folder dialog itself, returns
`{ ok: true, output: string | string[] }`, `{ ok: false, cancelled: true }` or `{ ok: false, error: string }`.
- `pick` {type: 'pdf'|'image', multi: boolean} -> string[] (native open dialog)
- `info` {path} -> { pages: number }
- `merge` {paths[]}                    -> one PDF
- `split` {path, mode:'each'|'ranges', ranges?: string}  -> folder of PDFs ("each" = one file per page; "ranges" = one file per comma group, e.g. "1-3,4,7-9")
- `extract` {path, ranges}             -> one PDF with those pages
- `delete` {path, ranges}              -> one PDF without those pages (refuse deleting all pages)
- `rotate` {path, degrees: 90|180|270, ranges?: string (empty = all)} -> one PDF
- `images` {paths[]} (png/jpg/jpeg)    -> one PDF, one page per image sized to the image (A4-fit not required)
Range syntax: 1-based, "1-3, 5, 8-", whitespace tolerant; invalid -> { ok:false, error } with a human message.

## Look & feel
Name "Kiroku" (記録, "record"). Theme "Aqua-Gen" (Gen X Soft Club): frosted aqua glass, clear plastic, CD-booklet typography.
Fonts: Comfortaa, Quicksand, Lexend Zetta, Michroma, Geist Mono (OFL, bundled in `app/renderer/assets/fonts`).
Tab strip 40px high, `-webkit-app-region: drag` (tabs/buttons `no-drag`), right 140px reserved for native caption buttons (titleBarOverlay).
No external fonts/CDNs. English UI.

## Backups (Settings > Backups)
`settings.json.backup` = `{ autosave: true, intervalSec: 60, keepVersions: 3, keepDays: 7 }` by default. Choices are closed lists (interval 30/60/120/180 s,
versions 3/5/10, keep-for 1/7/30 days); `main/backup.js normalizeBackup` snaps anything else. Main puts it in every `editor:boot` plan and pushes
`editor:backup` to all editor views on change; the engine (`engine/lib/history/backup-settings.ts`) applies it: the autosave interval is the floor (a slow
export still backs off past it, up to 180 s), `keepVersions` trims revisions per document, `keepDays` is the expiry window (swept at start and when it shrinks).
`/history` reads the same values (retention note) and its Autosave switch writes back through `kiroku.setBackup`.

## Password-protected documents (engine/lib/password.ts)
x2t writes and reads ECMA-376 agile encryption (`m_sSavePassword` / `m_sPassword`). Protection tab > Encrypt (or File > Protect) sets a page-memory password; every
OOXML export (docx/xlsx/pptx and docm/dotx/xlsm/xltx/pptm/potx) is then written as an encrypted OLE container. Opening a protected file: the boot plan's bytes are an
OLE file with an `EncryptedPackage` stream -> the page asks for the password, decrypts through the x2t worker (op `recrypt`), opens the plain copy and keeps the password
for saves; Cancel -> `kiroku.abandon()` closes the tab. The password is never sent to main, stored or logged. Other export formats (PDF, ODT…) are not encrypted.
