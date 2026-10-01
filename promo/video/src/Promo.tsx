import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, delayRender, continueRender} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {C, FONT, img, prog} from './theme';
import {Full, Sfx} from './ui';

// v4 — built from promo/script.md (scene numbers match the script table).
const S = {
  open: [0, 75], flat: [75, 75], film: [150, 90], apps: [240, 90], loss: [330, 90], reveal: [420, 90], local: [510, 60],
  lib: [570, 120], looks: [690, 150], grain: [840, 120], glow: [960, 120], border: [1080, 90], exp: [1170, 90],
  save: [1260, 180], devices: [1440, 150], museum: [1590, 145], end: [1735, 150],
} as const;
export const TOTAL = 1885;

const fontHandle = delayRender('font');
Promise.all([
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaRegular.otf'), weight: '400'}),
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaBold.otf'), weight: '700'}),
]).then(() => continueRender(fontHandle));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const Photo: React.FC<{src: string; fit?: 'cover' | 'contain'; style?: React.CSSProperties}> = ({src, fit = 'cover', style}) => (
  <Img src={staticFile(img(src))} style={{position: 'absolute', width: '100%', height: '100%', objectFit: fit, ...style}} />
);
const Box: React.FC<{x: number; y: number; w: number; h: number; style?: React.CSSProperties; children?: React.ReactNode}> = ({x, y, w, h, style, children}) => (
  <div style={{position: 'absolute', left: x, top: y, width: w, height: h, overflow: 'hidden', ...style}}>{children}</div>
);

