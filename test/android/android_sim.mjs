// Android emulator acceptance run — criteria in docs/android-acceptance.md.
//   node test/android/android_sim.mjs [--build] [--only AC-05,AC-06]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { PNG } from 'pngjs';
import { adb, adbText, connect, PKG } from './cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(import.meta.dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const TOOLS = path.join(os.homedir(), 'android-tools');
const SDK = process.env.ANDROID_HOME || path.join(TOOLS, 'sdk');
const APK = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const info = {};
const shot = (name) => { const b = adb('exec-out', 'screencap', '-p'); if (name) fs.writeFileSync(path.join(OUT, name + '.png'), b); return PNG.sync.read(b); };
const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
const alive = () => adbText('shell', 'pidof', PKG).trim() !== '';
const log = () => adbText('logcat', '-d');
const launch = () => adbText('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
const state = (id, status, detail = '') => { results.push({ id, status, detail }); console.log(`${status.padEnd(4)} ${id}  ${detail}`); };

async function waitFor(fn, ms, step = 2000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* page reloading */ } await sleep(step); } return null; }
const page = () => connect();
async function withPage(fn) { const c = await page(); try { return await fn(c); } finally { c.close(); } }
async function ready(ms = 120000) {
  const t = Date.now();
  const ok = await waitFor(() => withPage(c => c.ev(`!!document.querySelector('.vtog')&&typeof MobileLibrary==='object'`)), ms);
  return ok ? Date.now() - t : null;
}
// Tap an element's centre with a real touch event (not a synthetic click).
async function tap(c, expr) {
  const fg = adbText('shell', 'dumpsys', 'activity', 'activities').match(/ResumedActivity.*? u0 ([\w.]+)\//)?.[1];
  if (fg !== PKG) throw new Error('foreground app is ' + fg + ', not ' + PKG + ' (an earlier tap left the app)');
  const r = await c.ev(`(()=>{const e=(${expr});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,d:devicePixelRatio}})()`);
  if (!r) throw new Error('tap target not found: ' + expr);
  adb('shell', 'input', 'tap', String(Math.round(r.x * r.d)), String(Math.round(r.y * r.d + c.screenY)));
}
const textEl = t => `[...document.querySelectorAll('button,div,span,a')].find(e=>e.children.length<4&&e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(t)})`;
function region(png, x0, y0, x1, y1) { const o = []; for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4) { const i = (y * png.width + x) * 4; o.push(png.data[i], png.data[i + 1], png.data[i + 2]); } return o; }
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const previewRect = c => c.ev(`(()=>{let best=null,ba=0;for(const k of document.querySelectorAll('canvas')){const b=k.getBoundingClientRect();if(b.width<150||b.top<0||b.bottom>innerHeight)continue;const a=b.width*b.height;if(a>ba){ba=a;best=b}}return best&&{x:best.x,y:best.y,w:best.width,h:best.height,d:devicePixelRatio}})()`);
async function previewPixels(c) {
  const r = await previewRect(c); if (!r) return null; const p = shot(); const s = r.d, y0 = Math.round(r.y * s + c.screenY);
  return region(p, Math.round(r.x * s) + 4, y0 + 4, Math.round((r.x + r.w) * s) - 4, y0 + Math.round(r.h * s) - 4);
}
const photoCount = () => withPage(c => c.ev(`MobileLibrary.allPhotos().then(p=>p.length)`));

