import React from 'react';
import {AbsoluteFill, Img, Sequence, random, staticFile, useCurrentFrame, delayRender, continueRender} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {C, FONT, img, prog} from './theme';
import {Full, Odometer, Sfx, Words} from './ui';

// Scene timing (frames @30fps). Long "explain everything" cut; trim later.
const S = {
  hook: [0, 150], pile: [150, 150], sort: [300, 150], find: [450, 120], flip: [570, 90],
  app: [660, 120], room: [780, 480], flow: [1260, 540], devices: [1800, 300], print: [2100, 150], end: [2250, 210],
} as const;
export const TOTAL = 2460;

const fontHandle = delayRender('font');
Promise.all([
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaRegular.otf'), weight: '400'}),
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaBold.otf'), weight: '700'}),
]).then(() => continueRender(fontHandle));

const Photo: React.FC<{src: string; fit?: 'cover' | 'contain'; style?: React.CSSProperties}> = ({src, fit = 'cover', style}) => (
  <Img src={staticFile(img(src))} style={{position: 'absolute', width: '100%', height: '100%', objectFit: fit, ...style}} />
);

// Headline + explanation, both built word by word. The explanation starts once the headline lands.
const Title: React.FC<{head: string; sub?: string; at?: number; color?: string; subColor?: string; style?: React.CSSProperties}> = ({head, sub, at = 0, color = C.paper, subColor = C.mid, style}) => {
  const subAt = at + head.split(' ').length * 5 + 6;
  return (
    <div style={{position: 'absolute', left: 120, bottom: 80, ...style}}>
      <Words text={head} at={at} every={5} size={84} color={color} style={{fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05}} />
      {sub && <Words text={sub} at={subAt} every={2} size={38} color={subColor} style={{marginTop: 18, lineHeight: 1.2}} />}
    </div>
  );
};

// The real logo: paper square + accent square sliding into their overlap.
const Logo: React.FC<{size: number; at?: number; style?: React.CSSProperties}> = ({size, at = 0, style}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, 14);
  return (
    <div style={{width: size, height: size, position: 'relative', opacity: p > 0 ? 1 : 0, ...style}}>
      <Img src={staticFile(img('chromasmith-logo-dark.svg'))} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}} />
    </div>
  );
};
const LogoMark: React.FC<{at?: number}> = ({at = 0}) => (
  <div style={{position: 'absolute', left: 104, top: 36, display: 'flex', alignItems: 'center', gap: 6}}>
    <Logo size={64} at={at} />
    <Words text="CHRO-MA-SMITH" at={at + 6} every={1} size={26} style={{fontWeight: 700}} />
  </div>
);

// ── 1. Hook: before / after ───────────────────────────────────────────────────
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const x = prog(f, 50, 26) * 110 - 5;
  return (
    <Full>
      <Photo src="main1-1600.webp" />
      <Photo src="main5-1600.webp" style={{clipPath: `inset(0 ${100 - Math.max(0, x)}% 0 0)`}} />
      <div style={{position: 'absolute', top: 0, bottom: 0, left: `${x}%`, width: 12, marginLeft: -6, background: C.paper}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(transparent 55%, rgba(11,11,10,.75))'}} />
      <LogoMark at={4} />
      {f < 62 ? <Title head="Before." sub="Straight from the camera." at={10} /> : <Title head="After." sub="Film look, grain and glow. One app, on your own machine." at={72} />}
      <Sfx at={4} name="clack" vol={0.6} />
      <Sfx at={50} name="whoosh" />
      <Sfx at={76} name="click" vol={0.7} />
    </Full>
  );
};

// ── Grid geometry shared by scenes 2–4 ────────────────────────────────────────
type Cell = {x: number; y: number; s: number; i: number; r: number; c: number};
const grid = (cols: number, rows: number, area = {x: 120, y: 120, w: 1680, h: 640}, gap = 6, groupGap = 0, groupRows = 4): Cell[] => {
  const groups = Math.ceil(rows / groupRows) - 1;
  const s = Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (rows - 1) - groupGap * groups) / rows);
  const W = cols * s + gap * (cols - 1), H = rows * s + gap * (rows - 1) + groupGap * groups;
  const ox = area.x + (area.w - W) / 2, oy = area.y + (area.h - H) / 2;
  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    out.push({x: ox + c * (s + gap), y: oy + r * (s + gap) + Math.floor(r / groupRows) * groupGap, s, i: r * cols + c, r, c});
  return out;
};

