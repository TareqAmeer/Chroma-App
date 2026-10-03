// Ep 1 "Old vs New" — v9, the Reddit cut. 16:9, 24 fps, 22 s.
// Swiss rules: one 12-column grid, flush-left Gramatika, paper / ink / one red. Locked camera, hard cuts on the beat.
// The red square is the only colour and the only thing with character. The film finish is added in post (finish.mjs).
// First frame == last frame.
import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {CameraMotionBlur} from '@remotion/motion-blur';
import '../shared';
import {FONT} from '../theme';
import {EASE, bump, clamp, lerp, ring, t01} from './rig';

export const FILM_FPS = 24;
export const FILM_FRAMES = 528;

const PAPER = '#efebe3', INK = '#141312', GREY = '#8d887d', HAIR = 'rgba(20,19,18,.14)', RED = '#ff3b1f', BLACK = '#0d0c0b';
// 12 columns: 96px margins, 24px gutters, 122px columns.
const M = 96, G = 24, CW = 122;
const col = (i: number) => M + i * (CW + G);
const span = (n: number) => n * CW + (n - 1) * G;

// Beats at 24 fps: one bar = 48 frames. Cuts land on these.
const CUT = {photo: 40, table: 112, black: 300, snap: 336, field: 344, wipe: 384, app: 432, close: 456};

// ---------- the mark ----------
const MARK = {x: col(0), y: 300, s: 3.6};          // svg units -> px
const SLOT = {x: MARK.x + (36 + 21.5) * MARK.s, y: MARK.y + 77 * MARK.s, w: 43 * MARK.s, h: 45 * MARK.s};
const Mark: React.FC = () => (
  <svg viewBox="0 0 100 100" style={{position: 'absolute', left: MARK.x, top: MARK.y, width: 100 * MARK.s, height: 100 * MARK.s}}>
    <rect x="21" y="21" width="48" height="44" fill={INK} />
  </svg>
);
const Grad: React.FC = () => (
  <svg viewBox="36 32 43 45" preserveAspectRatio="none" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
    <defs>
      <clipPath id="gc"><rect x="36" y="32" width="33" height="33" /></clipPath>
      <radialGradient id="ga" cx="69" cy="32" r="41.25" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff1e0" /><stop offset=".35" stopColor="#ff6a3a" /><stop offset=".7" stopColor="#b0200e" /><stop offset="1" stopColor="#7a1208" /></radialGradient>
      <radialGradient id="gb" cx="69" cy="32" r="41.25" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff1e0" /><stop offset=".4" stopColor="#ff7a4c" /><stop offset="1" stopColor="#ff2a10" /></radialGradient>
    </defs>
    <g clipPath="url(#gc)">
      <polygon points="36,32 69,32 36,65" fill="url(#ga)" /><polygon points="69,32 69,65 36,65" fill="url(#gb)" />
      <line x1="36" y1="65" x2="69" y2="32" stroke="#fff1e0" strokeWidth=".35" opacity=".8" />
    </g>
  </svg>
);

// ---------- layout constants per shot ----------
const PH = {x: col(5), y: 168, w: span(7), h: Math.round(span(7) * 2 / 3)};        // the photo, shot 2 and the wipe
const ROW0 = 432, ROWH = 88;
const ROWS: [string, string, string, string][] = [
  ['01', 'Import', 'Application A', '12 min'],
  ['02', 'Grade', 'Application B', '34 min'],
  ['03', 'Grain', 'Plug-in C', '21 min'],
  ['04', 'Export', 'Application D', '9 min'],
  ['05', 'Export again', 'Application D', '9 min'],
];
const ROW_AT = [124, 148, 172, 196, 220];
const TOTAL_AT = 248;
const rowY = (i: number) => ROW0 + i * ROWH;
const RAW = {x: col(1), y: 0};                       // left edge of the "step" column

