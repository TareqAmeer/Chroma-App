"""Deterministic CHR-249 Lightroom inputs. No downloaded/generated photographic assets."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
import tifffile
from PIL import Image, ImageCms, ImageDraw
p=argparse.ArgumentParser();p.add_argument('--output',default='test/output/chr249-lightroom-kit');a=p.parse_args()
out=Path(a.output);(out/'inputs').mkdir(parents=True,exist_ok=True);(out/'exports').mkdir(exist_ok=True)
w,h=2048,1536;y,x=np.mgrid[:h,:w];u=x/w;v=y/h;rng=np.random.default_rng(249)
profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
images={}
# Slanted edges and periodic details at multiple spatial frequencies; safe headroom.
edge=.2+.6*(x > 650+.18*y); edge=np.where(x>1100,.5+.22*np.sin(2*np.pi*x/(4+28*v)),edge)
images['01_edges_frequency']=np.repeat(edge[...,None],3,axis=2)
# Noise is created in encoded sRGB deliberately, with documented independent components.
base=.12+.72*u; clean=np.repeat(base[...,None],3,axis=2)
luma=rng.normal(0,1,(h,w,1))*(.008+.04*v[...,None]);chroma=rng.normal(0,.022,(h,w,3));chroma-=chroma.mean(axis=2,keepdims=True)
images['02_luma_chroma_noise']=clean+luma+chroma
# Fine fibres and multi-scale low-amplitude texture for separation of Texture and Clarity.
fibres=.025*np.sin(.72*x+.007*y*y)+.018*np.sin(1.63*x+.09*y)
coarse=.055*np.sin(x/43)*np.cos(y/31);medium=.035*np.sin(x/9+y/17)
texture=.45+fibres+coarse+medium
images['03_fibres_texture']=np.stack([texture*1.04,texture,texture*.94],axis=2)
# Controlled atmospheric veil: source, transmission and airlight are explicitly synthetic.
scene=np.stack([.18+.25*u,.25+.2*v,.13+.15*u],axis=2)
scene+=((np.sin(x/28)*np.cos(y/37))*.07)[...,None]
scene+=((x>350+.3*y)&(x<780+.3*y))[...,None]*.19
trans=.22+.7*(1-v);images['04_atmospheric_veil']=scene*trans[...,None]+np.array([.80,.84,.90])*(1-trans[...,None])
# Saturated/neutral boundaries, smooth ramps and fine patterns for halos and colour shifts.
colors=np.array([[.65,.12,.12],[.12,.65,.12],[.12,.12,.65],[.5,.5,.5],[.08,.08,.08],[.9,.9,.9]])
patch=colors[np.minimum((u*6).astype(int),5)]
patch=np.where((y>h//2)[...,None],(.06+.88*u)[...,None],patch)
patch+=((y>h//2)*.015*np.sin(x/3))[...,None];images['05_colour_ramps']=patch
records=[];thumbs=[]
for name,data in images.items():
 data=np.clip(data,0,1);pixels=np.rint(data*65535).astype(np.uint16);file=out/'inputs'/f'{name}.tif'
 tifffile.imwrite(file,pixels,photometric='rgb',metadata=None,compression=None,extratags=[(34675,'B',len(profile),profile,False)])
 check=tifffile.imread(file);assert np.array_equal(pixels,check)
 records.append({'file':file.name,'width':w,'height':h,'dtype':'uint16','sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
 thumb=Image.fromarray((pixels>>8).astype(np.uint8)).resize((512,384));thumbs.append((name,thumb))
sheet=Image.new('RGB',(1024,3*420),(28,28,28));draw=ImageDraw.Draw(sheet)
for i,(name,thumb) in enumerate(thumbs):xx=(i%2)*512;yy=(i//2)*420;sheet.paste(thumb,(xx,yy+24));draw.text((xx+8,yy+5),name,fill='white')
sheet.save(out/'contact-sheet.png')
(out/'manifest.json').write_text(json.dumps({'seed':249,'space':'encoded sRGB','precision':'16-bit RGB','images':records},indent=2))
print(out.resolve())
# Include the versioned protocol and run matrix in every regenerated kit.
repo=Path(__file__).resolve().parents[2]
import shutil
shutil.copyfile(repo/'docs/validation/chr249-lightroom-reference-kit.md',out/'READ-ME.md')
shutil.copyfile(repo/'docs/validation/chr249-lightroom-runs.csv',out/'runs.csv')
(out/'versions.txt').write_text('Lightroom Classic version: \nCamera Raw version: \nProcess Version: \nProfile: \nOperating system/GPU: \nSkipped runs and reasons: \n')
