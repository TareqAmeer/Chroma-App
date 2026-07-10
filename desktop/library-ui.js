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
    entries: [],          // image entries in the currently-viewed folder
    ratings: new Map(),    // path -> rating (cached client-side once fetched)
    minRating: 0,
    open: false,
  };

  // ── styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #lib-overlay{position:fixed;inset:0;z-index:5000;background:#17171b;display:none;
      grid-template-columns:260px 1fr;grid-template-rows:56px 1fr 52px;color:#f0ece2;
      font-family:-apple-system,'Helvetica Neue',sans-serif;}
    #lib-overlay.on{display:grid}
    #lib-top{grid-column:1/3;display:flex;align-items:center;gap:10px;padding:0 16px;
      border-bottom:1px solid #34343f;-webkit-app-region:drag}
    #lib-top button,#lib-top select{-webkit-app-region:no-drag}
    #lib-top .lib-title{font-weight:600;font-size:15px;margin-right:auto;padding-left:70px}
    #lib-side{grid-row:2;border-right:1px solid #34343f;overflow:auto;padding:10px 6px}
    #lib-main{grid-row:2;overflow:auto;padding:16px}
    #lib-bottom{grid-column:1/3;grid-row:3;display:flex;align-items:center;gap:14px;
      padding:0 16px;border-top:1px solid #34343f}
    .lib-btn{background:#26262d;border:1px solid #34343f;color:#f0ece2;border-radius:8px;
      padding:6px 12px;font-size:12px;cursor:pointer}
    .lib-btn:hover{background:#34343f}
    .lib-tree-node{font-size:12px;white-space:nowrap;user-select:none}
    .lib-tree-row{display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:6px;cursor:pointer}
    .lib-tree-row:hover{background:#26262d}
    .lib-tree-row.on{background:#34343f}
    .lib-tree-chev{width:14px;flex:0 0 14px;text-align:center;opacity:.6;font-size:10px}
    .lib-tree-children{margin-left:16px}
    #lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
    .lib-card{background:#1f1f25;border:1px solid #34343f;border-radius:10px;overflow:hidden;
      cursor:pointer;position:relative}
    .lib-card:hover{border-color:#d4903a}
    .lib-thumb-wrap{aspect-ratio:1.3;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .lib-thumb-wrap img{width:100%;height:100%;object-fit:cover;display:block}
    .lib-card .lib-name{font-size:11px;font-family:ui-monospace,Menlo,monospace;color:#9a968f;
      padding:6px 8px 2px}
    .lib-stars{display:flex;gap:2px;padding:0 8px 8px}
    .lib-star{cursor:pointer;font-size:13px;color:#4a4a55}
    .lib-star.on{color:#d4903a}
    #lib-empty{color:#9a968f;font-size:13px;padding:40px;text-align:center}
  `;
  document.head.appendChild(style);

  // ── DOM scaffold ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'lib-overlay';
  overlay.innerHTML = `
    <div id="lib-top">
      <span class="lib-title">Library</span>
      <button class="lib-btn" id="lib-pick">Choose Folder…</button>
      <select class="lib-btn" id="lib-filter" title="Filter by minimum star rating">
        <option value="0">All photos</option>
        <option value="1">★ 1+</option><option value="2">★★ 2+</option>
        <option value="3">★★★ 3+</option><option value="4">★★★★ 4+</option>
        <option value="5">★★★★★ 5</option>
      </select>
      <button class="lib-btn" id="lib-close">Close</button>
    </div>
    <div id="lib-side"></div>
    <div id="lib-main"><div id="lib-grid"></div></div>
    <div id="lib-bottom"><span style="font-size:11px;color:#9a968f" id="lib-count"></span></div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#lib-top').setAttribute('data-tauri-drag-region', '');

  // ── helpers ─────────────────────────────────────────────────────────────────
  const baseName = (p) => p.split('/').pop();
  async function pickFolder() {
    try {
      const chosen = await invoke('plugin:dialog|open', { directory: true, multiple: false });
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

  function starsHtml(path, rating) {
    let h = '';
    for (let i = 1; i <= 5; i++) h += `<span class="lib-star${i <= rating ? ' on' : ''}" data-i="${i}">★</span>`;
    return h;
  }

  async function openInEditor(path) {
    try {
      const buf = await invoke('read_file_bytes', { path });
      const file = new File([buf], baseName(path), { type: '' });
      await loadFXImages([file]); // bare identifier — see desktop-native.js's note on this
      overlay.classList.remove('on');
      state.open = false;
    } catch (e) {
      console.error('openInEditor', e);
    }
  }

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
  async function openFolder(path) {
    state.currentFolder = path;
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
    await renderGrid();
  }
  async function renderGrid() {
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = '';
    const shown = [];
    for (const entry of state.entries) {
      const rating = state.ratings.has(entry.path) ? state.ratings.get(entry.path) : await invoke('get_rating', { path: entry.path }).then((r) => { state.ratings.set(entry.path, r); return r; }).catch(() => 0);
      if (rating < state.minRating) continue;
      shown.push(entry);
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.innerHTML = `<div class="lib-thumb-wrap"><img loading="lazy" alt=""></div>
        <div class="lib-name">${entry.name}</div>
        <div class="lib-stars">${starsHtml(entry.path, Math.max(rating, 0))}</div>`;
      const img = card.querySelector('img');
      loadThumb(entry.path, img);
      card.querySelector('.lib-thumb-wrap').ondblclick = () => openInEditor(entry.path);
      card.querySelectorAll('.lib-star').forEach((star) => {
        star.onclick = async (e) => {
          e.stopPropagation();
          const val = parseInt(star.dataset.i, 10);
          const newRating = state.ratings.get(entry.path) === val ? 0 : val; // click same star again to clear
          state.ratings.set(entry.path, newRating);
          await invoke('set_rating', { path: entry.path, rating: newRating }).catch(() => {});
          card.querySelector('.lib-stars').innerHTML = starsHtml(entry.path, newRating);
          card.querySelectorAll('.lib-star').forEach((s2) => { s2.onclick = star.onclick; });
        };
      });
      grid.appendChild(card);
    }
    if (!shown.length) grid.innerHTML = '<div id="lib-empty">No photos match this filter in this folder.</div>';
    document.getElementById('lib-count').textContent = `${shown.length} of ${state.entries.length} photo(s)`;
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  overlay.querySelector('#lib-pick').onclick = pickFolder;
  overlay.querySelector('#lib-close').onclick = () => { overlay.classList.remove('on'); state.open = false; };
  overlay.querySelector('#lib-filter').onchange = (e) => { state.minRating = parseInt(e.target.value, 10); renderGrid(); };

  async function toggleLibrary() {
    state.open = !state.open;
    overlay.classList.toggle('on', state.open);
    if (state.open) {
      if (!state.root) { await pickFolder(); return; }
      await renderTree();
      if (state.currentFolder) await openFolder(state.currentFolder);
      else await openFolder(state.root);
    }
  }
  window.chromasmithToggleLibrary = toggleLibrary; // called from the header button in desktop-native.js

  window.__TAURI__.event.listen('menu-library', toggleLibrary);
})();
