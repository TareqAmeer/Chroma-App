// CHR-261: guard the wavelet detail recipe/UI/shader wiring and neutral fast-path contract.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const recipe = JSON.parse(await readFile(new URL('./recipes/wavelet_detail_levels.json', import.meta.url), 'utf8'));
const ids = ['adj-wavelet-1', 'adj-wavelet-2', 'adj-wavelet-3', 'adj-wavelet-res'];
const snapFields = html.match(/const _FX_SNAP_SLIDERS=\[([\s\S]*?)\];/)?.[1] || '';
const sessionFields = html.match(/const _SESS_SLIDERS=\[([\s\S]*?)\];/)?.[1] || '';
const adjustFields = html.match(/const ADJ_FIELDS=\[([\s\S]*?)\];/)?.[1] || '';
const resetFields = html.match(/const ADJ_RESET_FIELDS=\[([\s\S]*?)\];/)?.[1] || '';
const pasteAdjust = html.match(/\{key:'adjust',label:'Tone',sliders:\[([^\]]*)\]/)?.[1] || '';

for (const id of ids) {
  assert.match(html, new RegExp(`id="sl-${id}"`), `${id} control exists`);
  assert.ok(snapFields.includes(`'${id}'`), `${id} is undo/recipe tracked`);
  assert.ok(sessionFields.includes(`'sl-${id}'`), `${id} is session tracked`);
  assert.ok(adjustFields.includes(`'${id.slice(4)}'`), `${id} is included in per-photo adjustment state`);
  assert.ok(resetFields.includes(`'${id}'`), `${id} resets to neutral`);
  assert.ok(pasteAdjust.includes(`'${id}'`), `${id} is included in selective copy`);
  assert.ok(Object.hasOwn(recipe.sliders, id), `${id} is exercised by the export recipe`);
}

const shaderAt = html.indexOf('vec3 waveletLow(vec2 p,float radius)');
const operatorAt = html.indexOf('CHR-261: compact, zero-default multiscale detail contrast', shaderAt);
const operatorEnd = html.indexOf('// Sharpening / Clarity:', operatorAt);
assert.ok(shaderAt >= 0 && operatorAt > shaderAt && operatorEnd > operatorAt, 'shared FX shader contains wavelet operator');
const operator = html.slice(operatorAt, operatorEnd);
assert.ok(operator.includes('if(adjOn>.5&&(adjWavelet1!=0.||adjWavelet2!=0.||adjWavelet3!=0.||adjWaveletResidual!=0.))'),
  'all-neutral adjustments skip wavelet sampling');
for (const [name, low, high] of [['adjWavelet1', 'c.rgb', 'low1'],
  ['adjWavelet2', 'low1', 'low2'], ['adjWavelet3', 'low2', 'low4']]) {
  assert.ok(operator.includes(`${low}-${high}`), `${name} covers its adjacent detail scales`);
  assert.ok(operator.includes(name), `${name} is consumed by the shared shader`);
}
for (const [low, radius] of [['low1', '1.0'], ['low2', '2.0'], ['low4', '4.0']]) {
  assert.ok(operator.includes(`${low}=waveletLow(uv,${radius})`), `${low} samples its source-pixel radius`);
}
assert.ok(operator.includes('(low4-vec3(0.5))*adjWaveletResidual'),
  'residual contrast is centered on the renderer working-value midpoint');
assert.match(html, /working-value midpoint \(0\.5\)/, 'UI describes a domain-neutral midpoint');
assert.match(html, /if\(this\.usingSceneLinear\)[\s\S]*gl\.texImage2D\(gl\.TEXTURE_2D,0,gl\.RGBA16F[\s\S]*gl\.texImage2D\(gl\.TEXTURE_2D,0,gl\.RGBA,gl\.RGBA,gl\.UNSIGNED_BYTE,img\)/,
  'input upload has scene-linear float and ordinary byte paths');

function adjustBand(value, coefficient, strength) {
  return Math.max(0, Math.min(1, value + coefficient * strength / 100));
}
assert.equal(adjustBand(0.6, 0.2, 0), 0.6, 'neutral band is identity');
assert.ok(adjustBand(0.6, 0.2, 50) > 0.6, 'positive band strength increases positive detail');
assert.ok(adjustBand(0.6, 0.2, -50) < 0.6, 'negative band strength reduces positive detail');
assert.ok(adjustBand(0.4, 0.4 - 0.5, 50) < 0.4, 'positive residual contrast darkens below-mid-grey residuals');

const cropStart = html.indexOf('function renderFullResCrop(P,iw,ih,cw,ch){');
const previewStart = html.indexOf('function renderPreview(){');
const exportStart = html.indexOf('async function processToCanvas(P,src,iw,ih,onTile,renderer=FX){');
assert.ok(html.slice(cropStart, previewStart).includes('FX.render(P,'), '1:1 crop/loupe uses shared FX renderer');
assert.ok(html.slice(previewStart, exportStart).includes('FX.render(P,'), 'fit preview uses shared FX renderer');
assert.ok(html.slice(exportStart, exportStart + 1200).includes('renderer.render(P,iw,ih'), 'export uses the same FX renderer');
console.log('WAVELET DETAIL LEVELS: PASS');
