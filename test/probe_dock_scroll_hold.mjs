// CHR-125: scrollLibraryToPath must not null _virtRange unconditionally (forces re-centre on every open).
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../desktop/library-ui.js',import.meta.url),'utf8');
const f=s.slice(s.indexOf('function scrollLibraryToPath'),s.indexOf('// Thumbnail loader with a small'));
if(/if \(fresh\) \{ state\._virtMetrics = fresh; state\._virtRange = null; \}/.test(f)){console.error('FAIL: unconditional _virtRange reset');process.exit(1)}
if(!/o\.cols !== fresh\.cols/.test(f)){console.error('FAIL: no geometry-change guard');process.exit(1)}
console.log('PASS');
