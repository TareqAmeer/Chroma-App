#!/usr/bin/env python3
"""Tiny local tool: mark where the photo meets the frame on each border scan.

Serves http://localhost:8765 . Drag the 4 lines (each end separately, so tilted scans
work) onto the photo's edge. Marks go to "local borders/_out/marks.json" and
extract_borders.py uses them instead of guessing.
Run: .calibvenv/bin/python scripts/mark_borders.py
"""
import glob, io, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'local borders')
OUT = os.path.join(ROOT, '_out'); os.makedirs(OUT, exist_ok=True)
MARKS = os.path.join(OUT, 'marks.json')
SKIP = ('Pack-Cover', 'KODAK-GOLD', 'KODAK-PORTRA-400---', 'KODAK-PORTRA-800---', 'rawpixel-id-13960581')
FILES = sorted(os.path.basename(f) for f in glob.glob(os.path.join(ROOT, '*'))
               if f.lower().endswith(('jpg', 'jpeg', 'webp', 'tif', 'tiff')) and not any(s in f for s in SKIP) and ' copy' not in f)
_cache = {}

PAGE = r'''<!doctype html><meta charset=utf-8><title>Mark Borders</title>
<style>
body{margin:0;background:#1b1a19;color:#e8e4dc;font:14px system-ui;display:grid;grid-template-rows:auto 1fr;height:100vh}
header{display:flex;gap:12px;align-items:center;padding:8px 14px;flex-wrap:wrap}
button{font:inherit;background:#2c2a27;color:inherit;border:1px solid #444;border-radius:6px;padding:5px 10px;cursor:pointer}
button.on{background:#a3402e}
#wrap{position:relative;display:flex;justify-content:center;align-items:center;overflow:hidden}
canvas{max-width:100%;max-height:calc(100vh - 60px);cursor:crosshair}
kbd{background:#333;border-radius:3px;padding:0 4px}
</style>
<header><b id=name></b><span id=pos></span>
<button id=prev>&larr; Prev</button><button id=next>Save &amp; next &rarr;</button>
<button id=skip>Skip scan</button><button id=outer>Keep messy outer edge</button>
<span>No frame on side:</span><button class=nf data-s=0>Top</button><button class=nf data-s=1>Right</button><button class=nf data-s=2>Bottom</button><button class=nf data-s=3>Left</button>
<span style="opacity:.7">Drag the red dots onto the photo's edge &middot; <kbd>Enter</kbd> save &amp; next</span></header>
<div id=wrap><canvas id=c></canvas></div>
<script>
let files=[],marks={},i=0,img=new Image(),st=null,drag=null;
const c=document.getElementById('c'),x=c.getContext('2d');
async function boot(){const r=await (await fetch('/api')).json();files=r.files;marks=r.marks;i=Math.max(0,files.findIndex(f=>!marks[f]));if(i<0)i=0;load()}
function def(){return{pts:[[.08,.08],[.92,.08],[.92,.92],[.08,.92]].map(p=>p.slice()),none:[false,false,false,false],skip:false}}
function load(){const f=files[i];st=JSON.parse(JSON.stringify(marks[f]||def()));if(st.outer===undefined)st.outer=/_n\.jpe?g$/i.test(f);
 document.getElementById('name').textContent=f;document.getElementById('pos').textContent=`${i+1} / ${files.length}`;
 img.onload=()=>{c.width=img.width;c.height=img.height;draw()};img.src='/img?f='+encodeURIComponent(f)}
function draw(){x.drawImage(img,0,0);const W=c.width,H=c.height,P=st.pts.map(p=>[p[0]*W,p[1]*H]);
 x.lineWidth=Math.max(1.5,W/700);
 for(let s=0;s<4;s++){const a=P[s],b=P[(s+1)%4];x.strokeStyle=st.none[s]?'rgba(120,120,120,.8)':'#ff3b2f';x.setLineDash(st.none[s]?[8,6]:[]);
  // extend each side line across the whole image
  const dx=b[0]-a[0],dy=b[1]-a[1];x.beginPath();x.moveTo(a[0]-dx*2,a[1]-dy*2);x.lineTo(b[0]+dx*2,b[1]+dy*2);x.stroke()}
 x.setLineDash([]);P.forEach(p=>{x.fillStyle='#ff3b2f';x.beginPath();x.arc(p[0],p[1],W/110,0,7);x.fill();x.strokeStyle='#fff';x.stroke()});
 if(st.skip){x.fillStyle='rgba(0,0,0,.6)';x.fillRect(0,0,W,H);x.fillStyle='#fff';x.font=`${W/20}px system-ui`;x.fillText('SKIPPED',W*.38,H/2)}
 document.querySelectorAll('.nf').forEach(b=>b.classList.toggle('on',st.none[+b.dataset.s]));document.getElementById('skip').classList.toggle('on',st.skip);document.getElementById('outer').classList.toggle('on',!!st.outer)}
function pos(e){const r=c.getBoundingClientRect();return[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]}
c.onpointerdown=e=>{const p=pos(e);let best=-1,bd=.04;st.pts.forEach((q,k)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<bd){bd=d;best=k}});drag=best>=0?best:null;c.setPointerCapture(e.pointerId)};
c.onpointermove=e=>{if(drag==null)return;st.pts[drag]=pos(e).map(v=>Math.min(1,Math.max(0,v)));draw()};
c.onpointerup=()=>drag=null;
async function save(){marks[files[i]]=st;await fetch('/save',{method:'POST',body:JSON.stringify({f:files[i],m:st})})}
document.getElementById('next').onclick=async()=>{await save();if(i<files.length-1){i++;load()}else alert('All done')};
document.getElementById('prev').onclick=()=>{if(i>0){i--;load()}};
document.getElementById('skip').onclick=()=>{st.skip=!st.skip;draw()};
document.getElementById('outer').onclick=()=>{st.outer=!st.outer;draw()};
document.querySelectorAll('.nf').forEach(b=>b.onclick=()=>{st.none[+b.dataset.s]^=true;st.none=st.none.map(Boolean);draw()});
addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('next').click()});
boot();
</script>'''

