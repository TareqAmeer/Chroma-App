import React from 'react';
import {AbsoluteFill, Img, Sequence, random, staticFile, useCurrentFrame, delayRender, continueRender} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {C, FONT, img, prog} from './theme';
import {Full, Sfx, Words} from './ui';

// v3 — see promo/improvements.md. One beat = 20 frames (90 bpm @30fps); every scene length is a whole number of beats.
const BEAT = 20;
const S = {
  open: [0, 100], develop: [100, 100], pile: [200, 160], old: [360, 280], turn: [640, 80], lib: [720, 160],
  studio: [880, 500], print: [1380, 120], save: [1500, 180], devices: [1680, 120], end: [1800, 180],
} as const;
export const TOTAL = 1980;
const SILENT = [[0, 10], [630, 650], [1790, 1810]]; // drop the pulse before the big beats
const CHAPTERS: [number, string][] = [[200, '01 Library'], [360, '00 The old way'], [720, '01 Library'], [880, '02 Studio'], [1380, '03 Print'], [1500, '04 Savings'], [1680, '05 Anywhere']];

const fontHandle = delayRender('font');
Promise.all([
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaRegular.otf'), weight: '400'}),
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaBold.otf'), weight: '700'}),
]).then(() => continueRender(fontHandle));

const Photo: React.FC<{src: string; fit?: 'cover' | 'contain'; style?: React.CSSProperties}> = ({src, fit = 'cover', style}) => (
  <Img src={staticFile(img(src))} style={{position: 'absolute', width: '100%', height: '100%', objectFit: fit, ...style}} />
);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Centred card: one idea, 3–5 words, very large, one red key word (improvements 1–7) ──
const Card: React.FC<{text: string; red?: string; at?: number; size?: number; bg?: string; color?: string; label?: string}> = ({text, red, at = 0, size = 168, bg = C.bg, color = C.paper, label}) => {
  const f = useCurrentFrame();
  const words = text.split(' ');
  return (
    <Full bg={bg}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 540, transform: 'translateY(-50%)', textAlign: 'center', fontFamily: FONT}}>
        {label && <div style={{fontSize: 34, color: C.dim, marginBottom: 26, opacity: prog(f, at, 8)}}>{label}</div>}
        <div style={{fontSize: size, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1, color, whiteSpace: 'nowrap'}}>
          {words.map((w, i) => {
            const p = prog(f, at + i * 4, 9);
            return (
              <span key={i} style={{display: 'inline-block', margin: '0 0.12em', clipPath: 'inset(-10% -5% -20% -5%)'}}>
                <span style={{display: 'inline-block', transform: `translateY(${(1 - p) * 100}%)`, color: red && w.replace(/[.,?]/g, '') === red ? C.acc : color}}>{w}</span>
              </span>
            );
          })}
        </div>
      </div>
    </Full>
  );
};

// ── Swiss grid flash at chapter changes (22) + chapter index (15) ──
const GridFlash: React.FC = () => {
  const f = useCurrentFrame();
  const on = CHAPTERS.some(([at]) => f >= at && f < at + 3);
  const ch = [...CHAPTERS].reverse().find(([at]) => f >= at);
  const inOpen = f < 200;
  return (
    <>
      {on && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', gap: 24, padding: '0 120px', pointerEvents: 'none'}}>
          {Array.from({length: 12}).map((_, i) => <div key={i} style={{flex: 1, borderLeft: `1px solid ${C.acc}`, borderRight: `1px solid ${C.acc}`, opacity: 0.35}} />)}
        </div>
      )}
      {ch && !inOpen && f < 1800 && (
        <div style={{position: 'absolute', left: 120, top: 52, fontFamily: FONT, fontSize: 24, color: C.dim, letterSpacing: '0.02em'}}>{ch[1]}</div>
      )}
    </>
  );
};

