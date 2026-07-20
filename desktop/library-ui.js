// Chromasmith Library view: local folder browser with cached thumbnails,
// alongside (not replacing) the Google Photos integration — purely for finding/culling/rating
// RAWs on disk before editing. Native-only (arbitrary filesystem folder browsing isn't a thing
// in a sandboxed browser); injected only into the Tauri build, gated on window.__TAURI__, so
// this file is a safe no-op anywhere else. chromasmith-22.html is never touched.
(function () {
  if (!window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;

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
    root: localStorage.getItem(LS_ROOT) || '',
    expanded: new Set(),
    currentFolder: '',
    entries: [],           // image entries in the currently-viewed folder
    sidecars: new Map(),   // path -> {rating,label,edited,recipe} (cached client-side)
    meta: new Map(),       // path -> {camera,lens,date,iso}
    typeFilter: 'all',     // 'all' | 'raw' | 'jpeg' | 'png' | 'tiff'
    cameraFilter: 'all',
    lensFilter: 'all',
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
    source: 'folder',      // 'folder' | 'edited' — the virtual cross-folder "All Edited" view
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
      font-family:-apple-system,'Helvetica Neue',sans-serif;transition:width .15s ease;}
    #lib-overlay.on{display:grid}
    /* 6 children = 6 tracks (top, filters, viewbar, side, main, bottom) — and each child is
       PINNED to its row so a future DOM insertion can never silently shift everything again
       (auto-placement has mis-stacked this panel twice). */
    #lib-top{grid-row:1}#lib-filters{grid-row:2}#lib-viewbar{grid-row:3}
    #lib-side{grid-row:4}#lib-main{grid-row:5}#lib-bottom{grid-row:6}
    #lib-overlay.full{width:100vw;grid-template-rows:auto auto auto minmax(100px,18%) 1fr 28px}
    #lib-overlay.full #lib-grid{grid-template-columns:repeat(auto-fill,minmax(var(--lib-thumb,200px),1fr))}
    /* Folder tree collapses to zero height by default — the photo grid is the page; the tree
       is navigation chrome you reach for occasionally, not something that should permanently
       eat a fixed 18-26% vertical slice above an otherwise-empty-looking grid. #lib-tree-toggle
       (in #lib-top) flips this. */
    #lib-overlay.tree-collapsed{grid-template-rows:auto auto auto 0 1fr 28px}
    #lib-overlay.full.tree-collapsed{grid-template-rows:auto auto auto 0 1fr 28px}
    #lib-overlay.tree-collapsed #lib-side{display:none}
    #lib-tree-toggle.on{border-color:var(--acc);color:var(--acc)}
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
    #lib-side{overflow:auto;padding:8px 12px;border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr)}
    /* Darkroom-style smart collections, above the folder tree in the same #lib-side scroll box. */
    .lib-coll-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;
      font-size:12px;color:var(--txt)}
    .lib-coll-row:hover{background:var(--sur2)}
    .lib-coll-row.on{background:rgba(212,144,58,.14);color:var(--acc)}
    .lib-coll-ic{display:inline-flex;flex-shrink:0;color:inherit}
    .lib-coll-lb{flex:1}
    .lib-coll-count{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--mut)}
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
    /* Real table: header row (#lib-list-head) and every .lib-card in list mode share this exact
       column template, so clicking a header lines up with the data underneath it. */
    :root{--lib-list-cols:52px minmax(120px,1fr) 92px 92px 132px 56px 68px 60px 56px 56px 60px}
    #lib-list-head{display:none;position:sticky;top:0;z-index:20;background:var(--bg);
      grid-template-columns:var(--lib-list-cols);gap:10px;padding:4px 8px 6px;
      border-bottom:1px solid var(--bdr);font-size:10px;color:var(--mut);font-family:var(--mono,ui-monospace,Menlo,monospace);
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
    #lib-grid.list-view .lib-card{display:grid;grid-template-columns:var(--lib-list-cols);align-items:center;gap:10px;border-width:1px;padding:4px 8px}
    #lib-grid.list-view .lib-thumb-wrap{width:52px;height:40px;aspect-ratio:auto}
    #lib-grid.list-view .lib-name{padding:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
    #lib-grid.list-view .lib-tagrow{padding:0;display:contents}
    #lib-grid.list-view .lib-edited-badge,#lib-grid.list-view .lib-raw-badge{position:static;width:16px;height:16px}
    #lib-grid.list-view .lib-col{font-size:10px;color:var(--mut);font-family:ui-monospace,Menlo,monospace;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lib-meta-strip{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);color:#fff;
      font-size:9px;font-family:ui-monospace,Menlo,monospace;padding:3px 5px;line-height:1.3;
      pointer-events:none;opacity:0}
    .lib-card:hover .lib-meta-strip.hover-mode,.lib-meta-strip.always-mode{opacity:1}
    .lib-thumb-wrap{position:relative}
    .lib-card{background:var(--sur);border:2px solid var(--bdr);border-radius:8px;overflow:hidden;
      cursor:pointer;position:relative;box-shadow:var(--lift-1);transition:border-color .15s ease,transform .1s ease}
    .lib-card:hover{border-color:var(--acc);transform:translateY(-1px)}
    .lib-card.sel{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}
    .lib-card.multi{border-color:var(--acc2);box-shadow:0 0 0 1px var(--acc2)}
    .lib-card.sel.multi{box-shadow:0 0 0 1px var(--acc),0 0 0 3px var(--acc2)}
    .lib-card.flag-red{box-shadow:0 0 0 2px #e5484d,0 0 14px 1px rgba(229,72,77,.55)}
    .lib-card.flag-green{box-shadow:0 0 0 2px #46a758,0 0 14px 1px rgba(70,167,88,.55)}
    .lib-card.flag-red.sel{box-shadow:0 0 0 1px var(--acc),0 0 0 3px #e5484d,0 0 14px 1px rgba(229,72,77,.55)}
    .lib-card.flag-green.sel{box-shadow:0 0 0 1px var(--acc),0 0 0 3px #46a758,0 0 14px 1px rgba(70,167,88,.55)}
    /* "Canvas" matte, not a center-crop: the cell stays a fixed size for a tidy grid, but the
       photo sits on its own letterbox background at its REAL aspect ratio (object-fit:contain)
       instead of being cropped to fill a square — same treatment as the docked filmstrip. */
    .lib-thumb-wrap{aspect-ratio:1.3;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden}
    .lib-thumb-wrap img{width:100%;height:100%;object-fit:contain;display:block}
    .lib-card .lib-name{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:var(--mut);
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
    #lib-empty{color:var(--mut);font-size:12px;padding:30px 10px;text-align:center}
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
    body.deskx #lib-overlay:not(.full) .lib-card{border:1px solid var(--bdr);border-radius:6px;padding:2px;background:var(--sur)}
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
      <button class="lib-btn" id="lib-tree-toggle" title="Show/hide the folder tree">☰ Folders</button>
      <button class="lib-btn" id="lib-pick" title="Choose root folder">📁</button>
      <button class="lib-btn" id="lib-gphotos" title="Import from Google Photos">☁️</button>
      <button class="lib-btn" id="lib-recent" title="Recent folders &amp; the Google Photos Download cache">🕘</button>
      <button class="lib-btn" id="lib-expand" title="Full-window view — G">⛶</button>
      <button class="lib-btn" id="lib-close" title="Hide library panel">⇤</button>
    </div>
    <div id="lib-filters">
      <input id="lib-search" placeholder="Search filename…" />
      <select id="lib-source" title="Photo source">
        <option value="folder">This folder</option>
        <option value="edited">All Edited</option>
      </select>
      <select id="lib-type-filter" title="Filter by file type">
        <option value="all">All types</option>
        <option value="raw">RAW</option><option value="jpeg">JPEG</option>
        <option value="png">PNG</option><option value="tiff">TIFF</option>
      </select>
      <select id="lib-camera-filter" title="Filter by camera"><option value="all">All cameras</option></select>
      <select id="lib-lens-filter" title="Filter by lens"><option value="all">All lenses</option></select>
      <select id="lib-tag-filter" title="Filter by tag">
        <option value="all">All tags</option>
        <option value="red">Rejected (X)</option>
        <option value="green">Picked (flag)</option>
        <option value="edited">Edited</option>
        <option value="noedited">Not edited</option>
        <option value="favorite">Favorites</option>
      </select>
    </div>
    <div id="lib-viewbar">
      <div class="lib-seg" id="lib-viewmode-seg">
        <button data-v="grid" title="Grid view">▦</button>
        <button data-v="list" title="List view">☰</button>
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
    </div>
    <div id="lib-bottom"><span style="font-size:11px;color:var(--mut)" id="lib-count"></span></div>
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
    return [profile, window.chromasmithNativeNr !== false ? 1 : 0,
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
  const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };
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
    const recents = getRecentFolders().filter((p) => p !== gDir);
    recentMenu = document.createElement('div');
    recentMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);' +
      'border-radius:8px;padding:4px;font-size:12px;color:var(--txt);font-family:-apple-system,sans-serif;min-width:220px;max-width:320px;box-shadow:var(--lift-2)';
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
    const pins = getPinnedFolders().filter((p) => p !== gDir);
    if (gDir) item('☁️ Google Photos Download', gDir);
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
      invoke('get_thumbnail', { path: job.path })
        .then((buf) => {
          if (job.imgEl.isConnected) {
            const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
            job.imgEl.src = url;
            _thumbUrlsThisGen.push(url);
          }
        })
        .catch((err) => {
          console.warn('get_thumbnail failed for', job.path, err);
          if (job.imgEl.isConnected) {
            job.imgEl.classList.add('thumb-error');
            job.imgEl.parentElement?.classList.add('thumb-broken');
          }
        })
        .finally(() => {
          if (_thumbIO) _thumbIO.unobserve(job.imgEl);
          _thumbActive--;
          _thumbPump();
        });
    }
  }
  function loadThumb(path, imgEl) {
    _thumbQueue.push({ path, imgEl, visible: false, gen: _thumbGen });
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
    // so window.chromasmithNativeNr is already correct when the decode shim reads it. Falls
    // back to the app-wide default (true) for a photo with no saved recipe yet.
    const sc = await getSidecar(path);
    let nativeNrForThisPhoto;
    try { nativeNrForThisPhoto = localStorage.getItem('chromasmithNativeNr') !== '0'; } catch (e) { nativeNrForThisPhoto = true; }
    // Same decode-time-baked, per-photo reasoning as nativeNr above — the RAW demosaic
    // algorithm choice ("" Standard / "ahd" Sparkle-optimized) must also be peeked from the
    // sidecar BEFORE decoding, not restored afterward like the rest of applyUISnapshot.
    let demosaicAlgoForThisPhoto;
    try { demosaicAlgoForThisPhoto = localStorage.getItem('chromasmithDemosaicAlgo') || ''; } catch (e) { demosaicAlgoForThisPhoto = ''; }
    if (sc.recipe) {
      try {
        const snap = snapshotFromB64(sc.recipe);
        if (snap.nativeNr !== undefined) nativeNrForThisPhoto = snap.nativeNr;
        if (snap.demosaicAlgo !== undefined) demosaicAlgoForThisPhoto = snap.demosaicAlgo;
      } catch (e) { /* fall through to default */ }
    }
    window.chromasmithNativeNr = nativeNrForThisPhoto;
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
      } catch (e) { /* no cache yet, or it's stale — fall through to a full decode below */ }
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
    const { path, recipe } = pendingSave;
    pendingSave = null;
    const cur = await getSidecar(path);
    const updated = { ...cur, edited: true, recipe };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating: cur.rating, label: cur.label, edited: true, recipe }).catch((e) => console.error('auto-save recipe', e));
    refreshCardThumbFromCanvas(path);
  }
  window.chromasmithOnEdit = (snap) => {
    if (!state.openedPath) return;
    const path = state.openedPath;
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false, recipe: '' };
    if (!cur.edited) { state.sidecars.set(path, { ...cur, edited: true }); markCardEdited(path); }
    clearTimeout(saveTimer);
    pendingSave = { path, recipe: snapshotToB64(snap) };
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

  async function openFolder(path) {
    state.currentFolder = path;
    state.selected.clear();
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = '<div id="lib-empty">Loading…</div>';
    let entries;
    try {
      entries = await invoke('list_dir', { path });
      _treeListCache.set(path, entries); // opening a folder is the natural "refresh its listing" moment
    } catch (e) {
      grid.innerHTML = `<div id="lib-empty">Can't read this folder.</div>`;
      return;
    }
    state.entries = entries.filter((e) => e.is_image);
    // Sidecars are cheap (small JSON reads) and flags/edited badges need them for first paint —
    // await those. Metadata is NOT cheap on a cold folder (a get_meta cache miss reads the whole
    // RAW file for the lens fallback), and awaiting it for EVERY file kept the grid on
    // "Loading…" until the last file finished — a big folder took tens of seconds before
    // showing anything. Render immediately instead and let meta land in the background, then
    // refresh filters + grid once so sort-by-ISO/camera-filter pick it up.
    await Promise.all(state.entries.map((e) => getSidecar(e.path)));
    const openToken = (state._openToken = (state._openToken || 0) + 1);
    await renderGrid();
    Promise.all(state.entries.map((e) => getMeta(e.path).catch(() => ({})))).then(() => {
      if (state._openToken !== openToken || state.currentFolder !== path) return; // user moved on
      populateSelect(document.getElementById('lib-camera-filter'), state.entries.map((e) => state.meta.get(e.path)?.camera), 'All cameras');
      populateSelect(document.getElementById('lib-lens-filter'), state.entries.map((e) => state.meta.get(e.path)?.lens), 'All lenses');
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
    if (entry.missing) { toast('This photo is no longer at ' + entry.path, false); return; }
    state.selected.clear();
    updateCardSelClasses();
    openInEditor(entry.path);
  }
  // Plain double-click on a single (non-multi-selected) card is just a second single-click —
  // already opened by handleCardClick, nothing further to do here. ⌘/Ctrl-double-click opens
  // the CURRENT multi-selection as a batch (mirrors the context menu's "Open N photos").
  async function handleCardDblClick(e, entry) {
    if (!(e.metaKey || e.ctrlKey)) return;
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
    const files = [];
    for (const p of paths) {
      try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: mimeFromName(p) })); }
      catch (err) { console.error('read_file_bytes', p, err); }
    }
    if (files.length) { state.openedPath = ''; state.openedPaths = paths; await loadFXImages(files); }
    state.selected.clear();
    updateCardSelClasses();
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
      'border-radius:8px;padding:4px;font-size:12px;color:var(--txt);font-family:-apple-system,sans-serif;min-width:180px;box-shadow:var(--lift-2)';
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
      item(`Open ${n > 1 ? n + ' photos' : 'in editor'}`, async () => {
        if (n <= 1) { await openInEditor(paths[0]); return; }
        const files = [];
        for (const p of paths) {
          try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: mimeFromName(p) })); }
          catch (e) { console.error('read_file_bytes', p, e); }
        }
        if (files.length) { state.openedPath = ''; state.openedPaths = paths; await loadFXImages(files); } // batch: no single auto-persist target
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
      const files = [];
      for (const p of paths) {
        try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: mimeFromName(p) })); }
        catch (e) { console.error('read_file_bytes', p, e); }
      }
      if (!files.length) return;
      state.openedPath = '';
      state.openedPaths = paths;
      await loadFXImages(files);
      // restore each photo's saved recipe before exporting, same as opening one normally
      for (let i = 0; i < paths.length; i++) {
        const sc = await getSidecar(paths[i]);
        if (sc.recipe && fxImages[i]) {
          const savedIdx = fxCurIdx; fxCurIdx = i;
          try { applyUISnapshot(snapshotFromB64(sc.recipe)); } catch (e) { console.error('restore recipe', e); }
          fxCurIdx = savedIdx;
        }
      }
      setExportScope(n > 1 ? 'all' : 'current');
      await exportFX();
    });
    item('Reset edit', () => Promise.all(paths.map(async (p) => {
      const cur = await getSidecar(p);
      const updated = { ...cur, edited: false, recipe: '' };
      state.sidecars.set(p, updated);
      await invoke('set_sidecar', { path: p, rating: updated.rating, label: updated.label, edited: false, recipe: '' }).catch((e) => sidecarWriteFailed(p, cur, e));
      const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(p)}"]`);
      const badge = card && card.querySelector('.lib-edited-badge');
      if (badge) badge.remove();
      if (p === state.openedPath) { openInEditor(p); } // re-open to fall back to RAW defaults
    })));
    sep();
    item('Copy edit', async () => {
      const sc = await getSidecar(paths[0]);
      window.__copiedRecipe = sc.recipe || snapshotToB64(getUISnapshot());
      toast('Edit copied', true);
    });
    const pasteItem = item('Paste edit', () => Promise.all(paths.map(async (p) => {
      const cur = await getSidecar(p);
      const updated = { ...cur, edited: true, recipe: window.__copiedRecipe };
      state.sidecars.set(p, updated);
      await invoke('set_sidecar', { path: p, rating: updated.rating, label: updated.label, edited: true, recipe: window.__copiedRecipe }).catch((e) => sidecarWriteFailed(p, cur, e));
      markCardEdited(p);
      if (p === state.openedPath) { try { applyUISnapshot(snapshotFromB64(window.__copiedRecipe)); fxUpdate(); } catch (e) { console.error('paste edit', e); } }
    })));
    if (!window.__copiedRecipe) { pasteItem.style.opacity = '.4'; pasteItem.style.pointerEvents = 'none'; }
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
    shown.forEach((entry, idx) => {
      const sc = state.sidecars.get(entry.path) || { rating: 0, label: '', edited: false };
      const card = document.createElement('div');
      card.className = 'lib-card' + (entry.path === state.openedPath ? ' sel' : '') + (state.selected.has(entry.path) ? ' multi' : '') +
        (sc.label === 'Red' ? ' flag-red' : sc.label === 'Green' ? ' flag-green' : '') + (entry.missing ? ' lib-missing' : '');
      card.dataset.path = entry.path;
      const rawBadge = entry.kind === 'raw' ? `<div class="lib-raw-badge" title="RAW file">R</div>` : '';
      if (isList) {
        const m = state.meta.get(entry.path) || {};
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        card.innerHTML = `<div class="lib-thumb-wrap"><img loading="lazy" alt=""></div>
          <div class="lib-name">${state.showTitle ? esc(entry.name) + (entry.missing ? ' (missing)' : '') : ''}${sc.edited ? EDITED_BADGE_HTML : ''}${rawBadge}</div>
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
        card.innerHTML = `<div class="lib-thumb-wrap"><img loading="lazy" alt="">${metaStripHtml(entry)}
            <div class="lib-flags">${flagsHtml(sc.label, sc.favorite)}</div>
          </div>
          ${sc.edited ? EDITED_BADGE_HTML : ''}
          ${rawBadge}
          ${state.showTitle ? `<div class="lib-name">${entry.name}${entry.missing ? ' (missing)' : ''}</div>` : ''}`;
      }
      // Append to the grid BEFORE calling loadThumb(): _thumbPump() checks img.isConnected
      // (see its comment) so it can drop stale jobs from a rebuilt grid — calling loadThumb()
      // while the card is still detached made isConnected false for every job, silently
      // discarding all of them (the "thumbnails never load" bug).
      grid.appendChild(card);
      const img = card.querySelector('img');
      loadThumb(entry.path, img);
      card.querySelector('.lib-thumb-wrap').onclick = (e) => handleCardClick(e, entry, idx, shown);
      card.querySelector('.lib-thumb-wrap').ondblclick = (e) => { e.stopPropagation(); handleCardDblClick(e, entry); };
      card.oncontextmenu = (e) => showContextMenu(e, entry, shown);
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
    if (!shown.length) grid.innerHTML = '<div id="lib-empty">No photos match this filter in this folder.</div>';
    document.getElementById('lib-count').textContent = state.selected.size
      ? `${state.selected.size} selected — ${shown.length} of ${state.entries.length} photo(s)`
      : `${shown.length} of ${state.entries.length} photo(s)`;
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  // Folder tree starts collapsed — the photo grid is the page, the tree is occasional
  // navigation (see the CSS comment above #lib-overlay.tree-collapsed). Persisted so the
  // choice sticks across relaunches, same treatment as view mode/sort/thumb size below.
  const treeToggleBtn = overlay.querySelector('#lib-tree-toggle');
  let treeCollapsed = localStorage.getItem('chromasmith_lib_tree_collapsed') !== '0';
  function syncTreeToggle() {
    overlay.classList.toggle('tree-collapsed', treeCollapsed);
    treeToggleBtn.classList.toggle('on', !treeCollapsed);
  }
  syncTreeToggle();
  treeToggleBtn.onclick = () => {
    treeCollapsed = !treeCollapsed;
    localStorage.setItem('chromasmith_lib_tree_collapsed', treeCollapsed ? '1' : '0');
    syncTreeToggle();
  };
  overlay.querySelector('#lib-pick').onclick = pickFolder;
  overlay.querySelector('#lib-gphotos').onclick = () => {
    // gpImportClick lives in chromasmith-22.html (the web-app half); it's exposed on window.
    if (typeof window.gpImportClick === 'function') window.gpImportClick();
  };
  overlay.querySelector('#lib-recent').onclick = toggleRecentMenu;
  overlay.querySelector('#lib-close').onclick = () => { if (state.open) toggleLibrary(); };
  overlay.querySelector('#lib-expand').onclick = () => toggleExpandedView();
  function toggleExpandedView(force) {
    state.expanded_view = force !== undefined ? force : !state.expanded_view;
    overlay.classList.toggle('full', state.expanded_view);
    document.body.classList.toggle('lib-full', state.expanded_view);
    syncDockPadding();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  document.addEventListener('keydown', (e) => {
    if (!state.open) return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea,[contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // ── Grid keyboard culling (Lightroom idiom): arrows move a highlight through the CURRENT
    // sorted/filtered order, Enter opens it, X rejects / P picks / U clears the flag on it (or
    // on the multi-selection when one exists). The highlight rides on state.openedPath when a
    // photo is open, else an internal cursor.
    const shown = state.entries.filter(passesFilters);
    const sorted = shown.length ? sortEntries(shown) : [];
    const curIdx = sorted.findIndex((en) => en.path === (state._kbCursor || state.openedPath));
    const move = (delta) => {
      if (!sorted.length) return;
      const next = Math.max(0, Math.min(sorted.length - 1, (curIdx < 0 ? (delta > 0 ? -1 : 0) : curIdx) + delta));
      state._kbCursor = sorted[next].path;
      const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(state._kbCursor)}"]`);
      if (card) { card.scrollIntoView({ block: 'nearest' }); }
      state.selected.clear(); state.selected.add(state._kbCursor); updateCardSelClasses();
      e.preventDefault();
    };
    const kbTargets = () => (state.selected.size ? [...state.selected] : (state._kbCursor ? [state._kbCursor] : (state.openedPath ? [state.openedPath] : [])));
    if (e.key === 'ArrowLeft') { move(-1); return; }
    if (e.key === 'ArrowRight') { move(1); return; }
    if (e.key === 'Enter' && (state._kbCursor || state.selected.size === 1)) {
      e.preventDefault(); openInEditor(state._kbCursor || [...state.selected][0]); return;
    }
    if (e.key === 'x' || e.key === 'X') { kbTargets().forEach((p) => setLabel(p, 'Red')); return; }
    if (e.key === 'p' || e.key === 'P') { kbTargets().forEach((p) => setLabel(p, 'Green')); return; }
    if (e.key === 'u' || e.key === 'U') { kbTargets().forEach((p) => setLabel(p, '')); return; }
    if (e.key === 'g' || e.key === 'G') toggleExpandedView();
    else if (e.key === 'Escape' && state.expanded_view) toggleExpandedView(false);
  });
  overlay.querySelector('#lib-type-filter').onchange = (e) => { state.typeFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-camera-filter').onchange = (e) => { state.cameraFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-lens-filter').onchange = (e) => { state.lensFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-tag-filter').onchange = (e) => { state.tagFilter = e.target.value; renderGrid(); };
  let searchDebounce;
  overlay.querySelector('#lib-search').oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.search = e.target.value.toLowerCase(); renderGrid(); }, 150);
  };

  // ── view options: view mode, sort, thumb size, metadata display, source ─────────────────
  const viewSeg = overlay.querySelector('#lib-viewmode-seg');
  function syncViewSeg() { viewSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.viewMode)); }
  viewSeg.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { state.viewMode = b.dataset.v; localStorage.setItem('chromasmith_lib_view', state.viewMode); syncViewSeg(); renderGrid(); };
  });
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
    state.selected.clear();
    grid = document.getElementById('lib-grid');
    grid.innerHTML = '<div id="lib-empty">Loading…</div>';
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
    grid.innerHTML = '<div id="lib-empty">Loading…</div>';
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
  ];
  let collectionCounts = {};
  function renderCollections() {
    const host = document.getElementById('lib-collections');
    if (!host) return;
    host.innerHTML = COLLECTIONS.map((c) => `
      <div class="lib-coll-row${state.source === c.name ? ' on' : ''}" data-coll="${c.name}">
        <span class="lib-coll-ic">${c.icon}</span><span class="lib-coll-lb">${c.label}</span>
        <span class="lib-coll-count">${collectionCounts[c.name] || ''}</span>
      </div>`).join('') + '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Folders</div>';
    host.querySelectorAll('.lib-coll-row').forEach((row) => {
      row.onclick = () => {
        const name = row.dataset.coll;
        if (name === 'edited') ensureBackfill();
        if (name === 'exported') openExportedView();
        else openCollectionView(name);
      };
    });
  }
  function renderCollectionCounts() {
    invoke('collection_counts').then((counts) => { collectionCounts = counts; renderCollections(); }).catch(() => {});
  }
  renderCollections();
  renderCollectionCounts();

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
      if (!state.root) { await pickFolder(); return; }
      await renderTree();
      if (state.currentFolder) await openFolder(state.currentFolder);
      else await openFolder(state.root);
    }
  }
  window.chromasmithToggleLibrary = toggleLibrary; // called from the header button in desktop-native.js

  window.__TAURI__.event.listen('menu-library', toggleLibrary);

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
