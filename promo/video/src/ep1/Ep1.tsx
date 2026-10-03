// Ep 1 "Old vs New" — pilot of the Square One series.
// One continuous 3D board; a perspective camera follows the flat square. First frame == last frame.
import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {Audio} from '@remotion/media';
import '../shared';
import {C, FONT} from '../theme';
import {EASE, arc, bump, keys, lerp, ring, t01} from './rig';

export const EP1_FRAMES = 870;
const BG = '#e7e2d7', GRID = '#cdc6b6', INK = '#141412', VERM = C.acc;

// ---------- World layout (world px) ----------
const u = 4.8;
const LOGO = {x: -240, y: -330};
const SLOT = {x: LOGO.x + 57.5 * u, base: LOGO.y + 77 * u, w: 43 * u, h: 45 * u};
const W0 = 112, H0 = 117;
const ICONS = [-330, -110, 110, 330].map((x) => ({x, y: 300}));
const PHOTO = {x: 2068, y: -354, w: 1064, h: 709};
const PERCH = {x: 2900, y: PHOTO.y};
type R = {x: number; y: number; w: number; h: number};
const win = (cx: number): R => ({x: cx - 750, y: 1050, w: 1500, h: 900});
const IMPORT = win(2600), EDIT = win(4600), PLUGIN = win(6600), EXPORT = win(8600);
const IBAR = {x: IMPORT.x + 100, y: IMPORT.y + 640, w: 1300, h: 30};
const THUMB = {x: EDIT.x + 120 + 0.32 * 640, base: EDIT.y + 330};
const GRAINSPOT = {x: PLUGIN.x + 1050, base: PLUGIN.y + 560};
const EBAR = {x: EXPORT.x + 300, y: EXPORT.y + 560, w: 900, h: 30};
const FLOOR = {x: 8600, y: 2420};
const APP = {x: 5250, y: 2932, w: 1700, h: 935};
const APERCH = {x: 6500, y: APP.y};
const DIVE = {x: APP.x + 0.414 * APP.w, y: APP.y + 0.514 * APP.h};
const HOLE = {x: 4300, y: 1700};

// ---------- Character ----------
type S = {x: number; base: number; w: number; h: number; q: number; rot: number; sat: number; blur: number; grad: number; radius: number; split: number; hide?: boolean};
const base = (): S => ({x: SLOT.x, base: SLOT.base, w: SLOT.w, h: SLOT.h, q: 0, rot: 0, sat: 1, blur: 0, grad: 1, radius: 0, split: 0});

// Slingshot: square at (x0,b0) pulls back away from target, releases, flies on an arc.
const sling = (s: S, f: number, a: number, x0: number, b0: number, x1: number, b1: number, h: number, w1: number, h1: number) => {
  const pt = t01(f, a, a + 12, EASE.in);
  const dir = Math.sign(x1 - x0);
  if (f < a + 12) {
    s.x = x0 - dir * 46 * pt; s.base = b0 + 10 * pt;
    s.q = -0.22 * pt; // stretched along the pull (wide, low)
    s.rot = 0;
    return;
  }
  const r = arc(f, a + 12, a + 30, x0 - dir * 46, b0 + 10, x1, b1, h);
  s.x = r.x; s.base = r.y; s.w = lerp(s.w, w1, EASE.move(r.t)); s.h = lerp(s.h, h1, EASE.move(r.t));
  s.q = 0.18 * (1 - r.t) * (r.t > 0 ? 1 : 0) + ring(f, a + 30, -0.08);
  s.rot = dir * 10 * Math.sin(Math.PI * r.t);
};

