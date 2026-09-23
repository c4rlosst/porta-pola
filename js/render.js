/* Frame compositor: draws photos (or the live camera) into a polaroid or
 * photobooth frame. Geometry is in abstract units and `scale` maps units to
 * pixels, so the same code serves any on-screen size.
 */
(function (PP) {
  'use strict';

  const PALETTE = [
    { id: 'white',  name: 'White',  paper: '#fbfaf6', ink: '#23242c' },
    { id: 'cream',  name: 'Cream',  paper: '#f3e9d2', ink: '#3a2f25' },
    { id: 'black',  name: 'Black',  paper: '#17181c', ink: '#f2f0ea' },
    { id: 'cobalt', name: 'Cobalt', paper: '#2a3cc7', ink: '#ffffff' },
    { id: 'rose',   name: 'Rose',   paper: '#f6b6c8', ink: '#4a1f2c' },
    { id: 'butter', name: 'Butter', paper: '#ffe08a', ink: '#40330c' },
    { id: 'mint',   name: 'Mint',   paper: '#b7e4cf', ink: '#16382b' },
    { id: 'tomato', name: 'Tomato', paper: '#e8482f', ink: '#fff4ec' },
  ];

  // Caption styles. size scales the base caption size so they look evenly weighty; track is letter-spacing in em.
  const CAPTION_FONTS = [
    { id: 'pen',    name: 'pen',    css: "'Caveat', 'Bradley Hand', 'Segoe Script', cursive",            weight: 600, size: 1,    tilt: -0.02,  ui: 24 },
    { id: 'marker', name: 'marker', css: "'Permanent Marker', 'Marker Felt', 'Comic Sans MS', cursive",  weight: 400, size: 0.78, tilt: -0.015, ui: 17 },
    { id: 'scrawl', name: 'scrawl', css: "'Reenie Beanie', 'Bradley Hand', cursive",                     weight: 400, size: 1.2,  tilt: -0.03,  ui: 26 },
    { id: 'type',   name: 'type',   css: "'Special Elite', 'Courier New', monospace",                    weight: 400, size: 0.66, tilt: 0,      ui: 16 },
    { id: 'clean',  name: 'clean',  css: "'Jost', 'Futura', system-ui, sans-serif",                      weight: 400, size: 0.6,  tilt: 0,      ui: 16, track: 0.16 },
    // Apple's SF family. SF can't be bundled, so these use the system stacks: real SF on iPhone, iPad and Mac,
    // and the device's default font on other platforms.
    { id: 'sf',      name: 'sf',         system: true, css: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif", weight: 500, size: 0.62, tilt: 0, ui: 16, track: 0.01 },
    { id: 'rounded', name: 'sf rounded', system: true, css: "ui-rounded, 'SF Pro Rounded', 'SF Rounded', 'Hiragino Maru Gothic ProN', system-ui, sans-serif",                   weight: 600, size: 0.64, tilt: 0, ui: 16 },
    { id: 'mono',    name: 'sf mono',    system: true, css: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",                                                   weight: 500, size: 0.56, tilt: 0, ui: 15 },
    { id: 'serif',   name: 'new york',   system: true, css: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif",                                                             weight: 500, size: 0.68, tilt: 0, ui: 17 },
  ];
  const captionFont = (id) => CAPTION_FONTS.find(f => f.id === id) || CAPTION_FONTS[0];
  const UI = "'Jost', 'Futura', system-ui, sans-serif";

  /** Frame catalogue: slots are the photo windows, in units. */
  function buildGeometry(id) {
    if (id === 'polaroid') {
      return { id, n: 1, W: 880, H: 1070, aspect: 1,
        slots: [{ x: 40, y: 40, w: 800, h: 800 }], capY: 958, capSize: 108, capMaxW: 740,
        capYLogo: 916, logoY: 1024, logoH: 36 };
    }
    let pw, ph, gap, cols = 1, n;
    const pad = 40;
    if (id === 'strip4') { pw = 520; ph = 390; gap = 22; n = 4; }
    else if (id === 'strip3') { pw = 480; ph = 480; gap = 24; n = 3; }
    else if (id === 'grid4') { pw = 440; ph = 440; gap = 24; n = 4; cols = 2; }
    else throw new Error('Unknown layout ' + id);
    const rows = Math.ceil(n / cols);
    const W = pad * 2 + cols * pw + (cols - 1) * gap;
    const y0 = pad + rows * ph + (rows - 1) * gap;
    const slots = [];
    for (let i = 0; i < n; i++) {
      slots.push({ x: pad + (i % cols) * (pw + gap), y: pad + Math.floor(i / cols) * (ph + gap), w: pw, h: ph });
    }
    return { id, n, W, H: y0 + 190, aspect: pw / ph, slots, capY: y0 + 95, capSize: 100, capMaxW: W - 2 * pad,
      capYLogo: y0 + 68, logoY: y0 + 152, logoH: 30 };
  }
  const cache = {};
  function geometry(id) { return cache[id] || (cache[id] = buildGeometry(id)); }
  function palette(id) { return PALETTE.find(p => p.id === id) || PALETTE[0]; }

  function sizeOf(src) {
    return { w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height };
  }

  /** Centre-crop a camera frame to `aspect` (w/h) and keep it as a still. */
  function makeShot(src, aspect, opts) {
    opts = opts || {};
    const s = sizeOf(src);
    let cw, ch;
    if (s.w / s.h > aspect) { ch = s.h; cw = s.h * aspect; } else { cw = s.w; ch = s.w / aspect; }
    const k = Math.min(1, (opts.maxSide || 1400) / Math.max(cw, ch));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (opts.mirror) { ctx.translate(out.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, (s.w - cw) / 2, (s.h - ch) / 2, cw, ch, 0, 0, out.width, out.height);
    return out;
  }

  /** Fill a slot with `src`, cropped to fit (like object-fit: cover). */
  function drawCover(ctx, src, slot) {
    const s = sizeOf(src);
    const aspect = slot.w / slot.h;
    let cw, ch;
    if (s.w / s.h > aspect) { ch = s.h; cw = s.h * aspect; } else { cw = s.w; ch = s.w / aspect; }
    ctx.drawImage(src, (s.w - cw) / 2, (s.h - ch) / 2, cw, ch, slot.x, slot.y, slot.w, slot.h);
  }

  /** A filtered copy of a shot at the size it will be drawn; a couple are kept per shot. */
  function processed(shot, filterId, w, h) {
    const key = filterId + '|' + w + 'x' + h;
    const cache = shot._pp || (shot._pp = new Map());
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shot, 0, 0, c.width, c.height);
    PP.filters.apply(c, filterId);
    if (cache.size >= 2) cache.delete(cache.keys().next().value);
    cache.set(key, c);
    return c;
  }

  // Seven-segment digits for the orange film date stamp (a b c d e f g)
  const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

  function drawDigit(ctx, ch, x, y, h) {
    const w = h * 0.56, t = h * 0.13;
    const on = SEGMENTS[ch];
    const bar = (name, bx, by, bw, bh) => { if (on.indexOf(name) >= 0) ctx.fillRect(bx, by, bw, bh); };
    bar('a', x + t * 0.5, y, w - t, t);
    bar('g', x + t * 0.5, y + h / 2 - t / 2, w - t, t);
    bar('d', x + t * 0.5, y + h - t, w - t, t);
    bar('f', x, y + t * 0.5, t, h / 2 - t);
    bar('b', x + w - t, y + t * 0.5, t, h / 2 - t);
    bar('e', x, y + h / 2 + t * 0.1, t, h / 2 - t);
    bar('c', x + w - t, y + h / 2 + t * 0.1, t, h / 2 - t);
    return w;
  }

  /** '26  9  23 in glowing orange, right-aligned to the bottom-right of a photo. */
  function drawStamp(ctx, slot, date) {
    const h = slot.w * 0.062, w = h * 0.56, gap = h * 0.2, space = h * 0.62, tick = h * 0.3;
    const groups = [String(date.getFullYear()).slice(-2), String(date.getMonth() + 1), String(date.getDate())];

    let total = tick; // measure first so the stamp can sit flush to the right edge
    groups.forEach((g, gi) => {
      total += g.length * w + (g.length - 1) * gap;
      if (gi < groups.length - 1) total += space;
    });
    let x = slot.x + slot.w - slot.w * 0.06 - total;
    const y = slot.y + slot.h - slot.h * 0.06 - h;

    ctx.save();
    ctx.fillStyle = '#ff8f24';
    ctx.shadowColor = 'rgba(255, 110, 20, 0.9)';
    ctx.shadowBlur = h * 0.5;
    ctx.transform(1, 0, -0.14, 1, (y + h) * 0.14, 0); // italic lean, pivoting on the baseline
    ctx.fillRect(x + tick * 0.25, y, h * 0.1, h * 0.3); // apostrophe before the year
    x += tick;
    groups.forEach((g, gi) => {
      [...g].forEach((ch, i) => {
        x += drawDigit(ctx, ch, x, y, h);
        if (i < g.length - 1) x += gap;
      });
      if (gi < groups.length - 1) x += space;
    });
    ctx.restore();
  }

  // ── Paper ───────────────────────────────────────────────────────────────────
  // A tileable texture, generated once: fine grain, clumpy specks, soft mottling and a few fibres.
  // Light and dark specks are laid over any paper colour, so one tile serves every frame.
  let paperTile = null;
  function makePaperTile() {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');

    let seed = 0x2f6e2b1; // seeded, so the paper looks the same every time
    const rnd = () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const grid = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd() * 2 - 1; return a; };
    const smooth = (t) => t * t * (3 - 2 * t);
    const noise = (a, n, x, y) => { // value noise that wraps, so the tile repeats without seams
      const fx = x / N * n, fy = y / N * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = smooth(fx - ix), ty = smooth(fy - iy);
      const x0 = ix % n, y0 = iy % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const top = a[y0 * n + x0] * (1 - tx) + a[y0 * n + x1] * tx;
      const bot = a[y1 * n + x0] * (1 - tx) + a[y1 * n + x1] * tx;
      return top * (1 - ty) + bot * ty;
    };

    const cloudA = grid(5), cloudB = grid(17), half = N / 2, speck = grid(half);
    const img = ctx.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const mottle = noise(cloudA, 5, x, y) * 0.6 + noise(cloudB, 17, x, y) * 0.4;
        let v = (rnd() * 2 - 1) * 0.07 + speck[(y >> 1) * half + (x >> 1)] * 0.05 + mottle * 0.04;
        if (v < 0) v *= 0.6; // dark specks stay gentler than light ones, so white paper stays white
        const i = (y * N + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v > 0 ? 255 : 0; // light specks and dark specks
        d[i + 3] = Math.min(255, Math.abs(v) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) { // paper fibres
      const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, len = 6 + rnd() * 18, bend = (rnd() - 0.5) * 7;
      ctx.strokeStyle = rnd() < 0.6 ? 'rgba(255,255,255,' + (0.14 + rnd() * 0.16) + ')' : 'rgba(0,0,0,' + (0.05 + rnd() * 0.06) + ')';
      ctx.lineWidth = 0.6 + rnd() * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len / 2 + bend, y + Math.sin(a) * len / 2 + bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    return c;
  }

  /** Card stock: colour, texture, uneven light, and a slightly raised edge. `k` = pixels per unit. */
  function drawPaper(ctx, g, pal, k) {
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, g.W, g.H);

    // the texture is laid down in device pixels so it stays crisp at every size
    if (!paperTile) paperTile = makePaperTile();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pattern = ctx.createPattern(paperTile, 'repeat');
    const ts = Math.max(1, k / 1.15);
    if (ts !== 1 && pattern.setTransform && window.DOMMatrix) pattern.setTransform(new DOMMatrix().scale(ts));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, g.W * k, g.H * k);
    ctx.restore();

    // light falls off across the card, and the edges sit a touch darker
    const lg = ctx.createLinearGradient(0, 0, g.W * 0.6, g.H);
    lg.addColorStop(0, 'rgba(255,255,255,0.12)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, g.W, g.H);
    const rg = ctx.createRadialGradient(g.W / 2, g.H / 2, Math.min(g.W, g.H) * 0.3, g.W / 2, g.H / 2, Math.max(g.W, g.H) * 0.75);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, g.W, g.H);

    // raised edge: a bright rim on the lit sides, a soft shadow on the others
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 0, g.W, 2); ctx.fillRect(0, 0, 2, g.H);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, g.H - 2.5, g.W, 2.5); ctx.fillRect(g.W - 2.5, 0, 2.5, g.H);
  }

  /** The photo window is pressed into the card: a shadow on its lit edges, a highlight on the far ones. */
  function drawWindowEdge(ctx, s) {
    const t = 2.5;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(s.x - t, s.y - t, s.w + 2 * t, t); ctx.fillRect(s.x - t, s.y, t, s.h);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.fillRect(s.x - t, s.y + s.h, s.w + 2 * t, t); ctx.fillRect(s.x + s.w, s.y, t, s.h);
  }

  /** The Porta-Pola logo, in the frame's ink colour, centred on (cx, cy). */
  let logoPaths = null;
  function drawLogo(ctx, cx, cy, height, color) {
    const L = PP.logo;
    if (!L || !window.Path2D) return;
    if (!logoPaths) logoPaths = { stroke: new Path2D(L.markStroke), dot: new Path2D(L.markDot), word: new Path2D(L.wordmark), wordDot: new Path2D(L.wordDot) };
    const s = height / L.h;
    ctx.save();
    ctx.translate(cx - L.w * s / 2, cy - height / 2);
    ctx.scale(s, s);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.save();
    ctx.scale(L.markScale, L.markScale);
    ctx.lineWidth = L.markStrokeWidth; ctx.lineJoin = 'round';
    ctx.stroke(logoPaths.stroke); ctx.fill(logoPaths.dot);
    ctx.restore();
    ctx.fill(logoPaths.word); ctx.fill(logoPaths.wordDot);
    ctx.restore();
  }

  function drawPlaceholder(ctx, g, slot, index, pal) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pal.ink;
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
    if (g.n > 1) {
      ctx.globalAlpha = 0.3;
      ctx.font = '500 ' + slot.h * 0.34 + 'px ' + UI;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), slot.x + slot.w / 2, slot.y + slot.h / 2);
    }
    ctx.restore();
  }

  function drawFinish(ctx, s) {
    // soft gloss and a recessed edge, like film sitting in its window
    const gl = ctx.createLinearGradient(s.x, s.y, s.x + s.w * 0.7, s.y + s.h * 0.7);
    gl.addColorStop(0, 'rgba(255,255,255,0.10)');
    gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
  }

  /**
   * design = { layout, shots[] (null = empty), frame, caption, font, filter, stamp, logo, date, live? }
   * live   = { slot, source } draws an already-filtered camera canvas into that window.
   * Paints onto `target` (resized to geometry * scale).
   */
  function compose(design, scale, target) {
    const g = geometry(design.layout);
    const pal = palette(design.frame);
    const w = Math.max(1, Math.round(g.W * scale)), h = Math.max(1, Math.round(g.H * scale));
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    const ctx = target.getContext('2d');
    ctx.setTransform(w / g.W, 0, 0, h / g.H, 0, 0);
    ctx.imageSmoothingQuality = 'high';

    const k = w / g.W;
    drawPaper(ctx, g, pal, k);

    const live = design.live;
    g.slots.forEach((slot, i) => {
      drawWindowEdge(ctx, slot);
      const shot = design.shots[i];
      let filled = true;
      if (live && live.slot === i) drawCover(ctx, live.source, slot);
      else if (shot) ctx.drawImage(processed(shot, design.filter, Math.round(slot.w * k), Math.round(slot.h * k)), slot.x, slot.y, slot.w, slot.h);
      else filled = false;

      if (filled) {
        drawFinish(ctx, slot);
        if (design.stamp) drawStamp(ctx, slot, design.date || new Date());
      } else drawPlaceholder(ctx, g, slot, i, pal);
    });

    const text = (design.caption || '').trim();
    if (text) {
      const f = captionFont(design.font);
      const setFont = (size) => {
        ctx.font = f.weight + ' ' + size + 'px ' + f.css;
        if ('letterSpacing' in ctx) ctx.letterSpacing = f.track ? (f.track * size) + 'px' : '0px';
      };
      let size = g.capSize * f.size;
      setFont(size);
      const tw = ctx.measureText(text).width;
      if (tw > g.capMaxW) { size *= g.capMaxW / tw; setFont(size); }
      ctx.save();
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.translate(g.W / 2, design.logo ? g.capYLogo : g.capY);
      ctx.rotate(f.tilt);
      ctx.fillText(text, 0, 0);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.restore();
    }

    if (design.logo) drawLogo(ctx, g.W / 2, g.logoY, g.logoH, pal.ink);

    // hairline edge so light papers keep their shape
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, g.W - 2, g.H - 2);
    return target;
  }

  /** Make sure a font is ready before text goes into a canvas (fonts download the first time they are used). */
  function loadFont(id) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const f = captionFont(id);
    if (f.system) return Promise.resolve(); // already on the device
    return document.fonts.load(f.weight + ' 40px ' + f.css.split(',')[0], 'Aa').catch(() => {});
  }
  function loadFonts() {
    return Promise.all([loadFont('pen'), document.fonts && document.fonts.load ? document.fonts.load("500 40px 'Jost'", '1') : null]).catch(() => {});
  }

  PP.render = { PALETTE, CAPTION_FONTS, captionFont, geometry, palette, makeShot, compose, loadFonts, loadFont };
})(window.PP = window.PP || {});
