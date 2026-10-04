// Renders the Arabic link-preview card site/og/og-ar.html -> assets/brand/og-image-ar.jpeg (1200x630).
// Needs a static server at the repo root:  python3 -m http.server 8000  then  node site/og/render-og-ar.mjs [port]
import {chromium} from 'playwright';
const port=process.argv[2]||8000;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1200,height:630}});
await p.goto(`http://localhost:${port}/site/og/og-ar.html`);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
await p.screenshot({path:'assets/brand/og-image-ar.jpeg',type:'jpeg',quality:86});await b.close();