// ── 2. Too many photos ────────────────────────────────────────────────────────
const WAVES = [[4, 2], [8, 4], [16, 8], [32, 16]];
const Pile: React.FC = () => {
  const f = useCurrentFrame();
  const w = Math.min(3, Math.floor(f / 26));
  const [cols, rows] = WAVES[w];
  return (
    <Full>
      {grid(cols, rows, {x: 120, y: 60, w: 1680, h: 640}).map((b) => {
        const p = prog(f, w * 26 + random(`p${w}-${b.i}`) * 12, 5);
        return <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: C.paper, transform: `scale(${p})`}} />;
      })}
      <div style={{position: 'absolute', right: 120, bottom: 96, textAlign: 'right'}}>
        <Odometer from={0} to={2481} at={6} dur={90} size={96} sep />
        <div style={{fontFamily: FONT, fontSize: 28, color: C.dim, marginTop: 8}}>photos this year</div>
      </div>
      <Title head="Too many photos." sub="Every shoot adds hundreds more." at={8} />
      {WAVES.map((_, k) => [0, 3, 6, 9].slice(0, k + 1).map((d) => <Sfx key={`${k}${d}`} at={k * 26 + d * (1 + (3 - k) / 3)} name="tick" vol={0.5 + k * 0.12} />))}
      <Sfx at={6} name="ratchet" vol={0.35} />
      <Sfx at={60} name="ratchet" vol={0.35} />
    </Full>
  );
};

// ── 3. Organised for you  /  4. Find the one ──────────────────────────────────
const SORT_AREA = {x: 620, y: 60, w: 1180, h: 640};
const SHOOTS = ['12 Mar · Brighton', '28 Apr · Annecy', '09 Jun · Canal walk', '21 Aug · Wedding'];
const TARGET = {r: 9, c: 14};
const kind = (i: number) => { const v = random(`k${i}`); return v < 0.2 ? 'rej' : v > 0.9 ? 'fav' : 'keep'; };

const Library: React.FC<{open: number; labels: number; tint: number}> = ({open, labels, tint}) => {
  const cells = grid(22, 16, SORT_AREA, 5, 28 * open);
  return (
    <>
      {cells.map((b) => {
        const k = kind(b.i);
        return (
          <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: open > 0.5 && k === 'rej' ? C.rej : C.paper}}>
            {k === 'fav' && open > 0.5 && <div style={{position: 'absolute', right: 0, top: 0, width: b.s * 0.45, height: b.s * 0.45, background: C.fav}} />}
            {tint > 0 && <div style={{position: 'absolute', inset: 0, background: C.line, opacity: tint}} />}
          </div>
        );
      })}
      {SHOOTS.map((t, g) => (
        <Words key={g} text={t} at={labels + g * 8} every={3} size={34} color={C.paper} style={{position: 'absolute', left: 120, top: cells[g * 4 * 22].y, opacity: 1 - tint * 0.8}} />
      ))}
    </>
  );
};

const Legend: React.FC<{at: number}> = ({at}) => {
  const f = useCurrentFrame();
  return (
    <div style={{position: 'absolute', right: 120, bottom: 96, display: 'flex', gap: 34, fontFamily: FONT, fontSize: 28, color: C.mid, opacity: prog(f, at, 10)}}>
      <span style={{display: 'flex', alignItems: 'center', gap: 10}}><i style={{width: 22, height: 22, background: C.fav}} />Favourite</span>
      <span style={{display: 'flex', alignItems: 'center', gap: 10}}><i style={{width: 22, height: 22, background: C.rej}} />Reject</span>
    </div>
  );
};

const Sort: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      <Library open={prog(f, 6, 18)} labels={18} tint={0} />
      <Legend at={40} />
      <Title head="Organised for you." sub="Sorted by shoot, date, place and faces." at={10} />
      {[6, 14, 22, 30].map((t) => <Sfx key={t} at={t} name="clack" vol={0.7} />)}
      {[18, 26, 34, 42].map((t) => <Sfx key={t} at={t} name="tick" vol={0.25} />)}
    </Full>
  );
};