const state = (f: number): S => {
  const s = base();
  if (f < 30) { s.q = -0.06 * bump(f, 22, 30); return s; }
  if (f < 110) { // to the photo
    const a = arc(f, 30, 54, SLOT.x, SLOT.base, PERCH.x, PERCH.y, 360);
    s.x = a.x; s.base = a.y; s.w = lerp(SLOT.w, W0, EASE.move(a.t)); s.h = lerp(SLOT.h, H0, EASE.move(a.t));
    s.grad = 1 - t01(f, 30, 42); s.q = 0.08 * bump(f, 30, 42) + ring(f, 54, -0.07);
    s.rot = keys(f, [[80, 0], [95, 4, EASE.out], [110, 4]]);
    return s;
  }
  s.grad = 0; s.w = W0; s.h = H0;
  if (f < 200) { // import: drop into the progress bar, get stretched
    s.sat = keys(f, [[110, 1], [200, 0.85]]);
    if (f < 142) {
      const a = arc(f, 118, 142, PERCH.x, PERCH.y, IBAR.x + W0 / 2, IBAR.y + IBAR.h, 160);
      s.x = a.x; s.base = a.y; s.q = -0.05 * bump(f, 110, 118) + ring(f, 142, -0.06); s.rot = 4 * (1 - t01(f, 110, 122));
      return s;
    }
    const sink = t01(f, 142, 154, EASE.drag), fill = t01(f, 150, 198, (t) => t * (0.5 + 0.5 * t));
    s.h = lerp(H0, IBAR.h, sink); s.w = lerp(W0, IBAR.w, fill); s.x = IBAR.x + s.w / 2; s.base = IBAR.y + IBAR.h;
    return s;
  }
  if (f < 300) { // sling to edit; squeezed into a tiny thumb
    s.sat = keys(f, [[200, 0.85], [300, 0.7]]); s.blur = keys(f, [[242, 0], [300, 1.6]]);
    if (f < 210) { const t = t01(f, 200, 210, EASE.out); s.w = lerp(IBAR.w, W0, t); s.h = lerp(IBAR.h, H0, t); s.x = IBAR.x + IBAR.w - s.w / 2; s.base = IBAR.y + IBAR.h; return s; }
    if (f < 242) { s.w = W0; s.h = H0; sling(s, f, 210, IBAR.x + IBAR.w - W0 / 2, IBAR.y + IBAR.h, THUMB.x, THUMB.base, 260, 40, 40); return s; }
    s.w = 40; s.h = 40; s.x = THUMB.x + 4 * Math.sin(f * 0.8) * t01(f, 255, 265) * (1 - t01(f, 285, 296)); s.base = THUMB.base;
    return s;
  }
  if (f < 390) { // sling to the grain plugin; goes soft and noisy
    s.sat = keys(f, [[300, 0.7], [390, 0.55]]); s.blur = keys(f, [[300, 1.6], [390, 3]]);
    s.w = 40; s.h = 40;
    if (f < 332) { sling(s, f, 302, THUMB.x, THUMB.base, GRAINSPOT.x, GRAINSPOT.base, 300, 90, 90); return s; }
    s.w = 90; s.h = 90; s.x = GRAINSPOT.x; s.base = GRAINSPOT.base;
    return s;
  }
  if (f < 500) { // sling to export; progress keeps resetting; falls off
    s.sat = keys(f, [[390, 0.55], [500, 0.4]]); s.blur = keys(f, [[390, 3], [480, 4], [500, 3]]);
    s.w = 90; s.h = 90;
    if (f < 422) { sling(s, f, 392, GRAINSPOT.x, GRAINSPOT.base, EBAR.x + 60, EBAR.y + EBAR.h, 280, 120, EBAR.h); return s; }
    const run = (a: number, b: number) => t01(f, a, b, EASE.drag);
    const p = f < 448 ? run(424, 448) * 0.62 : f < 452 ? lerp(0.62, 0.05, t01(f, 448, 452, EASE.out)) : f < 472 ? 0.05 + run(452, 472) * 0.5 : f < 476 ? lerp(0.55, 0.05, t01(f, 472, 476, EASE.out)) : 0.05;
    s.h = EBAR.h; s.w = Math.max(120, EBAR.w * p); s.x = EBAR.x + s.w / 2; s.base = EBAR.y + EBAR.h;
    if (f >= 478) {
      const fall = t01(f, 478, 500, EASE.in);
      s.w = lerp(120, 220, fall); s.h = lerp(EBAR.h, 26, fall);
      s.x = lerp(EBAR.x + 60, FLOOR.x, fall); s.base = lerp(EBAR.y + EBAR.h, FLOOR.y, fall);
      s.rot = 18 * Math.sin(Math.PI * fall);
    }
    return s;
  }
  if (f < 546) { // low point
    s.x = FLOOR.x; s.base = FLOOR.y; s.w = 220; s.h = 26; s.sat = 0.4; s.blur = 3;
    s.q = 0.2 * bump(f, 525, 530) - 0.15 * bump(f, 538, 546);
    return s;
  }
  if (f < 614) { // snap back; fly up onto Chromasmith; dive into it
    s.sat = keys(f, [[546, 0.4], [552, 1, EASE.out]]); s.blur = keys(f, [[546, 3], [551, 0, EASE.out]]);
    const g = t01(f, 546, 550, EASE.out);
    s.w = lerp(220, W0, g); s.h = lerp(26, H0, g); s.x = FLOOR.x; s.base = FLOOR.y;
    s.q = f < 550 ? 0 : ring(f, 550, 0.14, 0.3, 0.6);
    if (f >= 556) {
      const a = arc(f, 556, 584, FLOOR.x, FLOOR.y, APERCH.x, APERCH.y, 520);
      s.x = a.x; s.base = a.y; s.rot = -8 * Math.sin(Math.PI * a.t);
      s.q = 0.1 * bump(f, 556, 566) + ring(f, 584, -0.08);
    }
    if (f >= 594) {
      const a = arc(f, 600, 614, APERCH.x, APERCH.y, DIVE.x, DIVE.y + 15, 180);
      s.x = a.x; s.base = a.y; s.rot = 0;
      s.q = -0.1 * bump(f, 594, 600) + 0.15 * bump(f, 600, 608);
      const k = EASE.in(a.t); s.w = lerp(W0, 30, k); s.h = lerp(H0, 30, k);
    }
    return s;
  }
  if (f < 716) { s.hide = true; return s; } // inside Chromasmith (drawn in screen space)
  if (f < 760) { // long flight home across the board
    const a = arc(f, 716, 760, HOLE.x, HOLE.y + H0 / 2, ICONS[0].x, ICONS[0].y + 32, 1400);
    s.x = a.x; s.base = a.y; s.rot = -6 * Math.sin(Math.PI * a.t);
    const g = t01(f, 748, 760, EASE.out); s.w = lerp(W0, 100, g); s.h = lerp(H0, 64, g); s.radius = 3 * g;
    return s;
  }
  // platforms: laptop screen → four panes → phone → phone → logo
  const icon = (i: number) => ICONS[i];
  const shapes = [{w: 100, h: 64, r: 3, b: 32}, {w: 96, h: 96, r: 0, b: 48}, {w: 54, h: 104, r: 10, b: 52}, {w: 54, h: 104, r: 5, b: 52}];
  const stops = [760, 778, 796, 814];
  let i = 0; for (let k = 0; k < 4; k++) if (f >= stops[k]) i = k;
  if (f < 828) {
    const sh = shapes[i], prev = shapes[Math.max(0, i - 1)];
    const t = i === 0 ? 1 : t01(f, stops[i], stops[i] + 10, EASE.move);
    const from = icon(Math.max(0, i - 1)), to = icon(i);
    const hop = i === 0 ? 0 : 40 * Math.sin(Math.PI * t);
    s.x = lerp(from.x, to.x, t); s.base = lerp(from.y + prev.b, to.y + sh.b, t) - hop;
    s.w = lerp(prev.w, sh.w, t); s.h = lerp(prev.h, sh.h, t); s.radius = lerp(prev.r, sh.r, t);
    s.split = i === 1 ? t01(f, 778, 784) : i === 2 ? 1 - t01(f, 796, 802) : 0;
    return s;
  }
  const last = shapes[3];
  const a = arc(f, 828, 848, icon(3).x, icon(3).y + last.b, SLOT.x, SLOT.base, 260);
  s.x = a.x; s.base = a.y; s.w = lerp(last.w, SLOT.w, EASE.move(a.t)); s.h = lerp(last.h, SLOT.h, EASE.move(a.t));
  s.radius = lerp(last.r, 0, a.t); s.rot = a.t < 1 ? 6 * Math.sin(Math.PI * a.t) : 0;
  if (a.t >= 1) { s.x = SLOT.x; s.base = SLOT.base; s.w = SLOT.w; s.h = SLOT.h; }
  s.grad = t01(f, 838, 850, EASE.type);
  s.q = (0.06 * bump(f, 828, 838) + ring(f, 848, -0.07)) * (1 - t01(f, 854, 858, (t) => t));
  return s;
};

