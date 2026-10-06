import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    const data = await readFile(path.join(ROOT, decodeURIComponent(url).slice(1)));
    res.writeHead(200, { 'Content-Type': url.endsWith('.html') ? 'text/html' : 'image/png' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof healApply === 'function');
  const result = await page.evaluate(async () => {
    const image = await (await fetch('test/fixtures/portrait.png')).blob();
    await loadFXImages([new File([image], 'portrait.png', { type: 'image/png' })]);
    await new Promise(resolve => setTimeout(resolve, 400));

    const feather = document.getElementById('sl-heal-feather');
    feather.value = '0';
    healAdd(0.5, 0.5, null);
    const added = curItem().heal.at(-1);
    const addedFeather = added.feather;
    const sampledSource = [added.sx, added.sy];
    const recipeSnapshot = JSON.parse(JSON.stringify(getUISnapshot().heal));
    saveSession(true);
    const sessionRecipe = JSON.parse(localStorage.getItem('chromasmith-session-v1'))._heal;

    // Old recipes may not yet contain an auto donor. The first application should resolve it
    // into source-normalized coordinates, and subsequent raster sizes must keep that same pair.
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const v = (x * 11 + y * 7) % 180;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const pixel = (source, x, y) => Array.from(source.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
    const hardEdge = { x: 0.5, y: 0.5, sx: 0.25, sy: 0.25, r: 0.04, feather: 0, opacity: 1, mode: 'clone' };
    const beforeCenter = pixel(canvas, 60, 40);
    const expectedDonor = pixel(canvas, 30, 20);
    const beforeOutside = pixel(canvas, 66, 40);
    const hardEdgeResult = healApply(canvas, [hardEdge]);
    const afterCenter = pixel(hardEdgeResult, 60, 40);
    const afterOutside = pixel(hardEdgeResult, 66, 40);

    const legacy = { x: 0.5, y: 0.5, r: 0.04, feather: 0.5, opacity: 1, mode: 'clone' };
    healApply(canvas, [legacy]);
    const lockedSource = [legacy.sx, legacy.sy];
    const smaller = document.createElement('canvas');
    smaller.width = 60;
    smaller.height = 40;
    smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
    healApply(smaller, [legacy]);
    return {
      addedFeather, sampledSource, lockedSource, sourceAfterResize: [legacy.sx, legacy.sy],
      recipeSnapshot, sessionRecipe,
      hardEdge: { beforeCenter, afterCenter, expectedDonor, beforeOutside, afterOutside },
    };
  });

  assert.equal(result.addedFeather, 0, 'a zero Feather slider value should remain zero in the recipe');
  assert.ok(result.sampledSource.every(Number.isFinite), 'new auto-sampled spots should persist a donor');
  assert.deepEqual([result.recipeSnapshot[0].sx, result.recipeSnapshot[0].sy], result.sampledSource, 'the edit recipe snapshot should retain the auto donor');
  assert.deepEqual([result.sessionRecipe[0].sx, result.sessionRecipe[0].sy], result.sampledSource, 'the browser session should retain the auto donor');
  assert.equal(result.sessionRecipe[0].feather, 0, 'the browser session should retain zero Feather');
  assert.ok(result.lockedSource.every(Number.isFinite), 'legacy auto-sampled spots should resolve a donor');
  assert.deepEqual(result.sourceAfterResize, result.lockedSource, 'the donor should stay fixed across raster sizes');
  assert.deepEqual(result.hardEdge.afterCenter, result.hardEdge.expectedDonor, 'zero Feather should apply a solid clone at the spot center');
  assert.deepEqual(result.hardEdge.afterOutside, result.hardEdge.beforeOutside, 'zero Feather should leave pixels outside the spot unchanged');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
