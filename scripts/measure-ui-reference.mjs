#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function fail(message) {
  console.error(`measurement: ${message}`);
  process.exit(1);
}

function readPng(input) {
  if (!fs.existsSync(input)) fail(`missing file '${input}'`);
  if (path.extname(input).toLowerCase() !== '.png') fail('only PNG is supported deterministically by installed libraries; WebP is unsupported');
  try {
    const bytes = fs.readFileSync(input);
    return { bytes, png: PNG.sync.read(bytes) };
  } catch (error) {
    fail(`unable to decode '${input}' as PNG (${error.message})`);
  }
}

function parseCoordinate(coordinate, png) {
  const [x, y, ...extra] = coordinate.split(',').map(Number);
  if (extra.length || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= png.width || y >= png.height) fail(`invalid pixel coordinate '${coordinate}' for ${png.width}x${png.height}`);
  const offset = (png.width * y + x) * 4;
  return { x, y, rgba: Array.from(png.data.subarray(offset, offset + 4)) };
}

function parseCrop(value, png) {
  const [id, coordinates] = value.split(':');
  const [x, y, width, height, ...extra] = (coordinates || '').split(',').map(Number);
  if (!id || !coordinates || extra.length || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || x < 0 || y < 0 || x + width > png.width || y + height > png.height) fail(`invalid crop '${value}' for ${png.width}x${png.height}; use id:x,y,width,height within image bounds`);
  const min = [255, 255, 255, 255]; const max = [0, 0, 0, 0]; const sum = [0, 0, 0, 0];
  for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) {
    const offset = (png.width * row + column) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const sample = png.data[offset + channel]; min[channel] = Math.min(min[channel], sample); max[channel] = Math.max(max[channel], sample); sum[channel] += sample;
    }
  }
  const pixelCount = width * height;
  return { id, rect: { x, y, width, height }, pixelStatistics: { pixelCount, rgbaMean: sum.map((sample) => sample / pixelCount), rgbaMin: min, rgbaMax: max } };
}

function writeJson(outputDir, filename, result) {
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, filename);
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(output);
}

function measure(input, outputDir, argumentsList) {
  const { bytes, png } = readPng(input); const samples = []; const crops = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === '--crop') { if (!argumentsList[index + 1]) fail('missing crop after --crop'); crops.push(parseCrop(argumentsList[index + 1], png)); index += 1; } else samples.push(parseCoordinate(argumentsList[index], png));
  }
  writeJson(outputDir, `${path.basename(input, path.extname(input))}.measurements.json`, {
    asset: { path: path.resolve(input), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), format: 'png', dimensions: { width: png.width, height: png.height } }, samples, crops,
    method: 'pngjs PNG decode; exact RGBA byte samples and source-image crop rectangles',
  });
}

function compare(baselinePath, candidatePath, outputDir) {
  const baseline = readPng(baselinePath).png; const candidate = readPng(candidatePath).png;
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) fail(`dimension mismatch: baseline is ${baseline.width}x${baseline.height}, candidate is ${candidate.width}x${candidate.height}`);
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const changedPixels = pixelmatch(baseline.data, candidate.data, diff.data, baseline.width, baseline.height, { threshold: 0.1 });
  let bounds = null; let rawChangedPixels = 0;
  for (let y = 0; y < baseline.height; y += 1) for (let x = 0; x < baseline.width; x += 1) {
    const offset = (baseline.width * y + x) * 4;
    if ([0, 1, 2, 3].some((channel) => baseline.data[offset + channel] !== candidate.data[offset + channel])) {
      rawChangedPixels += 1; bounds = bounds || { minX: x, minY: y, maxX: x, maxY: y };
      bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  const changedBounds = bounds && { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1 };
  fs.mkdirSync(outputDir, { recursive: true });
  if (changedPixels > 0) fs.writeFileSync(path.join(outputDir, `${path.basename(candidatePath, '.png')}.diff.png`), PNG.sync.write(diff));
  writeJson(outputDir, `${path.basename(candidatePath, '.png')}.comparison.json`, {
    baseline: path.resolve(baselinePath), candidate: path.resolve(candidatePath), format: 'png', dimensions: { width: baseline.width, height: baseline.height },
    pixelmatch: { threshold: 0.1, changedPixels, changedRatio: changedPixels / (baseline.width * baseline.height) }, rawRgbaDelta: { changedPixels: rawChangedPixels, changedBounds },
    method: 'pixelmatch 7.2.0 with threshold 0.1; raw RGBA bounds locate all byte differences',
  });
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  if (args.length !== 4) fail('usage: --compare <baseline.png> <candidate.png> <output-dir>');
  compare(args[1], args[2], args[3]);
} else {
  const [input, outputDir, ...argumentsList] = args;
  if (!input || !outputDir) fail('usage: <png> <output-dir> [x,y ...] [--crop id:x,y,width,height ...]');
  measure(input, outputDir, argumentsList);
}
