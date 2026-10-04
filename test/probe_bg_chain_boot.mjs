// Regression: a launch that restores a catalog view (All Photos) never called openFolder, so the
// background chain (thumbs/faces/CLIP tags/pets) never started and "Tagged X of Y" froze.
import fs from 'fs';
const src = fs.readFileSync(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const boot = src.slice(src.indexOf("document.body.classList.contains('deskx')"));
if (!/if \(!window\._lastCatalogRegisterPromise\) catalogRunBackgroundPhases\(\)/.test(boot)) fail('deskx boot does not start the background chain when openFolder was skipped');
const chain = src.slice(src.indexOf('function catalogRunBackgroundPhases'), src.indexOf('Guaranteed-offline tier'));
for (const c of ['catalog_faces_scan', 'catalog_embed_faces', 'catalog_cluster_faces', 'catalog_clip_embed', 'catalog_pets_scan']) if (!chain.includes(c)) fail('background chain missing ' + c);
console.log('PASS');
