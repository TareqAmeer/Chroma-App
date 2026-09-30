// Renders assets/brand/favicon.svg into the PNG icons and the 1200x630 link-preview image
// (og-image.jpeg, used by WhatsApp/iMessage/Slack). Run: node tools/scripts/build-brand-icons.mjs
import {chromium} from 'playwright';
import fs from 'fs';
const root=new URL('../../',import.meta.url).pathname;
const svg=fs.readFileSync(root+'assets/brand/favicon.svg','utf8');
const photo='data:image/webp;base64,'+fs.readFileSync(root+'site/assets/story/main1-1600.webp').toString('base64');
const font='data:font/otf;base64,'+fs.readFileSync(root+'vendor/fonts/gramatika/GramatikaBold.otf').toString('base64');
const b=await chromium.launch();const p=await b.newPage();
for(const [n,s] of [['icon-32.png',32],['apple-touch-icon.png',180],['icon-512.png',512]]){
  await p.setViewportSize({width:s,height:s});
  await p.setContent(`<body style="margin:0">${svg.replace('<svg ',`<svg width="${s}" height="${s}" style="display:block" `)}</body>`);
  await p.screenshot({path:root+'assets/brand/'+n});
}
await p.setViewportSize({width:1200,height:630});
await p.setContent(`<style>@font-face{font-family:G;src:url(${font})}body{margin:0;width:1200px;height:630px;background:#0b0b0a url(${photo}) center/cover;font-family:G;color:#f2efe8;position:relative}
.s{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,11,10,.92) 0,rgba(11,11,10,.6) 55%,rgba(11,11,10,.1))}
.c{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
h1{font-size:92px;line-height:.9;margin:28px 0 0;font-weight:900}p{font-size:28px;color:#c9c5bb;margin:22px 0 0;max-width:560px;line-height:1.3}</style>
<div class="s"></div><div class="c">${svg.replace('<svg ','<svg width="120" height="120" ')}<h1>CHRO-MA-SMITH</h1><p>Gallery. Studio. Film Lab.<br>your photos, your workflow, your app</p></div>`);
await p.evaluate(()=>document.fonts.ready);
await p.screenshot({path:root+'assets/brand/og-image.jpeg',type:'jpeg',quality:82});
await b.close();
