// Renders the current mark (assets/brand/favicon.svg) into the native-shell icon + splash art:
// assets/icon-only.png, assets/splash{,-dark}.png and the iOS AppIcon / Splash imagesets.
// Run: node tools/scripts/build-native-brand.mjs   (then build-ios.sh picks them up)
import {chromium} from 'playwright';
import fs from 'fs';
const root=new URL('../../',import.meta.url).pathname;
const svg=fs.readFileSync(root+'assets/brand/favicon.svg','utf8');
// Full-bleed dark square; mark inside the middle ~60% so iOS corner rounding never touches it.
const padded=svg.replace(/viewBox="[^"]*"/,'viewBox="3 2 94 94"').replace('<rect x="17" y="17" width="66" height="66"','<rect x="0" y="0" width="100" height="100"');
const b=await chromium.launch();const p=await b.newPage();
async function shot(size,html,out){await p.setViewportSize({width:size,height:size});await p.setContent(`<body style="margin:0">${html}</body>`);await p.screenshot({path:root+out});}
const icon=padded.replace('<svg ','<svg width="1024" height="1024" style="display:block" ');
await shot(1024,icon,'assets/icon-only.png');
fs.copyFileSync(root+'assets/icon-only.png',root+'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const splash=(bg)=>`<div style="width:2732px;height:2732px;background:${bg};display:flex;align-items:center;justify-content:center">${svg.replace('<svg ','<svg width="820" height="820" ')}</div>`;
await shot(2732,splash('#0b0b0a'),'assets/splash-dark.png');
await shot(2732,splash('#f2f0ea'),'assets/splash.png');
const set=root+'ios/App/App/Assets.xcassets/Splash.imageset/';
for(const f of fs.readdirSync(set).filter(f=>f.endsWith('.png')))
  fs.copyFileSync(root+(f.includes('dark')?'assets/splash-dark.png':'assets/splash.png'),set+f);
await b.close();
