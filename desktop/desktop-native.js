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
      // Clear the PREVIOUS photo's ground-truth lens-applied flag immediately, so the status
      // line doesn't keep showing "Applied ✓" for the outgoing photo while this one decodes.
      window.chromasmithLensApplied = undefined;
      if (typeof window.chromasmithLensStatusRefresh === 'function') window.chromasmithLensStatusRefresh();
      // DCP path: the whole develop (decode + PPG demosaic + baked-LUT apply) runs in Rust
      // and returns display-ready RGBA8 — the old flow shipped 145MB of u16 RGB over IPC and
      // ran a 24M-pixel trilinear loop on the JS main thread. The 65^3 LUT is baked once per
      // profile in JS (bakeDcpLUT; dcpFit is ISO-independent since the native-decode refit)
      // and registered with Rust once per session.
      const profile = (typeof rawProfile === 'function') ? rawProfile() : '';
      let mode = 'srgb', lutKey = '';
      if (settings && settings.outputBps === 16) {
        // Which camera's .dcp files apply is only knowable from EXIF, and open() only gets raw
        // bytes (not a filesystem path) — a cheap metadata-only peek (no demosaic) first, so a
        // camera we have no bundled profile for skips straight to linear16 instead of getting
        // the wrong camera's colors applied (see cameraDcpPrefix in chromasmith-22.html).
        let camPrefix = null;
        if (profile) {
          try {
            const ident = await invoke('peek_raw_camera', bytes);
            camPrefix = (typeof cameraDcpPrefix === 'function') ? cameraDcpPrefix(ident.make, ident.model) : null;
          } catch (e) { console.error('peek_raw_camera', e); }
        }
        if (profile && camPrefix) {
          mode = 'lut'; lutKey = 'dcp:' + camPrefix + ':' + profile;
          if (!_rustLuts[lutKey]) {
            const lut = await getDcpLUT(camPrefix, profile, 200); // iso arg vestigial (constants ISO-independent)
            await framedInvoke('store_dcp_lut', { key: lutKey },
              new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength));
            _rustLuts[lutKey] = true;
          }
        } else {
          mode = 'linear16';
          if (profile && !camPrefix && typeof log === 'function') {
            log('No bundled colour profile for this camera — RAW Noise Reduction and geometry still apply, but you\'ll need Basic Adjustments (White Balance/Exposure/etc.) to grade instead of a RAW profile.', 'warn');
          }
        }
      }
      const autoLens = !!window.chromasmithAutoLens;
      const nativeNr = window.chromasmithNativeNr !== false; // default on
      const extra = { autoLens, nativeNr };
      const buf = await framedInvoke('decode_raw_v2', mode === 'lut' ? { mode, lutKey, ...extra } : { mode, ...extra }, bytes);
      // 4th header word: whether Rust actually applied the requested LUT. Rust re-checks the
      // camera make independently (main.rs's KNOWN_DCP_MAKES) as a backstop in case this
      // peek_raw_camera pre-check above ever disagrees with it — read the flag rather than
      // assuming our own requested mode was honored.
      // 5th header word: whether auto lens-profile correction was ACTUALLY applied on this
      // decode (ground truth, not a separate DB probe) — surfaced to the lens-auto status UI
      // via window.chromasmithLensApplied so it can show what really happened.
      const head = new Uint32Array(buf, 0, 5);
      this._w = head[0]; this._h = head[1]; this._iso = head[2];
      const usedLut = head[3] === 1;
      window.chromasmithLensApplied = head[4] === 1;
      if (typeof window.chromasmithLensStatusRefresh === 'function') window.chromasmithLensStatusRefresh();
      this._mode = (mode === 'lut' && !usedLut) ? 'linear16' : mode;
      this._buf = buf;
      if (mode === 'lut' && !usedLut && typeof log === 'function') {
        log('Rust declined to apply the DCP profile for this camera (unexpected — the JS-side check should have caught this first). RAW Noise Reduction and geometry still apply; use Basic Adjustments to grade manually.', 'warn');
      }
    }
    // make/model here were previously hardcoded 'Panasonic'/'DC-S9' — wrong for any other
    // camera and redundant besides: library-ui.js's openInEditor fetches real metadata
    // (camera/lens/shutter/aperture/iso/date) via the Rust get_meta command and overwrites
    // #fx-exif right after load, so this shim doesn't need to guess.
    async metadata() { return { iso_speed: this._iso, make: '', model: '' }; }
    async imageData() {
      if (this._mode === 'linear16') {
        return { width: this._w, height: this._h, colors: 3, bits: 16, data: new Uint16Array(this._buf, 20) };
      }
      // rgba:true tells loadRw2 the pixels are final RGBA8 — no JS-side LUT/gamma pass needed.
      return { width: this._w, height: this._h, colors: 4, bits: 8, rgba: true, data: new Uint8ClampedArray(this._buf, 20) };
    }
    get worker() { return { terminate() {} }; }
  }
  window.getLibRaw = async function () { return NativeLibRawShim; };

  // ── Darkroom-style shell layout: everything is chromasmith-22.html's `body.deskx` mode
  // (grid, icon rail right, panel toggle, ⋯ menu, 44px deskbar) — the shell only turns it on
  // and handles the two things a web page can't: the window drag region and traffic lights.
  // titleBarStyle:"Overlay" (tauri.conf.json) keeps the traffic-light buttons floating over
  // the web content; the deskbar's 84px left padding (deskx CSS) clears them, and the deskbar
  // itself is the drag handle. Buttons inside it must be explicitly no-drag or every click
  // becomes a window drag.
  const style = document.createElement('style');
  style.textContent = `
    body.tauri-native #fx-deskbar{-webkit-app-region:drag}
    body.tauri-native #fx-deskbar button,body.tauri-native #fx-deskbar-tools,
    body.tauri-native #fx-deskbar-tools *,body.tauri-native #fx-overflow,
    body.tauri-native #fx-overflow *{-webkit-app-region:no-drag}
    body.tauri-native{height:100vh;overflow:hidden}
    body.tauri-native #log-area{z-index:3500}
  `;
  document.head.appendChild(style);
  document.body.classList.add('tauri-native');
  document.body.classList.add('deskx');
  const deskbar = document.getElementById('fx-deskbar');
  if (deskbar) deskbar.setAttribute('data-tauri-drag-region', '');
  if (typeof applyFxLayout === 'function') applyFxLayout(); // re-fit now that deskx changed the geometry

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && t.closest && t.closest('input,textarea,[contenteditable]');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Tab' && document.body.classList.contains('fx-deskb')) {
      // Toggle the tools panel like clicking the active rail icon (deskx panel-closed flow).
      e.preventDefault();
      const on = document.querySelector('#fx-toolrail .fx-rail-btn.on');
      if (on) on.click();
      else if (typeof fxSection === 'function') fxSection((typeof _activeSec === 'function' && _activeSec()) || 'adjust');
    } else if (e.key === 'l' || e.key === 'L') {
      window.chromasmithToggleLibrary && window.chromasmithToggleLibrary();
    }
  });

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