// ── Cursor with click ring (17) ──
const Cursor: React.FC<{pts: {f: number; x: number; y: number; click?: boolean}[]}> = ({pts}) => {
  const f = useCurrentFrame();
  let x = pts[0].x, y = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (f >= pts[i - 1].f) { const t = prog(f, pts[i - 1].f, pts[i].f - pts[i - 1].f); x = lerp(pts[i - 1].x, pts[i].x, t); y = lerp(pts[i - 1].y, pts[i].y, t); }
  }
  const click = pts.filter((p) => p.click && f >= p.f && f < p.f + 14).pop();
  const r = click ? prog(f, click.f, 12) : 0;
  return (
    <>
      {click && <div style={{position: 'absolute', left: x - 40 * r, top: y - 40 * r, width: 80 * r, height: 80 * r, borderRadius: '50%', border: `4px solid ${C.acc}`, opacity: 1 - r}} />}
      <svg width={46} height={56} viewBox="0 0 23 28" style={{position: 'absolute', left: x - 3, top: y - 2, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.5))'}}>
        <path d="M2 2 L2 23 L7.5 18 L11 26 L14.5 24.5 L11 17 L18 17 Z" fill={C.paper} stroke={C.bg} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </>
  );
};

// ── Real Studio screenshot with a camera that pushes in on the control in use (16, 18, 19, 20) ──
// Screenshot space is 2000×1111; the photo canvas sits at (320,210)-(1396,934).
type Cam = {f: number; cx: number; cy: number; z: number};
const camAt = (f: number, keys: Cam[]) => {
  let c = keys[0];
  for (let i = 1; i < keys.length; i++) if (f >= keys[i - 1].f) {
    const t = prog(f, keys[i - 1].f, keys[i].f - keys[i - 1].f);
    c = {f, cx: lerp(keys[i - 1].cx, keys[i].cx, t), cy: lerp(keys[i - 1].cy, keys[i].cy, t), z: lerp(keys[i - 1].z, keys[i].z, t)};
  }
  return c;
};
const Shot: React.FC<{src: string; photo: string; cam: Cam[]; cursor?: {f: number; x: number; y: number; click?: boolean}[]; dim?: number; children?: React.ReactNode}> = ({src, photo, cam, cursor, dim = 0, children}) => {
  const f = useCurrentFrame();
  const c = camAt(f, cam);
  const k = (1920 / 2000) * c.z; // px per screenshot unit
  return (
    <Full>
      <div style={{position: 'absolute', left: 960 - c.cx * k, top: 540 - c.cy * k, width: 2000, height: 1111, transform: `scale(${k})`, transformOrigin: '0 0'}}>
        <Photo src={src} />
        <div style={{position: 'absolute', left: 320, top: 210, width: 1076, height: 724, overflow: 'hidden'}}><Photo src={photo} /></div>
        {children}
      </div>
      {cursor && <CursorIn k={k} c={c} pts={cursor} />}
      {dim > 0 && <div style={{position: 'absolute', inset: 0, background: C.bg, opacity: dim}} />}
    </Full>
  );
};
// cursor drawn in screen space so it stays a constant, readable size while the camera zooms
const CursorIn: React.FC<{k: number; c: Cam; pts: {f: number; x: number; y: number; click?: boolean}[]}> = ({k, c, pts}) => (
  <Cursor pts={pts.map((p) => ({...p, x: 960 + (p.x - c.cx) * k, y: 540 + (p.y - c.cy) * k}))} />
);

// ── 1. Open: silence, shutter, the photo lands at 70% width (8, 9, 11) ──
const PH = {w: 1344, h: 896};
const Open: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      {f >= 10 && <div style={{position: 'absolute', left: 960 - PH.w / 2, top: 540 - PH.h / 2, width: PH.w, height: PH.h, overflow: 'hidden'}}><Photo src="main1-1600.webp" /></div>}
      {f >= 10 && f < 12 && <div style={{position: 'absolute', inset: 0, background: C.paper, opacity: 0.85}} />}
      <Sfx at={10} name="camera" />
    </Full>
  );
};

