import React from 'react';
import {Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {C, FONT, prog} from './theme';

// Caption that builds one word at a time; each word rises 14px and settles from dim to full colour.
export const Words: React.FC<{text: string; at?: number; every?: number; size?: number; color?: string; style?: React.CSSProperties}> = ({
  text, at = 0, every = 6, size = 34, color = C.paper, style,
}) => {
  const f = useCurrentFrame();
  return (
    <div style={{fontFamily: FONT, fontSize: size, letterSpacing: '-0.01em', color, whiteSpace: 'nowrap', ...style}}>
      {text.split(' ').map((w, i) => {
        const p = prog(f, at + i * every, 10);
        return (
          <span key={i} style={{display: 'inline-block', marginRight: '0.28em', opacity: p, transform: `translateY(${(1 - p) * 14}px)`, filter: p < 1 ? `brightness(${0.55 + 0.45 * p})` : undefined}}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

// One sound per visual beat. Every cue is placed in frames, so sound and picture can't drift.
export const Sfx: React.FC<{at: number; name: string; vol?: number}> = ({at, name, vol = 1}) => (
  <Sequence from={Math.round(at)} layout="none">
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={vol} />
  </Sequence>
);

// Odometer: digits roll vertically from one value to another with ghosted neighbours.
export const Odometer: React.FC<{from: number; to: number; at: number; dur?: number; size: number; color?: string; prefix?: string; suffix?: string; sep?: boolean}> = ({
  from, to, at, dur = 30, size, color = C.paper, prefix = '', suffix = '', sep = false,
}) => {
  const f = useCurrentFrame();
  const v = from + (to - from) * prog(f, at, dur);
  const fmt = (n: number) => { const s = String(Math.round(n)); return sep ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s; };
  // the whole value steps up/down; each change nudges the figure 6px so it reads as a roll
  const step = Math.abs(v - Math.round(v));
  return (
    <div style={{fontFamily: FONT, fontSize: size, color, lineHeight: 1, display: 'flex', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em'}}>
      <span>{prefix}</span>
      <span style={{transform: `translateY(${step * 12}px)`}}>{fmt(v)}</span>
      <span>{suffix}</span>
    </div>
  );
};

export const Full: React.FC<{bg?: string; children?: React.ReactNode; style?: React.CSSProperties}> = ({bg = C.bg, children, style}) => (
  <div style={{position: 'absolute', inset: 0, background: bg, overflow: 'hidden', ...style}}>{children}</div>
);
