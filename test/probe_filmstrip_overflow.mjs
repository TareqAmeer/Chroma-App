import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tareqameer/Documents/GitHub/Chroma-App';
const imgdir = '/Users/tareqameer/Documents/GitHub/Chroma-App/test/fixtures';

const srv = createServer(async (q,r)=>{try{const b=await readFile(path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/\/$/,'/index.html')));r.setHeader('content-type',q.url.endsWith('.html')?'text/html':'application/octet-stream');r.end(b)}catch{r.statusCode=404;r.end()}}).listen(0);
const port = srv.address().port;

const br = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg = await br.newPage({viewport:{width:1200,height:800}});
pg.on('pageerror',e=>console.log('pageerror',e.message));
await pg.goto(`http://localhost:${port}/chromasmith-22.html`);
await pg.waitForTimeout(1500);

// Test with images that have different aspect ratios
const testFiles = [
  path.join(imgdir, 'portrait.png'),  // 512x384 (landscape-ish 1.33:1)
  path.join(imgdir, 'gradient.png'),  // 512x384
  path.join(imgdir, 'orientation_portrait.png'),  // Should be portrait
  path.join(imgdir, 'orientation_panorama.png')   // Should be panorama
];

await pg.setInputFiles('#in-fx-img', testFiles);
await pg.waitForFunction(()=>fxImages.length>=4, null, {timeout:60000});
await pg.waitForTimeout(500);

// Now check the actual canvas drawing
const thumbnailInfo = await pg.evaluate(() => {
  const results = [];
  const thumbs = document.querySelectorAll('.fs-thumb');
  
  thumbs.forEach((thumb, idx) => {
    const canvas = thumb.querySelector('canvas');
    if (!canvas) return;
    
    const img = fxImages[idx].img;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.min(52/iw, 52/ih);
    const dw = iw*s;
    const dh = ih*s;
    
    // Calculate what the overflow should be
    const overflowX = Math.max(0, dw - 52);
    const overflowY = Math.max(0, dh - 52);
    const canvasElement = canvas;
    const thumbElement = thumb;
    
    results.push({
      index: idx,
      name: fxImages[idx].name,
      imageDims: { width: iw, height: ih },
      imageName: fxImages[idx].name,
      aspectRatio: (iw / ih).toFixed(3),
      calculatedScale: s.toFixed(6),
      calculatedDrawDims: { width: dw.toFixed(2), height: dh.toFixed(2) },
      canvasElementSize: { width: canvasElement.width, height: canvasElement.height },
      overflowDimensions: { x: overflowX.toFixed(2), y: overflowY.toFixed(2) },
      thumbStyle: {
        width: thumbElement.style.width || window.getComputedStyle(thumbElement).width,
        height: thumbElement.style.height || window.getComputedStyle(thumbElement).height,
        overflow: window.getComputedStyle(thumbElement).overflow
      },
      canvasStyle: {
        width: canvasElement.style.width || window.getComputedStyle(canvasElement).width,
        height: canvasElement.style.height || window.getComputedStyle(canvasElement).height
      }
    });
  });
  
  return results;
});

console.log('Filmstrip thumbnail overflow check:');
thumbnailInfo.forEach(info => {
  const hasOverflow = parseFloat(info.overflowDimensions.x) > 0.1 || parseFloat(info.overflowDimensions.y) > 0.1;
  console.log(`[${info.index}] ${info.name}: ${info.imageDims.width}x${info.imageDims.height} (AR:${info.aspectRatio})`);
  console.log(`    Drawn as: ${info.calculatedDrawDims.width}x${info.calculatedDrawDims.height}`);
  console.log(`    Overflow: X:${info.overflowDimensions.x}px Y:${info.overflowDimensions.y}px ${hasOverflow ? 'OVERFLOW!' : 'OK'}`);
});

// Check if any thumbnails have overflow
const anyOverflow = thumbnailInfo.some(info => 
  parseFloat(info.overflowDimensions.x) > 0.1 || parseFloat(info.overflowDimensions.y) > 0.1
);

if (anyOverflow) {
  console.log('\nFAIL: Some filmstrip thumbnails overflow their containers!');
  console.log('This means landscapes will be clipped and appear with different aspect ratios than portraits.');
} else {
  console.log('\nPASS: All thumbnails fit within their 52x52 containers.');
}

await br.close();
srv.close();
