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
  // Framed raw-body invoke: [u32 jsonLen][json utf8][payload]. No base64 in either direction
  // (Tauri v2 sends ArrayBuffer/Uint8Array invoke args as a raw body; responses were already
  // raw ipc::Response buffers).
  const framedInvoke = (cmd, jsonObj, payload) => {
    const json = new TextEncoder().encode(JSON.stringify(jsonObj));
    const framed = new Uint8Array(4 + json.length + payload.length);
    new DataView(framed.buffer).setUint32(0, json.length, true);
    framed.set(json, 4);
    framed.set(payload, 4 + json.length);
    return invoke(cmd, framed);
  };
  const _rustLuts = {}; // lutKey -> true once registered with the Rust side this session
  class NativeLibRawShim {
    async open(bytes, settings) {
      // DCP path: the whole develop (decode + PPG demosaic + baked-LUT apply) runs in Rust
      // and returns display-ready RGBA8 — the old flow shipped 145MB of u16 RGB over IPC and
      // ran a 24M-pixel trilinear loop on the JS main thread. The 65^3 LUT is baked once per
      // profile in JS (bakeDcpLUT; dcpFit is ISO-independent since the native-decode refit)
      // and registered with Rust once per session.
      const profile = (typeof rawProfile === 'function') ? rawProfile() : '';
      let mode = 'srgb', lutKey = '';
      if (settings && settings.outputBps === 16) {
        if (profile) {
          mode = 'lut'; lutKey = 'dcp:' + profile;
          if (!_rustLuts[lutKey]) {
            const lut = await getDcpLUT(profile, 200); // iso arg vestigial (constants ISO-independent)
            await framedInvoke('store_dcp_lut', { key: lutKey },
              new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength));
            _rustLuts[lutKey] = true;
          }
        } else {
          mode = 'linear16';
        }
      }
      const buf = await framedInvoke('decode_raw_v2', mode === 'lut' ? { mode, lutKey } : { mode }, bytes);
      const head = new Uint32Array(buf, 0, 3);
      this._w = head[0]; this._h = head[1]; this._iso = head[2];
      this._mode = mode; this._buf = buf;
    }
    async metadata() { return { iso_speed: this._iso, make: 'Panasonic', model: 'DC-S9' }; }
    async imageData() {
      if (this._mode === 'linear16') {
        return { width: this._w, height: this._h, colors: 3, bits: 16, data: new Uint16Array(this._buf, 12) };
      }
      // rgba:true tells loadRw2 the pixels are final RGBA8 — no JS-side LUT/gamma pass needed.
      return { width: this._w, height: this._h, colors: 4, bits: 8, rgba: true, data: new Uint8ClampedArray(this._buf, 12) };
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
