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

  const HAND = "'Caveat', 'Bradley Hand', 'Segoe Script', cursive";
  const UI = "'Jost', 'Futura', system-ui, sans-serif";

  /** Frame catalogue: slots are the photo windows, in units. */
  function buildGeometry(id) {
    if (id === 'polaroid') {
      return { id, n: 1, W: 880, H: 1070, aspect: 1,
        slots: [{ x: 40, y: 40, w: 800, h: 800 }], capY: 958, capSize: 108, capMaxW: 740 };
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
    return { id, n, W, H: y0 + 190, aspect: pw / ph, slots, capY: y0 + 95, capSize: 100, capMaxW: W - 2 * pad };
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

  function drawPaper(ctx, g, pal) {
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, g.W, g.H);
    const lg = ctx.createLinearGradient(0, 0, 0, g.H);
    lg.addColorStop(0, 'rgba(255,255,255,0.07)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, g.W, g.H);
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
   * design = { layout, shots[] (null = empty), frame, caption, filter, stamp, date, live? }
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

    drawPaper(ctx, g, pal);

    const live = design.live;
    const k = w / g.W;
    g.slots.forEach((slot, i) => {
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
      let size = g.capSize;
      ctx.font = '600 ' + size + 'px ' + HAND;
      const tw = ctx.measureText(text).width;
      if (tw > g.capMaxW) { size *= g.capMaxW / tw; ctx.font = '600 ' + size + 'px ' + HAND; }
      ctx.save();
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.translate(g.W / 2, g.capY);
      ctx.rotate(-0.02);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    // hairline edge so light papers keep their shape
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, g.W - 2, g.H - 2);
    return target;
  }

  /** Make sure the caption font is ready before text goes into a canvas. */
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("600 40px 'Caveat'", 'Aa'),
      document.fonts.load("500 40px 'Jost'", '1'),
    ]).catch(() => {});
  }

  PP.render = { PALETTE, geometry, palette, makeShot, compose, loadFonts };
})(window.PP = window.PP || {});
