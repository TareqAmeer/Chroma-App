#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const usage = 'Usage: node test/mask_refinement_quality.mjs --manifest <manifest.json> | --self-test';
const args = process.argv.slice(2);
const option = args[0];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

function readCoverage(file) {
  const png = loadPng(file);
  const values = new Uint8Array(png.width * png.height);
  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4;
    assert(png.data[offset] === png.data[offset + 1] && png.data[offset] === png.data[offset + 2], `${file}: coverage PNG must be grayscale`);
    assert(png.data[offset + 3] === 255, `${file}: coverage PNG must be opaque grayscale`);
    values[i] = png.data[offset];
  }
  return { ...png, values };
}

function assertSameSize(reference, candidate, label) {
  assert(reference.width === candidate.width && reference.height === candidate.height, `${label}: expected ${reference.width}x${reference.height}, got ${candidate.width}x${candidate.height}`);
}

function summarize(fixture) {
  const { truth, candidate, photo } = fixture;
  const n = truth.values.length;
  let alphaAbs = 0;
  let boundaryAbs = 0;
  let boundaryCount = 0;
  let falsePositive = 0;
  let backgroundCount = 0;
  let blackCompositeAbs = 0;
  let whiteCompositeAbs = 0;

  for (let y = 0; y < truth.height; y += 1) {
    for (let x = 0; x < truth.width; x += 1) {
      const i = y * truth.width + x;
      const t = truth.values[i] / 255;
      const c = candidate.values[i] / 255;
      alphaAbs += Math.abs(c - t);

      // Include the labelled transition and a one-pixel neighborhood of hard labels.
      let isBoundary = t > 0 && t < 1;
      for (let dy = -1; dy <= 1 && !isBoundary; dy += 1) {
        for (let dx = -1; dx <= 1 && !isBoundary; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= truth.width || ny >= truth.height) continue;
          const neighbor = truth.values[ny * truth.width + nx] / 255;
          if ((t === 0 && neighbor > 0) || (t === 1 && neighbor < 1)) isBoundary = true;
        }
      }
      if (isBoundary) {
        boundaryAbs += Math.abs(c - t);
        boundaryCount += 1;
      }
      if (t <= 1 / 255) {
        backgroundCount += 1;
        if (c > 1 / 255) falsePositive += 1;
      }

      const rgbOffset = i * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const color = photo.data[rgbOffset + channel] / 255;
        blackCompositeAbs += Math.abs(color * c - color * t);
        whiteCompositeAbs += Math.abs((color * c + 1 - c) - (color * t + 1 - t));
      }
    }
  }

  return {
    alphaMae: alphaAbs / n,
    boundaryMae: boundaryCount ? boundaryAbs / boundaryCount : 0,
    falsePositivePercent: backgroundCount ? (falsePositive / backgroundCount) * 100 : 0,
    blackCompositeMae: blackCompositeAbs / (n * 3),
    whiteCompositeMae: whiteCompositeAbs / (n * 3),
    boundaryPixels: boundaryCount,
  };
}