// ── Swiss type devices ────────────────────────────────────────────────────────
// Line: words enter on one baseline. Each new word opens its own width (pushing the
// centred line along) and rises from behind the baseline mask. `red` words take the accent;
// `big` scales one word up for typographic contrast.
const Line: React.FC<{text: string; at?: number; every?: number; size?: number; red?: string[]; color?: string; y?: number; big?: string}> = ({
  text, at = 0, every = 5, size = 120, red = [], color = C.paper, y = 540, big,
}) => {
  const f = useCurrentFrame();
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: y, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center', alignItems: 'baseline', fontFamily: FONT, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.08, whiteSpace: 'nowrap'}}>
      {text.split(' ').map((w, i) => {
        const open = prog(f, at + i * every, 8), rise = prog(f, at + i * every + 2, 9);
        const key = w.replace(/[.,?]/g, '');
        return (
          <span key={i} style={{display: 'inline-block', maxWidth: `${open * 1400}px`, overflow: 'hidden', paddingBottom: '0.12em', marginBottom: '-0.12em'}}>
            <span style={{display: 'inline-block', fontSize: big === key ? size * 2.4 : size, transform: `translateY(${(1 - rise) * 110}%)`, color: red.includes(key) ? C.acc : color, paddingRight: '0.24em'}}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};
// Column reveal: the image arrives as 12 vertical strips on the grid, staggered one frame apart.
const Strips: React.FC<{src: string; at: number; x: number; y: number; w: number; h: number}> = ({src, at, x, y, w, h}) => {
  const f = useCurrentFrame();
  if (f >= at + 22) return <Box x={x} y={y} w={w} h={h}><Photo src={src} /></Box>; // settled: one seamless image
  return (
    <Box x={x} y={y} w={w} h={h}>
      {Array.from({length: 12}).map((_, i) => {
        const p = prog(f, at + i, 10);
        return (
          <div key={i} style={{position: 'absolute', left: (w / 12) * i, top: 0, width: w / 12 + 1, height: h, overflow: 'hidden', clipPath: `inset(${(1 - p) * 100}% 0 0 0)`}}>
            <div style={{position: 'absolute', left: -(w / 12) * i, top: 0, width: w, height: h}}><Photo src={src} /></div>
          </div>
        );
      })}
    </Box>
  );
};

// ── Cursor + real-screenshot camera ───────────────────────────────────────────
type Pt = {f: number; x: number; y: number; click?: boolean};
const path = (f: number, pts: Pt[]) => {
  let x = pts[0].x, y = pts[0].y;
  for (let i = 1; i < pts.length; i++) if (f >= pts[i - 1].f) { const t = prog(f, pts[i - 1].f, pts[i].f - pts[i - 1].f); x = lerp(pts[i - 1].x, pts[i].x, t); y = lerp(pts[i - 1].y, pts[i].y, t); }
  return {x, y};
};
const Cursor: React.FC<{x: number; y: number; click?: number}> = ({x, y, click}) => (
  <>
    {click !== undefined && click > 0 && click < 1 && <div style={{position: 'absolute', left: x - 44 * click, top: y - 44 * click, width: 88 * click, height: 88 * click, borderRadius: '50%', border: `4px solid ${C.acc}`, opacity: 1 - click}} />}
    <svg width={46} height={56} viewBox="0 0 23 28" style={{position: 'absolute', left: x - 3, top: y - 2, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.45))'}}>
      <path d="M2 2 L2 23 L7.5 18 L11 26 L14.5 24.5 L11 17 L18 17 Z" fill={C.paper} stroke={C.bg} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  </>
);
type Cam = {f: number; cx: number; cy: number; z: number};
const cam = (f: number, keys: Cam[]) => {
  let c = keys[0];
  for (let i = 1; i < keys.length; i++) if (f >= keys[i - 1].f) {
    const t = prog(f, keys[i - 1].f, keys[i].f - keys[i - 1].f);
    c = {f, cx: lerp(keys[i - 1].cx, keys[i].cx, t), cy: lerp(keys[i - 1].cy, keys[i].cy, t), z: lerp(keys[i - 1].z, keys[i].z, t)};
  }
  return c;
};
// Real Studio screenshots are 2000×1111; the photo canvas is (320,210)-(1396,934).
const Shot: React.FC<{src: string; W?: number; H?: number; cams: Cam[]; cursor?: Pt[]; photo?: React.ReactNode; children?: React.ReactNode; bg?: string}> = ({src, W = 2000, H = 1111, cams, cursor, photo, children, bg = C.bg}) => {
  const f = useCurrentFrame();
  const c = cam(f, cams), k = (1920 / W) * c.z;
  const p = cursor ? path(f, cursor) : null;
  const clk = cursor?.filter((q) => q.click && f >= q.f).pop();
  return (
    <Full bg={bg}>
      <div style={{position: 'absolute', left: 960 - c.cx * k, top: 540 - c.cy * k, width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0'}}>
        <Photo src={src} />
        {photo}
        {children}
      </div>
      {p && <Cursor x={960 + (p.x - c.cx) * k} y={540 + (p.y - c.cy) * k} click={clk ? prog(f, clk.f, 12) : undefined} />}
    </Full>
  );
};
const Canvas: React.FC<{src: string; style?: React.CSSProperties}> = ({src, style}) => <Box x={320} y={210} w={1076} h={724}><Photo src={src} style={style} /></Box>;

// ── 1. Open ───────────────────────────────────────────────────────────────────
const PW = 1344, PH = 896;
const Open: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      {f >= 8 && <Box x={960 - PW / 2} y={540 - PH / 2} w={PW} h={PH}><Photo src="main1-1600.webp" /></Box>}
      {f >= 8 && f < 10 && <div style={{position: 'absolute', inset: 0, background: C.paper, opacity: 0.8}} />}
      <Sfx at={8} name="camera" />
    </Full>
  );
};

// ── 2. Every photo comes off the camera flat. ─────────────────────────────────
const Flat: React.FC = () => {
  const f = useCurrentFrame();
  const m = prog(f, 0, 18), w = lerp(PW, 900, m), h = lerp(PH, 600, m);
  return (
    <Full>
      <Box x={960 - w / 2} y={lerp(540 - PH / 2, 110, m)} w={w} h={h}><Photo src="main1-1600.webp" /></Box>
      <Line text="Every photo comes off the camera flat." red={['flat']} at={14} every={4} size={80} y={850} />
    </Full>
  );
};

// ── 3. Making it look like film ───────────────────────────────────────────────
const Film: React.FC = () => <Full><Line text="Making it look like film" red={['film']} at={2} every={6} size={150} /></Full>;

// ── 4. usually takes three apps. ──────────────────────────────────────────────
const APPS = ['Lightroom', 'Dehancer', 'Darkroom'];
const COL = {w: 520, gap: 40};
const colX = (i: number) => 960 - (3 * COL.w + 2 * COL.gap) / 2 + i * (COL.w + COL.gap);
const AppCols: React.FC<{f: number; at: number; collapse?: number}> = ({f, at, collapse = 0}) => (
  <>
    {APPS.map((a, i) => {
      const p = prog(f, at + i * 8, 10), x = lerp(colX(i), 960 - COL.w / 2, collapse);
      return (
        <div key={a} style={{position: 'absolute', left: x, top: 330, width: COL.w, height: 470, borderTop: `6px solid ${C.paper}`, clipPath: `inset(0 0 ${(1 - p) * 100}% 0)`, opacity: 1 - collapse * 0.9}}>
          <div style={{fontFamily: FONT, fontSize: 26, color: C.dim, marginTop: 18}}>0{i + 1}</div>
          <div style={{fontFamily: FONT, fontSize: 64, fontWeight: 700, color: C.paper, letterSpacing: '-0.03em'}}>{a}</div>
        </div>
      );
    })}
  </>
);
const Apps: React.FC = () => {
  const f = useCurrentFrame();
  const step = Math.min(2, Math.max(0, Math.floor((f - 34) / 18)));
  return (
    <Full>
      <Line text="usually takes three apps." red={['three']} at={0} every={4} size={96} y={190} />
      <AppCols f={f} at={14} />
      {f >= 34 && <Box x={colX(step) + 40} y={520} w={440} h={293}><Photo src="main5-1600.webp" /></Box>}
      {[14, 22, 30].map((t) => <Sfx key={t} at={t} name="clack" vol={0.6} />)}
      {[34, 52, 70].map((t) => <Sfx key={`s${t}`} at={t} name="whoosh" vol={0.35} />)}
    </Full>
  );
};

// ── 5. and every export loses quality. ────────────────────────────────────────
const Loss: React.FC = () => {
  const f = useCurrentFrame();
  const n = Math.min(4, Math.max(0, Math.floor((f - 20) / 14) + 1));
  const q = [100, 97, 94, 91, 88][n];
  return (
    <Full>
      <Line text="and every export loses quality." red={['quality']} at={0} every={4} size={96} y={150} />
      <Box x={960 - 480} y={260} w={960} h={640}><Photo src={n ? `export${n}.png` : 'main5-1600.webp'} /></Box>
      {n > 0 && <div style={{position: 'absolute', left: 960 + 480 - 260, top: 290, fontFamily: FONT, fontSize: 40, fontWeight: 700, background: C.acc, color: C.bg, padding: '8px 18px'}}>Export {n}</div>}
      <div style={{position: 'absolute', left: 960 - 480, top: 940, width: 960, display: 'flex', alignItems: 'center', gap: 24, fontFamily: FONT}}>
        <div style={{flex: 1, height: 10, background: C.line}}><div style={{width: `${q}%`, height: 10, background: q < 100 ? C.acc : C.paper}} /></div>
        <div style={{fontSize: 48, fontWeight: 700, color: C.paper, width: 150, textAlign: 'right'}}>{q}%</div>
      </div>
      {[0, 1, 2, 3].map((i) => <Sfx key={i} at={20 + i * 14} name="strike" vol={0.8} />)}
    </Full>
  );
};

// ── 6. Chromasmith does it in one. ────────────────────────────────────────────
const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 10) return <Full />; // silence before the turn
  const c = prog(f, 10, 16);
  return (
    <Full>
      {f < 30 && <AppCols f={999} at={0} collapse={c} />}
      {f >= 26 && <Line text="Chromasmith does it in one." red={['Chromasmith']} at={26} every={5} size={130} y={260} />}
      {f >= 40 && <Strips src="main5-1600.webp" at={40} x={960 - 450} y={420} w={900} h={600} />}
      <Sfx at={10} name="ratchet" vol={0.5} />
      <Sfx at={26} name="tone" />
    </Full>
  );
};

// ── 7. On your computer. Nothing uploaded. ────────────────────────────────────
const Local: React.FC = () => (
  <Full>
    <Line text="On your computer." at={0} every={5} size={120} y={460} />
    <Line text="Nothing uploaded." red={['uploaded']} at={16} every={5} size={120} y={610} />
  </Full>
);

// ── 8–13. Demo: a card, then the real screen ──────────────────────────────────
const Card: React.FC<{text: string; red: string[]; big?: string}> = ({text, red, big}) => <Full><Line text={text} red={red} big={big} at={0} every={4} size={130} /></Full>;

const Lib: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 40) return <Card text="Open your library." red={['library']} />;
  return (
    <>
      {/* library.webp is 1600×1000; the chosen tile sits at (757,397)-(905,545) */}
      <Shot src="library.webp" W={1600} H={1000} bg="#efeee9" cams={[{f: 40, cx: 800, cy: 500, z: 1}, {f: 58, cx: 800, cy: 500, z: 1}, {f: 84, cx: 831, cy: 471, z: 3.2}]}
        cursor={[{f: 40, x: 1100, y: 800}, {f: 70, x: 840, y: 480, click: true}, {f: 120, x: 840, y: 480}]}
        photo={<Box x={757} y={397} w={148} h={148} style={{background: '#e9e7e1', outline: f >= 70 ? `4px solid ${C.acc}` : 'none'}}><Photo src="main1-1600.webp" fit="contain" /></Box>} />
      <Sfx at={70} name="click" />
    </>
  );
};

