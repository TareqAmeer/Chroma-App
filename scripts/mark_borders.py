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
               if f.lower().endswith(('jpg', 'jpeg', 'webp')) and not any(s in f for s in SKIP) and ' copy' not in f)
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
<button id=skip>Skip scan</button>
<span>No frame on side:</span><button class=nf data-s=0>Top</button><button class=nf data-s=1>Right</button><button class=nf data-s=2>Bottom</button><button class=nf data-s=3>Left</button>
<span style="opacity:.7">Drag the red dots onto the photo's edge &middot; <kbd>Enter</kbd> save &amp; next</span></header>
<div id=wrap><canvas id=c></canvas></div>
<script>
let files=[],marks={},i=0,img=new Image(),st=null,drag=null;
const c=document.getElementById('c'),x=c.getContext('2d');
async function boot(){const r=await (await fetch('/api')).json();files=r.files;marks=r.marks;i=Math.max(0,files.findIndex(f=>!marks[f]));if(i<0)i=0;load()}
function def(){return{pts:[[.08,.08],[.92,.08],[.92,.92],[.08,.92]].map(p=>p.slice()),none:[false,false,false,false],skip:false}}
function load(){const f=files[i];st=JSON.parse(JSON.stringify(marks[f]||def()));
 document.getElementById('name').textContent=f;document.getElementById('pos').textContent=`${i+1} / ${files.length}`;
 img.onload=()=>{c.width=img.width;c.height=img.height;draw()};img.src='/img?f='+encodeURIComponent(f)}
function draw(){x.drawImage(img,0,0);const W=c.width,H=c.height,P=st.pts.map(p=>[p[0]*W,p[1]*H]);
 x.lineWidth=Math.max(1.5,W/700);
 for(let s=0;s<4;s++){const a=P[s],b=P[(s+1)%4];x.strokeStyle=st.none[s]?'rgba(120,120,120,.8)':'#ff3b2f';x.setLineDash(st.none[s]?[8,6]:[]);
  // extend each side line across the whole image
  const dx=b[0]-a[0],dy=b[1]-a[1];x.beginPath();x.moveTo(a[0]-dx*2,a[1]-dy*2);x.lineTo(b[0]+dx*2,b[1]+dy*2);x.stroke()}
 x.setLineDash([]);P.forEach(p=>{x.fillStyle='#ff3b2f';x.beginPath();x.arc(p[0],p[1],W/110,0,7);x.fill();x.strokeStyle='#fff';x.stroke()});
 if(st.skip){x.fillStyle='rgba(0,0,0,.6)';x.fillRect(0,0,W,H);x.fillStyle='#fff';x.font=`${W/20}px system-ui`;x.fillText('SKIPPED',W*.38,H/2)}
 document.querySelectorAll('.nf').forEach(b=>b.classList.toggle('on',st.none[+b.dataset.s]));document.getElementById('skip').classList.toggle('on',st.skip)}
function pos(e){const r=c.getBoundingClientRect();return[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]}
c.onpointerdown=e=>{const p=pos(e);let best=-1,bd=.04;st.pts.forEach((q,k)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<bd){bd=d;best=k}});drag=best>=0?best:null;c.setPointerCapture(e.pointerId)};
c.onpointermove=e=>{if(drag==null)return;st.pts[drag]=pos(e).map(v=>Math.min(1,Math.max(0,v)));draw()};
c.onpointerup=()=>drag=null;
async function save(){marks[files[i]]=st;await fetch('/save',{method:'POST',body:JSON.stringify({f:files[i],m:st})})}
document.getElementById('next').onclick=async()=>{await save();if(i<files.length-1){i++;load()}else alert('All done')};
document.getElementById('prev').onclick=()=>{if(i>0){i--;load()}};
document.getElementById('skip').onclick=()=>{st.skip=!st.skip;draw()};
document.querySelectorAll('.nf').forEach(b=>b.onclick=()=>{st.none[+b.dataset.s]^=true;st.none=st.none.map(Boolean);draw()});
addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('next').click()});
boot();
</script>'''

def load_marks():
    try: return json.load(open(MARKS))
    except Exception: return {}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ct):
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', len(body)); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == '/': return self.send(PAGE.encode(), 'text/html')
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
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        m = load_marks(); m[d['f']] = d['m']; json.dump(m, open(MARKS, 'w'), indent=1)
        self.send(b'ok', 'text/plain')

if __name__ == '__main__':
    print(f'{len(FILES)} scans -> http://localhost:8765')
    ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
