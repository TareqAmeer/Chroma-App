import numpy as np, subprocess, os
from PIL import Image, ImageDraw
import sam_eval as E
rows=[l.strip().split("|") for l in open("lib/ok.txt")]
tiles=[]; stats=[]
for n,term,x0,y0,x1,y1 in rows:
    x0,y0,x1,y1=map(float,(x0,y0,x1,y1))
    rgb=np.asarray(Image.open(f"lib/{n}.png").convert("RGB")); h,w=rgb.shape[:2]
    cx,cy=(x0+x1)/2,(y0+y1)/2; fh=y1-y0
    pts=[(cx,cy)]
    Ed=E.edge_encode(rgb); S2=E.sam2_encode(rgb)
    sc,ms,_=E.edge_decode(Ed,pts,[1],False); L=E.up(ms[int(np.argmax(sc))],Ed,False)
    a=(255/(1+np.exp(-4*np.clip(L,-30,30)))).astype(np.uint8)
    open("lib/raw_mask.u8","wb").write(a.tobytes()); open("lib/rgba.u8","wb").write(np.dstack([rgb,np.full((h,w),255,np.uint8)]).tobytes())
    subprocess.run(["node","matte_cli.mjs","lib",str(w),str(h)],check=True)
    cur=np.frombuffer(open("lib/matted.u8","rb").read(),np.uint8).reshape(h,w)
    iou,ms,_=E.sam2_decode(S2,pts,[1],True); new=(E.up(ms[int(np.argmax(iou))],S2,True)>0)
    def ov(m,col):
        o=rgb.astype(float).copy(); wgt=(m.astype(float)/255 if m.dtype==np.uint8 else m.astype(float))[...,None]*0.6
        o=o*(1-wgt)+np.array(col)*wgt; return Image.fromarray(o.astype(np.uint8))
    base=Image.fromarray(rgb); d=ImageDraw.Draw(base)
    for px,py in pts: d.ellipse([px*w-6,py*h-6,px*w+6,py*h+6],fill=(255,255,0),outline=(0,0,0))
    d.rectangle([x0*w,y0*h,x1*w,y1*h],outline=(255,255,0),width=2)
    trip=[base,ov(cur,(255,0,0)),ov(new,(0,140,255))]
    trip=[t.resize((int(t.width*260/t.height),260)) for t in trip]
    T=Image.new("RGB",(sum(t.width for t in trip)+10,280),(30,30,30)); xx=0
    for t in trip: T.paste(t,(xx,0)); xx+=t.width+5
    ImageDraw.Draw(T).text((4,264),f"{n} {term}",fill=(255,255,255))
    tiles.append(T)
    stats.append(f"{n} {term}: current area={(cur>10).mean():.3f} new area={new.mean():.3f}")
for k in range(0,len(tiles),6):
    grp=tiles[k:k+6]; Wd=max(t.width for t in grp); C=Image.new("RGB",(Wd*2,280*3),(0,0,0))
    for j,t in enumerate(grp): C.paste(t,((j%2)*Wd,(j//2)*280))
    C.save(f"lib/sheet{k//6}.png")
print("\n".join(stats))