const LOOKS = [{n: 'Classic Chrome', src: 'main2-1600.webp', filter: ''}, {n: 'Tri-X 400', src: 'main3-1600.webp', filter: 'grayscale(1) contrast(1.15)'}, {n: 'Portra 400', src: 'main3-1600.webp', filter: ''}];
const Looks: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 45) return <Card text="Choose from 133 film looks." red={['133']} big="133" />;
  const L = LOOKS[Math.min(2, Math.max(0, Math.floor((f - 78) / 22)))];
  return (
    <>
      <Shot src="studio-1.webp" cams={[{f: 45, cx: 1000, cy: 555, z: 1}, {f: 62, cx: 1000, cy: 555, z: 1}, {f: 84, cx: 1260, cy: 560, z: 1.45}]}
        cursor={[{f: 45, x: 900, y: 700}, {f: 78, x: 1620, y: 470, click: true}, {f: 100, x: 1790, y: 470, click: true}, {f: 122, x: 1620, y: 630, click: true}, {f: 150, x: 1620, y: 630}]}
        photo={<Canvas src={f >= 78 ? L.src : 'main1-1600.webp'} style={{filter: f >= 78 ? L.filter : ''}} />}>
        {f >= 78 && <div style={{position: 'absolute', left: 340, top: 230, fontFamily: FONT, fontSize: 44, fontWeight: 700, background: C.bg, color: C.paper, padding: '8px 18px'}}>{L.n}</div>}
      </Shot>
      {[78, 100, 122].map((t) => <Sfx key={t} at={t} name="ratchet" vol={0.5} />)}
    </>
  );
};