const Find: React.FC = () => {
  const f = useCurrentFrame();
  const cells = grid(22, 16, SORT_AREA, 5, 28);
  const t = cells.find((b) => b.r === TARGET.r && b.c === TARGET.c)!;
  const cx = t.x + t.s / 2, cy = t.y + t.s / 2;
  const z = prog(f, 56, 34), k = 1 + (320 / t.s - 1) * z, tx = 960, ty = 400;
  return (
    <Full>
      <div style={{position: 'absolute', inset: 0, transformOrigin: `${cx}px ${cy}px`, transform: `translate(${(tx - cx) * z}px, ${(ty - cy) * z}px) scale(${k})`}}>
        <Library open={1} labels={-99} tint={prog(f, 6, 8)} />
        <div style={{position: 'absolute', left: t.x, top: t.y, width: t.s, height: t.s, background: C.acc, opacity: f >= 12 ? 1 : 0}} />
      </div>
      <Title head="Find the one." sub="Filter, search and pick the frame worth printing." at={14} />
      <Sfx at={12} name="thud" />
      <Sfx at={56} name="whoosh" vol={0.6} />
    </Full>
  );
};

// ── 5. Flip: library → film lab ───────────────────────────────────────────────
const Flip: React.FC = () => {
  const f = useCurrentFrame();
  const rot = prog(f, 8, 12) * 180, g = prog(f, 26, 16);
  const w = 320 + (720 - 320) * g, h = 320 + (480 - 320) * g;
  return (
    <Full>
      <div style={{position: 'absolute', left: 960 - w / 2, top: 400 - h / 2 - 20 * g, width: w, height: h, perspective: 2400}}>
        <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${rot}deg)`}}>
          <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', background: C.acc}} />
          <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', overflow: 'hidden'}}><Photo src="main1-1600.webp" /></div>
        </div>
      </div>
      <Title head="Take it to the film lab." sub="From the library to the studio in one click." at={20} />
      <Sfx at={8} name="flip" />
      <Sfx at={26} name="whoosh" vol={0.5} />
    </Full>
  );
};

// ── 6a. The real studio, then it strips down to the simplified view ──────────
const App: React.FC = () => {
  const f = useCurrentFrame();
  const z = prog(f, 0, 24), out = prog(f, 92, 18);
  return (
    <Full>
      <div style={{position: 'absolute', left: 120, top: 60, width: 1680, height: 924 * (1680 / 1680) * 0.71, transform: `scale(${0.92 + 0.08 * z})`, transformOrigin: '50% 0', opacity: 1 - out, boxShadow: `0 0 0 2px ${C.line}`}}>
        <Photo src="studio-app.webp" fit="contain" />
      </div>
      {/* paper bar sweeps the screenshot away, revealing the simplified studio */}
      <div style={{position: 'absolute', top: 0, bottom: 0, left: `${out * 110 - 5}%`, width: 12, background: C.paper, opacity: out > 0 && out < 1 ? 1 : 0}} />
      <Title head="The studio." sub="Every darkroom tool in one window. Let's simplify it." at={14} />
      <Sfx at={0} name="click" />
      <Sfx at={92} name="whoosh" />
    </Full>
  );
};

// ── 6. The darkroom, simplified ───────────────────────────────────────────────
const ROOM = {x: 120, y: 120, w: 960, h: 640};
const TABS = ['Look', 'Light', 'Colour', 'Texture', 'Output'];
const STAGES = [
  {at: 10, src: 'main3-1600.webp', tab: 0, head: 'Pick the look you like.', sub: 'Choose from 133 film looks and how each one is printed.', sfx: 'shutter'},
  {at: 130, src: 'main4-1600.webp', tab: 3, head: 'Add real film grain.', sub: 'Grain sized to the film stock, not a noise filter.', sfx: 'hiss'},
  {at: 250, src: 'main5-1600.webp', tab: 3, head: 'Make the highlights glow.', sub: 'Halation and bloom, like light spreading through film.', sfx: 'swell'},
  {at: 370, src: 'main6-1600.webp', tab: 4, head: 'Frame it.', sub: 'Add a print border, then export once at full resolution.', sfx: 'shutter'},
];
const FILMS = ['Portra 400', 'Tri-X 400', 'CineStill 800T', 'Velvia 50', 'Classic Chrome', 'Kodachrome 64', 'Portra 400'];

const Rings: React.FC<{f: number}> = ({f}) => {
  const pal = [C.acc, C.paper, C.mid, C.dim];
  return (
    <svg width={150} height={150} viewBox="0 0 4 4">
      {Array.from({length: 16}).map((_, i) => {
        const r = Math.floor(i / 4), c = i % 4;
        return <path key={i} d="M0 0 A1 1 0 0 1 1 1 L0 1Z" fill={pal[(i + Math.floor(f / 12)) % 4]} transform={`translate(${c} ${r}) rotate(${((r + c) % 4) * 90} .5 .5)`} />;
      })}
    </svg>
  );
};

const Room: React.FC = () => {
  const f = useCurrentFrame();
  const si = STAGES.reduce((a, s, i) => (f >= s.at ? i : a), -1);
  const cur = si >= 0 ? STAGES[si] : null;
  const prev = si > 0 ? STAGES[si - 1].src : 'main1-1600.webp';
  const wipe = cur ? prog(f, cur.at, 16) : 0;
  const film = Math.min(FILMS.length - 1, Math.floor(Math.max(0, f - 20) / 15));
  return (
    <Full>
      <div style={{position: 'absolute', left: ROOM.x, top: ROOM.y, width: ROOM.w, height: ROOM.h, overflow: 'hidden'}}>
        <Photo src="main1-1600.webp" />
        <Photo src={prev} style={{clipPath: 'inset(0 0 0 50%)'}} />
        {cur && <Photo src={cur.src} style={{clipPath: `inset(0 0 0 ${50 + 50 * (1 - wipe)}%)`}} />}
        <div style={{position: 'absolute', top: 0, bottom: 0, left: '50%', width: 4, marginLeft: -2, background: C.paper}} />
        <span style={{position: 'absolute', left: 16, top: 14, fontFamily: FONT, fontSize: 26, color: C.paper, background: C.bg, padding: '4px 12px'}}>Before</span>
        <span style={{position: 'absolute', right: 16, top: 14, fontFamily: FONT, fontSize: 26, color: C.bg, background: C.paper, padding: '4px 12px'}}>After</span>
      </div>
      <div style={{position: 'absolute', left: 1180, top: ROOM.y, width: 620, fontFamily: FONT}}>
        {TABS.map((t, i) => {
          const on = cur?.tab === i;
          return (
            <div key={t} style={{display: 'flex', gap: 18, alignItems: 'baseline', padding: '8px 18px', marginBottom: 4, fontSize: on ? 52 : 32, color: on ? C.bg : C.dim, background: on ? C.paper : 'transparent', boxShadow: on ? `0 0 0 4px ${C.acc}, 0 0 60px ${C.acc}55` : 'none'}}>
              <span style={{fontSize: 20, color: on ? C.acc : C.rej}}>0{i + 1}</span>{t}
            </div>
          );
        })}
        <div style={{marginTop: 26}}>
          {si === 0 && (
            <div style={{display: 'flex', gap: 26, alignItems: 'center'}}>
              <Rings f={f} />
              <div><div style={{fontSize: 22, color: C.dim}}>Film look</div><div style={{fontSize: 40, color: C.paper}}>{FILMS[film]}</div></div>
            </div>
          )}
          {(si === 1 || si === 2) && [['Grain', si === 1], ['Halation', si === 2], ['Bloom', si === 2]].map(([n, a]) => (
            <div key={n as string} style={{display: 'flex', alignItems: 'center', gap: 16, margin: '12px 0', fontSize: 30, color: a ? C.paper : C.dim}}>
              <span style={{width: 150}}>{n}</span>
              <div style={{flex: 1, height: 6, background: C.line, position: 'relative'}}>
                <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(a ? prog(f, STAGES[si].at + 10, 30) : 0.3) * 70}%`, background: a ? C.acc : C.dim}} />
              </div>
            </div>
          ))}
          {si === 3 && <div style={{fontSize: 30, color: C.paper, lineHeight: 1.6}}>Border: paper white<br />Export: full resolution</div>}
        </div>
      </div>
      {cur && <Title key={si} head={cur.head} sub={cur.sub} at={cur.at + 4} />}
      {STAGES.map((s) => <Sfx key={s.at} at={s.at} name={s.sfx} vol={s.sfx === 'hiss' ? 1 : 0.8} />)}
      {STAGES.map((s) => <Sfx key={`c${s.at}`} at={s.at + 1} name="click" vol={0.5} />)}
      {FILMS.slice(1).map((_, i) => <Sfx key={`f${i}`} at={20 + (i + 1) * 15} name="tick" vol={0.4} />)}
    </Full>
  );
};

