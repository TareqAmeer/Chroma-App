// Regression probe: "dog tag stuck at 6 photos". Auto tags for not-yet-indexed photos only come
// from the CLIP phase of catalogRunBackgroundPhases(). Clicking Resume after Pause must restart
// that chain in-session — it used to only flip the flag, so indexing (and tagging) stayed stopped
// until some unrelated folder scan or a relaunch. Exercises the real bgSetPaused source with stubs.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const m = src.match(/function bgSetPaused\(paused\) \{[\s\S]*?\n  \}\n/);
if (!m) { console.error('FAIL: bgSetPaused not found'); process.exit(1); }
const store = { chromasmith_bg_paused: '1' };
const calls = [];
const env = {
  LIBTEST: false, LS_BG_PAUSED: 'chromasmith_bg_paused', _bgStopped: true,
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  invoke: (c) => { calls.push(c); return Promise.resolve(); },
  bgStopAll: () => { env._bgStopped = true; calls.push('bgStopAll'); },
  renderActivity: () => {},
  catalogRunBackgroundPhases: () => calls.push('run:' + (env._bgStopped ? 'stopped' : 'live')),
};
const fn = new Function('env', `with (env) { ${m[0]}; bgSetPaused(false); }`);
fn(env);
if (!calls.includes('run:live')) { console.error('FAIL: Resume did not restart background indexing; calls=' + JSON.stringify(calls)); process.exit(1); }
console.log('PASS: Resume restarts background indexing', JSON.stringify(calls));