// ---------- the square ----------
type Sq = {x: number; b: number; w: number; h: number; rot: number; sat: number; blur: number; grad: number; q: number; hide?: boolean};
const home = (): Sq => ({x: SLOT.x, b: SLOT.y, w: SLOT.w, h: SLOT.h, rot: 0, sat: 1, blur: 0, grad: 1, q: 0});
const S = 72; // working size
// Jump on an arc, same time base on both axes so the apex sits mid-flight.
const jump = (f: number, a: number, b: number, x0: number, y0: number, x1: number, y1: number, h: number) => {
  const t = t01(f, a, b, EASE.move);
  return {x: lerp(x0, x1, t), b: lerp(y0, y1, t) - h * Math.sin(Math.PI * t), t, v: (x1 - x0)};
};
const PERCH = {x: PH.x + PH.w - 120, b: PH.y};
const square = (f: number): Sq => {
  const s = home();
  if (f < 30) { s.q = -0.12 * bump(f, 22, 30); s.rot = 3 * Math.sin((f - 10) * 0.9) * bump(f, 10, 20); return s; }
  if (f < CUT.table) {
    const j = jump(f, 30, 50, SLOT.x, SLOT.y, PERCH.x, PERCH.b, 140);  // apex stays under the header rule
    s.x = j.x; s.b = j.b; const k = EASE.move(j.t); s.w = lerp(SLOT.w, S, k); s.h = lerp(SLOT.h, S, k);
    s.grad = 1 - t01(f, 30, 38); s.rot = 10 * Math.sin(Math.PI * j.t);
    s.q = 0.14 * bump(f, 30, 38) + ring(f, 50, -0.16, 0.42, 0.9);
    if (f >= 64) { // two small hops, varied, then a lean towards the photo
      const h1 = jump(f, 64, 73, PERCH.x, PERCH.b, PERCH.x - 70, PERCH.b, 54), h2 = jump(f, 76, 84, PERCH.x - 70, PERCH.b, PERCH.x - 120, PERCH.b, 30);
      const h = f < 76 ? h1 : h2; s.x = h.x; s.b = h.b;
      s.q = ring(f, 73, -0.1, 0.45, 0.9) + ring(f, 84, -0.07, 0.45, 0.9) - 0.06 * bump(f, 60, 64);
      s.rot = -9 * t01(f, 90, 100, EASE.type);
    }
    return s;
  }
  s.grad = 0; s.w = S; s.h = S;
  if (f < CUT.black) { // through the table: each row costs it a little colour, size and focus
    let i = 0; for (let k = 0; k < ROWS.length; k++) if (f >= ROW_AT[k] - 8) i = k;
    const at = ROW_AT[i] - 8, fromY = i === 0 ? ROW0 - 40 : rowY(i - 1) + ROWH - 20, toY = rowY(i) + ROWH - 20;
    const lostAfter = (n: number) => n / ROWS.length;
    const size = lerp(S, 40, lostAfter(i + t01(f, at, at + 10)));
    const j = jump(f, at, at + 10, i === 0 ? -80 : col(0) + 30, fromY, col(0) + 30, toY, i === 0 ? 0 : 40);  // enters from the left edge, under the headline
    s.x = j.x; s.b = j.b; s.w = s.h = size;
    s.sat = 1 - 0.75 * lostAfter(i + t01(f, at, at + 10)); s.blur = 2.2 * lostAfter(i + t01(f, at, at + 10));
    s.q = 0.12 * bump(f, at - 3, at) + ring(f, at + 10, -0.12, 0.5, 0.9);
    // dragged along the row rule as each row's minutes tick up
    const drag = t01(f, at + 12, at + 22, EASE.drag) * (1 - t01(f, at + 22, at + 24, EASE.out));
    s.w = size * (1 + 1.4 * drag); s.h = size * (1 - 0.35 * drag); s.x += size * 0.7 * drag;
    if (f >= TOTAL_AT) { // slumps flat on the total rule
      const k = t01(f, TOTAL_AT + 6, TOTAL_AT + 26, EASE.drag);
      s.x = col(0) + 30 + 40 * k; s.b = lerp(rowY(4) + ROWH - 20, rowY(5) + 40, k); s.w = lerp(40, 120, k); s.h = lerp(40, 10, k); s.sat = 0.2; s.blur = 2.4;
    }
    return s;
  }
  const FLOOR = {x: col(2) + 60, b: 860};
  if (f < CUT.field) { // black: still, one heartbeat twitch, crouch, snap
    s.x = FLOOR.x; s.b = FLOOR.b; s.w = 120; s.h = 10; s.sat = 0.2; s.blur = 2.4;
    s.h += 4 * bump(f, 322, 326); s.w -= 6 * bump(f, 322, 326);
    if (f >= CUT.snap) { const g = t01(f, CUT.snap, CUT.snap + 4, EASE.out); s.w = lerp(120, S, g); s.h = lerp(10, S, g); s.sat = lerp(0.2, 1, g); s.blur = lerp(2.4, 0, g); s.q = ring(f, CUT.snap + 4, 0.22, 0.38, 1.1); }
    return s;
  }
  if (f < CUT.wipe) { s.hide = true; return s; } // it became the red field
  if (f < CUT.app) { // rides the wipe line across the photo
    const t = t01(f, CUT.wipe + 4, CUT.wipe + 34, EASE.move);
    s.x = PH.x + PH.w * t; s.b = PH.y; s.rot = 0; s.q = ring(f, CUT.wipe + 34, -0.1, 0.45, 0.9);
    return s;
  }
  if (f < CUT.close) { s.x = col(10) + 40; s.b = 196; s.w = s.h = 44; return s; } // sitting on the app's toolbar
  // home: arc back, overshoot, correct, drop in
  if (f < 492) {
    const j = jump(f, CUT.close + 8, 486, col(4), 620, SLOT.x, SLOT.y - 14, 300);
    s.x = j.x; s.b = j.b; const k = EASE.move(j.t); s.w = lerp(S, SLOT.w, k); s.h = lerp(S, SLOT.h, k); s.rot = -8 * Math.sin(Math.PI * j.t);
    s.q = 0.1 * bump(f, CUT.close + 2, CUT.close + 8);
    if (f >= 486) { s.x = SLOT.x; s.b = lerp(SLOT.y - 14, SLOT.y, t01(f, 486, 490, EASE.in)); s.w = SLOT.w; s.h = SLOT.h; }
    s.grad = t01(f, 480, 492, EASE.type);
    return s;
  }
  s.w = SLOT.w; s.h = SLOT.h; s.grad = 1;
  s.q = ring(f, 490, -0.12, 0.42, 0.85) * (1 - t01(f, 506, 510, (t) => t));
  return s;
};

