import json,hashlib,statistics
from pathlib import Path
from PIL import Image
import numpy as np
p=Path(__file__).resolve().parent/'out'; checks=[]
for f in p.glob('portable-methods-*.json'):
 rows=json.loads(f.read_text());invalid='reduced-invalid' in f.name;base=next((r for r in rows if r['method']=='old'),rows[0]);ref=(p/base['savedFile']).read_bytes();ref_rgb=np.array(Image.open(p/base['savedFile']).convert('RGB'),dtype=np.int16)
 for r in rows:
  q=p/r['savedFile'];b=q.read_bytes();im=Image.open(q);im.load();assert im.size==((1500,1000) if invalid else (6000,4000)); exact=b==ref
  if r['method']!='direct':assert exact,(f,r['method'],r['run'])
  rgb=np.array(im.convert('RGB'),dtype=np.int16);diff=np.abs(rgb-ref_rgb)
  checks.append({'batch':f.name,'valid24MP':not invalid,'method':r['method'],'run':r['run'],'size':im.size,'sha256':hashlib.sha256(b).hexdigest(),'exact':exact,'maxRGB':int(diff.max()),'meanRGB':float(diff.mean())})
print(len(checks),'decoded;',sum(r['exact'] for r in checks),'byte exact');print([r for r in checks if not r['exact']]);(p/'portable-output-checks.json').write_text(json.dumps(checks,indent=2))
