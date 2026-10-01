import React from 'react';
import {AbsoluteFill, Img, Sequence, random, staticFile, useCurrentFrame, delayRender, continueRender} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {C, FONT, img, prog} from './theme';
import {Full, Odometer, Sfx, Words} from './ui';

// Scene timing (frames @30fps) — mirrors promo/storyboard.md.
const S = {hook: [0, 90], pile: [90, 120], sort: [210, 105], find: [315, 90], flip: [405, 45], room: [450, 270], flow: [720, 180], save: [900, 120], print: [1020, 120]} as const;
export const TOTAL = 1140;

const fontHandle = delayRender('font');
Promise.all([
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaRegular.otf'), weight: '400'}),
  loadFont({family: 'Gramatika', url: staticFile('fonts/GramatikaBold.otf'), weight: '700'}),
]).then(() => continueRender(fontHandle));

const Photo: React.FC<{src: string; style?: React.CSSProperties}> = ({src, style}) => (
  <Img src={staticFile(img(src))} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', ...style}} />
);
const Caption: React.FC<{text: string; at?: number; every?: number; color?: string}> = ({text, at = 0, every, color}) => (
  <Words text={text} at={at} every={every} color={color} style={{position: 'absolute', left: 120, bottom: 84}} />
);

// ── 1. Hook: before / after wipe ──────────────────────────────────────────────
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const x = prog(f, 28, 22) * 110 - 5; // paper bar position, % of width
  return (
    <Full>
      <Photo src="main1-1600.webp" />
      <Photo src="main5-1600.webp" style={{clipPath: `inset(0 ${100 - Math.max(0, x)}% 0 0)`}} />
      <div style={{position: 'absolute', top: 0, bottom: 0, left: `${x}%`, width: 10, marginLeft: -5, background: C.paper}} />
      {f < 40 ? <Caption text="Before." at={4} /> : <Caption text="After." at={50} />}
      <Sfx at={28} name="whoosh" />
      <Sfx at={50} name="click" vol={0.7} />
    </Full>
  );
};

// ── Grid geometry shared by scenes 2–4 ────────────────────────────────────────
type Cell = {x: number; y: number; s: number; i: number; r: number; c: number};
const grid = (cols: number, rows: number, area = {x: 120, y: 110, w: 1680, h: 760}, gap = 6, groupGap = 0, groupRows = 4): Cell[] => {
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
  const w = Math.min(3, Math.floor(f / 24));
  const [cols, rows] = WAVES[w];
  return (
    <Full>
      {grid(cols, rows).map((b) => {
        const p = prog(f, w * 24 + random(`p${w}-${b.i}`) * 12, 5);
        return <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: C.paper, transform: `scale(${p})`}} />;
      })}
      <div style={{position: 'absolute', right: 120, top: 46, display: 'flex', alignItems: 'baseline', gap: 14}}>
        <Odometer from={0} to={2481} at={6} dur={84} size={40} sep />
        <span style={{fontFamily: FONT, fontSize: 20, color: C.dim}}>photos</span>
      </div>
      <Caption text="Too many photos." at={8} />
      {WAVES.map((_, k) => [0, 3, 6, 9].slice(0, k + 1).map((d) => <Sfx key={`${k}${d}`} at={k * 24 + d * (1 + (3 - k) / 3)} name="tick" vol={0.5 + k * 0.12} />))}
      <Sfx at={6} name="ratchet" vol={0.35} />
      <Sfx at={60} name="ratchet" vol={0.35} />
    </Full>
  );
};

// ── 3. Organised for you  /  4. Find the one ──────────────────────────────────
const SORT_AREA = {x: 470, y: 110, w: 1330, h: 760};
const SHOOTS = ['12 Mar  ·  Brighton  ·  3 faces', '28 Apr  ·  Annecy  ·  2 dogs', '09 Jun  ·  Canal walk  ·  1 dog', '21 Aug  ·  Wedding  ·  41 faces'];
const TARGET = {r: 9, c: 17};
const kind = (i: number) => { const v = random(`k${i}`); return v < 0.2 ? 'rej' : v > 0.9 ? 'fav' : 'keep'; };

