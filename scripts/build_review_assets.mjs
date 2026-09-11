// Builds review-page assets for design/asbuilt/: a splash screenshot (no live DOM route,
// so rendered from the wireframe file) and a per-surface contact sheet of every non-hero state.
// Run: node scripts/build_review_assets.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const ASBUILT = path.join(ROOT, 'design/asbuilt');
const HERO_ORDER = ['rest.webp', 'loaded.webp', 'noPhoto.webp'];

async function main() {
  const browser = await chromium.launch();

  // 1. Splash: screenshot the wireframe file at the app's desktop viewport (1400x900).
  const splashDir = path.join(ASBUILT, 'splash');
  const splashHtml = path.join(ROOT, 'chromasmith-design/project/Splash Screen.html');
  if (fs.existsSync(splashHtml)) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto('file://' + splashHtml);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(splashDir, 'wireframe.webp') });
    await page.close();
    console.log('[splash] wireframe.webp captured');
  } else {
    console.log('[splash] WARNING: wireframe file not found at', splashHtml);
  }

  // 2. Contact sheets: one per surface, all captured states except whichever is used as hero.
  const dirs = fs.readdirSync(ASBUILT).filter(d => fs.statSync(path.join(ASBUILT, d)).isDirectory());
  const page = await browser.newPage();
  for (const id of dirs) {
    if (id === 'splash') continue;
    const dir = path.join(ASBUILT, id);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.webp'));
    const hero = HERO_ORDER.find(h => files.includes(h));
    const others = files.filter(f => f !== hero).sort();
    if (others.length === 0) {
      console.log(`[${id}] no non-hero states, skipping contact sheet`);
      continue;
    }
    const cells = others.map(f => {
      const label = f.replace('.webp', '');
      const uri = 'file://' + path.join(dir, f);
      return `<div class="cell"><div class="label">${label}</div><img src="${uri}"></div>`;
    }).join('\n');
    const html = `<!doctype html><html><head><style>
      body{margin:0;background:#1a1a1a;font-family:-apple-system,sans-serif;padding:16px;}
      .grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;}
      .cell{border:1px solid #444;border-radius:6px;overflow:hidden;background:#222;}
      .label{color:#eee;font-size:12px;padding:4px 8px;background:#333;}
      img{display:block;max-width:360px;max-height:280px;object-fit:contain;background:#000;}
    </style></head><body><div class="grid">${cells}</div></body></html>`;
    await page.setContent(html);
    await page.waitForTimeout(150);
    const grid = await page.$('.grid');
    await grid.screenshot({ path: path.join(dir, 'contact.webp') });
    console.log(`[${id}] contact.webp (${others.length} states)`);
  }
  await page.close();
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
