/* Porta-Pola: the frame is the viewfinder.
 * The live camera shows inside the frame's next empty photo window; the
 * shutter drops the shot in and moves on to the next window.
 */
(function () {
  'use strict';

  const PP = window.PP;
  const R = PP.render, cam = PP.camera;

  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const el = {
    modes: $('#modes'), layouts: $('#layouts'), stage: $('#stage'), canvas: $('#frameCv'), status: $('#status'), hint: $('#hint'),
    caption: $('#caption'), swatches: $('#swatches'), swMirror: $('#swMirror'),
    btnFlip: $('#btnFlip'), ctlFlip: $('#ctlFlip'), btnShutter: $('#btnShutter'), shutterLabel: $('#shutterLabel'),
    btnReset: $('#btnReset'), ctlReset: $('#ctlReset'), flash: $('#flash'),
  };

  const ICONS = {
    flip: '<path d="M20 7h-9a5 5 0 0 0-5 5v1"/><path d="m17 4 3 3-3 3"/><path d="M4 17h9a5 5 0 0 0 5-5v-1"/><path d="m7 20-3-3 3-3"/>',
    redo: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
  };
  const icon = (name) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    mode: 'polaroid', layout: 'strip4', frame: 'white', caption: '', mirror: true,
    facing: 'user', facingKnown: false, deviceId: null, lastFacing: null, canFlip: false,
    cam: 'idle',      // idle | starting | live | error
    camErr: null,
    shots: [],        // one entry per photo window; null until taken
    active: 0,        // window the camera is showing in, or null when the frame is full
  };

  const layoutId = () => (state.mode === 'polaroid' ? 'polaroid' : state.layout);
  const geo = () => R.geometry(layoutId());

  /* ───────────── drawing ───────────── */

  let raf = 0, lastDraw = 0, needsDraw = true;
  const requestDraw = () => { needsDraw = true; };

  function draw() {
    const g = geo();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = el.canvas.clientWidth || 320;
    // keep the pixel count sane: strips are tall
    const scale = Math.min(cssW * dpr / g.W, Math.sqrt(1.6e6 / (g.W * g.H)));
    const live = state.cam === 'live' && state.active !== null;
    R.compose({
      layout: g.id, shots: state.shots, frame: state.frame, caption: state.caption,
      live: live ? { slot: state.active, video: cam.video, mirror: state.mirror } : null,
    }, scale, el.canvas);
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const live = state.cam === 'live' && state.active !== null;
    if (!live && !needsDraw) return;
    if (live && t - lastDraw < 33) return;
    lastDraw = t; needsDraw = false;
    draw();
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
    if (state.cam === 'starting') return;
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
    window.scrollTo({ top: Math.max(0, y - window.innerHeight * 0.4), behavior: reduced() ? 'auto' : 'smooth' });
  }

  function onShutter() {
    if (state.active === null) { startOver(); return; }   // "Again"
    if (state.cam !== 'live') return;
    state.shots[state.active] = R.makeShot(cam.video, geo().aspect, { mirror: state.mirror, maxSide: 1400 });
    flashScreen();
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* unsupported */ }
    const next = state.shots.findIndex(s => !s);
    state.active = next >= 0 ? next : null;
    syncUI(); requestDraw(); scrollToActive();
  }

  function startOver() {
    resetShots();
    syncUI(); requestDraw();
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }

  // tap a finished photo to retake just that one
  el.canvas.addEventListener('click', (e) => {
    const g = geo(), r = el.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * g.W, y = (e.clientY - r.top) / r.height * g.H;
    const i = g.slots.findIndex(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (i >= 0 && state.shots[i] && state.active !== i) {
      state.active = i;
      syncUI(); requestDraw();
    }
  });

  /* ───────────── controls ───────────── */

  function hintText() {
    const g = geo();
    if (state.cam === 'error') return '';
    if (state.active === null) return g.n === 1 ? 'Nice. Tap the photo to retake it, or add a caption below.' : 'All set. Tap any photo to retake it.';
    if (g.n === 1) return state.shots[0] ? 'Retaking. Tap the shutter.' : 'Line up your shot, then tap the shutter.';
    return 'Photo ' + (state.active + 1) + ' of ' + g.n + '. Tap the shutter.';
  }

  function markPressed(container, attr, value) {
    container.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  function syncUI() {
    const g = geo();
    app.dataset.mode = state.mode;
    app.dataset.layout = g.id;
    el.stage.style.setProperty('--ar', g.W / g.H);
    markPressed(el.modes, 'mode', state.mode);
    markPressed(el.layouts, 'layout', state.layout);
    el.swatches.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.frame)));
    el.swMirror.setAttribute('aria-checked', String(state.mirror));

    const full = state.active === null;
    el.shutterLabel.textContent = full ? 'Again' : 'Snap';
    el.btnShutter.setAttribute('aria-label', full ? 'Start over' : 'Take photo');
    el.btnShutter.disabled = !full && state.cam !== 'live';
    el.ctlFlip.classList.toggle('is-off', !(state.cam === 'live' && state.canFlip));
    el.ctlReset.classList.toggle('is-off', full || !state.shots.some(Boolean));
    el.hint.textContent = hintText();
  }

  function changeFrame(mode, layout) {
    if (mode === state.mode && layout === state.layout) return;
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
    el.btnShutter.addEventListener('click', onShutter);
    el.btnFlip.addEventListener('click', flipCamera);
    el.btnReset.addEventListener('click', startOver);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/^(INPUT|BUTTON|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); onShutter(); }
    });
    window.addEventListener('resize', requestDraw);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cam.stop(); if (state.cam === 'live' || state.cam === 'starting') state.cam = 'idle'; }
      else if (state.cam === 'idle') startCamera();
    });
    window.addEventListener('pagehide', () => cam.stop());
  }

  function init() {
    el.btnFlip.innerHTML = icon('flip');
    el.btnReset.innerHTML = icon('redo');
    buildSwatches();
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