const Square: React.FC<{s: Sq}> = ({s}) => {
  if (s.hide) return null;
  const sy = 1 + s.q, sx = 1 / sy, w = s.w * sx, h = s.h * sy; // volume preserved
  const filter = s.sat < 1 || s.blur > 0 ? `saturate(${s.sat}) brightness(${lerp(0.82, 1, s.sat)}) blur(${s.blur}px)` : undefined;
  return (
    <div style={{position: 'absolute', left: s.x - w / 2, top: s.b - h, width: w, height: h, transform: `rotate(${s.rot}deg)`, transformOrigin: '50% 100%', filter}}>
      <div style={{position: 'absolute', inset: 0, background: RED}} />
      {s.grad > 0 && <div style={{position: 'absolute', inset: 0, opacity: s.grad}}><Grad /></div>}
    </div>
  );
};

// ---------- type ----------
// Lines rise from the baseline through a mask, by whole lines.
const Line: React.FC<{f: number; at: number; x: number; y: number; size: number; color?: string; weight?: number; out?: number; track?: string; children: React.ReactNode}> =
  ({f, at, x, y, size, color = INK, weight = 700, out, track = '-0.035em', children}) => {
    const t = t01(f, at, at + 14, EASE.type), o = out ? t01(f, out, out + 10, EASE.in) : 0;
    return (
      <div style={{position: 'absolute', left: x, top: y, overflow: 'hidden', paddingBottom: size * 0.16, whiteSpace: 'nowrap'}}>
        <div style={{transform: `translateY(${(1 - t) * 110 - o * 110}%)`, fontSize: size, lineHeight: 1, fontWeight: weight, color, letterSpacing: track, fontFeatureSettings: '"tnum"'}}>{children}</div>
      </div>
    );
  };
