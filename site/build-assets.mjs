// Turn the full-size photographs in site/photos-src/ into the web-sized pairs the landing page
// and README use, and write site/assets/manifest.json describing them.
//
//   node site/build-assets.mjs
//
// Drop files into site/photos-src/ named like this (any of .png/.jpg/.jpeg/.webp):
//
//   01-before.jpg   01-after.jpg   01.txt      <- 01.txt is the caption, one line
//   02-before.jpg   02-after.jpg   02.txt
//   hero.jpg                                   <- the big photo behind the headline
//
// photos-src/ is gitignored (originals are large and are yours); only the optimised output in
// site/assets/ is committed. Re-running is safe and idempotent.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEncoder } from './img-encode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'photos-src');
const ASSETS = path.join(__dirname, 'assets');
const BA = path.join(ASSETS, 'ba');
const IMG_RE = /\.(png|jpe?g|webp)$/i;

// The encoder speaks PNG-in / WebP-out, and a browser canvas will happily decode a JPEG too, so
// the "png buffer" it takes is really just "whatever bytes an <img> can read".
const read = (f) => readFile(path.join(SRC, f));

async function main() {
  await mkdir(BA, { recursive: true });
  let files = [];
  try { files = await readdir(SRC); } catch { /* created below */ }
  const pairs = new Map();
  let hero = null;
  for (const f of files) {
    if (!IMG_RE.test(f)) continue;
    const m = /^(\d+)-(before|after)\./i.exec(f);
    if (m) {
      const e = pairs.get(m[1]) || {};
      e[m[2].toLowerCase()] = f;
      pairs.set(m[1], e);
    } else if (/^hero\./i.test(f)) hero = f;
  }

  const manifest = { hero: null, pairs: [] };
  await withEncoder(async ({ encode, lqip }) => {
    if (hero) {
      const bytes = await read(hero);
      const r = await encode(bytes, { maxWidth: 2000, quality: 0.8 });
      await writeFile(path.join(ASSETS, 'hero.webp'), r.buffer);
      const og = await encode(bytes, { maxWidth: 1200, quality: 0.8 });
      await writeFile(path.join(ASSETS, 'og.webp'), og.buffer);
      manifest.hero = { src: 'site/assets/hero.webp', w: r.width, h: r.height, lqip: await lqip(bytes) };
      console.log(`  hero.webp  ${r.width}x${r.height}  ${(r.buffer.length / 1024).toFixed(0)}KB`);
    }
    for (const key of [...pairs.keys()].sort()) {
      const p = pairs.get(key);
      if (!p.before || !p.after) {
        console.warn(`  ! pair ${key} is missing its ${p.before ? 'after' : 'before'} file — skipped`);
        continue;
      }
      let caption = '';
      const capFile = files.find((f) => f === `${key}.txt`);
      if (capFile) caption = (await readFile(path.join(SRC, capFile), 'utf8')).trim().split('\n')[0];
      const out = {};
      for (const side of ['before', 'after']) {
        const r = await encode(await read(p[side]), { maxWidth: 1600, quality: 0.82 });
        const name = `${key}-${side}.webp`;
        await writeFile(path.join(BA, name), r.buffer);
        out[side] = { src: `site/assets/ba/${name}`, w: r.width, h: r.height };
      }
      manifest.pairs.push({ key, caption, ...out });
      console.log(`  pair ${key}  ${out.before.w}x${out.before.h}  ${caption || '(no caption)'}`);
    }
  });

  await writeFile(path.join(ASSETS, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.hero && !manifest.pairs.length) {
    console.log('\nNothing to build yet. Drop photos into site/photos-src/ — see the header of');
    console.log('this file, or site/README.md, for the naming.');
  } else {
    console.log(`\nWrote site/assets/manifest.json — ${manifest.pairs.length} pair(s), hero: ${manifest.hero ? 'yes' : 'no'}`);
    console.log('Now run: node site/build-page.mjs   (inlines the manifest into index.html)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