// ---------- Camera: perspective, tilts across the board, follows the square ----------
type Cam = {x: number; y: number; z: number; tilt: number; roll: number};
const camTarget = (f: number): Cam => {
  const s = state(f);
  const sx = s.x, sy = s.base - s.h / 2;
  const K = (k: [number, number][]) => keys(f, k.map(([a, b]) => [a, b, EASE.move]));
  const fx = K([[24, 0], [56, 2250], [110, 2250], [144, 2600], [210, 2600], [244, 4600], [302, 4600], [334, 6600], [392, 6600], [424, 8600], [478, 8600], [546, 8600], [586, 5620], [596, 5620], [614, DIVE.x], [622, DIVE.x], [623, HOLE.x], [716, HOLE.x], [762, 0], [814, 0], [856, 0]]);
  const fy = K([[24, 35], [56, 0], [110, 0], [144, 1500], [478, 1500], [502, 2150], [546, 2150], [586, 3400], [596, 3400], [614, DIVE.y], [622, DIVE.y], [623, HOLE.y], [716, HOLE.y], [762, 260], [814, 260], [856, 35]]);
  const z = K([[24, 1.2], [56, 1], [110, 1], [144, 0.95], [478, 0.95], [502, 1], [544, 1.07], [586, 0.85], [596, 0.85], [614, 2.2], [622, 2.2], [623, 0.17], [716, 0.17], [762, 1.4], [814, 1.4], [856, 1.2]]);
  const tilt = K([[0, 0], [24, 0], [50, 24], [110, 14], [140, 26], [200, 16], [216, 26], [244, 18], [300, 18], [316, 28], [334, 18], [392, 18], [406, 28], [424, 18], [478, 18], [502, 34], [546, 34], [586, 16], [598, 16], [614, 0], [622, 0], [623, 42], [716, 42], [762, 12], [814, 12], [856, 0]]);
  const roll = K([[0, 0], [210, 0], [222, -3], [244, 0], [302, 0], [314, 3], [334, 0], [392, 0], [404, -3], [424, 0], [478, 0], [502, 4], [546, 4], [586, 0], [622, 0], [623, -8], [716, -8], [762, 0]]);
  const follow = K([[24, 0], [40, 0.35], [56, 0], [210, 0], [226, 0.5], [244, 0], [302, 0], [316, 0.5], [334, 0], [392, 0], [406, 0.5], [424, 0], [478, 0], [494, 0.6], [502, 0], [556, 0], [570, 0.5], [586, 0], [716, 0], [730, 0.4], [762, 0]]);
  return {x: lerp(fx, sx, follow), y: lerp(fy, sy, follow), z, tilt, roll};
};
const camera = (f: number): Cam => { // weighted lag: the camera trails the square slightly
  const o = {x: 0, y: 0, z: 0, tilt: 0, roll: 0}; let n = 0;
  for (let k = 0; k < 8; k++) { const c = camTarget(f - k), w = 8 - k; o.x += c.x * w; o.y += c.y * w; o.z += c.z * w; o.tilt += c.tilt * w; o.roll += c.roll * w; n += w; }
  return {x: o.x / n, y: o.y / n, z: o.z / n, tilt: o.tilt / n, roll: o.roll / n};
};

