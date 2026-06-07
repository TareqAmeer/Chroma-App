"""
Zone-by-zone validation — chromasmith-22 vs Dehancer reference.
Processes each zone as a crop to stay within memory limits.

All coords are at 1x (2400px ref); px() scales to 2x (4800px).
Sigma values from HTML are at 2400px ref → multiply by 2 for 4800px images.
"""
import sys, os, gc
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_PATH = os.path.join(ROOT, 'IMG_5774_2x.PNG')
HAL_PATH  = os.path.join(ROOT, 'dehancer halation x2.png')
BLM_PATH  = os.path.join(ROOT, 'dehancer bloom x2.png')

# Committed chromasmith-22 params; sigmas scaled to 4800px image
HAL = dict(thr=0.10, knee=0.141, sigma_r=6.14*2, sigma_g=2.62*2, sigma_b=1.0*2,
           gain_r=1.50, gain_g=0.05, gain_b=0.0)
BLM = dict(thr=0.10, knee=0.15, power=1.0, sigma=12.42*2, gain=0.111)
LUM = np.array([0.2126, 0.7152, 0.0722])

def px(v): return int(v * 2)

def s2l(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c/12.92, ((c+0.055)/1.055)**2.4)
def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4)-0.055)
def smoothstep(a, b, x):
    t = np.clip((x-a)/(b-a+1e-9),0,1); return t*t*(3-2*t)
def screen(a, b): return 1-(1-a)*(1-b)

def gauss_blur(arr2d, sigma):
    if sigma < 0.3: return arr2d.copy()
    img8 = Image.fromarray((np.clip(arr2d,0,1)*255).astype(np.uint8))
    blurred = img8.filter(ImageFilter.GaussianBlur(radius=sigma))
    return np.array(blurred, dtype=np.float32)/255.0

def load_crop(path, y0, y1, x0=0, x1=4800):
    """Load a horizontal crop of an image to save memory."""
    img = Image.open(path)
    crop = img.crop((x0, y0, x1, y1)).convert('RGB')
    return np.array(crop, dtype=np.float32)/255.0

def apply_halation_crop(crop, p=HAL):
    lin = s2l(crop)
    lum = lin @ LUM
    bright = smoothstep(p['thr'], p['thr']+p['knee'], lum)
    emit = bright * np.clip(lin[...,0] - 0.5*lin[...,2], 0, 1)  # R - 0.5*B: cool/blue suppressed
    glow = np.stack([
        gauss_blur(emit, p['sigma_r']) * p['gain_r'],
        gauss_blur(emit, p['sigma_g']) * p['gain_g'],
        gauss_blur(emit, p['sigma_b']) * p['gain_b'],
    ], axis=-1)
    return l2s(np.clip(screen(lin, glow), 0, 1))

def apply_bloom_crop(crop, p=BLM):
    lin = s2l(crop)
    lum = lin @ LUM
    bright = smoothstep(p['thr'], p['thr']+p['knee'], lum)
    gate = bright * np.clip(lum, 0, 1)**p['power']
    e_rgb = gate[...,None]*lin
    glow = np.stack([gauss_blur(e_rgb[...,i], p['sigma']) for i in range(3)], axis=-1)*p['gain']
    return l2s(np.clip(screen(lin, glow), 0, 1))

def report(name, ref_r, ref_g, v22_r, v22_g):
    dr, dg = v22_r-ref_r, v22_g-ref_g
    flag = " ⚠" if abs(dr)>0.06 or abs(dg)>0.06 else ""
    print(f"  {name:<14} Ref R={ref_r:.3f} V22 R={v22_r:.3f} ΔR={dr:+.3f}  Ref G={ref_g:.3f} V22 G={v22_g:.3f} ΔG={dg:+.3f}{flag}")
    return abs(dr)+abs(dg)

