import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const begin = '// CHR-238 playback helper begin';
const end = '// CHR-238 playback helper end';
const startAt = source.indexOf(begin), endAt = source.indexOf(end, startAt);
assert.ok(startAt >= 0 && endAt > startAt, 'the testable slideshow playback helper is present');
const helperSource = source.slice(startAt + begin.length, endAt);
const nextIndex = new Function(`${helperSource}; return slideshowAutoNextIndex;`)();

assert.equal(nextIndex(0, 3, false), 1, 'advance within a finite sequence');
assert.equal(nextIndex(1, 3, false), 2, 'advance to the final slide');
assert.equal(nextIndex(2, 3, false), -1, 'stop after the last slide when repeat is off');
assert.equal(nextIndex(2, 3, true), 0, 'repeat returns from the final slide to the beginning');
assert.equal(nextIndex(0, 1, false), -1, 'a single-slide show stops after one display');
assert.equal(nextIndex(0, 0, true), -1, 'empty presentations have no next slide');
assert.equal(nextIndex(-1, 2, true), -1, 'invalid indexes do not enter a loop');

assert.match(source, /aria-label', 'Slideshow playback settings'/);
assert.match(source, /selectSetting\('Slide length'/);
assert.match(source, /selectSetting\('Crossfade'/);
assert.match(source, /repeatButton\.setAttribute\('aria-pressed'/);
assert.match(source, /timer = setTimeout\(\(\) => show\(next\), slideSeconds \* 1000\)/);
assert.match(source, /opacity \$\{fadeSeconds\}s/);
console.log('PASS slideshow finite/repeat sequence, configurable duration/crossfade controls and accessible repeat state.');
