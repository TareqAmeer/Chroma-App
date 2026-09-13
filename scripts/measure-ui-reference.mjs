#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [input, outputDir, ...coordinates] = process.argv.slice(2);
if (!input || !outputDir) {
  console.error('usage: npm run reference:measure -- <png> <output-dir> [x,y ...]');
  process.exit(1);
}
if (path.extname(input).toLowerCase() !== '.png') {
  console.error('measurement: only PNG is supported deterministically by installed libraries; WebP is unsupported');
  process.exit(1);
}
const png = PNG.sync.read(fs.readFileSync(input));
const samples = coordinates.map((coordinate) => {
  const [x, y] = coordinate.split(',').map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= png.width || y >= png.height) {
    throw new Error(`invalid pixel coordinate '${coordinate}' for ${png.width}x${png.height}`);
  }
  const offset = (png.width * y + x) * 4;
  return { x, y, rgba: Array.from(png.data.subarray(offset, offset + 4)) };
});
fs.mkdirSync(outputDir, { recursive: true });
const result = { asset: path.resolve(input), format: 'png', dimensions: { width: png.width, height: png.height }, samples, method: 'pngjs PNG decode and exact RGBA byte sampling' };
const output = path.join(outputDir, `${path.basename(input, path.extname(input))}.measurements.json`);
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(output);
