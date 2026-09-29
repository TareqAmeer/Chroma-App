import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb, raw_open_bench as rob
rb.app_stop(); rb._session_token=None
t=rob.fresh_start()
E=lambda c,to=60: rb.app_eval(t,c,timeout=to)
E("(()=>{if(!document.getElementById('lib-overlay').classList.contains('on'))window.chromasmithToggleLibrary();return 1})()"); time.sleep(4)
names=json.loads(E("JSON.stringify([...document.querySelectorAll('.lib-card')].slice(0,12).map(c=>c.dataset.path))"))
def ev(js): return E(js)
def click(i,kind):
    return E("""(()=>{const c=document.querySelectorAll('.lib-card')[%d];const w=c.querySelector('.lib-thumb-wrap')||c;
      if('%s'==='select'){w.onclick({shiftKey:false,metaKey:false,ctrlKey:false});return 'sel'}
      w.ondblclick({shiftKey:false,metaKey:false,ctrlKey:false,stopPropagation(){}});return 'dbl'})()"""%(i,kind))
def settle():
    time.sleep(1); rb.app_poll(t,"!window.chromasmithLibraryBusy",lambda r:r is True,180,0.3); time.sleep(1)
def cur(): return E("JSON.stringify({opened:(fxImages[0]||{}).path})")
def key(k): E("(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'%s',bubbles:true}));return 1})()"%k)
print(click(2,'select'))          # cursor := card 2
print(click(5,'dbl')); settle()   # opens card 5, docks the gallery
print('opened', (json.loads(cur()).get('opened') or '?').split('/')[-1], 'expected', names[5].split('/')[-1])
key('ArrowRight'); settle()
got=(json.loads(cur()).get('opened') or '?')
print('after ArrowRight got', got.split('/')[-1], '| expected neighbour of opened card 5 = card 6:', names[6].split('/')[-1], '| card3 (from stale cursor):', names[3].split('/')[-1])
print('BUG REPRODUCED' if got==names[3] else ('OK' if got==names[6] else 'OTHER'))