const Meta: React.FC<{x: number; y: number; color?: string; children: React.ReactNode; align?: 'left' | 'right'; w?: number}> = ({x, y, color = INK, children, align = 'left', w}) =>
  <div style={{position: 'absolute', left: x, top: y, width: w, textAlign: align, fontSize: 21, lineHeight: 1, fontWeight: 400, color, letterSpacing: '0.01em', fontFeatureSettings: '"tnum"'}}>{children}</div>;
const Rule: React.FC<{x: number; y: number; w: number; t?: number; color?: string}> = ({x, y, w, t = 1, color = INK}) =>
  <div style={{position: 'absolute', left: x, top: y, width: w * t, height: 1.5, background: color}} />;

// Running header: same position in every shot, only the active field changes. It holds the film together.
const Header: React.FC<{f: number; dark?: boolean}> = ({f, dark}) => {
  const c = dark ? 'rgba(239,235,227,.78)' : INK, dim = dark ? 'rgba(239,235,227,.32)' : GREY;
  const part = f < CUT.photo ? 0 : f < CUT.table ? 1 : f < CUT.black ? 2 : f < CUT.wipe ? 3 : f < CUT.close ? 4 : 0;
  const labels = ['Chromasmith', 'The photo', 'The workflow', 'The low point', 'One app'];
  return <>
    <Meta x={col(0)} y={64} color={c}><b style={{fontWeight: 700}}>Chromasmith</b></Meta>
    <Meta x={col(3)} y={64} color={c}>Episode 01</Meta>
    <Meta x={col(5)} y={64} color={c}>Old / New</Meta>
    <Meta x={col(8)} y={64} color={part === 0 ? dim : c}>{part === 0 ? '—' : `${String(part).padStart(2, '0')}  ${labels[part]}`}</Meta>
    <Meta x={col(11)} y={64} w={CW} align="right" color={c}>{`${((f >= CUT.close ? 0 : f) / FILM_FPS).toFixed(1).padStart(4, '0')} s`}</Meta>
    <Rule x={M} y={100} w={1920 - 2 * M} color={dark ? 'rgba(239,235,227,.22)' : HAIR} />
  </>;
};
const Grid: React.FC<{dark?: boolean}> = ({dark}) => <>
  {Array.from({length: 13}).map((_, i) => {
    const x = i === 12 ? 1920 - M : col(i);
    return <div key={i} style={{position: 'absolute', left: x - 0.5, top: 0, width: 1, height: 1080, background: dark ? 'rgba(239,235,227,.035)' : 'rgba(20,19,18,.045)'}} />;
  })}
</>;

