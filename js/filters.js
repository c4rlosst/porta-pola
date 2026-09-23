/* Retro camera looks.
 *
 * Each filter is a small parameter set: colour matrix (saturation, sepia), per-channel tone curves
 * (brightness, contrast, lifted blacks, colour cast), then vignette, a light leak and film grain.
 * One pixel pipeline paints both the live viewfinder and the saved image, and it works in every
 * browser (no reliance on ctx.filter).
 */
(function (PP) {
  'use strict';

  // lift = faded blacks (number, or [r,g,b] for a tinted shadow); add = overall colour cast;
  // leak = { x, y, r, c, a }: light leaking in from (x, y) as a fraction of the frame, radius r, colour c
  const FILTERS = [
    { id: 'orig',    name: 'Original' },
    { id: 'instant', name: 'Instant', sat: 1.1,  contrast: 1.08, bright: 1.03, lift: [17, 14, 10], add: [7, 2, -9],    vignette: 0.42, grain: 0.05 },
    { id: 'ccd',     name: 'CCD',     sat: 1.32, contrast: 1.16, bright: 1.08, lift: [4, 6, 12],   add: [-6, 3, 11],   vignette: 0.22, grain: 0.035 },
    { id: 'flash',   name: 'Flash',   sat: 1.18, contrast: 1.3,  bright: 1.1,  lift: [8, 4, 2],    add: [10, 3, -8],   vignette: 0.55, grain: 0.09,
      leak: { x: 1.02, y: 0.28, r: 0.75, c: [255, 105, 40], a: 0.8 } },
    { id: 'gold',    name: 'Gold',    sat: 1.15, contrast: 1.06, bright: 1.05, lift: [14, 10, 0],  add: [20, 9, -20],  vignette: 0.3,  grain: 0.06,
      leak: { x: -0.02, y: 0.78, r: 0.62, c: [255, 175, 60], a: 0.5 } },
    { id: 'verde',   name: 'Verde',   sat: 1.06, contrast: 1.12, bright: 1.02, lift: [6, 17, 14],  add: [-8, 6, 3],    vignette: 0.28, grain: 0.05 },
    { id: 'dream',   name: 'Dream',   sat: 0.9,  contrast: 0.86, bright: 1.1,  lift: [30, 22, 32], add: [10, 0, 12],   vignette: 0.12, grain: 0.03,
      leak: { x: 0.1, y: -0.02, r: 0.75, c: [255, 140, 190], a: 0.6 } },
    { id: 'mono',    name: 'Mono',    sat: 0,    contrast: 1.25, bright: 1.02, lift: 8,            add: [0, 0, 0],     vignette: 0.42, grain: 0.11 },
    { id: 'sepia',   name: 'Sepia',   sepia: 0.85, sat: 0.9,   contrast: 1.06, lift: 14,          add: [0, 0, 0],     vignette: 0.38, grain: 0.06 },
    { id: 'cool',    name: 'Cool',    sat: 0.95, contrast: 1.06, bright: 1.02, lift: 12,           add: [-12, 0, 16],  vignette: 0.3,  grain: 0.04 },
  ];

  const LR = 0.2126, LG = 0.7152, LB = 0.0722;
  const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function saturation(s) {
    const i = 1 - s;
    return [LR * i + s, LG * i, LB * i, LR * i, LG * i + s, LB * i, LR * i, LG * i, LB * i + s];
  }
  function mix(a, b, t) { return a.map((v, i) => v * (1 - t) + b[i] * t); }
  function mul(a, b) { // 3x3 row-major
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
  }

  const compiled = new Map();
  function compile(def) {
    let m = mix(IDENTITY, SEPIA, def.sepia || 0);
    m = mul(saturation(def.sat == null ? 1 : def.sat), m);

    const bright = def.bright == null ? 1 : def.bright;
    const contrast = def.contrast == null ? 1 : def.contrast;
    const lift = Array.isArray(def.lift) ? def.lift : [def.lift || 0, def.lift || 0, def.lift || 0];
    const add = def.add || [0, 0, 0];
    const luts = [0, 1, 2].map(ch => {
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        let x = v * bright;
        x = (x - 128) * contrast + 128;
        x = lift[ch] + x * (1 - lift[ch] / 255);
        lut[v] = x + add[ch];
      }
      return lut;
    });
    return { m, r: luts[0], g: luts[1], b: luts[2], vignette: def.vignette || 0, grain: def.grain || 0, leak: def.leak || null };
  }

  let seed = 0x9e3779b9;
  function rand() { // xorshift32: much faster than Math.random in a hot loop
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  function get(id) { return FILTERS.find(f => f.id === id) || FILTERS[0]; }

  /** Apply filter `id` to a canvas in place. Pass { grain: false } to skip film grain. */
  function apply(canvas, id, opts) {
    const def = get(id);
    if (def.id === 'orig') return canvas;
    let c = compiled.get(def.id);
    if (!c) { c = compile(def); compiled.set(def.id, c); }

    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const m = c.m, lr = c.r, lg = c.g, lb = c.b;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
    const vig = c.vignette;
    const grain = (opts && opts.grain === false) ? 0 : c.grain * 255;
    const leak = c.leak;
    const lk = leak ? { x: leak.x, y: leak.y, r2: leak.r * leak.r, r: leak.r, a: leak.a, cr: leak.c[0] / 255, cg: leak.c[1] / 255, cb: leak.c[2] / 255 } : null;

    const dx2 = new Float32Array(w);
    const lkx2 = lk ? new Float32Array(w) : null;
    for (let x = 0; x < w; x++) {
      const dx = (x / (w - 1) - 0.5) * 2; dx2[x] = dx * dx;
      if (lk) { const ex = x / (w - 1) - lk.x; lkx2[x] = ex * ex; }
    }

    let p = 0;
    for (let y = 0; y < h; y++) {
      const dy = (y / (h - 1) - 0.5) * 2, dy2 = dy * dy;
      const ly = lk ? (y / (h - 1) - lk.y) : 0, ly2 = ly * ly;
      for (let x = 0; x < w; x++, p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        let nr = m0 * r + m1 * g + m2 * b;
        let ng = m3 * r + m4 * g + m5 * b;
        let nb = m6 * r + m7 * g + m8 * b;
        nr = lr[nr < 0 ? 0 : nr > 255 ? 255 : nr | 0];
        ng = lg[ng < 0 ? 0 : ng > 255 ? 255 : ng | 0];
        nb = lb[nb < 0 ? 0 : nb > 255 ? 255 : nb | 0];
        if (vig) {
          let t = ((dx2[x] + dy2) * 0.5 - 0.22) / 0.78;
          if (t > 0) {
            if (t > 1) t = 1;
            const f = 1 - vig * t * t * (3 - 2 * t);
            nr *= f; ng *= f; nb *= f;
          }
        }
        if (lk) { // screen-blend a warm glow that fades out from the leak's origin
          const dd = lkx2[x] + ly2;
          if (dd < lk.r2) {
            const u = 1 - Math.sqrt(dd) / lk.r, t = u * u * lk.a;
            nr = 255 - (255 - nr) * (1 - lk.cr * t);
            ng = 255 - (255 - ng) * (1 - lk.cg * t);
            nb = 255 - (255 - nb) * (1 - lk.cb * t);
          }
        }
        if (grain) {
          const n = (rand() - 0.5) * grain;
          nr += n; ng += n; nb += n;
        }
        d[p] = nr; d[p + 1] = ng; d[p + 2] = nb; // Uint8ClampedArray clamps and rounds
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  PP.filters = { list: FILTERS, get, apply };
})(window.PP = window.PP || {});
