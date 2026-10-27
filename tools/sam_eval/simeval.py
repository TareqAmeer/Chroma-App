# Simulated user scribbles: a zig-zag through the subject, centre line jittered by a fraction of the brush ring
# radius (people aim the RING at the subject, so the centre wanders by up to ~radius). Compares pipelines.
import numpy as np, json, subprocess, os
from PIL import Image
import sam_eval as E
rng=np.random.default_rng(1)
names=["dog","IMG_7362_edited","IMG_7396_edited","IMG_7430_edited","__TM6590","__TM6630"]
def scribble(g,brush):
    h,w=g.shape; ys,xs=np.where(g); n=len(xs)
    # zigzag: 6 waypoints sampled inside the subject, sorted by x then path
    wp=[(xs[i]/w,ys[i]/h) for i in rng.choice(n,6,replace=False)]
    wp.sort(key=lambda p:p[1])
    rad=(brush/100)*0.25*max(w,h)/max(w,h)  # ring radius as fraction of longest side (mskPaintAt formula)
    pts=[]
    for a,b in zip(wp,wp[1:]):
        for t in np.linspace(0,1,15):
            x=a[0]+(b[0]-a[0])*t; y=a[1]+(b[1]-a[1])*t
            j=rng.normal(0,0.6*rad,2)*np.array([max(w,h)/w,max(w,h)/h])
            pts.append((float(np.clip(x+j[0],0,1)),float(np.clip(y+j[1],0,1))))
    return pts
def met(m,g):
    gs=g.sum(); return ((m&g).sum()/(m|g).sum(), (m&~g).sum()/gs, (g&~m).sum()/gs)
rows={}
for n in names:
    rgb=np.asarray(Image.open(f"set/{n}.png").convert("RGB")); g=np.asarray(Image.open(f"set/{n}_gt.png").convert("L"))>127
    Ed=E.edge_encode(rgb); S2=E.sam2_encode(rgb)
    for brush in (25,8):
        for trial in range(3):
            pts=scribble(g,brush); h,w=g.shape
            off=np.mean([not g[min(h-1,int(y*h)),min(w-1,int(x*w))] for x,y in pts])
            six=E.subsample(pts,6); a=np.array(pts); box=[*a.min(0),*a.max(0)]
            res={}
            sc,ms,_=E.edge_decode(Ed,six,[1]*6,False); res["edge_now"]=E.up(ms[int(np.argmax(sc))],Ed,False)>0
            iou,ms,_=E.sam2_decode(S2,six,[1]*6,True); res["sam2_6pts"]=E.up(ms[int(np.argmax(iou))],S2,True)>0
            iou,ms,_=E.sam2_decode(S2,[(box[0],box[1]),(box[2],box[3])],[2,3],False); res["sam2_scribblebox"]=E.up(ms[int(np.argmax(iou))],S2,True)>0
            three=E.fps(pts,3)
            iou,ms,_=E.sam2_decode(S2,[(box[0],box[1]),(box[2],box[3])]+three,[2,3,1,1,1],False); res["sam2_box+3"]=E.up(ms[int(np.argmax(iou))],S2,True)>0
            sc,ms,_=E.edge_decode(Ed,[(box[0],box[1]),(box[2],box[3])],[2,3],False); res["edge_scribblebox"]=E.up(ms[0],Ed,False)>0
            for k,m in res.items():
                rows.setdefault((brush,k),[]).append((n,off)+met(m,g))
out=[]
for (brush,k),v in sorted(rows.items()):
    a=np.array([r[2:] for r in v]); offm=np.mean([r[1] for r in v])
    worst=min(v,key=lambda r:r[2])
    out.append(f"brush {brush:2d} {k:18s} meanIoU={a[:,0].mean():.3f} meanSpill={a[:,1].mean():.3f} meanMiss={a[:,2].mean():.3f} worstIoU={worst[2]:.3f}({worst[0]}) strayPts={offm:.2f}")
print("\n".join(out)); open("simeval.txt","w").write("\n".join(out))