// ---------- Geometry: deterministic abstract solids on the board ----------
const rnd = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const KEEP_OUT: R[] = [{x: -800, y: -560, w: 1600, h: 1060}, {x: 1250, y: -520, w: 2050, h: 1000}, {x: 1700, y: 960, w: 7800, h: 1200}, {x: 4300, y: 2780, w: 2800, h: 1250}, {x: 8000, y: 2200, w: 1200, h: 500}];
type Solid = {x: number; y: number; wx: number; wy: number; wz: number; h: number; rz: number; spin: number; tone: number; kind: 'box' | 'frame'};
const SOLIDS: Solid[] = (() => {
  const r = rnd(7); const out: Solid[] = [];
  while (out.length < 64) {
    const x = -1800 + r() * 11800, y = -1500 + r() * 5900;
    if (KEEP_OUT.some((k) => x > k.x - 120 && x < k.x + k.w + 120 && y > k.y - 120 && y < k.y + k.h + 120)) continue;
    const kindR = r(), s = 70 + r() ** 1.6 * 380;
    if (kindR < 0.55) out.push({x, y, wx: s, wy: s, wz: s, h: r() < 0.6 ? 0 : 80 + r() * 520, rz: r() * 90, spin: r() < 0.4 ? (r() < 0.5 ? -1 : 1) : 0, tone: Math.floor(r() * 4), kind: 'box'});
    else if (kindR < 0.8) out.push({x, y, wx: s * 0.18, wy: s * 0.7, wz: s * 2.2, h: 0, rz: r() * 90, spin: 0, tone: Math.floor(r() * 4), kind: 'box'});
    else out.push({x, y, wx: s, wy: s, wz: 0, h: 200 + r() * 700, rz: r() * 90, spin: r() < 0.5 ? -1 : 1, tone: 0, kind: 'frame'});
  }
  // small solids floating high above the content: they pass close to the lens and sell the depth
  while (out.length < 110) {
    const x = -1200 + r() * 11000, y = -1200 + r() * 5400, sz = 40 + r() * 110;
    out.push({x, y, wx: sz, wy: sz, wz: r() < 0.3 ? 0 : sz, h: 500 + r() * 700, rz: r() * 90, spin: r() < 0.5 ? -1 : 1, tone: Math.floor(r() * 4), kind: r() < 0.3 ? 'frame' : 'box'});
  }
  return out;
})();
const TONES = [['#efeadf', '#d9d2c3', '#c4bba9'], ['#d6cfbf', '#bdb4a1', '#a59b87'], ['#3a3631', '#2a2723', '#1d1b18'], ['#e3dccd', '#cbc2b0', '#b2a893']];
const face = (w: number, h: number, t: string, bg: string): React.CSSProperties => ({position: 'absolute', left: -w / 2, top: -h / 2, width: w, height: h, transform: t, background: bg, backfaceVisibility: 'hidden'});
const Box3: React.FC<{wx: number; wy: number; wz: number; c: string[]; edge?: string}> = ({wx, wy, wz, c, edge}) => {
  const b = edge ? {boxShadow: `inset 0 0 0 1.5px ${edge}`} : {};
  return <>
    <div style={{...face(wx, wy, `translateZ(${wz / 2}px)`, c[0]), ...b}} />
    <div style={{...face(wz, wy, `rotateY(90deg) translateZ(${wx / 2}px)`, c[2]), ...b}} />
    <div style={{...face(wz, wy, `rotateY(-90deg) translateZ(${wx / 2}px)`, c[1]), ...b}} />
    <div style={{...face(wx, wz, `rotateX(-90deg) translateZ(${wy / 2}px)`, c[1]), ...b}} />
    <div style={{...face(wx, wz, `rotateX(90deg) translateZ(${wy / 2}px)`, c[2]), ...b}} />
  </>;
};
const Solids: React.FC<{f: number}> = ({f}) => {
  const cyc = (f / (EP1_FRAMES - 1)) * 360; // whole turns over the film, so frame 0 == last frame
  return <>{SOLIDS.map((s, i) => {
    const rz = s.rz + s.spin * cyc;
    const shadow = s.wz > 0 || s.kind === 'frame';
    const sh = Math.max(s.wx, s.wy);
    return <React.Fragment key={i}>
      {shadow && <div style={{position: 'absolute', left: s.x - sh / 2, top: s.y - sh / 2 + s.h * 0.25, width: sh, height: sh, background: 'rgba(20,18,15,.14)', filter: `blur(${16 + s.h * 0.06}px)`, transform: `rotate(${rz}deg)`}} />}
      <div style={{position: 'absolute', left: s.x, top: s.y, transformStyle: 'preserve-3d', transform: `translateZ(${s.h + s.wz / 2}px) rotateZ(${rz}deg)${s.kind === 'frame' ? ` rotateX(${s.spin * cyc * 2}deg)` : ''}`}}>
        {s.kind === 'frame'
          ? <div style={{...face(s.wx, s.wy, 'none', 'transparent'), backfaceVisibility: 'visible', border: `3px solid ${INK}`, opacity: 0.55}} />
          : <Box3 wx={s.wx} wy={s.wy} wz={s.wz} c={TONES[s.tone]} />}
      </div>
    </React.Fragment>;
  })}</>;
};