const Library: React.FC<{open: number; labels: number; tint: number}> = ({open, labels, tint}) => {
  const cells = grid(26, 16, SORT_AREA, 6, 26 * open);
  return (
    <>
      {cells.map((b) => {
        const k = kind(b.i);
        const base = k === 'rej' ? C.rej : C.paper;
        return (
          <div key={b.i} style={{position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, background: open > 0.5 ? base : C.paper}}>
            {k === 'fav' && open > 0.5 && <div style={{position: 'absolute', right: 0, top: 0, width: b.s * 0.4, height: b.s * 0.4, background: C.fav}} />}
            {tint > 0 && <div style={{position: 'absolute', inset: 0, background: C.line, opacity: tint}} />}
          </div>
        );
      })}
      {SHOOTS.map((t, g) => {
        const y = cells[g * 4 * 26].y;
        return <Words key={g} text={t} at={labels + g * 8} every={3} size={20} color={C.mid} style={{position: 'absolute', left: 120, top: y, opacity: 1 - tint * 0.8}} />;
      })}
    </>
  );
};

const Sort: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      <Library open={prog(f, 6, 18)} labels={18} tint={0} />
      <Caption text="Organised for you." at={10} />
      {[6, 14, 22, 30].map((t) => <Sfx key={t} at={t} name="clack" vol={0.7} />)}
      {[18, 26, 34, 42].map((t) => <Sfx key={t} at={t} name="tick" vol={0.25} />)}
    </Full>
  );
};

const Find: React.FC = () => {
  const f = useCurrentFrame();
  const cells = grid(26, 16, SORT_AREA, 6, 26);
  const t = cells.find((b) => b.r === TARGET.r && b.c === TARGET.c)!;
  const cx = t.x + t.s / 2, cy = t.y + t.s / 2;
  const z = prog(f, 32, 34), k = 1 + (360 / t.s - 1) * z;
  return (
    <Full>
      <div style={{position: 'absolute', inset: 0, transformOrigin: `${cx}px ${cy}px`, transform: `translate(${(960 - cx) * z}px, ${(540 - cy) * z}px) scale(${k})`}}>
        <Library open={1} labels={-99} tint={prog(f, 6, 8)} />
        <div style={{position: 'absolute', left: t.x, top: t.y, width: t.s, height: t.s, background: C.acc, opacity: f >= 12 ? 1 : 0}} />
      </div>
      <Caption text="Find the one." at={14} />
      <Sfx at={12} name="thud" />
      <Sfx at={32} name="whoosh" vol={0.6} />
    </Full>
  );
};

