// Chromasmith Library view: local folder browser with cached thumbnails + star ratings,
// alongside (not replacing) the Google Photos integration — purely for finding/culling/rating
// RAWs on disk before editing. Native-only (arbitrary filesystem folder browsing isn't a thing
// in a sandboxed browser); injected only into the Tauri build, gated on window.__TAURI__, so
// this file is a safe no-op anywhere else. chromasmith-22.html is never touched.
(function () {
  if (!window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;

  const LS_ROOT = 'chromasmith_lib_root';
  const state = {
    root: localStorage.getItem(LS_ROOT) || '',
    expanded: new Set(),
    currentFolder: '',
    entries: [],           // image entries in the currently-viewed folder
    sidecars: new Map(),   // path -> {rating,label,edited,recipe} (cached client-side)
    meta: new Map(),       // path -> {camera,lens,date,iso}
    minRating: 0,
    typeFilter: 'all',     // 'all' | 'raw' | 'jpeg' | 'png' | 'tiff'
    cameraFilter: 'all',
    lensFilter: 'all',
    tagFilter: 'all',      // 'all' | 'red' | 'green' | 'edited' | 'noedited'
    search: '',
    open: false,
    expanded_view: false,  // full-window library grid (vs the docked 340px strip)
    openedPath: '',        // path of the photo currently loaded into the editor FROM the library
    selected: new Set(),   // multi-selected paths (shift/cmd-click), for batch rate/flag/open
  };

  // ── styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  // RapidRAW-style DOCKED left panel (not a modal overlay): library and editor are visible
  // and usable at the same time. The app's own layout is untouched — body gets padding-left
  // while the dock is open, and a window resize event re-fits the preview.
  const DOCK_W = 340;
  style.textContent = `
    #lib-overlay{position:fixed;top:0;left:0;bottom:0;width:${DOCK_W}px;z-index:4000;
      background:#17171b;display:none;border-right:1px solid #34343f;
      grid-template-rows:auto auto minmax(120px,26%) 1fr 28px;color:#f0ece2;
      font-family:-apple-system,'Helvetica Neue',sans-serif;transition:width .15s ease;}
    #lib-overlay.on{display:grid}
    #lib-overlay.full{width:100vw;grid-template-rows:auto auto minmax(100px,18%) 1fr 28px}
    #lib-overlay.full #lib-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
    body.lib-docked{padding-left:${DOCK_W}px}
    body.lib-docked.lib-full{padding-left:0}
    #lib-top{display:flex;align-items:center;gap:8px;padding:34px 12px 6px;-webkit-app-region:drag}
    #lib-top button{-webkit-app-region:no-drag}
    #lib-top .lib-title{font-weight:600;font-size:14px;margin-right:auto}
    #lib-filters{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 12px 8px}
    #lib-filters #lib-search{grid-column:1/3}
    #lib-side{overflow:auto;padding:4px 8px;border-top:1px solid #24242c;border-bottom:1px solid #24242c}
    #lib-main{overflow:auto;padding:10px}
    #lib-bottom{display:flex;align-items:center;gap:14px;padding:0 12px;border-top:1px solid #34343f}
    .lib-btn{background:#26262d;border:1px solid #34343f;color:#f0ece2;border-radius:8px;
      padding:5px 10px;font-size:12px;cursor:pointer}
    .lib-btn:hover{background:#34343f}
    .lib-tree-node{font-size:12px;white-space:nowrap;user-select:none}
    .lib-tree-row{display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:6px;cursor:pointer}
    .lib-tree-row:hover{background:#26262d}
    .lib-tree-row.on{background:#34343f}
    .lib-tree-chev{width:14px;flex:0 0 14px;text-align:center;opacity:.6;font-size:10px}
    .lib-tree-children{margin-left:14px}
    #lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
    .lib-card{background:#1f1f25;border:1px solid #34343f;border-radius:8px;overflow:hidden;
      cursor:pointer;position:relative}
    .lib-card:hover{border-color:#d4903a}
    .lib-card.sel{border-color:#d4903a;box-shadow:0 0 0 1px #d4903a}
    .lib-card.multi{border-color:#5b9bd5;box-shadow:0 0 0 1px #5b9bd5}
    .lib-card.sel.multi{box-shadow:0 0 0 1px #d4903a,0 0 0 3px #5b9bd5}
    .lib-thumb-wrap{aspect-ratio:1.3;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .lib-thumb-wrap img{width:100%;height:100%;object-fit:cover;display:block}
    .lib-card .lib-name{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#9a968f;
      padding:4px 6px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lib-tagrow{display:flex;align-items:center;gap:6px;padding:0 6px 6px}
    .lib-stars{display:flex;gap:1px}
    .lib-star{cursor:pointer;font-size:12px;color:#4a4a55}
    .lib-star.on{color:#d4903a}
    .lib-flags{display:flex;gap:3px;margin-left:auto}
    .lib-flag{cursor:pointer;font-size:11px;opacity:.35;filter:grayscale(1)}
    .lib-flag.on{opacity:1;filter:none}
    .lib-edited-badge{position:absolute;top:4px;right:4px;background:#d4903a;color:#17171b;
      font-size:8px;font-weight:700;letter-spacing:.03em;border-radius:4px;padding:1px 4px}
    #lib-empty{color:#9a968f;font-size:12px;padding:30px 10px;text-align:center}
    #lib-filters select,#lib-filters input{background:#26262d;border:1px solid #34343f;color:#f0ece2;
      border-radius:7px;padding:5px 8px;font-size:11px;min-width:0}
    #lib-provisional{position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;
      object-fit:contain;pointer-events:none;z-index:50;display:none}
    #lib-provisional.on{display:block}
    /* deskx (Darkroom shell): the docked panel becomes a 120px thumbnail FILMSTRIP — pure
       thumbnails, single column, no filters/tree/name chrome (all of that lives in the
       full-window grid, G / ⛶). .full keeps its own 100vw rules and overrides these. */
    body.deskx #lib-overlay:not(.full){width:120px;grid-template-rows:auto 1fr}
    body.deskx.lib-docked{padding-left:120px}
    body.deskx.lib-docked.lib-full{padding-left:0}
    body.deskx #lib-overlay:not(.full) #lib-filters,body.deskx #lib-overlay:not(.full) #lib-side,
    body.deskx #lib-overlay:not(.full) #lib-bottom{display:none}
    body.deskx #lib-overlay #lib-top{padding:8px 8px 6px;-webkit-app-region:no-drag} /* strip starts below the deskbar — no traffic-light clearance needed */
    body.deskx #lib-overlay:not(.full) #lib-top{padding:8px 6px 6px;gap:4px}
    body.deskx #lib-overlay:not(.full) #lib-top .lib-title{display:none}
    body.deskx #lib-overlay:not(.full) #lib-main{padding:6px}
    body.deskx #lib-overlay:not(.full) #lib-grid{grid-template-columns:1fr;gap:6px}
    body.deskx #lib-overlay:not(.full) .lib-card .lib-name,
    body.deskx #lib-overlay:not(.full) .lib-tagrow{display:none}
    body.deskx #lib-overlay:not(.full) .lib-thumb-wrap{aspect-ratio:1}
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
      <button class="lib-btn" id="lib-pick" title="Choose root folder">📁</button>
      <button class="lib-btn" id="lib-expand" title="Full-window view — G">⛶</button>
      <button class="lib-btn" id="lib-close" title="Hide library panel">⇤</button>
    </div>
    <div id="lib-filters">
      <input id="lib-search" placeholder="Search filename…" />
      <select id="lib-type-filter" title="Filter by file type">
        <option value="all">All types</option>
        <option value="raw">RAW</option><option value="jpeg">JPEG</option>
        <option value="png">PNG</option><option value="tiff">TIFF</option>
      </select>
      <select id="lib-camera-filter" title="Filter by camera"><option value="all">All cameras</option></select>
      <select id="lib-lens-filter" title="Filter by lens"><option value="all">All lenses</option></select>
      <select id="lib-tag-filter" title="Filter by tag">
        <option value="all">All tags</option>
        <option value="red">🚩 Red flag</option>
        <option value="green">🟢 Green flag</option>
        <option value="edited">Edited</option>
        <option value="noedited">Not edited</option>
      </select>
      <select id="lib-filter" title="Filter by minimum star rating">
        <option value="0">All ratings</option>
        <option value="1">★ 1+</option><option value="2">★★ 2+</option>
        <option value="3">★★★ 3+</option><option value="4">★★★★ 4+</option>
        <option value="5">★★★★★ 5</option>
      </select>
    </div>
    <div id="lib-side"></div>
    <div id="lib-main"><div id="lib-grid"></div></div>
    <div id="lib-bottom"><span style="font-size:11px;color:#9a968f" id="lib-count"></span></div>
  `;
  document.body.appendChild(overlay);

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
    } catch (e) { /* embedded preview unavailable — just skip the provisional frame */ }
    return () => { if (myToken === provisionalToken) el.classList.remove('on'); };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  const baseName = (p) => p.split('/').pop();
  async function pickFolder() {
    try {
      const chosen = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false } });
      if (!chosen) return;
      state.root = Array.isArray(chosen) ? chosen[0] : chosen;
      localStorage.setItem(LS_ROOT, state.root);
      state.expanded.clear();
      state.expanded.add(state.root);
      await renderTree();
      await openFolder(state.root);
    } catch (e) { console.error('pickFolder', e); }
  }

  async function loadThumb(path, imgEl) {
    try {
      const buf = await invoke('get_thumbnail', { path });
      const blob = new Blob([buf], { type: 'image/jpeg' });
      imgEl.src = URL.createObjectURL(blob);
    } catch (e) { /* leave blank on failure — a broken thumb isn't fatal */ }
  }

  function starsHtml(rating) {
    let h = '';
    for (let i = 1; i <= 5; i++) h += `<span class="lib-star${i <= rating ? ' on' : ''}" data-i="${i}">★</span>`;
    return h;
  }
  function flagsHtml(label) {
    return `<span class="lib-flag${label === 'Red' ? ' on' : ''}" data-flag="Red" title="Red flag">🚩</span>` +
           `<span class="lib-flag${label === 'Green' ? ' on' : ''}" data-flag="Green" title="Green flag">🟢</span>`;
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

  async function openInEditor(path) {
    // Selecting a photo from the full-window home screen transitions into the editor — the
    // library collapses to the docked filmstrip (stays open, just narrow), it doesn't close.
    if (state.expanded_view) toggleExpandedView(false);
    const hideProvisional = await showProvisional(path);
    try {
      const buf = await invoke('read_file_bytes', { path });
      const file = new File([buf], baseName(path), { type: '' });
      await loadFXImages([file]); // bare identifier — see desktop-native.js's note on this
      state.openedPath = path;
      const sc = await getSidecar(path);
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
            model: m.camera || '', shutter: m.shutter || '', aperture: m.aperture || '',
            iso: m.iso ? `ISO ${m.iso}` : '', focalLen: m.focal_len || '', date: m.date || '',
          };
          fxImages[0].exif = exif;
          showExif(exif);
        }
      } catch (e) { console.error('load metadata', e); }
      // Docked layout: the panel stays open next to the editor; just mark the active card.
      overlay.querySelectorAll('.lib-card.sel').forEach((c) => c.classList.remove('sel'));
      const card = overlay.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
      if (card) card.classList.add('sel');
    } catch (e) {
      console.error('openInEditor', e);
    } finally {
      hideProvisional();
    }
  }

  // ── auto-persist: any edit to a library-opened photo silently saves a non-destructive
  // recipe (the same FX snapshot the undo history and session-save use) into its XMP
  // sidecar and marks it "edited" — even before export. Debounced so a slider drag writes
  // once, not per frame. No-op for photos not opened from the Library (state.openedPath ''). ──
  let saveTimer;
  window.chromasmithOnEdit = (snap) => {
    if (!state.openedPath) return;
    clearTimeout(saveTimer);
    const path = state.openedPath;
    saveTimer = setTimeout(async () => {
      const cur = await getSidecar(path);
      const recipe = snapshotToB64(snap);
      const updated = { ...cur, edited: true, recipe };
      state.sidecars.set(path, updated);
      await invoke('set_sidecar', { path, rating: cur.rating, label: cur.label, edited: true, recipe }).catch((e) => console.error('auto-save recipe', e));
    }, 2000);
  };

  // ── folder tree ────────────────────────────────────────────────────────────
  async function renderTree() {
    const side = document.getElementById('lib-side');
    side.innerHTML = '';
    if (!state.root) { side.innerHTML = '<div style="padding:10px;font-size:12px;color:#9a968f">Choose a folder to browse.</div>'; return; }
    const rootNode = await buildTreeNode(state.root);
    side.appendChild(rootNode);
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
        const entries = await invoke('list_dir', { path });
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
    } catch (e) {
      grid.innerHTML = `<div id="lib-empty">Can't read this folder.</div>`;
      return;
    }
    state.entries = entries.filter((e) => e.is_image);
    // Prefetch sidecar+meta for every entry up front — filters need the full set to decide
    // what's shown, and both are cheap/disk-cached (header-only parse, no pixel decode).
    await Promise.all(state.entries.map((e) => Promise.all([getSidecar(e.path), getMeta(e.path)])));
    populateSelect(document.getElementById('lib-camera-filter'), state.entries.map((e) => state.meta.get(e.path)?.camera), 'All cameras');
    populateSelect(document.getElementById('lib-lens-filter'), state.entries.map((e) => state.meta.get(e.path)?.lens), 'All lenses');
    await renderGrid();
  }

  function passesFilters(entry) {
    const sc = state.sidecars.get(entry.path) || { rating: 0, label: '', edited: false };
    const m = state.meta.get(entry.path) || {};
    if (sc.rating < state.minRating) return false;
    if (state.typeFilter !== 'all' && entry.kind !== state.typeFilter) return false;
    if (state.cameraFilter !== 'all' && m.camera !== state.cameraFilter) return false;
    if (state.lensFilter !== 'all' && m.lens !== state.lensFilter) return false;
    if (state.search && !entry.name.toLowerCase().includes(state.search)) return false;
    if (state.tagFilter === 'red' && sc.label !== 'Red') return false;
    if (state.tagFilter === 'green' && sc.label !== 'Green') return false;
    if (state.tagFilter === 'edited' && !sc.edited) return false;
    if (state.tagFilter === 'noedited' && sc.edited) return false;
    return true;
  }

  // ── rating/flag mutation, factored so both the per-card star/flag clicks AND the
  // multi-select context menu can apply the same write+cache+redraw logic. ─────────────────
  async function setRating(path, rating) {
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false };
    const updated = { ...cur, rating };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating, label: updated.label, edited: updated.edited }).catch(() => {});
    const card = grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card) card.querySelector('.lib-stars').innerHTML = starsHtml(Math.max(rating, 0));
  }
  async function setLabel(path, label) {
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false };
    const updated = { ...cur, label };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating: updated.rating, label, edited: updated.edited }).catch(() => {});
    const card = grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card) card.querySelector('.lib-flags').innerHTML = flagsHtml(label);
  }
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
    state.selected.clear();
    selectAnchor = idx;
    updateCardSelClasses();
    openInEditor(entry.path); // plain click opens, same as before multi-select existed
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
    closeContextMenu();
    const paths = Array.from(state.selected);
    const n = paths.length;
    ctxMenu = document.createElement('div');
    ctxMenu.style.cssText = 'position:fixed;z-index:9999;background:#26262d;border:1px solid #34343f;' +
      'border-radius:8px;padding:4px;font-size:12px;color:#f0ece2;font-family:-apple-system,sans-serif;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    const item = (label, fn) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      el.onmouseenter = () => { el.style.background = '#34343f'; };
      el.onmouseleave = () => { el.style.background = ''; };
      el.onclick = async (ev) => { ev.stopPropagation(); closeContextMenu(); await fn(); };
      ctxMenu.appendChild(el);
      return el;
    };
    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:#34343f;margin:4px 0'; ctxMenu.appendChild(s); };
    item(`Open ${n > 1 ? n + ' photos' : 'in editor'}`, async () => {
      if (n <= 1) { await openInEditor(paths[0]); return; }
      const files = [];
      for (const p of paths) {
        try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: '' })); }
        catch (e) { console.error('read_file_bytes', p, e); }
      }
      if (files.length) { state.openedPath = ''; await loadFXImages(files); } // batch: no single auto-persist target
    });
    sep();
    for (let r = 1; r <= 5; r++) item(`${'★'.repeat(r)} Rate ${r}`, () => Promise.all(paths.map((p) => setRating(p, r))));
    item('Clear rating', () => Promise.all(paths.map((p) => setRating(p, 0))));
    sep();
    item('🚩 Red flag', () => Promise.all(paths.map((p) => setLabel(p, 'Red'))));
    item('🟢 Green flag', () => Promise.all(paths.map((p) => setLabel(p, 'Green'))));
    item('Clear flag', () => Promise.all(paths.map((p) => setLabel(p, ''))));
    document.body.appendChild(ctxMenu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = Math.min(e.clientX, vw - r.width - 8) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, vh - r.height - 8) + 'px';
  }

  async function renderGrid() {
    grid = document.getElementById('lib-grid');
    grid.innerHTML = '';
    const shown = state.entries.filter(passesFilters);
    shown.forEach((entry, idx) => {
      const sc = state.sidecars.get(entry.path) || { rating: 0, label: '', edited: false };
      const card = document.createElement('div');
      card.className = 'lib-card' + (entry.path === state.openedPath ? ' sel' : '') + (state.selected.has(entry.path) ? ' multi' : '');
      card.dataset.path = entry.path;
      card.innerHTML = `<div class="lib-thumb-wrap"><img loading="lazy" alt=""></div>
        ${sc.edited ? '<div class="lib-edited-badge">EDITED</div>' : ''}
        <div class="lib-name">${entry.name}</div>
        <div class="lib-tagrow">
          <div class="lib-stars">${starsHtml(Math.max(sc.rating, 0))}</div>
          <div class="lib-flags">${flagsHtml(sc.label)}</div>
        </div>`;
      const img = card.querySelector('img');
      loadThumb(entry.path, img);
      card.querySelector('.lib-thumb-wrap').onclick = (e) => handleCardClick(e, entry, idx, shown);
      card.oncontextmenu = (e) => showContextMenu(e, entry, shown);
      card.querySelectorAll('.lib-star').forEach((star) => {
        star.onclick = (e) => {
          e.stopPropagation();
          const val = parseInt(star.dataset.i, 10);
          const cur = state.sidecars.get(entry.path) || { rating: 0 };
          setRating(entry.path, cur.rating === val ? 0 : val); // click same star again to clear
        };
      });
      card.querySelectorAll('.lib-flag').forEach((flag) => {
        flag.onclick = (e) => {
          e.stopPropagation();
          const which = flag.dataset.flag;
          const cur = state.sidecars.get(entry.path) || { label: '' };
          setLabel(entry.path, cur.label === which ? '' : which); // click same flag again to clear
        };
      });
      grid.appendChild(card);
    });
    if (!shown.length) grid.innerHTML = '<div id="lib-empty">No photos match this filter in this folder.</div>';
    document.getElementById('lib-count').textContent = state.selected.size
      ? `${state.selected.size} selected — ${shown.length} of ${state.entries.length} photo(s)`
      : `${shown.length} of ${state.entries.length} photo(s)`;
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  overlay.querySelector('#lib-pick').onclick = pickFolder;
  overlay.querySelector('#lib-close').onclick = () => { if (state.open) toggleLibrary(); };
  overlay.querySelector('#lib-expand').onclick = () => toggleExpandedView();
  function toggleExpandedView(force) {
    state.expanded_view = force !== undefined ? force : !state.expanded_view;
    overlay.classList.toggle('full', state.expanded_view);
    document.body.classList.toggle('lib-full', state.expanded_view);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  document.addEventListener('keydown', (e) => {
    if (!state.open) return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea,[contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'g' || e.key === 'G') toggleExpandedView();
    else if (e.key === 'Escape' && state.expanded_view) toggleExpandedView(false);
  });
  overlay.querySelector('#lib-filter').onchange = (e) => { state.minRating = parseInt(e.target.value, 10); renderGrid(); };
  overlay.querySelector('#lib-type-filter').onchange = (e) => { state.typeFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-camera-filter').onchange = (e) => { state.cameraFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-lens-filter').onchange = (e) => { state.lensFilter = e.target.value; renderGrid(); };
  overlay.querySelector('#lib-tag-filter').onchange = (e) => { state.tagFilter = e.target.value; renderGrid(); };
  let searchDebounce;
  overlay.querySelector('#lib-search').oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.search = e.target.value.toLowerCase(); renderGrid(); }, 150);
  };

  async function toggleLibrary() {
    state.open = !state.open;
    overlay.classList.toggle('on', state.open);
    document.body.classList.toggle('lib-docked', state.open);
    if (!state.open && state.expanded_view) toggleExpandedView(false); // don't stay full-window for next open
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
    toggleLibrary().then(() => toggleExpandedView(true));
  }
})();