// ── 2. Develop: paper strip slides across the same framed print (10) ──
const Develop: React.FC = () => {
  const f = useCurrentFrame();
  const x = prog(f, 10, 34);
  const tag = (t: string, right: boolean, on: boolean) => (
    <span style={{position: 'absolute', top: 24, [right ? 'right' : 'left']: 24, fontFamily: FONT, fontSize: 30, padding: '6px 14px', background: on ? C.paper : C.bg, color: on ? C.bg : C.paper}}>{t}</span>
  );
  return (
    <Full>
      <div style={{position: 'absolute', left: 960 - PH.w / 2, top: 540 - PH.h / 2, width: PH.w, height: PH.h, overflow: 'hidden'}}>
        <Photo src="main1-1600.webp" />
        <Photo src="main5-1600.webp" style={{clipPath: `inset(0 ${100 - x * 100}% 0 0)`}} />
        <div style={{position: 'absolute', top: 0, bottom: 0, left: `${x * 100}%`, width: 14, marginLeft: -7, background: C.paper, opacity: x > 0 && x < 1 ? 1 : 0}} />
        {x < 0.5 ? tag('Before', false, false) : tag('After', true, true)}
      </div>
      <Sfx at={10} name="whoosh" />
      <Sfx at={44} name="pin" vol={0.6} />
    </Full>
  );
};

// ── Grid geometry ──
type Cell = {x: number; y: number; s: number; i: number; r: number; c: number};
const grid = (cols: number, rows: number, area = {x: 120, y: 120, w: 1680, h: 840}, gap = 6, groupGap = 0, groupRows = 4): Cell[] => {
  const groups = Math.ceil(rows / groupRows) - 1;
  const s = Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (rows - 1) - groupGap * groups) / rows);
  const W = cols * s + gap * (cols - 1), H = rows * s + gap * (rows - 1) + groupGap * groups;
  const ox = area.x + (area.w - W) / 2, oy = area.y + (area.h - H) / 2;
  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    out.push({x: ox + c * (s + gap), y: oy + r * (s + gap) + Math.floor(r / groupRows) * groupGap, s, i: r * cols + c, r, c});
  return out;
};

// ── 3. Pile: the photo shrinks into one box and the grid floods (14) ──
const WAVES = [[4, 2], [8, 4], [16, 8], [32, 16]];
const Pile: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 80) return f < 120 ? <Card text="2,481 photos." red="2,481" at={80 - 80} /> : <Card text="Which one?" red="one" at={0} />;
  const shrink = prog(f, 0, 16);
  const w = Math.min(3, Math.floor(Math.max(0, f - 14) / 16));
  const [cols, rows] = WAVES[w];
  const cells = grid(cols, rows);
  const home = cells[Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
  return (
    <Full>
      {f >= 14 && cells.map((b) => {
        const p = prog(f, 14 + w * 16 + random(`p${w}-${b.i}`) * 10, 5);
        return <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: C.paper, transform: `scale(${p})`}} />;
      })}
      <div style={{position: 'absolute', left: lerp(960 - PH.w / 2, home.x, shrink), top: lerp(540 - PH.h / 2, home.y, shrink), width: lerp(PH.w, home.s, shrink), height: lerp(PH.h, home.s, shrink), overflow: 'hidden'}}>
        <Photo src="main5-1600.webp" />
      </div>
      <Sfx at={0} name="whoosh" vol={0.6} />
      {WAVES.map((_, k) => <Sfx key={k} at={14 + k * 16} name="tick" vol={0.5 + k * 0.15} />)}
      <Sfx at={30} name="ratchet" vol={0.4} />
    </Full>
  );
};

