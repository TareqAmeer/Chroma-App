"""
Tiny local relay so JS-side errors (window.onerror, unhandledrejection,
console.error) can reach the diagnostic run, since chromasmith-22.html's
own error handlers only ever write to an in-memory, non-persisted
#log-area (see chromasmith-22.html's window.onerror/unhandledrejection
handlers) and nothing native bridges them anywhere retrievable.

This requires one manual, one-time-per-session paste into Safari's Web
Inspector console (Develop > Chromasmith > the page) — the minimum
possible ritual without a native code change. The tool is fully
functional without it; it just loses JS-error / silent-wrong-behavior
visibility for that session.
"""
import http.server
import json
import threading
import time

RELAY_PORT = 8732

PASTE_SNIPPET = """(()=>{const p=e=>fetch('http://127.0.0.1:%d/event',{method:'POST',body:JSON.stringify(e)}).catch(()=>{});
window.addEventListener('error',e=>p({t:Date.now(),k:'error',msg:e.message,src:e.filename+':'+e.lineno}));
window.addEventListener('unhandledrejection',e=>p({t:Date.now(),k:'rejection',msg:String(e.reason)}));
const oe=console.error;console.error=(...a)=>{p({t:Date.now(),k:'console.error',msg:a.map(String).join(' ')});oe(...a);};
})();""" % RELAY_PORT


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
            on_event({
                'ts': time.time(),
                'category': 'error',
                'kind': f"js_{payload.get('k', 'unknown')}",
                'msg': str(payload.get('msg', payload))[:2000],
            })
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
