#!/usr/bin/env node
// ── RASTER MASK STORAGE / ROUND-TRIP GATE ────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// Not one of the 18 export goldens contains a raster (brush / sky / AI / skin) mask — every
// recipe in test/recipes/ uses analytic shapes only. So the entire raster-mask storage path was
// completely uncovered, which is exactly the code changed when `m.px` moved from a plain
// `Array` of JS numbers to a `Uint8ClampedArray` with base64 serialization and copy-on-write
// undo history. A golden PNG would be a poor test of it anyway; what actually matters is that
// the bytes survive every round trip, so this asserts that directly.
//
//   node test/mask_raster.mjs
//
// Covers:
//   1. typed storage      — px is a Uint8ClampedArray after mskAdd and after painting
//   2. snapshot round-trip— getUISnapshot -> JSON -> applyUISnapshot preserves px byte-for-byte
//   3. legacy load        — a mask saved as a plain number Array (pre-change sidecar/session)
//                           still loads and produces identical pixels
//   4. copy-on-write      — history entries are not corrupted by later painting, undo restores
//                           the exact earlier raster, and rasters are SHARED (not copied) when
//                           nothing painted between pushes
//   5. render equivalence — the graded output of a painted mask is identical before and after a
//                           snapshot round trip
//   6. per-photo copies   — mskCopyToAll gives each photo its own raster, not a shared reference