// ---------- Drawing ----------
const Grad: React.FC<{id: string}> = ({id}) => (
  <svg viewBox="36 32 43 45" preserveAspectRatio="none" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
    <clipPath id={`${id}c`}><rect x="36" y="32" width="33" height="33" /></clipPath>
    <defs>
      <radialGradient id={`${id}a`} cx="69" cy="32" r="41.25" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff1e0" /><stop offset=".35" stopColor="#ff6a3a" /><stop offset=".7" stopColor="#b0200e" /><stop offset="1" stopColor="#7a1208" /></radialGradient>
      <radialGradient id={`${id}b`} cx="69" cy="32" r="41.25" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff1e0" /><stop offset=".4" stopColor="#ff7a4c" /><stop offset="1" stopColor="#ff2a10" /></radialGradient>
    </defs>
    <g clipPath={`url(#${id}c)`}>
      <polygon points="36,32 69,32 36,65" fill={`url(#${id}a)`} />
      <polygon points="69,32 69,65 36,65" fill={`url(#${id}b)`} />
      <line x1="36" y1="65" x2="69" y2="32" stroke="#fff1e0" strokeWidth=".35" opacity=".8" />
    </g>
  </svg>
);

// Flat card that stands up off the board to face the camera.
const Hero: React.FC<{s: S; id: string; tilt: number}> = ({s, id, tilt}) => {
  if (s.hide) return null;
  const sy = 1 + s.q, sx = 1 / sy, w = s.w * sx, h = s.h * sy;
  const gap = 8 * s.split;
  const filter = s.sat < 1 || s.blur > 0 ? `saturate(${s.sat}) brightness(${lerp(0.9, 1, s.sat)}) blur(${s.blur}px)` : undefined;
  const stand = tilt > 0.01 ? `rotateX(${-tilt}deg) ` : '';
  return <>
    {tilt > 0.5 && <div style={{position: 'absolute', left: s.x - w / 2, top: s.base - h * 0.18, width: w, height: h * 0.18, background: 'rgba(20,18,15,.18)', filter: 'blur(6px)', transform: 'translateZ(25px)'}} />}
    <div style={{position: 'absolute', left: s.x - w / 2, top: s.base - h, width: w, height: h, transform: `translateZ(26px) ${stand}rotate(${s.rot}deg)`, transformOrigin: '50% 100%', filter}}>
      {s.split > 0 ? [0, 1, 2, 3].map((k) => (
        <div key={k} style={{position: 'absolute', left: (k % 2) * (w + gap) / 2, top: Math.floor(k / 2) * (h + gap) / 2, width: (w - gap) / 2, height: (h - gap) / 2, background: VERM}} />
      )) : <div style={{position: 'absolute', inset: 0, background: VERM, borderRadius: s.radius}} />}
      {s.grad > 0 && <div style={{position: 'absolute', inset: 0, opacity: s.grad}}><Grad id={id} /></div>}
    </div>
  </>;
};

const Line: React.FC<{f: number; at: number; x: number; y: number; size: number; color?: string; weight?: number; children: React.ReactNode}> =
  ({f, at, x, y, size, color = INK, weight = 700, children}) => {
    const t = t01(f, at, at + 16, EASE.type);
    return (
      <div style={{position: 'absolute', left: x, top: y, overflow: 'hidden', paddingBottom: size * 0.14, whiteSpace: 'nowrap'}}>
        <div style={{transform: `translateY(${(1 - t) * 115}%)`, fontSize: size, lineHeight: 1.02, fontWeight: weight, color, letterSpacing: '-0.04em'}}>{children}</div>
      </div>
    );
  };