// ── 5. Flip: the red box turns over into the raw photo ────────────────────────
const ROOM = {x: 120, y: 150, w: 1140, h: 760};
const Flip: React.FC = () => {
  const f = useCurrentFrame();
  const rot = prog(f, 6, 12) * 180, g = prog(f, 22, 16);
  const w = 360 + (ROOM.w - 360) * g, h = 360 + (ROOM.h - 360) * g;
  const x = 960 - 180 + (ROOM.x - 780) * g, y = 540 - 180 + (ROOM.y - 360) * g;
  const face: React.CSSProperties = {position: 'absolute', inset: 0, backfaceVisibility: 'hidden'};
  return (
    <Full>
      <div style={{position: 'absolute', left: x, top: y, width: w, height: h, perspective: 2400}}>
        <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${rot}deg)`}}>
          <div style={{...face, background: C.acc}} />
          <div style={{...face, transform: 'rotateY(180deg)', overflow: 'hidden'}}><Photo src="main1-1600.webp" /></div>
        </div>
      </div>
      <Sfx at={6} name="flip" />
      <Sfx at={22} name="whoosh" vol={0.5} />
    </Full>
  );
};

// ── 6. The darkroom ───────────────────────────────────────────────────────────
const TABS = ['Look', 'Light', 'Colour', 'Texture', 'Output'];
const STAGES = [
  {at: 18, src: 'main3-1600.webp', tab: 0, cap: '133 film looks.', sfx: 'shutter'},
  {at: 82, src: 'main4-1600.webp', tab: 3, cap: 'Add grain.', sfx: 'hiss'},
  {at: 142, src: 'main5-1600.webp', tab: 3, cap: 'Make it glow.', sfx: 'swell'},
  {at: 202, src: 'main6-1600.webp', tab: 4, cap: 'Frame it.', sfx: 'shutter'},
];
const FILMS = ['Portra 400', 'Tri-X 400', 'CineStill 800T', 'Velvia 50', 'Classic Chrome', 'Portra 400'];

// Rotating quarter-circle mark that recolours segment by segment (Société Radio-Canada ref).
const Rings: React.FC<{f: number}> = ({f}) => {
  const pal = [C.acc, C.paper, C.mid, C.dim];
  return (
    <svg width={180} height={180} viewBox="0 0 4 4">
      {Array.from({length: 16}).map((_, i) => {
        const r = Math.floor(i / 4), c = i % 4, rot = ((r + c) % 4) * 90;
        const col = pal[(i + Math.floor(f / 6)) % 4];
        return <path key={i} d="M0 0 A1 1 0 0 1 1 1 L0 1Z" fill={col} transform={`translate(${c} ${r}) rotate(${rot} .5 .5)`} />;
      })}
    </svg>
  );
};

const Room: React.FC = () => {
  const f = useCurrentFrame();
  const si = STAGES.reduce((a, s, i) => (f >= s.at ? i : a), -1);
  const cur = si >= 0 ? STAGES[si] : null;
  const prev = si > 0 ? STAGES[si - 1].src : 'main1-1600.webp';
  const wipe = cur ? prog(f, cur.at, 14) : 0;
  const film = Math.min(FILMS.length - 1, Math.floor(Math.max(0, f - 22) / 9));
  return (
    <Full>
      <div style={{position: 'absolute', left: 120, top: 56, fontFamily: FONT, fontSize: 18, color: C.mid, display: 'flex', gap: 28}}>
        <span style={{color: C.paper, fontWeight: 700}}>CHRO-MA-SMITH</span><span style={{color: C.dim}}>gallery</span>
        <span style={{background: C.acc, color: C.bg, padding: '0 8px'}}>studio</span>
      </div>
      {/* photo: left half is always the untouched original, right half the current grade */}
      <div style={{position: 'absolute', left: ROOM.x, top: ROOM.y, width: ROOM.w, height: ROOM.h, overflow: 'hidden'}}>
        <Photo src="main1-1600.webp" />
        <Photo src={prev} style={{clipPath: 'inset(0 0 0 50%)'}} />
        {cur && <Photo src={cur.src} style={{clipPath: `inset(0 0 0 ${50 + 50 * (1 - wipe)}%)`}} />}
        <div style={{position: 'absolute', top: 0, bottom: 0, left: '50%', width: 4, marginLeft: -2, background: C.paper}} />
        <span style={{position: 'absolute', left: 18, top: 14, fontFamily: FONT, fontSize: 18, color: C.paper, background: C.bg, padding: '2px 8px'}}>Before</span>
        <span style={{position: 'absolute', right: 18, top: 14, fontFamily: FONT, fontSize: 18, color: C.bg, background: C.paper, padding: '2px 8px'}}>After</span>
      </div>
      {/* tool panel: everything dims except the active tool (spotlight focus) */}
      <div style={{position: 'absolute', left: 1340, top: ROOM.y, width: 460, fontFamily: FONT}}>
        {TABS.map((t, i) => {
          const on = cur?.tab === i;
          return (
            <div key={t} style={{display: 'flex', gap: 18, alignItems: 'baseline', padding: '10px 16px', marginBottom: 6, fontSize: on ? 44 : 26, color: on ? C.bg : C.dim, background: on ? C.paper : 'transparent', boxShadow: on ? `0 0 0 4px ${C.acc}, 0 0 60px ${C.acc}55` : 'none'}}>
              <span style={{fontSize: 16, color: on ? C.acc : C.rej}}>0{i + 1}</span>{t}
            </div>
          );
        })}
        <div style={{marginTop: 34, height: 200, position: 'relative'}}>
          {si === 0 && (
            <div style={{display: 'flex', gap: 26, alignItems: 'center'}}>
              <Rings f={f} />
              <div style={{fontSize: 28, color: C.paper}}>{FILMS[film]}</div>
            </div>
          )}
          {(si === 1 || si === 2) && (
            <div style={{fontSize: 22, color: C.mid}}>
              {[['Grain', si === 1], ['Halation', si === 2], ['Bloom', si === 2]].map(([n, a]) => (
                <div key={n as string} style={{display: 'flex', alignItems: 'center', gap: 16, margin: '14px 0'}}>
                  <span style={{width: 120}}>{n}</span>
                  <div style={{flex: 1, height: 4, background: C.line, position: 'relative'}}>
                    <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(a ? prog(f, STAGES[si].at, 24) : 0.3) * 70}%`, background: a ? C.acc : C.dim}} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {si === 3 && <div style={{fontSize: 22, color: C.mid}}>Border  ·  Paper white  ·  Full-res export</div>}
        </div>
      </div>
      {cur && <Caption key={si} text={cur.cap} at={cur.at + 4} />}
      {STAGES.map((s) => <Sfx key={s.at} at={s.at} name={s.sfx} vol={s.sfx === 'hiss' ? 1 : 0.8} />)}
      {STAGES.map((s) => <Sfx key={`c${s.at}`} at={s.at + 1} name="click" vol={0.5} />)}
      {FILMS.slice(1).map((_, i) => <Sfx key={`f${i}`} at={22 + (i + 1) * 9} name="tick" vol={0.4} />)}
    </Full>
  );
};

