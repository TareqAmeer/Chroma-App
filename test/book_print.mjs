// CHR-237 Book preview and print-document regression. Requires the workspace Playwright runtime
// (PLAYWRIGHT_MODULE) and Chrome (PLAYWRIGHT_EXECUTABLE_PATH); no external photo fixtures needed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--allow-file-access-from-files'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('chromasmith-22.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.clBookBuild === 'function', { timeout: 45000 });
  await page.evaluate(() => { switchTab('collage'); document.getElementById('cs-modal-ov')?.remove(); });
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });

  await page.evaluate(async () => {
    const svg = (n, color) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="${color}"/><text x="120" y="155" text-anchor="middle" font-size="38" fill="white">${n}</text></svg>`)}`;
    const colors = ['#a34','#3a4','#346','#a63','#639','#396','#953','#369','#693'];
    const photos = await Promise.all(colors.map(async (color, i) => {
      const img = new Image(); img.src = svg(i + 1, color); await img.decode();
      return { img, url: img.src, name: `book-${i + 1}.svg`, caption: `Photo ${i + 1}` };
    }));
    CL.photos = photos;
    CL.assign = photos.map((_, i) => i);
    CL.cells = photos.map(() => ({ scale: 1, ox: 0, oy: 0 }));
    CL.tree = clTemplates(photos.length)[0];
    CL.aspect = CL_ASPECTS.find(x => x[0] === '4:5');
    CL.title = 'Test photo book';
    CL.capAuto = true;
    document.getElementById('cl-book-size').value = '4';
  });

  await page.evaluate(() => window.clBookBuild());
  await page.waitForFunction(() => [...document.querySelectorAll('#cl-book-pages img')].length === 3 && [...document.querySelectorAll('#cl-book-pages img')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await page.locator('#cl-book-review').evaluate(el => el.classList.contains('on')), true);
  assert.deepEqual(await page.locator('.cl-book-page').evaluateAll(nodes => nodes.map(n => n.dataset.photoIndices)), ['0,1,2,3', '4,5,6,7', '8']);
  assert.equal(await page.locator('.cl-book-page img').count(), 3, 'nine assigned photos at four per page should render three real page images');
  assert.equal(await page.locator('#cl-book-count').textContent(), 'Book preview · 3 pages · 9 photos');

  await page.locator('.cl-book-page[data-page="1"] button[aria-label="Move page 2 earlier"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.cl-book-page').length === 3 && [...document.querySelectorAll('#cl-book-pages img')].every(i => i.complete && i.naturalWidth > 0));
  assert.deepEqual(await page.locator('.cl-book-page').evaluateAll(nodes => nodes.map(n => n.dataset.photoIndices)), ['4,5,6,7', '0,1,2,3', '8']);

  await page.locator('#cl-book-paper').selectOption('letter');
  await page.locator('#cl-book-margin').selectOption('0.5');
  assert.deepEqual(await page.locator('.cl-book-page').first().evaluate(node => ({paper:node.dataset.paper,width:node.dataset.paperWidth,height:node.dataset.paperHeight,margin:node.dataset.margin})),
    {paper:'letter',width:'8.500',height:'11.000',margin:'0.50'}, 'paper setup should update the visible page preview');

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  const printPage = await popupPromise;
  await printPage.waitForSelector('.page img');
  await printPage.waitForFunction(() => [...document.querySelectorAll('.page img')].length === 3 && [...document.querySelectorAll('.page img')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await printPage.locator('.page').count(), 3, 'print document must contain one printable sheet per book page');
  assert.match(await printPage.locator('style').textContent(), /@page\s*\{size:\s*8\.500in\s+11\.000in;margin:0\}/);
  assert.match(await printPage.locator('style').textContent(), /\.page\{width:8\.500in;height:11\.000in;padding:0\.50in/);
  assert.equal(await printPage.locator('.printbar').getAttribute('data-page-count'), '3');
  assert.equal(await printPage.locator('.printbar').getAttribute('data-paper'), 'letter');
  assert.equal(await printPage.locator('.printbar').getAttribute('data-margin-in'), '0.50');
  const pdf = await printPage.pdf({ printBackground: true });
  const pdfText = pdf.toString('latin1');
  assert.ok(pdfText.startsWith('%PDF-'), 'print document should produce a PDF');
  assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 3, 'PDF should contain one physical page per book page');
  assert.ok(pdfText.includes('/MediaBox [0 0 612 792]'), 'PDF page size should be US Letter (8.5 × 11 inches)');
  assert.deepEqual(errors, [], `unexpected source-app errors: ${errors.join('; ')}`);
  await printPage.close();
  console.log('PASS: Book paginates and reorders pages, previews selected paper/margins, and opens a matching multi-page print document.');
} finally {
  await browser.close();
}
