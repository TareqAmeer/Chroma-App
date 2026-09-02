"""
Tiny local relay so JS-side signals reach the diagnostic run, since
chromasmith-22.html's own error handlers only ever write to an in-memory,
non-persisted #log-area (see chromasmith-22.html's window.onerror/
unhandledrejection handlers) and nothing native bridges them anywhere
retrievable.

This requires one manual, one-time-per-session paste into Safari's Web
Inspector console (Develop > Chromasmith > the page) — the minimum
possible ritual without a native code change. The tool is fully
functional without it; it just loses JS-error / silent-wrong-behavior
visibility for that session.

Beyond error capture, the pasted snippet also:
- POSTs a periodic getUISnapshot() heartbeat (category 'state_snapshot'),
  so a freeze/error incident can be correlated against what the app
  actually thought its state was at that moment — the direct fix for
  "silent wrong behavior" being undiagnosable after the fact.
- Wraps window.__TAURI__.core.invoke to log every Rust command name and
  duration (category 'ipc'), since most "slow operation" bugs in this
  app cross the JS/Rust boundary (RAW decode, catalog scans, DCP bakes).
"""
import http.server
import json
import threading
import time

RELAY_PORT = 8732

PASTE_SNIPPET = """(()=>{
const post=e=>fetch('http://127.0.0.1:%d/event',{method:'POST',body:JSON.stringify(e)}).catch(()=>{});
const snap=()=>{try{return window.getUISnapshot?window.getUISnapshot():null}catch(_){return null}};
window.addEventListener('error',e=>post({t:Date.now(),k:'error',msg:e.message,src:e.filename+':'+e.lineno,snap:snap()}));
window.addEventListener('unhandledrejection',e=>post({t:Date.now(),k:'rejection',msg:String(e.reason),snap:snap()}));
const oe=console.error;
console.error=(...a)=>{post({t:Date.now(),k:'console.error',msg:a.map(String).join(' '),snap:snap()});oe(...a);};
setInterval(()=>post({t:Date.now(),k:'heartbeat',snap:snap()}),5000);
if(window.__TAURI__&&window.__TAURI__.core&&window.__TAURI__.core.invoke){
  const orig=window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke=function(cmd,args){
    const t0=performance.now();
    return orig.call(this,cmd,args).then(
      r=>{post({t:Date.now(),k:'ipc',cmd,ms:Math.round(performance.now()-t0)});return r;},
      err=>{post({t:Date.now(),k:'ipc_err',cmd,ms:Math.round(performance.now()-t0),msg:String(err)});throw err;}
    );
  };
}
console.log('[diagnostics] relay armed');
})();""" % RELAY_PORT

# how each 'k' value from the snippet maps to an events.jsonl category
KIND_TO_CATEGORY = {
    'error': 'error', 'rejection': 'error', 'console.error': 'error',
    'heartbeat': 'state_snapshot',
    'ipc': 'ipc', 'ipc_err': 'ipc',
}


def _snapshot_json_safe(snap):
    """Truncate a getUISnapshot() payload so one bad session can't blow up events.jsonl."""
    if snap is None:
        return None
    try:
        text = json.dumps(snap)
    except (TypeError, ValueError):
        return None
    if len(text) > 4000:
        return {'_truncated': True, 'raw': text[:4000]}
    return snap


def make_handler(on_event):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # silence default stderr access logging

        def do_POST(self):
            if self.path != '/event':
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b'{}'
            try:
                payload = json.loads(body)
            except (json.JSONDecodeError, ValueError):
                payload = {'raw': body.decode('utf-8', 'replace')}

            kind = payload.get('k', 'unknown')
            category = KIND_TO_CATEGORY.get(kind, 'error')
            event = {
                'ts': time.time(),
                'category': category,
                'kind': f"js_{kind}" if category == 'error' else kind,
            }
            if 'msg' in payload:
                event['msg'] = str(payload.get('msg'))[:2000]
            if 'src' in payload:
                event['src'] = payload.get('src')
            if 'cmd' in payload:
                event['cmd'] = payload.get('cmd')
            if 'ms' in payload:
                event['ms'] = payload.get('ms')
            if 'snap' in payload:
                event['snap'] = _snapshot_json_safe(payload.get('snap'))

            on_event(event)
            self.send_response(204)
            self.end_headers()

    return Handler


class JsRelay:
    def __init__(self, on_event):
        self.on_event = on_event
        self._server = None
        self._thread = None

    def start(self):
        handler = make_handler(self.on_event)
        self._server = http.server.HTTPServer(('127.0.0.1', RELAY_PORT), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
