/* Porta-Pola: the frame is the viewfinder.
 * The live camera shows inside the frame's next empty photo window, filtered; the shutter (or a
 * timer) drops the shot in and moves on to the next window. Save exports the finished frame.
 */
(function () {
  'use strict';

  const PP = window.PP;
  const R = PP.render, F = PP.filters, cam = PP.camera;

  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const el = {
    modes: $('#modes'), layouts: $('#layouts'), stage: $('#stage'), canvas: $('#frameCv'), status: $('#status'), count: $('#count'),
    hint: $('#hint'), filters: $('#filters'), caption: $('#caption'), swatches: $('#swatches'), swStamp: $('#swStamp'), swMirror: $('#swMirror'),
    btnTimer: $('#btnTimer'), btnFlip: $('#btnFlip'), ctlFlip: $('#ctlFlip'), btnShutter: $('#btnShutter'), shutterLabel: $('#shutterLabel'),
    btnReset: $('#btnReset'), ctlReset: $('#ctlReset'), btnSave: $('#btnSave'), ctlSave: $('#ctlSave'),
    flash: $('#flash'), toast: $('#toast'), live: $('#live'),
  };

  const ICONS = {
    flip: '<path d="M20 7h-9a5 5 0 0 0-5 5v1"/><path d="m17 4 3 3-3 3"/><path d="M4 17h9a5 5 0 0 0 5-5v-1"/><path d="m7 20-3-3 3-3"/>',
    redo: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4l2.5 1.5"/><path d="M9.5 3h5"/>',
    save: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  };
  const icon = (name) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TIMERS = [0, 3, 5, 10];
  const EXPORT_SCALE = { polaroid: 1.5, strip4: 2, strip3: 2, grid4: 1.5 };

  /* ───────────── state ───────────── */

  function loadPrefs() { try { return JSON.parse(localStorage.getItem('pp.prefs')) || {}; } catch (e) { return {}; } }
  function savePrefs() {
    try { localStorage.setItem('pp.prefs', JSON.stringify({ filter: state.filter, timer: state.timer, stamp: state.stamp })); } catch (e) { /* storage blocked */ }
  }
  const prefs = loadPrefs();

  const state = {
    mode: 'polaroid', layout: 'strip4', frame: 'white', caption: '', mirror: true,
    filter: F.get(prefs.filter).id, timer: TIMERS.includes(prefs.timer) ? prefs.timer : 0, stamp: !!prefs.stamp, date: new Date(),
    facing: 'user', facingKnown: false, deviceId: null, lastFacing: null, canFlip: false,
    cam: 'idle',      // idle | starting | live | error
    camErr: null,
    shots: [],        // one entry per photo window; null until taken
    active: 0,        // window the camera is showing in, or null when the frame is full
    running: false,   // a timer countdown is in progress
    cancel: false,
  };
  let shotId = 0;

  const layoutId = () => (state.mode === 'polaroid' ? 'polaroid' : state.layout);
  const geo = () => R.geometry(layoutId());

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }
  function announce(msg) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); }

  /* ───────────── drawing ───────────── */

  const liveCv = document.createElement('canvas');   // the filtered camera feed, drawn into the active window
  let raf = 0, lastDraw = 0, lastThumbs = 0, needsDraw = true, prewarmTimer = 0;

  function requestDraw() {
    needsDraw = true;
    clearTimeout(prewarmTimer);
    if (state.active === null) prewarmTimer = setTimeout(() => exportBlob().catch(() => {}), 700); // so Save feels instant
  }

  function cover(sw, sh, aspect) {
    let cw, ch;
    if (sw / sh > aspect) { ch = sh; cw = sh * aspect; } else { cw = sw; ch = sw / aspect; }
    return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, cw, ch };
  }

  function paintLive(g) {
    const v = cam.video;
    if (!v.videoWidth) return false;
    const long = state.filter === 'orig' ? 720 : 480;
    const w = g.aspect >= 1 ? long : Math.round(long * g.aspect);
    const h = g.aspect >= 1 ? Math.round(long / g.aspect) : long;
    if (liveCv.width !== w || liveCv.height !== h) { liveCv.width = w; liveCv.height = h; }
    const ctx = liveCv.getContext('2d', { willReadFrequently: true });
    const c = cover(v.videoWidth, v.videoHeight, g.aspect);
    ctx.save();
    if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, c.sx, c.sy, c.cw, c.ch, 0, 0, w, h);
    ctx.restore();
    F.apply(liveCv, state.filter);
    return true;
  }

  function design(live) {
    return {
      layout: layoutId(), shots: state.shots, frame: state.frame, caption: state.caption,
      filter: state.filter, stamp: state.stamp, date: state.date, live: live || null,
    };
  }

  function draw() {
    const g = geo();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = el.canvas.clientWidth || 320;
    const scale = Math.min(cssW * dpr / g.W, Math.sqrt(1.6e6 / (g.W * g.H))); // strips are tall: keep the pixel count sane
    const live = state.cam === 'live' && state.active !== null && paintLive(g) ? { slot: state.active, source: liveCv } : null;
    R.compose(design(live), scale, el.canvas);
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const live = state.cam === 'live' && state.active !== null;
    if (!live && !needsDraw) return;
    if (live && t - lastDraw < (state.filter === 'orig' ? 33 : 42)) return;
    lastDraw = t; needsDraw = false;
    draw();
    if (live && t - lastThumbs > 1000) { lastThumbs = t; paintChips(cam.video, state.mirror); }
  }

  /* ───────────── filter chips ───────────── */

  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 88;

  function buildChips() {
    el.filters.innerHTML = '';
    F.list.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.id = f.id; b.setAttribute('aria-pressed', 'false');
      const c = document.createElement('canvas'); c.width = c.height = 88;
      const s = document.createElement('span'); s.textContent = f.name;
      b.append(c, s);
      b.addEventListener('click', () => setFilter(f.id));
      el.filters.append(b);
    });
  }

  function drawSample(ctx, s) {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#5aa9ff'); g.addColorStop(0.62, '#ffc48a'); g.addColorStop(1, '#ff7d6b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(s * 0.72, s * 0.28, s * 0.13, 0, 7); ctx.fill();
    ctx.fillStyle = '#2f8f5a'; ctx.beginPath(); ctx.ellipse(s * 0.3, s * 1.02, s * 0.75, s * 0.3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f5c9a0'; ctx.beginPath(); ctx.arc(s * 0.5, s * 0.55, s * 0.16, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b2f6b'; ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.98, s * 0.28, s * 0.3, 0, 0, 7); ctx.fill();
  }

  /** Repaint each chip's thumbnail from the camera (or a sample scene when there is none). */
  function paintChips(src, mirror) {
    const sctx = scratch.getContext('2d');
    const sw = src && (src.videoWidth || src.width), sh = src && (src.videoHeight || src.height);
    if (sw && sh) {
      const c = cover(sw, sh, 1);
      sctx.save();
      if (mirror) { sctx.translate(88, 0); sctx.scale(-1, 1); }
      sctx.drawImage(src, c.sx, c.sy, c.cw, c.ch, 0, 0, 88, 88);
      sctx.restore();
    } else drawSample(sctx, 88);
    el.filters.querySelectorAll('.chip').forEach(b => {
      const c = b.querySelector('canvas');
      c.getContext('2d', { willReadFrequently: true }).drawImage(scratch, 0, 0);
      F.apply(c, b.dataset.id, { grain: false });
    });
  }

  function setFilter(id) {
    state.filter = id;
    savePrefs(); syncUI(); requestDraw();
  }

  /* ───────────── camera ───────────── */

  const CAM_MSG = {
    denied: ['Camera is blocked', 'Allow camera access for this site in your browser settings, then try again.'],
    none: ['No camera found', 'Connect a camera, then try again.'],
    busy: ['Camera is busy', 'Close other apps that use the camera, then try again.'],
    insecure: ['Camera needs a secure page', 'Open Porta-Pola over https or on localhost to use the camera.'],
    unsupported: ['Camera not supported', 'This browser cannot open a camera. Try Chrome, Safari or Firefox.'],
    error: ['Camera could not start', 'Try again in a moment.'],
  };

  function syncStatus() {
    const s = el.status;
    if (state.cam === 'starting') {
      s.hidden = false;
      s.innerHTML = '<h3>Starting camera</h3><p>Allow camera access if your browser asks.</p>';
    } else if (state.cam === 'error') {
      const code = state.camErr && state.camErr.code;
      const m = CAM_MSG[code] || CAM_MSG.error;
      s.hidden = false;
      s.innerHTML = '<h3></h3><p></p><div class="row"></div>';
      s.querySelector('h3').textContent = m[0];
      s.querySelector('p').textContent = m[1];
      if (code !== 'insecure' && code !== 'unsupported') {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = 'Try again';
        b.addEventListener('click', () => startCamera());
        s.querySelector('.row').append(b);
      }
    } else s.hidden = true;
  }

  async function startCamera(opts) {
    state.cam = 'starting'; syncStatus(); syncUI();
    try {
      const info = await cam.start(opts || { facing: state.facing, deviceId: state.deviceId });
      state.facing = info.facing; state.facingKnown = info.facingKnown; state.deviceId = info.deviceId || null;
      if (info.facing !== state.lastFacing) { // selfie view mirrors, the rear camera doesn't
        state.lastFacing = info.facing;
        state.mirror = info.facing !== 'environment';
      }
      state.cam = 'live'; state.camErr = null;
      state.canFlip = (await cam.videoInputs()).length > 1;
    } catch (err) {
      if (err && err.code === 'superseded') return;
      state.cam = 'error'; state.camErr = err; state.canFlip = false;
    }
    syncStatus(); syncUI(); requestDraw();
  }

  async function flipCamera() {
    if (state.cam === 'starting' || state.running) return;
    if (state.facingKnown) return startCamera({ facing: state.facing === 'user' ? 'environment' : 'user' });
    const inputs = await cam.videoInputs();
    if (inputs.length < 2) return;
    const i = inputs.findIndex(d => d.deviceId === state.deviceId);
    startCamera({ deviceId: inputs[(i + 1) % inputs.length].deviceId });
  }

  /* ───────────── taking photos ───────────── */

  function resetShots() {
    state.shots = new Array(geo().n).fill(null);
    state.active = 0;
  }

  function flashScreen() {
    if (reduced() || !el.flash.animate) return;
    el.flash.animate([{ opacity: 0 }, { opacity: 0.95, offset: 0.1 }, { opacity: 0 }], { duration: 450, easing: 'ease-out' });
  }

  function scrollToActive() {
    const g = geo();
    if (g.n < 2 || state.active === null) return;
    const s = g.slots[state.active], r = el.canvas.getBoundingClientRect();
    const y = r.top + window.scrollY + (s.y + s.h / 2) / g.H * r.height;
    window.scrollTo({ top: Math.max(0, y - window.innerHeight * 0.35), behavior: reduced() ? 'auto' : 'smooth' });
  }

  /** Grab the current camera frame into the active window. */
  function snapNow() {
    if (state.cam !== 'live' || !cam.video.videoWidth) return false;
    const shot = R.makeShot(cam.video, geo().aspect, { mirror: state.mirror, maxSide: 1400 });
    shot.id = ++shotId;
    state.shots[state.active] = shot;
    state.date = new Date();
    flashScreen();
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* unsupported */ }
    const next = state.shots.findIndex(s => !s);
    state.active = next >= 0 ? next : null;
    syncUI(); requestDraw();
    return true;
  }

  function wait(ms) { // resolves false as soon as the run is cancelled
    return new Promise(resolve => {
      const t0 = performance.now();
      (function poll() {
        if (state.cancel) return resolve(false);
        if (performance.now() - t0 >= ms) return resolve(true);
        setTimeout(poll, 40);
      })();
    });
  }

  function showCount(txt) {
    el.count.textContent = txt;
    if (txt && !reduced() && el.count.animate) {
      el.count.animate([
        { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -50%) scale(0.92)', opacity: 0.9 },
      ], { duration: 950, easing: 'ease-out' });
    }
  }

  async function countdown(secs) {
    const g = geo(), s = g.slots[state.active];
    el.count.style.left = ((s.x + s.w / 2) / g.W * 100) + '%';
    el.count.style.top = ((s.y + s.h / 2) / g.H * 100) + '%';
    el.count.style.fontSize = Math.round(s.w / g.W * el.stage.clientWidth * 0.5) + 'px';
    for (let i = secs; i >= 1; i--) {
      showCount(String(i)); announce(String(i));
      if (!(await wait(1000))) { showCount(''); return false; }
    }
    showCount('');
    return true;
  }

  async function onShutter() {
    if (state.running) { state.cancel = true; return; }
    if (state.active === null) { startOver(); return; }   // "Again"
    if (state.cam !== 'live') return;
    if (!state.timer) { snapNow(); if (state.active !== null) scrollToActive(); return; }

    // With a timer, one press runs every remaining window hands-free, like a real photobooth.
    state.running = true; state.cancel = false; syncUI();
    try {
      for (;;) {
        scrollToActive();
        if (!(await countdown(state.timer))) break;
        if (!snapNow() || state.active === null) break;
        if (!(await wait(700))) break;
      }
    } finally {
      state.running = false; state.cancel = false; showCount('');
      syncUI(); requestDraw();
    }
  }

  function startOver() {
    if (state.running) return;
    resetShots();
    syncUI(); requestDraw();
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }

  // tap a finished photo to retake just that one
  el.canvas.addEventListener('click', (e) => {
    if (state.running) return;
    const g = geo(), r = el.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * g.W, y = (e.clientY - r.top) / r.height * g.H;
    const i = g.slots.findIndex(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (i >= 0 && state.shots[i] && state.active !== i) {
      state.active = i;
      syncUI(); requestDraw();
    }
  });

  /* ───────────── save ───────────── */

  let exportCache = { sig: '', blob: null };

  function signature() {
    return [layoutId(), state.frame, state.caption, state.filter, state.stamp, state.shots.map(s => (s ? s.id : 0)).join(',')].join('|');
  }

  async function exportBlob() {
    const sig = signature();
    if (exportCache.blob && exportCache.sig === sig) return exportCache.blob;
    const cv = document.createElement('canvas');
    R.compose(design(null), EXPORT_SCALE[layoutId()], cv);
    const blob = await new Promise((resolve, reject) => {
      cv.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.92);
    });
    exportCache = { sig, blob };
    return blob;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  function fileName() {
    const d = state.date;
    const kind = layoutId() === 'polaroid' ? 'polaroid' : layoutId() === 'grid4' ? 'grid' : 'strip';
    return 'porta-pola-' + kind + '-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.jpg';
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function save() {
    if (state.active !== null || state.running) return;
    el.btnSave.disabled = true;
    try {
      const blob = await exportBlob();
      const name = fileName();
      const file = new File([blob], name, { type: 'image/jpeg' });
      // On a phone the share sheet offers "Save Image" (straight to Photos); elsewhere, download.
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall back to a download */ }
      }
      download(blob, name);
      toast('Saved to your downloads.');
    } catch (e) {
      toast('Could not save the image. Try again.');
    } finally {
      el.btnSave.disabled = false;
    }
  }

  /* ───────────── controls ───────────── */

  function hintText() {
    const g = geo();
    if (state.cam === 'error') return '';
    if (state.running) return g.n === 1 ? 'Get ready…' : 'Photo ' + (state.active + 1) + ' of ' + g.n + '. Get ready…';
    if (state.active === null) return g.n === 1 ? 'Nice. Save it, or tap the photo to retake.' : 'All set. Save it, or tap any photo to retake.';
    if (g.n === 1) return state.shots[0] ? 'Retaking. Tap the shutter.' : 'Line up your shot, then tap the shutter.';
    return 'Photo ' + (state.active + 1) + ' of ' + g.n + '. Tap the shutter.';
  }

  function markPressed(container, attr, value) {
    container.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  function syncUI() {
    const g = geo();
    const full = state.active === null, any = state.shots.some(Boolean), busy = state.running;
    app.dataset.mode = state.mode;
    app.dataset.layout = g.id;
    el.stage.style.setProperty('--ar', g.W / g.H);

    markPressed(el.modes, 'mode', state.mode);
    markPressed(el.layouts, 'layout', state.layout);
    [...el.modes.children, ...el.layouts.children].forEach(b => { b.disabled = busy; });
    el.swatches.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.frame)));
    el.swMirror.setAttribute('aria-checked', String(state.mirror));
    el.swStamp.setAttribute('aria-checked', String(state.stamp));
    el.filters.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.filter)));

    el.shutterLabel.textContent = busy ? 'Stop' : full ? 'Again' : 'Snap';
    el.btnShutter.setAttribute('aria-label', busy ? 'Stop' : full ? 'Start over' : 'Take photo');
    el.btnShutter.dataset.state = busy ? 'stop' : 'go';
    el.btnShutter.disabled = !busy && !full && state.cam !== 'live';

    el.btnTimer.innerHTML = state.timer ? '<b>' + state.timer + 's</b>' : icon('timer');
    el.btnTimer.classList.toggle('on', state.timer > 0);
    el.btnTimer.setAttribute('aria-label', state.timer ? 'Timer ' + state.timer + ' seconds. Tap to change' : 'Timer off. Tap to change');
    el.btnTimer.disabled = busy;

    el.ctlFlip.classList.toggle('is-off', !(state.cam === 'live' && state.canFlip) || busy);
    el.ctlReset.classList.toggle('is-off', busy || !any);
    el.ctlSave.classList.toggle('is-off', !full || busy);
    el.hint.textContent = hintText();
  }

  function changeFrame(mode, layout) {
    if (state.running || (mode === state.mode && layout === state.layout)) return;
    state.mode = mode; state.layout = layout;
    resetShots(); syncUI(); requestDraw();
    window.scrollTo({ top: 0 });
  }

  function buildSwatches() {
    R.PALETTE.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.id = p.id;
      b.style.setProperty('--c', p.paper); b.setAttribute('aria-label', p.name); b.title = p.name;
      b.addEventListener('click', () => { state.frame = p.id; syncUI(); requestDraw(); });
      el.swatches.append(b);
    });
  }

  function wire() {
    el.modes.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) changeFrame(b.dataset.mode, state.layout); });
    el.layouts.addEventListener('click', (e) => { const b = e.target.closest('button[data-layout]'); if (b) changeFrame('booth', b.dataset.layout); });
    el.caption.addEventListener('input', () => { state.caption = el.caption.value; requestDraw(); });
    el.swMirror.addEventListener('click', () => { state.mirror = !state.mirror; syncUI(); requestDraw(); });
    el.swStamp.addEventListener('click', () => { state.stamp = !state.stamp; savePrefs(); syncUI(); requestDraw(); });
    el.btnTimer.addEventListener('click', () => {
      state.timer = TIMERS[(TIMERS.indexOf(state.timer) + 1) % TIMERS.length];
      savePrefs(); syncUI();
    });
    el.btnShutter.addEventListener('click', onShutter);
    el.btnFlip.addEventListener('click', flipCamera);
    el.btnReset.addEventListener('click', startOver);
    el.btnSave.addEventListener('click', save);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/^(INPUT|BUTTON|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); onShutter(); }
    });
    window.addEventListener('resize', requestDraw);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        state.cancel = true;
        cam.stop();
        if (state.cam === 'live' || state.cam === 'starting') state.cam = 'idle';
      } else if (state.cam === 'idle') startCamera();
    });
    window.addEventListener('pagehide', () => cam.stop());
  }

  function init() {
    el.btnFlip.innerHTML = icon('flip');
    el.btnReset.innerHTML = icon('redo');
    el.btnSave.innerHTML = icon('save');
    buildSwatches();
    buildChips();
    paintChips(null, false);
    resetShots();
    syncUI();
    wire();
    R.loadFonts().then(requestDraw);
    raf = requestAnimationFrame(loop);
    startCamera();
  }

  init();
  PP.app = { state };   // handy for debugging and automated checks
})();