// ── 4. Old workflow, shown before the studio (13) ──
const OLD = [
  ['Adobe Cloud', 'Upload'], ['Lightroom', 'Find'], ['Lightroom', 'Edit colour'], ['Lightroom', 'Export'],
  ['Dehancer', 'Import'], ['Dehancer', 'Grain + glow'], ['Dehancer', 'Export'], ['Darkroom', 'Import'],
  ['Darkroom', 'Border'], ['Darkroom', 'Export'], ['Darkroom', 'Border 2'], ['Darkroom', 'Export'],
];
const BW = 250, BH = 150, BG = 14, BX = (1920 - (6 * BW + 5 * BG)) / 2, BY = 380;
const boxPos = (i: number) => ({x: BX + (i % 6) * (BW + BG), y: BY + Math.floor(i / 6) * (BH + BG)});
const OldBox: React.FC<{i: number; style?: React.CSSProperties}> = ({i, style}) => {
  const [app, step] = OLD[i], ex = step === 'Export';
  return (
    <div style={{position: 'absolute', width: BW, height: BH, padding: '14px 18px', boxSizing: 'border-box', fontFamily: FONT, background: ex ? C.rej : C.paper, color: ex ? C.paper : C.bg, ...boxPos(i) && {left: boxPos(i).x, top: boxPos(i).y}, ...style}}>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 22, opacity: 0.7}}><span>{app}</span><span>{String(i + 1).padStart(2, '0')}</span></div>
      <div style={{fontSize: 36, fontWeight: 700, marginTop: 44}}>{step}</div>
    </div>
  );
};
const Old: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 160) {
    const cards: [number, string, string][] = [[160, '3 apps.', '3'], [200, '12 steps.', '12'], [240, '4 exports.', '4']];
    const [at, t, r] = [...cards].reverse().find(([a]) => f >= a)!;
    return <><Card text={t} red={r} at={at - at} /><Sfx at={0} name="clack" /></>;
  }
  const n = Math.min(12, Math.floor(Math.max(0, f - 10) / 10) + 1);
  const exports = OLD.slice(0, n).filter((s) => s[1] === 'Export').length;
  const cost = [12, 30, 30, 30, 61, 61, 61, 83, 83, 83, 83, 83][n - 1];
  return (
    <Full>
      {OLD.map((_, i) => { const p = prog(f, 10 + i * 10, 6); return <OldBox key={i} i={i} style={{opacity: p, transform: `translateY(${(1 - p) * 20}px)`}} />; })}
      <div style={{position: 'absolute', left: BX, top: 180, display: 'flex', gap: 120, fontFamily: FONT}}>
        {[['per month', `$${cost}`], ['per photo', `${Math.round(n * 22 / 12)} min`], ['quality', `${100 - exports * 3}%`]].map(([l, v]) => (
          <div key={l}><div style={{fontSize: 26, color: C.dim}}>{l}</div><div style={{fontSize: 80, color: C.paper, fontWeight: 700, letterSpacing: '-0.03em'}}>{v}</div></div>
        ))}
      </div>
      {OLD.map((s, i) => <Sfx key={i} at={10 + i * 10} name={s[1] === 'Export' ? 'thud' : 'clack'} vol={s[1] === 'Export' ? 0.5 : 0.45} />)}
    </Full>
  );
};

// ── 5. Turn: silence, everything collapses into one red square (25, 28) ──
const Turn: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 40) return <Card text="One app." red="One" at={0} />;
  const c = prog(f, 12, 16);
  return (
    <Full>
      {f >= 10 && OLD.map((_, i) => { const p = boxPos(i); return <OldBox key={i} i={i} style={{left: lerp(p.x, 960 - BW / 2, c), top: lerp(p.y, 462, c), opacity: 1 - c}} />; })}
      {f >= 26 && <div style={{position: 'absolute', left: 960 - 120, top: 540 - 120, width: 240, height: 240, background: C.acc, transform: `scale(${prog(f, 26, 8)})`}} />}
      <Sfx at={12} name="ratchet" vol={0.5} />
      <Sfx at={26} name="thud" />
    </Full>
  );
};