// ── 7. Simpler workflow: 12 steps collapse into one ───────────────────────────
const OLD = [
  ['Cloud', 'Upload'], ['Lightroom', 'Find'], ['Lightroom', 'Edit colour'], ['Lightroom', 'Export'],
  ['Dehancer', 'Import'], ['Dehancer', 'Grain + glow'], ['Dehancer', 'Export'], ['Darkroom', 'Import'],
  ['Darkroom', 'Border'], ['Darkroom', 'Export'], ['Darkroom', 'Border 2'], ['Darkroom', 'Export'],
];
const Flow: React.FC = () => {
  const f = useCurrentFrame();
  const c = prog(f, 96, 26); // collapse
  const bw = 124, gap = 9, x0 = (1920 - (12 * bw + 11 * gap)) / 2;
  return (
    <Full>
      {OLD.map(([app, step], i) => {
        const p = prog(f, 4 + i * 5, 6);
        const ex = step === 'Export';
        const x = x0 + i * (bw + gap);
        return (
          <div key={i} style={{position: 'absolute', left: x + (960 - bw / 2 - x) * c, top: 440, width: bw, height: 150, background: ex ? C.rej : C.paper, color: C.bg, fontFamily: FONT, padding: 12, boxSizing: 'border-box', opacity: p * (1 - c), transform: `translateY(${(1 - p) * 16}px)`}}>
            <div style={{fontSize: 14, color: ex ? C.paper : C.dim}}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{fontSize: 15, marginTop: 52, color: ex ? C.paper : C.bg}}>{app}</div>
            <div style={{fontSize: 19, fontWeight: 700, color: ex ? C.paper : C.bg}}>{step}</div>
          </div>
        );
      })}
      <div style={{position: 'absolute', left: 960 - 210, top: 440, width: 420, height: 150, background: C.acc, transform: `scaleX(${prog(f, 116, 10)})`, fontFamily: FONT, color: C.bg, padding: 16, boxSizing: 'border-box'}}>
        <div style={{fontSize: 14}}>01</div>
        <div style={{fontSize: 34, fontWeight: 700, marginTop: 52}}>Chromasmith</div>
      </div>
      {f < 100 ? <Caption text="12 steps. 3 apps. 4 exports." at={10} /> : <Caption text="1 app. 1 export." at={124} />}
      {OLD.map((_, i) => <Sfx key={i} at={4 + i * 5} name="tick" vol={0.45} />)}
      <Sfx at={96} name="ratchet" vol={0.6} />
      <Sfx at={116} name="thud" />
      <Sfx at={118} name="clack" />
    </Full>
  );
};