SAMPLES = r"""<!doctype html><meta charset=utf-8><title>Border Samples</title>
<style>
body{margin:0;background:#1b1a19;color:#e8e4dc;font:14px system-ui;padding:14px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;position:sticky;top:0;background:#1b1a19;padding:6px 0;z-index:2}
button,select,input{font:inherit;background:#2c2a27;color:inherit;border:1px solid #444;border-radius:6px;padding:5px 9px;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{display:grid;gap:6px;align-content:start}
.card canvas{width:100%;height:auto;display:block}
.v.on[data-v=y]{background:#2f7a4a}.v.on[data-v=n]{background:#a3402e}
h2{font-size:15px;margin:22px 0 8px}
small{opacity:.65}
</style>
<div class=bar>
<select id=asp><option value=1.5>3:2</option><option value=0.8 selected>4:5</option><option value=1>1:1</option><option value=1.778>16:9</option><option value=0.5625>9:16</option><option value=2.35>2.35:1</option><option value=0.667>2:3</option></select>
<label>Thickness <input id=th type=range min=1 max=8 step=.1 value=3></label>
<label>Black <input id=tone type=color value=#0a0a0b></label>
<select id=paper><option value="#f4f2ec">Paper: white</option><option value="#ebe3d3">Paper: cream</option><option value="">No paper</option></select>
<label><input id=grain type=checkbox checked> Grain on top</label>
<label>Photo <input id=file type=file accept="image/*"></label>
<button id=shuf>Shuffle all</button><small id=tally></small></div>
<h2>Mixed: pieces from every scan you haven't voted no on</h2>
<div class=grid id=mix></div>
<h2>One card per scan: vote on each source</h2>
<div class=grid id=per></div>
<script>
let R,strips=[],photo=null,votes={},seedBase=1;
const $=id=>document.getElementById(id);
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
async function boot(){const r=await (await fetch('/report')).json();votes=r.votes||{};const rej=new Set(r.rejects||[]);
 const ps=[];for(const f of r.reps)for(const [sd,v] of Object.entries(f.sides||{}))if(v.piece&&!v.bad&&!rej.has(v.piece))ps.push(new Promise(ok=>{const im=new Image();im.onload=()=>ok({scan:f.file,side:+sd,img:im,T:v.T,h:v.h,corner:v.corner});im.onerror=()=>ok(null);im.src='/pieces/'+encodeURIComponent(v.piece)}));
 strips=(await Promise.all(ps)).filter(Boolean);strips.forEach(prof);build()}
function prof(st){const c=document.createElement('canvas');c.width=st.img.width;c.height=st.img.height;const x=c.getContext('2d');x.drawImage(st.img,0,0);
 const p=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,a=new Float32Array(W);
 for(let u=0;u<W;u++){let s=0;for(let y=0;y<H;y++)s+=p[(y*W+u)*4+3];a[u]=s/255}
 const sm=new Float32Array(W);for(let u=0;u<W;u++){let s=0,n=0;for(let k=-6;k<=6;k++){const v=a[u+k];if(v!==undefined){s+=v;n++}}sm[u]=s/n}
 st.prof=sm;st.depth=[...sm].sort((a,b)=>a-b)[W>>1]}
function tinted(st,tone){const c=document.createElement('canvas');c.width=st.img.width;c.height=st.img.height;const x=c.getContext('2d');x.drawImage(st.img,0,0);
 const d=x.getImageData(0,0,c.width,c.height),p=d.data,t=[1,3,5].map(i=>parseInt(tone.substr(i,2),16));
 for(let i=0;i<p.length;i+=4){const v=p[i]/255;p[i]=Math.min(255,t[0]+v*90);p[i+1]=Math.min(255,t[1]+v*90);p[i+2]=Math.min(255,t[2]+v*90)}x.putImageData(d,0,0);return c}
// build one side of length L (px) at thickness t (px) from a strip: real ends (corners) kept,
// middle filled with random real sections joined with short cross-fades. Never stretched.
function sideCanvas(st,L,t,R){const k=t/st.depth,sw=st.img.width,H=Math.round(st.h*k),src=tinted(st,$('tone').value);
 const c=document.createElement('canvas');c.width=L;c.height=H;const x=c.getContext('2d');
 const end=Math.min(sw*k*.25,Math.max(st.corner*k*1.6,t*2.5)),endS=end/k;
 const flip=R()<.5;x.save();if(flip){x.translate(L,0);x.scale(-1,1)}
 const midS0=endS,midS1=sw-endS,midLen=midS1-midS0;const fade=Math.max(12,t*3);
 let pos=end-fade;const segMax=Math.max(midLen*.6,40);
 const tmp=document.createElement('canvas');tmp.height=H;const tx=tmp.getContext('2d');
 let cur=st.prof[Math.round(endS)]||st.depth;
 while(pos<L-end){const segS=Math.min(midLen,Math.max(Math.min(segMax,midLen)*(0.5+R()*.5),3*fade/k));let s0=0,bd=1e9;
  for(let q=0;q<40;q++){const c0=midS0+R()*(midLen-segS),e=Math.abs(st.prof[Math.round(c0+fade/k/2)]-cur);if(e<bd){bd=e;s0=c0}}
  cur=st.prof[Math.round(s0+segS-fade/k/2)]||cur;const w=Math.round(segS*k);
  tmp.width=w;tx.clearRect(0,0,w,H);tx.drawImage(src,s0,0,segS,st.h,0,0,w,H);
  tx.globalCompositeOperation='destination-in';const g=tx.createLinearGradient(0,0,w,0),f=Math.min(.45,fade/w);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(f,'#000');g.addColorStop(1-f,'#000');g.addColorStop(1,'rgba(0,0,0,0)');tx.fillStyle=g;tx.fillRect(0,0,w,H);tx.globalCompositeOperation='source-over';
  x.drawImage(tmp,Math.round(pos),0);pos+=Math.max(w-fade,fade*.5,4)}  // always advance: a segment shorter than the fade used to loop forever
 // real ends (with their corners) on top, feathered on the inner side only
 for(const [s0,dx] of [[0,0],[sw-endS,L-end]]){const w=Math.round(end);tmp.width=w;tx.drawImage(src,s0,0,endS,st.h,0,0,w,H);
  tx.globalCompositeOperation='destination-in';const g=tx.createLinearGradient(0,0,w,0),f=Math.min(.4,fade/w);
  if(dx===0){g.addColorStop(0,'#000');g.addColorStop(1-f,'#000');g.addColorStop(1,'rgba(0,0,0,0)')}else{g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(f,'#000');g.addColorStop(1,'#000')}
  tx.fillStyle=g;tx.fillRect(0,0,w,H);tx.globalCompositeOperation='source-over';x.drawImage(tmp,Math.round(dx),0)}
 x.restore();return c}
function scene(W,H){const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
 if(photo){const s=Math.max(W/photo.width,H/photo.height);x.drawImage(photo,(W-photo.width*s)/2,(H-photo.height*s)/2,photo.width*s,photo.height*s);return c}
 const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'#9aa6ae');g.addColorStop(.5,'#c8bfa9');g.addColorStop(.51,'#5f6d6b');g.addColorStop(1,'#2d3634');x.fillStyle=g;x.fillRect(0,0,W,H);
 x.fillStyle='#b8392a';x.beginPath();x.moveTo(W*.2,H*.6);x.lineTo(W*.3,H*.65);x.lineTo(W*.2,H*.7);x.fill();return c}
function render(cv,pool,seed){const R=rng(seed),asp=+$('asp').value,base=1000,W=asp>=1?base:Math.round(base*asp),H=asp>=1?Math.round(base/asp):base;
 const pm=$('paper').value?Math.round(Math.min(W,H)*.05):0;cv.width=W+2*pm;cv.height=H+2*pm;const x=cv.getContext('2d');
 x.fillStyle=$('paper').value||'#000';x.fillRect(0,0,cv.width,cv.height);x.drawImage(scene(W,H),pm,pm);
 const t=Math.min(W,H)*$('th').value/100;
 const sides=[[0,W],[1,H],[2,W],[3,H]];
 for(const [s,L] of sides){const st=pool[Math.floor(R()*pool.length)];const sc=sideCanvas(st,L,t,R);
  x.save();x.translate(pm,pm);
  if(s===0){}else if(s===1){x.translate(W,0);x.rotate(Math.PI/2)}else if(s===2){x.translate(W,H);x.rotate(Math.PI)}else{x.translate(0,H);x.rotate(-Math.PI/2)}
  x.drawImage(sc,0,0);x.restore()}
 if($('grain').checked){const g=x.getImageData(pm,pm,W,H),p=g.data;for(let i=0;i<p.length;i+=4){const n=(R()-.5)*16;p[i]+=n;p[i+1]+=n;p[i+2]+=n}x.putImageData(g,pm,pm)}}
function card(host,pool,label,key){const d=document.createElement('div');d.className='card';const cv=document.createElement('canvas');d.appendChild(cv);
 let seed=seedBase*7919+host.children.length*104729;const draw=()=>render(cv,pool,seed);draw();
 const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap';
 const b=document.createElement('button');b.textContent='Shuffle';b.onclick=()=>{seed=Math.random()*1e9|0;draw()};row.appendChild(b);
 if(key){for(const [v,t] of [['y','Yes'],['n','No']]){const vb=document.createElement('button');vb.className='v'+(votes[key]===v?' on':'');vb.dataset.v=v;vb.textContent=t;
  vb.onclick=async()=>{votes[key]=votes[key]===v?null:v;await fetch('/vote',{method:'POST',body:JSON.stringify(votes)});build()};row.appendChild(vb)}}
 const l=document.createElement('small');l.textContent=label;row.appendChild(l);d.appendChild(row);host.appendChild(d)}
function build(){$('mix').innerHTML='';$('per').innerHTML='';const ok=strips.filter(s=>votes[s.scan]!=='n');
 if(ok.length)for(let i=0;i<6;i++)card($('mix'),ok,'');
 const scans=[...new Set(strips.map(s=>s.scan))];scans.forEach(sc=>card($('per'),strips.filter(s=>s.scan===sc),sc.slice(0,38),sc));
 const y=scans.filter(s=>votes[s]==='y').length,n=scans.filter(s=>votes[s]==='n').length;$('tally').textContent=`${scans.length} scans · ${y} yes · ${n} no`}
['asp','th','tone','paper','grain'].forEach(id=>$(id).onchange=build);$('shuf').onclick=()=>{seedBase=Math.random()*1e9|0;build()};
$('file').onchange=e=>{const f=e.target.files[0];if(!f)return;const i=new Image();i.onload=()=>{photo=i;build()};i.src=URL.createObjectURL(f)};
boot();
</script>"""

