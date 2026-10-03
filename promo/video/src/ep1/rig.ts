// Square One rig: frame-driven helpers shared by every episode.
import {Easing, interpolate} from 'remotion';

export const BEAT = 16; // 112 BPM at 30 fps
export const EASE = {
  move: Easing.bezier(0.65, 0, 0.2, 1),
  type: Easing.bezier(0.16, 1, 0.3, 1),
  drag: Easing.bezier(0.6, 0, 0.9, 0.4),
  out: Easing.bezier(0.2, 0.8, 0.2, 1),
  in: Easing.bezier(0.55, 0, 1, 0.45),
};
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const t01 = (f: number, a: number, b: number, e: (t: number) => number = EASE.move) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e});

// Piecewise keyframes: [frame, value, easing-into-this-key?]
export type Key = [number, number, ((t: number) => number)?];
export const keys = (f: number, k: Key[]) => {
  if (f <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (f <= k[i][0]) {
      const t = t01(f, k[i - 1][0], k[i][0], k[i][2] ?? EASE.move);
      return lerp(k[i - 1][1], k[i][1], t);
    }
  }
  return k[k.length - 1][1];
};

// Damped oscillation after an impact; 0 before `at`. Settles in ~10 frames.
export const ring = (f: number, at: number, amp: number, decay = 0.32, freq = 0.62) => {
  const t = f - at;
  if (t < 0) return 0;
  return amp * Math.exp(-decay * t) * Math.cos(freq * t);
};
// Pulse shape 0→1→0 over [a,b] (anticipation crouch, twitch).
export const bump = (f: number, a: number, b: number) => {
  if (f < a || f > b) return 0;
  return Math.sin(Math.PI * (f - a) / (b - a));
};
// Jump on an arc from (x0,y0) to (x1,y1) between frames a..b with peak height h.
export const arc = (f: number, a: number, b: number, x0: number, y0: number, x1: number, y1: number, h: number) => {
  const t = clamp((f - a) / (b - a));
  const tx = EASE.move(t);
  return {x: lerp(x0, x1, tx), y: lerp(y0, y1, t) - h * Math.sin(Math.PI * t), t};
};