// ── 7. Old workflow vs Chromasmith, with time / money / quality meters ────────
// Steps and totals from the homepage's Old/New Workflow sections (illustrative figures).
const OLD = [
  {app: 'Adobe Cloud', step: 'Upload the shoot', cost: 12},
  {app: 'Lightroom', step: 'Find and pick', cost: 30},
  {app: 'Lightroom', step: 'Edit the colour', cost: 30},
  {app: 'Lightroom', step: 'Export', cost: 30, ex: 1},
  {app: 'Dehancer', step: 'Import', cost: 61},
  {app: 'Dehancer', step: 'Grain and glow', cost: 61},
  {app: 'Dehancer', step: 'Export again', cost: 61, ex: 1},
  {app: 'Darkroom', step: 'Import', cost: 83},
  {app: 'Darkroom', step: 'First border', cost: 83},
  {app: 'Darkroom', step: 'Export again', cost: 83, ex: 1},
  {app: 'Darkroom', step: 'Second border', cost: 83},
  {app: 'Darkroom', step: 'Export again', cost: 83, ex: 1},
];
const STEP = 22, STEP0 = 20, COLLAPSE = 330;
const Flow: React.FC = () => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(12, Math.floor((f - STEP0) / STEP) + 1)); // steps shown
  const c = prog(f, COLLAPSE, 26);
  const newWay = f >= COLLAPSE + 20;
  const exports = OLD.slice(0, n).filter((s) => s.ex).length;
  const cost = n ? OLD[n - 1].cost : 0, time = n * (22 / 12), quality = 100 - exports * 3;
  const bw = 260, bh = 120, gap = 12, x0 = (1920 - (6 * bw + 5 * gap)) / 2;
  const meters = [
    {label: 'Subscriptions per month', v: newWay ? 0 : cost, pre: '$', suf: ''},
    {label: 'Time per photo', v: newWay ? 2 : time, pre: '', suf: ' min'},
    {label: 'Quality kept', v: newWay ? 100 : quality, pre: '', suf: '%'},
  ];
  const cur = n ? OLD[n - 1] : null;
  return (
    <Full>
      {OLD.map((s, i) => {
        const at = STEP0 + i * STEP, p = prog(f, at, 8);
        const x = x0 + (i % 6) * (bw + gap), y = 70 + Math.floor(i / 6) * (bh + gap);
        return (
          <div key={i} style={{position: 'absolute', left: x + (960 - bw / 2 - x) * c, top: y + (136 - y) * c, width: bw, height: bh, padding: '12px 16px', boxSizing: 'border-box', fontFamily: FONT, background: s.ex ? C.rej : C.paper, color: s.ex ? C.paper : C.bg, opacity: p * (1 - c), transform: `translateY(${(1 - p) * 16}px)`, outline: i === n - 1 && !c ? `4px solid ${C.acc}` : 'none'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 20, opacity: 0.7}}><span>{s.app}</span><span>{String(i + 1).padStart(2, '0')}</span></div>
            <div style={{fontSize: 28, fontWeight: 700, marginTop: 26, lineHeight: 1.1}}>{s.step}</div>
          </div>
        );
      })}
      <div style={{position: 'absolute', left: 960 - 400, top: 70, width: 800, height: 252, background: C.acc, transform: `scaleX(${prog(f, COLLAPSE + 20, 12)})`, fontFamily: FONT, color: C.bg, padding: '20px 28px', boxSizing: 'border-box'}}>
        <div style={{fontSize: 24}}>Chromasmith · 01</div>
        <div style={{fontSize: 64, fontWeight: 700, marginTop: 60, letterSpacing: '-0.02em'}}>Everything, one export</div>
      </div>
      {meters.map((m, i) => (
        <div key={i} style={{position: 'absolute', left: 120 + i * 580, top: 400, fontFamily: FONT}}>
          <div style={{fontSize: 30, color: C.dim, marginBottom: 12}}>{m.label}</div>
          <Odometer from={m.v} to={m.v} at={0} size={140} prefix={m.pre} suffix={m.suf} color={newWay ? C.acc : C.paper} />
        </div>
      ))}
      {f < COLLAPSE ? (
        <Title head="The old way: 3 apps, 12 steps." sub={cur ? `${String(n).padStart(2, '0')}  ${cur.app}: ${cur.step}.${cur.ex ? ' Every export loses quality.' : ''}` : ' '} at={4} key={`o${n}`} />
      ) : f < COLLAPSE + 120 ? (
        <Title head="The Chromasmith way: 1 app." sub="Colour, grain, glow and borders in one pass on the original file." at={COLLAPSE + 20} />
      ) : (
        <Title head="Save time. Keep quality. Keep your money." sub="No subscriptions. No re-exports. Two minutes, not twenty-two." at={COLLAPSE + 120} />
      )}
      {OLD.map((s, i) => <Sfx key={i} at={STEP0 + i * STEP} name={s.ex ? 'thud' : 'tick'} vol={s.ex ? 0.5 : 0.5} />)}
      <Sfx at={COLLAPSE} name="ratchet" vol={0.6} />
      <Sfx at={COLLAPSE + 20} name="thud" />
      <Sfx at={COLLAPSE + 22} name="ping" vol={0.6} />
      <Sfx at={COLLAPSE + 120} name="click" />
    </Full>
  );
};

