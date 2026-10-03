// node stills.mjs <outdir> <comp> <frames,comma,separated> — bundle once, render stills, tile a sheet.
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
const [out, id, list] = process.argv.slice(2);
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const browserExecutable = 'C:/Users/Tareq/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const composition = await selectComposition({serveUrl, id, browserExecutable});
for (const [i, frame] of list.split(',').map(Number).entries())
  await renderStill({serveUrl, composition, frame, output: path.join(out, `${String(i).padStart(3, '0')}.png`), browserExecutable});
console.log('done');
