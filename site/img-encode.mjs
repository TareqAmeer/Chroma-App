// Downsize + WebP-encode, using the Chromium that Playwright already installs for the test
// harnesses. There is no `cwebp` on this machine and macOS `sips` refuses `-s format webp`
// (verified: exit 13), so the alternative was a new native dependency for what a canvas does in
// four lines. WebP is also what makes the JPEG-shaped .gitignore rule a non-issue — see
// site/README.md.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

export async function withEncoder(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  const encode = async (pngBuffer, { maxWidth = 1600, quality = 0.82 } = {}) => {
    const out = await page.evaluate(async ({ b64, maxWidth, quality }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxWidth / bmp.width);
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const url = c.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) throw new Error('this Chromium cannot encode WebP');
      return { data: url.split(',')[1], w, h };
    }, { b64: pngBuffer.toString('base64'), maxWidth, quality });
    return { buffer: Buffer.from(out.data, 'base64'), width: out.w, height: out.h };
  };
  // A 24px-wide WebP inlined as a data URI: it is under a kilobyte, so it ships inside the HTML
  // and paints instantly while the real photo decodes. Cheaper than a blurred SVG and it is the
  // actual colours of the actual photo.
  const lqip = async (pngBuffer) => {
    const { buffer } = await encode(pngBuffer, { maxWidth: 24, quality: 0.6 });
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  };
  try { return await fn({ encode, lqip, writeWebp: async (p, buf, o) => {
    const r = await encode(buf, o); await writeFile(p, r.buffer); return r;
  } }); } finally { await browser.close(); }
}
