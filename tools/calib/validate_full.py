"""Fast FULL-RES validation of hand-set params against measured points.
Run: python3 calib/validate_full.py
Lets us dial gain/sigma/power exactly at native resolution (the dot is only
~4px, so it must be evaluated full-res, not at the 1/3 optimization scale).
"""
import numpy as np
from PIL import Image
import os
from effect import Params, apply_halation, apply_bloom, apply_both

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
base = np.asarray(Image.open(os.path.join(ROOT,'IMG_5774.PNG')).convert('RGB'),float)/255
hal  = np.asarray(Image.open(os.path.join(ROOT,'dehancer halation 70.JPG')).convert('RGB'),float)/255
blm  = np.asarray(Image.open(os.path.join(ROOT,'dehancer bloom 40.JPG')).convert('RGB'),float)/255
both = np.asarray(Image.open(os.path.join(ROOT,'dehancer h 70 b 40.JPG')).convert('RGB'),float)/255

def P(a,y,x): return a[y-1:y+2,x-1:x+2].mean(axis=(0,1))

# (name, y, x) measured glow points  (x=1800 is inside the 100% bar)
# zone7 WARM line at y=2680 (R=1,G=0.627,B=0.314); measuring dy+1 and dy-1
PTS = [('W100 dot +8',110,158),('zone2 bar -2',418,1800),
       ('zone7 warm +1',2681,1200),('zone7 warm -1',2679,1200)]

def check(render, tgt, label):
    print(f'  {label}: R render|tgt   G render|tgt')
    for nm,y,x in PTS:
        r=P(render,y,x); t=P(tgt,y,x)
        print(f'    {nm:15s} {r[0]:.3f}|{t[0]:.3f}   {r[1]:.2f}|{t[1]:.2f}')

HAL = Params(thr=0.330, knee=0.141, power=1.0, bluesupp=0.806,
             film_r=1.0, film_g=0.25, film_b=0.05, sigma=5.17, gain=4.98)
BLM = Params(thr=0.10, knee=0.15, power=5.0, bluesupp=0.0,
             film_r=1.0, film_g=1.0, film_b=1.0, sigma=12.0, gain=0.19)

print('HALATION params', HAL.dict())
check(apply_halation(base, HAL), hal, 'halation')
print('BLOOM params', BLM.dict())
check(apply_bloom(base, BLM), blm, 'bloom')
print('COMBINED')
check(apply_both(base, BLM, HAL), both, 'both')
