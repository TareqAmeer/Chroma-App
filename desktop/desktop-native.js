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
      // Clear the PREVIOUS photo's ground-truth lens-applied flag immediately. Deliberately NOT
      // calling chromasmithLensStatusRefresh() here (or right after decode, below) — at both of
      // those points fxImages[fxCurIdx].exif is still the OUTGOING photo's (library-ui.js only
      // attaches the new photo's real exif later, after its own getMeta() call resolves), so a
      // refresh here would read stale/wrong data and could flash a false "no lens model" for
      // the photo that's still loading. library-ui.js's post-getMeta refresh (right after
      // showExif) is the only correct place to trigger this — this flag update just makes sure
      // that later call has fresh data to read.
      window.chromasmithLensApplied = undefined;
      // DCP path: the whole develop (decode + PPG demosaic + baked-LUT apply) runs in Rust
      // and returns display-ready RGBA8 — the old flow shipped 145MB of u16 RGB over IPC and
      // ran a 24M-pixel trilinear loop on the JS main thread. The 65^3 LUT is baked once per
      // profile in JS (bakeDcpLUT; dcpFit is ISO-independent since the native-decode refit)
      // and registered with Rust once per session.
      const profile = (typeof rawProfile === 'function') ? rawProfile() : '';
      let mode = 'srgb', lutKey = '';
      // Cheap EXIF-only peek (no demosaic), ALWAYS — it yields make/model (for the DCP profile
      // choice) AND lens (with the RW2 kamadak-exif fallback rawler's own parse misses). Doing
      // it unconditionally means every open path gets lens into fxImages[].exif via metadata()
      // below, so the metadata panel shows lens no matter how the photo was opened — not just
      // the single library-card path that separately calls get_meta.
      // Timing breakdown for the "RAW load takes up to 15s" report, logged into the app's own
      // log panel (not console — the packaged .app has no attached terminal for anyone to read
      // console.log from) so the actual slow stage is visible without a profiler attached.
      const _t0 = performance.now();
      const _lap = (label) => { if (typeof log === 'function') log(`RAW load: ${label} ${(performance.now() - _t0).toFixed(0)}ms`, 'info'); };
      this._ident = { make: '', model: '', lens: '' };
      try { this._ident = await invoke('peek_raw_camera', bytes); } catch (e) { console.error('peek_raw_camera', e); }
      _lap('peek_raw_camera done at');
      if (settings && settings.outputBps === 16) {
        const camPrefix = (typeof cameraDcpPrefix === 'function') ? cameraDcpPrefix(this._ident.make, this._ident.model) : null;
        if (profile && camPrefix) {
          mode = 'lut'; lutKey = 'dcp:' + camPrefix + ':' + profile;
          if (!_rustLuts[lutKey]) {
            const lut = await getDcpLUT(camPrefix, profile, 200); // iso arg vestigial (constants ISO-independent)
            _lap('DCP LUT baked (JS) at');
            await framedInvoke('store_dcp_lut', { key: lutKey },
              new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength));
            _rustLuts[lutKey] = true;
            _lap('DCP LUT registered with Rust at');
          }
        } else {
          mode = 'linear16';
          if (profile && !camPrefix && typeof log === 'function') {
            log('No bundled colour profile for this camera — RAW Noise Reduction and geometry still apply, but you\'ll need Basic Adjustments (White Balance/Exposure/etc.) to grade instead of a RAW profile.', 'warn');
          }
        }
      }
      const autoLens = !!window.chromasmithAutoLens;
      // ⚠️ decode_raw_v2 only ever accepts "off"/"fast" — High-tier neural NR runs via the
      // SEPARATE denoise_raw_high command (window.chromasmithDenoiseHigh), never through this
      // path, so a 'high' selection collapses to 'fast' here (the cheap passes still run
      // automatically; the expensive one only runs on explicit request or at export — see
      // raw_decode.rs's NrTier and rawdenoise.rs's module doc for the full two-tier rationale).
      const rawNrSelected = window.chromasmithRawNr || (window.chromasmithNativeNr !== false ? 'fast' : 'off');
      const rawNr = rawNrSelected === 'off' ? 'off' : 'fast';
      // Per-photo "RAW Processing" mode: "" (Standard/PPG, default) or "ahd" (Sparkle-
      // optimized — trades some general chroma-noise headroom for much cleaner rendering of
      // dense sunlit-water/specular sparkle fields; NOT a global default, see raw_decode.rs).
      const demosaicAlgo = window.chromasmithDemosaicAlgo || '';
      // Manual lens override — a "Maker Model" string from list_lens_profiles + a focal length
      // in mm, set by the Lens Correction panel when EXIF auto-detection has nothing to go on
      // (manual/adapted lenses like TTArtisan write no lens EXIF at all). Empty/0 means "use
      // EXIF detection as normal" — see raw_decode.rs's lens_override param.
      const lensOverride = window.chromasmithLensOverride || '';
      const lensOverrideFocal = window.chromasmithLensOverrideFocal || 0;
      const extra = { autoLens, rawNr, demosaicAlgo, lensOverride, lensOverrideFocal };
      // Two-phase decode ("RAW load takes 15s"): the FIRST decode always requests `fast:true`
      // — Rust skips the false-color-suppression / hue-defringe / native-NR passes (the serial
      // full-frame CPU work that dominates decode time), so this returns in roughly the time a
      // plain demosaic takes. If native NR is actually wanted, refine() below re-decodes the
      // SAME bytes at full quality in the background and loadRw2() swaps the pixels in once it
      // lands — the user sees a photo almost immediately instead of staring at a spinner.
      this._mode = mode; this._lutKey = lutKey; this._bytes = bytes; this._extra = extra;
      this._needsRefine = rawNr !== 'off'; // full quality still gets applied — just not before first paint
      const buf = await framedInvoke('decode_raw_v2', mode === 'lut' ? { mode, lutKey, ...extra, fast: true } : { mode, ...extra, fast: true }, bytes);
      _lap('decode_raw_v2 FAST (native decode+demosaic+LUT, no NR yet) done at');
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
      window.chromasmithLensApplied = head[4] === 1; // see the comment above open() for why this doesn't also trigger a refresh here
      this._mode = (mode === 'lut' && !usedLut) ? 'linear16' : mode;
      this._buf = buf;
      if (mode === 'lut' && !usedLut && typeof log === 'function') {
        log('Rust declined to apply the DCP profile for this camera (unexpected — the JS-side check should have caught this first). RAW Noise Reduction and geometry still apply; use Basic Adjustments to grade manually.', 'warn');
      }
    }
    // make/model/lens now come from the always-on peek (this._ident). library-ui.js's
    // get_meta still refines the panel with the fuller set (shutter/aperture/date) on library
    // opens, but returning lens here means EVERY open path (import, drag-drop, batch) shows at
    // least camera+lens, which get_meta-only paths previously missed.
    async metadata() {
      const id = this._ident || {};
      return { iso_speed: this._iso, make: id.make || '', model: id.model || '', lens: id.lens || '' };
    }
    async imageData() {
      if (this._mode === 'linear16') {
        return { width: this._w, height: this._h, colors: 3, bits: 16, data: new Uint16Array(this._buf, 20) };
      }
      // rgba:true tells loadRw2 the pixels are final RGBA8 — no JS-side LUT/gamma pass needed.
      return { width: this._w, height: this._h, colors: 4, bits: 8, rgba: true, data: new Uint8ClampedArray(this._buf, 20) };
    }
    get worker() { return { terminate() {} }; }
    // Second phase of the two-phase decode: re-decodes the SAME bytes at full quality
    // (fast:false — false-color suppression + hue defringe + native NR all run) and returns
    // pixels in the identical shape imageData() does, so loadRw2() can swap them into the
    // already-displayed canvas without any new pixel-format handling. Returns null if this
    // instance's first decode didn't actually need refining (NR was off) or already failed.
    async refine() {
      if (!this._needsRefine || !this._bytes) return null;
      const { _mode: mode, _lutKey: lutKey, _extra: extra, _bytes: bytes } = this;
      const buf = await framedInvoke('decode_raw_v2', mode === 'lut' ? { mode, lutKey, ...extra, fast: false } : { mode, ...extra, fast: false }, bytes);
      const head = new Uint32Array(buf, 0, 5);
      const w = head[0], h = head[1];
      const usedLut = head[3] === 1;
      const effMode = (mode === 'lut' && !usedLut) ? 'linear16' : mode;
      if (effMode === 'linear16') {
        return { width: w, height: h, colors: 3, bits: 16, data: new Uint16Array(buf, 20) };
      }
      return { width: w, height: h, colors: 4, bits: 8, rgba: true, data: new Uint8ClampedArray(buf, 20) };
    }
  }
  window.getLibRaw = async function () { return NativeLibRawShim; };

  // ── High-tier (neural) RAW denoise — "Denoise now" button in the Noise Reduction panel.
  // Deliberately NOT a NativeLibRawShim method: that class's instances are open()-call-scoped
  // locals inside loadRw2() and aren't retained anywhere, so a button pressed long after the
  // photo loaded (after switching photos, undoing, etc.) has no instance to call back into.
  // Re-derives mode/lutKey fresh from the CURRENT rawProfile()/curItem().exif — exactly
  // NativeLibRawShim.open()'s own logic — rather than trying to cache stale state, so if the
  // user changed the RAW profile dropdown since opening, the denoised result matches what's
  // actually on screen now, not what was on screen when the photo first loaded.
  // `targetItem` lets exportFX() denoise a SPECIFIC fxImages[] entry (not necessarily the one
  // currently selected/shown) — pass null/undefined for the interactive "Denoise now" button,
  // which always means "the current photo". When an explicit item IS passed, the canvas-
  // identity bail-out below is skipped: export already owns the iteration (its own cancel
  // button stops the batch loop, not this), so there's no concurrent-photo-switch race to
  // guard against the way there is for the interactive button.
  window.chromasmithDenoiseHigh = async function (targetItem, onProgress, onToken) {
    const it = targetItem || ((typeof curItem === 'function') ? curItem() : null);
    if (!it || !it.rawFile) throw new Error('No RAW photo selected — High-tier noise reduction only applies to RAW files.');
    const c = it.img; // canvas identity, re-checked after the async round trip — same guard refine()'s caller uses
    const bytes = new Uint8Array(await it.rawFile.arrayBuffer());
    const profile = (typeof rawProfile === 'function') ? rawProfile() : '';
    const ident = it.exif || {};
    let mode = 'srgb', lutKey = '';
    if (profile) {
      const camPrefix = (typeof cameraDcpPrefix === 'function') ? cameraDcpPrefix(ident.make || '', ident.model || '') : null;
      if (camPrefix) {
        mode = 'lut'; lutKey = 'dcp:' + camPrefix + ':' + profile;
        if (!_rustLuts[lutKey]) {
          const lut = await getDcpLUT(camPrefix, profile, 200); // iso arg vestigial — see open()'s identical call
          await framedInvoke('store_dcp_lut', { key: lutKey },
            new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength));
          _rustLuts[lutKey] = true;
        }
      } else {
        mode = 'linear16';
      }
    }
    const autoLens = !!window.chromasmithAutoLens;
    const demosaicAlgo = window.chromasmithDemosaicAlgo || '';
    const lensOverride = window.chromasmithLensOverride || '';
    const lensOverrideFocal = window.chromasmithLensOverrideFocal || 0;
    const token = 'nrh-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    if (typeof onToken === 'function') onToken(token); // lets the caller wire a Cancel button before the request lands
    let unlisten = null;
    if (typeof onProgress === 'function' && window.__TAURI__.event) {
      try {
        unlisten = await window.__TAURI__.event.listen('raw-nr-progress', (e) => {
          const p = e.payload || {};
          if (p.token === token) onProgress(p.done, p.total);
        });
      } catch (e) { console.error('raw-nr-progress listen failed', e); }
    }
    // 0-100, blend-toward-original amount — see chromasmith-22.html's sl-nr-high-strength /
    // rawdenoise.rs's `strength` param doc comment for why this exists.
    const highStrength = (typeof window.chromasmithRawNrHighStrength === 'number') ? window.chromasmithRawNrHighStrength : 70;
    let buf;
    try {
      const req = mode === 'lut'
        ? { mode, lutKey, autoLens, demosaicAlgo, lensOverride, lensOverrideFocal, highStrength, token }
        : { mode, autoLens, demosaicAlgo, lensOverride, lensOverrideFocal, highStrength, token };
      buf = await framedInvoke('denoise_raw_high', req, bytes);
    } finally {
      if (unlisten) unlisten();
    }
    // Same 20-byte header + RGBA8-or-raw-u16 body shape as decode_raw_v2/refine() — see
    // NativeLibRawShim.refine() above for the reference implementation this mirrors.
    const head = new Uint32Array(buf, 0, 5);
    const w = head[0], h = head[1];
    const usedLut = head[3] === 1;
    const effMode = (mode === 'lut' && !usedLut) ? 'linear16' : mode;
    let rgba2;
    if (effMode === 'linear16') {
      const rgb2 = new Uint16Array(buf, 20);
      rgba2 = new Uint8ClampedArray(w * h * 4);
      for (let i = 0, j = 0; i < w * h; i++) {
        const s = i * 3;
        rgba2[j++] = rgb2[s] >> 8; rgba2[j++] = rgb2[s + 1] >> 8; rgba2[j++] = rgb2[s + 2] >> 8; rgba2[j++] = 255;
      }
    } else {
      rgba2 = new Uint8ClampedArray(buf, 20);
    }
    if (!targetItem) {
      // Interactive path only: the user could have switched photos while this was in flight.
      const stillCurrent = (typeof fxImages !== 'undefined') && fxImages.some((x) => x.img === c);
      if (!stillCurrent) return { applied: false, reason: 'photo changed during denoise' };
    }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').putImageData(new ImageData(rgba2, w, h), 0, 0);
    if (!targetItem) {
      // Live-preview repaint — skipped for an explicit-item (export) call so a mid-batch
      // denoise never flashes an unrelated photo's canvas into the visible editor.
      if (typeof updateWork === 'function') updateWork();
      if (typeof renderPreview === 'function') renderPreview();
    }
    return { applied: true };
  };
  window.chromasmithCancelDenoiseHigh = function (token) {
    if (token) invoke('cancel_denoise_high', { token }).catch((e) => console.error('cancel_denoise_high', e));
  };

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
  // Photo menu — same actions as the Library's right-click menu / X-P-U culling keys, just
  // reachable from the menu bar. fxToggleFlag/fxResetAll/geomRotate/geomFlip are chromasmith-
  // 22.html globals; the copy/paste-edit pair lives in library-ui.js (Library-only, since it
  // needs the sidecar + clipboard state that only exists there).
  wire('menu-reject', () => typeof fxToggleFlag === 'function' && fxToggleFlag('Red'));
  wire('menu-pick', () => typeof fxToggleFlag === 'function' && fxToggleFlag('Green'));
  wire('menu-clear-flag', () => typeof fxToggleFlag === 'function' && fxToggleFlag(''));
  wire('menu-reset-edit', () => typeof fxResetAll === 'function' && fxResetAll());
  wire('menu-rotate-left', () => typeof geomRotate === 'function' && geomRotate(-90));
  wire('menu-rotate-right', () => typeof geomRotate === 'function' && geomRotate(90));
  wire('menu-flip-h', () => typeof geomFlip === 'function' && geomFlip('h'));
  wire('menu-flip-v', () => typeof geomFlip === 'function' && geomFlip('v'));
  wire('menu-copy-edit', () => typeof window.chromasmithMenuCopyEdit === 'function' && window.chromasmithMenuCopyEdit());
  wire('menu-paste-edit', () => typeof window.chromasmithMenuPasteEdit === 'function' && window.chromasmithMenuPasteEdit());
  // View menu
  wire('menu-zoom-in', () => typeof zoomBy === 'function' && zoomBy(1.25));
  wire('menu-zoom-out', () => typeof zoomBy === 'function' && zoomBy(0.8));
  wire('menu-zoom-fit', () => typeof _resetZoom === 'function' && _resetZoom(true));
  wire('menu-zoom-100', () => typeof zoomSet === 'function' && zoomSet(1));
  wire('menu-split', () => typeof toggleSplit === 'function' && toggleSplit());
  wire('menu-histogram', () => typeof toggleHist === 'function' && toggleHist());
  wire('menu-expand-library', () => typeof window.chromasmithToggleExpandedView === 'function' && window.chromasmithToggleExpandedView());
  // Help menu
  wire('menu-shortcuts', () => typeof window.chromasmithShowShortcuts === 'function' && window.chromasmithShowShortcuts());
  wire('menu-guide', () => typeof switchTab === 'function' && switchTab('guide'));
  wire('menu-whatsnew', () => typeof window.chromasmithShowWhatsNew === 'function' && window.chromasmithShowWhatsNew());
  // Cmd+, / Chromasmith > Settings… — no dedicated preferences window exists yet, so this opens
  // the same About panel the header info button does (build/diagnostics today; the natural home
  // for real settings later). See main.rs's own comment on this menu item for why.
  wire('menu-settings', () => typeof window.csAbout === 'function' && window.csAbout());
  // File > Open Recent — handled directly in library-ui.js (next to its own menu-library
  // listener), not here: it needs the SAME recents dropdown that file's Recent button builds,
  // which is Library-internal state this file has no access to.
  // Surfaces download_url_native's (main.rs) byte-count/content-type/hex-header diagnostic
  // for Google Photos RAW downloads into the app's OWN log panel — it previously only went to
  // eprintln!, which is invisible in the packaged .app (no attached terminal), so a "DNG won't
  // load" report had no way to tell a genuine rawler gap from Google returning bad/re-encoded
  // bytes without the reporter running `cargo run`/`tauri dev` themselves.
  listen('gphotos-download-diag', (e) => { if (typeof log === 'function') log(e.payload, 'info'); });
  // Same reasoning for the Save-to-Lightroom metadata splice: its outcome must be visible in
  // the in-app log, not just stderr (a silent splice-skip cost a day of debugging).
  listen('lr-save-diag', (e) => { if (typeof log === 'function') log(e.payload, /NO metadata|could not read/.test(e.payload||'') ? 'warn' : 'info'); });

  // ── Native-feeling right-click: no bare WKWebView context menu on chrome, but text
  // fields/log keep normal editing (Cut/Copy/Paste) behaviour. ─────────────────────
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    const editable = t.closest && t.closest('input,textarea,[contenteditable],#log-area');
    if (!editable) e.preventDefault();
  });

  // ── Streaming save for large video exports (V3) — desktop-only escape hatch from the
  // browser build's in-memory BufferTarget size cap (see CLAUDE.md §12 / the video plan's B5).
  // mediabunny's StreamTarget takes a plain WritableStream; each write(chunk) call forwards
  // {handle,pos} + the chunk bytes over the SAME framed raw-body protocol every other binary
  // command here uses (framedInvoke, defined above). `chunked:true` lets mediabunny coalesce
  // small writes into ~4MB chunks itself, so this file doesn't need its own backpressure pump.
  // ⚠️ `pos` is NOT append-only — stream_write (main.rs) seeks there before every write, because
  // mediabunny's mp4-muxer patches box sizes by seeking BACKWARD once final sizes are known.
  // chromasmith-22.html gates on `typeof window.chromasmithMakeVideoStreamTarget==='function'`
  // and falls back to mediabunny's own BufferTarget when this file isn't loaded (the browser/
  // Pages build), so the video export path stays platform-agnostic there — same pattern as
  // getLibRaw()/chromasmithDenoiseHigh above.
  window.chromasmithMakeVideoStreamTarget = async (MB, filename) => {
    const { handle } = await invoke('stream_open', { filename });
    const writable = new WritableStream({
      async write(chunk) {
        await framedInvoke('stream_write', { handle, pos: chunk.position }, chunk.data);
      },
    });
    const target = new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 });
    target._chromasmithHandle = handle; // stashed for chromasmithCloseVideoStream below
    return target;
  };
  // commit:true renames the .part file to its final name; commit:false (cancel) deletes it —
  // see stream_close's own doc comment. Always call this after output.finalize()/output.cancel()
  // on a stream made above, or the .part file (and its open handle server-side) never gets closed.
  window.chromasmithCloseVideoStream = (target, commit) =>
    invoke('stream_close', { handle: target._chromasmithHandle, commit });
})();