// ── 6. Library: sorted for you, find it, flip ──
const SORT_AREA = {x: 620, y: 140, w: 1180, h: 800};
const SHOOTS = ['12 Mar · Brighton', '28 Apr · Annecy', '09 Jun · Canal walk', '21 Aug · Wedding'];
const TARGET = {r: 9, c: 14};
const kind = (i: number) => { const v = random(`k${i}`); return v < 0.2 ? 'rej' : v > 0.9 ? 'fav' : 'keep'; };
const Lib: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 80 && f < 120) return <Card text="Find it." red="it" at={0} />;
  const cells = grid(22, 16, SORT_AREA, 5, 28);
  const t = cells.find((b) => b.r === TARGET.r && b.c === TARGET.c)!;
  if (f >= 120) {
    const rot = prog(f, 122, 12) * 180, g = prog(f, 134, 18);
    const w = lerp(260, PH.w * 0.62, g), h = lerp(260, PH.h * 0.62, g);
    return (
      <Full>
        <div style={{position: 'absolute', left: 960 - w / 2, top: 540 - h / 2, width: w, height: h, perspective: 2400}}>
          <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${rot}deg)`}}>
            <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', background: C.acc}} />
            <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', overflow: 'hidden'}}><Photo src="main1-1600.webp" /></div>
          </div>
        </div>
        <Sfx at={122} name="flip" />
      </Full>
    );
  }
  const sorted = prog(f, 0, 22), tint = prog(f, 54, 8), red = prog(f, 0, 14);
  return (
    <Full>
      {cells.map((b) => {
        const k = kind(b.i);
        const isT = b === t;
        return (
          <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: isT ? C.acc : sorted > 0.5 && k === 'rej' ? C.rej : C.paper, transform: isT ? `scale(${lerp(4, 1, red)})` : undefined, zIndex: isT ? 2 : 1}}>
            {k === 'fav' && sorted > 0.5 && !isT && <div style={{position: 'absolute', right: 0, top: 0, width: b.s * 0.45, height: b.s * 0.45, background: C.fav}} />}
            {!isT && tint > 0 && <div style={{position: 'absolute', inset: 0, background: C.line, opacity: tint}} />}
          </div>
        );
      })}
      {SHOOTS.map((s, g) => <Words key={g} text={s} at={16 + g * 6} every={2} size={34} color={C.paper} style={{position: 'absolute', left: 120, top: cells[g * 4 * 22].y, opacity: 1 - tint * 0.8}} />)}
      <div style={{position: 'absolute', left: 120, bottom: 120, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT, fontSize: 28, color: C.mid, opacity: prog(f, 30, 8) * (1 - tint * 0.8)}}>
        <span style={{display: 'flex', alignItems: 'center', gap: 12}}><i style={{width: 22, height: 22, background: C.fav}} />Favourite</span>
        <span style={{display: 'flex', alignItems: 'center', gap: 12}}><i style={{width: 22, height: 22, background: C.rej}} />Reject</span>
      </div>
      {[0, 8, 16, 24].map((t2) => <Sfx key={t2} at={t2} name="clack" vol={0.6} />)}
      <Sfx at={54} name="thud" vol={0.7} />
    </Full>
  );
};

// ── 7. Studio: real screenshots, zoom on each control, cursor, then the X-ray (16–21) ──
const WIDE: Cam = {f: 0, cx: 1000, cy: 555, z: 1};
const Studio: React.FC = () => {
  const f = useCurrentFrame();
  // a) Look: wide → push in on the look thumbnails → click
  if (f < 80) {
    const ph = f >= 52 ? 'main3-1600.webp' : 'main1-1600.webp';
    return (
      <>
        <Shot src="studio-1.webp" photo={ph} cam={[{...WIDE, f: 0}, {...WIDE, f: 18}, {f: 40, cx: 1700, cy: 560, z: 2.1}]}
          cursor={[{f: 0, x: 900, y: 700}, {f: 30, x: 1300, y: 600}, {f: 48, x: 1780, y: 470, click: true}, {f: 80, x: 1780, y: 470}]}>
          {f >= 52 && <div style={{position: 'absolute', left: 1712, top: 404, width: 156, height: 112, outline: `6px solid ${C.acc}`}} />}
        </Shot>
        <Sfx at={0} name="click" />
        <Sfx at={50} name="ratchet" vol={0.6} />
      </>
    );
  }
  if (f < 120) return <Card text="Pick a film." red="film" at={0} />;
  if (f < 160) return <Card text="133 looks." red="133" at={0} />;
  // c) Texture: push in on the grain slider and drag it
  if (f < 240) {
    const lf = f - 160, drag = prog(lf, 40, 24);
    return (
      <>
        <Shot src="studio-4.webp" photo={lf >= 40 ? 'main4-1600.webp' : 'main3-1600.webp'} cam={[{f: 0, cx: 1000, cy: 555, z: 1}, {f: 26, cx: 1700, cy: 830, z: 2.6}].map((c) => ({...c, f: c.f + 160}))}
          cursor={[{f: 160, x: 1200, y: 700}, {f: 196, x: 1646, y: 868, click: true}, {f: 224, x: 1760, y: 868}, {f: 240, x: 1760, y: 868}]}>
          <div style={{position: 'absolute', left: 1600, top: 820, width: 300, height: 90, background: '#151513'}} />
          <div style={{position: 'absolute', left: 1620, top: 866, width: 250, height: 3, background: C.line}} />
          <div style={{position: 'absolute', left: 1620, top: 866, width: lerp(26, 140, drag), height: 3, background: C.acc}} />
          <div style={{position: 'absolute', left: 1620 + lerp(26, 140, drag) - 7, top: 860, width: 14, height: 14, background: C.paper}} />
          <div style={{position: 'absolute', left: 1840, top: 828, fontFamily: FONT, fontSize: 20, color: C.paper}}>{Math.round(lerp(8, 34, drag))}</div>
        </Shot>
        <Sfx at={36} name="click" />
        <Sfx at={40} name="hiss" vol={0.9} />
      </>
    );
  }
  if (f < 280) return <Card text="Add grain." red="grain" at={0} />;
  // e) X-ray: the real window dims and the glow controls lift out into the simplified layout
  if (f < 380) {
    const lf = f - 280, x = prog(lf, 0, 18), split = prog(lf, 30, 20);
    return (
      <>
        <Shot src="studio-2.webp" photo="main4-1600.webp" cam={[{...WIDE, f: 280}]} dim={x * 0.88} />
        <div style={{position: 'absolute', left: 120, top: 150, width: 1080, height: 720, overflow: 'hidden', opacity: x}}>
          <Photo src="main4-1600.webp" />
          <Photo src="main5-1600.webp" style={{clipPath: `inset(0 0 0 ${100 - 50 * split}%)`}} />
          <div style={{position: 'absolute', top: 0, bottom: 0, left: `${100 - 50 * split}%`, width: 5, background: C.paper}} />
        </div>
        <div style={{position: 'absolute', left: 1290, top: 260, width: 510, fontFamily: FONT, opacity: x}}>
          {['Halation', 'Bloom'].map((n, i) => {
            const v = prog(lf, 34 + i * 12, 30);
            return (
              <div key={n} style={{marginBottom: 70}}>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 52, color: C.paper, fontWeight: 700, letterSpacing: '-0.02em'}}><span>{n}</span><span style={{color: C.acc}}>{Math.round(v * (i ? 42 : 58))}</span></div>
                <div style={{height: 8, background: C.line, marginTop: 18}}><div style={{width: `${v * (i ? 42 : 58)}%`, height: 8, background: C.acc}} /></div>
              </div>
            );
          })}
        </div>
        <Sfx at={0} name="whoosh" vol={0.7} />
        <Sfx at={34} name="swell" />
      </>
    );
  }
  if (f < 420) return <Card text="Make it glow." red="glow" at={0} />;
  // f) Output: push in on Border, click the toggle
  if (f < 460) {
    return (
      <>
        <Shot src="studio-5.webp" photo={f >= 444 ? 'main6-1600.webp' : 'main5-1600.webp'} cam={[{f: 420, cx: 1000, cy: 555, z: 1}, {f: 436, cx: 1640, cy: 650, z: 2.4}]}
          cursor={[{f: 420, x: 1300, y: 700}, {f: 440, x: 1852, y: 654, click: true}, {f: 460, x: 1852, y: 654}]} />
        <Sfx at={22} name="click" />
        <Sfx at={24} name="camera" vol={0.6} />
      </>
    );
  }
  return <Card text="Frame it." red="Frame" at={0} />;
};

// ── 8. Print: slides onto the wall, then the card ──
const PrintScene: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 80) return <Card text="Print it." red="Print" at={0} bg={C.paper} color={C.bg} />;
  const frame = (x: number, y: number, w: number, h: number, src: string, at: number, mat = 18) => (
    <div style={{position: 'absolute', left: x, top: y - (1 - prog(f, at, 16)) * 800, width: w, height: h, background: '#fbfaf6', padding: mat, boxSizing: 'border-box', boxShadow: '0 30px 60px rgba(11,11,10,.22)'}}>
      <div style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}><Photo src={src} /></div>
    </div>
  );
  return (
    <Full bg={C.paper}>
      {frame(120, 360, 440, 320, 'lib02.webp', 12)}
      {frame(1360, 360, 440, 320, 'lib05.webp', 18)}
      {frame(600, 240, 720, 500, 'main6-1600.webp', 0, 0)}
      <Sfx at={0} name="whoosh" />
      <Sfx at={16} name="pin" />
      <Sfx at={28} name="pin" vol={0.6} />
      <Sfx at={34} name="pin" vol={0.6} />
    </Full>
  );
};

// ── 9. Savings as kinetic number cards (26) ──
const NUMS = [{label: 'Subscriptions per month', a: '$83', b: '$0'}, {label: 'Time per photo', a: '22 min', b: '2 min'}, {label: 'Quality kept', a: '88%', b: '100%'}];
const Save: React.FC = () => {
  const f = useCurrentFrame();
  const i = Math.min(2, Math.floor(f / 60)), lf = f - i * 60, n = NUMS[i];
  const strike = prog(lf, 14, 8), drop = prog(lf, 26, 10);
  return (
    <Full>
      <div style={{position: 'absolute', left: 0, right: 0, top: 540, transform: 'translateY(-50%)', textAlign: 'center', fontFamily: FONT}}>
        <div style={{fontSize: 34, color: C.dim, marginBottom: 20}}>{n.label}</div>
        <div style={{position: 'relative', height: 280, fontSize: 280, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1}}>
          <div style={{position: 'absolute', left: 0, right: 0, color: C.paper, opacity: drop > 0 ? 0 : 1}}>
            <span style={{position: 'relative'}}>{n.a}<span style={{position: 'absolute', left: -10, top: '52%', height: 14, width: `calc(${strike * 100}% + 20px)`, background: C.acc}} /></span>
          </div>
          <div style={{position: 'absolute', left: 0, right: 0, color: C.acc, opacity: drop, transform: `translateY(${(1 - drop) * -80}px)`}}>{n.b}</div>
        </div>
      </div>
      {[0, 1, 2].map((k) => <Sfx key={k} at={k * 60 + 14} name="strike" />)}
      {[0, 1, 2].map((k) => <Sfx key={`p${k}`} at={k * 60 + 30} name="ping" vol={0.5} />)}
    </Full>
  );
};

// ── 10. Anywhere ──
const Devices: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 80) return <Card text="Edit anywhere." red="anywhere" at={0} />;
  const show = (at: number): React.CSSProperties => ({position: 'absolute', opacity: prog(f, at, 8), transform: `translateY(${(1 - prog(f, at, 12)) * 40}px)`});
  const label = (t: string) => <div style={{fontFamily: FONT, fontSize: 36, color: C.paper, marginTop: 22}}>{t}</div>;
  return (
    <Full>
      <div style={{...show(4), left: 120, top: 200}}>
        <div style={{width: 840, height: 470, border: `10px solid ${C.line}`, borderBottomWidth: 18, position: 'relative'}}><Photo src="studio-1.webp" /></div>
        <div style={{width: 960, height: 16, marginLeft: -60, background: C.line}} />
        {label('Mac and Windows')}
      </div>
      <div style={{...show(20), left: 1060, top: 180}}>
        <div style={{width: 250, height: 540, border: `10px solid ${C.line}`, borderRadius: 38, overflow: 'hidden', position: 'relative'}}><Photo src="mobile.webp" /></div>
        {label('iPhone')}
      </div>
      <div style={{...show(36), left: 1380, top: 200}}>
        <div style={{width: 420, height: 28, background: C.line, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, boxSizing: 'border-box'}}>{[C.acc, C.dim, C.dim].map((c, i) => <i key={i} style={{width: 10, height: 10, borderRadius: 5, background: c}} />)}</div>
        <div style={{width: 420, height: 280, position: 'relative', border: `4px solid ${C.line}`, borderTop: 0, boxSizing: 'border-box'}}><Photo src="library.webp" /></div>
        {label('Any browser')}
      </div>
      {[4, 20, 36].map((t) => <Sfx key={t} at={t} name="clack" />)}
    </Full>
  );
};

// ── 11. End: the logo forms from the two squares, then the CTA card (25, 30) ──
const PLATFORMS = ['Mac', 'Windows', 'iOS', 'Web'];
const End: React.FC = () => {
  const f = useCurrentFrame();
  const m = prog(f, 10, 18), L = 220;
  return (
    <Full>
      <div style={{position: 'absolute', left: 960 - L / 2, top: 150, width: L, height: L, opacity: f >= 10 ? 1 : 0}}>
        <div style={{position: 'absolute', left: lerp(-500, 0.21 * L, m), top: 0.21 * L, width: 0.48 * L, height: 0.44 * L, background: '#f2f0ea'}} />
        <div style={{position: 'absolute', left: lerp(700, 0.36 * L, m), top: 0.32 * L, width: 0.43 * L, height: 0.45 * L, background: C.acc}} />
        {m >= 1 && <Img src={staticFile(img('chromasmith-logo-dark.svg'))} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />}
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 400, textAlign: 'center', fontFamily: FONT, fontSize: 64, fontWeight: 700, color: C.paper, letterSpacing: '-0.03em', opacity: prog(f, 28, 8)}}>CHRO-MA-SMITH</div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 520, textAlign: 'center', fontFamily: FONT, fontSize: 150, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1}}>
        {['Download', 'free.'].map((w, i) => {
          const p = prog(f, 44 + i * 4, 9);
          return <span key={w} style={{display: 'inline-block', margin: '0 0.12em', clipPath: 'inset(-10% -5% -20% -5%)'}}><span style={{display: 'inline-block', transform: `translateY(${(1 - p) * 100}%)`, color: i ? C.acc : C.paper}}>{w}</span></span>;
        })}
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 730, display: 'flex', justifyContent: 'center', gap: 16}}>
        {PLATFORMS.map((p, i) => <div key={p} style={{fontFamily: FONT, fontSize: 44, padding: '16px 36px', background: C.paper, color: C.bg, transform: `scaleY(${prog(f, 64 + i * 5, 7)})`, transformOrigin: '50% 100%'}}>{p}</div>)}
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 880, textAlign: 'center', fontFamily: FONT, fontSize: 38, color: C.mid, opacity: prog(f, 92, 10)}}>tareqameer.github.io/Chroma-App</div>
      <Sfx at={10} name="whoosh" vol={0.6} />
      <Sfx at={28} name="pin" />
      {PLATFORMS.map((_, i) => <Sfx key={i} at={64 + i * 5} name="tick" vol={0.6} />)}
      <Sfx at={92} name="tone" />
    </Full>
  );
};

// ── Low pulse click track (29) ──
const Pulse: React.FC = () => (
  <>
    {Array.from({length: Math.floor(TOTAL / BEAT)}).map((_, i) => {
      const at = i * BEAT;
      if (SILENT.some(([a, b]) => at >= a && at < b) || at >= 1800) return null;
      return <Sfx key={i} at={at} name="pulse" vol={0.22} />;
    })}
  </>
);

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {([['open', Open], ['develop', Develop], ['pile', Pile], ['old', Old], ['turn', Turn], ['lib', Lib], ['studio', Studio], ['print', PrintScene], ['save', Save], ['devices', Devices], ['end', End]] as const).map(([k, Comp]) => (
      <Sequence key={k} from={S[k][0]} durationInFrames={S[k][1]}><Comp /></Sequence>
    ))}
    <GridFlash />
    <Pulse />
  </AbsoluteFill>
);
