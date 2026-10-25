'use strict';
(() => {
  const shell = window.shell;

  // ---------- helpers ----------
  const KINDS = {
    word: { label: 'Document', icon: 'assets/word.png', color: 'var(--c-word)', ext: 'DOCX' },
    cell: { label: 'Spreadsheet', icon: 'assets/cell.png', color: 'var(--c-cell)', ext: 'XLSX' },
    slide: { label: 'Presentation', icon: 'assets/slide.png', color: 'var(--c-slide)', ext: 'PPTX' },
    pdf: { label: 'PDF', icon: 'assets/pdf.png', color: 'var(--c-pdf)', ext: 'PDF' },
  };
  const P = {
    recover: 'M3 12a9 9 0 1 0 2.8-6.5M3 4v5h5M12 7.5V12l3 2',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    x: 'M6 6l12 12M18 6 6 18',
    plus: 'M12 5v14M5 12h14',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    merge: 'M6 4v3a5 5 0 0 0 5 5M18 4v3a5 5 0 0 1-5 5M12 12v8M9 17l3 3 3-3',
    split: 'M12 3v7M9 6l3-3 3 3M12 10c0 5-6 4-6 11M12 10c0 5 6 4 6 11',
    extract: 'M7 3h7l4 4v14H7zM14 3v4h4M10 15h5M13 12l3 3-3 3',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
    rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    images: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
    play: 'M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z',
    pause: 'M8.5 6v12M15.5 6v12',
    prev: 'M6.5 6v12M18 6.8v10.4L9.8 12z',
    next: 'M17.5 6v12M6 6.8v10.4l8.2-5.2z',
    arrow: 'M5 12h13M13 7l5 5-5 5',
  };
  const svg = (name, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'i ' + (cls || ''));
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', P[name]);
    s.append(p);
    return s;
  };
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') for (const [pk, pv] of Object.entries(v)) el.style.setProperty(pk, pv);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const $ = (s) => document.querySelector(s);
  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
  const baseOf = (p) => p.replace(/^.*[\\/]/, '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // "Wed 21 Oct" / "Wed 21 Oct 2026" (uppercased by CSS in mono labels)
  const dateLabel = (d, year) => {
    const o = {};
    for (const p of new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(d)) o[p.type] = p.value;
    return `${o.weekday} ${o.day} ${o.month}` + (year ? ' ' + o.year : '');
  };
  // Section header: mono "01  NEW" + hairline rule filling the rest, optional controls on the right.
  const sectHead = (n, text, ...right) => h('div', { class: 'sect-head' },
    h('h2', { class: 'label' }, h('span', { class: 'n', text: n }), text), h('i', { class: 'rule' }), ...right);

  function relTime(ts) {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60e3) return 'just now';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' min ago';
    const d = new Date(ts), t = new Date();
    const startToday = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    if (ts >= startToday) return Math.floor(diff / 3600e3) + ' hr ago';
    if (ts >= startToday - 86400e3) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }

  // ---------- state ----------
  const app = { tabs: [], activeId: 'home', page: 'home', recent: [], found: [], query: '', confirmClear: false, info: null, settings: null };
  let lastActive = null, searchTimer = null, searchSeq = 0, tabKey = null;

  // first-load entrance only (css: body.boot); page changes use .page.enter
  document.body.classList.add('boot');
  setTimeout(() => document.body.classList.remove('boot'), 1600);

  // Run a DOM update inside a view transition (kind = css hook html[data-vt], used by the tab strip); plain call when unsupported or motion is reduced.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function vt(fn, kind) {
    if (!document.startViewTransition || reduced.matches) return Promise.resolve(fn());
    const root = document.documentElement;
    root.dataset.vt = kind;
    const t = document.startViewTransition(fn);
    t.ready.catch(() => {});
    t.finished.catch(() => {}).then(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
    return t.updateCallbackDone;
  }

  // ---------- tab strip ----------
  function kindIcon(kind) {
    if (KINDS[kind]) return h('img', { src: KINDS[kind].icon, alt: '', width: 16, height: 16, draggable: 'false' });
    const s = svg('recover', 'kind'); // recovery tab
    s.setAttribute('class', 'kind');
    return s;
  }
  // one sliding capsule (#tabs > .tab-pill, outside the re-rendered tabs) glides to the active tab: translateX + width.
  // It lives in the scrolling strip, so it follows horizontal scroll by itself; a ResizeObserver re-places it on resize.
  // instant = no glide (first placement, resize, or inside a view transition, where the pill morphs as a named group instead).
  function placeTabPill(instant) {
    const pill = $('#tabs .tab-pill'), cur = $('#tabs .tab.active');
    if (!pill) return;
    if (!cur) { pill.classList.remove('on'); return; }
    const first = !pill.classList.contains('on');
    if (first || instant) pill.style.transition = 'none';
    pill.style.width = cur.offsetWidth + 'px';
    pill.style.transform = `translateX(${cur.offsetLeft}px)`;
    if (first || instant) { void pill.offsetWidth; pill.style.transition = ''; pill.classList.add('on'); }
  }
  if (window.ResizeObserver) new ResizeObserver(() => placeTabPill(true)).observe($('#tabs'));

  // drag a tab: it follows the pointer; dragging it >70px away from the strip (or out of the window) and releasing hands it to main,
  // which docks it on another window's strip under the cursor or opens it in a new window
  let dragMoved = false;
  function startTabDrag(e, id) {
    if (e.button !== 0 || e.target.closest('.tab-close')) return;
    const el = e.currentTarget, sx = e.clientX, sy = e.clientY;
    let on = false, ghost = null;
    const outside = (ev) => Math.abs(ev.clientY - sy) > 70 || ev.clientX < 0 || ev.clientY < 0 || ev.clientX > innerWidth || ev.clientY > innerHeight;
    try { el.setPointerCapture(e.pointerId); } catch (_) { return; }
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!on && Math.hypot(dx, dy) < 6) return;
      if (!on) { // the tab strip clips its children, so the dragged tab is a clone floating on <body>
        const r = el.getBoundingClientRect();
        ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', viewTransitionName: 'none' });
        document.body.append(ghost);
        el.classList.add('dragging');
      }
      on = dragMoved = true;
      const out = outside(ev);
      ghost.classList.toggle('tearing', out);
      ghost.style.transform = `translate(${dx}px, ${dy}px)` + (out ? ' scale(1.05)' : '');
    };
    const end = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      try { el.releasePointerCapture(ev.pointerId); } catch (_) { /* gone */ }
      el.classList.remove('dragging');
      if (ghost) ghost.remove();
      if (on && ev.type === 'pointerup' && outside(ev)) shell.moveTab(id, 'drop');
      setTimeout(() => { dragMoved = false; }, 0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end); // the strip re-rendered under the drag: drop the ghost, no move
  }

  function renderTabs(instantPill) {
    const wrap = $('#tabs');
    wrap.querySelectorAll('.tab').forEach((n) => n.remove());
    const home = h('div', {
      class: 'tab' + (app.activeId === 'home' ? ' active' : ''), role: 'tab', id: 'tab-home', tabindex: app.activeId === 'home' ? '0' : '-1',
      'aria-selected': String(app.activeId === 'home'), 'aria-label': 'Home', 'data-id': 'home',
      style: { '--kc': 'var(--aqua)', 'view-transition-name': 'tab-home' }, onclick: () => shell.activate('home'),
    }, h('img', { src: 'assets/app.png', alt: '', width: 16, height: 16, draggable: 'false' }), h('span', { class: 'tab-title', text: 'Home' }));
    wrap.append(home);
    for (const t of app.tabs) {
      const active = t.id === app.activeId;
      const kc = KINDS[t.kind] ? KINDS[t.kind].color : 'var(--aqua)';
      const style = { '--kc': kc, 'view-transition-name': 'tab-' + t.id.replace(/[^w-]/g, '_') };
      if (t.color) style['--tc'] = t.color;
      wrap.append(h('div', {
        class: 'tab' + (active ? ' active' : '') + (t.dirty ? ' dirty' : '') + (t.color ? ' tinted' : '') + (t.bold ? ' bold' : ''), role: 'tab', tabindex: active ? '0' : '-1', 'data-id': t.id,
        'aria-selected': String(active), title: t.path || t.title, style,
        onclick: () => { if (!dragMoved) shell.activate(t.id); },
        onpointerdown: (e) => startTabDrag(e, t.id),
        oncontextmenu: (e) => { e.preventDefault(); shell.tabMenu(t.id); },
        onmousedown: (e) => { if (e.button === 1) e.preventDefault(); },
        onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); shell.close(t.id); } },
      },
      kindIcon(t.kind),
      h('span', { class: 'tab-title', text: t.title }),
      h('span', { class: 'tab-end' },
        h('i', { class: 'unsaved', 'aria-hidden': 'true', text: '*' }),
        h('button', { class: 'tab-close', type: 'button', tabindex: '-1', 'aria-label': 'Close ' + t.title, title: 'Close',
          onclick: (e) => { e.stopPropagation(); shell.close(t.id); } }, svg('x')))));
    }
    const cur = wrap.querySelector('.tab.active');
    if (cur) cur.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    placeTabPill(instantPill === true);
  }
  // view transition (grow/shrink) only when tabs are added or closed; switching the active tab just glides the capsule
  function syncTabs() {
    const ids = app.tabs.map((t) => t.id).join(',');
    const animate = tabKey !== null && ids !== tabKey;
    tabKey = ids;
    if (animate) vt(() => renderTabs(true), 'tabs'); else renderTabs();
  }
  $('#tabs').addEventListener('keydown', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const all = [...document.querySelectorAll('#tabs .tab')];
    const i = all.indexOf(tab);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shell.activate(tab.dataset.id); }
    else if (e.key === 'Delete' && tab.dataset.id !== 'home') shell.close(tab.dataset.id);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = all[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (n) { tab.tabIndex = -1; n.tabIndex = 0; n.focus(); }
    }
  });
  $('#tabs').addEventListener('wheel', (e) => {
    if (e.deltaY && !e.deltaX) { $('#tabs').scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  $('#newtab').append(svg('plus'));
  $('#newtab').addEventListener('click', () => shell.newMenu());

  // ---------- rail: the Kiroku line ----------
  const NAV = [
    { id: 'home', label: 'Home' },
    { id: 'pdf', label: 'PDF Tools' },
    { id: 'recover', label: 'Recovered files' },
    { id: 'settings', label: 'Settings' },
  ];
  function renderNav() {
    const nav = $('#nav');
    const had = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.nav : null;
    nav.querySelectorAll('.nav-item').forEach((b) => b.remove());
    NAV.forEach((n, i) => {
      nav.append(h('button', {
        class: 'nav-item', type: 'button', 'data-nav': n.id, 'aria-label': n.label,
        'aria-current': n.id === app.page ? 'page' : null,
        onclick: () => (n.id === 'recover' ? shell.openRecovery() : go(n.id)),
      }, h('span', { class: 'nav-label', text: n.label }), h('span', { class: 'nav-idx', text: String(i + 1).padStart(2, '0') })));
    });
    if (had) { const b = nav.querySelector(`[data-nav="${had}"]`); if (b) b.focus(); } // keep keyboard focus across the re-render
    placePill();
  }
  // the sliding pill lives in #nav outside the re-rendered buttons; first placement is instant
  function placePill() {
    const pill = $('#nav .nav-pill'), cur = $('#nav .nav-item[aria-current]');
    if (!pill) return;
    if (!cur) { pill.classList.remove('on'); return; }
    const first = !pill.classList.contains('on');
    if (first) pill.style.transition = 'none';
    pill.style.transform = `translateY(${cur.offsetTop}px)`;
    if (first) { void pill.offsetWidth; pill.style.transition = ''; pill.classList.add('on'); }
  }
  $('#nav').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const b = [...document.querySelectorAll('#nav .nav-item')];
    const i = b.indexOf(document.activeElement);
    b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus();
  });

  // rail footer LCD: clock in the corner, the rest is a real music player
  function tick() {
    $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  tick();
  setInterval(tick, 15e3);

  // ---------- rail player: songs from a folder the user picks (settings.musicDir, listed by main/music.js) ----------
  // Spectrum = Web Audio analyser, drawn only while playing and the home view is showing. Media keys via mediaSession.
  const audio = new Audio();
  audio.preload = 'metadata';
  const pl = { dir: null, list: [], i: 0, ctx: null, an: null, raf: 0, ft: 0 };
  try { const s = JSON.parse(localStorage.getItem('kiroku.player')) || {}; pl.i = s.i | 0; if (s.vol >= 0 && s.vol <= 1) audio.volume = s.vol; } catch (_) { /* defaults */ }
  const savePl = () => { try { localStorage.setItem('kiroku.player', JSON.stringify({ i: pl.i, vol: audio.volume })); } catch (_) { /* fine */ } };
  const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const bars = [...document.querySelectorAll('#eq i')];
  const BIN = bars.map((_, i) => 1 + i + Math.round(48 * (i / (bars.length - 1)) ** 2.2)); // low bins packed left, ~190 Hz .. 12 kHz (mp3s cut off ~16 kHz)
  const fft = new Uint8Array(128);
  const seek = $('#pl-seek'), playBtn = $('#pl-play');
  $('#pl-prev').append(svg('prev'));
  $('#pl-next').append(svg('next'));
  $('#pl-folder').append(svg('folder'));

  function drawTrack() {
    const t = pl.list[pl.i];
    const box = $('#pl-title'), span = box.firstChild;
    span.textContent = t ? (t.artist ? t.artist + ' — ' + t.title : t.title) : pl.dir ? 'No songs in ' + baseOf(pl.dir) : 'Choose a music folder';
    $('#pl-folder').title = pl.dir ? 'Music folder: ' + pl.dir : 'Choose music folder';
    box.title = span.textContent;
    $('#pl-no').textContent = String(pl.list.length ? pl.i + 1 : 0).padStart(2, '0') + '/' + String(pl.list.length).padStart(2, '0');
    box.classList.remove('marq'); // long titles scroll like an LCD marquee
    const over = span.offsetWidth - box.clientWidth;
    if (over > 0) { box.style.setProperty('--marq', -over + 'px'); box.style.setProperty('--md', Math.max(6, over / 12) + 's'); box.classList.add('marq'); }
    try { if (t && navigator.mediaSession) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: 'Kiroku' }); } catch (_) { /* no media session */ }
  }
  function drawState() {
    const on = !audio.paused;
    $('#player').classList.toggle('playing', on);
    $('#pl-state').textContent = !pl.dir ? 'No folder' : !pl.list.length ? 'No tracks' : audio.error ? 'Cannot play' : on ? 'Now playing' : 'Paused';
    playBtn.textContent = '';
    playBtn.append(svg(on ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    playBtn.title = on ? 'Pause' : 'Play';
  }
  function load(i, play) {
    if (!pl.list.length) return;
    pl.i = (i + pl.list.length) % pl.list.length;
    audio.src = pl.list[pl.i].src;
    $('#pl-pos').textContent = '00:00';
    $('#pl-len').textContent = '';
    seek.value = 0;
    seek.style.setProperty('--p', '0%');
    savePl();
    drawTrack();
    if (play) playAudio(); else drawState();
  }
  function playAudio() {
    if (!pl.list.length) return;
    if (!pl.ctx) { // first press: build the analyser graph (needs the click's user gesture)
      try {
        pl.ctx = new AudioContext();
        pl.an = pl.ctx.createAnalyser();
        pl.an.fftSize = 256;
        pl.an.smoothingTimeConstant = 0.75;
        pl.ctx.createMediaElementSource(audio).connect(pl.an);
        pl.an.connect(pl.ctx.destination);
      } catch (_) { pl.an = null; }
    }
    if (pl.ctx && pl.ctx.state === 'suspended') pl.ctx.resume().catch(() => {});
    audio.play().catch(() => drawState());
  }
  const toggle = () => (!pl.list.length ? pickFolder() : audio.paused ? playAudio() : audio.pause());
  function setMusic(m) {
    if (!m) return;
    pl.dir = m.dir;
    pl.list = Array.isArray(m.tracks) ? m.tracks : [];
    for (const b of [$('#pl-prev'), $('#pl-next'), seek]) b.disabled = !pl.list.length;
    if (pl.list.length) load(pl.i, false);
    else { audio.pause(); audio.removeAttribute('src'); drawTrack(); drawState(); }
  }
  // a freshly picked folder starts from its first song (the dialog click is the user gesture playAudio needs)
  const pickFolder = () => shell.pickMusic().then((m) => { if (!m) return; pl.i = 0; setMusic(m); playAudio(); }).catch(() => {});
  const prev = () => { if (audio.currentTime > 3) audio.currentTime = 0; else load(pl.i - 1, !audio.paused); };
  const next = () => load(pl.i + 1, !audio.paused);
  function eqLoop() {
    pl.raf = requestAnimationFrame(eqLoop);
    if (!pl.an || app.activeId !== 'home') return; // an editor covers the rail
    pl.an.getByteFrequencyData(fft);
    bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.min(1, Math.max(0.08, (fft[BIN[i]] / 255) * (1 + i * 0.05))).toFixed(3)})`; });
  }
  audio.addEventListener('play', () => { drawState(); cancelAnimationFrame(pl.raf); eqLoop(); });
  audio.addEventListener('pause', () => { drawState(); cancelAnimationFrame(pl.raf); bars.forEach((b) => { b.style.transform = ''; }); });
  audio.addEventListener('ended', () => load(pl.i + 1, true));
  audio.addEventListener('error', drawState);
  audio.addEventListener('loadedmetadata', () => { $('#pl-len').textContent = '/ ' + mmss(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    $('#pl-pos').textContent = mmss(audio.currentTime);
    if (!seek.matches(':active') && audio.duration) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    seek.style.setProperty('--p', seek.value / 10 + '%');
  });
  seek.addEventListener('input', () => {
    seek.style.setProperty('--p', seek.value / 10 + '%');
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  });
  playBtn.addEventListener('click', toggle);
  $('#pl-prev').addEventListener('click', prev);
  $('#pl-next').addEventListener('click', next);
  $('#pl-folder').addEventListener('click', pickFolder);
  $('#player').addEventListener('wheel', (e) => { // volume, shown in the clock's corner for a moment
    e.preventDefault();
    audio.volume = Math.min(1, Math.max(0, Math.round((audio.volume - Math.sign(e.deltaY) * 0.05) * 100) / 100));
    savePl();
    $('#clock').textContent = 'VOL ' + Math.round(audio.volume * 100);
    clearTimeout(pl.ft);
    pl.ft = setTimeout(tick, 1200);
  }, { passive: false });
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', playAudio);
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', next);
  } catch (_) { /* no media keys */ }
  shell.music().then(setMusic).catch(() => {});
  drawTrack();
  drawState();

  // Page change: the old page goes at once and the new one rises in section by section (css .page.enter).
  // No view transition here: its old/new snapshots double-exposed the two pages and stretched the hero between heights.
  function go(page, instant) {
    app.page = page;
    app.confirmClear = false;
    renderNav();
    const main = $('#main');
    main.textContent = '';
    main.className = '';
    main.scrollTop = 0;
    const done = ({ home: renderHome, pdf: renderPdf, settings: renderSettings })[page](); // renderSettings is async
    if (!instant) enterPage();
    return done;
  }

  // also replayed when coming back from an editor tab (whichever page is showing behind it)
  function enterPage() {
    const pg = $('#main .page');
    if (!pg || reduced.matches) return;
    pg.classList.remove('enter');
    void pg.offsetWidth;
    [...pg.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 6)));
    pg.classList.add('enter');
    clearTimeout(pg.enterTimer);
    pg.enterTimer = setTimeout(() => pg.classList.remove('enter'), 900);
  }

  // Every page: a rounded photo "album cover" hero with a frosted glass plate holding the (title) on the left.
  // deco = optional decoration over the photo (catalogue text, collage tiles); it is aria-hidden.
  const paren = (t) => h('span', { class: 'paren', 'aria-hidden': 'true', text: t });
  const barcode = (cls) => h('i', { class: 'barcode' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
  // small hero deco (pdf/settings): tracklist + catalogue code + barcode
  const miniDeco = (cap, names, code) => [
    h('div', { class: 'cap', text: cap }),
    h('ol', { class: 'tracks' }, names.map((t, i) => h('li', {}, h('b', { text: String(i + 1).padStart(2, '0') }), t))),
    h('div', { class: 'cat' }, h('span', { text: code }), barcode())];
  // home hero: a looping H3 subway clip over the photo (day/night pick follows the theme); photo stays if motion is reduced
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  const heroSrc = () => 'assets/photos/hero-' + (darkMq.matches ? 'night' : 'day') + '.mp4';
  const heroVideo = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const v = h('video', { class: 'hero-vid', src: heroSrc(), autoplay: true, loop: true, playsinline: true, disablepictureinpicture: true,
      onplaying: (e) => e.target.classList.add('on'), onerror: (e) => e.target.remove() });
    v.muted = true; // the attribute alone doesn't mute a script-made element, and autoplay needs muted
    return v;
  };
  darkMq.addEventListener('change', () => { const v = $('.hero-vid'); if (v) { v.classList.remove('on'); v.src = heroSrc(); } });
  const pageShell = (title, label, sub, action, deco) => {
    const main = $('#main');
    main.className = app.page === 'home' ? 'tall' : '';
    const page = h('section', { class: 'page', 'aria-label': title });
    page.append(h('header', { class: 'head', 'data-hero': app.page },
      h('div', { class: 'hero', 'aria-hidden': 'true' },
        h('div', { class: 'hero-img' }), app.page === 'home' ? heroVideo() : null, h('div', { class: 'hero-bloom' }), h('div', { class: 'hero-streak' }, h('i'), h('i'), h('i')), h('div', { class: 'hero-grain' })),
      deco ? h('div', { class: 'deco', 'aria-hidden': 'true' }, deco) : null,
      h('div', { class: 'head-text' },
        h('div', { class: 'label', text: label }),
        h('h1', {}, paren('('), title, paren(')')),
        h('p', { class: 'sub', text: sub }),
        action ? h('div', { class: 'head-act' }, action) : null)));
    main.append(page);
    return page;
  };

  // ---------- home ----------
  Object.assign(app, { folders: [], filter: 'all', engine: 'folders' }); // recent folders, kind filter (settings.recentFilter), search engine that answered
  shell.getSettings().then((s) => { app.settings = s; if (FILTERS.some((f) => f[0] === s.recentFilter)) { app.filter = s.recentFilter; drawFilter(); renderRecent(); } }).catch(() => {});
  let lastOpenDialog = 0;
  function openDialog() {
    if (Date.now() - lastOpenDialog < 600) return;
    lastOpenDialog = Date.now();
    shell.openDialog();
  }
  async function openPdfCard() {
    const paths = await shell.pdf('pick', { type: 'pdf', multi: true });
    if (paths && paths.length) shell.openPaths(paths);
  }

  function renderHome() {
    const now = new Date();
    const hr = now.getHours();
    const greet = hr < 5 ? 'working late' : hr < 12 ? 'good morning' : hr < 18 ? 'good afternoon' : 'good evening';
    const yy = String(now.getFullYear()).slice(2);
    const page = pageShell(greet, 'Home — ' + dateLabel(now, true), 'Pick up where you left off.',
      h('button', { class: 'key', type: 'button', 'aria-label': 'Open a file', onclick: openDialog },
        h('img', { class: 'key-play', src: 'assets/ui/play.png', alt: '' }), h('span', { class: 'key-text', text: 'Open file' }), h('kbd', { text: 'Ctrl O' })),
      [h('div', { class: 'works' }, h('span', { text: 'selected' }), h('span', { text: 'ambient' }), h('span', { text: 'works ' + yy })),
        h('ol', { class: 'tracks' }, ['document', 'spreadsheet', 'presentation', 'pdf'].map((t, i) => h('li', {}, h('b', { text: String(i + 1).padStart(2, '0') }), t))),
        h('div', { class: 'collage' }, h('i', { class: 'ph ph-a' }), h('i', { class: 'ph ph-b' })),
        h('div', { class: 'cat' }, h('span', { text: 'KRK-' + yy + '01 · AMB' }), barcode())]);

    let cat = 0;
    const card = (kind, sub, fn) => h('button', { class: 'card-btn', type: 'button', style: { '--kc': KINDS[kind].color }, 'aria-label': sub.aria, onclick: fn },
      h('span', { class: 'card-top' }, h('span', { class: 'tile' }, h('img', { src: KINDS[kind].icon, alt: '' })), h('span', { class: 'ext', text: KINDS[kind].ext.toLowerCase() })),
      h('span', { class: 'card-text' }, h('strong', { text: sub.title }), h('small', { text: sub.note })),
      h('span', { class: 'card-foot', 'aria-hidden': 'true' }, barcode('sm'), h('span', { class: 'cat-no', text: 'KRK-00' + ++cat }), h('span', { class: 'go' }, svg('arrow'))));
    page.append(sectHead('01', 'New'));
    page.append(h('div', { class: 'create' },
      card('word', { title: 'New document', note: 'Word processor', aria: 'New document' }, () => shell.newDoc('word')),
      card('cell', { title: 'New spreadsheet', note: 'Tables and formulas', aria: 'New spreadsheet' }, () => shell.newDoc('cell')),
      card('slide', { title: 'New presentation', note: 'Slides', aria: 'New presentation' }, () => shell.newDoc('slide')),
      card('pdf', { title: 'Open PDF', note: 'Read and annotate', aria: 'Open PDF' }, openPdfCard)));

    const search = h('input', { type: 'search', placeholder: 'Search recent files', 'aria-label': 'Search recent files', value: app.query,
      oninput: (e) => { app.query = e.target.value; renderRecent(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); } });
    const clearSlot = h('span', { id: 'clear-slot' });
    page.append(h('div', { class: 'sect-gap' }));
    page.append(sectHead('02', 'Recent', h('label', { class: 'search' }, svg('search'), search), h('span', { id: 'filter-slot' }), clearSlot));
    page.append(h('div', { id: 'recent' }));
    app.stagger = true; // first rows rendered on this page stagger in
    drawFilter();
    renderClear();
    renderRecent();
  }

  // Recent kind filter: small segmented control, remembered in settings (recentFilter).
  const FILTERS = [['all', 'All'], ['word', 'Docs'], ['cell', 'Sheets'], ['slide', 'Slides'], ['pdf', 'PDF']];
  function drawFilter() {
    const slot = $('#filter-slot');
    if (!slot) return;
    slot.textContent = '';
    const f = segmented('Filter recent files by type', FILTERS, app.filter, (v) => {
      app.filter = v;
      drawFilter();
      renderRecent();
      shell.setSettings({ recentFilter: v }).then((s) => { app.settings = s; }).catch(() => {});
    });
    f.classList.add('sm');
    slot.append(f);
  }

  function renderClear() {
    const slot = $('#clear-slot');
    if (!slot) return;
    slot.textContent = '';
    const hasUnpinned = app.recent.some((r) => !r.pinned) || app.folders.some((f) => !f.pinned);
    if (app.confirmClear) {
      slot.append(h('span', { class: 'confirm' }, 'Remove unpinned files and folders from the list?',
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => { app.confirmClear = false; await shell.clearRecent(); loadRecent(); } }, 'Clear'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { app.confirmClear = false; renderClear(); } }, 'Cancel')));
    } else if (hasUnpinned) {
      slot.append(h('button', { class: 'btn small ghost mono', type: 'button', onclick: () => { app.confirmClear = true; renderClear(); } }, 'Clear list'));
    }
  }

  const trk = (i) => h('span', { class: 'trk', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') });
  function recentRow(r, i) {
    const k = KINDS[r.kind] || KINDS.word;
    const open = () => shell.openPaths([r.path]);
    return h('div', { class: 'row' + (r.exists ? '' : ' missing'), role: 'listitem', style: { '--kc': k.color } },
      h('button', { class: 'row-main', type: 'button', disabled: !r.exists, title: r.path, 'aria-label': r.exists ? 'Open ' + r.name : r.name + ' (file not found)', onclick: open },
        trk(i),
        h('img', { src: k.icon, alt: '' }),
        h('span', { class: 'name', text: r.name }),
        h('span', { class: 'folder' }, h('bdi', { text: dirOf(r.path) })),
        h('span', { class: 'when', text: r.exists ? relTime(r.openedAt) : 'Not found' })),
      h('span', { class: 'acts' },
        h('button', { class: 'act' + (r.pinned ? ' on' : ''), type: 'button', 'aria-label': r.pinned ? 'Unpin ' + r.name : 'Pin ' + r.name, 'aria-pressed': String(r.pinned), title: r.pinned ? 'Unpin' : 'Pin to top',
          onclick: async () => { await shell.pinRecent(r.path, !r.pinned); loadRecent(); } }, svg('star')),
        h('button', { class: 'act', type: 'button', disabled: !r.exists, 'aria-label': 'Show ' + r.name + ' in folder', title: 'Show in folder', onclick: () => shell.showInFolder(r.path) }, svg('folder')),
        h('button', { class: 'act', type: 'button', 'aria-label': 'Remove ' + r.name + ' from list', title: 'Remove from list',
          onclick: async () => { await shell.removeRecent(r.path); loadRecent(); } }, svg('x'))));
  }

  // Recent files = departure board: header row, hairline-separated rows.
  function renderRecent() {
    const box = $('#recent');
    if (!box) return;
    box.textContent = '';
    const q = app.query.trim().toLowerCase();
    const byKind = (r) => app.filter === 'all' || r.kind === app.filter;
    const mine = app.recent.filter(byKind);
    const items = q ? mine.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : mine;
    const found = q ? app.found.filter((f) => byKind(f) && !app.recent.some((r) => r.path.toLowerCase() === f.path.toLowerCase())) : [];
    // folders: with a kind filter only those holding a matching recent file; "n files" counts the matching ones
    const dkey = (p) => p.replace(/[\\/]+$/, '').toLowerCase();
    const counts = new Map();
    for (const r of mine) counts.set(dkey(dirOf(r.path)), (counts.get(dkey(dirOf(r.path))) || 0) + 1);
    const folders = app.folders.map((f) => ({ ...f, count: counts.get(dkey(f.path)) || 0 }))
      .filter((f) => (app.filter === 'all' || f.count) && (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)));
    if (!app.recent.length && !app.folders.length && !q) {
      box.append(h('div', { class: 'empty' },
        h('div', { class: 'disc', 'aria-hidden': 'true' }),
        h('h3', {}, paren('('), 'nothing here yet', paren(')')),
        h('p', { text: 'Drop files anywhere, or start something new above.' }),
        h('span', { class: 'label', text: '00 tracks · 00:00' })));
      return;
    }
    if (!items.length && !found.length && !folders.length) {
      box.append(h('div', { class: 'empty small' }, h('div', { class: 'disc mini', 'aria-hidden': 'true' }),
        h('h3', {}, paren('('), 'no match', paren(')')),
        h('p', { text: q ? 'No files match “' + app.query.trim() + '”' : 'No recent files of this type yet.' }),
        h('span', { class: 'label', text: '00 tracks' })));
      return;
    }
    const pinned = items.filter((r) => r.pinned), rest = items.filter((r) => !r.pinned);
    // tracklist: pinned = side a, recent = side b, recent folders = side c, disk search hits = bonus
    const sides = (pinned.length && rest.length) || folders.length; // label side a/b once there is more than one group
    const group = (side, label, arr, mk, always, note) => arr.length && [
      always || sides ? h('div', { class: 'group-label' }, h('span', { class: 'side', text: side }), label,
        note ? h('span', { class: 'engine', title: 'Search engine that answered', text: note }) : null) : null,
      h('div', { class: 'list', role: 'list', 'aria-label': label }, arr.map(mk)),
    ];
    const head = h('div', { class: 'board-head', 'aria-hidden': 'true' },
      h('div', { class: 'cols' }, h('span', { text: 'No.' }), h('span'), h('span', { text: 'Title' }), h('span', { text: 'Location' }), h('span', { text: 'Opened' })),
      h('span', { class: 'acts-spacer' }));
    box.append(h('div', { class: 'board' }, head,
      ...[group('side a', 'Pinned', pinned, recentRow), group('side b', 'Recent', rest, recentRow), group('side c', 'Folders', folders, folderRow, true),
        group('bonus', 'On this PC', found, foundRow, true, app.engine)].flat(Infinity).filter(Boolean)));
    if (app.stagger && !reduced.matches) { // 30ms apart, capped at 300ms total
      app.stagger = false;
      box.querySelectorAll('.row').forEach((r, i) => { r.style.setProperty('--d', Math.min(i * 30, 300) + 'ms'); r.classList.add('rise'); });
    }
  }

  // A recent folder: click opens the system Open dialog there.
  function folderRow(f, i) {
    const act = (cls, label, title, icon, fn) => h('button', { class: cls, type: 'button', 'aria-label': label, title, onclick: fn }, svg(icon));
    return h('div', { class: 'row folder-row' + (f.exists ? '' : ' missing'), role: 'listitem', style: { '--kc': 'var(--aqua-ink)' } },
      h('button', { class: 'row-main', type: 'button', disabled: !f.exists, title: f.path,
        'aria-label': f.exists ? 'Open a file from ' + f.name : f.name + ' (folder not found)', onclick: () => shell.openDialogAt(f.path) },
      trk(i),
      h('span', { class: 'ftile', 'aria-hidden': 'true' }, svg('folder')),
      h('span', { class: 'name' }, f.name, f.count ? h('small', { class: 'cnt', text: plural(f.count, 'file') }) : null),
      h('span', { class: 'folder' }, h('bdi', { text: f.path })),
      h('span', { class: 'when', text: f.exists ? relTime(f.openedAt) : 'Not found' })),
      h('span', { class: 'acts' },
        h('button', { class: 'act' + (f.pinned ? ' on' : ''), type: 'button', 'aria-label': (f.pinned ? 'Unpin ' : 'Pin ') + f.name, 'aria-pressed': String(f.pinned), title: f.pinned ? 'Unpin' : 'Pin to top',
          onclick: async () => { await shell.pinRecentFolder(f.path, !f.pinned); loadRecent(); } }, svg('star')),
        act('act', 'Remove ' + f.name + ' from list', 'Remove from list', 'x', async () => { await shell.removeRecentFolder(f.path); loadRecent(); })));
  }

  function foundRow(f, i) {
    const k = KINDS[f.kind] || KINDS.word;
    return h('div', { class: 'row', role: 'listitem', style: { '--kc': k.color } },
      h('button', { class: 'row-main', type: 'button', title: f.path, 'aria-label': 'Open ' + f.name, onclick: () => shell.openPaths([f.path]) },
        trk(i),
        h('img', { src: k.icon, alt: '' }),
        h('span', { class: 'name', text: f.name }),
        h('span', { class: 'folder' }, h('bdi', { text: dirOf(f.path) })),
        h('span', { class: 'when', text: 'On disk' })),
      h('span', { class: 'acts' },
        h('button', { class: 'act', type: 'button', 'aria-label': 'Show ' + f.name + ' in folder', title: 'Show in folder', onclick: () => shell.showInFolder(f.path) }, svg('folder'))));
  }

  // Name search over Documents / Desktop / Downloads (main/search.js). searchSeq drops answers to older queries.
  async function runSearch() {
    const seq = ++searchSeq;
    const q = app.query.trim();
    let res = { engine: 'folders', hits: [] };
    if (q.length >= 2) { try { res = await shell.searchFiles(q); } catch (_) { /* keep empty */ } }
    if (seq !== searchSeq) return;
    app.found = (res && res.hits) || [];
    app.engine = (res && res.engine) || 'folders';
    renderRecent();
  }

  async function loadRecent() {
    try { app.recent = await shell.getRecent(); } catch (_) { app.recent = []; }
    try { app.folders = await shell.getRecentFolders(); } catch (_) { app.folders = []; }
    renderClear();
    renderRecent();
  }
  setInterval(() => { if (app.page === 'home') renderRecent(); }, 60e3);

  // ---------- pdf tools ----------
  const TOOLS = [
    { id: 'merge', title: 'Merge PDFs', note: 'Combine several files into one', icon: 'merge', multi: true, run: 'Merge', tag: 'combine', kc: 'var(--aqua)' },
    { id: 'split', title: 'Split PDF', note: 'Every page, or by ranges', icon: 'split', run: 'Split', tag: 'divide', kc: 'var(--c-cell)' },
    { id: 'extract', title: 'Extract pages', note: 'Keep only the pages you pick', icon: 'extract', ranges: true, run: 'Extract', tag: 'keep', kc: 'var(--c-slide)' },
    { id: 'delete', title: 'Delete pages', note: 'Remove pages you do not need', icon: 'trash', ranges: true, run: 'Delete pages', tag: 'remove', kc: 'var(--c-pdf)' },
    { id: 'rotate', title: 'Rotate pages', note: 'Turn all or some pages', icon: 'rotate', run: 'Rotate', tag: 'turn', kc: 'var(--c-word)' },
    { id: 'images', title: 'Images to PDF', note: 'PNG and JPG, one per page', icon: 'images', multi: true, image: true, run: 'Create PDF', tag: 'compose', kc: 'var(--aqua-ink)' },
  ];
  let tool = null; // { def, files:[{path,pages,error}], ranges, degrees, mode, busy, result }

  function renderPdf() {
    const page = pageShell('pdf tools', 'PDF Tools — six tracks', 'Merge, split, extract and rotate.', null,
      miniDeco('side a · 06 tracks', ['merge', 'split', 'extract', 'delete pages', 'rotate', 'images to pdf'], 'KRK-' + String(new Date().getFullYear()).slice(2) + '02 · PDF'));
    page.append(sectHead('01', 'Tools'));
    page.append(h('div', { class: 'tools', id: 'toolgrid' }));
    page.append(h('div', { class: 'sect-gap' }));
    page.append(sectHead('02', 'Workbench'));
    page.append(h('div', { id: 'toolpanel' }));
    renderToolGrid();
    renderPanel();
  }
  function renderToolGrid() {
    const g = $('#toolgrid');
    if (!g) return;
    g.textContent = '';
    TOOLS.forEach((t, i) => {
      g.append(h('button', { class: 'card-btn', type: 'button', style: { '--kc': t.kc }, 'aria-pressed': String(!!tool && tool.def.id === t.id), 'aria-label': t.title,
        onclick: () => { if (busy()) return; tool = { def: t, files: [], ranges: '', degrees: 90, mode: 'each', busy: false, result: null }; renderToolGrid(); renderPanel(); } },
      h('span', { class: 'card-top' }, h('span', { class: 'tile' }, h('img', { src: 'assets/tools/' + t.id + '.png', alt: '', draggable: 'false' })),
        h('span', { class: 'card-meta' }, h('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }), h('span', { class: 'ext', text: t.tag }))),
      h('span', { class: 'card-text' }, h('strong', { text: t.title }), h('small', { text: t.note })),
      h('span', { class: 'card-foot', 'aria-hidden': 'true' }, barcode('sm'), h('span', { class: 'cat-no', text: 'KRK-P0' + (i + 1) }), h('span', { class: 'go' }, svg('arrow')))));
    });
  }
  const busy = () => !!(tool && tool.busy);

  async function pickInto(append) {
    const d = tool.def;
    const paths = await shell.pdf('pick', { type: d.image ? 'image' : 'pdf', multi: !!d.multi });
    if (!paths || !paths.length) return;
    const fresh = paths.map((p) => ({ path: p, pages: null, error: null }));
    tool.files = d.multi && append ? tool.files.concat(fresh) : fresh;
    tool.result = null;
    renderPanel();
    if (!d.image) {
      for (const f of fresh) {
        const r = await shell.pdf('info', { path: f.path });
        if (r && r.error) f.error = r.error; else f.pages = r && r.pages;
        if (tool) renderPanel();
      }
    }
  }

  function fileRow(f, i, n) {
    const d = tool.def;
    const multi = !!d.multi;
    const meta = f.error ? h('span', { class: 'bad', text: f.error }) : h('span', { text: dirOf(f.path) });
    const pg = f.error ? '' : f.pages != null ? plural(f.pages, 'page') : d.image ? (baseOf(f.path).split('.').pop() || '') : '…';
    return h('div', { class: 'file' },
      h('span', { class: 'no', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
      d.image ? svg('images') : h('img', { src: KINDS.pdf.icon, alt: '' }),
      h('div', { class: 'meta', title: f.path }, h('b', { text: baseOf(f.path) }), meta),
      h('i', { class: 'lead', 'aria-hidden': 'true' }),
      h('span', { class: 'pg', text: pg }),
      multi ? [
        h('button', { class: 'act', type: 'button', disabled: i === 0 || tool.busy, 'aria-label': 'Move ' + baseOf(f.path) + ' up', onclick: () => { move(i, -1); } }, svg('up')),
        h('button', { class: 'act', type: 'button', disabled: i === n - 1 || tool.busy, 'aria-label': 'Move ' + baseOf(f.path) + ' down', onclick: () => { move(i, 1); } }, svg('down')),
        h('button', { class: 'act', type: 'button', disabled: tool.busy, 'aria-label': 'Remove ' + baseOf(f.path), onclick: () => { tool.files.splice(i, 1); tool.result = null; renderPanel(); } }, svg('x')),
      ] : null);
  }
  function move(i, dir) {
    const a = tool.files, j = i + dir;
    [a[i], a[j]] = [a[j], a[i]];
    renderPanel();
  }

  const segmented = (label, options, value, onPick, disabled) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', role: 'radio', disabled, 'aria-checked': String(v === value), tabindex: v === value ? '0' : '-1', onclick: () => onPick(v),
      onkeydown: (e) => {
        if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
        e.preventDefault();
        const i = options.findIndex((o) => o[0] === value), step = /Right|Down/.test(e.key) ? 1 : -1;
        onPick(options[(i + step + options.length) % options.length][0]);
        requestAnimationFrame(() => { const c = e.target.closest('.seg'); (c && c.querySelector('[aria-checked="true"]') || { focus() {} }).focus(); });
      } }, text)));

  function renderPanel() {
    const box = $('#toolpanel');
    if (!box) return;
    box.textContent = '';
    if (!tool) {
      box.append(h('div', { class: 'panel idle' }, h('div', { class: 'disc', 'aria-hidden': 'true' }),
        h('div', {}, h('h3', {}, paren('('), 'no tool picked', paren(')')), h('p', { class: 'sub', text: 'Choose a tool above to get started.' }))));
      return;
    }
    const d = tool.def, files = tool.files, b = tool.busy;
    const needsRanges = d.ranges || (d.id === 'split' && tool.mode === 'ranges');
    const no = String(TOOLS.indexOf(d) + 1).padStart(2, '0');
    const p = h('div', { class: 'panel' }, h('div', { class: 'panel-head' },
      h('div', {}, h('h2', {}, paren('('), d.title, paren(')')), h('div', { class: 'sub', text: d.note })),
      h('div', { class: 'panel-cat', 'aria-hidden': 'true' }, h('span', { text: 'KRK-P0' + no }), barcode())));

    const pickLabel = d.image ? 'Choose images…' : d.multi ? 'Choose PDFs…' : files.length ? 'Choose a different PDF…' : 'Choose a PDF…';
    p.append(h('div', { class: 'field' },
      h('span', { class: 'lbl', text: d.image ? 'Images' : d.multi ? 'PDF files (merged top to bottom)' : 'PDF file' }),
      h('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
        h('button', { class: 'btn', type: 'button', disabled: b, onclick: () => pickInto(false) }, svg('folder'), pickLabel),
        d.multi && files.length ? h('button', { class: 'btn', type: 'button', disabled: b, onclick: () => pickInto(true) }, svg('plus'), 'Add more') : null),
      files.length ? h('div', { class: 'files', role: 'list' }, files.map((f, i) => fileRow(f, i, files.length))) : null));

    if (d.id === 'split') {
      p.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Split into' }),
        segmented('Split mode', [['each', 'One file per page'], ['ranges', 'By page ranges']], tool.mode, (v) => { tool.mode = v; renderPanel(); }, b)));
    }
    if (d.id === 'rotate') {
      p.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Rotate clockwise by' }),
        segmented('Degrees', [[90, '90°'], [180, '180°'], [270, '270°']], tool.degrees, (v) => { tool.degrees = v; renderPanel(); }, b)));
    }
    if (needsRanges || d.id === 'rotate') {
      const lbl = d.id === 'extract' ? 'Pages to extract' : d.id === 'delete' ? 'Pages to delete' : d.id === 'split' ? 'Page ranges' : 'Pages (optional)';
      const hint = d.id === 'split' ? 'Each comma-separated group becomes its own file, e.g. 1-3, 5, 8-'
        : d.id === 'rotate' ? 'e.g. 1-3, 5, 8-  —  leave empty to rotate every page' : 'e.g. 1-3, 5, 8-';
      p.append(h('div', { class: 'field' }, h('label', { for: 'ranges', text: lbl }),
        h('input', { class: 'text', id: 'ranges', type: 'text', value: tool.ranges, disabled: b, autocomplete: 'off', spellcheck: 'false', placeholder: '1-3, 5, 8-',
          oninput: (e) => { tool.ranges = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') run(); } }),
        h('div', { class: 'hint', text: hint })));
    }

    const ready = files.length >= (d.multi && !d.image ? 2 : 1) && files.every((f) => !f.error);
    p.append(h('div', { class: 'runbar' },
      h('button', { class: 'key run' + (b ? ' busy' : ''), type: 'button', disabled: b || !ready, onclick: run },
        b ? h('span', { class: 'key-play wait' }, h('span', { class: 'spin' })) : h('img', { class: 'key-play', src: 'assets/ui/play.png', alt: '' }),
        h('span', { class: 'key-text', text: b ? 'Working…' : d.run })),
      !ready && d.id === 'merge' && files.length === 1 ? h('span', { class: 'hint', text: 'Add at least one more PDF.' }) : null));

    const r = tool.result;
    if (r && r.ok) {
      const out = [].concat(r.output);
      const folder = Array.isArray(r.output);
      p.append(h('div', { class: 'result ok', role: 'status' }, h('span', { class: 'tag', text: 'Saved' }),
        h('div', { class: 'msg' }, folder ? plural(out.length, 'file') + ' saved' : 'Saved ' + baseOf(out[0]), h('small', { text: dirOf(out[0]) })),
        folder ? null : h('button', { class: 'btn small', type: 'button', onclick: () => shell.openPaths([out[0]]) }, 'Open'),
        h('button', { class: 'btn small', type: 'button', onclick: () => shell.showInFolder(out[0]) }, 'Show in folder')));
    } else if (r && r.error) {
      p.append(h('div', { class: 'result err', role: 'alert' }, h('span', { class: 'tag', text: 'Error' }), h('div', { class: 'msg', text: r.error })));
    }
    box.append(p);
  }

  async function run() {
    if (!tool || tool.busy) return;
    const d = tool.def, paths = tool.files.map((f) => f.path);
    if (!paths.length || tool.files.some((f) => f.error)) return;
    if (d.id === 'merge' && paths.length < 2) return;
    const args = d.multi ? { paths } : { path: paths[0] };
    if (d.id === 'split') { args.mode = tool.mode; if (tool.mode === 'ranges') args.ranges = tool.ranges; }
    if (d.ranges) args.ranges = tool.ranges;
    if (d.id === 'rotate') { args.degrees = tool.degrees; args.ranges = tool.ranges; }
    const mine = tool;
    mine.busy = true; mine.result = null;
    renderPanel();
    try { mine.result = await shell.pdf(d.id, args); }
    catch (e) { mine.result = { ok: false, error: 'Something went wrong: ' + ((e && e.message) || e) }; }
    mine.busy = false;
    if (mine.result && mine.result.cancelled) mine.result = null; // cancelled = quiet
    if (tool === mine) renderPanel();
  }

  // ---------- settings ----------
  const LANGS = [
    ['en', 'English'], ['ar', 'العربية'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['pt', 'Português'], ['ru', 'Русский'],
    ['tr', 'Türkçe'], ['zh', '中文 (简体)'],
  ]; // every code has a documenteditor/main/locale/<code>.json (checked)

  async function renderSettings() {
    const page = pageShell('settings', 'Settings — liner notes', 'Make Kiroku feel right.', null,
      miniDeco('side b · 06 tracks', ['appearance', 'editors', 'default apps', 'privacy', 'backups', 'about'],'KRK-' + String(new Date().getFullYear()).slice(2) + '03 · SET'));
    let s = app.settings;
    try { s = app.settings = await shell.getSettings(); } catch (_) { /* keep cached */ }
    s = s || { theme: 'system', language: 'en' };
    if (app.page !== 'settings') return;

    const themeBox = h('div', { class: 'field' });
    const drawTheme = () => {
      themeBox.textContent = '';
      themeBox.append(h('span', { class: 'lbl', text: 'Theme' }),
        segmented('Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme,
          async (v) => { s.theme = v; drawTheme(); app.settings = await shell.setSettings({ theme: v }); }));
    };
    drawTheme();

    // Privacy: keep the recent list (paths of files + folders) encrypted with Windows secure storage
    const encBox = h('div', { class: 'field' });
    const drawEnc = () => {
      encBox.textContent = '';
      const can = s.canEncryptRecent !== false;
      encBox.append(h('span', { class: 'lbl', text: 'Encrypt recent files list' }),
        segmented('Encrypt recent files list', [[false, 'Off'], [true, 'On']], !!s.encryptRecent && can,
          async (v) => { s = app.settings = await shell.setSettings({ encryptRecent: v }); drawEnc(); }, !can),
        h('div', { class: 'hint', text: can ? 'Stores the paths of recent files and folders encrypted, instead of as readable text.'
          : 'Not available on this PC: Windows secure storage is not ready for this account.' }));
    };
    drawEnc();

    // Backups: autosave switch + how often / how many versions / how long (engine reads these at editor boot and live)
    const bk = () => s.backup || { autosave: true, intervalSec: 60, keepVersions: 3, keepDays: 7 };
    const backupBox = h('div', { class: 'field' });
    const setBk = async (patch) => { s = app.settings = await shell.setSettings({ backup: patch }); drawBackup(); };
    const pick = (id, label, opts, key) => h('div', { class: 'field' }, h('label', { for: id, text: label }),
      h('select', { class: 'text', id, onchange: (e) => setBk({ [key]: Number(e.target.value) }) },
        opts.map(([v, text]) => h('option', { value: String(v), selected: v === bk()[key], text }))));
    const drawBackup = () => {
      backupBox.textContent = '';
      backupBox.append(h('span', { class: 'lbl', text: 'Autosave' }),
        segmented('Autosave', [[false, 'Off'], [true, 'On']], !!bk().autosave, (v) => setBk({ autosave: v })),
        pick('bk-interval', 'Save a copy every', [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [180, '3 minutes']], 'intervalSec'),
        pick('bk-versions', 'Versions kept per document', [[3, '3'], [5, '5'], [10, '10']], 'keepVersions'),
        pick('bk-days', 'Keep copies for', [[1, '1 day'], [7, '7 days'], [30, '30 days']], 'keepDays'),
        h('div', { class: 'hint', text: 'Recovery copies stay on this PC and never replace your file. Open them from Recovered files.' }));
    };
    drawBackup();

    const langs = LANGS.some((l) => l[0] === s.language) ? LANGS : LANGS.concat([[s.language, s.language]]);
    const sel = h('select', { class: 'text', id: 'lang', onchange: async (e) => { s.language = e.target.value; app.settings = await shell.setSettings({ language: e.target.value }); } },
      langs.map(([code, label]) => h('option', { value: code, selected: code === s.language, text: label })));

    // sections, not cards: side label + one muted line on the left, controls on the right
    const row = (n, title, line, ...body) => h('section', { class: 'set-row' },
      h('div', { class: 'set-side' }, h('h2', { class: 'label' }, h('span', { class: 'n', text: n }), title), h('p', { class: 'sub', text: line })),
      h('div', { class: 'set-main' }, ...body));
    page.append(h('div', { class: 'set-list' },
      h('div', { class: 'set-head', 'aria-hidden': 'true' }, h('span', { text: 'Liner notes' }), h('i', { class: 'rule' }), h('span', { text: '06 tracks' })),
      row('01', 'Appearance', 'Follow Windows, or pick a side.', themeBox),
      row('02', 'Editors', 'The language inside your documents.',
        h('div', { class: 'field' }, h('label', { for: 'lang', text: 'Editor language' }), sel,
          h('div', { class: 'hint', text: 'Applies to documents opened after the change.' }))),
      row('03', 'Default apps', 'Let Explorer open files here.',
        h('p', { class: 'body', text: 'Windows will open its Default apps page — click “Set default” at the top to use Kiroku for documents, spreadsheets, presentations and PDFs.' }),
        h('div', { style: { 'margin-top': '14px' } }, h('button', { class: 'btn', type: 'button', onclick: () => shell.openDefaultApps() }, 'Make Kiroku the default'))),
      row('04', 'Privacy', 'Keep your recent list private.', encBox),
      row('05', 'Backups', 'Automatic recovery copies of open documents.', backupBox),
      row('06', 'About', 'Version and licence.',
        h('dl', { class: 'about' },
          h('dt', { text: 'Version' }), h('dd', { text: app.info ? app.info.version : '' }),
          h('dt', { text: 'Editors' }), h('dd', { text: 'Editors built on ONLYOFFICE (AGPL-3.0)' }),
          h('dt', { text: 'Data folder' }), h('dd', { text: app.info ? app.info.userData : '' })))));
  }

  // ---------- drag & drop (whole window) ----------
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const veil = $('#dropveil');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; veil.classList.add('on'); });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) veil.classList.remove('on'); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; veil.classList.remove('on');
    const paths = [...e.dataTransfer.files].map((f) => shell.pathForFile(f)).filter(Boolean);
    if (paths.length) shell.openPaths(paths);
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
  });

  // ---------- boot ----------
  renderNav();
  go('home', true);
  shell.getInfo().then((i) => { app.info = i; }).catch(() => {});
  loadRecent();
  shell.onRecentChanged(loadRecent);
  shell.onState((s) => {
    app.tabs = s.tabs || [];
    app.activeId = s.activeId || 'home';
    syncTabs();
    const vid = $('.hero-vid'); // an editor view covers the shell: don't keep decoding behind it
    if (vid) { if (app.activeId === 'home') vid.play().catch(() => {}); else vid.pause(); }
    if (app.activeId === 'home' && lastActive !== 'home') loadRecent();
    if (app.activeId === 'home' && lastActive && lastActive !== 'home') enterPage();
    lastActive = app.activeId;
  });
})();
