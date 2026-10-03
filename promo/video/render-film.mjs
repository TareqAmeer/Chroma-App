// node render-film.mjs — renders Ep1Film to a PNG sequence in out/ep1/frames (finish.sh encodes + adds the film pass).
import {bundle} from '@remotion/bundler';
import {renderFrames, selectComposition} from '@remotion/renderer';
import path from 'node:path';
const browserExecutable = process.env.REMOTION_CHROME || 'C:/Users/Tareq/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const composition = await selectComposition({serveUrl, id: 'Ep1Film', browserExecutable});
let last = -1;
await renderFrames({serveUrl, composition, imageFormat: 'png', browserExecutable, outputDir: path.resolve('out/ep1/frames'),
  inputProps: {}, onStart: () => {}, onFrameUpdate: (n) => { const p = Math.floor(n / composition.durationInFrames * 10); if (p !== last) { last = p; console.log(`${p * 10}%`); } }});
console.log('done');