const Grain: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 40) return <Card text="Add film grain." red={['grain']} />;
  if (f >= 96) {
    // scale jump: from the window straight to the pixels at 100%
    return (
      <Full>
        <Box x={0} y={0} w={1920} h={1080}><Photo src="main4-1600.webp" style={{transform: 'scale(3.2)', transformOrigin: '62% 40%'}} /></Box>
        <div style={{position: 'absolute', left: 120, bottom: 100, fontFamily: FONT, fontSize: 40, fontWeight: 700, background: C.bg, color: C.paper, padding: '8px 18px'}}>100%</div>
      </Full>
    );
  }
  const drag = prog(f, 70, 22);
  return (
    <>
      <Shot src="studio-4.webp" cams={[{f: 40, cx: 1000, cy: 555, z: 1}, {f: 62, cx: 1600, cy: 830, z: 2.4}]}
        cursor={[{f: 40, x: 1200, y: 700}, {f: 68, x: 1646, y: 868, click: true}, {f: 92, x: 1760, y: 868}, {f: 96, x: 1760, y: 868}]}
        photo={<Canvas src={f >= 80 ? 'main4-1600.webp' : 'main3-1600.webp'} />}>
        <div style={{position: 'absolute', left: 1600, top: 846, width: 300, height: 50, background: '#151513'}} />
        <div style={{position: 'absolute', left: 1620, top: 866, width: 250, height: 3, background: C.line}} />
        <div style={{position: 'absolute', left: 1620, top: 866, width: lerp(26, 140, drag), height: 3, background: C.acc}} />
        <div style={{position: 'absolute', left: 1620 + lerp(26, 140, drag) - 7, top: 860, width: 14, height: 14, background: C.paper}} />
      </Shot>
      <Sfx at={68} name="click" />
      <Sfx at={74} name="hiss" vol={0.9} />
    </>
  );
};