// ── 8. Any device ─────────────────────────────────────────────────────────────
const Devices: React.FC = () => {
  const f = useCurrentFrame();
  const show = (at: number): React.CSSProperties => ({opacity: prog(f, at, 10), transform: `translateY(${(1 - prog(f, at, 14)) * 40}px)`});
  const label = (t: string, at: number) => <Words text={t} at={at} every={4} size={34} style={{marginTop: 18}} />;
  return (
    <Full>
      <div style={{position: 'absolute', left: 120, top: 80, ...show(10)}}>
        <div style={{width: 820, height: 470, border: `10px solid ${C.line}`, borderBottomWidth: 18, position: 'relative', background: C.bg2}}><Photo src="studio-app.webp" fit="cover" /></div>
        <div style={{width: 940, height: 16, marginLeft: -60, background: C.line}} />
        {label('Your computer. Mac and Windows.', 20)}
      </div>
      <div style={{position: 'absolute', left: 1030, top: 80, ...show(50)}}>
        <div style={{width: 240, height: 520, border: `10px solid ${C.line}`, borderRadius: 36, overflow: 'hidden', position: 'relative', background: C.bg2}}><Photo src="mobile.webp" /></div>
        {label('Your phone.', 60)}
      </div>
      <div style={{position: 'absolute', left: 1340, top: 80, ...show(90)}}>
        <div style={{width: 460, height: 30, background: C.line, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, boxSizing: 'border-box'}}>
          {[C.acc, C.dim, C.dim].map((c, i) => <i key={i} style={{width: 10, height: 10, borderRadius: 5, background: c}} />)}
        </div>
        <div style={{width: 460, height: 290, position: 'relative', border: `4px solid ${C.line}`, borderTop: 0, boxSizing: 'border-box'}}><Photo src="library.webp" /></div>
        {label('The web, on any device.', 100)}
      </div>
      <Title head="Edit anywhere." sub="Same tools, same looks, on whatever you have with you." at={130} />
      <Sfx at={10} name="clack" />
      <Sfx at={50} name="clack" />
      <Sfx at={90} name="clack" />
      <Sfx at={130} name="click" />
    </Full>
  );
};