# ────────────────────────────────────────────────────────────────────────────
def zone1():
    """Color dots at y≈110 (1x). Crop: y=0..250 at 2x = y=0..500."""
    print("\n═══ ZONE 1: Color dots ═══")
    Y0, Y1 = 0, 500
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(HAL_PATH,  Y0, Y1)
    v22  = apply_halation_crop(base)
    DOT_CX = [150,380,610,840,1070,1300,1530,1760,1990]
    NAMES  = ['white','warm','cool','red','green','blue','yellow','purple','pink']
    errors = []
    for name, cx in zip(NAMES, DOT_CX):
        cy = px(110)-Y0; top = cy - px(2) - 8
        sx = px(cx)
        if top < 0: top = cy + px(2) + 8
        e = report(name, float(ref[top,sx,0]), float(ref[top,sx,1]),
                   float(v22[top,sx,0]), float(v22[top,sx,1]))
        errors.append(e)
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 1 mean|error|={m:.3f}"); return m

def zone2():
    """Bars right half, y=420..1040 (1x). Crop y=780..2100 at 2x."""
    print("\n═══ ZONE 2: Bars ═══")
    Y0, Y1 = px(400), px(1040)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(HAL_PATH,  Y0, Y1)
    v22  = apply_halation_crop(base)
    NAMES  = ['white100','gray80','gray60','gray40','gray20','warm','cool']
    BAR_Y0 = [420,510,600,690,780,880,960]
    sx = px(1800); errors = []
    for name, y0 in zip(NAMES, BAR_Y0):
        sy = px(y0)-20-Y0
        e = report(name, float(ref[sy,sx,0]), float(ref[sy,sx,1]),
                   float(v22[sy,sx,0]), float(v22[sy,sx,1]))
        errors.append(e)
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 2 mean|error|={m:.3f}"); return m

def zone3():
    """Gradients y=1100..1380 (1x). Crop y=2100..2820 at 2x."""
    print("\n═══ ZONE 3: Gradients ═══")
    Y0, Y1 = px(1080), px(1400)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref_h = load_crop(HAL_PATH, Y0, Y1)
    ref_b = load_crop(BLM_PATH, Y0, Y1)
    v22_h = apply_halation_crop(base)
    v22_b = apply_bloom_crop(base)
    errors = []
    print("  Neutral gradient halation (above y=1100):")
    for x in [200,500,1000,1500,2000,2300]:
        sy = px(1100)-15-Y0; sx = px(x)
        e = report(f"x={x}", float(ref_h[sy,sx,0]), float(ref_h[sy,sx,1]),
                   float(v22_h[sy,sx,0]), float(v22_h[sy,sx,1]))
        errors.append(e)
    print("  Warm gradient halation (above y=1230):")
    for x in [500,1000,1500,2000,2300]:
        sy = px(1230)-15-Y0; sx = px(x)
        e = report(f"x={x}", float(ref_h[sy,sx,0]), float(ref_h[sy,sx,1]),
                   float(v22_h[sy,sx,0]), float(v22_h[sy,sx,1]))
        errors.append(e)
    print("  Bloom on neutral gradient (bright end):")
    for x in [1500,2000,2300]:
        sy = px(1150)-Y0; sx = px(x)
        rr=float(ref_b[sy,sx,0]); rv=float(v22_b[sy,sx,0])
        dr=rv-rr; flag=" ⚠" if abs(dr)>0.05 else ""
        print(f"  x={x:<5}  Ref R={rr:.3f} V22 R={rv:.3f} ΔR={dr:+.3f}{flag}")
        errors.append(abs(dr))
    del base,ref_h,ref_b,v22_h,v22_b; gc.collect()
    m=np.mean(errors); print(f"Zone 3 mean|error|={m:.3f}"); return m

def zone4():
    """Circle rings centered y=1530 (1x). Crop y=2460..3860 at 2x (ring radius 200→400px)."""
    print("\n═══ ZONE 4: Circle rings ═══")
    Y0, Y1 = px(1280), px(1700)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(HAL_PATH,  Y0, Y1)
    v22  = apply_halation_crop(base)
    RINGS=[(180,1530,195,'wh_sm'),(640,1530,195,'wh_sm2'),(1100,1530,200,'wh_lg'),(1560,1530,200,'wh_lg2')]
    errors=[]
    for cx,cy,r,name in RINGS:
        for d in [10,20,30]:
            sx=px(cx); sy=px(cy)-px(r)-d*2-Y0
            if sy<0 or sy>=Y1-Y0: continue
            e = report(f"{name} d={d}", float(ref[sy,sx,0]), float(ref[sy,sx,1]),
                       float(v22[sy,sx,0]), float(v22[sy,sx,1]))
            errors.append(e)
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 4 mean|error|={m:.3f}"); return m

