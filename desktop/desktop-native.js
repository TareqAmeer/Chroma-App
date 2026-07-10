// Chromasmith desktop shell glue. Injected ONLY into the staged Tauri build (build-desktop.sh
// appends this before </body>; the source chromasmith-22.html is never touched, so the web
// and iOS builds are completely unaffected). Everything here is gated on window.__TAURI__ so
// this file is a safe no-op if it were ever loaded outside the native shell.
(function () {
  if (!window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;

  // loadRw2() has an unconditional guard — `if(!self.crossOriginIsolated) throw ...` — that
  // blocks RW2 loading whenever cross-origin isolation is off, since the WEB build's decoder
  // (libraw-wasm) needs SharedArrayBuffer for that. The native shim below never touches
  // SharedArrayBuffer at all (decode happens in Rust), so that guard's assumption doesn't hold
  // here — but chromasmith-22.html has no way to know a native decoder is available, and it
  // must stay platform-agnostic. Spoofing the (real, correctly false) crossOriginIsolated
  // value to true — ONLY under Tauri — satisfies the guard without touching that file. `self`
  // and `window` are the same object in a page context, so this covers both call sites.
  try {
    Object.defineProperty(window, 'crossOriginIsolated', { value: true, configurable: true });
  } catch (e) {
    console.error('could not spoof crossOriginIsolated', e);
  }

  // ── Native RW2 decode ─────────────────────────────────────────────────────────
  // chromasmith-22.html's loadRw2() calls getLibRaw() then `new LibRaw()` expecting libraw-
  // wasm's interface (.open/.metadata()/.imageData()/.worker.terminate()) — that decoder needs
  // SharedArrayBuffer, which this native WKWebView shell could not reliably get cross-origin
  // isolation to expose (verified two independent ways: Tauri's declarative header config, and
  // a fully manual protocol handler hardcoding headers on every response including the first —
  // crossOriginIsolated stayed false both times). Same architecture RapidRAW uses: decode RAW
  // natively in Rust instead (src-tauri/src/raw_decode.rs, via the `rawler` crate), never in
  // the WebView. Overriding the global getLibRaw() here means loadRw2() itself needs no
  // changes at all — it just receives an object shaped like libraw-wasm's.
  const s2g = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; // sRGB OETF
  class NativeLibRawShim {
    async open(bytes, settings) {
      this._settings = settings; // {outputBps:16,...} DCP path vs {outputBps:8,...} "None" path
      const b64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(new Blob([bytes]));
      });
      const buf = await invoke('decode_raw', { bytesB64: b64 }); // ArrayBuffer (raw ipc::Response)
      const head = new Uint32Array(buf, 0, 3);
      this._w = head[0]; this._h = head[1]; this._iso = head[2];
      this._linear16 = new Uint16Array(buf, 12); // always linear 16-bit RGB out of Rust
    }
    async metadata() { return { iso_speed: this._iso, make: 'Panasonic', model: 'DC-S9' }; }
    async imageData() {
      // DCP path (the default / recommended profile-matched path): hand the linear 16-bit
      // buffer straight to bakeDcpLUT/applyDcpLUT exactly as libraw-wasm's dcpSettings would.
      if (this._settings && this._settings.outputBps === 16) {
        return { width: this._w, height: this._h, colors: 3, bits: 16, dataSize: this._linear16.byteLength, data: this._linear16 };
      }
      // "None (LibRaw sRGB)" path: apply sRGB gamma ourselves and pack to 8-bit, matching the
      // shape (not the exact tone) of libraw's own outputColor:1/outputBps:8 rendering.
      const n = this._linear16.length;
      const out = new Uint8ClampedArray(n);
      for (let i = 0; i < n; i++) out[i] = Math.round(s2g(this._linear16[i] / 65535) * 255);
      return { width: this._w, height: this._h, colors: 3, bits: 8, dataSize: out.byteLength, data: out };
    }
    get worker() { return { terminate() {} }; }
  }
  window.getLibRaw = async function () { return NativeLibRawShim; };

  // ── Traffic-light spacing + custom titlebar drag region ──────────────────────
  // titleBarStyle:"Overlay" (tauri.conf.json) removes the native title bar text/background
  // but keeps the traffic-light buttons floating over the web content — so the app's own
  // <header> needs left padding to clear them, and needs to double as the window's drag
  // handle since there's no native title bar left to drag by.
  const style = document.createElement('style');
  style.textContent = `
    body.tauri-native header{padding-left:78px;-webkit-app-region:no-drag}
    body.tauri-native header .logo{-webkit-app-region:drag}
    body.tauri-native .hdr-right{-webkit-app-region:no-drag}
  `;
  document.head.appendChild(style);
  document.body.classList.add('tauri-native');

  const header = document.querySelector('header');
  if (header) header.setAttribute('data-tauri-drag-region', '');
  const logo = document.querySelector('header .logo');
  if (logo) logo.setAttribute('data-tauri-drag-region', '');

  // Library toggle button — matches the existing .hdr-btn styling, added before the theme
  // toggle. library-ui.js (loaded separately, see build-desktop.sh) defines the actual view
  // and exposes window.chromasmithToggleLibrary; this button is just the entry point.
  const hdrRight = document.querySelector('.hdr-right');
  if (hdrRight) {
    const libBtn = document.createElement('button');
    libBtn.className = 'hdr-btn';
    libBtn.title = 'Photo Library (local folders)';
    libBtn.textContent = '🗂';
    libBtn.onclick = () => window.chromasmithToggleLibrary && window.chromasmithToggleLibrary();
    hdrRight.insertBefore(libBtn, hdrRight.firstChild);
  }

  // ── Native menu bar wiring ────────────────────────────────────────────────────
  // The Rust side (src-tauri/src/main.rs) builds a real macOS menu bar (App/File/Edit/
  // Window) and emits these events for the items that need to call into the app; standard
  // items (Quit, Minimize, Cut/Copy/Paste, About…) are handled natively with zero JS.
  const { listen } = window.__TAURI__.event;
  const wire = (event, fn) => listen(event, () => { try { fn(); } catch (e) { console.error(event, e); } });
  wire('menu-open', () => typeof fxPickPhotos === 'function' && fxPickPhotos());
  wire('menu-export', () => typeof exportFX === 'function' && exportFX());
  wire('menu-undo', () => typeof fxUndo === 'function' && fxUndo());
  wire('menu-redo', () => typeof fxRedo === 'function' && fxRedo());

  // ── Native-feeling right-click: no bare WKWebView context menu on chrome, but text
  // fields/log keep normal editing (Cut/Copy/Paste) behaviour. ─────────────────────
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    const editable = t.closest && t.closest('input,textarea,[contenteditable],#log-area');
    if (!editable) e.preventDefault();
  });
})();