// ── 9. Print & hang ───────────────────────────────────────────────────────────
const Print: React.FC = () => {
  const f = useCurrentFrame();
  const frame = (x: number, y: number, w: number, h: number, src: string, at: number, mat = 18) => (
    <div style={{position: 'absolute', left: x, top: y - (1 - prog(f, at, 16)) * 700, width: w, height: h, background: '#fbfaf6', padding: mat, boxSizing: 'border-box', boxShadow: '0 30px 60px rgba(11,11,10,.22)'}}>
      <div style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}><Photo src={src} /></div>
    </div>
  );
  return (
    <Full bg={C.paper}>
      {[[260, 220, C.mid], [1560, 520, C.dim], [1380, 120, C.acc]].map(([x, y, col], i) => (
        <div key={i} style={{position: 'absolute', left: (x as number) + Math.sin((f + i * 40) / 30) * 30, top: (y as number) + Math.cos((f + i * 30) / 34) * 24, width: 340, height: 340, borderRadius: 170, background: col as string, opacity: 0.28, mixBlendMode: 'multiply'}} />
      ))}
      {frame(140, 230, 420, 300, 'lib02.webp', 10)}
      {frame(1360, 230, 420, 300, 'lib05.webp', 16)}
      {frame(600, 120, 720, 500, 'main6-1600.webp', 0, 0)}
      <Title head="Print it. Hang it." sub="Full-resolution export, ready for the wall." at={20} color={C.bg} subColor={C.rej} />
      <Sfx at={0} name="whoosh" />
      <Sfx at={16} name="clack" />
      <Sfx at={26} name="clack" vol={0.6} />
      <Sfx at={32} name="clack" vol={0.6} />
    </Full>
  );
};