const Glow: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 45) return <Card text="Make the highlights glow." red={['glow']} />;
  const lf = f - 45, split = prog(lf, 10, 30);
  return (
    <Full>
      <Box x={120} y={150} w={1140} h={760}>
        <Photo src="main4-1600.webp" />
        <Photo src="main5-1600.webp" style={{clipPath: `inset(0 0 0 ${100 - 50 * split}%)`}} />
        <div style={{position: 'absolute', top: 0, bottom: 0, left: `${100 - 50 * split}%`, width: 5, marginLeft: -2, background: C.paper}} />
      </Box>
      <div style={{position: 'absolute', left: 1340, top: 330, width: 460, fontFamily: FONT}}>
        {['Halation', 'Bloom'].map((n, i) => {
          const v = prog(lf, 14 + i * 10, 34), t = i ? 42 : 58;
          return (
            <div key={n} style={{marginBottom: 80}}>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 56, fontWeight: 700, color: C.paper, letterSpacing: '-0.02em'}}><span>{n}</span><span style={{color: C.acc}}>{Math.round(v * t)}</span></div>
              <div style={{height: 8, background: C.line, marginTop: 18}}><div style={{width: `${v * t}%`, height: 8, background: C.acc}} /></div>
            </div>
          );
        })}
      </div>
      <Sfx at={55} name="swell" />
    </Full>
  );
};

const Border: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 35) return <Card text="Add a border." red={['border']} />;
  return (
    <>
      <Shot src="studio-5.webp" cams={[{f: 35, cx: 1000, cy: 555, z: 1}, {f: 52, cx: 1400, cy: 640, z: 1.6}]}
        cursor={[{f: 35, x: 1300, y: 760}, {f: 62, x: 1852, y: 654, click: true}, {f: 90, x: 1852, y: 654}]}
        photo={<Canvas src={f >= 64 ? 'main6-1600.webp' : 'main5-1600.webp'} />} />
      <Sfx at={62} name="click" />
      <Sfx at={64} name="whoosh" vol={0.4} />
    </>
  );
};

const Export: React.FC = () => {
  const f = useCurrentFrame();
  if (f < 45) return <Full><Line text="Export once," at={0} every={4} size={130} y={460} /><Line text="at full resolution." red={['resolution']} at={10} every={4} size={130} y={610} /></Full>;
  const k = prog(f, 66, 10);
  return (
    <>
      <Shot src="studio-5.webp" cams={[{f: 45, cx: 1000, cy: 555, z: 1}, {f: 58, cx: 1700, cy: 120, z: 2.2}]}
        cursor={[{f: 45, x: 1300, y: 500}, {f: 62, x: 1876, y: 38, click: true}, {f: 90, x: 1876, y: 38}]}
        photo={<Canvas src="main6-1600.webp" />} />
      {f >= 66 && (
        <Full style={{background: `rgba(11,11,10,${0.96 * k})`}}>
          <div style={{position: 'absolute', left: 0, right: 0, top: 540, transform: `translateY(-50%) scale(${lerp(0.6, 1, k)})`, textAlign: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 220, letterSpacing: '-0.05em', color: C.paper}}>6000 × 4000</div>
        </Full>
      )}
      <Sfx at={62} name="click" />
      <Sfx at={66} name="camera" vol={0.7} />
    </>
  );
};

// ── 14. Benefits ──────────────────────────────────────────────────────────────
const SAVE = [
  {t: 'Save $83 a month.', r: ['$83'], b: '$83'},
  {t: 'Save 20 minutes a photo.', r: ['20'], b: '20'},
  {t: 'Preserve full image quality.', r: ['full'], b: 'full'},
];
const Save: React.FC = () => (
  <Full>
    {SAVE.map((c, i) => (
      <Sequence key={i} from={i * 60} durationInFrames={60} layout="none"><Line text={c.t} red={c.r} big={c.b} at={0} every={4} size={96} /></Sequence>
    ))}
    {[0, 1, 2].map((k) => <Sfx key={k} at={k * 60 + 8} name="ping" vol={0.45} />)}
  </Full>
);