// ── 8. Time · Quality · Money ─────────────────────────────────────────────────
const SAVE = [
  {label: 'Subscriptions per month', from: 83, to: 0, prefix: '$', suffix: ''},
  {label: 'Time per photo', from: 22, to: 2, prefix: '', suffix: ' min'},
  {label: 'Quality kept', from: 88, to: 100, prefix: '', suffix: '%'},
];
const Save: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Full>
      {SAVE.map((s, i) => {
        const at = 10 + i * 14;
        return (
          <div key={i} style={{position: 'absolute', left: 120 + i * 580, top: 330, opacity: prog(f, at - 6, 8)}}>
            <div style={{fontFamily: FONT, fontSize: 22, color: C.dim, marginBottom: 26}}>{s.label}</div>
            <Odometer from={s.from} to={s.to} at={at} dur={30} size={190} prefix={s.prefix} suffix={s.suffix} color={f >= at + 30 ? C.acc : C.paper} />
            <div style={{width: 440, height: 4, background: C.line, marginTop: 28}}>
              <div style={{width: `${prog(f, at, 30) * 100}%`, height: 4, background: C.acc}} />
            </div>
          </div>
        );
      })}
      <Caption text="Save time. Keep quality. Keep your money." at={62} every={5} />
      {SAVE.map((_, i) => <Sfx key={i} at={10 + i * 14} name="ratchet" vol={0.5} />)}
      {SAVE.map((_, i) => <Sfx key={`p${i}`} at={40 + i * 14} name="ping" vol={0.5} />)}
    </Full>
  );
};

// ── 9. Print, hang, end card ──────────────────────────────────────────────────
const Print: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= 62) {
    return (
      <Full>
        <div style={{position: 'absolute', left: 120, top: 380, fontFamily: FONT, color: C.paper}}>
          <div style={{fontSize: 150, fontWeight: 700, letterSpacing: '-0.04em', display: 'flex', alignItems: 'baseline'}}>
            CHRO-MA-SMITH<span style={{display: 'inline-block', width: 34, height: 34, borderRadius: 17, background: C.acc, marginLeft: 14, transform: `scale(${prog(f, 92, 8)})`}} />
          </div>
          <Words text="Gallery. Studio. Film Lab." at={68} size={40} color={C.mid} style={{marginTop: 10}} />
        </div>
        <Words text="Free. Offline. Yours." at={78} size={30} style={{position: 'absolute', left: 120, bottom: 84}} />
        <div style={{position: 'absolute', right: 120, bottom: 88, fontFamily: FONT, fontSize: 24, color: C.dim, opacity: prog(f, 84, 10)}}>tareqameer.github.io/Chroma-App</div>
        <Sfx at={62} name="click" />
        <Sfx at={92} name="tone" />
      </Full>
    );
  }
  const drop = (at: number) => prog(f, at, 16);
  const frame = (x: number, y: number, w: number, h: number, src: string, at: number, mat = 18) => (
    <div style={{position: 'absolute', left: x, top: y - (1 - drop(at)) * 700, width: w, height: h, background: '#fbfaf6', padding: mat, boxSizing: 'border-box', boxShadow: '0 30px 60px rgba(11,11,10,.22)'}}>
      <div style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}><Photo src={src} /></div>
    </div>
  );
  return (
    <Full bg={C.paper}>
      {/* soft overlapping circles drifting behind the prints (Tonhalle ref) */}
      {[[260, 300, C.mid], [1560, 640, C.dim], [1380, 220, C.acc]].map(([x, y, col], i) => (
        <div key={i} style={{position: 'absolute', left: (x as number) + Math.sin((f + i * 40) / 30) * 30, top: (y as number) + Math.cos((f + i * 30) / 34) * 24, width: 340, height: 340, borderRadius: 170, background: col as string, opacity: 0.28, mixBlendMode: 'multiply'}} />
      ))}
      {frame(140, 330, 420, 300, 'lib02.webp', 10)}
      {frame(1360, 330, 420, 300, 'lib05.webp', 16)}
      {frame(600, 240, 720, 500, 'main6-1600.webp', 0, 0)}
      <Caption text="Print it. Hang it." at={20} color={C.bg} />
      <Sfx at={0} name="whoosh" />
      <Sfx at={16} name="clack" />
      <Sfx at={26} name="clack" vol={0.6} />
      <Sfx at={32} name="clack" vol={0.6} />
    </Full>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {([['hook', Hook], ['pile', Pile], ['sort', Sort], ['find', Find], ['flip', Flip], ['room', Room], ['flow', Flow], ['save', Save], ['print', Print]] as const).map(([k, Comp]) => (
      <Sequence key={k} from={S[k][0]} durationInFrames={S[k][1]}><Comp /></Sequence>
    ))}
  </AbsoluteFill>
);