STRIPS = r"""<!doctype html><meta charset=utf-8><title>Strip Review</title>
<style>body{margin:0;background:#1b1a19;color:#e8e4dc;font:13px system-ui;padding:14px}
.bar{position:sticky;top:0;background:#1b1a19;padding:8px 0;z-index:2}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px}
.s{cursor:pointer;border:2px solid transparent;border-radius:4px;padding:4px;background:#f1eee6}
.s img{width:100%;height:auto;display:block;max-height:140px;object-fit:contain;object-position:top}
.s small{display:block;color:#555;margin-top:3px;word-break:break-all}
.s.x{border-color:#e0442e;opacity:.35}</style>
<div class=bar>Click any strip that looks wrong (photo stuck to it, blocks, a second frame). Click again to undo. Saved instantly. <b id=n></b> &middot; <a href="/samples" style="color:#e0804f">Samples</a></div>
<div class=g id=g></div>
<script>
(async()=>{const r=await (await fetch('/report')).json();let rej=new Set(r.rejects||[]);const g=document.getElementById('g');
 const cnt=()=>document.getElementById('n').textContent=rej.size+' rejected';
 for(const f of r.reps)for(const v of Object.values(f.sides||{}))if(v.piece&&!v.bad){const d=document.createElement('div');d.className='s'+(rej.has(v.piece)?' x':'');
  d.innerHTML=`<img loading=lazy src="/pieces/${encodeURIComponent(v.piece)}"><small>${v.piece}</small>`;
  d.onclick=async()=>{rej.has(v.piece)?rej.delete(v.piece):rej.add(v.piece);d.classList.toggle('x');cnt();await fetch('/rejects',{method:'POST',body:JSON.stringify([...rej])})};g.appendChild(d)}
 cnt()})();
</script>"""