// ---------- shots ----------
const Lockup: React.FC<{f: number; cta: number}> = ({f, cta}) => <>
  <Mark />
  <div style={{position: 'absolute', left: col(5) - 6, top: 640, fontSize: 168, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1, color: INK}}>Chromasmith</div>
  <Rule x={col(5)} y={880} w={span(7)} color={HAIR} />
  <Meta x={col(5)} y={912} color={INK}>Film emulation, grading and RAW.</Meta>
  <Meta x={col(9)} y={912} color={INK}>
    <span style={{opacity: 1 - cta}}>Made for photographers.</span>
    <span style={{position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', opacity: cta}}>Free · macOS · Windows · iOS · Android</span>
  </Meta>
</>;

const PhotoShot: React.FC<{f: number}> = ({f}) => {
  const reveal = t01(f, CUT.photo, CUT.photo + 16, EASE.type);
  return <>
    <div style={{position: 'absolute', left: PH.x, top: PH.y, width: PH.w, height: PH.h, overflow: 'hidden', clipPath: `inset(0 0 ${100 - 100 * reveal}% 0)`}}>
      <Img src={staticFile('img/beach-raw.webp')} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.04 - 0.04 * reveal})`}} />
    </div>
    <Meta x={PH.x} y={PH.y + PH.h + 24} color={GREY}>Unedited RAW</Meta>
    <Line f={f} at={CUT.photo + 10} x={col(0)} y={168} size={92}>You shot</Line>
    <Line f={f} at={CUT.photo + 13} x={col(0)} y={168 + 96} size={92}>something</Line>
    <Line f={f} at={CUT.photo + 16} x={col(0)} y={168 + 192} size={92}>beautiful.</Line>
  </>;
};

const Table: React.FC<{f: number}> = ({f}) => {
  let mins = 0;
  ROWS.forEach((r, i) => { mins += parseInt(r[3]) * t01(f, ROW_AT[i] + 4, ROW_AT[i] + 20, (t) => t); });
  return <>
    <Line f={f} at={CUT.table + 2} x={col(0)} y={168} size={92}>Then it took</Line>
    <Line f={f} at={CUT.table + 5} x={col(0)} y={168 + 96} size={92} color={GREY}>four apps.</Line>
    <Meta x={col(1)} y={ROW0 - 36} color={GREY}>Step</Meta>
    <Meta x={col(5)} y={ROW0 - 36} color={GREY}>Software</Meta>
    <Meta x={col(10)} y={ROW0 - 36} w={span(2)} align="right" color={GREY}>Time</Meta>
    <Rule x={col(0)} y={ROW0 - 8} w={span(12)} t={t01(f, CUT.table + 4, CUT.table + 20, EASE.type)} />
    {ROWS.map((r, i) => {
      const at = ROW_AT[i], live = f >= at;
      if (!live) return null;
      const run = Math.round(parseInt(r[3]) * t01(f, at + 4, at + 20, (t) => t));
      return <React.Fragment key={i}>
        <Meta x={col(0)} y={rowY(i) + 28} color={GREY}>{r[0]}</Meta>
        <Line f={f} at={at} x={col(1)} y={rowY(i) + 14} size={48}>{r[1]}</Line>
        <Line f={f} at={at + 2} x={col(5)} y={rowY(i) + 22} size={34} weight={400} color={GREY}>{r[2]}</Line>
        <div style={{position: 'absolute', left: col(10), top: rowY(i) + 22, width: span(2), textAlign: 'right', fontSize: 34, color: INK, fontFeatureSettings: '"tnum"', opacity: t01(f, at + 2, at + 6)}}>{run} min</div>
        <Rule x={col(0)} y={rowY(i) + ROWH - 8} w={span(12)} t={t01(f, at, at + 12, EASE.type)} color={HAIR} />
      </React.Fragment>;
    })}
    {f >= TOTAL_AT && <>
      <Rule x={col(0)} y={rowY(5) + 2} w={span(12)} t={t01(f, TOTAL_AT, TOTAL_AT + 12, EASE.type)} />
      <Line f={f} at={TOTAL_AT + 4} x={col(1)} y={rowY(5) + 24} size={48}>Total</Line>
      <Line f={f} at={TOTAL_AT + 6} x={col(5)} y={rowY(5) + 32} size={34} weight={400} color={GREY}>4 apps, 1 photo</Line>
    </>}
    <div style={{position: 'absolute', left: col(9), top: rowY(5) + 18, width: span(3), textAlign: 'right', fontSize: 56, fontWeight: 700, letterSpacing: '-0.03em', color: INK, fontFeatureSettings: '"tnum"', opacity: f >= TOTAL_AT ? t01(f, TOTAL_AT + 4, TOTAL_AT + 10) : 0}}>{`${Math.floor(Math.round(mins) / 60)} h ${String(Math.round(mins) % 60).padStart(2, '0')} min`}</div>
  </>;
};

const Wipe: React.FC<{f: number}> = ({f}) => {
  const t = t01(f, CUT.wipe + 4, CUT.wipe + 34, EASE.move);
  return <>
    <div style={{position: 'absolute', left: PH.x, top: PH.y, width: PH.w, height: PH.h, overflow: 'hidden'}}>
      <Img src={staticFile('img/beach-raw.webp')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
      <div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - 100 * t}% 0 0)`}}>
        <Img src={staticFile('img/beach-graded.webp')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
      </div>
      {t > 0.005 && t < 0.995 && <div style={{position: 'absolute', left: `${t * 100}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: PAPER}} />}
    </div>
    <Meta x={PH.x} y={PH.y + PH.h + 24} color={GREY}>{t < 1 ? 'Grading…' : 'Film look · grain · halation · one app'}</Meta>
    <Line f={f} at={CUT.wipe} x={col(0)} y={168} size={92}>Meet</Line>
    <Line f={f} at={CUT.wipe + 3} x={col(0)} y={168 + 96} size={92}>Chromasmith.</Line>
    <Line f={f} at={CUT.wipe + 22} x={col(0)} y={PH.y + PH.h - 132} size={34} weight={400} color={GREY}>Looks, grain, halation,</Line>
    <Line f={f} at={CUT.wipe + 24} x={col(0)} y={PH.y + PH.h - 88} size={34} weight={400} color={GREY}>RAW and your library.</Line>
  </>;
};

const AppShot: React.FC<{f: number}> = ({f}) => {
  const t = t01(f, CUT.app, CUT.app + 14, EASE.type);
  const r = {x: col(1), y: 168, w: span(10), h: Math.round(span(10) * 1580 / 2874)};
  return <>
    <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, overflow: 'hidden', clipPath: `inset(0 0 ${100 - 100 * t}% 0)`, boxShadow: '0 0 0 1.5px rgba(20,19,18,.9)'}}>
      <Img src={staticFile('img/studio-app-hi.webp')} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
    </div>
    <Meta x={r.x} y={r.y + r.h + 24} color={GREY}>Chromasmith Studio — actual app, not a mock-up.</Meta>
  </>;
};

// ---------- film ----------
export const Ep1Film: React.FC = () => {
  const f = useCurrentFrame();
  const s = square(f);
  const dark = f >= CUT.black && f < CUT.wipe;
  const ctaIn = t01(f, 476, 486, EASE.type), ctaOut = t01(f, 508, 518, EASE.in);
  // the red field: the square grows to fill the frame, the line sits inside it, then it cuts to the wipe
  const fieldT = f >= CUT.field ? 1 : 0;  // hard cut to the red field on the downbeat (a growing square smeared into stepped ghosts)
  const side = lerp(S, 2400, fieldT), cx = lerp(col(2) + 60, 960, fieldT), cy = lerp(860 - S / 2, 540, fieldT);
  const fieldR = {x: cx - side / 2, y: cy - side / 2, w: side, h: side};  // the square itself, grown past the frame
  return (
    <AbsoluteFill style={{background: dark ? BLACK : PAPER, fontFamily: FONT, overflow: 'hidden'}}>
      {!dark && <Img src={staticFile('img/paper.png')} style={{position: 'absolute', inset: 0, width: 1920, height: 1080, mixBlendMode: 'multiply', opacity: 0.9}} />}
      <Grid dark={dark} />
      {f < CUT.photo && <Lockup f={f} cta={0} />}
      {f >= CUT.photo && f < CUT.table && <PhotoShot f={f} />}
      {f >= CUT.table && f < CUT.black && <Table f={f} />}
      {f >= CUT.wipe && f < CUT.app && <Wipe f={f} />}
      {f >= CUT.app && f < CUT.close && <AppShot f={f} />}
      {f >= CUT.close && <Lockup f={f} cta={ctaIn * (1 - ctaOut)} />}
      {!(f >= CUT.field && f < CUT.wipe) && <Header f={f} dark={dark} />}
      <Square s={s} />
      {f >= CUT.field && f < CUT.wipe && <>
        <div style={{position: 'absolute', left: fieldR.x, top: fieldR.y, width: fieldR.w, height: fieldR.h, background: RED}} />
        {f >= CUT.field && <>
          <Line f={f} at={CUT.field + 8} x={col(0)} y={600} size={300} color={PAPER} track="-0.055em">One app.</Line>
          <Meta x={col(0)} y={64} color={PAPER}><b style={{fontWeight: 700}}>Chromasmith</b></Meta>
          <Meta x={col(8)} y={64} color={PAPER}>04  One app</Meta>
        </>}
      </>}
    </AbsoluteFill>
  );
};

// 180-degree shutter: fast hops smear like a real camera, held frames stay crisp.
export const Ep1FilmBlur: React.FC = () => <CameraMotionBlur shutterAngle={180} samples={16}><Ep1Film /></CameraMotionBlur>;