async function setup() {
  if (args.includes('--build')) {
    const jdk = fs.readdirSync(TOOLS).filter(d => d.startsWith('jdk')).map(d => path.join(TOOLS, d))[0];
    const env = { ...process.env, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, JAVA_HOME: process.env.JAVA_HOME || jdk };
    execFileSync('bash', ['build-ios.sh'], { cwd: ROOT, stdio: 'inherit', env });
    execFileSync('npx', ['cap', 'sync', 'android'], { cwd: ROOT, stdio: 'inherit', env, shell: true });
    execFileSync(path.join(ROOT, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['assembleDebug', '--no-daemon', '-q'], { cwd: path.join(ROOT, 'android'), stdio: 'inherit', env, shell: true });
  }
  if (!/emulator-\d+\s+device/.test(adbText('devices'))) {
    spawn(path.join(SDK, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'), ['-avd', 'chroma_pixel', '-no-snapshot', '-gpu', 'swiftshader_indirect', '-no-audio', '-no-boot-anim'], { detached: true, stdio: 'ignore' }).unref();
    adb('wait-for-device');
    if (!await waitFor(() => adbText('shell', 'getprop', 'sys.boot_completed').trim() === '1', 300000, 5000)) throw new Error('emulator did not boot');
  }
  adbText('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); adbText('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  adbText('shell', 'rm', '-rf', '/sdcard/Documents/Chromasmith');
  try { adb('uninstall', PKG); } catch { /* not installed */ }
}
const want = id => !only || only.includes(id);

await setup();

let launchedAt = 0;
// ---- AC-01 install + launch + 30 s liveness
adbText('logcat', '-c');
try {
  adb('install', '-r', APK); launchedAt = Date.now(); launch(); await sleep(30000);
  const fatal = /FATAL EXCEPTION|ANR in com\.tareq/.test(log());
  state('AC-01', alive() && !fatal ? 'PASS' : 'FAIL', fatal ? 'crash/ANR in logcat' : alive() ? '' : 'process dead');
} catch (e) { state('AC-01', 'FAIL', e.message.split('\n')[0]); }

// ---- AC-02 cold start
const bootMs = (await ready()) && Date.now() - launchedAt; info.timeToGalleryMs = bootMs;
const wd = /\[boot\] watchdog fired[^\n]*/.exec(log());
state('AC-02', bootMs && !wd ? 'PASS' : 'FAIL', bootMs ? `gallery in ${Math.round(bootMs / 1000)}s${wd ? ' — ' + wd[0].replace(/^.*Msg: /, '') : ''}` : 'gallery never appeared');

let c = await page();
// ---- AC-03 / AC-04 / AC-06
const env = JSON.parse(await c.ev(`JSON.stringify({plat:window.Capacitor&&Capacitor.getPlatform(),build:typeof BUILD!=='undefined'?BUILD:null,
  missing:['Filesystem','Share','Media'].filter(p=>!Capacitor.Plugins[p]),gl2:!!document.createElement('canvas').getContext('webgl2'),
  coi:self.crossOriginIsolated,sab:typeof SharedArrayBuffer,mem:navigator.deviceMemory,ua:navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0]})`));
Object.assign(info, { webview: env.ua, deviceMemory: env.mem, build: env.build });
state('AC-03', env.plat === 'android' && env.build && !env.missing.length ? 'PASS' : 'FAIL', `platform=${env.plat} build=${env.build} missing plugins=[${env.missing}]`);
state('AC-04', env.gl2 ? 'PASS' : 'FAIL', 'webgl2=' + env.gl2);
state('AC-06', env.coi && env.sab === 'function' ? 'PASS' : 'FAIL', `crossOriginIsolated=${env.coi} SharedArrayBuffer=${env.sab} — RAW decode ${env.coi ? 'available' : 'will throw "RW2 needs SharedArrayBuffer"'}`);

// ---- AC-05 system bar strips
{
  const p = shot('bars'); const top = [], bot = [];
  for (let x = 0; x < p.width; x += 3) { top.push(lum(p.data, (40 * p.width + x) * 4)); bot.push(lum(p.data, ((p.height - 30) * p.width + x) * 4)); }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1]; const t = med(top), b = med(bot);
  state('AC-05', t < 0.35 && b < 0.35 ? 'PASS' : 'FAIL', `status-bar luminance ${t.toFixed(2)}, nav-bar luminance ${b.toFixed(2)} (app background ~0.07, system icons are white)`);
}

// ---- AC-07 import + open in studio
const b64 = fs.readFileSync(path.join(ROOT, 'test/fixtures/portrait.png')).toString('base64');
const t0 = Date.now();
await c.ev(`(async()=>{const bin=atob('${b64}');const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  await MobileLibrary.importFiles([new File([u],'portrait.png',{type:'image/png'})]);const id=(await MobileLibrary.allPhotos())[0].id;MobileLibrary.openPhoto(id);return id})()`);
const studio = await waitFor(() => withPage(k => k.ev(`!MobileLibrary.isOpening&&(document.querySelector('#fx-nav-looks')?.getBoundingClientRect().width||0)>0`)), 300000, 5000);
c.close(); c = await page(); await sleep(3000);
shot('studio-first-run');
// First-run welcome guide (a #cs-modal-ov; its copy varies) — dismissed with its close button, as a user would.
async function dismissModal() { for (let i = 0; i < 3 && await c.ev(`!!document.getElementById('cs-modal-ov')`); i++) { await tap(c, `document.getElementById('cs-modal-x')`); await sleep(1500); } }
if (studio) await dismissModal();
const px0 = await previewPixels(c);
let spread = 0; if (px0) { const m = px0.reduce((a, b) => a + b, 0) / px0.length; spread = Math.sqrt(px0.reduce((a, b) => a + (b - m) ** 2, 0) / px0.length); }
info.timeToStudioMs = Date.now() - t0; shot('studio');
state('AC-07', studio && px0 && spread > 5 ? 'PASS' : 'FAIL', studio ? `studio open in ${Math.round((Date.now() - t0) / 1000)}s, preview pixel stddev ${spread.toFixed(1)}` : 'studio never opened');

// ---- AC-08 tap a look
if (studio && px0) {
  try {
    await tap(c, textEl('Astia')); let d = 0;
    await waitFor(async () => { d = mad(px0, await previewPixels(c)); return d > 1.5; }, 90000, 3000); shot('look');
    state('AC-08', d > 1.5 ? 'PASS' : 'FAIL', `preview mean abs diff ${d.toFixed(1)}/255 after tapping "Astia"`);
  } catch (e) { state('AC-08', 'FAIL', e.message.split('\n')[0]); }
} else state('AC-08', 'SKIP', 'studio not open');

// ---- AC-16 the update banner must not cover the primary Studio nav; then dismiss it like a user would
if (studio) await dismissModal();
if (studio) {
  try {
    const cover = await c.ev(`(()=>{const n=document.querySelector('#fx-nav-export');if(!n)return 'no export button';const b=n.getBoundingClientRect();const e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return n.contains(e)?null:'covered by <'+e.tagName.toLowerCase()+'> "'+(e.textContent||'').trim().slice(0,40)+'"'})()`);
    state('AC-16', cover ? 'FAIL' : 'PASS', cover ? 'Export button ' + cover : 'Export button reachable');
    if (cover) { await tap(c, `document.querySelector('[aria-label="Dismiss"]')`); await sleep(1000); }
  } catch (e) { state('AC-16', 'FAIL', e.message.split('\n')[0]); }
} else state('AC-16', 'SKIP', 'studio not open');

// ---- AC-09 / AC-10 export
async function doExport(dest) {
  await tap(c, `document.querySelector('#fx-nav-export')`);
  if (!await waitFor(() => c.ev(`!!document.querySelector('[data-destination]')`), 30000, 500)) throw new Error('export sheet did not open');
  await c.ev(`(()=>{const s=document.querySelector('[data-destination]');s.value=${JSON.stringify(dest)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await tap(c, `document.querySelector('[data-go]')`);
}
if (studio) {
  try {
    await doExport('files');
    const f = await waitFor(() => { const o = adbText('shell', 'ls', '-l', '/sdcard/Documents/Chromasmith/').trim(); return o && !/No such/.test(o) ? o : null; }, 180000, 3000);
    let ok = false, d = 'nothing written to Documents/Chromasmith';
    if (f) {
      const name = f.split('\n').pop().trim().split(/\s+/).pop(); const loc = path.join(OUT, name);
      adb('pull', `/sdcard/Documents/Chromasmith/${name}`, loc); const b = fs.readFileSync(loc);
      ok = b.length > 5000 && ((b[0] === 0xFF && b[1] === 0xD8) || b.slice(1, 4).toString() === 'PNG'); d = `${name} ${b.length} bytes, magic ${b.slice(0, 4).toString('hex')}`;
    }
    shot('export-files'); state('AC-09', ok ? 'PASS' : 'FAIL', d);
    await tap(c, `[...document.querySelectorAll('[aria-label="Close"]')].find(e=>e.getBoundingClientRect().width>0)`); await sleep(1500); // close the "Export results" sheet
  } catch (e) { state('AC-09', 'FAIL', e.message.split('\n')[0]); }
  try {
    await sleep(3000); await doExport('photos'); await sleep(2500); shot('export-photos');
    const alb = await waitFor(() => { const o = adbText('shell', 'content query --uri content://media/external/images/media --projection _display_name:relative_path'); const l = o.split('\n').filter(x => /relative_path=(Pictures|Android\/media\/com\.tareq\.chromasmith)\/Chromasmith/.test(x))[0]; return l || null; }, 120000, 4000);
    state('AC-10', alb ? 'PASS' : 'FAIL', alb ? alb.trim() : 'no Chromasmith album entry (Pictures/ or app media dir) in MediaStore after 120s (see out/export-photos.png for a permission dialog)');
  } catch (e) { state('AC-10', 'FAIL', e.message.split('\n')[0]); }
} else { state('AC-09', 'SKIP', 'studio not open'); state('AC-10', 'SKIP', 'studio not open'); }

// ---- AC-11 rotation
try {
  adbText('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  c.close(); await waitFor(() => withPage(k => k.ev(`innerWidth>innerHeight`)), 30000, 1500); c = await page(); await sleep(2000);
  const r = JSON.parse(await c.ev(`JSON.stringify({w:innerWidth,h:innerHeight,ov:document.documentElement.scrollWidth-innerWidth})`)); shot('landscape');
  const pr = await previewRect(c); const dead = !alive();
  adbText('shell', 'settings', 'put', 'system', 'user_rotation', '0'); await sleep(4000);
  state('AC-11', !dead && r.w > r.h && r.ov <= 1 && pr ? 'PASS' : 'FAIL', `landscape ${r.w}x${r.h}, horizontal overflow ${r.ov}px, preview ${pr ? 'visible' : 'MISSING'}${dead ? ', APP DIED' : ''}`);
} catch (e) { adbText('shell', 'settings', 'put', 'system', 'user_rotation', '0'); state('AC-11', 'FAIL', e.message.split('\n')[0]); }

// ---- AC-13 Back button: sheets/tools close first, then Studio -> gallery; the app must stay resumed until the gallery
try {
  c.close(); let gallery = false, presses = 0;
  while (!gallery && presses < 5) { adbText('shell', 'input', 'keyevent', '4'); presses++; await sleep(2500); gallery = await withPage(k => k.ev(`MobileLibrary.isOpen()`)); }
  const resumed = /ResumedActivity.*com\.tareq\.chromasmith/.test(adbText('shell', 'dumpsys', 'activity', 'activities')) && alive();
  state('AC-13', gallery && resumed ? 'PASS' : 'FAIL', `${presses} Back press(es) to reach the gallery, app ${resumed ? 'still resumed' : 'LEFT THE FOREGROUND'}`);
  launch(); await sleep(2000);
} catch (e) { state('AC-13', 'FAIL', e.message.split('\n')[0]); launch(); }

// ---- AC-12 persistence across force-stop
try {
  adbText('shell', 'am', 'force-stop', PKG); await sleep(2000); launch();
  const ms = await ready(); const n = ms ? await photoCount() : -1;
  state('AC-12', n >= 1 ? 'PASS' : 'FAIL', `${n} photo(s) after relaunch, gallery in ${ms ? Math.round(ms / 1000) + 's' : 'never'}`);
} catch (e) { state('AC-12', 'FAIL', e.message.split('\n')[0]); }

// ---- AC-14 share-sheet import (best effort)
try {
  const before = await photoCount();
  adbText('shell', `content delete --uri content://media/external/images/media --where "_display_name='share_test.png'"`);
  // Real share sheets hand over a content:// URI plus a read grant; file:// is blocked by scoped storage.
  adb('push', path.join(ROOT, 'test/fixtures/gradient.png'), '/data/local/tmp/share_test.png');
  const ins = adbText('shell', 'content insert --uri content://media/external/images/media --bind _display_name:s:share_test.png --bind mime_type:s:image/png --bind relative_path:s:Pictures');
  const id = (await waitFor(() => adbText('shell', `content query --uri content://media/external/images/media --projection _id --where "_display_name='share_test.png'"`).match(/_id=(\d+)/)?.[1], 10000, 1000));
  if (!id) throw new Error('could not create MediaStore row: ' + ins.trim());
  adbText('shell', 'sh', '-c', `cat /data/local/tmp/share_test.png | content write --uri content://media/external/images/media/${id}`);
  const mark = log().length;
  adbText('shell', 'am', 'start', '--grant-read-uri-permission', '-a', 'android.intent.action.SEND', '-t', 'image/png', '-d', `content://media/external/images/media/${id}`, '--eu', 'android.intent.extra.STREAM', `content://media/external/images/media/${id}`, '-n', `${PKG}/.MainActivity`);
  await ready(60000); await sleep(15000); const after = await photoCount();
  const denied = /Permission Denial|EACCES|Could not read the shared|FileUriExposed/.test(log().slice(mark));
  state('AC-14', after > before ? 'PASS' : denied ? 'SKIP' : 'FAIL', `photos ${before} -> ${after}${after > before ? '' : denied ? ' (see out/logcat.txt)' : ''}`);
} catch (e) { state('AC-14', 'FAIL', e.message.split('\n')[0]); }

// ---- AC-15 JS errors anywhere in the run
{
  const lines = log().split('\n');
  // Two benign sources: Filesystem.stat on a not-yet-existing export name (expected control flow, Capacitor still
  // console.errors the rejection), and Capacitor's SystemBars injecting before documentElement exists during the
  // COI service-worker reload (upstream, transient).
  const afterStat = i => lines.slice(Math.max(0, i - 4), i).some(x => /Sending plugin error.*"methodName":"stat"/.test(x));
  const errs = lines.filter((l, i) => /Capacitor\/Console/.test(l) && /\bE Capacitor/.test(l) && !afterStat(i) && !/Error injecting safe area CSS/.test(l));
  state('AC-15', errs.length ? 'FAIL' : 'PASS', errs.length ? errs.length + ' error(s): ' + errs.slice(0, 3).map(l => l.replace(/^.*Msg: /, '').slice(0, 140)).join(' | ') : '');
}

const keep = results.filter(r => want(r.id)).sort((a, b) => a.id.localeCompare(b.id));
const md = `# Android emulator run\n\n${new Date().toISOString()} — ${info.webview}, build ${info.build}, deviceMemory ${info.deviceMemory} GB\n\n| ID | Result | Detail |\n|---|---|---|\n${keep.map(r => `| ${r.id} | ${r.status} | ${r.detail.replace(/\|/g, '/')} |`).join('\n')}\n\nTimings (SwiftShader, informational): gallery ${Math.round((info.timeToGalleryMs || 0) / 1000)}s, studio ${Math.round((info.timeToStudioMs || 0) / 1000)}s\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), md); fs.writeFileSync(path.join(OUT, 'logcat.txt'), log());
const failed = keep.filter(r => r.status === 'FAIL').length; console.log(`\n${keep.length - failed}/${keep.length} not failing, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