// A card lifted off the board with a soft contact shadow.
const Card: React.FC<{r: R; children: React.ReactNode}> = ({r, children}) => <>
  <div style={{position: 'absolute', left: r.x + 20, top: r.y + 40, width: r.w, height: r.h, background: 'rgba(20,18,15,.16)', filter: 'blur(30px)'}} />
  <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, transform: 'translateZ(24px)'}}>{children}</div>
</>;

const App: React.FC<{r: R; title: string; tone: string; tint: string; n: string; children?: React.ReactNode}> = ({r, title, tone, tint, n, children}) => (
  <Card r={r}>
    <div style={{position: 'absolute', inset: 0, background: tint}}>
      <div style={{height: 120, background: tone, display: 'flex', alignItems: 'center', gap: 16, padding: '0 40px', color: '#fff'}}>
        {[0, 1, 2].map((i) => <div key={i} style={{width: 18, height: 18, background: 'rgba(255,255,255,.45)'}} />)}
        <span style={{marginLeft: 24, fontSize: 64, fontWeight: 700, letterSpacing: '-0.03em'}}>{title}</span>
        <span style={{marginLeft: 'auto', fontSize: 36, opacity: 0.7}}>{n}</span>
      </div>
      {children}
    </div>
  </Card>
);

const Platform: React.FC<{i: number; label: string}> = ({i, label}) => {
  const {x, y} = ICONS[i];
  const st = {stroke: INK, strokeWidth: 4, fill: 'none'} as const;
  return (
    <div style={{position: 'absolute', left: x - 70, top: y - 90, width: 140, height: 200}}>
      <svg viewBox="0 0 140 140" width={140} height={140}>
        {i === 0 && <><rect x="20" y="28" width="100" height="64" {...st} /><path d="M8 102 H132 L124 112 H16 Z" {...st} /></>}
        {i === 1 && <><rect x="22" y="22" width="44" height="44" {...st} /><rect x="74" y="22" width="44" height="44" {...st} /><rect x="22" y="74" width="44" height="44" {...st} /><rect x="74" y="74" width="44" height="44" {...st} /></>}
        {i === 2 && <><rect x="43" y="18" width="54" height="104" rx="10" {...st} /><rect x="60" y="24" width="20" height="5" rx="2.5" fill={INK} /></>}
        {i === 3 && <><rect x="43" y="18" width="54" height="104" rx="5" {...st} /><rect x="67" y="25" width="6" height="6" fill={INK} /></>}
      </svg>
      <div style={{textAlign: 'center', fontSize: 26, color: INK, marginTop: 8}}>{label}</div>
    </div>
  );
};

// ---------- Inside Chromasmith: a separate dark 3D space ----------
const NW_TONES = [['#3a332b', '#2b2620', '#1e1b17'], ['#4a3f33', '#372f27', '#26211c'], ['#2a2622', '#201d1a', '#161412']];
const NW: {x: number; y: number; z: number; s: number; t: number; a: number; b: number}[] = (() => {
  const r = rnd(42); return Array.from({length: 30}, () => ({x: -0.4 + r() * 1.8, y: -0.4 + r() * 1.8, z: -1800 + r() * 1600, s: 60 + r() ** 1.5 * 340, t: Math.floor(r() * 3), a: r() * 360, b: (r() - 0.5) * 2}));
})();
const NewWorld: React.FC<{f: number; W: number; H: number; vertical?: boolean}> = ({f, W, H, vertical}) => {
  const ry = keys(f, [[614, 14], [700, -10, (t) => t]]), push = keys(f, [[614, -500], [700, 120, EASE.out]]);
  const pw = vertical ? W * 0.86 : W * 0.6, ph = pw * (1000 / 1520);
  const card = {x: vertical ? W * 0.07 : W * 0.33, y: vertical ? H * 0.26 : H * 0.5 - ph / 2};
  const perch = {x: card.x + pw - 110, y: card.y};
  const sq = (() => {
    const c = {x: W / 2, y: H / 2 + 45};
    if (f < 628) return {x: c.x, b: c.y, s: lerp(66, 90, t01(f, 620, 628)), q: 0};
    if (f < 690) { const a = arc(f, 628, 648, c.x, c.y, perch.x, perch.y, 260); return {x: a.x, b: a.y, s: 90, q: ring(f, 648, -0.08)}; }
    const a = arc(f, 690, 702, perch.x, perch.y, c.x, c.y, 160); return {x: a.x, b: a.y, s: 90, q: 0.1 * bump(f, 690, 698)};
  })();
  const sy = 1 + sq.q;
  return (
    <AbsoluteFill style={{background: '#15130f', perspective: 1400, overflow: 'hidden'}}>
      <AbsoluteFill style={{transformStyle: 'preserve-3d', transform: `translateZ(${push}px) rotateY(${ry}deg) rotateX(6deg)`}}>
        {NW.map((n, i) => (
          <div key={i} style={{position: 'absolute', left: n.x * W, top: n.y * H, transformStyle: 'preserve-3d', transform: `translateZ(${n.z}px) rotateX(${n.a + f * n.b}deg) rotateY(${n.a * 0.7 + f * n.b * 1.3}deg)`}}>
            <Box3 wx={n.s} wy={n.s} wz={n.s} c={NW_TONES[n.t]} edge={i % 3 === 0 ? 'rgba(242,239,232,.28)' : undefined} />
          </div>
        ))}
        <div style={{position: 'absolute', left: card.x, top: card.y, width: pw, height: ph, transform: `translateZ(60px) rotateY(${keys(f, [[614, -16], [700, -4]])}deg)`, boxShadow: '0 60px 120px rgba(0,0,0,.55)'}}>
          <Img src={staticFile('img/dogs-graded.png')} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
        <div style={{position: 'absolute', left: sq.x - (sq.s / sy) / 2, top: sq.b - sq.s * sy, width: sq.s / sy, height: sq.s * sy, background: VERM, transform: 'translateZ(62px)'}} />
      </AbsoluteFill>
      <Line f={f} at={650} x={vertical ? 72 : 96} y={vertical ? H - 440 : H - 300} size={vertical ? 96 : 104} color={C.paper}>Meet Chromasmith.</Line>
      <Line f={f} at={658} x={vertical ? 72 : 96} y={vertical ? H - 330 : H - 185} size={vertical ? 96 : 104} color={VERM}>One app.</Line>
    </AbsoluteFill>
  );
};

