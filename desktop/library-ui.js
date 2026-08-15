// Chromasmith Library view: local folder browser with cached thumbnails,
// alongside (not replacing) the Google Photos integration — purely for finding/culling/rating
// RAWs on disk before editing. Native-only (arbitrary filesystem folder browsing isn't a thing
// in a sandboxed browser); injected only into the Tauri build, gated on window.__TAURI__, so
// this file is a safe no-op anywhere else. chromasmith-22.html is never touched.
(function () {
  // ?libtest=1 — browser-only visual test harness. The Library is native-gated, which meant NO
  // pre-ship way to SEE a layout change: every check ran in a plain browser where this file
  // no-ops, and layout bugs (the "sidebar missing" regression) survived to the packaged app.
  // The flag swaps in tiny mocks for the handful of Tauri commands the Library needs so the
  // real DOM/CSS renders and can be screenshotted against the wireframes. Production is
  // untouched: the flag only exists via URL and the Tauri path never evaluates the mocks.
  const LIBTEST = !window.__TAURI__ && /[?&]libtest=1/.test(location.search);
  if (!window.__TAURI__ && !LIBTEST) return;
  const invoke = LIBTEST ? libtestInvoke : window.__TAURI__.core.invoke;
  // Virtual-copy state for the harness, so the version rows in the context menu are reachable
  // without a real sidecar on disk.
  let ltVersions = [], ltActive = 0;
  function libtestInvoke(cmd, args) {
    const A = args || {};
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XBhAAAAABJRU5ErkJggg==';
    const png = Uint8Array.from(atob(px), (c) => c.charCodeAt(0));
    switch (cmd) {
      case 'list_dir': {
        const dir = String(A.path || '/test');
        if (/Folders only/.test(dir)) return Promise.resolve([]);
        const out = [];
        // ?libn=N synthesises a large folder. 18 is enough to eyeball layout, but grid cost is a
        // question about 500-5000 files and cannot be answered at 18 — see the virtualisation
        // budget in test/perf_bench.mjs.
        const N = Math.max(1, parseInt((/[?&]libn=(\d+)/.exec(location.search) || [])[1] || '18', 10));
        for (let i = 1; i <= N; i++) out.push({ path: `${dir}/IMG_${1000 + i}.RW2`, name: `IMG_${1000 + i}.RW2`, is_dir: false, is_image: true, kind: 'raw', ext: 'rw2', mtime: 1700000000 + i, size: 1000 + i });
        out.push({ path: `${dir}/sub`, name: 'sub', is_dir: true, is_image: false, kind: '', ext: '', mtime: 0, size: 0 });
        return Promise.resolve(out);
      }
      case 'get_thumbnail': return Promise.resolve(png.buffer);
      case 'read_file_bytes': return Promise.resolve(png.buffer);
      case 'get_sidecar': return Promise.resolve({ rating: 0, label: '', favorite: false, edited: false, recipe: '', versions: ltVersions, active: ltActive });
      case 'sidecar_add_version': {
        if (!ltVersions.length) ltVersions.push({ name: 'Original', recipe: 'R0' });
        ltVersions.push({ name: A.name || 'Copy ' + ltVersions.length, recipe: 'R' + ltVersions.length });
        ltActive = ltVersions.length - 1;
        return Promise.resolve({ rating: 0, label: '', favorite: false, edited: true, recipe: 'R', versions: ltVersions, active: ltActive });
      }
      case 'sidecar_set_active_version': { ltActive = A.index; return Promise.resolve({ rating: 0, label: '', favorite: false, edited: true, recipe: 'R', versions: ltVersions, active: ltActive }); }
      case 'sidecar_delete_version': {
        ltVersions.splice(A.index, 1);
        if (ltVersions.length <= 1) { ltVersions.length = 0; ltActive = 0; } else if (ltActive >= ltVersions.length) ltActive = ltVersions.length - 1;
        return Promise.resolve({ rating: 0, label: '', favorite: false, edited: true, recipe: 'R', versions: ltVersions, active: ltActive });
      }
      case 'set_sidecar': return Promise.resolve();
      case 'get_meta': return Promise.resolve({ camera: 'DC-S9', lens: 'LUMIX S 18-40', iso: 200, shutter: '1/250', aperture: 'f/5.6', focal_len: '28mm', date: '2026-07-20' });
      case 'collection_counts': return Promise.resolve({ recents: 4, favorites: 2, edited: 3, exported: 1, flagged: 0, rejected: 0, duplicates: 2, gphotos: 1 });
      case 'phash_batch': {
        // Fake hashes: make IMG_1001/1002 a duplicate pair (Hamming distance 1), everything
        // else spread out (distinct low bits per index), so the Duplicates cluster UI is
        // exercisable in the harness.
        const paths = A.paths || [];
        const BASE = BigInt('0x1234567800000000'), MUL = BigInt('0x9e3779b97f4a7c15'), MASK = BigInt('0xffffffffffffffff');
        return Promise.resolve(paths.map((p, i) => {
          if (/IMG_1001\./.test(p)) return [p, BASE.toString(16).padStart(16, '0')];
          if (/IMG_1002\./.test(p)) return [p, (BASE ^ 1n).toString(16).padStart(16, '0')]; // 1 bit different (Hamming distance 1)
          // XOR by a large odd multiple of the index — spreads hashes across many bit
          // positions (unlike a plain BASE+i, which mostly toggles low bits and can
          // accidentally land every photo in the same cluster via transitive Hamming chains).
          return [p, ((BASE ^ (BigInt(i) * MUL)) & MASK).toString(16).padStart(16, '0')];
        }));
      }
      case 'registry_set_cmd': return Promise.resolve();
      case 'list_volumes': return Promise.resolve([
        { name: 'LUMIX', path: '/Volumes/LUMIX', has_dcim: true, total_bytes: 128e9, free_bytes: 71e9 },
        { name: 'Backup T7', path: '/Volumes/Backup T7', has_dcim: false, total_bytes: 2e12, free_bytes: 9e11 },
      ]);
      case 'scan_card': {
        // A realistic mix: two shoot days, a video, and three already-imported duplicates, so
        // every state the panel can show is reachable in the harness.
        const out = [];
        for (let i = 1; i <= 24; i++) out.push({
          path: `/Volumes/LUMIX/DCIM/100LUMIX/P10${(6500 + i)}.RW2`, name: `P10${6500 + i}.RW2`,
          size: 25e6 + i * 1e5, kind: 'raw', date: i > 14 ? '2026-08-14' : '2026-08-13', duplicate: i <= 3,
        });
        out.push({ path: '/Volumes/LUMIX/PRIVATE/M4ROOT/C0001.MP4', name: 'C0001.MP4', size: 810e6, kind: 'video', date: '2026-08-14', duplicate: false });
        return Promise.resolve(out);
      }
      case 'ingest_copy': return new Promise((res) => setTimeout(() => res({ copied: 22, skipped: 3, failed: [], dest_root: A.options.destRoot, bytes: 1.4e9 }), 900));
      case 'eject_volume': return Promise.resolve();
      case 'plugin:dialog|open': return Promise.resolve('/test/Pictures/2026');
      case 'lr_downloads_dir': return Promise.resolve('/test/Lightroom Download');
      case 'gphotos_downloads_dir': return Promise.resolve('/test/Google Photos Download');
      case 'get_lr_thumb': return Promise.reject(new Error('miss')); // always a miss → exercises the network+save path
      case 'save_lr_thumb': return Promise.resolve();
      case 'list_collection': case 'list_exported': return Promise.resolve([]);
      case 'get_export_history': return Promise.resolve([]);
      default: return Promise.reject(new Error('libtest: no mock for ' + cmd));
    }
  }
  if (LIBTEST) {
    document.body.classList.add('deskx');
    // Minimal event shim (menu-library listener registration).
    window.__TAURI__ = { core: { invoke: libtestInvoke }, event: { listen: () => Promise.resolve(() => {}) } };
    // Cloud mock: disconnected by default; window.libtestLrConnect() flips to a connected
    // state with fake albums/assets so every Cloud UI state is screenshottable.
    let ltConnected = false;
    const ltAlbums = [{ id: 'al1', name: 'Dogs 2026' }, { id: 'al2', name: 'Travel' }, { id: 'al3', name: 'Film scans' }];
    const ltAssets = (n) => Array.from({ length: n }, (_, i) => ({ id: 'as' + i, name: `__TM${4700 + i}.RW2`, captured: '2026-07-2' + (i % 9), meta: { make: 'Panasonic', model: 'DC-S9', lens: 'LUMIX S 18-40', iso: 'ISO 200', aperture: 'f/5.6', shutter: '1/250', focalLen: '28mm', date: '2026-07-2' + (i % 9) } }));
    window.lrCloud = {
      connected: () => ltConnected,
      connect: async () => { ltConnected = !ltConnected; },
      askClientId: async () => 'test-client',
      albums: async () => ltAlbums,
      assets: async () => ltAssets(9),
      thumbBlob: async () => new Blob([png], { type: 'image/png' }),
      importAsset: async () => { await new Promise((r) => setTimeout(r, 800)); },
    };
    window.libtestLrConnect = () => { ltConnected = true; window.dispatchEvent(new CustomEvent('lr-cloud-state')); };
  }

  // ── friendlyRawError: maps ugly RAW/DCP decode error strings to short human sentences for
  // toasts. The raw string still goes to log()/console as before — only the toast is friendly.
  // Exposed on window so chromasmith-22.html's own catch sites (which can't see this file's
  // module scope) can reuse the exact same mapping instead of duplicating it.
  function friendlyRawError(msg) {
    const s = String(msg == null ? '' : (msg.message || msg));
    if (/^no decoder: /.test(s)) return 'No decoder available for this file type';
    if (/LUT 'dcp:[^']*' not registered/.test(s)) return 'Camera colour profile not found';
    if (/framed body truncated/i.test(s)) return 'RAW file appears truncated or corrupted';
    if (/RangeError: Offset is outside the bounds of the DataView/i.test(s)) return 'Corrupt or truncated file data';
    if (/TypeError: Failed to fetch/i.test(s)) return 'Network error — couldn\'t load required file';
    return s;
  }
  window.friendlyRawError = friendlyRawError;

  // ── decoded-image cache: reopening a photo you've already viewed this session skips the
  // full decode (RW2: PPG demosaic + DCP LUT bake, several seconds) entirely — the SAME
  // fxImages[0] entry (its canvas, already the finished decode) is reinstalled directly via
  // chromasmith-22.html's installFXImages(). Keyed by path only (not mtime/size — a file
  // changing on disk mid-session while it's cached is an edge case, not worth the extra
  // invoke() per open to detect). Budgeted by estimated byte size (canvas w*h*4), LRU-evicted
  // by last-access time; the currently-open photo is never evicted (it's still on screen).
  // "clear if the app gets too slow" per the user's own suggestion → chromasmithClearImageCache. ──
  // 1GB was far too small in practice: a single decoded 6000x4000 RW2 canvas is
  // 6000*4000*4 = ~96MB, so 1GB held only ~10 photos before evicting — on a typical batch
  // (dozens of photos) almost every filmstrip click was a full re-decode (several seconds,
  // per the NR-fix commit) even for a photo viewed moments earlier. Scale the budget with
  // available RAM (same navigator.deviceMemory signal isMemoryConstrained() already uses),
  // capped so it can't starve the rest of the app on genuinely low-memory machines.
  const IMG_CACHE_BUDGET = (() => {
    const gb = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 8;
    return Math.min(Math.max(gb, 4), 16) * 0.375 * 1024 * 1024 * 1024; // ~1.5GB@4GB … ~6GB@16GB
  })();
  const imgCache = new Map(); // path -> {entry, size, ts}
  // The editor's stroke icon set (chromasmith-22.html ICONS/icon()). Emoji render differently on
  // every OS and never match a stroke weight, which is exactly why they were pulled out of the
  // editor chrome — the Library was still using them and looked like a different application.
  // Module scope: used by the header markup AND by renderGrid's per-card badges.
  const ic = (n, sz) => (typeof window.icon === 'function' ? window.icon(n, sz || 16) : '');
  function imgCacheSize() { let s = 0; imgCache.forEach((v) => { s += v.size; }); return s; }
  function imgCacheEvict() {
    if (imgCacheSize() <= IMG_CACHE_BUDGET) return;
    const entries = Array.from(imgCache.entries())
      .filter(([p]) => p !== state.openedPath)
      .sort((a, b) => a[1].ts - b[1].ts); // oldest-accessed first
    for (const [p] of entries) {
      imgCache.delete(p);
      if (imgCacheSize() <= IMG_CACHE_BUDGET) break;
    }
  }
  function imgCacheStore(path, entry, loadKey) {
    const c = entry.img;
    const size = (c && c.width && c.height) ? c.width * c.height * 4 : 32 * 1024 * 1024; // heuristic fallback
    imgCache.set(path, { entry, size, ts: Date.now(), loadKey });
    imgCacheEvict();
  }
  window.chromasmithClearImageCache = () => {
    const n = imgCache.size, mb = Math.round(imgCacheSize() / (1024 * 1024));
    imgCache.clear();
    if (typeof toast === 'function') toast(`Cleared ${n} cached photo(s) (${mb} MB)`, true);
    if (typeof log === 'function') log(`Image cache cleared: ${n} photo(s), ${mb} MB`, 'info');
  };

  const LS_ROOT = 'chromasmith_lib_root';
  const state = {
    root: LIBTEST ? '/test/Photos' : (localStorage.getItem(LS_ROOT) || ''),
    expanded: new Set(),
    currentFolder: '',
    entries: [],           // image entries in the currently-viewed folder
    sidecars: new Map(),   // path -> {rating,label,edited,recipe} (cached client-side)
    meta: new Map(),       // path -> {camera,lens,date,iso}
    dupeClusters: new Map(), // path -> clusterId (only present for clusters of size > 1)
    dupeClusterSizes: new Map(), // clusterId -> size
    syncedPaths: new Set(),  // paths known-synced to Google Photos (gphotos registry, folder-local cache)
    typeFilter: 'all',     // 'all' | 'raw' | 'jpeg' | 'png' | 'tiff'
    cameraFilter: 'all',
    lensFilter: 'all',
    isoFilter: 'all',
    dupeFilter: 'all',     // 'all' | 'dupes'
    syncedFilter: 'all',   // 'all' | 'synced' | 'notsynced'
    tagFilter: 'all',      // 'all' | 'red' | 'green' | 'edited' | 'noedited'
    search: '',
    open: false,
    expanded_view: false,  // full-window library grid (vs the docked 340px strip)
    openedPath: '',        // path of the photo currently loaded into the editor FROM the library
    openedPaths: [],       // paths of ALL photos currently loaded when opened as a multi-photo
                            // batch (openedPath stays '' for a batch — see the three call sites
                            // that clear it). Lets chromasmithRecordExport still log an export-
                            // history entry per photo instead of silently recording nothing.
    selected: new Set(),   // multi-selected paths (shift/cmd-click), for batch rate/flag/open
    source: 'folder',      // 'folder' | a smart collection ('recents'/'favorites'/'edited'/'exported'/'flagged'/'rejected') | 'lr' (Lightroom cloud album)
    viewMode: localStorage.getItem('chromasmith_lib_view') || 'grid', // 'grid' | 'list'
    thumbSize: parseInt(localStorage.getItem('chromasmith_lib_thumbsize') || '140', 10),
    sortBy: localStorage.getItem('chromasmith_lib_sort') || 'name',       // name|mtime|iso|shutter|aperture|focal|edited
    sortDir: localStorage.getItem('chromasmith_lib_sortdir') || 'asc',    // 'asc' | 'desc'
    metaDisplay: localStorage.getItem('chromasmith_lib_metadisp') || 'off', // 'off'|'hover'|'always'
    showTitle: localStorage.getItem('chromasmith_lib_showtitle') !== '0',
  };

  // ── styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  // RapidRAW-style DOCKED left panel (not a modal overlay): library and editor are visible
  // and usable at the same time.
  //
  // STRUCTURAL FIX (4th reported overlap regression): this used to be position:fixed, pushed
  // aside by setting body.style.paddingLeft to a JS-computed px value kept "in sync" with the
  // overlay's own rendered width across three separate modes (default/deskx-filmstrip/full) —
  // two independent numbers that had to agree by construction, and every previous "fix" was
  // another attempt to keep those two numbers in sync (a ResizeObserver, then a synchronous
  // derive-from-state function). Any path that changed one without the other overlapped the
  // editor. Eliminated the second number entirely: initDock() below moves this overlay to be
  // the FIRST CHILD of .fx-layout — chromasmith-22.html's own existing CSS Grid for the
  // preview/panel/rail row (body.deskx .fx-layout{grid-template-columns:...}) now reserves a
  // LEADING column for it, sized by the existing body.lib-docked/body.deskx classes the JS
  // already toggles (see chromasmith-22.html's own CSS, which owns those two rules — this file
  // only supplies the dock's own content and its `order:0` default DOM position, which sorts
  // it ahead of the preview(order:1)/panel(order:2)/rail(order:3) siblings automatically). A
  // reserved grid TRACK can never overlap another track by construction — there is no padding
  // value left to keep in sync, and nothing left to drift. Only the FULL (expanded_view)
  // takeover mode still uses position:fixed below — that's a deliberate full-screen
  // replacement of the editor, not a coexistence case, so overlap can't apply there either.
  const DOCK_W = 356;
  style.textContent = `
    /* overflow:hidden — nothing (grid blowout, an oversized top bar) can ever paint past this
       column into the editor preview, whatever mode/width it's in. */
    #lib-overlay{position:fixed;top:0;left:0;bottom:0;width:${DOCK_W}px;z-index:4000;overflow:hidden;
      background:var(--bg);display:none;border-right:1px solid var(--bdr);
      box-shadow:6px 0 20px -8px rgba(0,0,0,.5);
      grid-template-rows:auto auto auto minmax(120px,26%) 1fr 28px;color:var(--txt);
      font-family:var(--sans);transition:width .15s ease;}
    #lib-overlay.on{display:grid}
    /* 6 children = 6 tracks (top, filters, viewbar, side, main, bottom) — and each child is
       PINNED to its row so a future DOM insertion can never silently shift everything again
       (auto-placement has mis-stacked this panel twice). */
    #lib-top{grid-row:1}#lib-filters{grid-row:2}#lib-viewbar{grid-row:3}
    #lib-side{grid-row:4}#lib-main{grid-row:5}#lib-bottom{grid-row:6}
    /* FULL (expanded) mode: real LEFT SIDEBAR layout (approved Lightroom-in-Library wireframe)
       — #lib-side becomes a 230px left column spanning the filters/viewbar/main rows, instead
       of the old horizontal band squeezed above the grid ("top bar only, no sidebar"). The
       docked 356px filmstrip keeps the vertical stacking below — a left column can't fit there. */
    #lib-overlay.full{width:100vw;grid-template-columns:230px 1fr;grid-template-rows:auto auto auto 1fr 28px}
    #lib-overlay.full #lib-top{grid-column:1/3;grid-row:1}
    #lib-overlay.full #lib-side{grid-column:1;grid-row:2/5;border-right:1px solid var(--bdr);border-top:none;border-bottom:none}
    #lib-overlay.full #lib-filters{grid-column:2;grid-row:2}
    #lib-overlay.full #lib-viewbar{grid-column:2;grid-row:3}
    #lib-overlay.full #lib-main{grid-column:2;grid-row:4}
    #lib-overlay.full #lib-bottom{grid-column:1/3;grid-row:5}
    #lib-overlay.full.tree-collapsed{grid-template-columns:0 1fr;grid-template-rows:auto auto auto 1fr 28px}
    #lib-overlay.full #lib-grid{grid-template-columns:repeat(auto-fill,minmax(var(--lib-thumb,200px),1fr))}
    /* Sidebar collapse. Docked (non-full) mode zeroes the ROW (old vertical layout); full mode
       zeroes the COLUMN (rule above at .full.tree-collapsed — its row template must stay the
       5-row full-mode one: a stale 6-row override here once put #lib-main in the 0 track and
       collapsed the whole photo grid). :not(.full) scoping keeps the two modes from crossing. */
    #lib-overlay.tree-collapsed:not(.full){grid-template-rows:auto auto auto 0 1fr 28px}
    #lib-overlay.tree-collapsed #lib-side{display:none}
    #lib-tree-toggle.on{border-color:var(--acc);color:var(--acc)}
    @keyframes lib-lr-slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
    #lib-lr-chip{display:none;align-items:center;gap:6px;margin-left:auto;font-size:10px;color:var(--ok,#59c98a)}
    #lib-lr-chip .lib-lr-signout{color:var(--mut);cursor:pointer;text-decoration:underline}
    #lib-overlay.lr-mode #lib-lr-chip{display:inline-flex}
    /* deskx docked (non-full): a real grid-column sibling of the preview/panel/rail, placed by
       initDock() as the first child of .fx-layout — see chromasmith-22.html's own
       body.deskx .fx-layout / body.lib-docked rules for the reserved column width. */
    body.deskx #lib-overlay:not(.full){grid-column:1;position:static;top:auto;left:auto;bottom:auto;height:100%}
    body.deskx #lib-overlay.full{position:fixed} /* full takeover: back to covering everything */
    #lib-top{display:flex;align-items:center;gap:8px;padding:34px 12px 6px;-webkit-app-region:drag}
    #lib-top button{-webkit-app-region:no-drag}
    #lib-top .lib-title{font-weight:600;font-size:14px;margin-right:auto}
    /* Single wrapping toolbar row, not a 2-column grid — the "wall of filters" complaint was
       largely this stacking into 3+ visual rows above an otherwise-empty-looking grid. Search
       gets first claim on width (flex-grow); every select shrinks to its content. */
    #lib-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 12px 8px}
    #lib-filters #lib-search{flex:1 1 160px;min-width:120px}
    #lib-filters select{flex:0 1 auto;width:auto;min-width:0}
    /* Filters popover: was 7 wrapping selects in a row (real complaint — see the comment above
       #lib-filters), collapsed to one button + a floating panel. The badge shows how many of
       the 7 aren't at their default "all" value, so it's clear at a glance whether anything is
       filtered without opening the panel. */
    .lib-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px}
    .lib-btn svg{display:block;flex:0 0 auto}
    .lib-btn-icon{width:30px;height:30px;padding:0}
    #lib-filters-btn-wrap{position:relative}
    #lib-filters-badge{display:none;margin-left:5px;background:var(--acc);color:#1a1208;font-size:9px;
      font-weight:700;border-radius:8px;padding:1px 5px;line-height:1.4}
    #lib-filters-badge.on{display:inline-block}
    /* ⚠️ Anchored to the button's RIGHT edge, not its left. The Filters button is the last item
       in a right-aligned row, so a left-anchored popover grew off the side of the window with no
       gap and its contents were clipped. right:0 makes it open leftward from the trigger, which
       keeps it inside the viewport at any window width; max-width stops a long camera/lens name
       pushing it back out again. */
    #lib-filters-pop{display:none;position:absolute;top:calc(100% + 4px);right:0;left:auto;z-index:30;
      flex-direction:column;gap:6px;min-width:190px;max-width:min(280px,calc(100vw - 24px));padding:8px;background:var(--glass-bg);
      -webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);
      border:1px solid var(--bdr);border-radius:8px;box-shadow:var(--lift-2)}
    #lib-filters-pop.on{display:flex}
    #lib-filters-pop select{width:100%}
    #lib-filters-clear{align-self:flex-end;font-size:11px}
    #lib-filter-chips{flex-basis:100%;display:flex;flex-wrap:wrap;gap:5px}
    .lib-chip{display:flex;align-items:center;gap:4px;background:var(--sur2);border:1px solid var(--bdr);
      border-radius:12px;padding:2px 4px 2px 8px;font-size:10px;color:var(--txt)}
    .lib-chip-x{cursor:pointer;opacity:.6;font-size:11px;line-height:1;padding:0 2px}
    .lib-chip-x:hover{opacity:1;color:var(--acc)}
    #lib-side{overflow:auto;padding:8px 12px;border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr)}
    /* Darkroom-style smart collections, above the folder tree in the same #lib-side scroll box. */
    .lib-coll-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;
      font-size:12px;color:var(--txt)}
    .lib-coll-row:hover{background:var(--sur2)}
    .lib-coll-row.on{background:rgba(212,144,58,.14);color:var(--acc)}
    .lib-coll-ic{display:inline-flex;flex-shrink:0;color:inherit}
    .lib-coll-lb{flex:1}
    .lib-coll-count{font-family:var(--mono);font-size:10px;color:var(--mut)}
    .lib-coll-row.on .lib-coll-count{color:var(--acc)}
    .lib-coll-sep{height:1px;background:var(--bdr);margin:8px 2px}
    .lib-coll-heading{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);padding:2px 8px 6px}
    #lib-main{overflow:auto;padding:16px}
    /* List mode's sticky header (#lib-list-head, top:0 below) vs #lib-main's own padding: a
       padded overflow:auto container only masks scrolled-behind content within its padding band
       AT THE SCROLL EXTREMES (scrollTop 0 or max) — at any mid-scroll position that band is just
       regular viewport, showing whatever row currently sits there. Sticky "top:0" is measured
       from the padding EDGE, so the header always sat 16px below the true scrollport edge,
       permanently exposing a 16px strip where scrolled-past thumbnails visibly slid through
       ABOVE the header on every scroll, not just at the top ("images scroll behind/above it").
       Drop #lib-main's top padding whenever the list header is showing so it sits flush with the
       real scroll edge and fully masks everything above it — #lib-list-head's own bottom
       padding/border-bottom already gives the visual gap before the first row, nothing else
       needs to move. (:has() already used elsewhere in this file — same runtime.) */
    #lib-overlay:has(#lib-list-head.on) #lib-main{padding-top:0}
    #lib-bottom{display:flex;align-items:center;gap:14px;padding:0 12px;border-top:1px solid var(--bdr)}
    .lib-btn{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:8px;
      padding:5px 10px;font-size:12px;cursor:pointer}
    .lib-btn:hover{background:var(--bdr)}
    .lib-tree-node{font-size:12px;white-space:nowrap;user-select:none}
    .lib-tree-row{display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:6px;cursor:pointer}
    .lib-tree-row:hover{background:var(--sur2)}
    .lib-tree-row.on{background:var(--bdr)}
    .lib-tree-chev{width:14px;flex:0 0 14px;text-align:center;opacity:.6;font-size:10px}
    .lib-tree-children{margin-left:14px}
    #lib-viewbar{display:flex;align-items:center;gap:8px;padding:0 12px 8px;flex-wrap:wrap}
    #lib-viewbar select,#lib-viewbar input[type=range]{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);
      border-radius:7px;padding:5px 7px;font-size:11px}
    #lib-viewbar .lib-seg{display:flex;border:1px solid var(--bdr);border-radius:7px;overflow:hidden}
    #lib-viewbar .lib-seg button{background:var(--sur2);border:none;color:var(--txt);font-size:11px;padding:5px 9px;cursor:pointer}
    #lib-viewbar .lib-seg button.on{background:var(--acc);color:#000}
    #lib-viewbar .lib-thumbsize{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--mut)}
    #lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--lib-thumb,140px),1fr));gap:16px}
    #lib-grid.lib-dragover{outline:2px dashed var(--acc2);outline-offset:-6px;border-radius:8px}
    .lib-coll-row.lib-coll-dragover{outline:2px dashed var(--acc2);outline-offset:-2px;background:var(--sur2)}
    /* Real table: header row (#lib-list-head) and every .lib-card in list mode share this exact
       column template, so clicking a header lines up with the data underneath it. */
    :root{--lib-list-cols:52px minmax(120px,1fr) 92px 92px 132px 56px 68px 60px 56px 70px 56px 60px}
    #lib-list-head{display:none;position:sticky;top:0;z-index:20;background:var(--bg);
      grid-template-columns:var(--lib-list-cols);gap:10px;padding:4px 8px 6px;
      border-bottom:1px solid var(--bdr);font-size:10px;color:var(--mut);font-family:var(--mono);
      text-transform:uppercase;letter-spacing:.04em}
    #lib-list-head.on{display:grid}
    .lib-lh-cell{cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}
    /* Drag to resize the column; double-click resets it. Sits on the cell's right edge, just
       outside the visible text, with a generous invisible hit-area (the visible line is thin). */
    .lib-col-resize{position:absolute;top:0;bottom:0;right:-6px;width:12px;cursor:col-resize;z-index:2}
    .lib-col-resize:hover{background:linear-gradient(to right,transparent 5px,var(--acc) 5px,var(--acc) 7px,transparent 7px)}
    .lib-lh-cell:hover{color:var(--txt)}
    .lib-lh-cell.lib-lh-thumb,.lib-lh-cell.lib-lh-flags{cursor:default}
    .lib-lh-cell.lib-lh-flags:hover{color:var(--mut)}
    .lib-lh-cell.sorted{color:var(--acc)}
    .lib-lh-cell.sorted::after{content:' ▲';font-size:8px}
    .lib-lh-cell.sorted.desc::after{content:' ▼'}
    #lib-grid.list-view{display:flex;flex-direction:column;gap:2px}
    #lib-grid.list-view .lib-card{display:grid;grid-template-columns:var(--lib-list-cols);align-items:center;gap:10px;padding:4px 8px}
    #lib-grid.list-view .lib-thumb-wrap{width:52px;height:40px;aspect-ratio:auto}
    #lib-grid.list-view .lib-name{padding:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
    #lib-grid.list-view .lib-tagrow{padding:0;display:contents}
    #lib-grid.list-view .lib-edited-badge,#lib-grid.list-view .lib-raw-badge,#lib-grid.list-view .lib-video-badge{position:static;width:16px;height:16px}
    #lib-grid.list-view .lib-col{font-size:10px;color:var(--mut);font-family:var(--mono);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lib-meta-strip{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);color:#fff;
      font-size:9px;font-family:var(--mono);padding:3px 5px;line-height:1.3;
      pointer-events:none;opacity:0}
    .lib-card:hover .lib-meta-strip.hover-mode,.lib-meta-strip.always-mode{opacity:1}
    .lib-thumb-wrap{position:relative}
    .lib-card{background:transparent;border:none;border-radius:8px;overflow:hidden;
      cursor:pointer;position:relative;box-shadow:none;transition:box-shadow .15s ease,transform .1s ease}
    .lib-card:hover{transform:translateY(-1px);box-shadow:0 0 0 1px var(--bdr)}
    .lib-card.sel{box-shadow:0 0 0 2px var(--acc)}
    .lib-card.multi{box-shadow:0 0 0 2px var(--acc2)}
    .lib-card.sel.multi{box-shadow:0 0 0 2px var(--acc),0 0 0 4px var(--acc2)}
    .lib-card.flag-red{box-shadow:0 0 0 2px #e5484d,0 0 14px 1px rgba(229,72,77,.55)}
    .lib-card.flag-green{box-shadow:0 0 0 2px #46a758,0 0 14px 1px rgba(70,167,88,.55)}
    .lib-card.flag-red.sel{box-shadow:0 0 0 1px var(--acc),0 0 0 3px #e5484d,0 0 14px 1px rgba(229,72,77,.55)}
    .lib-card.flag-green.sel{box-shadow:0 0 0 1px var(--acc),0 0 0 3px #46a758,0 0 14px 1px rgba(70,167,88,.55)}
    /* "Canvas" matte, not a center-crop: the cell stays a fixed size for a tidy grid, but the
       photo sits on its own letterbox background at its REAL aspect ratio (object-fit:contain)
       instead of being cropped to fill a square — same treatment as the docked filmstrip. */
    .lib-thumb-wrap{aspect-ratio:1;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .lib-thumb-wrap img{width:100%;height:100%;object-fit:cover;display:block}
    /* Real thumbnails fade in over the skeleton/empty cell instead of popping in the instant
       get_thumbnail resolves — .loaded is added by the thumb pool once the blob URL is set. */
    #lib-grid:not(.list-view) .lib-thumb-wrap img{opacity:0;transition:opacity .15s ease}
    #lib-grid:not(.list-view) .lib-thumb-wrap img.loaded{opacity:1}
    .lib-card .lib-name{font-size:10px;font-family:var(--mono);color:var(--mut);
      padding:4px 6px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lib-tagrow{display:flex;align-items:center;gap:6px;padding:0 6px 6px}
    /* Grid mode: overlaid on the thumbnail itself (not an in-flow footer row) so the card has
       no reserved chrome underneath the image — hidden until hover/on, so an at-rest grid is
       just photos. List mode keeps its own in-flow column cell (styled further down). */
    #lib-grid:not(.list-view) .lib-flags{position:absolute;bottom:4px;right:4px;display:flex;gap:3px;z-index:3;
      background:rgba(0,0,0,.55);border-radius:5px;padding:2px 3px;
      opacity:0;transition:opacity .12s ease}
    /* the chip itself (dark rounded background) is invisible at rest, not just the icons inside
       it — reveal on hover, or keep it revealed if a flag is already selected (hover or not). */
    #lib-grid:not(.list-view) .lib-card:hover .lib-flags,
    #lib-grid:not(.list-view) .lib-flags:has(.lib-flag.on){opacity:1}
    .lib-flags{display:flex;gap:3px}
    .lib-flag{cursor:pointer;font-size:11px;opacity:.55;filter:grayscale(1);transition:opacity .1s ease}
    .lib-flag.on{opacity:1;filter:none}
    .lib-thumb-wrap img.thumb-error{opacity:0}
    .lib-thumb-wrap.thumb-broken::after{content:'⚠';position:absolute;top:50%;left:50%;
      transform:translate(-50%,-50%);color:var(--mut);font-size:16px}
    /* Small corner icon badges, Darkroom-style — no text pills. Edited (orange pen) sits
       top-right; the RAW "R" badge sits top-left so the two never collide. */
    .lib-edited-badge{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;
      background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2}
    .lib-edited-badge svg{width:10px;height:10px}
    .lib-raw-badge{position:absolute;top:4px;left:4px;width:18px;height:18px;border-radius:5px;
      background:rgba(0,0,0,.55);color:#cfcfd6;font-size:9px;font-weight:700;letter-spacing:.02em;
      display:flex;align-items:center;justify-content:center;z-index:2}
    /* Video: same corner-badge slot the RAW "R" chip uses (mutually exclusive — a file is one
       kind or the other) plus a dark placeholder fill + centered play glyph in the thumbnail
       itself, since get_thumbnail has no still-frame decoder for video (see library.rs). */
    .lib-video-badge{position:absolute;top:4px;left:4px;min-width:18px;height:18px;padding:0 5px;border-radius:5px;
      background:rgba(0,0,0,.6);color:#e6e6ea;font-size:10px;font-variant-numeric:tabular-nums;
      display:flex;align-items:center;justify-content:center;gap:3px;z-index:2}
    .lib-video-badge svg{width:10px;height:10px;flex:0 0 auto}
    .lib-thumb-video{background:linear-gradient(135deg,var(--sur2),var(--sur))}
    .lib-thumb-video:not(:has(img.loaded))::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:var(--mut);font-size:20px;opacity:.5;z-index:1}
    /* A poster is decoded in the webview now, so show it; the gradient below is just the
       backdrop while it loads, and remains visible if the decode fails. */
    .lib-thumb-video img{display:block}
    /* Dupe chip: bottom-left (RAW already owns top-left, Edited owns top-right). Synced badge:
       bottom-right, mirroring it. Both passive-only indicators, no click handler. */
    .lib-dupe-badge{position:absolute;bottom:4px;left:4px;min-width:18px;height:18px;padding:0 4px;
      border-radius:9px;background:rgba(0,0,0,.6);color:#e8c15a;font-size:9px;font-weight:700;
      display:flex;align-items:center;justify-content:center;z-index:2}
    .lib-synced-badge{position:absolute;bottom:4px;right:4px;width:18px;height:18px;border-radius:50%;
      background:rgba(0,0,0,.6);color:#7ec4e8;font-size:10px;display:flex;align-items:center;
      justify-content:center;z-index:2}
    #lib-grid.list-view .lib-dupe-badge,#lib-grid.list-view .lib-synced-badge{position:static;width:16px;height:16px}
    /* C1: Compare-pair mode — two panes side by side, sharing one zoom/pan via CSS transform
       on each pane's canvas (re-rendered only on photo/source change, not on every pointermove
       — see renderComparePane's comment). */
    #lib-compare{display:none;height:100%;flex-direction:column;gap:8px}
    #lib-compare.on{display:flex}
    #lib-main:has(#lib-compare.on) #lib-grid{display:none}
    #lib-compare-panes{display:flex;gap:8px;flex:1;min-height:0}
    .lib-cmp-pane{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--sur2);
      border:1px solid var(--bdr);border-radius:8px;overflow:hidden}
    .lib-cmp-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--bdr);
      font-size:11px;flex-wrap:wrap}
    .lib-cmp-head select{background:var(--sur1);border:1px solid var(--bdr);color:var(--txt);
      border-radius:6px;padding:3px 6px;font-size:10.5px;max-width:120px}
    .lib-cmp-canvas-wrap{flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000}
    .lib-cmp-canvas-wrap canvas{max-width:100%;max-height:100%;transform-origin:center center}
    .lib-cmp-chrome{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--bdr);font-size:12px}
    .lib-cmp-chrome .lib-flag{width:20px;height:20px;display:flex;align-items:center;justify-content:center;
      border-radius:5px;cursor:pointer;opacity:.6}
    .lib-cmp-chrome .lib-flag.on,.lib-cmp-chrome .lib-flag:hover{opacity:1;background:var(--bdr)}
    #lib-compare-bar{display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:11px;color:var(--mut)}
    #lib-compare-bar button{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);
      border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer}
    #lib-empty{color:var(--mut);font-size:12px;padding:30px 10px;text-align:center}
    .lib-skel{pointer-events:none}
    .lib-skel .lib-thumb-wrap{background:linear-gradient(100deg,var(--sur) 30%,var(--sur2) 50%,var(--sur) 70%);
      background-size:200% 100%;animation:lib-shimmer 1.4s ease-in-out infinite}
    @keyframes lib-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    #lib-filters select,#lib-filters input{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);
      border-radius:7px;padding:5px 8px;font-size:11px;min-width:0}
    /* Provisional preview must fully REPLACE the previous photo, not float over it: it fills
       the whole zoom-wrap with an opaque black backing and hides the canvas underneath —
       otherwise a portrait provisional over a landscape canvas left slices of the OLD photo
       visible around it ("photos load on top of each other"). */
    #lib-provisional{position:absolute;inset:0;width:100%;height:100%;background:#000;
      object-fit:contain;pointer-events:none;z-index:50;display:none}
    #lib-provisional.on{display:block}
    body.lib-provisional-on #fx-canvas,body.lib-provisional-on #fx-canvas-orig{visibility:hidden}
    /* deskx (Darkroom shell): the docked panel becomes a 120px thumbnail FILMSTRIP — pure
       thumbnails, single column, no filters/tree/name chrome (all of that lives in the
       full-window grid, G / ⛶). .full keeps its own 100vw rules and overrides these. */
    /* Definite height, not content-driven: #lib-overlay sits inside .fx-layout{align-items:start}
       as a grid item, so without this its height grows with the filmstrip's own content — the
       "auto 1fr" row split never resolves, #lib-main{overflow:auto} has nothing to overflow
       against, and everything below the fold is simply unreachable ("can't scroll the sidebar").
       44px = the fixed deskbar height (see body.deskx #lib-overlay{top:44px} below). */
    body.deskx #lib-overlay:not(.full){width:120px;height:calc(100vh - 44px);grid-template-rows:auto 1fr}
    /* the filmstrip hides filters/viewbar/side/bottom, so re-pin the two visible children */
    body.deskx #lib-overlay:not(.full) #lib-top{grid-row:1}
    body.deskx #lib-overlay:not(.full) #lib-main{grid-row:2}
    body.deskx #lib-overlay:not(.full) #lib-filters,body.deskx #lib-overlay:not(.full) #lib-side,
    body.deskx #lib-overlay:not(.full) #lib-bottom,body.deskx #lib-overlay:not(.full) #lib-viewbar{display:none}
    body.deskx #lib-overlay #lib-top{padding:8px 8px 6px;-webkit-app-region:no-drag} /* strip starts below the deskbar — no traffic-light clearance needed */
    body.deskx #lib-overlay:not(.full) #lib-top{padding:8px 6px 6px;gap:4px;flex-wrap:wrap}
    body.deskx #lib-overlay:not(.full) #lib-top .lib-btn{padding:5px 7px}
    body.deskx #lib-overlay:not(.full) #lib-top .lib-title{display:none}
    /* The tree toggle only means anything in full mode (the filmstrip already force-hides
       #lib-side below) — its text label doesn't fit the 120px filmstrip's icon-only top bar. */
    body.deskx #lib-overlay:not(.full) #lib-tree-toggle{display:none}
    body.deskx #lib-overlay:not(.full) #lib-main{padding:10px}
    /* minmax(0,1fr), not 1fr — a bare 1fr track never shrinks below its content's min-content
       size, so a wide thumbnail image blew the grid (and the whole 120px column) out past the
       editor preview it sits in front of ("images covering the editor"). min-width:0 on the
       card is the matching fix for the flex/grid item itself. */
    body.deskx #lib-overlay:not(.full) #lib-grid{grid-template-columns:minmax(0,1fr);gap:12px}
    body.deskx #lib-overlay:not(.full) .lib-card{min-width:0}
    body.deskx #lib-overlay:not(.full) .lib-card .lib-name,
    body.deskx #lib-overlay:not(.full) .lib-tagrow{display:none}
    /* Lightroom-style filmstrip cells: the photo keeps its REAL aspect ratio (no square
       crop) inside a bordered cell. object-fit:contain + auto height so portrait frames are
       tall and landscape frames are short, like Lightroom's filmstrip. */
    body.deskx #lib-overlay:not(.full) .lib-thumb-wrap{aspect-ratio:auto;height:auto;min-height:40px}
    body.deskx #lib-overlay:not(.full) .lib-thumb-wrap img{width:100%;height:auto;object-fit:contain}
    body.deskx #lib-overlay:not(.full) .lib-card{border:none;border-radius:6px}
    /* the fixed 44px deskbar sits above everything; keep the strip below it */
    body.deskx #lib-overlay{top:44px;z-index:2500}
    body.deskx #lib-overlay.full{top:44px}
  `;
  document.head.appendChild(style);

  // ── DOM scaffold ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'lib-overlay';
  overlay.innerHTML = `
    <div id="lib-top">
      <span class="lib-title">Library</span>
      <button class="lib-btn" id="lib-tree-toggle" title="Show/hide the sidebar (collections, cloud sources, folder tree)">${ic('log',15)}<span>Sidebar</span></button>
      <button class="lib-btn lib-btn-icon" id="lib-pick" title="Choose root folder">${ic('library',17)}</button>
      <button class="lib-btn lib-btn-icon" id="lib-gphotos" title="Import from Google Photos">${ic('cloud',17)}</button>
      <button class="lib-btn lib-btn-icon" id="lib-recent" title="Recent folders &amp; the Google Photos Download cache">${ic('history',17)}</button>
      <button class="lib-btn lib-btn-icon" id="lib-expand" title="Full-window view — G">${ic('fit',17)}</button>
    </div>
    <div id="lib-filters">
      <input id="lib-search" placeholder="Search filename…" />
      <select id="lib-source" title="Photo source">
        <option value="folder">This folder</option>
        <option value="edited">All Edited</option>
      </select>
      <div id="lib-filters-btn-wrap">
        <button class="lib-btn" id="lib-filters-btn" title="Filter by type, camera, lens, ISO, duplicates, sync status or tag/rating">Filters<span id="lib-filters-badge"></span></button>
        <div id="lib-filters-pop">
          <select id="lib-type-filter" title="Filter by file type">
            <option value="all">All types</option>
            <option value="raw">RAW</option><option value="jpeg">JPEG</option>
            <option value="png">PNG</option><option value="tiff">TIFF</option>
            <option value="video">Video</option>
          </select>
          <select id="lib-camera-filter" title="Filter by camera"><option value="all">All cameras</option></select>
          <select id="lib-lens-filter" title="Filter by lens"><option value="all">All lenses</option></select>
          <select id="lib-iso-filter" title="Filter by ISO"><option value="all">All ISOs</option></select>
          <select id="lib-dupe-filter" title="Filter by duplicate status">
            <option value="all">All photos</option>
            <option value="dupes">Duplicates only</option>
          </select>
          <select id="lib-synced-filter" title="Filter by Google Photos sync status">
            <option value="all">All photos</option>
            <option value="synced">Synced to Google Photos</option>
            <option value="notsynced">Not synced</option>
          </select>
          <select id="lib-tag-filter" title="Filter by tag">
            <option value="all">All tags</option>
            <option value="red">Rejected (X)</option>
            <option value="green">Picked (flag)</option>
            <option value="edited">Edited</option>
            <option value="noedited">Not edited</option>
            <option value="favorite">Favorites</option>
          </select>
          <button class="lib-btn" id="lib-filters-clear">Clear all</button>
        </div>
      </div>
      <div id="lib-filter-chips"></div>
    </div>
    <div id="lib-viewbar">
      <div class="lib-seg" id="lib-viewmode-seg">
        <button data-v="grid" title="Grid view">▦</button>
        <button data-v="list" title="List view">${ic('log',15)}</button>
        <button data-v="compare" title="Compare two photos/looks side by side — C">⇹</button>
      </div>
      <select id="lib-sort" title="Sort by">
        <option value="name">Name</option>
        <option value="mtime">Date modified</option>
        <option value="date">Date taken</option>
        <option value="iso">ISO</option>
        <option value="shutter">Shutter speed</option>
        <option value="aperture">Aperture</option>
        <option value="focal">Focal length</option>
        <option value="camera">Camera</option>
        <option value="edited">Edit status</option>
        <option value="editedts">Date edited</option>
      </select>
      <button class="lib-btn" id="lib-sort-dir" title="Reverse sort order">↑</button>
      <select id="lib-metadisp" title="Show metadata on cards">
        <option value="off">Metadata: Off</option>
        <option value="hover">Metadata: On hover</option>
        <option value="always">Metadata: Always</option>
      </select>
      <label class="lib-btn" id="lib-showtitle-wrap" style="display:flex;align-items:center;gap:5px;cursor:pointer">
        <input type="checkbox" id="lib-showtitle" style="margin:0"><span>Show title</span>
      </label>
      <div class="lib-thumbsize" id="lib-thumbsize-wrap">
        <span>Size</span><input type="range" id="lib-thumbsize" min="90" max="320" step="10">
      </div>
      <span id="lib-lr-chip">✓ Lightroom connected <span class="lib-lr-signout" title="Sign out of Adobe Lightroom">Sign out</span></span>
    </div>
    <div id="lib-side"><div id="lib-collections"></div><div id="lib-tree"></div></div>
    <div id="lib-main">
      <div id="lib-list-head">
        <div class="lib-lh-cell lib-lh-thumb"></div>
        <div class="lib-lh-cell" data-sort="name">Name</div>
        <div class="lib-lh-cell" data-sort="date">Date</div>
        <div class="lib-lh-cell" data-sort="editedts">Edited on</div>
        <div class="lib-lh-cell" data-sort="camera">Camera</div>
        <div class="lib-lh-cell" data-sort="iso">ISO</div>
        <div class="lib-lh-cell" data-sort="shutter">Shutter</div>
        <div class="lib-lh-cell" data-sort="aperture">Aperture</div>
        <div class="lib-lh-cell" data-sort="focal">Focal</div>
        <div class="lib-lh-cell lib-lh-flags">Flags</div>
        <div class="lib-lh-cell" data-sort="edited">Edited</div>
      </div>
      <div id="lib-grid"></div>
      <div id="lib-compare"></div>
    </div>
    <div id="lib-bottom"><span style="font-size:11px;color:var(--mut)" id="lib-count"></span><span style="font-size:11px;color:var(--mut)" id="lib-thumb-progress"></span></div>
  `;
  // Make the dock a real grid-column sibling of the preview/panel/rail row instead of a
  // body-level overlay — see the big comment above the style block. .fx-layout already exists
  // in the DOM by the time this script runs (injected just before </body>, after the app's own
  // markup). Falls back to a plain body-append if .fx-layout is ever missing (e.g. this file
  // loaded standalone for testing) so the panel still renders, just without the grid-column
  // placement — better than a hard failure.
  const fxLayoutEl = document.querySelector('.fx-layout');
  if (fxLayoutEl) fxLayoutEl.insertBefore(overlay, fxLayoutEl.firstChild);
  else document.body.appendChild(overlay);

  // No JS-computed padding/width to keep in sync anymore — chromasmith-22.html's own
  // body.lib-docked/body.lib-full selectors (toggled below) size the reserved grid column
  // directly. Kept as a harmless no-op stub since a couple of call sites below still poke it
  // after a state change; deleting them individually isn't worth the risk of missing one.
  function syncDockPadding() {}

  // ── provisional preview: while a RAW's full native decode (PPG demosaic + DCP LUT,
  // several seconds) runs, show the camera's own embedded JPEG immediately over the preview
  // canvas so opening a photo doesn't look frozen. Its own <img>, not the WebGL canvas
  // (fx-canvas already owns a WebGL2 context — a 2D drawImage onto it isn't possible), so it
  // can't interfere with FXR state; removed the moment loadFXImages finishes (or fails). ────
  let provisionalImg = null, provisionalToken = 0;
  function ensureProvisionalEl() {
    if (provisionalImg) return provisionalImg;
    const wrap = document.getElementById('fx-zoom-wrap');
    if (!wrap) return null;
    provisionalImg = document.createElement('img');
    provisionalImg.id = 'lib-provisional';
    wrap.appendChild(provisionalImg);
    return provisionalImg;
  }
  const RAW_EXT_RE = /\.(rw2|raw|dng|cr2|cr3|nef|arw|orf)$/i;
  // Minimal framed raw-body invoke (JSON header + binary payload) — same wire format
  // desktop-native.js's framedInvoke uses for store_dcp_lut, duplicated here (not exposed on
  // window there) since it's a one-liner and this file is meant to stay self-contained.
  function framedInvoke(cmd, jsonObj, payload) {
    const json = new TextEncoder().encode(JSON.stringify(jsonObj));
    const framed = new Uint8Array(4 + json.length + payload.length);
    new DataView(framed.buffer).setUint32(0, json.length, true);
    framed.set(json, 4);
    framed.set(payload, 4 + json.length);
    return invoke(cmd, framed);
  }
  // Everything that changes what a RAW decode actually PRODUCES — the persistent decode cache
  // (see get_decode_cache/save_decode_cache in library.rs) is keyed on this alongside
  // path+mtime+size, so switching RAW profile / native NR / demosaic algo / auto-lens can never
  // serve a stale cached decode.
  function rawRecipeKey() {
    const profile = (typeof rawProfile === 'function') ? rawProfile() : '';
    // Must include every setting that changes the NATIVE decode's pixels (see decode_raw_v2's
    // params in main.rs) — a manual lens pick (window.chromasmithLensOverride/Focal) changes the
    // distortion-correction geometry baked into the cached JPEG just like autoLens does, so it
    // was missing here: switching manual lenses used to silently serve a stale cache decoded
    // with the PREVIOUS lens's correction.
    // Fast and High are DECODE-TIME identical (High's extra neural pass runs out of band via
    // denoise_raw_high, never through decode_raw_v2 — see raw_decode.rs's NrTier) — the disk
    // cache only needs to distinguish Off from not-Off, same 2-way key as the old boolean.
    return [profile, window.chromasmithRawNr !== 'off' ? 1 : 0,
      window.chromasmithDemosaicAlgo || '', window.chromasmithAutoLens ? 1 : 0,
      window.chromasmithLensOverride || '', window.chromasmithLensOverrideFocal || 0].join('|');
  }
  async function showProvisional(path) {
    if (!RAW_EXT_RE.test(path)) return () => {};
    const myToken = ++provisionalToken;
    const el = ensureProvisionalEl();
    if (!el) return () => {};
    try {
      const buf = await invoke('get_preview', { path });
      if (myToken !== provisionalToken) return () => {}; // superseded by a newer open
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      el.onload = () => URL.revokeObjectURL(url);
      el.src = url;
      el.classList.add('on');
      document.body.classList.add('lib-provisional-on'); // hides the canvas (old photo) beneath
    } catch (e) { /* embedded preview unavailable — just skip the provisional frame */ }
    return () => {
      if (myToken === provisionalToken) {
        el.classList.remove('on');
        document.body.classList.remove('lib-provisional-on');
      }
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  const baseName = (p) => p.split('/').pop();
  // Best-effort MIME from the filename — File objects built from read_file_bytes carry no
  // type, and chromasmith-22.html has type-based branches downstream (its loadFXImages filter
  // is now extension-aware too, but a real MIME keeps every other check honest).
  const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v' };
  const mimeFromName = (p) => MIME_BY_EXT[(p.split('.').pop() || '').toLowerCase()] || '';
  async function pickFolder() {
    try {
      const chosen = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false } });
      if (!chosen) return;
      state.root = Array.isArray(chosen) ? chosen[0] : chosen;
      localStorage.setItem(LS_ROOT, state.root);
      pushRecentFolder(state.root);
      state.expanded.clear();
      state.expanded.add(state.root);
      await renderTree();
      await openFolder(state.root);
    } catch (e) { console.error('pickFolder', e); }
  }

  // Same root-switch sequence as pickFolder() above, for a folder dropped from Finder onto the
  // grid instead of chosen via the OS dialog.
  async function importDroppedFolder(path) {
    state.root = path;
    localStorage.setItem(LS_ROOT, state.root);
    pushRecentFolder(state.root);
    state.expanded.clear();
    state.expanded.add(state.root);
    await renderTree();
    await openFolder(state.root);
  }
  // Drop files/folders from Finder onto the grid to import — there was previously no drag&drop
  // path into the Library at all (only the main editor's own drop zones, which load blobs
  // directly and know nothing about folders or the Library's state). A single dropped item is
  // probed with list_dir: it succeeds for a real directory and fails for a plain file (Rust's
  // std::fs::read_dir errors on a non-directory path — see library.rs's list_dir), so the same
  // drop target can tell folders and photos apart without the browser's limited File API. Files
  // (or a probe failure) fall through to opening them as a photo batch, mirroring a multi-select
  // batch open.
  //
  // ⚠️ The actual OS→app handoff now happens in wireNativeFileDrop() below, NOT here. WKWebView
  // (macOS) never populates File.path on an HTML5 drop — a browser security restriction, not a
  // Tauri bug — so with dragDropEnabled:false this function used to hit "Could not read the
  // dropped file path(s)" on every drop. tauri.conf.json now sets dragDropEnabled:true, which
  // routes OS file drags through Tauri's native tauri://drag-drop event (real absolute paths)
  // instead of the DOM 'drop' event, so this handler only fires for the (documented) fallback
  // case where the native path is unavailable — e.g. LIBTEST's browser harness. Kept, rather
  // than deleted, purely as that fallback; it no longer needs a "give up" toast because the
  // native listener is the one actually doing the work in the shipped app.
  function wireGridFileDrop() {
    const gridEl = document.getElementById('lib-grid');
    if (!gridEl) return;
    const hasOsFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    gridEl.addEventListener('dragover', (e) => {
      if (!hasOsFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      gridEl.classList.add('lib-dragover');
    });
    gridEl.addEventListener('dragleave', (e) => { if (e.target === gridEl) gridEl.classList.remove('lib-dragover'); });
    gridEl.addEventListener('drop', async (e) => {
      if (!hasOsFiles(e)) return;
      e.preventDefault();
      gridEl.classList.remove('lib-dragover');
      if (state.source === 'lr') return; // cloud album view has nowhere local to import into
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const paths = files.map((f) => f.path).filter(Boolean);
      if (!paths.length) return; // no usable path here — wireNativeFileDrop already handled it
      await handleLibraryDrop(paths);
    });
  }
  // Shared by both the DOM fallback above and the native listener below.
  async function handleLibraryDrop(paths) {
    if (state.source === 'lr') return; // cloud album view has nowhere local to import into
    if (paths.length === 1) {
      try {
        const listing = await invoke('list_dir', { path: paths[0] });
        if (Array.isArray(listing)) { await importDroppedFolder(paths[0]); return; }
      } catch (err) { /* not a directory — fall through to opening it as a photo */ }
    }
    await openPathsInEditor(paths);
  }
  // ── Native OS file drag&drop bridge ───────────────────────────────────────────────────────
  // dragDropEnabled:true (tauri.conf.json) makes Tauri itself watch the OS-level drag session
  // and hands real absolute paths to the frontend via tauri://drag-over/-drop/-leave, instead of
  // letting the browser's own HTML5 DnD receive it (which is what exposed the missing-.path bug
  // above). This ONE listener serves every drop target in the app — the Library grid AND every
  // editor drop zone in chromasmith-22.html (.dz elements: before/after, Match&Refine source/
  // ref, LUT/preset start, FX image/LUT, canvas photo tray, Lightroom-handoff dev zones) — by
  // hit-testing the drop position against the DOM, then either running the Library import path
  // directly or reconstructing File objects (via readPathsAsFiles, same helper openPathsInEditor
  // uses) and feeding them into each zone's EXISTING handler (dzd/clDropFiles/loadFXImages) so
  // none of those handlers had to change. In-page drags (mask reorder, filmstrip/canvas-tray
  // drag, card→sidebar drag) are unaffected: they never put a file:// URL on the OS pasteboard,
  // so Tauri's native watcher has nothing to intercept and plain HTML5 dragstart/drop keeps
  // handling them exactly as before.
  function wireNativeFileDrop() {
    if (LIBTEST || !window.__TAURI__ || !window.__TAURI__.event) return; // nothing real to listen to
    const dpr = () => window.devicePixelRatio || 1;
    let overEl = null;
    const clearOver = () => { if (overEl) { overEl.classList.remove('over', 'lib-dragover'); overEl = null; } };
    // Tauri's drag position is in PHYSICAL window pixels; elementFromPoint wants CSS (logical)
    // pixels, hence the devicePixelRatio divide.
    const dzAt = (payload) => {
      const pos = payload && payload.position;
      if (!pos) return null;
      const el = document.elementFromPoint(pos.x / dpr(), pos.y / dpr());
      return el && el.closest ? el.closest('.dz, #lib-grid') : null;
    };
    window.__TAURI__.event.listen('tauri://drag-over', (e) => {
      clearOver();
      const dz = dzAt(e.payload);
      if (dz) { dz.classList.add(dz.id === 'lib-grid' ? 'lib-dragover' : 'over'); overEl = dz; }
    });
    window.__TAURI__.event.listen('tauri://drag-leave', clearOver);
    window.__TAURI__.event.listen('tauri://drag-drop', async (e) => {
      const dz = dzAt(e.payload);
      clearOver();
      const paths = (e.payload && e.payload.paths) || [];
      if (!dz || !paths.length) return;
      if (dz.id === 'lib-grid') { await handleLibraryDrop(paths); return; }
      const files = await readPathsAsFiles(paths);
      if (!files.length) return;
      const fakeEvent = { preventDefault() {}, currentTarget: dz, dataTransfer: { files } };
      if (dz.id === 'cl-dz') { if (typeof clDropFiles === 'function') clDropFiles(fakeEvent); return; }
      if (typeof dzd === 'function') dzd(fakeEvent, dz.id.replace(/^dz-/, ''));
    });
  }

  // ── quick access: jump straight to a folder (used by the Recent-folders dropdown AND the
  // Google Photos pinned entry) without going through the OS folder-picker dialog. ──────────
  async function openAsRoot(path) {
    state.root = path;
    localStorage.setItem(LS_ROOT, path);
    pushRecentFolder(path);
    state.expanded.clear();
    state.expanded.add(path);
    await renderTree();
    await openFolder(path);
  }

  // ── recent folders (MRU, capped) — a Darkroom-style quick-access list so re-opening a
  // folder you browsed earlier this session (or a prior one) doesn't need the OS picker
  // again. Kept separate from state.root/LS_ROOT (which only remembers the LAST folder). ────
  const LS_RECENTS = 'chromasmith_lib_recents';
  const RECENTS_MAX = 8;
  function getRecentFolders() {
    try { return JSON.parse(localStorage.getItem(LS_RECENTS) || '[]'); } catch (e) { return []; }
  }
  function pushRecentFolder(path) {
    if (!path) return;
    const list = getRecentFolders().filter((p) => p !== path);
    list.unshift(path);
    try { localStorage.setItem(LS_RECENTS, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (e) { /* ignore */ }
  }
  // Pinned folders — persisted favorites, unlike the MRU recents above (see the Recent menu).
  const LS_PINS = 'chromasmith_lib_pins';
  function getPinnedFolders() {
    try { return JSON.parse(localStorage.getItem(LS_PINS) || '[]'); } catch (e) { return []; }
  }
  function togglePinnedFolder(path) {
    if (!path) return;
    const list = getPinnedFolders();
    const i = list.indexOf(path);
    if (i >= 0) list.splice(i, 1); else list.push(path);
    try { localStorage.setItem(LS_PINS, JSON.stringify(list)); } catch (e) { /* ignore */ }
    if (typeof toast === 'function') toast(i >= 0 ? 'Folder unpinned' : 'Folder pinned', true);
  }

  // Top-bar "Recent" dropdown: pinned Google Photos Download entry (always first, created on
  // demand even if no import ran yet this launch) + the MRU recent-folders list. Lives in
  // #lib-top rather than the folder tree (#lib-side) because #lib-side is HIDDEN in the
  // docked filmstrip mode (deskx) — a tree-only quick-access link would be invisible there,
  // which is exactly the "can't find quick access to the folder" bug this replaces.
  let gphotosDirCache = null;
  async function gphotosDownloadsDir() {
    if (!gphotosDirCache) { try { gphotosDirCache = await invoke('gphotos_downloads_dir'); } catch (e) { console.error('gphotos_downloads_dir', e); } }
    return gphotosDirCache;
  }
  let recentMenu = null;
  function closeRecentMenu() { if (recentMenu) { recentMenu.remove(); recentMenu = null; } }
  document.addEventListener('click', closeRecentMenu);
  async function toggleRecentMenu(e) {
    e.stopPropagation();
    if (recentMenu) { closeRecentMenu(); return; }
    const gDir = await gphotosDownloadsDir();
    const lDirEarly = await lrDownloadsDir().catch(() => null);
    const recents = getRecentFolders().filter((p) => p !== gDir && p !== lDirEarly);
    recentMenu = document.createElement('div');
    recentMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);' +
      'border-radius:8px;padding:4px;font-size:12px;color:var(--txt);font-family:var(--sans);min-width:220px;max-width:320px;box-shadow:var(--lift-2)';
    const item = (label, path) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.title = path;
      el.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      el.onmouseenter = () => { el.style.background = 'var(--bdr)'; };
      el.onmouseleave = () => { el.style.background = ''; };
      el.onclick = async (ev) => { ev.stopPropagation(); closeRecentMenu(); await openAsRoot(path); };
      recentMenu.appendChild(el);
    };
    const menuSep = () => {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--bdr);margin:4px 0';
      recentMenu.appendChild(sep);
    };
    // Pinned folders: user-curated favorites that survive past the 8-slot recents MRU — the
    // recents list silently pushes out folders you ALWAYS come back to once you browse a few
    // others. Pin/unpin the current folder from this same menu.
    const lDir = lDirEarly;
    const pins = getPinnedFolders().filter((p) => p !== gDir && p !== lDir);
    if (gDir) item('☁️ Google Photos Download', gDir);
    if (lDir) item('☁️ Lightroom Download', lDir);
    if (pins.length) {
      if (gDir) menuSep();
      pins.forEach((p) => item('📌 ' + baseName(p), p));
    }
    if (state.currentFolder) {
      menuSep();
      const isPinned = getPinnedFolders().includes(state.currentFolder);
      const pinEl = document.createElement('div');
      pinEl.textContent = isPinned ? '✕ Unpin current folder' : '📌 Pin current folder';
      pinEl.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer;color:var(--mut)';
      pinEl.onmouseenter = () => { pinEl.style.background = 'var(--bdr)'; };
      pinEl.onmouseleave = () => { pinEl.style.background = ''; };
      pinEl.onclick = (ev) => { ev.stopPropagation(); togglePinnedFolder(state.currentFolder); closeRecentMenu(); };
      recentMenu.appendChild(pinEl);
    }
    const shownRecents = recents.filter((p) => !pins.includes(p));
    if (shownRecents.length) {
      menuSep();
      shownRecents.forEach((p) => item('📁 ' + baseName(p), p));
    } else if (!gDir && !pins.length) {
      item('No recent folders yet', '');
    }
    document.body.appendChild(recentMenu);
    const r = document.getElementById('lib-recent').getBoundingClientRect();
    const { innerWidth: vw } = window;
    const mr = recentMenu.getBoundingClientRect();
    recentMenu.style.left = Math.min(r.left, vw - mr.width - 8) + 'px';
    recentMenu.style.top = (r.bottom + 4) + 'px';
  }

  // Folder size at which the grid switches to windowed rendering. Chosen off the measurement in
  // renderGrid's comment: 200 files is comfortable, 1,000 is heavy, 5,000 does not load.
  const VIRT_MIN = 400;
  // Test hook: the grid probe needs the measured metrics, which are otherwise closure-local.
  if (LIBTEST) {
    window.__libState = () => ({ m: state._virtMetrics, on: state._virtOn, n: (state._virtAll || []).length, range: state._virtRange });
    window.__libRenderGrid = () => renderGrid();
  }
  // How many rows of cards to keep mounted beyond the viewport in each direction. Two rows is
  // enough that a normal scroll flick never exposes a gap, without mounting a screenful of cards
  // nobody sees.
  const VIRT_OVERSCAN_ROWS = 2;
  let _virtScrollBound = null;

  /// Measures the live grid's geometry from the DOM rather than recomputing it from CSS. The
  /// column count comes from `auto-fill` and the card height from content, so both depend on the
  /// thumbnail size, the dock state, the window width and whether titles are shown — deriving
  /// them by hand would be a second source of truth that drifts the moment any of that changes.
  function virtMetrics(gridEl) {
    const cards = gridEl.querySelectorAll('.lib-card');
    if (cards.length < 2) return null;
    const top0 = cards[0].offsetTop;
    let cols = 1;
    while (cols < cards.length && cards[cols].offsetTop === top0) cols++;
    // Row pitch from the first card that actually starts a new row.
    const next = cards[cols];
    const rowH = next ? (next.offsetTop - top0) : (cards[0].offsetHeight + 16);
    return { cols, rowH: Math.max(1, rowH), cardH: cards[0].offsetHeight };
  }

  /// Mounts only the rows near the viewport, with a spacer above and below holding the scroll
  /// height. Spacers span the full row (`grid-column:1/-1`) so the CSS grid's auto-fill column
  /// maths is untouched — the alternative, absolutely positioning cards, would mean
  /// reimplementing the responsive layout this file already gets from the browser.
  function virtUpdate(force) {
    const gridEl = document.getElementById('lib-grid');
    if (!gridEl || !state._virtOn) return;
    const all = state._virtAll || [];
    const m = state._virtMetrics;
    if (!m) return;
    const scroller = gridEl.parentElement && gridEl.parentElement.scrollHeight > gridEl.parentElement.clientHeight
      ? gridEl.parentElement : (gridEl.closest('#lib-overlay') || document.documentElement);
    const viewTop = Math.max(0, (scroller.scrollTop || 0) - gridEl.offsetTop);
    const viewH = scroller.clientHeight || window.innerHeight;
    const totalRows = Math.ceil(all.length / m.cols);
    const firstRow = Math.max(0, Math.floor(viewTop / m.rowH) - VIRT_OVERSCAN_ROWS);
    const lastRow = Math.min(totalRows - 1, Math.ceil((viewTop + viewH) / m.rowH) + VIRT_OVERSCAN_ROWS);
    if (!force && state._virtRange && state._virtRange[0] === firstRow && state._virtRange[1] === lastRow) return;
    state._virtRange = [firstRow, lastRow];
    const from = firstRow * m.cols, to = Math.min(all.length, (lastRow + 1) * m.cols);
    renderCards(gridEl, all.slice(from, to), all, false, {
      offset: from,
      padTop: firstRow * m.rowH,
      padBot: Math.max(0, (totalRows - 1 - lastRow) * m.rowH),
    });
  }

  // Thumbnail loader with a small concurrency pool + viewport priority. renderGrid used to
  // fire one get_thumbnail invoke per card synchronously — opening a 500-RAW folder launched
  // 500 concurrent Rust decodes at once (the <img loading="lazy"> attribute is useless here,
  // since the eager invoke IS the expensive part, not the <img> fetch). Cards report
  // visibility via an IntersectionObserver; visible cards jump the queue.
  const THUMB_POOL = 6;
  let _thumbQueue = []; // [{path, imgEl, visible}]
  let _thumbActive = 0;
  let _thumbGen = 0; // bumped per grid rebuild so stale queue entries from the previous folder are dropped
  // Blob URLs from get_thumbnail are never revoked otherwise — the <img> elements holding them
  // get discarded wholesale on every renderGrid() rebuild (grid.innerHTML=''), but the
  // underlying blobs stay alive until revokeObjectURL is called explicitly, leaking memory a
  // little more on every folder switch/re-render. Tracked per generation so a full sweep can
  // run once the URLs' owning cards are guaranteed gone.
  let _thumbUrlsThisGen = [];
  // Per-generation failure tracking for a single summary toast once the batch settles, instead
  // of a silent CSS class per broken thumbnail (easy to miss on a large grid).
  let _thumbFailCount = 0;
  let _thumbTotalCount = 0;
  let _thumbFailToastShown = false;
  const _thumbIO = (typeof IntersectionObserver === 'function')
    ? new IntersectionObserver((ents) => {
        for (const en of ents) {
          const q = _thumbQueue.find((t) => t.imgEl === en.target);
          if (q) q.visible = en.isIntersecting;
        }
      }, { rootMargin: '200px' })
    : null;
  function _thumbPump() {
    while (_thumbActive < THUMB_POOL && _thumbQueue.length) {
      const i = _thumbQueue.findIndex((t) => t.visible);
      const job = _thumbQueue.splice(i >= 0 ? i : 0, 1)[0];
      // NOTE: job.imgEl.isConnected requires the card to already be in the DOM by the time
      // loadThumb() is called — renderGrid() must appendChild(card) BEFORE calling loadThumb(),
      // or every job is silently dropped here (this was the "thumbnails never load" bug: the
      // pump ran synchronously while cards were still detached, so isConnected was false for
      // every single job and _thumbActive never even incremented).
      if (job.gen !== _thumbGen || !job.imgEl.isConnected) continue; // grid was rebuilt — skip
      _thumbActive++;
      updateThumbProgress();
      (job.isVideo
        ? videoPosterAndMeta(job.path).then((m) => {
            if (!m || !m.url) throw new Error('no video poster');
            if (job.imgEl.isConnected) {
              job.imgEl.src = m.url;
              job.imgEl.classList.add('loaded');
              _thumbUrlsThisGen.push(m.url);
              // Stamp the real duration/dimensions onto the card now that we know them.
              const card = job.imgEl.closest('.lib-card');
              const badge = card && card.querySelector('.lib-video-badge');
              if (badge && m.dur) badge.textContent = fmtDuration(m.dur);
              if (card && m.w && m.h) card.dataset.dims = m.w + 'x' + m.h;
            }
          })
        : invoke('get_thumbnail', { path: job.path })
          .then((buf) => {
            if (job.imgEl.isConnected) {
              const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
              job.imgEl.src = url;
              job.imgEl.classList.add('loaded');
              _thumbUrlsThisGen.push(url);
            }
          }))
        .catch((err) => {
          console.warn('get_thumbnail failed for', job.path, err);
          _thumbFailCount++;
          if (job.imgEl.isConnected) {
            job.imgEl.classList.add('thumb-error');
            job.imgEl.parentElement?.classList.add('thumb-broken');
          }
        })
        .finally(() => {
          if (_thumbIO) _thumbIO.unobserve(job.imgEl);
          _thumbActive--;
          _thumbDoneCount++;
          updateThumbProgress();
          _thumbPump();
          // Batch settled (this generation's queue drained and no job still in flight): show
          // ONE summary toast if anything failed, instead of a silent per-thumbnail CSS class.
          if (_thumbActive === 0 && _thumbQueue.length === 0 && _thumbFailCount > 0 && !_thumbFailToastShown) {
            _thumbFailToastShown = true;
            if (typeof toast === 'function') toast(`${_thumbFailCount} of ${_thumbTotalCount} thumbnails failed to load`, false);
          }
        });
    }
  }
  // Small "Loading photos… N/M" readout in the bottom bar while the thumb pool is still
  // draining a large folder — cleared once every job in this generation has settled (loaded or
  // failed), so it never lingers after a folder finishes loading.
  let _thumbDoneCount = 0;
  function updateThumbProgress() {
    const el = document.getElementById('lib-thumb-progress');
    if (!el) return;
    if (_thumbDoneCount >= _thumbTotalCount || _thumbTotalCount < 8) { el.textContent = ''; return; }
    el.textContent = `Loading photos… ${_thumbDoneCount}/${_thumbTotalCount}`;
  }
  // ── Video posters + metadata, decoded in the webview ─────────────────────────────────────────
  // library.rs's get_thumbnail has no still-frame decoder for MP4 (the `image` crate cannot read
  // one, and an ffmpeg dependency is not worth carrying for a grid thumbnail) — so video cards
  // showed a dark placeholder. But WKWebView decodes H.264/HEVC natively, so a <video> element
  // plus a canvas gets both the poster frame AND the real duration/dimensions in one pass. Cached
  // per path so scrolling the grid does not re-decode.
  const _videoMetaCache = new Map();   // path -> {url, w, h, dur}
  async function videoPosterAndMeta(path) {
    if (_videoMetaCache.has(path)) return _videoMetaCache.get(path);
    const buf = await invoke('read_file_bytes', { path });
    const srcUrl = URL.createObjectURL(new Blob([buf], { type: mimeFromName(path) || 'video/mp4' }));
    try {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = srcUrl;
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error('video metadata failed'));
        setTimeout(() => rej(new Error('video metadata timeout')), 12000);
      });
      // Seek a little way in: frame 0 of a real clip is very often black or a fade-in.
      const t = Math.min(1, (v.duration || 2) * 0.1);
      await new Promise((res, rej) => {
        v.onseeked = res;
        v.onerror = () => rej(new Error('video seek failed'));
        setTimeout(res, 8000);            // resolve anyway — a poster is better than nothing
        v.currentTime = t;
      });
      const W = 400, sc = Math.min(1, W / (v.videoWidth || W));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((v.videoWidth || W) * sc));
      c.height = Math.max(1, Math.round((v.videoHeight || W) * sc));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      const meta = { url: blob ? URL.createObjectURL(blob) : null,
                     w: v.videoWidth || 0, h: v.videoHeight || 0, dur: v.duration || 0 };
      _videoMetaCache.set(path, meta);
      return meta;
    } finally {
      URL.revokeObjectURL(srcUrl);        // the decoded poster is its own blob; this one is done
    }
  }
  function fmtDuration(sec) {
    if (!sec || !isFinite(sec)) return '';
    const m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return m + ':' + String(r).padStart(2, '0');
  }
  function loadThumb(path, imgEl, isVideo) {
    _thumbQueue.push({ path, imgEl, isVideo: !!isVideo, visible: false, gen: _thumbGen });
    _thumbTotalCount++;
    if (_thumbIO) _thumbIO.observe(imgEl);
    _thumbPump();
  }
  function thumbQueueReset() {
    _thumbGen++;
    if (_thumbIO) _thumbQueue.forEach((t) => _thumbIO.unobserve(t.imgEl));
    _thumbQueue = [];
    _thumbActive = 0; // defensive: never let a stale count strand future pumps
    // The grid that owned these blob URLs is about to be torn down (renderGrid clears
    // grid.innerHTML right after calling this) — revoke now rather than leaking.
    _thumbUrlsThisGen.forEach((u) => URL.revokeObjectURL(u));
    _thumbUrlsThisGen = [];
    _thumbFailCount = 0;
    _thumbTotalCount = 0;
    _thumbDoneCount = 0;
    _thumbFailToastShown = false;
    updateThumbProgress();
  }

  // Small orange pen icon for the "edited" corner badge — replaces the old EDITED text pill.
  // Color matches the app's accent orange (--acc, e.g. #e8a33d) used elsewhere in the UI.
  const EDITED_BADGE_HTML = '<div class="lib-edited-badge" title="Edited"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z" fill="#e8a33d"/>' +
    '<path d="M12.5 6.5l5 5" stroke="#00000055" stroke-width="1"/></svg></div>';
  const FLAG_SVG_GREEN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#46a758" stroke-width="2.4"><path d="M5 21V4" stroke-linecap="round"/><path d="M5 4h13l-3.2 4.5L18 13H5z" fill="#46a758" stroke="none"/></svg>';
  const FLAG_SVG_RED = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#e5484d" stroke-width="2.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
  const HEART_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="#e5484d" stroke="none"><path d="M12 20.5s-7.5-4.6-10-9.1C.6 8.1 2 4.8 5.2 4c2-.5 4 .3 5.3 2 1.3-1.7 3.3-2.5 5.3-2 3.2.8 4.6 4.1 3.2 7.4-2.5 4.5-10 9.1-10 9.1z"/></svg>';
  // entry.edited_ts (library.rs's get_export_history-adjacent field) is the .xmp sidecar's own
  // mtime, 0 if no sidecar exists yet (never edited) — the list-view "Edited on" column.
  function fmtEditedTs(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
  }
  // A grid of blank shimmering placeholder cards, shown while a folder/collection/album is
  // being fetched, instead of the previous "Loading…" text — swapping the entire grid for one
  // line of text (then swapping it back for real cards moments later) was a visible flash on
  // every folder switch. 24 is enough to fill the tallest common viewport at default thumb size
  // without generating an unbounded number of shimmering nodes for a huge folder.
  function libSkeletonHtml(n = 24) {
    return Array.from({ length: n }, () => '<div class="lib-card lib-skel"><div class="lib-thumb-wrap"></div></div>').join('');
  }
  function flagsHtml(label, favorite) {
    return `<span class="lib-flag${label === 'Red' ? ' on' : ''}" data-flag="Red" title="Reject (X)">${FLAG_SVG_RED}</span>` +
           `<span class="lib-flag${label === 'Green' ? ' on' : ''}" data-flag="Green" title="Pick (flag)">${FLAG_SVG_GREEN}</span>` +
           `<span class="lib-flag lib-fav${favorite ? ' on' : ''}" data-flag="Favorite" title="Favorite (F)">${HEART_SVG}</span>`;
  }

  // ── options for a <select> populated with the distinct values present in this folder ─────
  function populateSelect(sel, values, allLabel) {
    const cur = sel.value;
    const distinct = Array.from(new Set(values.filter(Boolean))).sort();
    sel.innerHTML = `<option value="all">${allLabel}</option>` + distinct.map((v) => `<option value="${v}">${v}</option>`).join('');
    sel.value = distinct.includes(cur) ? cur : 'all';
  }

  // ── base64<->JSON helpers for the edit-recipe sidecar payload (unicode-safe) ─────────────
  function snapshotToB64(snap) { return btoa(unescape(encodeURIComponent(JSON.stringify(snap)))); }
  function snapshotFromB64(b64) { return JSON.parse(decodeURIComponent(escape(atob(b64)))); }

  // ── single-flight + latest-wins: without this, clicking photo A then quickly clicking
  // photo B started TWO concurrent opens with nothing stopping A's slower decode from
  // completing (and rendering) AFTER B's — visibly "loading on top of" whatever you'd
  // already switched to. Now a click while a load is in flight just remembers the latest
  // requested path; the in-flight load, on finishing, immediately starts that latest
  // request instead. Only one decode ever runs at a time, and the end state always matches
  // the last thing you actually clicked. ──
  // chromasmith-22.html's fxSelectImage() (filmstrip clicks) is a COMPLETELY SEPARATE entry
  // point that reads/renders the global fxImages array directly, with no idea this mutex
  // exists — clicking a filmstrip thumbnail while a library decode is in flight rendered the
  // STALE previous batch (fxSelectImage's own render, synchronous, no queueing) moments before
  // the pending decode's installFXImages() overwrote it with the actually-newly-opened photo —
  // a visible flash of the wrong image. Mirroring openBusy onto this global lets fxSelectImage
  // simply no-op while a library load owns the transition, rather than fighting over it.
  let openBusy = false, openPendingPath = null;
  async function openInEditor(path) {
    if (openBusy) { openPendingPath = path; return; }
    openBusy = true;
    window.chromasmithLibraryBusy = true;
    try {
      await openInEditorInner(path);
    } finally {
      openBusy = false;
      window.chromasmithLibraryBusy = false;
      const next = (openPendingPath && openPendingPath !== path) ? openPendingPath : null;
      openPendingPath = null;
      if (next) openInEditor(next);
    }
  }
  // Called by chromasmith-22.html's Auto lens-profile / RAW Noise Reduction toggles: both are
  // baked into the native RAW decode (not a live shader term), so a toggle alone changes
  // nothing visible — the previous UX ("reopen this photo to apply") was a real trap: toggling
  // and re-exporting WITHOUT actually closing/reopening produced two byte-identical exports
  // from the same cached decode, silently. Evict the cache entry and force a real re-decode
  // immediately instead of relying on the user to remember an extra manual step.
  window.chromasmithReloadCurrentPhoto = () => {
    if (!state.openedPath) return false;
    imgCache.delete(state.openedPath);
    openInEditor(state.openedPath);
    return true;
  };
  async function openInEditorInner(path) {
    // Opening a photo through the normal Library ends any Lightroom Edit-In session — otherwise
    // "Save to Lightroom" would stay visible and silently overwrite the WRONG file (the old
    // handoff path) after the user has already navigated to something else.
    window.chromasmithEditInPath = null;
    window.chromasmithOpenedOrigin = { source: 'folder' }; // opening a local photo clears any LR-album origin (see toggleLibrary)
    const saveLrBtn = document.getElementById('db-save-lr');
    if (saveLrBtn) saveLrBtn.style.display = 'none';
    // A pending disk write for the PREVIOUS photo must land before we move state.openedPath
    // off it — otherwise a quick edit right before switching photos could be dropped.
    await flushPendingSave();
    // Selecting a photo from the full-window home screen transitions into the editor — the
    // library collapses to the docked filmstrip (stays open, just narrow), it doesn't close.
    if (state.expanded_view) toggleExpandedView(false);
    const cached = imgCache.get(path);
    // Cache hit: skip read_file_bytes + the full decode entirely, and skip the provisional
    // preview too (there's nothing to bridge — the real image is already ready instantly).
    const provisionalPromise = cached ? Promise.resolve(() => {}) : showProvisional(path);
    const spin = document.getElementById('fx-fname-spin');
    if (spin && !cached) spin.style.display = '';
    // Deskbar title: show the incoming photo's name + a spinner immediately (RapidRAW-style);
    // loadFXImages swaps the spinner for the real dimensions when the decode lands.
    if (!cached && typeof fxDeskbarTitle === 'function') fxDeskbarTitle(baseName(path), '', true);
    // RAW Noise Reduction is baked into the native decode itself (not a live shader term), so
    // it must be per-PHOTO, not one global switch bleeding into whatever you open next — peek
    // the sidecar's saved recipe BEFORE decoding (not after, like the rest of applyUISnapshot)
    // so window.chromasmithRawNr is already correct when the decode shim reads it (open() only
    // ever sends 'off'/'fast' to decode_raw_v2 — High runs later via denoise_raw_high, never
    // automatically). Falls back to the app-wide default (Fast) for a photo with no saved
    // recipe yet. ⚠️ Deliberately NEVER defaults to High here, sidecar or no — High must only
    // ever be reached by an explicit user action (the Denoise-now button) or at export.
    const sc = await getSidecar(path);
    let rawNrForThisPhoto;
    try { rawNrForThisPhoto = localStorage.getItem('chromasmithRawNr') || (localStorage.getItem('chromasmithNativeNr') === '0' ? 'off' : 'fast'); } catch (e) { rawNrForThisPhoto = 'fast'; }
    // Same decode-time-baked, per-photo reasoning as nativeNr above — the RAW demosaic
    // algorithm choice ("" Standard / "ahd" Sparkle-optimized) must also be peeked from the
    // sidecar BEFORE decoding, not restored afterward like the rest of applyUISnapshot.
    let demosaicAlgoForThisPhoto;
    try { demosaicAlgoForThisPhoto = localStorage.getItem('chromasmithDemosaicAlgo') || ''; } catch (e) { demosaicAlgoForThisPhoto = ''; }
    if (sc.recipe) {
      try {
        const snap = snapshotFromB64(sc.recipe);
        // rawNr is authoritative; nativeNr (older sidecars) maps Off/Fast only — an old recipe
        // can never have meant High, since that tier didn't exist when it was saved.
        if (snap.rawNr !== undefined) rawNrForThisPhoto = snap.rawNr;
        else if (snap.nativeNr !== undefined) rawNrForThisPhoto = snap.nativeNr ? 'fast' : 'off';
        if (snap.demosaicAlgo !== undefined) demosaicAlgoForThisPhoto = snap.demosaicAlgo;
      } catch (e) {
        if (typeof log === 'function') log(`Recipe parse failed for ${path}: ${e}`, 'warn');
        if (typeof toast === 'function') toast(`Couldn't restore edits for ${baseName(path)} — reverted to defaults`, false);
        /* fall through to default */
      }
    }
    // Carries the TRUE saved tier, including 'high', so the NR panel's select and Denoise-now
    // button correctly reflect the photo's own saved preference — NativeLibRawShim.open() does
    // its OWN clamp to 'off'/'fast' before ever talking to decode_raw_v2 (see its comment), so
    // setting the real value here does not risk an automatic High-tier decode.
    window.chromasmithRawNr = rawNrForThisPhoto;
    window.chromasmithDemosaicAlgo = demosaicAlgoForThisPhoto;
    // Persistent decode cache ("photos re-decode on every relaunch"): the in-memory imgCache
    // above only survives within THIS session. For a RAW that isn't in it (first open, or a
    // fresh app launch), check the on-disk cache — a quality-95 JPEG of the fully-decoded
    // result keyed on path+mtime+size+recipe (see library.rs's get_decode_cache) — before
    // falling back to the full native RAW pipeline. A hit is a plain JPEG decode (~100-200ms)
    // instead of several seconds of demosaic+NR.
    const isRaw = RAW_EXT_RE.test(path);
    const recipeKey = isRaw ? rawRecipeKey() : '';
    let diskCached = null;
    if (!cached && isRaw) {
      try {
        const jpegBuf = await invoke('get_decode_cache', { path, recipeKey });
        const bmp = await createImageBitmap(new Blob([jpegBuf], { type: 'image/jpeg' }));
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        // The cache itself is a re-encoded JPEG, but the SOURCE FILE is the real RAW — ext/exif
        // must reflect that (showExif reads it.ext for "File Format" and it.exif for the EXIF
        // rows), or a reopened RAW from this cache path shows "JPG" with blank metadata even
        // though the fresh-decode path (below) gets it right.
        const realExt = (path.match(/\.([^.\/]+)$/) || [, 'jpg'])[1].toLowerCase();
        const m = await getMeta(path).catch(() => ({}));
        diskCached = {
          img: c, name: baseName(path).replace(/\.[^.]+$/, ''), ext: realExt, dpi: 240, bytes: null,
          exif: { iso: m.iso, aperture: m.aperture, shutter: m.shutter, focalLen: m.focal_len,
                   date: m.date, lens: m.lens, make: m.make, model: m.model },
        };
      } catch (e) {
        if (typeof log === 'function') log(`Decode cache read failed for ${path}: ${e}`, 'warn');
        /* no cache yet, or it's stale — fall through to a full decode below */
      }
    }
    try {
      if (cached) {
        cached.ts = Date.now(); // touch for LRU
        installFXImages([cached.entry], cached.loadKey);
      } else if (diskCached) {
        const loadKey = `${baseName(path)}:diskcache:${recipeKey}`;
        installFXImages([diskCached], loadKey);
        imgCacheStore(path, diskCached, loadKey); // warm the in-memory cache too, for this session
      } else {
        const buf = await invoke('read_file_bytes', { path });
        // lastModified:0 (not the default Date.now()) — chromasmith-22.html's loadFXImages()
        // keys "is this the same photo already loaded" off name+size+lastModified so it knows
        // whether to reset per-photo state (export version, All-FX toggles) on load. A File
        // built fresh from read_file_bytes on every reopen would otherwise get a new
        // lastModified each time (today's timestamp), making the SAME photo look like a
        // different one on every single reopen and defeating that check entirely.
        const file = new File([buf], baseName(path), { type: mimeFromName(path), lastModified: 0 });
        await loadFXImages([file]); // bare identifier — see desktop-native.js's note on this
        if (fxImages[0]) {
          fxImages[0].fileSize = buf.byteLength; // shown as the "Size" row in the metadata panel
          const loadKey = `${baseName(path)}:${buf.byteLength}:0`; // must match loadFXImages' own key formula
          imgCacheStore(path, fxImages[0], loadKey);
          // Write the disk cache in the background — best-effort, never blocks the UI. Only for
          // RAWs (a JPEG/PNG/TIFF decode is already fast; caching those buys nothing). Waits a
          // beat for the two-phase RAW decode's background NR refine (desktop-native.js) to
          // land first, so the CACHED copy is full quality, not the fast/no-NR first pass.
          if (isRaw && fxImages[0].img) {
            // Capture THIS photo's canvas now — the timeout used to re-read fxImages[0] when it
            // fired, so opening another photo within 1.5s encoded the NEW photo's canvas and
            // wrote it under the OLD photo's path+recipeKey, silently poisoning the cache (the
            // wrong image would come back on every future open of that path). The openedPath
            // check is a second guard for the same race on the invoke side.
            const cachedCanvas = fxImages[0].img;
            setTimeout(() => {
              if (state.openedPath !== path) return; // user moved on — don't cache a stale/wrong frame
              if (!cachedCanvas.toBlob) return;
              cachedCanvas.toBlob((blob) => {
                if (!blob) return;
                blob.arrayBuffer().then((ab) => {
                  if (state.openedPath !== path) return;
                  framedInvoke('save_decode_cache', { path, recipeKey }, new Uint8Array(ab))
                    .catch((e) => console.error('save_decode_cache', e));
                });
              }, 'image/jpeg', 0.95);
            }, 1500);
          }
        }
      }
      state.openedPath = path;
      // The editor needs the ORIGINAL file path to read its HDR gain map at export
      // time (see gainmap.rs) — loadFXImages only ever receives a File, which has none.
      window.chromasmithSourcePath = path;
      state.openedPaths = [];
      invoke('touch_recent', { path }).then(() => { if (state.source === 'recents') renderCollectionCounts(); }).catch(() => {});
      if (sc.recipe) {
        try {
          applyUISnapshot(snapshotFromB64(sc.recipe));
          // A recipe saved before the RAW-defaults feature existed carries nr-col:0 (its
          // honest value at save time), which just clobbered whatever applyRawDefaults() set
          // moments ago inside loadFXImages — silently undoing the Color NR 25 default on
          // every previously-edited photo. applyRawDefaults() only fills sliders still at 0,
          // so re-running it here backfills stale recipes without touching one that
          // intentionally set NR to something else.
          if (typeof applyRawDefaults === 'function') applyRawDefaults();
          fxUpdate();
        } catch (e) { console.error('restore recipe', e); }
      }
      // Real metadata (camera/lens/shutter/aperture/iso/date) via rawler on the Rust side —
      // the editor's own RW2 branch attaches none, so without this #fx-exif stays empty.
      try {
        const m = await getMeta(path);
        if (typeof showExif === 'function' && fxImages[0]) {
          const exif = {
            model: m.model || m.camera || '', make: m.make || '',
            lens: m.lens || '', shutter: m.shutter || '', aperture: m.aperture || '',
            iso: m.iso ? `ISO ${m.iso}` : '', focalLen: m.focal_len || '', date: m.date || '',
          };
          fxImages[0].exif = exif;
          showExif(exif);
          // The lens-auto status line reads exif.lens for its message text — refresh it now
          // that metadata has actually landed (it may have shown "still loading" a moment ago).
          if (typeof window.chromasmithLensStatusRefresh === 'function') window.chromasmithLensStatusRefresh();
        }
      } catch (e) { console.error('load metadata', e); }
      // Docked layout: the panel stays open next to the editor; just mark the active card.
      overlay.querySelectorAll('.lib-card.sel').forEach((c) => c.classList.remove('sel'));
      const card = overlay.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
      if (card) card.classList.add('sel');
    } catch (e) {
      console.error('openInEditor', e);
      if (typeof toast === 'function') toast(`Couldn't open ${baseName(path)} — ${friendlyRawError(e)}`, false);
    } finally {
      const hideProvisional = await provisionalPromise;
      hideProvisional();
      if (spin) spin.style.display = 'none';
      // If the decode failed (loadFXImages never replaced the spinner with dimensions),
      // don't leave the deskbar spinner running forever.
      const st = document.getElementById('db-title-status');
      if (st && st.classList.contains('spin') && typeof fxDeskbarTitle === 'function') fxDeskbarTitle(undefined, '', false);
    }
  }

  // ── auto-persist: any edit to a library-opened photo silently saves a non-destructive
  // recipe (the same FX snapshot the undo history and session-save use) into its XMP
  // sidecar and marks it "edited" — even before export. The DISK write is still debounced
  // (a slider drag writes once, not per frame), but the "edited" badge itself now appears
  // the instant an edit happens, not up to 2s later — and previously it didn't appear at
  // all until the whole grid was rebuilt (renderGrid() was the only place the badge markup
  // was ever produced), i.e. you'd have to leave the folder and come back to see it.
  // No-op for photos not opened from the Library (state.openedPath ''). ──
  function markCardEdited(path) {
    const card = overlay.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card && !card.querySelector('.lib-edited-badge')) {
      card.insertAdjacentHTML('beforeend', EDITED_BADGE_HTML);
    }
  }
  // ── refresh a card's grid thumbnail from the LIVE preview canvas (the graded/edited result),
  // not the raw camera-JPEG the disk thumbnail cache holds — so the filmstrip/grid shows the
  // latest edit once you move away from a photo, instead of the unedited RAW forever. Session-
  // only: it just swaps the <img> src client-side, never touches the Rust-side thumbnail cache. ──
  const thumbBlobUrls = new Map(); // path -> last objectURL, so we can revoke it
  function refreshCardThumbFromCanvas(path) {
    // Zoomed-in (fxZoom>1), the 1:1 loupe, and interactive crop all leave only a CROPPED
    // sub-region of the frame in the live canvas's backing store (renderFullResCrop /
    // renderLoupe) — grabbing it here would silently overwrite the Library thumbnail with a
    // zoomed crop instead of the full photo. Skip the refresh in that state; the thumbnail
    // just stays as it was until the next safe (zoomed-out) edit.
    if ((typeof fxZoom !== 'undefined' && fxZoom > 1) || (typeof fxLoupe !== 'undefined' && fxLoupe) || (typeof cropMode !== 'undefined' && cropMode)) return;
    const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    // Borders / the Canvas matte are composited onto a SEPARATE overlay canvas (#fx-canvas-bd,
    // see chromasmith-22.html's applyPreviewBorders) which is shown INSTEAD of #fx-canvas while
    // active (#fx-canvas gets display:none) — grabbing #fx-canvas unconditionally silently
    // dropped borders/canvas-matte edits from the library thumbnail. Use whichever is visible.
    const bd = document.getElementById('fx-canvas-bd');
    const cv = (bd && bd.style.display !== 'none' && bd.width && bd.height) ? bd : document.getElementById('fx-canvas');
    if (!card || !cv || !cv.width || !cv.height) return;
    const img = card.querySelector('img');
    if (!img) return;
    const LONG_EDGE = 360;
    const scale = LONG_EDGE / Math.max(cv.width, cv.height);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cv.width * scale));
    out.height = Math.max(1, Math.round(cv.height * scale));
    out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
      if (!blob) return;
      const prev = thumbBlobUrls.get(path);
      const url = URL.createObjectURL(blob);
      thumbBlobUrls.set(path, url);
      img.src = url;
      if (prev) URL.revokeObjectURL(prev);
    }, 'image/jpeg', 0.85);
  }

  let saveTimer, pendingSave = null;
  async function flushPendingSave() {
    if (!pendingSave) return;
    clearTimeout(saveTimer);
    const { paths, snap, thumbPath } = pendingSave;
    pendingSave = null;
    await Promise.all(paths.map(async (path, i) => {
      // FX/adjustments are shared, but geometry is per-photo (see chromasmith-22.html's
      // geomApplyToAll) — the snapshot captured at edit time reflects only the CURRENTLY
      // previewed photo's crop/rotate/flip/straighten, so swap in this path's own geom before
      // persisting its sidecar or a batch edit would silently overwrite every other photo's
      // saved crop with whichever one happened to be on screen. Basic Adjustments can ALSO be
      // made independent per photo (adjToggleScope/"This photo only") — if this photo has its
      // own override, patch its Adjust sliders + the independence flag in too, same reasoning.
      const it = fxImages[i];
      const perPhotoSnap = { ...snap };
      if (it && it.geom) perPhotoSnap.geom = JSON.parse(JSON.stringify(it.geom));
      if (it && it.adjustOverride) {
        perPhotoSnap.sliders = { ...snap.sliders };
        ADJ_FIELDS.forEach((f) => { perPhotoSnap.sliders['adj-' + f] = it.adjustOverride[f]; });
        perPhotoSnap.adjustIndependent = true;
      } else {
        perPhotoSnap.adjustIndependent = false;
      }
      const recipe = snapshotToB64(perPhotoSnap);
      const cur = await getSidecar(path);
      const updated = { ...cur, edited: true, recipe };
      state.sidecars.set(path, updated);
      await invoke('set_sidecar', { path, rating: cur.rating, label: cur.label, edited: true, recipe }).catch((e) => console.error('auto-save recipe', e));
    }));
    // The live canvas only ever shows ONE photo (the currently previewed one) — refreshing
    // every batch photo's thumbnail from it would overwrite the rest with the wrong image.
    if (thumbPath) refreshCardThumbFromCanvas(thumbPath);
  }
  window.chromasmithOnEdit = (snap) => {
    // FX/adjustments apply to the whole batch automatically, so a batch edit persists against
    // every open photo — mirrors chromasmithRecordExport's existing batch behavior — instead of
    // doing nothing just because no single `openedPath` is set (the old bug: batch edits never
    // got a badge, sidecar, or history at all). Geometry is patched in per-photo in
    // flushPendingSave above.
    const paths = state.openedPath ? [state.openedPath] : (state.openedPaths || []);
    if (!paths.length) return;
    const thumbPath = state.openedPath || (state.openedPaths && state.openedPaths[fxCurIdx]) || null;
    paths.forEach((path) => {
      const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false, recipe: '' };
      if (!cur.edited) { state.sidecars.set(path, { ...cur, edited: true }); markCardEdited(path); }
    });
    clearTimeout(saveTimer);
    pendingSave = { paths, snap, thumbPath };
    saveTimer = setTimeout(flushPendingSave, 2000);
  };
  // A pending write must not be silently dropped by switching photos (or quitting) inside
  // the 2s debounce window — flush it immediately whenever either happens.
  window.addEventListener('beforeunload', flushPendingSave);

  // ── folder tree ────────────────────────────────────────────────────────────
  async function renderTree() {
    const side = document.getElementById('lib-tree');
    side.innerHTML = '';
    if (!state.root) { side.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--mut)">Choose a folder to browse.</div>'; return; }
    const rootNode = await buildTreeNode(state.root);
    side.appendChild(rootNode);
  }
  // buildTreeNode re-runs for EVERY expanded node on EVERY tree redraw (renderTree() re-renders
  // the whole tree on any row click anywhere in it) — without this cache, expanding/collapsing
  // one node re-stats every other already-expanded folder's contents too. Cached per-session;
  // invalidated for a path when openFolder() is actually asked to (re-)list it.
  const _treeListCache = new Map();
  async function listDirCached(path) {
    if (_treeListCache.has(path)) return _treeListCache.get(path);
    const entries = await invoke('list_dir', { path });
    _treeListCache.set(path, entries);
    return entries;
  }
  async function buildTreeNode(path) {
    const wrap = document.createElement('div');
    wrap.className = 'lib-tree-node';
    const row = document.createElement('div');
    row.className = 'lib-tree-row' + (state.currentFolder === path ? ' on' : '');
    const isExpanded = state.expanded.has(path);
    row.innerHTML = `<span class="lib-tree-chev">${isExpanded ? '▾' : '▸'}</span><span>📁 ${baseName(path) || path}</span>`;
    row.onclick = async (e) => {
      e.stopPropagation();
      if (state.expanded.has(path)) state.expanded.delete(path); else state.expanded.add(path);
      await openFolder(path);
      await renderTree();
    };
    wrap.appendChild(row);
    if (isExpanded) {
      try {
        const entries = await listDirCached(path);
        const childWrap = document.createElement('div');
        childWrap.className = 'lib-tree-children';
        for (const e of entries.filter((e) => e.is_dir)) {
          childWrap.appendChild(await buildTreeNode(e.path));
        }
        wrap.appendChild(childWrap);
      } catch (e) { /* unreadable folder (permissions etc) — skip its children */ }
    }
    return wrap;
  }

  // ── grid ────────────────────────────────────────────────────────────────────
  async function getSidecar(path) {
    if (state.sidecars.has(path)) return state.sidecars.get(path);
    const sc = await invoke('get_sidecar', { path }).catch(() => ({ rating: 0, label: '', edited: false, recipe: '' }));
    state.sidecars.set(path, sc);
    return sc;
  }
  async function getMeta(path) {
    if (state.meta.has(path)) return state.meta.get(path);
    const m = await invoke('get_meta', { path }).catch(() => ({ camera: null, lens: null, date: null, iso: null }));
    state.meta.set(path, m);
    return m;
  }

  // ── C2: duplicate detection (perceptual-hash clustering) ─────────────────────────────
  // 64-bit dHashes come back as 16-char hex strings (see phash_batch's Rust doc comment — a
  // raw u64 JSON number can exceed JS's 2^53 safe-integer range and silently corrupt Hamming
  // distance). Compared as BigInt.
  function hammingHex(a, b) {
    let x = BigInt('0x' + a) ^ BigInt('0x' + b);
    let n = 0n;
    while (x) { n += x & 1n; x >>= 1n; }
    return Number(n);
  }
  /// Population count of a 32-bit int — the standard SWAR bit-twiddle, no allocation, no loop.
  function popcount32(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  const DUPE_HAMMING_THRESHOLD = 6;
  // Union-find over the folder's hashes.
  //
  // ⚠️ The union-find is not the expensive part — the PAIRWISE HAMMING is, and it is O(n^2).
  // Measured: opening a synthetic 5,000-file folder took 41.9s, effectively all of it here,
  // because the original inner comparison called hammingHex, which allocated TWO BigInts from
  // hex strings per pair and then counted bits one at a time in a `while (x)` loop — about 64
  // BigInt operations and 2 allocations, 12.5 million times.
  //
  // The fix is entirely constant-factor: parse each 64-bit hash ONCE into a hi/lo pair of plain
  // 32-bit ints, then compare with two XORs and two SWAR popcounts. Same clusters out, no
  // allocation in the loop. hammingHex is kept because the hex form is what phash_batch returns
  // and it remains the readable reference for what this is computing.
  function clusterByHash(pairs) {
    const parent = new Map();
    const find = (p) => { while (parent.get(p) !== p) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); } return p; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    pairs.forEach(([p]) => parent.set(p, p));
    const n = pairs.length;
    const hi = new Int32Array(n), lo = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const h = pairs[i][1] || '';
      hi[i] = parseInt(h.slice(0, 8), 16) | 0;
      lo[i] = parseInt(h.slice(8, 16), 16) | 0;
    }
    for (let i = 0; i < n; i++) {
      const ai = hi[i], bi = lo[i];
      for (let j = i + 1; j < n; j++) {
        if (popcount32(ai ^ hi[j]) + popcount32(bi ^ lo[j]) <= DUPE_HAMMING_THRESHOLD) union(pairs[i][0], pairs[j][0]);
      }
    }
    const groups = new Map(); // root -> [paths]
    pairs.forEach(([p]) => {
      const r = find(p);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(p);
    });
    return groups;
  }
  let _dupeToken = 0;
  // Runs in the background after openFolder's meta pass, behind the same staleness guard
  // (_openToken/currentFolder/source) so switching folders fast never lets a stale batch
  // overwrite the new folder's clusters.
  async function runDupeDetection(paths, openToken) {
    const myToken = ++_dupeToken;
    if (!paths.length) { state.dupeClusters.clear(); state.dupeClusterSizes.clear(); return; }
    let pairs;
    try { pairs = await invoke('phash_batch', { paths }); } catch (e) { console.error('phash_batch', e); return; }
    if (myToken !== _dupeToken || state._openToken !== openToken || state.source !== 'folder') return; // user moved on
    const groups = clusterByHash(pairs);
    state.dupeClusters.clear(); state.dupeClusterSizes.clear();
    let clusterId = 0;
    groups.forEach((members) => {
      if (members.length < 2) return;
      clusterId++;
      state.dupeClusterSizes.set(clusterId, members.length);
      members.forEach((p) => state.dupeClusters.set(p, clusterId));
    });
    // Cross-folder registry mirrors the current view — a passive record only, never destructive.
    Promise.all(paths.map((p) => invoke('registry_set_cmd', { name: 'duplicates', path: p, present: state.dupeClusters.has(p) }).catch(() => {})))
      .then(() => renderCollectionCounts());
    renderGrid();
  }

  // ── C3: Google-Photos-synced badge ────────────────────────────────────────────────────
  window.chromasmithRecordSynced = async (paths) => {
    if (!Array.isArray(paths)) return;
    for (const p of paths) {
      try { await invoke('registry_set_cmd', { name: 'gphotos', path: p, present: true }); } catch (e) { console.error('registry_set_cmd(gphotos)', e); }
      state.syncedPaths.add(p);
    }
    renderCollectionCounts();
    renderGrid();
  };
  // Loads the synced-paths registry once and intersects with the current folder's entries so
  // the ☁ badge/filter know which of THIS folder's photos are already synced. Mirrors the
  // sidecar-fetch pattern (a single background invoke, not per-path).
  async function loadSyncedForFolder(entries, openToken) {
    try {
      const list = await invoke('list_collection', { name: 'gphotos' });
      if (state._openToken !== openToken || state.source !== 'folder') return;
      const known = new Set((list || []).map((e) => e.path));
      entries.forEach((e) => { if (known.has(e.path)) state.syncedPaths.add(e.path); });
      renderGrid();
    } catch (e) { /* best-effort */ }
  }
  async function markFolderSyncedIfGphotosDownloads(path, entries) {
    try {
      const gDir = await gphotosDownloadsDir();
      if (!gDir || path !== gDir) return;
      // Files living in the Google Photos import-download folder are by definition already
      // mirrored there — mark every photo in it as synced on open.
      await Promise.all(entries.map((e) => invoke('registry_set_cmd', { name: 'gphotos', path: e.path, present: true }).catch(() => {})));
      entries.forEach((e) => state.syncedPaths.add(e.path));
      renderCollectionCounts();
    } catch (e) { /* best-effort */ }
  }

  // ── scroll-position persistence ───────────────────────────────────────────────────────────
  // openFolder() rebuilds #lib-grid from scratch (grid.innerHTML = libSkeletonHtml()) on every
  // call, INCLUDING re-opening the same folder — e.g. toggleLibrary() re-runs openFolder every
  // time the dock is shown again, so simply editing a photo and coming back used to always land
  // back at the top of the grid. Keyed by folder path (not a single "last scroll") so hopping
  // between folders in the tree/recents doesn't clobber each folder's own position.
  const scrollByFolder = new Map();
  function wireScrollPersist() {
    const libMain = document.getElementById('lib-main');
    if (!libMain) return;
    let raf = 0;
    libMain.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (state.currentFolder) scrollByFolder.set(state.currentFolder, libMain.scrollTop);
      });
    }, { passive: true });
  }
  async function openFolder(path) {
    if (compareState.active) exitCompareMode(); // switching folders while comparing would strand the panes on the old batch
    state.currentFolder = path;
    state.source = 'folder'; // leaving a collection/cloud view — clears their sidebar highlight below
    state.selected.clear();
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let entries;
    try {
      entries = await invoke('list_dir', { path });
      _treeListCache.set(path, entries); // opening a folder is the natural "refresh its listing" moment
    } catch (e) {
      grid.innerHTML = `<div id="lib-empty">Can't read this folder.</div>`;
      return;
    }
    state.entries = entries.filter((e) => e.is_image || e.is_video);
    // Sidecars are cheap (small JSON reads) and flags/edited badges need them for first paint —
    // await those. Metadata is NOT cheap on a cold folder (a get_meta cache miss reads the whole
    // RAW file for the lens fallback), and awaiting it for EVERY file kept the grid on
    // "Loading…" until the last file finished — a big folder took tens of seconds before
    // showing anything. Render immediately instead and let meta land in the background, then
    // refresh filters + grid once so sort-by-ISO/camera-filter pick it up.
    await Promise.all(state.entries.map((e) => getSidecar(e.path)));
    const openToken = (state._openToken = (state._openToken || 0) + 1);
    state.dupeClusters.clear(); state.dupeClusterSizes.clear();
    await renderGrid();
    const libMain = document.getElementById('lib-main');
    if (libMain) libMain.scrollTop = scrollByFolder.get(path) || 0;
    if (typeof renderCollections === 'function') renderCollections(); // drop stale collection/album highlight
    // Duplicate detection + sync-status backfill run in the background, gated on the same
    // openToken so a fast folder switch never lets stale results overwrite the new grid.
    runDupeDetection(state.entries.map((e) => e.path), openToken);
    loadSyncedForFolder(state.entries, openToken);
    markFolderSyncedIfGphotosDownloads(path, state.entries);
    Promise.all(state.entries.map((e) => getMeta(e.path).catch(() => ({})))).then(() => {
      // source check: without it, opening a folder then clicking a Lightroom album while this
      // background meta pass was still running clobbered the cloud grid seconds later.
      if (state._openToken !== openToken || state.currentFolder !== path || state.source !== 'folder') return; // user moved on
      populateSelect(document.getElementById('lib-camera-filter'), state.entries.map((e) => state.meta.get(e.path)?.camera), 'All cameras');
      populateSelect(document.getElementById('lib-lens-filter'), state.entries.map((e) => state.meta.get(e.path)?.lens), 'All lenses');
      {
        // ISO needs a NUMERIC sort (100 < 1600 < 6400), unlike camera/lens names — populateSelect's
        // plain .sort() would put "1600" before "200" lexicographically, so build this one by hand.
        const sel = document.getElementById('lib-iso-filter');
        const cur = sel.value;
        const distinct = Array.from(new Set(state.entries.map((e) => state.meta.get(e.path)?.iso).filter(Boolean))).sort((a, b) => (+a) - (+b));
        sel.innerHTML = '<option value="all">All ISOs</option>' + distinct.map((v) => `<option value="${v}">ISO ${v}</option>`).join('');
        sel.value = distinct.includes(cur) ? cur : 'all';
      }
      renderGrid();
    });
  }

  // ── sort ────────────────────────────────────────────────────────────────────
  function sortKeyOf(entry) {
    const sc = state.sidecars.get(entry.path) || { edited: false };
    const m = state.meta.get(entry.path) || {};
    switch (state.sortBy) {
      case 'mtime': return entry.mtime || 0;
      case 'date': return m.date || '';
      case 'iso': return m.iso || 0;
      case 'shutter': return (m.shutter || '').startsWith('1/') ? -1 / parseFloat(m.shutter.slice(2) || '1') : parseFloat(m.shutter) || 0;
      case 'aperture': return parseFloat((m.aperture || '').replace('f/', '')) || 0;
      case 'focal': return parseFloat(m.focal_len || '') || 0;
      case 'edited': return sc.edited ? 1 : 0;
      case 'editedts': return entry.edited_ts || 0;
      case 'camera': return (m.camera || '').toLowerCase();
      default: return (entry.name || '').toLowerCase();
    }
  }
  function sortEntries(list) {
    const dir = state.sortDir === 'desc' ? -1 : 1;
    // Decorate-sort: compute each entry's sort key once up front instead of re-deriving it
    // (map lookups + string/number coercion) on every comparator call during the O(n log n) sort.
    return list.map((entry) => [sortKeyOf(entry), entry])
      .sort((a, b) => (a[0] < b[0] ? -1 * dir : a[0] > b[0] ? 1 * dir : 0))
      .map((pair) => pair[1]);
  }

  function metaStripHtml(entry) {
    if (state.metaDisplay === 'off') return '';
    const m = state.meta.get(entry.path) || {};
    const parts = [m.iso ? `ISO ${m.iso}` : '', m.shutter || '', m.aperture || '', m.focal_len || ''].filter(Boolean);
    if (!parts.length) return '';
    const cls = state.metaDisplay === 'always' ? 'always-mode' : 'hover-mode';
    return `<div class="lib-meta-strip ${cls}">${parts.join(' · ')}</div>`;
  }

  function passesFilters(entry) {
    const sc = state.sidecars.get(entry.path) || { rating: 0, label: '', edited: false };
    const m = state.meta.get(entry.path) || {};
    if (state.typeFilter !== 'all' && entry.kind !== state.typeFilter) return false;
    if (state.cameraFilter !== 'all' && m.camera !== state.cameraFilter) return false;
    if (state.lensFilter !== 'all' && m.lens !== state.lensFilter) return false;
    if (state.isoFilter !== 'all' && String(m.iso || '') !== state.isoFilter) return false;
    if (state.dupeFilter === 'dupes' && !state.dupeClusters.has(entry.path)) return false;
    if (state.syncedFilter === 'synced' && !state.syncedPaths.has(entry.path)) return false;
    if (state.syncedFilter === 'notsynced' && state.syncedPaths.has(entry.path)) return false;
    if (state.search && !entry.name.toLowerCase().includes(state.search)) return false;
    if (state.tagFilter === 'red' && sc.label !== 'Red') return false;
    if (state.tagFilter === 'green' && sc.label !== 'Green') return false;
    if (state.tagFilter === 'edited' && !sc.edited) return false;
    if (state.tagFilter === 'noedited' && sc.edited) return false;
    if (state.tagFilter === 'favorite' && !sc.favorite) return false;
    return true;
  }

  // ── flag mutation, factored so both the per-card flag clicks AND the
  // multi-select context menu can apply the same write+cache+redraw logic. ─────────────────
  // A failed sidecar write (read-only volume, permissions, disk full) used to be swallowed by
  // `.catch(() => {})` while the UI updated optimistically — the flag LOOKED set but silently
  // vanished on relaunch, losing culling work with no hint why. Surface it and roll back.
  function sidecarWriteFailed(path, prev, e) {
    state.sidecars.set(path, prev);
    console.error('set_sidecar failed', path, e);
    if (typeof toast === 'function') toast('Could not save flag/edit state — is this folder writable?', false);
    else if (typeof log === 'function') log(`Sidecar write failed for ${path}: ${e}`, 'warn');
  }
  async function setLabel(path, label) {
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false };
    const updated = { ...cur, label };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating: updated.rating, label, edited: updated.edited })
      .catch((e) => sidecarWriteFailed(path, cur, e));
    const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card) {
      card.querySelector('.lib-flags').innerHTML = flagsHtml(label, updated.favorite);
      card.classList.toggle('flag-red', label === 'Red');
      card.classList.toggle('flag-green', label === 'Green');
    }
    if (typeof renderCollectionCounts === 'function') renderCollectionCounts(); // flagged/rejected counts changed
  }
  // Mirrors setLabel() above but for the favorite heart — same optimistic-update +
  // sidecar-write + rollback pattern, kept separate since favorite is independent of
  // (and can coexist with) a Red/Green flag.
  async function setFavorite(path, favorite) {
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false, favorite: false };
    const updated = { ...cur, favorite };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating: updated.rating, label: updated.label, edited: updated.edited, favorite })
      .catch((e) => sidecarWriteFailed(path, cur, e));
    const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card) card.querySelector('.lib-flags').innerHTML = flagsHtml(updated.label, favorite);
    renderCollectionCounts();
  }
  // Exposed so the main editor toolbar (chromasmith-22.html's top bar) can flag the
  // CURRENTLY OPEN photo without needing the Library panel open — same underlying
  // setLabel() the grid's own flag icons and context menu use, so it stays in sync either way.
  window.chromasmithToggleFlag = async (label) => {
    const path = state.openedPath;
    if (!path) return;
    const cur = await getSidecar(path);
    await setLabel(path, cur.label === label ? '' : label);
  };
  window.chromasmithOpenedFlag = () => {
    const path = state.openedPath;
    return path ? (state.sidecars.get(path) || {}).label || '' : '';
  };
  // Same open-photo bridge as chromasmithToggleFlag/chromasmithOpenedFlag above, for the
  // favorite heart.
  window.chromasmithToggleFavorite = async () => {
    const path = state.openedPath;
    if (!path) return;
    const cur = await getSidecar(path);
    await setFavorite(path, !cur.favorite);
  };
  window.chromasmithOpenedFavorite = () => {
    const path = state.openedPath;
    return path ? !!(state.sidecars.get(path) || {}).favorite : false;
  };
  // ── Lightroom "Edit In" handoff ──────────────────────────────────────────────────────────
  // File(s) handed to us by Launch Services (Lightroom's "Edit In" — which can hand off SEVERAL
  // selected photos at once, Finder's "Open With", or a direct `open -a Chromasmith file.tif`)
  // — see main.rs's PendingOpen/take_pending_open_path (cold-launch case, pulled once below
  // since an emitted event this early could arrive before any listener is attached) and the
  // "open-file-path" event (already-running-app case, where a listener reliably already
  // exists). Both now carry an ARRAY of paths (a single-file handoff is just a 1-element
  // array) — previously only the LAST file of a multi-select Edit-In survived at all.
  async function openEditInHandoff(paths) {
    if (!paths || !paths.length) return;
    try {
      if (paths.length === 1) {
        const [path] = paths;
        const buf = await invoke('read_file_bytes', { path });
        const file = new File([buf], baseName(path), { type: mimeFromName(path), lastModified: 0 });
        await loadFXImages([file]);
        window.chromasmithEditInPath = path;
        state.openedPath = path;
        window.chromasmithSourcePath = path;
      // The editor needs the ORIGINAL file path to read its HDR gain map at export
      // time (see gainmap.rs) — loadFXImages only ever receives a File, which has none.
      window.chromasmithSourcePath = path;
        state.openedPaths = [];
        const sc = await getSidecar(path);
        if (sc.recipe) {
          try { applyUISnapshot(snapshotFromB64(sc.recipe)); if (typeof fxUpdate === 'function') fxUpdate(); }
          catch (e) { console.error('restore handoff recipe', e); }
        }
      } else {
        // Multi-file Edit-In: load as a batch (registers Recents for each — openPathsInEditor)
        // and restore each photo's own crop/masks/independent-adjust, same as "Export N photos".
        await openPathsInEditor(paths);
        window.chromasmithEditInPath = paths.slice(); // array form — see chromasmithSaveToLightroom's write-back loop
        for (let i = 0; i < paths.length; i++) {
          const sc = await getSidecar(paths[i]);
          if (!sc.recipe || !fxImages[i]) continue;
          try {
            const snap = snapshotFromB64(sc.recipe);
            if (snap.geom !== undefined) fxImages[i].geom = snap.geom ? JSON.parse(JSON.stringify(snap.geom)) : defGeom();
            if (snap.masks) fxImages[i].masks = JSON.parse(JSON.stringify(snap.masks));
            if (snap.adjustIndependent && snap.sliders) {
              const v = {}; ADJ_FIELDS.forEach((f) => { v[f] = snap.sliders['adj-' + f]; });
              fxImages[i].adjustOverride = v;
            }
          } catch (e) { console.error('restore handoff recipe', e); }
        }
      }
      const btn = document.getElementById('db-save-lr');
      if (btn) btn.style.display = '';
      // A photo handed off from Lightroom's "Edit in Chromasmith" used to bypass the Library
      // entirely — no Recents entry, no recent-folder entry. openPathsInEditor already handles
      // touch_recent for the multi-file branch; the single-file branch does it here.
      if (paths.length === 1) {
        invoke('touch_recent', { path: paths[0] }).then(() => { if (state.source === 'recents') renderCollectionCounts(); }).catch(() => {});
      }
      paths.forEach((path) => {
        const dir = path.replace(/[\\/][^\\/]*$/, '');
        if (dir && dir !== path) pushRecentFolder(dir);
      });
      const label = paths.length > 1 ? `${paths.length} photos` : baseName(paths[0]);
      if (typeof log === 'function') log(`Opened from Lightroom: ${label} — use "Save to Lightroom" when done`, 'ok');
      if (typeof toast === 'function') toast('Opened from Lightroom', true);
    } catch (e) {
      console.error('Edit-In handoff load failed', paths, e);
      if (typeof log === 'function') log(`Failed to open Lightroom handoff file(s): ${e && e.message || e}`, 'err');
    }
  }
  invoke('take_pending_open_path').then((paths) => { if (paths && paths.length) openEditInHandoff(paths); }).catch(() => {});
  window.__TAURI__.event.listen('open-file-path', (e) => { if (e && e.payload && e.payload.length) openEditInHandoff(e.payload); });

  // Recipe-only export/version history (see library.rs's get_export_history/
  // append_export_history) — a persisted, coarser-grained log distinct from the in-session
  // fxHistory undo stack: it only grows on a successful export and survives relaunches.
  window.chromasmithRecordExport = async (version, snap) => {
    // A multi-photo batch (Open N photos / Export N photos / cmd-dbl-click) clears openedPath
    // to '' (see the three call sites that set it) since there's no single "current" photo to
    // auto-persist to — but that previously ALSO made every export from a batch record nothing
    // at all in export history, for any photo in the batch, silently (caught below). Fall back
    // to openedPaths and log the same just-exported recipe against every photo in the batch —
    // not perfectly accurate for the "Export N photos" context-menu flow (which restores each
    // photo's own prior recipe before rendering, so the true per-photo recipes can differ), but
    // infinitely better than the previous blank history for every batch export.
    const path = state.openedPath;
    const paths = path ? [path] : (state.openedPaths || []);
    if (!paths.length) return;
    const recipe = snapshotToB64(snap);
    await Promise.all(paths.map((p) => invoke('append_export_history', { path: p, version, recipe }).catch((e) => console.error('append_export_history', p, e))));
    renderCollectionCounts(); // these photos may be newly counted in the "Exported" collection
  };
  // C3: lets chromasmith-22.html's export loop (which only has fxImages indices, not library
  // paths) map each rendered photo back to its ON-DISK source path, in the same order
  // fxImages was loaded — used to record which photo a successful Google Photos upload
  // actually came from (see gpUploadItems' call site / window.chromasmithRecordSynced).
  window.chromasmithGetOpenedPaths = () => (state.openedPath ? [state.openedPath] : (state.openedPaths || []));
  window.chromasmithGetExportHistory = async () => {
    const path = state.openedPath;
    if (!path) return [];
    return invoke('get_export_history', { path }).catch(() => []);
  };
  let grid; // set at the top of renderGrid; the helpers above close over it

  // ── multi-select: cmd/ctrl toggles one card, shift range-selects from the last-clicked
  // anchor (over the currently-shown/filtered order), plain click opens (and clears selection
  // — matches the existing single-click-opens behaviour so nothing regresses for the common
  // case). Right-click selects the card under the cursor if it isn't already selected, then
  // opens a context menu that applies rating/flag/open actions to the whole selection. ──────
  let selectAnchor = -1;
  function updateCardSelClasses() {
    grid.querySelectorAll('.lib-card').forEach((c) => c.classList.toggle('multi', state.selected.has(c.dataset.path)));
  }
  // Single click opens the editor immediately (no double-click needed). ⌘/Ctrl-click instead
  // multi-selects WITHOUT opening, building up a batch; ⌘/Ctrl-double-click opens that whole
  // batch selection in the editor. Shift-click range-selects (also without opening), extending
  // from the last ⌘-click/shift-click anchor — same anchor plain single-click opens don't move.
  // Force Touch discriminator (the user's requested "light tap = select, firm press = open").
  // Apple's non-standard MouseEvent.webkitForce: a real button press reads ≥ WEBKIT_FORCE_AT_
  // MOUSE_DOWN (1); a tap-to-click registers lower. Returns 'press' | 'tap' | null (no sensor —
  // mice, non-Force-Touch trackpads, the libtest browser → caller uses the click-again fallback).
  function classifyPress(e) {
    const f = e && e.webkitForce;
    if (typeof f !== 'number' || f <= 0) return null;
    const threshold = (typeof MouseEvent !== 'undefined' && MouseEvent.WEBKIT_FORCE_AT_MOUSE_DOWN) || 1;
    return f >= threshold ? 'press' : 'tap';
  }
  // Selection model (both grids): light tap selects, firm press opens. Where Force Touch isn't
  // available, degrade to "click selects; clicking the already-sole-selected card opens"
  // (double-click always opens). shift/cmd extend multi-select and never open.
  function handleCardClick(e, entry, idx, shown) {
    if (e.shiftKey && selectAnchor >= 0) {
      const [lo, hi] = [selectAnchor, idx].sort((a, b) => a - b);
      state.selected.clear();
      for (let i = lo; i <= hi; i++) state.selected.add(shown[i].path);
      updateCardSelClasses();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (state.selected.has(entry.path)) state.selected.delete(entry.path); else state.selected.add(entry.path);
      selectAnchor = idx;
      updateCardSelClasses();
      return;
    }
    const openIt = () => {
      if (entry.missing) { toast('This photo is no longer at ' + entry.path, false); return; }
      state.selected.clear(); updateCardSelClasses();
      openInEditor(entry.path);
    };
    const selectIt = () => {
      state.selected.clear(); state.selected.add(entry.path);
      selectAnchor = idx; state._kbCursor = entry.path; updateCardSelClasses();
    };
    const cls = classifyPress(e);
    if (cls === 'press') { openIt(); return; }
    if (cls === 'tap') { selectIt(); return; }
    // No force sensor: click-to-select, click-the-selected-again to open.
    if (state.selected.size === 1 && state.selected.has(entry.path)) openIt(); else selectIt();
  }
  // Plain double-click on a single (non-multi-selected) card is just a second single-click —
  // already opened by handleCardClick, nothing further to do here. ⌘/Ctrl-double-click opens
  // the CURRENT multi-selection as a batch (mirrors the context menu's "Open N photos").
  async function handleCardDblClick(e, entry) {
    // Plain double-click always opens (shortcut regardless of Force Touch); the single-image
    // case falls through to openInEditor below.
    if (!(e.metaKey || e.ctrlKey) && state.selected.size <= 1) {
      if (entry.missing) { toast('This photo is no longer at ' + entry.path, false); return; }
      openInEditor(entry.path); return;
    }
    // The two `click` events a double-click also fires each ran handleCardClick with the SAME
    // modifier held, which toggles this exact entry in/out of state.selected an ODD number of
    // times overall relative to before the gesture started — so whether this card ends up IN
    // the selection by the time dblclick fires depends on whether it was already selected
    // beforehand (a real, confirmed bug: double-clicking a card NOT already in the multi-
    // selection silently toggled it back OUT right before opening, excluding it from its own
    // batch open). Always re-add it here so the card you double-click is unconditionally part
    // of what opens, regardless of that toggle parity.
    state.selected.add(entry.path);
    const paths = Array.from(state.selected);
    if (paths.length <= 1) { if (entry.missing) { toast('This photo is no longer at ' + entry.path, false); return; } openInEditor(paths[0] || entry.path); return; }
    await openPathsInEditor(paths);
    state.selected.clear();
    updateCardSelClasses();
  }

  // Shared read for a batch-open/export: reads every path, logs+returns any that failed
  // instead of just console.error-ing them so a shrunk batch is never silently swallowed.
  async function readPathsAsFiles(paths) {
    const files = []; const failed = [];
    for (const p of paths) {
      try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: mimeFromName(p) })); }
      catch (e) { console.error('read_file_bytes', p, e); failed.push(p); }
    }
    if (failed.length) toast(`Could not read ${failed.length} of ${paths.length} photo(s)`, false);
    return files;
  }
  // Shared batch-open: reads paths, loads them into the editor, and registers each in Recents
  // (touch_recent) — batch opens used to skip this entirely, so an externally-opened or
  // multi-selected batch never showed up in the Recents smart collection.
  async function openPathsInEditor(paths) {
    const files = await readPathsAsFiles(paths);
    if (!files.length) return files;
    state.openedPath = '';
    window.chromasmithSourcePath = null;
    state.openedPaths = paths;
    await loadFXImages(files);
    // Seed shared FX (LUT/grain/halation/curves/etc.) from the first photo's saved recipe —
    // same reasoning as the "Export N photos" path below: without this the shared sliders
    // stay at whatever stale state the app was in, and exporting straight from here (without
    // first touching any slider) would silently render every photo unedited.
    try {
      const firstSc = await getSidecar(paths[0]);
      if (firstSc.recipe) {
        applyUISnapshot(snapshotFromB64(firstSc.recipe));
        if (typeof applyRawDefaults === 'function') applyRawDefaults();
      }
    } catch (e) { console.error('seed shared FX for batch open', e); }
    paths.forEach((p) => invoke('touch_recent', { path: p }).catch(() => {}));
    if (state.source === 'recents') renderCollectionCounts();
    return files;
  }

  let ctxMenu = null;
  function closeContextMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  document.addEventListener('click', closeContextMenu);
  async function showContextMenu(e, entry, shown) {
    e.preventDefault();
    if (!state.selected.has(entry.path)) {
      state.selected.clear();
      state.selected.add(entry.path);
      selectAnchor = shown.indexOf(entry);
      updateCardSelClasses();
    }
    buildPathsMenu(e.clientX, e.clientY, Array.from(state.selected), { includeOpen: true });
  }

  // Shared right-click menu for a set of photo paths — used by the library grid cards
  // (with an "Open" item) AND the editor preview itself (the currently-opened photo, no
  // "Open"). One builder so the two menus never drift apart.
  function buildPathsMenu(x, y, paths, opts = {}) {
    closeContextMenu();
    const n = paths.length;
    ctxMenu = document.createElement('div');
    ctxMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);' +
      'border-radius:8px;padding:4px;font-size:12px;color:var(--txt);font-family:var(--sans);min-width:180px;box-shadow:var(--lift-2)';
    const item = (label, fn) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      el.onmouseenter = () => { el.style.background = 'var(--bdr)'; };
      el.onmouseleave = () => { el.style.background = ''; };
      el.onclick = async (ev) => { ev.stopPropagation(); closeContextMenu(); await fn(); };
      ctxMenu.appendChild(el);
      return el;
    };
    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:var(--bdr);margin:4px 0'; ctxMenu.appendChild(s); };
    if (opts.includeOpen) {
      item(`Edit ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
        if (n <= 1) { await openInEditor(paths[0]); return; }
        await openPathsInEditor(paths); // batch: no single auto-persist target
      });
      sep();
    }
    item('Reject (X)', () => Promise.all(paths.map((p) => setLabel(p, 'Red'))));
    item('Pick (flag)', () => Promise.all(paths.map((p) => setLabel(p, 'Green'))));
    item('Clear flag', () => Promise.all(paths.map((p) => setLabel(p, ''))));
    sep();
    item('Reveal in Finder', () => invoke('reveal_in_finder', { path: paths[0] }).catch((e) => console.error('reveal_in_finder', e)));
    sep();
    item(`Export ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
      const files = await readPathsAsFiles(paths);
      if (!files.length) return;
      state.openedPath = '';
    window.chromasmithSourcePath = null;
      state.openedPaths = paths;
      await loadFXImages(files);
      // Seed the SHARED FX state (LUT/grain/halation/curves/HSL/adjustments — everything
      // getFXParams() reads off the DOM) from the first selected photo's own saved recipe.
      // Exporting straight from the Library grid (no photo currently open in this session)
      // used to leave the shared sliders at whatever stale/default state the app happened to
      // be in, so a cold batch export rendered every photo through an unedited pipeline —
      // geometry/masks/adjustOverride (restored per-photo below) survived, but the actual
      // look did not. One seed only: applying it per-photo would let the LAST photo's saved
      // FX silently overwrite every other photo's render (that's why the loop below stays
      // geom/masks/adjustOverride-only).
      try {
        const firstSc = await getSidecar(paths[0]);
        if (firstSc.recipe) {
          applyUISnapshot(snapshotFromB64(firstSc.recipe));
          if (typeof applyRawDefaults === 'function') applyRawDefaults();
        }
      } catch (e) { console.error('seed shared FX for batch export', e); }
      // Restore each photo's own saved CROP/MASKS/independent-ADJUST before exporting (all
      // three are per-photo — see chromasmith-22.html's geomApplyToAll/mskCopyToAll/
      // adjToggleScope).
      for (let i = 0; i < paths.length; i++) {
        const sc = await getSidecar(paths[i]);
        if (!sc.recipe || !fxImages[i]) continue;
        try {
          const snap = snapshotFromB64(sc.recipe);
          if (snap.geom !== undefined) fxImages[i].geom = snap.geom ? JSON.parse(JSON.stringify(snap.geom)) : defGeom();
          if (snap.masks) fxImages[i].masks = JSON.parse(JSON.stringify(snap.masks));
          if (snap.adjustIndependent && snap.sliders) {
            const v = {}; ADJ_FIELDS.forEach((f) => { v[f] = snap.sliders['adj-' + f]; });
            fxImages[i].adjustOverride = v;
          }
        } catch (e) { console.error('restore recipe', e); }
      }
      setExportScope(n > 1 ? 'all' : 'current');
      await exportFX();
    });
    const resetItem = item('Reset edit', () => {
      // Irreversible (no undo history survives closing the photo) — confirm, matching the
      // in-editor "Reset all" (fxResetAll) which already does. This context-menu path could
      // silently wipe edits on several selected photos at once with a single misclick.
      const label = n > 1 ? `${n} photos` : 'this photo';
      if (!window.confirm(`Reset edit${n > 1 ? 's' : ''} on ${label}? This cannot be undone.`)) return;
      return Promise.all(paths.map(async (p) => {
      const cur = await getSidecar(p);
      const updated = { ...cur, edited: false, recipe: '' };
      state.sidecars.set(p, updated);
      await invoke('set_sidecar', { path: p, rating: updated.rating, label: updated.label, edited: false, recipe: '' }).catch((e) => sidecarWriteFailed(p, cur, e));
      const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(p)}"]`);
      const badge = card && card.querySelector('.lib-edited-badge');
      if (badge) badge.remove();
      if (p === state.openedPath) { openInEditor(p); } // re-open to fall back to RAW defaults
      }));
    });
    if (!paths.some((p) => (state.sidecars.get(p) || {}).edited)) { resetItem.style.opacity = '.4'; resetItem.style.pointerEvents = 'none'; }
    sep();
    // ── Virtual copies: a second set of edits over the SAME file (no pixels duplicated).
    // Single selection only — "make a virtual copy of these 40 photos" is a different feature
    // with a different confirmation, and quietly doing it to a whole selection is not it.
    if (n === 1) {
      const vcPath = paths[0];
      const vsc = state.sidecars.get(vcPath) || {};
      const vers = vsc.versions || [];
      item(vers.length ? `New virtual copy (${vers.length} versions)` : 'New virtual copy', async () => {
        const name = window.prompt('Name this version', vers.length ? `Copy ${vers.length}` : 'Copy 1');
        if (name === null) return;
        try {
          const sc = await invoke('sidecar_add_version', { path: vcPath, name });
          state.sidecars.set(vcPath, sc);
          await renderGrid();
          if (vcPath === state.openedPath) openInEditor(vcPath);
          toast(`Created "${sc.versions[sc.active].name}"`, true);
        } catch (e) { toast('Could not create a virtual copy — ' + (e.message || e), false); }
      });
      // Switching versions is the common action once copies exist, so each gets its own row
      // rather than hiding behind a submenu.
      vers.forEach((v, i) => {
        const row = item(`${i === vsc.active ? '● ' : '○ '}${v.name}`, async () => {
          try {
            const sc = await invoke('sidecar_set_active_version', { path: vcPath, index: i });
            state.sidecars.set(vcPath, sc);
            await renderGrid();
            if (vcPath === state.openedPath) openInEditor(vcPath);  // re-open so the editor shows this version's edits
          } catch (e) { toast('Could not switch version — ' + (e.message || e), false); }
        });
        row.oncontextmenu = async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (!window.confirm(`Delete version "${v.name}"? This cannot be undone.`)) return;
          try {
            const sc = await invoke('sidecar_delete_version', { path: vcPath, index: i });
            state.sidecars.set(vcPath, sc);
            closeContextMenu(); await renderGrid();
          } catch (e) { toast('Could not delete version — ' + (e.message || e), false); }
        };
        row.title = 'Switch to this version — right-click to delete it';
      });
      sep();
    }
    item('Copy edit', async () => {
      const sc = await getSidecar(paths[0]);
      window.__copiedRecipe = sc.recipe || snapshotToB64(getUISnapshot());
      toast('Edit copied', true);
    });
    const pasteAllToPaths = async (recipe) => {
      await Promise.all(paths.map(async (p) => {
        const cur = await getSidecar(p);
        const updated = { ...cur, edited: true, recipe };
        state.sidecars.set(p, updated);
        await invoke('set_sidecar', { path: p, rating: updated.rating, label: updated.label, edited: true, recipe }).catch((e) => sidecarWriteFailed(p, cur, e));
        markCardEdited(p);
        if (p === state.openedPath) { try { applyUISnapshot(snapshotFromB64(recipe)); fxUpdate(); } catch (e) { console.error('paste edit', e); } }
      }));
    };
    const pasteItem = item('Paste edit', () => pasteAllToPaths(window.__copiedRecipe));
    // Selective paste (darktable idiom): pick WHICH parts of the copied recipe to apply instead
    // of all-or-nothing — e.g. paste just the grain+halation without also overwriting the LUT.
    // chromasmithPasteEditSelective (chromasmith-22.html) shows the category picker and hands
    // back one MERGED snapshot (current state + only the checked categories from the copy).
    const pasteSelItem = item('Paste edit (selective)…', () => {
      if (typeof window.chromasmithPasteEditSelective !== 'function') return;
      window.chromasmithPasteEditSelective(window.__copiedRecipe, (merged) => pasteAllToPaths(snapshotToB64(merged)));
    });
    if (!window.__copiedRecipe) {
      pasteItem.style.opacity = '.4'; pasteItem.style.pointerEvents = 'none';
      pasteSelItem.style.opacity = '.4'; pasteSelItem.style.pointerEvents = 'none';
    }
    sep();
    item(`Duplicate ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
      for (const p of paths) { try { await invoke('duplicate_file', { path: p }); } catch (e) { console.error('duplicate_file', p, e); toast('Could not duplicate ' + baseName(p)); } }
      if (state.currentFolder) await openFolder(state.currentFolder);
    });
    item(`🗑️ Delete ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
      const label = n > 1 ? `these ${n} photos` : `"${baseName(paths[0])}"`;
      if (!window.confirm(`Move ${label} to the Trash?`)) return;
      for (const p of paths) {
        try { await invoke('trash_file', { path: p }); state.sidecars.delete(p); state.meta.delete(p); imgCache.delete(p); }
        catch (e) { console.error('trash_file', p, e); toast('Could not delete ' + baseName(p)); }
      }
      state.selected.clear();
      if (state.currentFolder) await openFolder(state.currentFolder);
    });
    document.body.appendChild(ctxMenu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = Math.min(x, vw - r.width - 8) + 'px';
    ctxMenu.style.top = Math.min(y, vh - r.height - 8) + 'px';
  }

  // Right-click on the EDITOR preview: same menu for the photo currently open from the
  // library. chromasmith-22.html already preventDefault()s contextmenu on #fx-wrap (its
  // native long-press suppression), so this listener only has to build the menu. Capture
  // phase so it runs regardless of that handler; no-op when nothing library-opened.
  {
    // This script is injected right before </body>, so the DOM is already parsed here.
    const wrap = document.getElementById('fx-wrap');
    if (wrap) wrap.addEventListener('contextmenu', (e) => {
      if (!state.openedPath) return;
      e.preventDefault();
      buildPathsMenu(e.clientX, e.clientY, [state.openedPath], { includeOpen: false });
    });
  }

  async function renderGrid() {
    // Cloud album on screen: every filter/sort/search/view-mode handler funnels through here,
    // and rebuilding from state.entries (the previous FOLDER's files) would silently replace
    // the cloud grid. Delegate to the cloud renderer instead (lrState.assets, no refetch).
    if (state.source === 'lr') { if (typeof renderLrGrid === 'function') await renderLrGrid(); return; }
    grid = document.getElementById('lib-grid');
    grid.innerHTML = '';
    thumbQueueReset(); // drop queued thumbnail jobs from the previous grid/folder
    const overlayEl = document.getElementById('lib-overlay');
    const docked = document.body.classList.contains('deskx') && overlayEl && !overlayEl.classList.contains('full');
    const isList = state.viewMode === 'list' && !docked;
    grid.classList.toggle('list-view', isList);
    grid.style.setProperty('--lib-thumb', state.thumbSize + 'px');
    const listHead = document.getElementById('lib-list-head');
    if (listHead) { listHead.classList.toggle('on', isList); syncListHead(); }
    const shown = sortEntries(state.entries.filter(passesFilters));
    // ── Virtualisation ────────────────────────────────────────────────────────────────────
    // Measured (test/probe_grid.mjs, before this): 200 files = 5,114 DOM nodes, 1,000 = 17,914,
    // and 5,000 never finished loading at all — the page timed out at 30s. About 18 nodes per
    // card is fine for a shoot and fatal for a library, and "a year of photos" is the normal
    // case for the folder this tool points at.
    //
    // ⚠️ Below VIRT_MIN the OLD path runs unchanged. Virtualising a 40-photo folder buys nothing
    // and would put a scroll listener, a measurement pass and two spacer nodes between every
    // existing behaviour (drag-select, keyboard nav, the dupe badges) and its DOM. Small folders
    // keep exactly the code they had.
    state._virtAll = shown;
    const virtOn = shown.length >= VIRT_MIN && !isList;
    state._virtOn = virtOn;
    // Build every card into a detached DocumentFragment and append ONCE, instead of one
    // appendChild() per card — on a large folder that was one reflow per photo. Wiring
    // (thumbnail load, click/drag handlers) still has to happen in a SEPARATE pass after the
    // fragment lands in the live grid: loadThumb()'s pump checks img.isConnected synchronously
    // (see its comment above), so calling it on a still-detached card silently drops the job.
    renderCards(grid, virtOn ? [] : shown, shown, isList, { offset: 0 });
    if (virtOn) {
      // Mount one screenful first so the live grid can be MEASURED (column count and row pitch
      // both come from the browser's own auto-fill layout — see virtMetrics), then window to the
      // real scroll position.
      renderCards(grid, shown.slice(0, Math.min(shown.length, 60)), shown, isList, { offset: 0 });
      state._virtMetrics = virtMetrics(grid);
      state._virtRange = null;
      virtUpdate(true);
      const scroller = grid.parentElement || document.documentElement;
      if (_virtScrollBound) _virtScrollBound.el.removeEventListener('scroll', _virtScrollBound.fn);
      // rAF-coalesced: a scroll fires far more often than a row boundary is crossed, and
      // virtUpdate already no-ops when the row range has not changed.
      let queued = false;
      const fn = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; virtUpdate(false); }); };
      scroller.addEventListener('scroll', fn, { passive: true });
      _virtScrollBound = { el: scroller, fn };
    } else if (_virtScrollBound) {
      _virtScrollBound.el.removeEventListener('scroll', _virtScrollBound.fn);
      _virtScrollBound = null;
    }
    renderGridTail(shown);
  }

  /// Builds and wires a set of cards into the grid, replacing whatever was there. `allList` is the
  /// FULL filtered set even when only a window is mounted, because click-range selection and the
  /// context menu operate over the folder, not over what happens to be on screen; `offset` keeps
  /// each card's index global for the same reason.
  function renderCards(grid, list, allList, isList, opts) {
    const offset = (opts && opts.offset) || 0;
    const shown = allList;
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    const built = [];
    if (opts && opts.padTop) {
      const pad = document.createElement('div');
      pad.className = 'lib-virt-pad';
      pad.style.cssText = `grid-column:1/-1;height:${opts.padTop}px;pointer-events:none`;
      frag.appendChild(pad);
    }
    list.forEach((entry, _i) => {
      const idx = offset + _i;
      const sc = state.sidecars.get(entry.path) || { rating: 0, label: '', edited: false };
      const card = document.createElement('div');
      card.className = 'lib-card' + (entry.path === state.openedPath ? ' sel' : '') + (state.selected.has(entry.path) ? ' multi' : '') +
        (sc.label === 'Red' ? ' flag-red' : sc.label === 'Green' ? ' flag-green' : '') + (entry.missing ? ' lib-missing' : '');
      card.dataset.path = entry.path;
      const rawBadge = entry.kind === 'raw' ? `<div class="lib-raw-badge" title="RAW file">R</div>` : '';
      // No thumbnail decoder for video (get_thumbnail errors cleanly for it — see library.rs) —
      // a badge + CSS placeholder icon instead of a broken <img>, same idea as the RAW badge.
      const videoBadge = entry.is_video ? `<div class="lib-video-badge" title="Video clip">${ic('video',10)}</div>` : '';
      const dupeClusterId = state.dupeClusters.get(entry.path);
      const dupeSize = dupeClusterId ? state.dupeClusterSizes.get(dupeClusterId) : 0;
      const dupeBadge = dupeSize > 1
        ? `<div class="lib-dupe-badge" title="${dupeSize} similar photos (a RAW and its JPEG sibling clustering together is expected)">⧉${dupeSize}</div>`
        : '';
      const syncedBadge = state.syncedPaths.has(entry.path) ? `<div class="lib-synced-badge" title="Synced to Google Photos">☁</div>` : '';
      if (isList) {
        const m = state.meta.get(entry.path) || {};
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        card.innerHTML = `<div class="lib-thumb-wrap${entry.is_video ? ' lib-thumb-video' : ''}"><img loading="lazy" alt=""></div>
          <div class="lib-name">${state.showTitle ? esc(entry.name) + (entry.missing ? ' (missing)' : '') : ''}${sc.edited ? EDITED_BADGE_HTML : ''}${rawBadge}${videoBadge}${dupeBadge}${syncedBadge}</div>
          <div class="lib-col">${esc(m.date)}</div>
          <div class="lib-col">${esc(fmtEditedTs(entry.edited_ts))}</div>
          <div class="lib-col">${esc(m.camera)}</div>
          <div class="lib-col">${m.iso ? esc(m.iso) : ''}</div>
          <div class="lib-col">${esc(m.shutter)}</div>
          <div class="lib-col">${esc(m.aperture)}</div>
          <div class="lib-col">${esc(m.focal_len)}</div>
          <div class="lib-flags">${flagsHtml(sc.label, sc.favorite)}</div>
          <div class="lib-col">${sc.edited ? 'Yes' : ''}</div>`;
      } else {
        card.innerHTML = `<div class="lib-thumb-wrap${entry.is_video ? ' lib-thumb-video' : ''}"><img loading="lazy" alt="">${metaStripHtml(entry)}
            <div class="lib-flags">${flagsHtml(sc.label, sc.favorite)}</div>
          </div>
          ${sc.edited ? EDITED_BADGE_HTML : ''}
          ${rawBadge}
          ${videoBadge}
          ${dupeBadge}
          ${syncedBadge}
          ${state.showTitle ? `<div class="lib-name">${entry.name}${entry.missing ? ' (missing)' : ''}</div>` : ''}`;
      }
      frag.appendChild(card);
      built.push({ entry, card, idx });
    });
    grid.appendChild(frag);
    // Second pass: every card is now connected, so loadThumb()'s isConnected check (see its
    // comment) sees it correctly instead of silently dropping the job.
    built.forEach(({ entry, card, idx }) => {
      const img = card.querySelector('img');
      // Video now gets a real poster too — decoded in the webview rather than by get_thumbnail,
      // which still has no MP4 still-frame decoder (see videoPosterAndMeta).
      loadThumb(entry.path, img, entry.is_video);
      card.querySelector('.lib-thumb-wrap').onclick = (e) => handleCardClick(e, entry, idx, shown);
      card.querySelector('.lib-thumb-wrap').ondblclick = (e) => { e.stopPropagation(); handleCardDblClick(e, entry); };
      card.oncontextmenu = (e) => showContextMenu(e, entry, shown);
      // Drag the card (or, if it's already part of a multi-selection, the whole selection) onto
      // a Favorites/Flagged/Rejected row in the sidebar — see the collection-row drop handlers
      // near renderCollections(), below.
      card.draggable = true;
      card.ondragstart = (e) => {
        const paths = state.selected.has(entry.path) ? Array.from(state.selected) : [entry.path];
        e.dataTransfer.setData('application/x-chromasmith-paths', JSON.stringify(paths));
        e.dataTransfer.effectAllowed = 'copy';
      };
      card.querySelectorAll('.lib-flag').forEach((flag) => {
        flag.onclick = (e) => {
          e.stopPropagation();
          const which = flag.dataset.flag;
          if (which === 'Favorite') {
            const cur = state.sidecars.get(entry.path) || { favorite: false };
            setFavorite(entry.path, !cur.favorite);
            return;
          }
          const cur = state.sidecars.get(entry.path) || { label: '' };
          setLabel(entry.path, cur.label === which ? '' : which); // click same flag again to clear
        };
      });
    });
    if (opts && opts.padBot) {
      const pad = document.createElement('div');
      pad.className = 'lib-virt-pad';
      pad.style.cssText = `grid-column:1/-1;height:${opts.padBot}px;pointer-events:none`;
      grid.appendChild(pad);
    }
  }

  /// Everything renderGrid did AFTER the cards: empty states, counts, selection chrome.
  function renderGridTail(shown) {
    const grid = document.getElementById('lib-grid');
    if (!shown.length && state.entries.length) {
      // Only the richer "nothing matches" message when a filter/search actually hid photos —
      // an empty FOLDER (state.entries.length === 0) gets its own message below instead.
      grid.innerHTML = '<div id="lib-empty">No photos match the current filters.<br>'
        + '<a id="lib-empty-clear" style="color:var(--acc);cursor:pointer;text-decoration:underline">Clear filters</a></div>';
      const clearLink = document.getElementById('lib-empty-clear');
      if (clearLink) clearLink.onclick = () => clearAllLibFilters();
    } else if (!shown.length) {
      grid.innerHTML = '<div id="lib-empty">No photos in this folder.</div>';
    }
    document.getElementById('lib-count').textContent = state.selected.size
      ? `${state.selected.size} selected — ${shown.length} of ${state.entries.length} photo(s)`
      : `${shown.length} of ${state.entries.length} photo(s)`;
    if (typeof syncFilterUI === 'function') syncFilterUI();
  }

  // ── C1: Compare-pair mode ─────────────────────────────────────────────────────────────
  // Two panes, each an independent {imgIdx, snapshotSrc} pointing into the SAME loaded batch
  // (fxImages, via openPathsInEditor) — same-photo-two-looks falls out for free by letting
  // both panes share an imgIdx. snapshotSrc uses the exact descriptor shape B3's
  // resolveSplitSnapshot already understands ('orig'|{hist:N}|{style:name}|{export:v}); this
  // file adds only the 'live' meaning (null → resolveSplitSnapshot treats falsy as 'orig', so
  // Compare keeps its own tiny string<->descriptor mapping instead of touching that resolver).
  const compareState = {
    active: false,
    paths: [],                          // the ordered selection Compare was entered with
    paneA: { idx: 0, srcKey: 'live' },
    paneB: { idx: 0, srcKey: 'live' },
    zoom: 1, panX: 0, panY: 0,
    prevViewMode: 'grid',
  };
  function compareSrcKeyToDescriptor(key) {
    if (!key || key === 'live') return null;
    if (key === 'orig') return 'orig';
    if (key.indexOf('hist:') === 0) return { hist: parseInt(key.slice(5), 10) };
    if (key.indexOf('style:') === 0) return { style: key.slice(6) };
    return null;
  }
  // A couple of recent history steps + Styles, mirroring B3's split-source menu options.
  function compareSourceOptions() {
    const opts = [{ v: 'live', label: 'Live edit' }, { v: 'orig', label: 'Original' }];
    try {
      if (typeof fxHistory !== 'undefined' && Array.isArray(fxHistory) && fxHistory.length) {
        const start = Math.max(0, fxHistory.length - 6);
        for (let i = fxHistory.length - 1; i >= start; i--) {
          const e = fxHistory[i];
          opts.push({ v: `hist:${i}`, label: `History: ${(e && e.label) || ('Step ' + (i + 1))}` });
        }
      }
    } catch (e) {}
    try {
      if (typeof stylesList === 'function') stylesList().forEach((s) => opts.push({ v: `style:${s.name}`, label: 'Style: ' + s.name }));
    } catch (e) {}
    return opts;
  }
  function compareHost() { return document.getElementById('lib-compare'); }
  function comparePathForIdx(idx) { return compareState.paths[idx] || ''; }

  function buildCompareUI() {
    const host = compareHost();
    if (!host) return;
    const paneHtml = (which) => `
      <div class="lib-cmp-pane" data-pane="${which}">
        <div class="lib-cmp-head">
          <select class="lib-cmp-photo-sel" data-pane="${which}"></select>
          <select class="lib-cmp-src-sel" data-pane="${which}">${compareSourceOptions().map((o) => `<option value="${o.v}">${o.label}</option>`).join('')}</select>
        </div>
        <div class="lib-cmp-canvas-wrap"><canvas></canvas></div>
        <div class="lib-cmp-chrome">
          <div class="lib-flag" data-pane="${which}" data-flag="Green" title="Pick">${ic('flagGreen',15)}</div>
          <div class="lib-flag" data-pane="${which}" data-flag="Red" title="Reject">✕</div>
          <div class="lib-flag" data-pane="${which}" data-flag="Favorite" title="Favorite">${ic('heart',15)}</div>
          <span style="margin-left:auto;color:var(--mut);font-size:10px" class="lib-cmp-name" data-pane="${which}"></span>
        </div>
      </div>`;
    host.innerHTML = `
      <div id="lib-compare-bar">
        <span>Compare — ←/→ cycles the right pane · ⏎ promotes it to the left · Esc exits</span>
      </div>
      <div id="lib-compare-panes">${paneHtml('A')}${paneHtml('B')}</div>`;
    host.querySelectorAll('.lib-cmp-photo-sel').forEach((sel) => {
      sel.innerHTML = compareState.paths.map((p, i) => `<option value="${i}">${esc2(baseName(p))}</option>`).join('');
      sel.onchange = (e) => {
        const which = e.target.dataset.pane;
        compareState[which === 'A' ? 'paneA' : 'paneB'].idx = parseInt(e.target.value, 10);
        renderComparePane(which);
      };
    });
    host.querySelectorAll('.lib-cmp-src-sel').forEach((sel) => {
      sel.onchange = (e) => {
        const which = e.target.dataset.pane;
        compareState[which === 'A' ? 'paneA' : 'paneB'].srcKey = e.target.value;
        renderComparePane(which);
      };
    });
    host.querySelectorAll('.lib-flag').forEach((flag) => {
      flag.onclick = async () => {
        const which = flag.dataset.pane;
        const path = comparePathForIdx(compareState[which === 'A' ? 'paneA' : 'paneB'].idx);
        if (!path) return;
        if (flag.dataset.flag === 'Favorite') {
          const cur = state.sidecars.get(path) || { favorite: false };
          await setFavorite(path, !cur.favorite);
        } else {
          const cur = state.sidecars.get(path) || { label: '' };
          await setLabel(path, cur.label === flag.dataset.flag ? '' : flag.dataset.flag);
        }
        syncCompareChrome(which);
      };
    });
    syncCompareChrome('A'); syncCompareChrome('B');
    setupCompareZoomPan();
  }
  function esc2(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function syncCompareChrome(which) {
    const host = compareHost(); if (!host) return;
    const p = compareState[which === 'A' ? 'paneA' : 'paneB'];
    const path = comparePathForIdx(p.idx);
    const sc = state.sidecars.get(path) || { rating: 0, label: '', favorite: false };
    host.querySelectorAll(`.lib-cmp-photo-sel[data-pane="${which}"]`).forEach((sel) => { sel.value = String(p.idx); });
    host.querySelectorAll(`.lib-cmp-src-sel[data-pane="${which}"]`).forEach((sel) => { sel.value = p.srcKey; });
    host.querySelectorAll(`.lib-flag[data-pane="${which}"]`).forEach((flag) => {
      const f = flag.dataset.flag;
      flag.classList.toggle('on', f === 'Favorite' ? !!sc.favorite : sc.label === f);
    });
    const nameEl = host.querySelector(`.lib-cmp-name[data-pane="${which}"]`);
    if (nameEl) nameEl.textContent = baseName(path);
  }
  // Re-renders one pane: selects its photo (fxSelectImage, a no-op if already current),
  // resolves its snapshotSrc via B3's resolveSplitSnapshot, then draws with B1's
  // renderSnapshotTo. Only called on photo/source change — zoom/pan is a pure CSS transform
  // (setupCompareZoomPan) so panning/zooming never re-renders.
  async function renderComparePane(which) {
    const host = compareHost(); if (!host) return;
    const p = compareState[which === 'A' ? 'paneA' : 'paneB'];
    const pane = host.querySelector(`.lib-cmp-pane[data-pane="${which}"]`);
    const canvas = pane && pane.querySelector('canvas');
    if (!canvas) return;
    if (typeof fxSelectImage === 'function' && typeof fxCurIdx !== 'undefined' && fxCurIdx !== p.idx) fxSelectImage(p.idx);
    const it = (typeof fxImages !== 'undefined' && fxImages[p.idx]) || null;
    const img = it && it.img;
    const iw = img ? (img.naturalWidth || img.width) : 1200, ih = img ? (img.naturalHeight || img.height) : 800;
    const wrap = pane.querySelector('.lib-cmp-canvas-wrap');
    const maxW = Math.max(200, (wrap.clientWidth || 500)), maxH = Math.max(200, (wrap.clientHeight || 400));
    const sc = Math.min(1, maxW / iw, maxH / ih);
    const pw = Math.max(1, Math.round(iw * sc)), ph = Math.max(1, Math.round(ih * sc));
    try {
      const snap = typeof resolveSplitSnapshot === 'function' ? resolveSplitSnapshot(compareSrcKeyToDescriptor(p.srcKey)) : 'orig';
      if (typeof renderSnapshotTo === 'function') renderSnapshotTo(canvas, snap, pw, ph, {});
    } catch (e) { console.error('renderComparePane', which, e); }
    syncCompareChrome(which);
  }
  function applyCompareTransform() {
    const host = compareHost(); if (!host) return;
    const t = `translate(${compareState.panX}px,${compareState.panY}px) scale(${compareState.zoom})`;
    host.querySelectorAll('.lib-cmp-canvas-wrap canvas').forEach((c) => { c.style.transform = t; });
  }
  function setupCompareZoomPan() {
    const host = compareHost(); if (!host || host._zoomWired) return;
    host._zoomWired = true;
    let dragging = false, lx = 0, ly = 0;
    host.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      compareState.zoom = Math.min(6, Math.max(1, compareState.zoom * (1 + delta)));
      applyCompareTransform();
    }, { passive: false });
    host.addEventListener('pointerdown', (e) => {
      if (compareState.zoom <= 1) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      compareState.panX += e.clientX - lx; compareState.panY += e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      applyCompareTransform();
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  function canEnterCompare() {
    if (state.source === 'lr') {
      if (typeof toast === 'function') toast("Compare isn't available for Lightroom cloud albums yet", false);
      return false;
    }
    return true;
  }
  async function enterCompareMode() {
    if (!canEnterCompare()) return;
    const paths = state.selected.size ? Array.from(state.selected) : (state.openedPath ? [state.openedPath] : []);
    if (!paths.length) { if (typeof toast === 'function') toast('Select at least one photo to compare', false); return; }
    if (state.viewMode !== 'compare') compareState.prevViewMode = state.viewMode;
    compareState.paths = paths;
    compareState.paneA = { idx: 0, srcKey: 'live' };
    compareState.paneB = { idx: paths.length > 1 ? 1 : 0, srcKey: 'live' };
    compareState.zoom = 1; compareState.panX = 0; compareState.panY = 0;
    state.viewMode = 'compare';
    syncViewSeg();
    const host = compareHost();
    if (host) { host.classList.add('on'); host.innerHTML = '<div id="lib-empty">Loading…</div>'; }
    try { await openPathsInEditor(paths); }
    catch (e) { console.error('compare openPathsInEditor', e); if (typeof toast === 'function') toast('Could not load photos for compare', false); exitCompareMode(); return; }
    compareState.active = true;
    buildCompareUI();
    await renderComparePane('A');
    await renderComparePane('B');
  }
  function exitCompareMode() {
    compareState.active = false;
    const host = compareHost();
    if (host) host.classList.remove('on');
    state.viewMode = compareState.prevViewMode || 'grid';
    localStorage.setItem('chromasmith_lib_view', state.viewMode);
    syncViewSeg();
    renderGrid();
  }
  // ←/→ cycles pane B's photo through the rest of the current selection; ⏎ promotes B to A
  // (swap which photo/source is "the keeper"); handled from the shared keydown listener below.
  function compareCycleB(delta) {
    if (!compareState.paths.length) return;
    const n = compareState.paths.length;
    compareState.paneB.idx = ((compareState.paneB.idx + delta) % n + n) % n;
    renderComparePane('B');
  }
  function comparePromoteB() {
    const a = compareState.paneA, b = compareState.paneB;
    compareState.paneA = { ...b }; compareState.paneB = { ...a };
    renderComparePane('A'); renderComparePane('B');
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  // Sidebar starts OPEN — in the full-mode left-sidebar layout it IS the navigation
  // (Collections/Cloud/Folders, per the approved wireframe); collapsing is the occasional
  // choice now, not the default.
  // ⚠️ NEW KEY, deliberate: the pre-redesign key ('chromasmith_lib_tree_collapsed') has '1'
  // persisted on real machines (collapsed WAS the old default, so any toggle round-trip stored
  // it) — merely changing the default couldn't un-hide the sidebar there, which is exactly how
  // build 23c still looked "old layout, no sidebar". A redesign must MIGRATE persisted UI
  // state, not just change defaults: everyone gets the open sidebar once, then the toggle
  // persists under the new key.
  const treeToggleBtn = overlay.querySelector('#lib-tree-toggle');
  try { localStorage.removeItem('chromasmith_lib_tree_collapsed'); } catch (e) {}
  let treeCollapsed = localStorage.getItem('chromasmith_lib_sidebar') === 'collapsed';
  function syncTreeToggle() {
    overlay.classList.toggle('tree-collapsed', treeCollapsed);
    treeToggleBtn.classList.toggle('on', !treeCollapsed);
  }
  syncTreeToggle();
  treeToggleBtn.onclick = () => {
    treeCollapsed = !treeCollapsed;
    localStorage.setItem('chromasmith_lib_sidebar', treeCollapsed ? 'collapsed' : 'open');
    syncTreeToggle();
  };
  overlay.querySelector('#lib-pick').onclick = pickFolder;
  wireGridFileDrop();
  wireNativeFileDrop();
  wireScrollPersist();
  overlay.querySelector('#lib-gphotos').onclick = () => {
    // gpImportClick lives in chromasmith-22.html (the web-app half); it's exposed on window.
    if (typeof window.gpImportClick === 'function') window.gpImportClick();
  };
  overlay.querySelector('#lib-recent').onclick = toggleRecentMenu;
  // #lib-close removed: the top-bar Library button is the single control for this.
  overlay.querySelector('#lib-expand').onclick = () => toggleExpandedView();
  function toggleExpandedView(force) {
    state.expanded_view = force !== undefined ? force : !state.expanded_view;
    overlay.classList.toggle('full', state.expanded_view);
    document.body.classList.toggle('lib-full', state.expanded_view);
    syncDockPadding();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  window.chromasmithToggleExpandedView = () => { if (state.open) toggleExpandedView(); }; // menu-bar "Toggle Full Library" — no-op if the Library isn't even open

  // Standalone copy/paste-edit for the Photo menu (menu-copy-edit/menu-paste-edit in
  // desktop-native.js) — same __copiedRecipe clipboard as the right-click context menu's Copy/
  // Paste edit items (buildPathsMenu, below), just reachable without right-clicking anything,
  // and scoped to whichever photo/batch is CURRENTLY open in the editor.
  window.chromasmithMenuCopyEdit = async () => {
    const path = state.openedPath || (state.openedPaths && state.openedPaths[fxCurIdx]);
    if (!path) { toast('No photo open', false); return; }
    const sc = await getSidecar(path);
    window.__copiedRecipe = sc.recipe || snapshotToB64(getUISnapshot());
    toast('Edit copied', true);
  };
  window.chromasmithMenuPasteEdit = async () => {
    if (!window.__copiedRecipe) { toast('Nothing copied yet', false); return; }
    const targets = state.openedPath ? [state.openedPath] : (state.openedPaths || []);
    if (!targets.length) { toast('No photo open', false); return; }
    await Promise.all(targets.map(async (p) => {
      const cur = await getSidecar(p);
      const updated = { ...cur, edited: true, recipe: window.__copiedRecipe };
      state.sidecars.set(p, updated);
      await invoke('set_sidecar', { path: p, rating: updated.rating, label: updated.label, edited: true, recipe: window.__copiedRecipe }).catch((e) => sidecarWriteFailed(p, cur, e));
      markCardEdited(p);
    }));
    try { applyUISnapshot(snapshotFromB64(window.__copiedRecipe)); fxUpdate(); } catch (e) { console.error('paste edit', e); }
    toast('Edit pasted', true);
  };
  // Column count of the CURRENT grid layout, read from the resolved CSS grid template rather
  // than recomputed from thumb size + container width — the auto-fill/minmax track count is
  // exactly what the browser used to place cards, so this can never drift from the real layout
  // (including the docked single-column filmstrip, which naturally reports 1). List view is a
  // single visual column of rows despite its multi-column CSS grid template (one row = one
  // photo), so it's special-cased to 1.
  function gridCols() {
    if (!grid) return 1;
    if (grid.classList.contains('list-view')) return 1;
    const parts = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
    return Math.max(1, parts.length);
  }
  document.addEventListener('keydown', (e) => {
    if (!state.open) return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea,[contenteditable]')) return;
    // ⌘A/Ctrl+A select-all, ahead of the generic modifier-key bailout below (every other
    // shortcut here is unmodified).
    if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey) && !e.altKey && state.source !== 'lr' && state.viewMode !== 'compare') {
      e.preventDefault();
      const all = sortEntries(state.entries.filter(passesFilters));
      state.selected = new Set(all.map((en) => en.path));
      updateCardSelClasses();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Cloud album view: state.entries still holds the previous FOLDER's files — arrows/Enter/
    // X/P/U would act on invisible photos (Enter even opened one; X/P wrote its sidecar).
    // Only the view toggles stay live.
    if (state.source === 'lr') {
      if (e.key === 'g' || e.key === 'G') toggleExpandedView();
      else if (e.key === 'Escape' && state.expanded_view) toggleExpandedView(false);
      return;
    }
    // ── Compare mode: ←/→ cycle pane B, ⏎ promotes B to A, Esc exits back to the previous
    // view mode. Own branch so the grid-culling arrows/Enter below don't also fire.
    if (state.viewMode === 'compare' && compareState.active) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); compareCycleB(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); compareCycleB(1); return; }
      if (e.key === 'Enter') { e.preventDefault(); comparePromoteB(); return; }
      if (e.key === 'Escape') { e.preventDefault(); exitCompareMode(); return; }
      return;
    }
    if ((e.key === 'c' || e.key === 'C') && (state.selected.size >= 1 || state.openedPath)) { enterCompareMode(); return; }
    // ── Grid keyboard culling (Lightroom idiom): arrows move a highlight through the CURRENT
    // sorted/filtered order, Enter opens it, X rejects / P picks / U clears the flag on it (or
    // on the multi-selection when one exists). The highlight rides on state.openedPath when a
    // photo is open, else an internal cursor.
    const shown = state.entries.filter(passesFilters);
    const sorted = shown.length ? sortEntries(shown) : [];
    const curIdx = sorted.findIndex((en) => en.path === (state._kbCursor || state.openedPath));
    // moveTo(next, extend): jump the cursor to an absolute index. extend=true (shift held)
    // range-selects from the last non-shift anchor to the new cursor, mirroring the mouse's
    // shift-click range select (handleCardClick above) instead of collapsing to a single card.
    const moveTo = (next, extend) => {
      if (!sorted.length) return;
      next = Math.max(0, Math.min(sorted.length - 1, next));
      state._kbCursor = sorted[next].path;
      const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(state._kbCursor)}"]`);
      if (card) { card.scrollIntoView({ block: 'nearest' }); }
      if (extend) {
        if (selectAnchor < 0) selectAnchor = curIdx >= 0 ? curIdx : next;
        const [lo, hi] = [selectAnchor, next].sort((a, b) => a - b);
        state.selected.clear();
        for (let i = lo; i <= hi; i++) state.selected.add(sorted[i].path);
      } else {
        selectAnchor = next;
        state.selected.clear(); state.selected.add(state._kbCursor);
      }
      updateCardSelClasses();
      e.preventDefault();
    };
    const move = (delta, extend) => moveTo((curIdx < 0 ? (delta > 0 ? -1 : 0) : curIdx) + delta, extend);
    const kbTargets = () => (state.selected.size ? [...state.selected] : (state._kbCursor ? [state._kbCursor] : (state.openedPath ? [state.openedPath] : [])));
    if (e.key === 'ArrowLeft') { move(-1, e.shiftKey); return; }
    if (e.key === 'ArrowRight') { move(1, e.shiftKey); return; }
    if (e.key === 'ArrowUp') { move(-gridCols(), e.shiftKey); return; }
    if (e.key === 'ArrowDown') { move(gridCols(), e.shiftKey); return; }
    if (e.key === 'Home') { moveTo(0, e.shiftKey); return; }
    if (e.key === 'End') { moveTo(sorted.length - 1, e.shiftKey); return; }
    if (e.key === 'Enter' && (state._kbCursor || state.selected.size === 1)) {
      e.preventDefault(); openInEditor(state._kbCursor || [...state.selected][0]); return;
    }
    if (e.key === 'x' || e.key === 'X') { kbTargets().forEach((p) => setLabel(p, 'Red')); return; }
    if (e.key === 'p' || e.key === 'P') { kbTargets().forEach((p) => setLabel(p, 'Green')); return; }
    if (e.key === 'u' || e.key === 'U') { kbTargets().forEach((p) => setLabel(p, '')); return; }
    if (e.key === 'g' || e.key === 'G') toggleExpandedView();
    else if (e.key === 'Escape' && state.expanded_view) toggleExpandedView(false);
  });
  // Shared by the Filters popover's "Clear all" button AND the empty-grid "Clear filters" link
  // (renderGrid's no-matches state) — one place so the two can't drift on what "clear" means.
  // Also resets the search box: a search term hiding every photo is as much a "filter" to a
  // user staring at an empty grid as the dropdowns are.
  function clearAllLibFilters() {
    FILTER_SELECT_IDS.forEach((id) => { const sel = document.getElementById(id); if (sel) sel.value = 'all'; });
    state.typeFilter = 'all'; state.cameraFilter = 'all'; state.lensFilter = 'all'; state.isoFilter = 'all';
    state.dupeFilter = 'all'; state.syncedFilter = 'all'; state.tagFilter = 'all';
    const searchEl = document.getElementById('lib-search');
    if (searchEl) searchEl.value = '';
    state.search = '';
    renderGrid();
  }
  overlay.querySelector('#lib-type-filter').onchange = (e) => { state.typeFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-camera-filter').onchange = (e) => { state.cameraFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-lens-filter').onchange = (e) => { state.lensFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-iso-filter').onchange = (e) => { state.isoFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-dupe-filter').onchange = (e) => { state.dupeFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-synced-filter').onchange = (e) => { state.syncedFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-tag-filter').onchange = (e) => { state.tagFilter = e.target.value; renderGrid(); };
  // ── Filters popover: toggle button, active-filter chips, clear-all ──────────────────────
  const FILTER_SELECT_IDS = ['lib-type-filter', 'lib-camera-filter', 'lib-lens-filter', 'lib-iso-filter', 'lib-dupe-filter', 'lib-synced-filter', 'lib-tag-filter'];
  function syncFilterUI() {
    const chipsEl = document.getElementById('lib-filter-chips');
    const badgeEl = document.getElementById('lib-filters-badge');
    if (!chipsEl || !badgeEl) return;
    const active = FILTER_SELECT_IDS.map((id) => document.getElementById(id)).filter((sel) => sel && sel.value !== 'all');
    badgeEl.textContent = active.length ? String(active.length) : '';
    badgeEl.classList.toggle('on', active.length > 0);
    chipsEl.innerHTML = active.map((sel) => {
      const opt = sel.options[sel.selectedIndex];
      return `<span class="lib-chip">${opt ? opt.textContent : sel.value}<span class="lib-chip-x" data-for="${sel.id}" title="Remove filter">✕</span></span>`;
    }).join('');
    chipsEl.querySelectorAll('.lib-chip-x').forEach((x) => {
      x.onclick = () => {
        const sel = document.getElementById(x.dataset.for);
        if (!sel) return;
        sel.value = 'all';
        sel.onchange({ target: sel });
      };
    });
  }
  const filtersBtn = overlay.querySelector('#lib-filters-btn');
  const filtersPop = overlay.querySelector('#lib-filters-pop');
  filtersBtn.onclick = (e) => { e.stopPropagation(); filtersPop.classList.toggle('on'); };
  document.addEventListener('click', (e) => {
    if (filtersPop.classList.contains('on') && !filtersPop.contains(e.target) && e.target !== filtersBtn) filtersPop.classList.remove('on');
  });
  overlay.querySelector('#lib-filters-clear').onclick = () => clearAllLibFilters();
  let searchDebounce;
  overlay.querySelector('#lib-search').oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.search = e.target.value.toLowerCase(); renderGrid(); }, 150);
  };

  // ── view options: view mode, sort, thumb size, metadata display, source ─────────────────
  const viewSeg = overlay.querySelector('#lib-viewmode-seg');
  function syncViewSeg() { viewSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.viewMode)); }
  viewSeg.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.v === 'compare') { enterCompareMode(); return; }
      if (state.viewMode === 'compare') exitCompareMode();
      state.viewMode = b.dataset.v; localStorage.setItem('chromasmith_lib_view', state.viewMode); syncViewSeg(); renderGrid();
    };
  });
  // 'compare' was never a persisted-view default before this session — a stale localStorage
  // value from a crash mid-compare should fall back to grid on next load, not silently retry
  // entering compare with no selection.
  if (state.viewMode === 'compare') state.viewMode = 'grid';
  syncViewSeg();

  const thumbSlider = overlay.querySelector('#lib-thumbsize');
  thumbSlider.value = state.thumbSize;
  thumbSlider.oninput = (e) => {
    state.thumbSize = parseInt(e.target.value, 10);
    localStorage.setItem('chromasmith_lib_thumbsize', state.thumbSize);
    if (grid) grid.style.setProperty('--lib-thumb', state.thumbSize + 'px');
  };

  const sortSel = overlay.querySelector('#lib-sort');
  sortSel.value = state.sortBy;
  sortSel.onchange = (e) => { state.sortBy = e.target.value; localStorage.setItem('chromasmith_lib_sort', state.sortBy); renderGrid(); };
  const sortDirBtn = overlay.querySelector('#lib-sort-dir');
  function syncSortDirBtn() { sortDirBtn.textContent = state.sortDir === 'desc' ? '↓' : '↑'; }
  syncSortDirBtn();
  sortDirBtn.onclick = () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    localStorage.setItem('chromasmith_lib_sortdir', state.sortDir);
    syncSortDirBtn(); renderGrid();
  };

  const metaSel = overlay.querySelector('#lib-metadisp');
  metaSel.value = state.metaDisplay;
  metaSel.onchange = (e) => { state.metaDisplay = e.target.value; localStorage.setItem('chromasmith_lib_metadisp', state.metaDisplay); renderGrid(); };

  const showTitleChk = overlay.querySelector('#lib-showtitle');
  showTitleChk.checked = state.showTitle;
  showTitleChk.onchange = (e) => { state.showTitle = e.target.checked; localStorage.setItem('chromasmith_lib_showtitle', state.showTitle ? '1' : '0'); renderGrid(); };

  // List-view table headers: clicking a header is just a shortcut for the #lib-sort dropdown +
  // #lib-sort-dir button — reusing their own handlers keeps grid view and list view unable to
  // disagree about how the collection is sorted (single source of truth: state.sortBy/sortDir).
  const listHead = overlay.querySelector('#lib-list-head');
  listHead.querySelectorAll('.lib-lh-cell[data-sort]').forEach((cell) => {
    cell.onclick = () => {
      const key = cell.dataset.sort;
      if (state.sortBy === key) {
        sortDirBtn.onclick(); // toggle direction — already re-renders
      } else {
        sortSel.value = key;
        sortSel.onchange({ target: sortSel }); // sets state.sortBy + re-renders
      }
    };
  });
  // ── list-view column widths: drag handles + persistence ─────────────────────────────────
  // --lib-list-cols (a single shared CSS var, see the comment above its :root default) is one
  // grid-template-columns string applied to both #lib-list-head and every .lib-card in list
  // mode — a drag handle on a header cell just rewrites the one track that column corresponds
  // to and re-sets the var; the header/rows can never disagree since they share the same var.
  const LIB_COL_DEFAULTS = { thumb: 52, date: 92, editedts: 92, camera: 132, iso: 56, shutter: 68, aperture: 60, focal: 56, flags: 56, edited: 60 };
  const LIB_COL_ORDER = ['thumb', 'name', 'date', 'editedts', 'camera', 'iso', 'shutter', 'aperture', 'focal', 'flags', 'edited'];
  let libColWidths;
  try { libColWidths = { ...LIB_COL_DEFAULTS, ...JSON.parse(localStorage.getItem('chromasmith_lib_cols') || '{}') }; }
  catch (e) { libColWidths = { ...LIB_COL_DEFAULTS }; }
  function applyLibColWidths() {
    const tmpl = LIB_COL_ORDER.map((k) => (k === 'name' ? 'minmax(120px,1fr)' : `${libColWidths[k]}px`)).join(' ');
    document.documentElement.style.setProperty('--lib-list-cols', tmpl);
  }
  applyLibColWidths();
  listHead.querySelectorAll('.lib-lh-cell[data-sort]').forEach((cell) => {
    const key = cell.dataset.sort;
    if (!(key in LIB_COL_DEFAULTS)) return; // 'name' has no fixed width to drag
    const handle = document.createElement('div');
    handle.className = 'lib-col-resize';
    handle.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = libColWidths[key];
      const onMove = (ev) => { libColWidths[key] = Math.max(40, startW + (ev.clientX - startX)); applyLibColWidths(); };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { localStorage.setItem('chromasmith_lib_cols', JSON.stringify(libColWidths)); } catch (err) { /* ignore */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    handle.ondblclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      libColWidths[key] = LIB_COL_DEFAULTS[key];
      applyLibColWidths();
      try { localStorage.setItem('chromasmith_lib_cols', JSON.stringify(libColWidths)); } catch (err) { /* ignore */ }
    };
    cell.appendChild(handle);
  });
  function syncListHead() {
    listHead.querySelectorAll('.lib-lh-cell[data-sort]').forEach((cell) => {
      const on = cell.dataset.sort === state.sortBy;
      cell.classList.toggle('sorted', on);
      cell.classList.toggle('desc', on && state.sortDir === 'desc');
    });
  }

  // Virtual, cross-folder smart collections — see Rust's list_collection()/registry_set() and
  // the Darkroom-style sidebar (renderCollections(), below the folder tree wiring). "edited"
  // stays reachable from the legacy #lib-source dropdown too (list_edited() is a thin alias),
  // kept for anyone used to that control; the sidebar is the primary, richer entry point.
  let backfillDone = false;
  function ensureBackfill() {
    if (backfillDone) return;
    backfillDone = true;
    const folders = Array.from(new Set([state.root, ...getRecentFolders()].filter(Boolean)));
    invoke('backfill_edited_registry', { folders })
      .then(() => renderCollectionCounts())
      .catch((err) => console.error('backfill_edited_registry', err));
  }
  overlay.querySelector('#lib-source').onchange = async (e) => {
    state.source = e.target.value;
    if (state.source === 'edited') {
      ensureBackfill();
      await openCollectionView('edited');
    } else if (state.currentFolder) {
      await openFolder(state.currentFolder);
    }
  };
  async function openCollectionView(name) {
    state.source = name;
    lrState.album = null; // leaving the cloud view — don't re-highlight a stale album later
    state.selected.clear();
    grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let entries;
    try { entries = await invoke('list_collection', { name }); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not load this collection.</div>'; return; }
    state.entries = entries;
    await Promise.all(entries.filter((e) => !e.missing).map((e) => Promise.all([getSidecar(e.path), getMeta(e.path)])));
    await renderGrid();
    renderCollections(); // re-highlight the active row
  }
  async function openExportedView() {
    state.source = 'exported';
    state.selected.clear();
    grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let entries;
    try { entries = await invoke('list_exported'); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not load exported photos.</div>'; return; }
    state.entries = entries;
    await Promise.all(entries.filter((e) => !e.missing).map((e) => Promise.all([getSidecar(e.path), getMeta(e.path)])));
    await renderGrid();
    renderCollections();
  }

  // ── Darkroom-style sidebar: smart collections above the folder tree ─────────────────────
  const COLLECTIONS = [
    { name: 'recents', label: 'Recents', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>' },
    { name: 'favorites', label: 'Favorites', icon: HEART_SVG },
    { name: 'edited', label: 'Edited', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z"/></svg>' },
    { name: 'exported', label: 'Exported', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 21h14"/></svg>' },
    { name: 'flagged', label: 'Flagged', icon: FLAG_SVG_GREEN },
    { name: 'rejected', label: 'Rejected', icon: FLAG_SVG_RED },
    { name: 'duplicates', label: 'Duplicates', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="7" width="12" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h10v10a2 2 0 0 1-2 2h-2"/></svg>' },
    { name: 'gphotos', label: 'Synced', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 19a4 4 0 1 1 .4-7.98A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H6z"/></svg>' },
  ];
  let collectionCounts = {};
  // Drop targets for the drag-a-selection-onto-a-collection gesture (card dragstart wiring is
  // in renderGrid, above) — each is just the existing per-photo mutation that collection is
  // itself derived from.
  const COLL_DROP_MUTATIONS = {
    favorites: (p) => setFavorite(p, true),
    flagged: (p) => setLabel(p, 'Green'),
    rejected: (p) => setLabel(p, 'Red'),
  };

  // ── Devices: card import (ingest.rs) ───────────────────────────────────────────────────
  // Lives above Cloud in the same sidebar, because a card is a source of photos in exactly the
  // way an album is. Everything here is a thin shell over ingest.rs — the layout rules, the
  // verification and the duplicate matching are all Rust-side; this chooses the options and
  // shows progress.
  const CARD_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5V3h7l3 3"/><circle cx="12" cy="13" r="2.5"/></svg>';
  const cardState = { volumes: [], scanning: false };

  function fmtBytes(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = Number(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  async function refreshVolumes() {
    try {
      const vols = await invoke('list_volumes');
      // Only cards (a DCIM folder) get a sidebar row on their own. A user importing from a plain
      // external drive can still reach it through the panel's own "Choose folder", but listing
      // every mounted Time Machine disk as an import source would be noise.
      const next = (vols || []).filter((v) => v.has_dcim);
      const changed = next.length !== cardState.volumes.length
        || next.some((v, i) => v.path !== cardState.volumes[i].path);
      cardState.volumes = next;
      if (changed) renderCollections();
    } catch (e) { console.error('list_volumes', e); }
  }

  function devicesSectionHtml() {
    if (!cardState.volumes.length) return '';
    const rows = cardState.volumes.map((v) => `
      <div class="lib-coll-row lib-card-row" data-card="${esc(v.path)}" title="${esc(v.path)} — click to import">
        <span class="lib-coll-ic">${CARD_SVG}</span><span class="lib-coll-lb">${esc(v.name)}</span>
        <span class="lib-coll-count">${v.total_bytes ? fmtBytes(v.total_bytes - v.free_bytes) : ''}</span>
      </div>`).join('');
    return '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Devices</div>' + rows;
  }

  const IMPORT_PREFS_KEY = 'cs.import.prefs.v1';
  function importPrefs() {
    try { return JSON.parse(localStorage.getItem(IMPORT_PREFS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveImportPrefs(p) {
    try { localStorage.setItem(IMPORT_PREFS_KEY, JSON.stringify(p)); } catch (e) { /* quota — not worth failing an import over */ }
  }

  /// The import sheet. Scans first (so the user is choosing against what is actually on the card,
  /// including which files are already imported), then copies with live progress.
  async function openImportPanel(cardPath) {
    if (cardState.scanning) return;
    const prefs = importPrefs();
    const back = document.createElement('div');
    back.id = 'lib-import-back';
    back.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--bdr);border-radius:12px;padding:18px 20px;width:min(680px,92vw);max-height:86vh;overflow:auto;font-family:var(--sans);color:var(--txt);box-shadow:var(--lift-2)';
    box.innerHTML = `<div style="font-weight:600;font-size:15px;margin-bottom:2px">Import from ${esc(baseName(cardPath))}</div>
      <div id="imp-sub" style="font-size:12px;color:var(--mut);margin-bottom:14px">Scanning card…</div>
      <div id="imp-body"></div>`;
    back.appendChild(box);
    document.body.appendChild(back);
    let cancelled = false;
    const cleanup = () => { document.removeEventListener('keydown', onKey); back.remove(); };
    const onKey = (ev) => { if (ev.key === 'Escape' && !cardState.scanning) { cancelled = true; cleanup(); } };
    document.addEventListener('keydown', onKey);
    back.onclick = (ev) => { if (ev.target === back && !cardState.scanning) { cancelled = true; cleanup(); } };

    let files = [];
    try {
      files = await invoke('scan_card', { path: cardPath, destRoot: prefs.dest || null });
    } catch (e) {
      document.getElementById('imp-sub').textContent = 'Could not read this card: ' + String(e.message || e);
      return;
    }
    if (cancelled) return;
    if (!files.length) {
      document.getElementById('imp-sub').textContent = 'No photos or videos found on this card.';
      return;
    }

    const dupes = files.filter((f) => f.duplicate).length;
    const dates = files.map((f) => f.date).filter(Boolean).sort();
    const totalBytes = files.reduce((a, f) => a + (f.size || 0), 0);
    const span = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`) : 'no date';
    document.getElementById('imp-sub').innerHTML =
      `${files.length} files · ${fmtBytes(totalBytes)} · ${esc(span)}${dupes ? ` · <span style="color:var(--acc)">${dupes} already imported</span>` : ''}`;

    const row = (label, html, hint) => `<div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${label}</div>
        ${html}${hint ? `<div style="font-size:11px;color:var(--mut);margin-top:3px">${hint}</div>` : ''}</div>`;
    const inputCss = 'width:100%;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:7px;padding:7px 9px;font-size:12px;font-family:var(--sans)';
    document.getElementById('imp-body').innerHTML =
      row('Copy to', `<div style="display:flex;gap:6px"><input id="imp-dest" style="${inputCss}" value="${esc(prefs.dest || '')}" placeholder="Choose a destination folder…" readonly>
          <button id="imp-dest-pick" style="white-space:nowrap;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:7px;padding:7px 11px;font-size:12px;cursor:pointer">Choose…</button></div>`)
      + row('Organise into', `<select id="imp-folder" style="${inputCss}">
          <option value="{YYYY}/{YYYY-MM-DD}">2026 / 2026-08-15</option>
          <option value="{YYYY}/{MM}/{DD}">2026 / 08 / 15</option>
          <option value="{YYYY-MM-DD}">2026-08-15</option>
          <option value="">No subfolders</option></select>`,
        'Folders come from each photo\'s capture date, not the file date.')
      + row('Rename', `<select id="imp-name" style="${inputCss}">
          <option value="">Keep camera filenames</option>
          <option value="{YYYY-MM-DD}_{name}">2026-08-15_P1000123</option>
          <option value="{YYYY-MM-DD}_{n}">2026-08-15_0001</option></select>`)
      + row('Also copy to', `<div style="display:flex;gap:6px"><input id="imp-backup" style="${inputCss}" value="${esc(prefs.backup || '')}" placeholder="Optional second copy — another drive" readonly>
          <button id="imp-backup-pick" style="white-space:nowrap;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:7px;padding:7px 11px;font-size:12px;cursor:pointer">Choose…</button>
          <button id="imp-backup-clear" style="background:var(--sur2);border:1px solid var(--bdr);color:var(--mut);border-radius:7px;padding:7px 9px;font-size:12px;cursor:pointer">✕</button></div>`,
        'Written in the same pass, before the card is reused — which is when a single copy is most fragile.')
      + `<label style="display:flex;align-items:center;gap:7px;font-size:12px;margin:12px 0 4px;cursor:pointer">
          <input type="checkbox" id="imp-skip" ${prefs.skip === false ? '' : 'checked'}> Skip files already imported${dupes ? ` (${dupes})` : ''}</label>
        <label style="display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:14px;cursor:pointer">
          <input type="checkbox" id="imp-eject" ${prefs.eject ? 'checked' : ''}> Eject card when finished</label>
        <div id="imp-prog" style="display:none;margin-bottom:12px">
          <div style="height:6px;background:var(--sur2);border-radius:3px;overflow:hidden"><div id="imp-bar" style="height:100%;width:0;background:var(--acc);transition:width .15s"></div></div>
          <div id="imp-prog-txt" style="font-size:11px;color:var(--mut);margin-top:5px"></div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <div id="imp-cancel" style="font-size:12px;color:var(--mut);cursor:pointer;padding:8px 10px">Cancel</div>
          <button id="imp-go" style="background:var(--acc);border:none;color:#1a1206;font-weight:600;border-radius:8px;padding:9px 18px;font-size:13px;cursor:pointer">Import</button>
        </div>`;

    const $ = (id) => document.getElementById(id);
    if (prefs.folder) $('imp-folder').value = prefs.folder;
    if (prefs.name) $('imp-name').value = prefs.name;
    const pickFolder = async (target) => {
      try {
        const chosen = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false } });
        if (chosen) target.value = Array.isArray(chosen) ? chosen[0] : chosen;
      } catch (e) { console.error('pick folder', e); }
    };
    $('imp-dest-pick').onclick = () => pickFolder($('imp-dest'));
    $('imp-backup-pick').onclick = () => pickFolder($('imp-backup'));
    $('imp-backup-clear').onclick = () => { $('imp-backup').value = ''; };
    $('imp-cancel').onclick = () => { if (!cardState.scanning) { cancelled = true; cleanup(); } };

    $('imp-go').onclick = async () => {
      const dest = $('imp-dest').value.trim();
      if (!dest) { $('imp-dest').style.borderColor = 'var(--acc)'; return; }
      const opts = {
        destRoot: dest,
        backupRoot: $('imp-backup').value.trim() || null,
        folderTemplate: $('imp-folder').value,
        filenameTemplate: $('imp-name').value,
        skipDuplicates: $('imp-skip').checked,
        only: [],
      };
      saveImportPrefs({ dest, backup: opts.backupRoot || '', folder: opts.folderTemplate, name: opts.filenameTemplate, skip: opts.skipDuplicates, eject: $('imp-eject').checked });
      cardState.scanning = true;
      $('imp-go').disabled = true;
      $('imp-go').style.opacity = '.6';
      $('imp-go').textContent = 'Importing…';
      $('imp-cancel').style.opacity = '.4';
      $('imp-prog').style.display = 'block';
      let unlisten = null;
      try {
        unlisten = await window.__TAURI__.event.listen('ingest-progress', (ev) => {
          const p = ev.payload || {};
          const frac = p.bytes_total ? p.bytes_done / p.bytes_total : (p.total ? p.done / p.total : 0);
          $('imp-bar').style.width = `${Math.round(frac * 100)}%`;
          $('imp-prog-txt').textContent = `${p.done} of ${p.total} · ${fmtBytes(p.bytes_done)} of ${fmtBytes(p.bytes_total)}${p.current ? ' · ' + p.current : ''}`;
        });
        const res = await invoke('ingest_copy', { source: cardPath, options: opts });
        if (unlisten) unlisten();
        cardState.scanning = false;
        const failed = (res.failed || []).length;
        if (typeof toast === 'function') {
          toast(failed
            ? `Imported ${res.copied} of ${res.copied + failed} — ${failed} failed`
            : `Imported ${res.copied} file${res.copied === 1 ? '' : 's'} (${fmtBytes(res.bytes)})`, !failed);
        }
        // Per-file failures are listed, not summarised away: a card that dropped three files is
        // exactly when the user needs to know WHICH three before formatting it.
        if (failed) console.warn('import failures:', res.failed);
        if ($('imp-eject') && $('imp-eject').checked) {
          try { await invoke('eject_volume', { path: cardPath }); refreshVolumes(); }
          catch (e) { if (typeof toast === 'function') toast('Import finished, but the card would not eject', false); }
        }
        cleanup();
        await importDroppedFolder(dest);
      } catch (e) {
        if (unlisten) unlisten();
        cardState.scanning = false;
        $('imp-go').disabled = false;
        $('imp-go').style.opacity = '';
        $('imp-go').textContent = 'Import';
        $('imp-cancel').style.opacity = '';
        $('imp-prog-txt').textContent = 'Import failed: ' + String(e.message || e);
      }
    };
  }

  // ── Cloud sources (approved wireframe): Adobe Lightroom lives in the sidebar between the
  // smart collections and the folder tree. Albums render as tree children once connected;
  // selecting one fills the normal grid with cloud thumbnails (see openLrAlbum below). The
  // auth/API layer stays in chromasmith-22.html, exposed as window.lrCloud. ──
  const lrState = { albums: null, album: null, assets: [], loading: false };
  let lrDirCache = null;
  async function lrDownloadsDir() {
    if (!lrDirCache) { try { lrDirCache = await invoke('lr_downloads_dir'); } catch (e) { console.error('lr_downloads_dir', e); } }
    return lrDirCache;
  }
  const CLOUD_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 19a4 4 0 1 1 .4-7.98A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H6z"/></svg>';
  function cloudSectionHtml() {
    if (!window.lrCloud) return '';
    const connected = window.lrCloud.connected();
    let rows = `
      <div class="lib-coll-row${lrState.album === null && state.source === 'lr' ? ' on' : ''}" data-lr-root="1" title="${connected ? 'Connected — click an album below, right-click to sign out' : 'Sign in to browse your Lightroom cloud photos'}">
        <span class="lib-coll-ic">${CLOUD_SVG}</span><span class="lib-coll-lb">Adobe Lightroom</span>
        <span class="lib-coll-count">${connected ? '✓' : (lrState.loading ? '…' : '')}</span>
      </div>`;
    if (connected && lrState.albums) {
      rows += lrState.albums.map((a) => `
        <div class="lib-coll-row lib-lr-album${state.source === 'lr' && lrState.album === a.id ? ' on' : ''}" data-lr-album="${a.id}" style="padding-left:26px">
          <span class="lib-coll-lb">${String(a.name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>
        </div>`).join('');
    }
    return '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Cloud</div>' + rows;
  }
  async function lrConnectAndLoad() {
    if (!window.lrCloud || lrState.loading) return; // in-flight guard: double-click fired two OAuth flows
    lrState.loading = true; renderCollections();
    try {
      if (!window.lrCloud.connected()) await window.lrCloud.connect();
      lrState.albums = await window.lrCloud.albums();
      lrState.loading = false; renderCollections();
      if (lrState.albums && lrState.albums.length) openLrAlbum(lrState.albums[0].id);
      else showLrEmptyState('No albums found in this catalog.');
    } catch (e) {
      lrState.loading = false; renderCollections();
      console.error('lr connect', e);
      showLrEmptyState('Connection failed — see the log in the editor view.');
    }
  }
  function lrSignOut() {
    if (!(window.lrCloud && window.lrCloud.connected())) return;
    window.lrCloud.connect(); // toggle: disconnects when connected
    lrState.albums = null; lrState.album = null; lrState.assets = [];
    renderCollections();
    showLrEmptyState();
  }
  // Disconnected (or error) empty state in the MAIN area, per the approved wireframe — the
  // sidebar row alone silently kicking off OAuth was undiscoverable and gave errors nowhere
  // to land.
  function showLrEmptyState(msg) {
    state.source = 'lr'; lrState.album = null;
    grid = document.getElementById('lib-grid');
    thumbQueueReset();
    grid.classList.remove('list-view');
    grid.innerHTML = `
      <div id="lib-empty" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:60px 20px;min-height:50vh">
        <div style="color:var(--mut)">${CLOUD_SVG.replace('width="14" height="14"', 'width="34" height="34"')}</div>
        <div style="font-weight:600;font-size:14px;color:var(--txt)">Browse your Lightroom cloud photos</div>
        <div style="font-size:11px;color:var(--mut)">${msg ? String(msg).replace(/</g, '&lt;') : 'Sign in with Adobe. Albums and photos appear here.'}</div>
        <button class="lib-btn" id="lib-lr-connect" style="background:var(--acc);color:#000;border-color:var(--acc);font-weight:600">Connect Lightroom</button>
        <a id="lib-lr-clientid" style="font-size:10px;color:var(--mut);cursor:pointer;text-decoration:underline">API ID…</a>
      </div>`;
    const btn = grid.querySelector('#lib-lr-connect');
    if (btn) btn.onclick = () => lrConnectAndLoad();
    const cid = grid.querySelector('#lib-lr-clientid');
    if (cid) cid.onclick = () => window.lrCloud && window.lrCloud.askClientId(true);
    const count = document.getElementById('lib-count');
    if (count) count.textContent = 'Adobe Lightroom — not connected';
    renderCollections();
  }
  // Simple bounded-concurrency thumb loader for cloud cards (the disk thumb pool is keyed on
  // file paths; cloud thumbs are API blobs, so they get their own tiny pump).
  let lrThumbGen = 0;
  async function lrThumbPump(cards) {
    const gen = ++lrThumbGen;
    const queue = cards.slice();
    const setImg = (img, blob) => {
      if (gen !== lrThumbGen || !img.isConnected) return;
      const url = URL.createObjectURL(blob);
      img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => URL.revokeObjectURL(url); // decode failure must not leak the URL
      img.src = url;
    };
    const worker = async () => {
      while (queue.length && gen === lrThumbGen) {
        const { asset, img } = queue.shift();
        if (!img.isConnected) continue;
        try {
          // Disk cache first (renditions are immutable → keyed by asset id). Re-opening an album
          // reads thumbs off disk instead of re-hitting the Adobe API every time.
          let bytes = null;
          try { bytes = await invoke('get_lr_thumb', { assetId: asset.id }); } catch (e) { /* miss */ }
          if (bytes) { setImg(img, new Blob([bytes], { type: 'image/jpeg' })); continue; }
          const blob = await window.lrCloud.thumbBlob(asset.id);
          setImg(img, blob);
          try {
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            await invoke('save_lr_thumb', { assetId: asset.id, dataB64: btoa(bin) });
          } catch (e) { /* cache write is best-effort */ }
        } catch (e) { /* thumb failure is cosmetic */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  // Cloud multi-select (by asset id) + the import quality chooser. Kept separate from the local
  // `state.selected` (which is disk paths). One import action can carry several assets.
  lrState.selected = lrState.selected || new Set();
  function lrUpdateCloudSel() {
    document.querySelectorAll('#lib-grid .lib-card[data-lr-id]').forEach((c) => c.classList.toggle('multi', lrState.selected.has(c.dataset.lrId)));
  }
  // Small centered chooser → resolves 'raw' | 'fullsize' | null(cancel). Remembers the last
  // pick as the session default (still shown so the user can change it per import).
  let lrLastQuality = null;
  function lrChooseQuality(count) {
    return new Promise((resolve) => {
      closeContextMenu();
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--bg);border:1px solid var(--bdr);border-radius:12px;padding:18px 20px;min-width:300px;font-family:var(--sans);color:var(--txt);box-shadow:var(--lift-2)';
      box.innerHTML = `<div style="font-weight:600;font-size:14px;margin-bottom:4px">Import ${count > 1 ? count + ' photos' : 'photo'} from Lightroom</div>
        <div style="font-size:12px;color:var(--mut);margin-bottom:14px">Choose what to download.</div>`;
      const mk = (label, desc, val) => {
        const b = document.createElement('button');
        b.style.cssText = 'display:block;width:100%;text-align:left;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer';
        b.innerHTML = `<div style="font-weight:600;font-size:13px">${label}</div><div style="font-size:11px;color:var(--mut)">${desc}</div>`;
        b.onclick = () => { lrLastQuality = val; cleanup(); resolve(val); };
        box.appendChild(b);
      };
      mk('Original RAW', 'Untouched RW2 — full RAW pipeline, no Lightroom edits.', 'raw');
      mk('Edited full-size (JPEG)', 'Lightroom develop edits baked in, full resolution.', 'fullsize');
      const cancel = document.createElement('div');
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'text-align:center;font-size:12px;color:var(--mut);cursor:pointer;padding:6px';
      cancel.onclick = () => { cleanup(); resolve(null); };
      box.appendChild(cancel);
      const cleanup = () => { document.removeEventListener('keydown', onKey); back.remove(); };
      const onKey = (ev) => { if (ev.key === 'Escape') { cleanup(); resolve(null); } };
      document.addEventListener('keydown', onKey);
      back.onclick = (ev) => { if (ev.target === back) { cleanup(); resolve(null); } };
      back.appendChild(box); document.body.appendChild(back);
    });
  }
  async function lrImportAssets(assets) {
    if (!assets.length) return;
    const quality = await lrChooseQuality(assets.length);
    if (!quality) return;
    for (const a of assets) {
      const card = document.querySelector(`#lib-grid .lib-card[data-lr-id="${(window.CSS && CSS.escape) ? CSS.escape(a.id) : a.id}"]`);
      const prog = card && card.querySelector('.lib-lr-prog');
      if (card) card.style.opacity = '0.7'; if (prog) prog.style.display = 'block';
      try { await window.lrCloud.importAsset(a.id, a.name, quality, { albumId: lrState.album, albumName: (lrState.albums || []).find((al) => al.id === lrState.album)?.name || '', meta: a.meta }); }
      finally { if (card) card.style.opacity = ''; if (prog) prog.style.display = 'none'; }
      const nameEl = card && card.querySelector('.lib-name');
      if (nameEl && !/✓/.test(nameEl.innerHTML)) nameEl.innerHTML += ' <span title="Downloaded" style="color:var(--ok,#59c98a)">✓</span>';
    }
  }
  async function openLrAlbum(albumId) {
    state.source = 'lr';
    lrState.album = albumId;
    state.selected.clear();
    grid = document.getElementById('lib-grid');
    thumbQueueReset();
    grid.classList.remove('list-view');
    grid.innerHTML = libSkeletonHtml();
    renderCollections();
    let assets;
    try { assets = await window.lrCloud.assets(albumId); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not load this album.</div>'; console.error('lr assets', e); return; }
    if (state.source !== 'lr' || lrState.album !== albumId) return; // user navigated away mid-fetch
    lrState.assets = assets;
    await renderLrGrid();
  }
  // Renders the current cloud album from lrState.assets (no refetch) — ALSO what renderGrid()
  // delegates to while state.source==='lr', so a filter/sort/search handler re-running
  // renderGrid can't clobber the cloud view with the previous folder's entries.
  async function renderLrGrid() {
    grid = document.getElementById('lib-grid');
    grid.classList.remove('list-view');
    const assets = lrState.assets || [];
    const albumName = (lrState.albums || []).find((a) => a.id === lrState.album)?.name || '';
    const count = document.getElementById('lib-count');
    if (count) count.textContent = `${assets.length} cloud photo(s)${albumName ? ' — ' + albumName : ''} · connected to Adobe Lightroom`;
    // "on disk" badge: compare against what's already in ~/Documents/Lightroom Download.
    const onDisk = new Set();
    try {
      const dir = await lrDownloadsDir();
      const listing = await invoke('list_dir', { path: dir });
      (listing.entries || listing || []).forEach((en) => { const n = String(en.name || '').replace(/\.[^.]+$/, ''); if (n) onDisk.add(n); });
    } catch (e) { /* fresh install: no dir yet */ }
    grid.innerHTML = '';
    if (!assets.length) { grid.innerHTML = '<div id="lib-empty">No photos in this album.</div>'; return; }
    lrState.selected.clear();
    const cards = [];
    assets.forEach((a) => {
      const stem = String(a.name || a.id).replace(/\.[^.]+$/, '');
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.dataset.lrStem = stem;
      card.dataset.lrId = a.id;
      card.innerHTML = `<div class="lib-thumb-wrap" style="position:relative"><img loading="lazy" alt="">
          <div class="lib-lr-prog" style="display:none;position:absolute;left:0;right:0;bottom:0;height:3px;overflow:hidden"><div style="height:100%;width:40%;background:var(--acc);animation:lib-lr-slide 1s linear infinite"></div></div>
        </div>
        <div class="lib-name">${String(a.name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}${onDisk.has(stem) ? ' <span title="Already in Lightroom Download" style="color:var(--ok,#59c98a)">✓</span>' : ''}</div>`;
      card.title = a.name + (onDisk.has(stem) ? ' — already downloaded' : ' — tap to select, click to import');
      const wrap = card.querySelector('.lib-thumb-wrap');
      // Same select-vs-open model as local cards: tap (or click-once) selects, firm press (or
      // click-the-selected-again / double-click) imports. cmd/shift extend the cloud selection.
      wrap.onclick = (e) => {
        if (e.metaKey || e.ctrlKey) { if (lrState.selected.has(a.id)) lrState.selected.delete(a.id); else lrState.selected.add(a.id); lrUpdateCloudSel(); return; }
        const cls = classifyPress(e);
        const selectIt = () => { lrState.selected.clear(); lrState.selected.add(a.id); lrUpdateCloudSel(); };
        if (cls === 'press') { lrImportAssets([a]); return; }
        if (cls === 'tap') { selectIt(); return; }
        if (lrState.selected.size === 1 && lrState.selected.has(a.id)) lrImportAssets([a]); else selectIt();
      };
      wrap.ondblclick = (e) => { e.stopPropagation(); lrImportAssets([a]); };
      card.oncontextmenu = (e) => {
        e.preventDefault();
        if (!lrState.selected.has(a.id)) { lrState.selected.clear(); lrState.selected.add(a.id); lrUpdateCloudSel(); }
        const chosen = assets.filter((x) => lrState.selected.has(x.id));
        buildCloudMenu(e.clientX, e.clientY, chosen);
      };
      grid.appendChild(card);
      cards.push({ asset: a, img: card.querySelector('img') });
    });
    lrThumbPump(cards);
  }
  function buildCloudMenu(x, y, assets) {
    closeContextMenu();
    const n = assets.length;
    ctxMenu = document.createElement('div');
    ctxMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);border-radius:8px;padding:4px;font-size:12px;color:var(--txt);font-family:var(--sans);min-width:180px;box-shadow:var(--lift-2)';
    const item = (label, fn) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      el.onmouseenter = () => { el.style.background = 'var(--bdr)'; };
      el.onmouseleave = () => { el.style.background = ''; };
      el.onclick = async (ev) => { ev.stopPropagation(); closeContextMenu(); await fn(); };
      ctxMenu.appendChild(el);
    };
    item(`Import ${n > 1 ? n + ' photos' : 'photo'}`, () => lrImportAssets(assets));
    ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px';
    document.body.appendChild(ctxMenu);
  }
  window.addEventListener('lr-cloud-state', () => { if (!window.lrCloud || !window.lrCloud.connected()) { lrState.albums = null; lrState.album = null; } renderCollections(); });
  // Background full-size upgrade indicator (chromasmith-22.html's lrUpgradeToFullsize
  // dispatches these): mini badge on the matching card while the higher-quality rendition
  // is being generated/downloaded.
  window.addEventListener('lr-fullsize-state', (e) => {
    const d = e.detail || {};
    const card = document.querySelector(`.lib-card[data-lr-stem="${(CSS && CSS.escape) ? CSS.escape(d.stem || '') : (d.stem || '')}"]`);
    if (!card) return;
    let badge = card.querySelector('.lib-lr-full');
    if (d.phase === 'start') {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'lib-lr-full';
        badge.style.cssText = 'position:absolute;top:6px;right:6px;font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,.6);color:var(--acc)';
        badge.textContent = 'fetching full-size…';
        card.querySelector('.lib-thumb-wrap').appendChild(badge);
      }
    } else if (badge) {
      if (d.phase === 'done') { badge.textContent = 'full-size ✓'; badge.style.color = 'var(--ok,#59c98a)'; setTimeout(() => badge.remove(), 4000); }
      else badge.remove();
    }
  });

  function renderCollections() {
    const host = document.getElementById('lib-collections');
    if (!host) return;
    host.innerHTML = '<div class="lib-coll-heading">Collections</div>' + COLLECTIONS.map((c) => `
      <div class="lib-coll-row${state.source === c.name ? ' on' : ''}" data-coll="${c.name}">
        <span class="lib-coll-ic">${c.icon}</span><span class="lib-coll-lb">${c.label}</span>
        <span class="lib-coll-count">${collectionCounts[c.name] || ''}</span>
      </div>`).join('') + devicesSectionHtml() + cloudSectionHtml() + '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Folders</div>';
    host.querySelectorAll('.lib-card-row[data-card]').forEach((row) => {
      row.onclick = () => openImportPanel(row.dataset.card);
    });
    host.querySelectorAll('.lib-coll-row[data-coll]').forEach((row) => {
      row.onclick = () => {
        const name = row.dataset.coll;
        if (name === 'edited') ensureBackfill();
        if (name === 'exported') openExportedView();
        else openCollectionView(name);
      };
      // Drag-to-add: only the three collections that are actually a per-photo mutation (not a
      // derived/automatic one like Recents/Edited/Exported/Duplicates/Synced) are valid drop
      // targets — dropping applies the exact same write each already exposes via click (the
      // heart icon / flag icons / X-P-U shortcuts), so a dropped photo shows up here for the
      // same reason a manually-flagged one would.
      const mutate = COLL_DROP_MUTATIONS[row.dataset.coll];
      if (!mutate) return;
      row.ondragover = (e) => {
        if (!Array.from(e.dataTransfer.types || []).includes('application/x-chromasmith-paths')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        row.classList.add('lib-coll-dragover');
      };
      row.ondragleave = () => row.classList.remove('lib-coll-dragover');
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove('lib-coll-dragover');
        let paths = [];
        try { paths = JSON.parse(e.dataTransfer.getData('application/x-chromasmith-paths') || '[]'); } catch (err) { /* ignore */ }
        if (!paths.length) return;
        const label = row.querySelector('.lib-coll-lb');
        Promise.all(paths.map(mutate)).then(() => toast(`Added ${paths.length} photo${paths.length === 1 ? '' : 's'} to ${label ? label.textContent : 'collection'}`, true));
      };
    });
    const root = host.querySelector('[data-lr-root]');
    if (root) {
      // Disconnected → wireframe empty state in the main area (the Connect button there starts
      // OAuth); connected with albums loaded → jump to the first album; loading → ignore.
      root.onclick = () => {
        if (!window.lrCloud) return;
        if (!window.lrCloud.connected()) { showLrEmptyState(); return; }
        if (lrState.loading) return;
        if (lrState.albums && lrState.albums.length) openLrAlbum(lrState.albums[0].id);
        else lrConnectAndLoad();
      };
      root.oncontextmenu = (e) => { e.preventDefault(); lrSignOut(); };
    }
    host.querySelectorAll('[data-lr-album]').forEach((row) => { row.onclick = () => openLrAlbum(row.dataset.lrAlbum); });
    // Connected chip (viewbar, right-aligned) — visible only while browsing the cloud source.
    overlay.classList.toggle('lr-mode', state.source === 'lr' && !!(window.lrCloud && window.lrCloud.connected()));
    const chipOut = document.querySelector('#lib-lr-chip .lib-lr-signout');
    if (chipOut && !chipOut._wired) { chipOut._wired = true; chipOut.onclick = lrSignOut; }
  }
  function renderCollectionCounts() {
    invoke('collection_counts').then((counts) => { collectionCounts = counts; renderCollections(); }).catch(() => {});
  }
  renderCollections();
  renderCollectionCounts();

  // ── Marquee (drag-rectangle) multi-select over the grid. Works in both the folder grid
  // (selects by data-path into state.selected) and the cloud grid (data-lr-id into
  // lrState.selected). Starts only when the drag begins on empty grid background and moves
  // past a small threshold, so a normal click on a card still selects/opens as usual.
  function setupMarquee() {
    const main = document.getElementById('lib-main');
    if (!main || main._marqueeWired) return;
    main._marqueeWired = true;
    let box = null, sx = 0, sy = 0, add = false, active = false;
    main.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.lib-card')) return;       // a card handles its own click
      if (e.target.closest('#lib-list-head')) return;
      sx = e.clientX; sy = e.clientY; add = e.shiftKey; active = false;
    });
    document.addEventListener('pointermove', (e) => {
      if (sx === 0 && sy === 0) return;
      if (!(e.buttons & 1)) { sx = sy = 0; return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!active && Math.hypot(dx, dy) < 5) return;    // below threshold → not a marquee yet
      active = true;
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:9998;border:1px solid var(--acc);background:rgba(212,144,58,.14);pointer-events:none';
        document.body.appendChild(box);
        if (!add) { if (state.source === 'lr') { lrState.selected.clear(); } else { state.selected.clear(); } }
      }
      const x0 = Math.min(sx, e.clientX), y0 = Math.min(sy, e.clientY), x1 = Math.max(sx, e.clientX), y1 = Math.max(sy, e.clientY);
      box.style.left = x0 + 'px'; box.style.top = y0 + 'px'; box.style.width = (x1 - x0) + 'px'; box.style.height = (y1 - y0) + 'px';
      const cloud = state.source === 'lr';
      document.querySelectorAll('#lib-grid .lib-card').forEach((c) => {
        const r = c.getBoundingClientRect();
        const hit = r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0;
        const key = cloud ? c.dataset.lrId : c.dataset.path;
        if (!key) return;
        const set = cloud ? lrState.selected : state.selected;
        if (hit) set.add(key); else if (!add) set.delete(key);
        c.classList.toggle('multi', set.has(key));
      });
    });
    document.addEventListener('pointerup', () => {
      sx = sy = 0;
      if (box) { box.remove(); box = null; active = false; }
    });
  }
  setupMarquee();

  async function toggleLibrary() {
    state.open = !state.open;
    overlay.classList.toggle('on', state.open);
    document.body.classList.toggle('lib-docked', state.open);
    if (!state.open && state.expanded_view) toggleExpandedView(false); // don't stay full-window for next open
    syncDockPadding();
    // The dock shifts the app's layout; the preview canvas measures the window to fit, so
    // poke a resize once the CSS has applied.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    if (state.open) {
      await renderTree();
      // If the currently-open photo came from a Lightroom album, return to that album instead
      // of the last local folder (chromasmith-22.html's lrImportAsset stamps the origin).
      const origin = window.chromasmithOpenedOrigin;
      if (origin && origin.source === 'lr' && window.lrCloud && window.lrCloud.connected()) {
        try {
          if (!lrState.albums) lrState.albums = await window.lrCloud.albums();
          renderCollections();
          await openLrAlbum(origin.albumId || (lrState.albums[0] && lrState.albums[0].id));
          return;
        } catch (e) { console.error('reopen lr album', e); /* fall through to folder */ }
      }
      if (!state.root) { await pickFolder(); return; }
      if (state.currentFolder) await openFolder(state.currentFolder);
      else await openFolder(state.root);
    }
  }
  window.chromasmithToggleLibrary = toggleLibrary; // called from the header button in desktop-native.js

  window.__TAURI__.event.listen('menu-library', toggleLibrary);

  // Card detection. macOS emits no mount notification that reaches a Tauri webview, so this
  // polls /Volumes — cheap (one readdir plus a statfs per volume) and only while the Library is
  // actually open, so a backgrounded app does no work.
  refreshVolumes();
  setInterval(() => { const ov = document.getElementById('lib-overlay'); if (ov && ov.style.display !== 'none') refreshVolumes(); }, 4000);

  // ── deskx home screen: the app opens to the full-window Library, not the editor (matches
  // the approved Darkroom-style wireframe). desktop-native.js sets body.deskx synchronously
  // before this script runs (build-desktop.sh loads it first), so the class is already present
  // here. Runs once at startup only — afterward the user's own open/close/expand actions own
  // the state. ──
  if (document.body.classList.contains('deskx')) {
    // Boot splash (chromasmith-22.html's #boot-splash, shown by default with no JS needed):
    // covers the flicker between the web layout's first paint, deskx switching in, and this
    // async open+expand actually landing — previously the user watched all of that happen
    // live. Hidden here, right after the Library has actually settled into its final
    // full-window state, not a moment earlier.
    toggleLibrary().then(() => {
      toggleExpandedView(true);
      if (typeof window.hideBootSplash === 'function') window.hideBootSplash();
    });
  }
})();
