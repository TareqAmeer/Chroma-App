// Palette + type copied from the homepage (index.html :root) so the video matches the site.
export const C = {
  bg: '#0b0b0a', bg2: '#121210', line: '#24231f', paper: '#f2efe8',
  mid: '#c9c5bb', dim: '#8b877e', rej: '#6b685f', acc: '#ff3b1f', fav: '#1238ff',
};
export const FONT = 'Gramatika, system-ui, sans-serif';
export const FPS = 30;
// Swiss motion: every move eases out over ~0.5s; nothing bounces.
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const prog = (f: number, start: number, dur = 15) => easeOut((f - start) / dur);
export const img = (n: string) => `img/${n}`;
