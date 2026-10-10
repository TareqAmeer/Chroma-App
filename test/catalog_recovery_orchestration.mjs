import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const file = path.join(root, 'desktop/dist', decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const generation = '1791668450123456789';
const roots = [{ id: 7, added: generation, volume: 'volume-a', path: '/test/Photos' }];
const recovery = { version: 1, roots, requestedPhases: ['stack', 'thumbnails', 'focus', 'hash', 'faces', 'embed', 'cluster', 'clip', 'autotag', 'pets'], completedPhases: ['hash', 'faces'] };

async function openCase(jobId, identity = roots, phaseResult = () => undefined) {
  const page = await browser.newPage();
  const calls = [];
  await page.addInitScript(({ jobId, recovery, identity }) => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    localStorage.setItem('chromasmith-active-jobs-v1', JSON.stringify([{ id: jobId, kind: 'catalog', label: 'Indexing library', recovery, done: 0, total: 0, lastProgressAt: Date.now() }]));
    window.__libtestCatalogInvoke = command => {
      window.__recoveryCalls ||= [];
      const handled = ['catalog_root_identity', 'catalog_hash', 'catalog_faces_scan', 'catalog_embed_faces', 'catalog_clip_embed', 'catalog_pets_scan'].includes(command);
      if (!handled) return null;
      window.__recoveryCalls.push(command);
      if (command === 'catalog_root_identity') return { __libtestHandled: true, result: window.__recoveryIdentity };
      return { __libtestHandled: true, result: command === 'catalog_faces_scan' || command === 'catalog_pets_scan' ? { scanned: 0 } : undefined };
    };
    window.__recoveryIdentity = identity;
  }, { jobId, recovery, identity });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?libtest=1&libcat=1&librestoreview=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__libtestRecoveryEnabled = true;
    window.libActivityJobDone('controller-test', { jobId: 'controller-test', label: 'Harness ready', outcome: 'completed' });
    document.querySelector('#lib-activity .lib-act-pill')?.click();
  });
  const button = page.locator(`[data-job-index-resume-id="${jobId}"]`);
  if (!(await button.count())) console.log('recovery row debug', await page.evaluate(() => ({ html: document.querySelector('#lib-activity')?.innerHTML, active: localStorage.getItem('chromasmith-active-jobs-v1'), history: localStorage.getItem('chromasmith-job-history-v1') })));
  await button.waitFor({ state: 'attached', timeout: 5000 });
  return { page, calls, button };
}

try {
  {
    const { page, button } = await openCase('restart-retry');
    await page.evaluate(() => { const b = document.querySelector('[data-job-index-resume-id]'); b.click(); b.click(); });
    await page.waitForFunction(() => (window.__recoveryCalls || []).includes('catalog_hash'), { timeout: 3000 }).catch(async () => console.log('retry debug', await page.evaluate(() => ({ calls: window.__recoveryCalls, enabled: window.__libtestRecoveryEnabled, btn: !!document.querySelector('[data-job-index-resume-id]'), history: localStorage.getItem('chromasmith-job-history-v1') }))));
    if (!(await page.evaluate(() => (window.__recoveryCalls || []).includes('catalog_hash')))) errors.push('History Retry click did not reach the catalog recovery controller');
    await page.waitForFunction(() => document.querySelector('[data-job-history-id="restart-retry"]')?.textContent.includes('Partial'), { timeout: 10000 }).catch(() => {});
    const result = await page.evaluate(() => ({ calls: window.__recoveryCalls, html: document.querySelector('[data-job-history-id="restart-retry"]')?.innerHTML || '', history: JSON.parse(localStorage.getItem('chromasmith-job-history-v1') || '[]'), active: JSON.parse(localStorage.getItem('chromasmith-active-jobs-v1') || '[]') }));
    const phaseCommands = new Set(['catalog_hash', 'catalog_faces_scan', 'catalog_embed_faces', 'catalog_clip_embed', 'catalog_pets_scan']);
    const phaseCalls = result.calls.filter(call => phaseCommands.has(call));
    if (result.calls.filter(call => call === 'catalog_root_identity').length !== 6) errors.push(`duplicate retry was not guarded (expected one run's 6 source checks; got ${result.calls.filter(call => call === 'catalog_root_identity').length})`);
    if (phaseCalls.join(',') !== 'catalog_hash,catalog_faces_scan,catalog_embed_faces,catalog_clip_embed,catalog_pets_scan') errors.push(`retry phases wrong: ${phaseCalls.join(',')}`);
    if (result.history.find(row => row.id === 'restart-retry')?.status !== 'Partial') errors.push('unsupported requested work was not reported Partial');
    if (!result.history.find(row => row.id === 'restart-retry')?.detail.includes('normal library scan')) errors.push('partial result omitted unsupported normal-scan work');
    if (!result.html.includes('photo grouping') || !result.html.includes('thumbnails')) errors.push('history detail did not render the partial outcome with friendly phase names');
    await page.close();
  }
  {
    const changed = [{ ...roots[0], added: '1791668450123456790' }];
    const { page } = await openCase('changed-source', changed);
    await page.locator('[data-job-index-resume-id="changed-source"]').evaluate(button => button.click());
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => window.__recoveryCalls || []);
    if (calls.some(call => ['catalog_hash', 'catalog_faces_scan', 'catalog_embed_faces', 'catalog_clip_embed', 'catalog_pets_scan'].includes(call))) errors.push('source mismatch dispatched native work');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Catalog history retry controller: restart click, duplicate guard, source validation, supported marker dispatch and partial outcome passed (native operations mocked).');