// ── 15. Platforms: one photo, the frame around it changes shape on the grid ───
const FRAMES = [
  {x: 360, y: 200, w: 1200, h: 640, r: 14, bar: 'window'},
  {x: 360, y: 200, w: 1200, h: 640, r: 4, bar: 'win'},
  {x: 810, y: 150, w: 300, h: 650, r: 52, bar: 'none'},
  {x: 460, y: 220, w: 1000, h: 600, r: 10, bar: 'tab'},
];
const Devices: React.FC = () => {
  const f = useCurrentFrame();
  const i = Math.min(3, Math.floor(f / 34)), a = FRAMES[Math.max(0, i - 1)], b = FRAMES[i];
  const t = i === 0 ? 1 : prog(f, i * 34, 12);
  const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), w = lerp(a.w, b.w, t), h = lerp(a.h, b.h, t), r = lerp(a.r, b.r, t);
  const bar = t > 0.6 ? b.bar : a.bar;
  return (
    <Full>
      <div style={{position: 'absolute', left: x, top: y, width: w, height: h, border: `3px solid ${C.mid}`, borderRadius: r, overflow: 'hidden', boxSizing: 'border-box'}}>
        {bar !== 'none' && (
          <div style={{height: 44, borderBottom: `3px solid ${C.mid}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', justifyContent: bar === 'win' ? 'flex-end' : 'flex-start'}}>
            {bar === 'window' && [0, 1, 2].map((k) => <i key={k} style={{width: 12, height: 12, borderRadius: 6, border: `2px solid ${C.mid}`}} />)}
            {bar === 'win' && ['–', '□', '×'].map((k) => <span key={k} style={{fontFamily: FONT, color: C.mid, fontSize: 22, width: 30, textAlign: 'center'}}>{k}</span>)}
            {bar === 'tab' && <><span style={{border: `2px solid ${C.mid}`, borderBottom: 0, padding: '2px 26px', fontFamily: FONT, fontSize: 18, color: C.mid, alignSelf: 'flex-end'}}>Chromasmith</span><span style={{flex: 1, height: 20, marginLeft: 16, border: `2px solid ${C.line}`, borderRadius: 10}} /></>}
          </div>
        )}
        <div style={{position: 'absolute', left: 0, right: 0, top: bar !== 'none' ? 47 : 0, bottom: 0}}><Photo src="main6-1600.webp" /></div>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 930, display: 'flex', justifyContent: 'center', gap: 22, fontFamily: FONT, fontSize: 64, fontWeight: 700, letterSpacing: '-0.03em'}}>
        {['On', 'Mac,', 'Windows,', 'iPhone', 'and', 'the', 'web.'].map((w, k) => {
          const idx = ['Mac,', 'Windows,', 'iPhone', 'web.'].indexOf(w);
          return <span key={k} style={{color: idx === i ? C.acc : idx > i ? C.rej : C.paper}}>{w}</span>;
        })}
      </div>
      {[0, 34, 68, 102].map((s) => <Sfx key={s} at={s} name="tick" vol={0.6} />)}
    </Full>
  );
};

// ── 16. Museum: true aspect ratios, one centre line, spotlights, wall labels ──
const PRINTS = [
  {src: 'original.webp', ar: 844 / 1125, h: 420, label: ['Canal walk, 2026', 'Portra 400 · grain 22']},
  {src: 'main5-1600.webp', ar: 1600 / 1067, h: 440, label: ['Brighton, 2026', 'Portra 400 · grain 34 · halation 58']},
  {src: 'lib05.webp', ar: 837 / 1100, h: 420, label: ['Studio, 2026', 'Tri-X 400 · grain 40']},
  {src: 'lib01.webp', ar: 1100 / 754, h: 380, label: ['Annecy, 2026', 'Classic Chrome · bloom 20']},
];
const Museum: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 100) return <Full bg="#ecebe6"><Line text="Ready for the wall." red={['Ready']} at={0} every={5} size={140} color={C.bg} /></Full>;
  const pan = interpolate(f, [0, 100], [0, -520]);
  const CL = 470; // every print shares one centre line
  let x = 260;
  return (
    <Full bg="#e9e7e1">
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(#efeee9, #e4e2dc 70%, #d8d5ce 70.2%, #cfccc4)'}} />
      <div style={{position: 'absolute', left: pan, top: 0, width: 4000, height: 1080}}>
        {PRINTS.map((p, i) => {
          const mat = 46, frame = 8, iw = p.h * p.ar, W = iw + 2 * (mat + frame), H = p.h + 2 * (mat + frame);
          const left = x; x += W + 220;
          return (
            <React.Fragment key={i}>
              <div style={{position: 'absolute', left: left + W / 2 - 360, top: CL - H / 2 - 260, width: 720, height: H + 420, background: 'radial-gradient(ellipse at 50% 30%, rgba(255,236,200,.55), rgba(255,236,200,0) 60%)'}} />
              <div style={{position: 'absolute', left, top: CL - H / 2, width: W, height: H, background: '#151513', padding: frame, boxSizing: 'border-box', boxShadow: '0 24px 40px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.12)'}}>
                <div style={{width: '100%', height: '100%', background: '#fbfaf6', padding: mat, boxSizing: 'border-box'}}>
                  <div style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}><Photo src={p.src} /></div>
                </div>
              </div>
              <div style={{position: 'absolute', left: left + W + 28, top: CL + H / 2 - 64, fontFamily: FONT, color: C.bg}}>
                <div style={{fontSize: 22, fontWeight: 700}}>{p.label[0]}</div>
                <div style={{fontSize: 18, color: C.rej, marginTop: 4, width: 190}}>{p.label[1]}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <Sfx at={0} name="whoosh" vol={0.3} />
    </Full>
  );
};

// ── 17. CTA ───────────────────────────────────────────────────────────────────
const PLATFORMS = ['Mac', 'Windows', 'iOS', 'Web'];
const End: React.FC = () => {
  const f = useCurrentFrame();
  const m = prog(f, 4, 18), L = 220;
  return (
    <Full>
      <div style={{position: 'absolute', left: 960 - L / 2, top: 110, width: L, height: L}}>
        {/* the logo's two squares slide in along the grid and lock into their overlap */}
        <div style={{position: 'absolute', left: 0.21 * L, top: lerp(-600, 0.21 * L, m), width: 0.48 * L, height: 0.44 * L, background: '#f2f0ea'}} />
        <div style={{position: 'absolute', left: lerp(1200, 0.36 * L, m), top: 0.32 * L, width: 0.43 * L, height: 0.45 * L, background: C.acc}} />
        {m >= 1 && <Img src={staticFile(img('chromasmith-logo-dark.svg'))} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />}
      </div>
      <Line text="Chromasmith." at={20} every={1} size={120} y={420} />
      <Line text="Download free." red={['free']} at={34} every={5} size={150} y={570} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 710, display: 'flex', justifyContent: 'center', gap: 16}}>
        {PLATFORMS.map((p, i) => <div key={p} style={{fontFamily: FONT, fontSize: 44, padding: '16px 36px', background: C.paper, color: C.bg, clipPath: `inset(${(1 - prog(f, 56 + i * 5, 8)) * 100}% 0 0 0)`}}>{p}</div>)}
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 870, textAlign: 'center', fontFamily: FONT, fontSize: 40, color: C.mid, opacity: prog(f, 84, 10)}}>tareqameer.github.io/Chroma-App</div>
      <Sfx at={4} name="whoosh" vol={0.5} />
      <Sfx at={22} name="pin" />
      {PLATFORMS.map((_, i) => <Sfx key={i} at={56 + i * 5} name="tick" vol={0.6} />)}
      <Sfx at={84} name="tone" />
    </Full>
  );
};

// ── Music: CC0 "Drifting Piano" (HoliznaCC0), mixed under the effects, dipped for the turn ──
const music = (f: number) => {
  const base = interpolate(f, [60, 120, TOTAL - 90, TOTAL], [0, 0.28, 0.28, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const dip = interpolate(f, [405, 420, 450, 480], [1, 0.15, 0.15, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return base * dip;
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {([['open', Open], ['flat', Flat], ['film', Film], ['apps', Apps], ['loss', Loss], ['reveal', Reveal], ['local', Local], ['lib', Lib], ['looks', Looks], ['grain', Grain], ['glow', Glow], ['border', Border], ['exp', Export], ['save', Save], ['devices', Devices], ['museum', Museum], ['end', End]] as const).map(([k, Comp]) => (
      <Sequence key={k} from={S[k][0]} durationInFrames={S[k][1]}><Comp /></Sequence>
    ))}
    <Audio src={staticFile('music/drifting-piano.mp3')} volume={music} />
  </AbsoluteFill>
);