export const Ep1: React.FC<{vertical?: boolean}> = ({vertical}) => {
  const f = useCurrentFrame();
  const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
  const s = state(f);
  const cam = camera(f);
  const z = cam.z * (vertical ? 0.62 : 1);
  const cp = (x169: number, y169: number, x916: number, y916: number) => vertical ? {x: x916, y: y916} : {x: x169, y: y169};

  // ink trail of the square's recent path
  const trail: React.ReactNode[] = [];
  let prev: [number, number] | null = null;
  for (let k = 40; k >= 0; k--) {
    const p = state(f - k); const pt: [number, number] = [p.x, p.base - p.h / 2];
    if (prev && !p.hide && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 0.5 && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < 900 && f - k > 30) trail.push(<line key={k} x1={prev[0]} y1={prev[1]} x2={pt[0]} y2={pt[1]} stroke={INK} strokeWidth={2.4 / z} opacity={0.35 * (1 - k / 40) * (1 - t01(f, 826, 846))} />);
    prev = pt;
  }
  const p1 = cp(1360, 230, 2068, 420);

  // Portal: the square opens into Chromasmith, then the world folds back into the square.
  const M = Math.hypot(W, H) * 1.1;
  const portal = f < 614 || f >= 716 ? 0 : f < 626 ? lerp(66, M, EASE.in(t01(f, 614, 626, (t) => t))) : f < 700 ? M : lerp(M, W0 * 0.17 * (vertical ? 0.62 : 1), EASE.move(t01(f, 700, 716, (t) => t)));
  const inner = f < 626 ? t01(f, 616, 625) : f >= 700 ? 1 - t01(f, 703, 713) : 1;

  const scene = `translate(${W / 2}px, ${H / 2}px) rotateX(${cam.tilt}deg) rotateZ(${cam.roll}deg) scale3d(${z}, ${z}, ${z}) translate(${-cam.x}px, ${-cam.y}px)`;
  return (
    <AbsoluteFill style={{background: BG, overflow: 'hidden', fontFamily: FONT}}>
      <Audio src={staticFile('music/ep1.wav')} />
      <AbsoluteFill style={{perspective: 1800}}>
        <div style={{position: 'absolute', left: 0, top: 0, transformStyle: 'preserve-3d', transform: scene}}>
          <svg style={{position: 'absolute', left: -4000, top: -3000, overflow: 'visible'}} width={18000} height={10000}>
            <defs>
              <pattern id="dots" width="48" height="48" patternUnits="userSpaceOnUse" x="-4000" y="-3000"><rect x="23" y="23" width="2.4" height="2.4" fill={GRID} /></pattern>
              <pattern id="cross" width="240" height="240" patternUnits="userSpaceOnUse" x="-4000" y="-3000"><path d="M108 120 H132 M120 108 V132" stroke="#bfb7a5" strokeWidth="2.5" /></pattern>
            </defs>
            <rect x="0" y="0" width="18000" height="10000" fill="url(#dots)" />
            <rect x="0" y="0" width="18000" height="10000" fill="url(#cross)" />
          </svg>
          {[['01', 1300, -700], ['02', 1850, 860], ['03', 3850, 860], ['04', 5850, 860], ['05', 7850, 860], ['06', 5250, 2720]].map(([n, x, y]) => (
            <div key={n as string} style={{position: 'absolute', left: x as number, top: y as number, fontSize: 40, color: '#a59e8e'}}>{n}</div>
          ))}
          <Solids f={f} />

          {/* Logo lockup: ink block + wordmark + platforms (the red piece is the hero) */}
          <div style={{position: 'absolute', left: LOGO.x + 21 * u, top: LOGO.y + 21 * u, width: 48 * u, height: 44 * u, background: '#111111', transform: 'translateZ(24px)'}} />
          <div style={{position: 'absolute', left: -1000, width: 2000, top: 100, textAlign: 'center', fontSize: 96, fontWeight: 700, letterSpacing: '-0.04em', color: INK}}>CHRO-MA-SMITH</div>
          {['macOS', 'Windows', 'iOS', 'Android'].map((l, i) => <Platform key={l} i={i} label={l} />)}

          <Card r={PHOTO}><Img src={staticFile('img/dogs-original.png')} style={{width: '100%', height: '100%', objectFit: 'cover'}} /></Card>
          <Line f={f} at={62} x={p1.x} y={p1.y} size={76}>You shot something</Line>
          <Line f={f} at={65} x={p1.x} y={p1.y + 80} size={76}>beautiful.</Line>

          <App r={IMPORT} title="Import" tone="#55708f" tint="#dde3ea" n="App 1">
            {Array.from({length: 12}).map((_, i) => <div key={i} style={{position: 'absolute', left: 100 + (i % 6) * 220, top: 180 + Math.floor(i / 6) * 160, width: 190, height: 130, background: '#c3ccd7'}} />)}
            <div style={{position: 'absolute', left: 100, top: 560, fontSize: 40, color: '#55708f'}}>Importing 214 photos…</div>
            <div style={{position: 'absolute', left: 100, top: 640, width: IBAR.w, height: IBAR.h, background: '#c3ccd7'}} />
          </App>
          <App r={EDIT} title="Edit" tone="#5f7f5c" tint="#dfe7dc" n="App 2">
            {['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Colour'].map((l, i) => (
              <div key={l} style={{position: 'absolute', left: 120, top: 170 + i * 120, fontSize: 34, color: '#5f7f5c'}}>{l}
                <div style={{position: 'absolute', left: 0, top: 70, width: 640, height: 4, background: '#b9c8b4'}} />
              </div>
            ))}
            <div style={{position: 'absolute', left: 900, top: 190, width: 500, height: 333, background: '#c5d2c0'}} />
          </App>
          <App r={PLUGIN} title="Grain plugin" tone="#7a5f7d" tint="#e7dee7" n="App 3">
            <div style={{position: 'absolute', left: 820, top: 220, width: 560, height: 560, backgroundColor: '#d3c6d4', backgroundImage: 'radial-gradient(#9d8a9f 1px, transparent 1.4px)', backgroundSize: '9px 9px'}} />
            {['Size', 'Roughness', 'Amount'].map((l, i) => <div key={l} style={{position: 'absolute', left: 120, top: 240 + i * 130, fontSize: 34, color: '#7a5f7d'}}>{l}<div style={{position: 'absolute', left: 0, top: 70, width: 560, height: 4, background: '#cbb9cc'}} /></div>)}
          </App>
          <App r={EXPORT} title="Export" tone="#9a7b42" tint="#efe6d3" n="App 4">
            <div style={{position: 'absolute', left: 300, top: 380, fontSize: 52, color: '#9a7b42'}}>{f < 450 ? 'Exporting 3 of 12…' : f < 474 ? 'Export failed. Retrying…' : 'Export failed.'}</div>
            <div style={{position: 'absolute', left: 300, top: 560, width: EBAR.w, height: EBAR.h, background: '#dccba6'}} />
          </App>
          <Line f={f} at={150} x={IMPORT.x} y={IMPORT.y + IMPORT.h + 50} size={64} color="#55708f">Import in one app…</Line>
          <Line f={f} at={244} x={EDIT.x} y={EDIT.y + EDIT.h + 50} size={64} color="#5f7f5c">…edit in another…</Line>
          <Line f={f} at={334} x={PLUGIN.x} y={PLUGIN.y + PLUGIN.h + 50} size={64} color="#7a5f7d">…a plugin for grain…</Line>
          <Line f={f} at={426} x={EXPORT.x} y={EXPORT.y + EXPORT.h + 50} size={64} color="#9a7b42">…export, re-export.</Line>

          <Card r={APP}><Img src={staticFile('img/studio-app.webp')} style={{width: '100%', height: '100%'}} /></Card>

          <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', transform: 'translateZ(25px)'}} width={1} height={1}>{trail}</svg>
          <Hero s={s} id={vertical ? 'v' : 'h'} tilt={cam.tilt} />
        </div>
      </AbsoluteFill>
      {/* atmospheric haze: the far side of the tilted board fades into the paper */}
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${BG} 0%, rgba(231,226,215,0) 14%)`, opacity: 0.85 * clamp01(cam.tilt / 30)}} />
      {portal > 0 && (
        <div style={{position: 'absolute', left: W / 2 - portal / 2, top: H / 2 - portal / 2, width: portal, height: portal, background: VERM, overflow: 'hidden'}}>
          <div style={{position: 'absolute', left: portal / 2 - W / 2, top: portal / 2 - H / 2, width: W, height: H, opacity: inner}}>
            <NewWorld f={f} W={W} H={H} vertical={vertical} />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
