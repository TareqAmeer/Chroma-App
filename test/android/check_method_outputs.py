"""Decode saved experiments and compare unchanged outputs independently of the app."""
import hashlib,json,pathlib
import numpy as np
from PIL import Image
out=pathlib.Path(__file__).parent/'out'
records=[]
for p in sorted(out.glob('methods-*.jpg'))+sorted(out.glob('complete-*.jpg'))+sorted(out.glob('snapseed-*.jpeg'))+sorted(out.glob('production-*.jpg')):
    with Image.open(p) as im:
        im.load()
        assert im.size==((2400,1600) if 'small-' in p.name else (6000,4000)),p.name
        records.append({'file':p.name,'dimensions':list(im.size),'bytes':p.stat().st_size,
                        'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
                        'quantization':im.quantization,'sampling':[list(x) for x in getattr(im,'layer',[])]})
def pixels(p):
    with Image.open(out/p) as im:return np.asarray(im.convert('RGB'),dtype=np.int16)
comparisons=[]
for prefix,ref in [('methods-','methods-current-1.jpg'),('complete-','complete-current-photos-1.jpg'),('production-','production-previous-photos-1.jpg')]:
    if not (out/ref).exists():continue
    a=pixels(ref)
    for r in records:
        if not r['file'].startswith(prefix):continue
        b=pixels(r['file'])
        if a.shape!=b.shape:continue
        actual_ref=ref
        if prefix=='methods-' and '-edited-' in r['file'] and (out/'methods-current-edited-1.jpg').exists():
            actual_ref='methods-current-edited-1.jpg';a_edited=pixels(actual_ref);d=np.abs(a_edited-b)
        else:d=np.abs(a-b)
        if prefix in ['production-','complete-']:assert not d.any(),'Export pixels changed: '+r['file']
        comparisons.append({'reference':actual_ref,'file':r['file'],'mean':float(d.mean()),'max':int(d.max())})
for i in range(4):
    p=out/f'methods-small-before-{i}.jpg';q=out/f'methods-small-after-{i}.jpg'
    if p.exists() and q.exists():
        d=np.abs(pixels(p.name)-pixels(q.name));comparisons.append({'reference':q.name,'file':p.name,'mean':float(d.mean()),'max':int(d.max())})
for p in out.glob('methods-original-*.jpg'):
    assert p.read_bytes()==(out/'bench-6000x4000.jpg').read_bytes(),'Original shortcut changed bytes'
result={'decoded':records,'comparisons':comparisons}
(out/'method-output-checks.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'decoded':len(records),'compared':len(comparisons),'dimension_checks':'PASS'}))