def zone5():
    """Color matrix y=2010..2350 (1x). Crop y=3970..4760 at 2x."""
    print("\n═══ ZONE 5: Color matrix ═══")
    Y0, Y1 = px(1990), px(2360)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(HAL_PATH,  Y0, Y1)
    v22  = apply_halation_crop(base)
    COLS=['red','orange','yellow','green','cyan','blue','purple','white']
    ROWS=[2010,2078,2146,2214,2282]; BRTS=['100%','75%','50%','39%','10%']
    errors=[]
    for ry,bname in zip(ROWS,BRTS):
        for ci,cname in enumerate(COLS):
            cx=ci*300+150; sy=px(ry)-15-Y0; sx=px(cx)
            if sy<0: sy=0
            e = report(f"{cname}/{bname}", float(ref[sy,sx,0]), float(ref[sy,sx,1]),
                       float(v22[sy,sx,0]), float(v22[sy,sx,1]))
            errors.append(e)
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 5 mean|error|={m:.3f}"); return m

def zone6():
    """Staircase y=2420..2501 (1x). Crop y=4790..5050 at 2x."""
    print("\n═══ ZONE 6: Staircase bloom ═══")
    Y0, Y1 = px(2400), px(2520)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(BLM_PATH,  Y0, Y1)
    v22  = apply_bloom_crop(base)
    errors=[]
    print(f"  {'Step':>4} {'Brt%':>5} {'Ref R':>7} {'V22 R':>7} {'ΔR':>7}")
    for k in range(1,16):
        cx=150+(k-1)*150+75; sy=px(2420)-10-Y0; sx=px(cx)
        lp=round(k*100/15)
        rr=float(ref[sy,sx,0]); rv=float(v22[sy,sx,0])
        dr=rv-rr; flag=" ⚠" if abs(dr)>0.04 else ""
        print(f"  {k:>4} {lp:>4}% {rr:>7.3f} {rv:>7.3f} {dr:>+7.3f}{flag}")
        errors.append(abs(dr))
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 6 mean|error|={m:.3f}"); return m

def zone7():
    """Thin lines+blocks y=2620..2820 (1x). Crop y=5190..5700 at 2x."""
    print("\n═══ ZONE 7: Thin lines + blocks ═══")
    Y0, Y1 = px(2590), px(2840)
    base = load_crop(BASE_PATH, Y0, Y1)
    ref  = load_crop(HAL_PATH,  Y0, Y1)
    v22  = apply_halation_crop(base)
    SPECS=[(2620,2626,2633,'white'),(2680,2688,2693,'warm'),(2740,2746,2753,'cool'),(2800,2806,2813,'red')]
    sx=2400; errors=[]
    for y_line,yb0,yb1,name in SPECS:
        print(f"  {name} (above thin line at y={y_line}):")
        for d in [5,10,20,30]:
            sy=px(y_line)-d-Y0
            if sy<0: continue
            e = report(f"  d={d}", float(ref[sy,sx,0]), float(ref[sy,sx,1]),
                       float(v22[sy,sx,0]), float(v22[sy,sx,1]))
            errors.append(e)
    del base,ref,v22; gc.collect()
    m=np.mean(errors); print(f"Zone 7 mean|error|={m:.3f}"); return m

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    zones = set(sys.argv[1:]) or {'1','2','3','4','5','6','7'}
    FNS = {'1':zone1,'2':zone2,'3':zone3,'4':zone4,'5':zone5,'6':zone6,'7':zone7}
    results={}
    for z in sorted(zones):
        if z in FNS:
            results[z]=FNS[z]()
    print("\n═══ SUMMARY ═══")
    for z,err in sorted(results.items()):
        grade="✓ PASS" if err<0.08 else ("~ MARGINAL" if err<0.15 else "✗ FAIL")
        print(f"  Zone {z}: mean|error|={err:.3f}  {grade}")