const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const nativeCdp=process.env.NATIVE_CDP;
  const browser = nativeCdp?await chromium.connectOverCDP(nativeCdp):await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let checks;
  try {
    const page = nativeCdp?browser.contexts()[0].pages().find(p=>!p.url().includes('devtools')):await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });
    if(nativeCdp)await page.reload({waitUntil:'load'});
    else await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.getUISnapshot === 'function', null, { timeout: 30000 });
    if(nativeCdp)await page.evaluate(async()=>{if(window.chromasmithLibraryIsOpen?.())await window.chromasmithToggleLibrary();});

    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

    checks = await page.evaluate(async () => {
      const out = [];
      const ck = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      const digest = (px) => { let h = 2166136261 >>> 0; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
      const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
      const renderHash = () => {
        const P = getFXParams();
        FX.render(P, 128, 96, { glowScale: 1, seed: 3.25 });
        const { px } = FX.getPixels();
        return digest(px);
      };

      // ── setup: one brush mask with a deterministic painted pattern ──
      fxState.masks.length = 0; mskSel = -1;
      mskAdd('brush');
      const m = fxState.masks[0];
      m.exp = 40; m.sat = -30;                         // make the mask visibly affect the render
      const px = m.px;
      for (let i = 0; i < px.length; i++) px[i] = (i * 7 + ((i / m.mtW) | 0) * 3) & 255;
      _mskTexDirty = true;
      const original = Uint8ClampedArray.from(px);
      const origHash = digest(original);

      // Feather and density are independent of flow, shared by paint and erase.
      const centre=(m.mtH>>1)*m.mtW+(m.mtW>>1);
      const edgeProbe=centre+Math.round(.8*.125*Math.max(m.mtW,m.mtH));
      mskBrushSize=50;mskBrushFlow=100;mskBrushDensity=100;mskBrushFeather=0;m.px.fill(0);
      mskPaintAt(m,.5,.5,false);const hard=m.px[edgeProbe];
      mskBrushFeather=100;m.px.fill(0);mskPaintAt(m,.5,.5,false);const soft=m.px[edgeProbe];
      ck('CHR-275 feather zero is hard and full feather tapers',hard===255&&soft>0&&soft<hard,`${hard}/${soft}`);
      mskBrushFeather=0;mskBrushDensity=25;m.px.fill(0);
      for(let i=0;i<8;i++)mskPaintAt(m,.5,.5,false);
      ck('CHR-275 repeated paint respects density cap',m.px[centre]===64);
      m.px.fill(255);for(let i=0;i<8;i++)mskPaintAt(m,.5,.5,true);
      ck('CHR-275 erase uses same density',m.px[centre]===191);
      m.px.fill(200);mskPaintAt(m,.5,.5,false);ck('CHR-275 reduced density preserves existing stronger mask',m.px[centre]===200);
      mskBrushDensity=0;m.px.fill(100);mskPaintAt(m,.5,.5,false);mskPaintAt(m,.5,.5,true);
      ck('CHR-275 zero density does not alter coverage',m.px.every(v=>v===100));
      mskBrushDensity=100;mskBrushFeather=100;mskBrushFlow=0;mskPaintAt(m,.5,.5,false);
      ck('CHR-275 zero flow does not alter coverage',m.px.every(v=>v===100));
      mskBrushFlow=60;mskBrushSize=25;mskRebuild();
      const controls=[...document.querySelectorAll('.fx-row')].filter(r=>['Feather','Density'].includes(r.querySelector('.fx-label')?.textContent)&&r.querySelector('input[oninput*="mskBrush"]'));
      ck('CHR-275 separate feather/density controls exposed',controls.length===2);
      m.px.set(original);
      const legacyPixels=Uint8ClampedArray.from(original),radius=Math.max(2,.25*.25*Math.max(m.mtW,m.mtH));
      for(let y=0;y<m.mtH;y++)for(let x=0;x<m.mtW;x++){const d=Math.hypot(x-m.mtW/2,y-m.mtH/2)/radius;if(d<=1){const idx=y*m.mtW+x;legacyPixels[idx]=Math.min(255,legacyPixels[idx]+.6*(1-d*d*(3-2*d))*255)}}
      mskPaintAt(m,.5,.5,false);ck('CHR-275 defaults preserve legacyPixels brush pixels exactly',same(m.px,legacyPixels));m.px.set(original);

      // ── CHR-275: Alt/Option temporarily erases within brush-paint calls ──
      const altProbe = (m.mtH >> 1) * m.mtW + (m.mtW >> 1);
      m.px.fill(200);
      const altBefore = m.px[altProbe];
      mskPaintErase = false;
      mskBrushSize = 1; mskBrushFlow = 60;
      mskPaintAt(m, 0.5, 0.5, true); // same override used for an Alt/Option-modified brush sample
      ck('CHR-275 Alt erase lowers painted pixels', m.px[altProbe] < altBefore,
        `${altBefore} -> ${m.px[altProbe]}`);
      ck('CHR-275 temporary erase leaves persistent erase mode off', mskPaintErase === false);
      const altErased = m.px[altProbe];
      mskPaintErase = true;
      mskPaintAt(m, 0.5, 0.5); // persistent Erase button continues to erase without the modifier
      ck('CHR-275 persistent erase mode still erases', m.px[altProbe] < altErased);
      mskPaintErase = false;
      // Exercise the real shortcut registry -> pointer-paint path, not just mskPaintAt's override.
      mskPaintMode = true; mskBrushFeather=42;mskBrushDensity=37;m.px.fill(200);
      const paintCanvas=document.getElementById('fx-canvas'),paintRect=paintCanvas.getBoundingClientRect();
      // Synthetic PointerEvents are not active browser pointers; skip native capture in this event-routing test.
      const realSetPointerCapture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=function(){};
      const pointer=(type,altKey=false,pointerType='mouse')=>paintCanvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:paintRect.left+paintRect.width/2,clientY:paintRect.top+paintRect.height/2,pointerId:71,pointerType,buttons:type==='pointerup'?0:1,altKey}));
      pointer('pointermove');
      csShortcutSet('editor.mask-erase','Shift');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,bubbles:true}));
      ck('CHR-275 rebound modifier reaches held erase state',mskBrushEraseHeld);
      ck('CHR-275 stationary cursor reflects rebound erase',document.getElementById('msk-brush-cursor').classList.contains('erase'));
      pointer('pointerdown'); pointer('pointerup');
      ck('CHR-275 rebound Shift erases through actual pointer handler',m.px.some(v=>v<200));
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
      ck('CHR-275 release restores paint without changing size/flow',!mskBrushEraseHeld&&mskBrushSize===1&&mskBrushFlow===60&&mskBrushFeather===42&&mskBrushDensity===37);
            ck('CHR-275 stationary cursor returns to paint',!document.getElementById('msk-brush-cursor').classList.contains('erase'));
      const eraseButton=document.getElementById('btn-msk-erase'),touchBrushCursor=document.getElementById('msk-brush-cursor');
      m.px.fill(200);eraseButton.click();
      ck('CHR-275 on-screen erase exposes pressed state',eraseButton.getAttribute('aria-pressed')==='true'&&eraseButton.classList.contains('on'));
      ck('CHR-275 on-screen erase immediately updates cursor feedback',touchBrushCursor.classList.contains('erase'));
      pointer('pointerdown',false,'touch');pointer('pointerup',false,'touch');
      ck('CHR-275 touch pointer erases through visible toggle',m.px.some(v=>v<200));
      eraseButton.click();
      ck('CHR-275 on-screen erase returns accessible state and cursor to paint',eraseButton.getAttribute('aria-pressed')==='false'&&!eraseButton.classList.contains('on')&&!touchBrushCursor.classList.contains('erase'));
      m.px.fill(200);mskPaintErase=true;mskRebuild();
      const rebuiltEraseButton=document.getElementById('btn-msk-erase');
      ck('CHR-275 rebuilt erase button retains current pressed state',rebuiltEraseButton.getAttribute('aria-pressed')==='true');
      // Every AI/raster mask origin uses the same brush-type pointer path.
      const eraseOrigins=['paint','ai','sky','skin','coat','faceauto'];
      const originalMask=fxState.masks[0];mskPaintMode=true;mskPaintErase=false;csShortcutSet('editor.mask-erase','Shift');
      for(const origin of eraseOrigins){
        const trial={...originalMask,origin,type:'brush',px:new Uint8ClampedArray(originalMask.mtW*originalMask.mtH).fill(200),ai:origin!=='paint'};
        fxState.masks[0]=trial;mskSel=0;fxHistory=[];fxHistIdx=-1;_fxHistLocked=false;fxHistoryPush();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,bubbles:true}));
        pointer('pointerdown');pointer('pointerup');
        document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
        ck('CHR-275 '+origin+' brush mask erases through the shared pointer path',trial.px.some(v=>v<200));
      }
      fxState.masks[0]=originalMask;mskPaintMode=false;mskPaintErase=false;mskRebuild();
      // The rebound erase modifier is inert outside brush-paint/heal modes, leaving Alt's
      // negative AI-scribble and WB eyedropper gestures available.
      csShortcutSet('editor.mask-erase','Alt');mskAiTapMode=true;originalMask.origin='ai';originalMask.ai=true;originalMask.aiPoints=[];
      mskPaintMode=false;mskBrushEraseHeld=false;window.samRunPoints=()=>{};
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',altKey:true,bubbles:true}));
      pointer('pointerdown',true);pointer('pointerup',true);
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true}));
      ck('CHR-275 Alt AI-exclusion scribble stays negative outside Paint',originalMask.aiPoints.some(p=>p.positive===false)&&!mskBrushEraseHeld);
      mskAiTapToggle(false);wbEyedropper();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',altKey:true,bubbles:true}));
      paintCanvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:paintRect.left+paintRect.width/2,clientY:paintRect.top+paintRect.height/2,altKey:true}));
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true}));
      ck('CHR-275 Alt white-balance sample remains available outside Paint',!_wbEyedropperActive&&!mskBrushEraseHeld);
      csShortcutSet('editor.mask-erase',null);
      mskPaintErase=false;mskRebuild();
      m.px.fill(200);pointer('pointerdown',true);pointer('pointerup',true);
      ck('CHR-275 old Alt binding does not erase after rebinding',!m.px.some(v=>v<200));
      csShortcutSet('editor.mask-erase',null);mskPaintMode=false;
      m.px.set(original); mskBrushSize = 25; mskBrushFlow = 60;mskBrushFeather=100;mskBrushDensity=100; _mskTexDirty = true;

      // Temporary Alt cursor feedback and an in-progress stroke cannot survive focus/tool exits.
      const brushCursor = document.getElementById('msk-brush-cursor');
      mskPaintMode = true; _mskStroke = m; brushCursor.classList.add('erase');
      window.dispatchEvent(new Event('blur'));
      ck('CHR-275 window blur ends the transient stroke', _mskStroke === null);
      ck('CHR-275 window blur clears temporary erase cursor', !brushCursor.classList.contains('erase'));
      mskPaintMode = true; _mskStroke = m; brushCursor.classList.add('erase');
      const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
      else delete document.visibilityState;
      ck('CHR-275 hidden document clears transient stroke and erase cursor', _mskStroke === null && !brushCursor.classList.contains('erase'));
      mskPaintMode = true; _mskStroke = m; brushCursor.classList.add('erase');
      mskPaintStop();
      ck('CHR-275 leaving paint mode clears transient stroke', _mskStroke === null && !brushCursor.classList.contains('erase'));
      mskPaintMode = true; _mskStroke = m; brushCursor.classList.add('erase');
      document.getElementById('fx-canvas').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      ck('CHR-275 pointer cancellation clears stroke and temporary erase', _mskStroke === null && !brushCursor.classList.contains('erase'));

      ck('1. px is a Uint8ClampedArray', px instanceof Uint8ClampedArray, px.constructor.name);
      ck('1. px length matches mtW*mtH', px.length === m.mtW * m.mtH, `${px.length} vs ${m.mtW * m.mtH}`);

      const renderBefore = renderHash();

      // ── 2. snapshot -> JSON -> apply round trip ──
      const snap = getUISnapshot();
      const wire = JSON.parse(JSON.stringify(snap));   // exactly what a sidecar/session stores
      ck('2. snapshot carries pxb64', typeof wire.masks[0].pxb64 === 'string' && wire.masks[0].pxb64.length > 0);
      ck('2. snapshot has no raw px', wire.masks[0].px === undefined);
      applyUISnapshot(wire);
      const after = fxState.masks[0].px;
      ck('2. px survives round trip byte-for-byte', same(original, after), `${origHash} vs ${digest(after)}`);
      ck('2. round-tripped px is typed', after instanceof Uint8ClampedArray, after.constructor.name);
      _mskTexDirty = true;
      ck('5. render identical after round trip', renderHash() === renderBefore);

      // ── 3. legacy plain-Array mask still loads ──
      const legacy = JSON.parse(JSON.stringify(wire));
      delete legacy.masks[0].pxb64;
      legacy.masks[0].px = Array.from(original);       // the pre-change on-disk shape
      applyUISnapshot(legacy);
      const fromLegacy = fxState.masks[0].px;
      ck('3. legacy Array px loads', fromLegacy instanceof Uint8ClampedArray, fromLegacy.constructor.name);
      ck('3. legacy px is byte-identical', same(original, fromLegacy));
      _mskTexDirty = true;
      ck('5. render identical from legacy form', renderHash() === renderBefore);

      // ── 4. copy-on-write + undo ──
      fxHistory = []; fxHistIdx = -1; _fxHistLocked = false;
      fxHistoryPush();                                  // entry 0 holds the current raster
      const e0 = fxHistory[0].rasters[0];
      ck('4. history holds the raster by reference', e0 === fxState.masks[0].px);

      fxState.artSeed = 1.5; fxHistoryPush();           // a non-paint edit
      ck('4. unpainted pushes SHARE one raster',
        fxHistory[1].rasters[0] === fxHistory[0].rasters[0]);

      const beforePaint = Uint8ClampedArray.from(fxState.masks[0].px);
      mskPaintAt(fxState.masks[0], 0.5, 0.5);           // now paint — must copy-on-write
      ck('4. painting does not mutate the history raster', same(beforePaint, fxHistory[1].rasters[0]));
      ck('4. painting swapped in a new array', fxState.masks[0].px !== fxHistory[1].rasters[0]);
      const painted = Uint8ClampedArray.from(fxState.masks[0].px);
      ck('4. paint actually changed pixels', !same(beforePaint, painted));

      fxHistoryPush();                                  // entry 2 = painted state
      ck('4. paint produced a new history entry', fxHistory.length === 3);
      // fxUndo/fxRedo became async (they now await applyUISnapshot's in-flight LUT-load promise
      // before _fxHistoryRestore reattaches the shared rasters) — an un-awaited call here reads
      // fxState.masks[0].px BEFORE the reattachment runs, so px is still undefined at that point
      // (the raster-less JSON restore hasn't had its raster put back yet). Not a flaky timing
      // window: it failed the same way on every run once fxUndo/fxRedo picked up their await.
      await fxUndo();
      ck('4. undo restores the pre-paint raster', same(beforePaint, fxState.masks[0].px), fxState.masks[0].px?digest(fxState.masks[0].px):'undefined');
      await fxRedo();
      ck('4. redo restores the painted raster', same(painted, fxState.masks[0].px));

      // Two real pointer strokes must become two independent history steps.
      fxHistory=[];fxHistIdx=-1;_fxHistLocked=false;mskPaintErase=false;mskPaintMode=true;
      fxState.masks[0].px.fill(0);_mskTexDirty=true;mskRebuild();fxHistoryPush();
      const untouched=Uint8ClampedArray.from(fxState.masks[0].px);
      pointer('pointerdown');pointer('pointerup');
      const firstStroke=Uint8ClampedArray.from(fxState.masks[0].px),firstHistoryLength=fxHistory.length;
      pointer('pointerdown');pointer('pointerup');
      const secondStroke=Uint8ClampedArray.from(fxState.masks[0].px);
      ck('CHR-275 each pointer stroke commits its own undo entry',firstHistoryLength===2&&fxHistory.length===3);
      ck('CHR-275 separate strokes each change the raster',!same(untouched,firstStroke)&&!same(firstStroke,secondStroke));
      await fxUndo();
      ck('CHR-275 first undo removes only the second stroke',same(firstStroke,fxState.masks[0].px));
      await fxUndo();
      ck('CHR-275 second undo removes the first stroke',same(untouched,fxState.masks[0].px));
      await fxRedo();await fxRedo();
      ck('CHR-275 two redos restore both separate strokes',same(secondStroke,fxState.masks[0].px));
      mskPaintStop();mskPaintErase=false;mskRebuild();Element.prototype.setPointerCapture=realSetPointerCapture;

      // ── 6. mskCopyToAll gives each photo its OWN raster ──
      if (fxImages.length === 1) {
        fxImages.push({ ...fxImages[0], masks: [] });   // a second photo, enough for the copy path
      }
      fxImages[fxCurIdx].masks = fxState.masks;
      mskCopyToAll();
      const other = fxImages.find((_, i) => i !== fxCurIdx);
      const copied = other && other.masks && other.masks[0];
      ck('6. copy-to-all copied the mask', !!copied && copied.px && copied.px.length === fxState.masks[0].px.length);
      ck('6. copied raster is a SEPARATE array', copied && copied.px !== fxState.masks[0].px);
      ck('6. copied raster is byte-identical', copied && same(fxState.masks[0].px, copied.px));

      return out;
    });
  } finally {
    await browser.close();
    server.close();
  }

  let fail = 0;
  console.log('\nraster mask storage / round-trip');
  console.log('-------------------------------------------------------------------------');
  for (const c of checks) {
    if (!c.pass) fail++;
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`);
  }
  console.log('-------------------------------------------------------------------------');
  console.log(`${checks.length - fail}/${checks.length} PASS`);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
