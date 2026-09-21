// CHR-8: marquee background-click deselect on #lib-main must ignore the batch bar (now a child of #lib-main).
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../desktop/library-ui.js',import.meta.url),'utf8');
const i=s.indexOf("main.addEventListener('pointerdown'");
const f=s.slice(i,i+700);
if(!/closest\('#lib-batchbar'\)/.test(f)){console.error('FAIL: marquee pointerdown does not exempt #lib-batchbar');process.exit(1)}
console.log('PASS');
