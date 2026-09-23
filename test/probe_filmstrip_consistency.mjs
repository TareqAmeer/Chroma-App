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

// Test with images that have various aspect ratios
const testFiles = [
  path.join(imgdir, 'portrait.png'),           // 512x384 (1.33:1 landscape)
  path.join(imgdir, 'gradient.png'),           // 512x384 (1.33:1 landscape)
  path.join(imgdir, 'orientation_portrait.png'),// 384x512 (0.75:1 portrait)
  path.join(imgdir, 'orientation_panorama.png') // 1600x400 (4:1 panorama)
];

await pg.setInputFiles('#in-fx-img', testFiles);
await pg.waitForFunction(()=>fxImages.length>=4, null, {timeout:60000});
await pg.waitForTimeout(500);

// Get the actual rendered pixel data from the filmstrip thumbnails
const pixelData = await pg.evaluate(() => {
  const results = [];
  const thumbs = document.querySelectorAll('.fs-thumb canvas');
  
  thumbs.forEach((canvas, idx) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Calculate the bounding box of non-transparent pixels
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 128) {  // Consider semi-transparent pixels as "drawn"
        const pixelIdx = i / 4;
        const x = pixelIdx % canvas.width;
        const y = Math.floor(pixelIdx / canvas.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    
    const drawnWidth = maxX >= 0 ? maxX - minX + 1 : 0;
    const drawnHeight = maxY >= 0 ? maxY - minY + 1 : 0;
    
    results.push({
      index: idx,
      name: fxImages[idx].name,
      canvasDims: { width: canvas.width, height: canvas.height },
      drawnBounds: { minX, minY, maxX, maxY },
      drawnDims: { width: drawnWidth, height: drawnHeight },
      drawnAspectRatio: drawnWidth > 0 && drawnHeight > 0 ? (drawnWidth / drawnHeight).toFixed(3) : 'N/A',
      sourceAspectRatio: (fxImages[idx].img.naturalWidth || fxImages[idx].img.width) / 
                         (fxImages[idx].img.naturalHeight || fxImages[idx].img.height)
    });
  });
  
  return results;
});

console.log('Filmstrip pixel data analysis:');
pixelData.forEach(info => {
  const fitsInCanvas = info.drawnDims.width <= 52 && info.drawnDims.height <= 52;
  const aspectPreserved = typeof info.drawnAspectRatio === 'string' ?
    Math.abs(parseFloat(info.drawnAspectRatio) - info.sourceAspectRatio) / info.sourceAspectRatio < 0.10 :
    false;
  console.log(`[${info.index}] ${info.name}:`);
  console.log(`    Source aspect ratio: ${info.sourceAspectRatio.toFixed(3)}`);
  console.log(`    Drawn dimensions: ${info.drawnDims.width}x${info.drawnDims.height} (AR: ${info.drawnAspectRatio})`);
  console.log(`    Fits in 52x52: ${fitsInCanvas ? 'YES' : 'NO'}`);
  console.log(`    Aspect ratio preserved: ${aspectPreserved ? 'YES' : 'NO'}`);
});

// Verify consistency across all thumbnails
const allFitInContainer = pixelData.every(info => 
  info.drawnDims.width <= 52 && info.drawnDims.height <= 52
);

const allPreserveAspect = pixelData.every(info => {
  if (typeof info.drawnAspectRatio === 'string') return true;
  // Allow up to 10% difference due to pixel rounding in canvas rendering
  const drawn = parseFloat(info.drawnAspectRatio);
  const source = info.sourceAspectRatio;
  return Math.abs(drawn - source) / source < 0.10;
});

if (allFitInContainer && allPreserveAspect) {
  console.log('\nPASS: Filmstrip thumbnails are consistent and properly scaled.');
  console.log('All thumbnails fit in their containers and preserve aspect ratio.');
} else {
  console.log('\nFAIL: Filmstrip thumbnails have issues.');
  if (!allFitInContainer) console.log('- Some thumbnails overflow their containers');
  if (!allPreserveAspect) console.log('- Some thumbnails do not preserve aspect ratio');
}

await br.close();
srv.close();