def load_marks():
    try: return json.load(open(MARKS))
    except Exception: return {}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ct):
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', len(body)); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == '/': return self.send(PAGE.encode(), 'text/html')
        if self.path == '/strips': return self.send(STRIPS.encode(), 'text/html')
        if self.path == '/samples': return self.send(SAMPLES.encode(), 'text/html')
        if self.path == '/report':
            try: votes = json.load(open(os.path.join(OUT, 'votes.json')))
            except Exception: votes = {}
            try: rejects = json.load(open(os.path.join(OUT, 'rejects.json')))
            except Exception: rejects = []
            return self.send(json.dumps(dict(reps=json.load(open(os.path.join(OUT, 'report.json'))), votes=votes, rejects=rejects)).encode(), 'application/json')
        if self.path.startswith('/pieces/'):
            from urllib.parse import unquote
            f = os.path.join(OUT, 'pieces', os.path.basename(unquote(self.path[8:])))
            return self.send(open(f, 'rb').read(), 'image/png') if os.path.exists(f) else self.send_error(404)
        if self.path == '/api': return self.send(json.dumps(dict(files=FILES, marks=load_marks())).encode(), 'application/json')
        if self.path.startswith('/img?f='):
            from urllib.parse import unquote
            f = os.path.basename(unquote(self.path[7:]))
            if f not in _cache:
                im = Image.open(os.path.join(ROOT, f)).convert('RGB'); im.thumbnail((1600, 1600))
                b = io.BytesIO(); im.save(b, 'JPEG', quality=85); _cache[f] = b.getvalue()
            return self.send(_cache[f], 'image/jpeg')
        self.send_error(404)
    def do_POST(self):
        if self.path == '/rejects':
            open(os.path.join(OUT, 'rejects.json'), 'wb').write(self.rfile.read(int(self.headers['Content-Length'])))
            return self.send(b'ok', 'text/plain')
        if self.path == '/vote':
            open(os.path.join(OUT, 'votes.json'), 'wb').write(self.rfile.read(int(self.headers['Content-Length'])))
            return self.send(b'ok', 'text/plain')
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        m = load_marks(); m[d['f']] = d['m']; json.dump(m, open(MARKS, 'w'), indent=1)
        self.send(b'ok', 'text/plain')

if __name__ == '__main__':
    print(f'{len(FILES)} scans -> http://localhost:8765')
    ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