function runManifest(manifestFile) {
  const manifestPath = path.resolve(manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.version === 1, 'manifest.version must be 1');
  assert(manifest.provenance && manifest.provenance.license && manifest.provenance.source, 'manifest must record provenance.source and provenance.license');
  assert(Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0, 'manifest.fixtures must contain at least one labelled fixture');
  assert(manifest.thresholds && Object.keys(manifest.thresholds).length > 0, 'manifest.thresholds must be fixed before evaluation');
  const requiredCategories = ['hair', 'foliage', 'fine-edge'];
  const categories = new Set();
  const outcomes = [];
  const base = path.dirname(manifestPath);

  for (const fixtureSpec of manifest.fixtures) {
    assert(typeof fixtureSpec.id === 'string' && fixtureSpec.id.length > 0, 'each fixture needs an id');
    assert(Array.isArray(fixtureSpec.categories) && fixtureSpec.categories.length > 0, `${fixtureSpec.id}: categories are required`);
    for (const category of fixtureSpec.categories) categories.add(category);
    for (const key of ['photo', 'groundTruth', 'sourceMask', 'refinedMask']) assert(fixtureSpec[key], `${fixtureSpec.id}: ${key} path is required`);

    const load = (key) => path.resolve(base, fixtureSpec[key]);
    const photo = loadPng(load('photo'));
    const truth = readCoverage(load('groundTruth'));
    const source = readCoverage(load('sourceMask'));
    const candidate = readCoverage(load('refinedMask'));
    assertSameSize(truth, photo, `${fixtureSpec.id} photo`);
    assertSameSize(truth, source, `${fixtureSpec.id} source mask`);
    assertSameSize(truth, candidate, `${fixtureSpec.id} refined mask`);
    const sourceMetrics = summarize({ truth, candidate: source, photo });
    const metrics = summarize({ truth, candidate, photo });
    const failures = [];
    for (const metric of ['alphaMae', 'boundaryMae', 'falsePositivePercent', 'blackCompositeMae', 'whiteCompositeMae']) {
      assert(Number.isFinite(manifest.thresholds[metric]), `thresholds.${metric} must be a finite number`);
      if (metrics[metric] > manifest.thresholds[metric]) failures.push(`${metric} ${metrics[metric].toFixed(6)} > ${manifest.thresholds[metric]}`);
    }
    outcomes.push({
      id: fixtureSpec.id,
      categories: fixtureSpec.categories,
      sourceMetrics,
      refinedMetrics: metrics,
      delta: Object.fromEntries(['alphaMae', 'boundaryMae', 'falsePositivePercent', 'blackCompositeMae', 'whiteCompositeMae'].map((key) => [key, metrics[key] - sourceMetrics[key]])),
      failures,
    });
  }

  const missingCategories = requiredCategories.filter((category) => !categories.has(category));
  const passed = missingCategories.length === 0 && outcomes.every((outcome) => outcome.failures.length === 0);
  console.log(JSON.stringify({
    manifest: path.relative(process.cwd(), manifestPath),
    provenance: manifest.provenance,
    thresholds: manifest.thresholds,
    requiredCategories,
    missingCategories,
    passed,
    fixtures: outcomes,
    note: 'This gate evaluates labelled mask exports; it does not claim semantic quality or prove all visual halos are absent.',
  }, null, 2));
  if (!passed) process.exitCode = 1;
}

function runSelfTest() {
  const width = 5;
  const height = 5;
  const makeRaster = (fill = 0) => ({ width, height, values: new Uint8Array(width * height).fill(fill) });
  const truth = makeRaster();
  const candidate = makeRaster();
  const photo = { width, height, data: Buffer.alloc(width * height * 4) };
  for (let i = 0; i < width * height; i += 1) {
    photo.data.set([64, 128, 192, 255], i * 4);
  }
  // Opaque 3x3 center with a fractional labelled edge, copied exactly to candidate.
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) truth.values[y * width + x] = candidate.values[y * width + x] = 255;
  truth.values[2 * width + 1] = candidate.values[2 * width + 1] = 128;
  const metrics = summarize({ truth, candidate, photo });
  assert(metrics.alphaMae === 0 && metrics.boundaryMae === 0, 'identical labelled matte should have zero alpha and boundary error');
  assert(metrics.falsePositivePercent === 0 && metrics.blackCompositeMae === 0 && metrics.whiteCompositeMae === 0, 'identical labelled matte should have zero false positives and composite error');
  candidate.values[0] = 255;
  const changed = summarize({ truth, candidate, photo });
  assert(changed.alphaMae > 0 && changed.falsePositivePercent > 0 && changed.whiteCompositeMae > 0, 'added stray foreground should increase alpha, false-positive and white-composite errors');
  console.log('PASS: quality metrics respond to a stray foreground pixel and stay zero for an exact labelled matte.');
}

try {
  if (option === '--self-test' && args.length === 1) runSelfTest();
  else if (option === '--manifest' && args[1]) runManifest(args[1]);
  else throw new Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
