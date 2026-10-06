// Focused browser regression for CHR-255's web curve-touch interactions. This boots the
// production _crvInit handlers in a minimal real Chromium DOM so we can exercise actual
// Pointer Events and pointer capture without building the full desktop app.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const begin = html.indexOf('function _crvPos(e)');
const end = html.indexOf('// ══ LIFT / GAMMA / GAIN COLOUR WHEELS', begin);
assert.ok(begin >= 0 && end > begin, 'production curve pointer handlers are present');
const handlers = html.slice(begin, end);

const browser = await chromium.launch({ headless: true });
try {
  const boot = async () => {
    const page = await browser.newPage({ viewport: { width: 480, height: 800 }, hasTouch: true, isMobile: true });
    await page.setContent(`<style>body{margin:0}.fx-panel{height:260px;overflow:auto}.spacer{height:200px}canvas{display:block;width:300px;height:300px;touch-action:none}.tail{height:500px}</style><div class="fx-panel"><div class="spacer"></div><canvas id="cv-curve"></canvas><div class="tail"></div></div>`);
    // Synthetic PointerEvents are not eligible for native pointer capture. Stub only that DOM
    // primitive; dispatch through Chromium's real event system with pointerType='touch'.
    await page.addScriptTag({ content: `
    HTMLCanvasElement.prototype.setPointerCapture=function(){};
    let curveCh='m',_crvDrag=-1,_crvTouchDeleteTimer=0,fxTimer=0;
    const fxState={curves:{m:[[0,0],[.25,.25],[.5,.5],[.75,.75],[1,1]]}};
    let curveChangedCalls=0;function curveChanged(){curveChangedCalls++}
    function curveEval(pts){return x=>{let i=1;while(i<pts.length-1&&x>pts[i][0])i++;const a=pts[i-1],b=pts[i],t=(x-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*t}}
    function _crvEnsureOn(){} function bakeCurves(){} function drawCurveEditor(){} function renderPreview(){}
    ${handlers}
    _crvInit();
    ` });
    return page;
  };
  const deletePage = await boot();
  const box = await deletePage.locator('#cv-curve').boundingBox();
  const touch = async (page, type, x, y) => page.evaluate(({ type, x, y }) => {
    document.getElementById('cv-curve').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
  }, { type, x, y });
  const point = async (page, x) => page.evaluate(x => fxState.curves.m.find(p => Math.abs(p[0] - x) < .02), x);

  // Holding an interior point deletes it once and records one curve change.
  await touch(deletePage, 'pointerdown', box.x + 150, box.y + 150);
  await deletePage.waitForTimeout(650);
  assert.equal((await point(deletePage, .5)), undefined, 'long press removes the interior point');
  assert.equal(await deletePage.evaluate(() => curveChangedCalls), 1, 'long press produces one change');
  await touch(deletePage, 'pointerup', box.x + 150, box.y + 150);
  await deletePage.close();

  // A real drag cancels the hold action and continues through the captured pointer path.
  const page = await boot();
  const box2 = await page.locator('#cv-curve').boundingBox();
  await touch(page, 'pointerdown', box2.x + 150, box2.y + 150);
  await touch(page, 'pointermove', box2.x + 170, box2.y + 130);
  await page.waitForTimeout(650);
  await touch(page, 'pointerup', box2.x + 170, box2.y + 130);
  const moved = await point(page, .56);
  assert.ok(moved && moved[1] > .5, 'drag changes the point instead of deleting it');

  // Off-curve touch remains the existing deliberate panel-scroll gesture and adds no point.
  const before = await page.evaluate(() => fxState.curves.m.length);
  const scrollBefore = await page.locator('.fx-panel').evaluate(el => el.scrollTop);
  await touch(page, 'pointerdown', box2.x + 240, box2.y + 240);
  await touch(page, 'pointermove', box2.x + 240, box2.y + 210);
  await touch(page, 'pointerup', box2.x + 240, box2.y + 210);
  const scrollAfter = await page.locator('.fx-panel').evaluate(el => el.scrollTop);
  assert.equal(await page.evaluate(() => fxState.curves.m.length), before, 'off-curve touch adds no point');
  assert.ok(scrollAfter > scrollBefore, 'off-curve touch scrolls the panel');
  console.log('PASS: touch hold-delete, drag cancellation, and off-curve panel scroll');
} finally {
  await browser.close();
}
