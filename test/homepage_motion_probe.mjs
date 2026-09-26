import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.evaluate(() => {
    window.__motionSamples = [];
    const start = performance.now();
    const sample = now => {
      window.__motionSamples.push([Math.round(now - start), Math.round(scrollY)]);
      if (now - start < 1500) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.wheel(0, 120);
  if (process.argv.includes('--shots')) {
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(root, 'drafts/chr-152-motion-mid.png') });
  }
  await page.waitForFunction(() => !gliding && Math.abs(scrollY - document.getElementById('gallery').offsetTop) < 2);
  const samples = await page.evaluate(() => window.__motionSamples);
  const steps = samples.slice(1).map((sample, index) => sample[1] - samples[index][1]);
  const gaps = samples.slice(1).map((sample, index) => sample[0] - samples[index][0]);
  const moving = steps.filter(step => Math.abs(step) > 0);
  assert.ok(moving.length > 20, `expected continuous motion, saw ${moving.length} moving frames`);
  assert.ok(Math.max(...moving.map(Math.abs)) < 220, 'no single-frame page jump');
  assert.ok(steps.filter(step => step < -2).length < 4, 'scroll should move toward the chapter');
  console.log({ movingFrames: moving.length, maxStep: Math.max(...moving.map(Math.abs)),
    p95FrameGap: [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * .95)], finalY: samples.at(-1)[1] });
} finally { await browser.close(); }