// ── 10. Call to action ────────────────────────────────────────────────────────
const PLATFORMS = ['Mac', 'Windows', 'iOS', 'Web'];
const End: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      <div style={{position: 'absolute', left: 120, top: 110, display: 'flex', alignItems: 'center', gap: 20}}>
        <Logo size={190} at={4} />
        <Words text="CHRO-MA-SMITH" at={12} every={1} size={136} style={{fontWeight: 700, letterSpacing: '-0.04em'}} />
      </div>
      <Words text="Gallery. Studio. Film Lab." at={30} every={5} size={44} color={C.mid} style={{position: 'absolute', left: 140, top: 330}} />
      <Words text="Download the app." at={48} every={5} size={84} style={{position: 'absolute', left: 120, top: 500, fontWeight: 700, letterSpacing: '-0.03em'}} />
      <div style={{position: 'absolute', left: 120, top: 640, display: 'flex', gap: 16}}>
        {PLATFORMS.map((p, i) => {
          const q = prog(f, 66 + i * 6, 8);
          return <div key={p} style={{fontFamily: FONT, fontSize: 44, padding: '18px 34px', background: i === 0 ? C.acc : C.paper, color: C.bg, transform: `scaleY(${q})`, transformOrigin: '50% 100%'}}>{p}</div>;
        })}
      </div>
      <Words text="Free. Offline. Nothing uploaded." at={96} every={4} size={38} color={C.mid} style={{position: 'absolute', left: 120, bottom: 90}} />
      <div style={{position: 'absolute', right: 120, bottom: 94, fontFamily: FONT, fontSize: 36, color: C.paper, opacity: prog(f, 104, 10)}}>tareqameer.github.io/Chroma-App</div>
      <Sfx at={4} name="clack" />
      {PLATFORMS.map((_, i) => <Sfx key={i} at={66 + i * 6} name="tick" vol={0.6} />)}
      <Sfx at={104} name="tone" />
    </Full>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {([['hook', Hook], ['pile', Pile], ['sort', Sort], ['find', Find], ['flip', Flip], ['app', App], ['room', Room], ['flow', Flow], ['devices', Devices], ['print', Print], ['end', End]] as const).map(([k, Comp]) => (
      <Sequence key={k} from={S[k][0]} durationInFrames={S[k][1]}><Comp /></Sequence>
    ))}
  </AbsoluteFill>
);
