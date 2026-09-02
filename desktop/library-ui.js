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
  let ltAlbums = [];
  if (!window.__TAURI__ && !LIBTEST) return;
  const invoke = LIBTEST ? libtestInvoke : window.__TAURI__.core.invoke;
  // A Rust command's Result::Err reaches here as a bare String (sometimes a plain sentence like
  // "no such album", sometimes an internal detail like an os-error from a failed write) — either
  // way it was landing in a toast completely unframed, with no verb telling the user what had
  // been ATTEMPTED. `what` says the attempted action; the raw reason still appears, so nothing
  // about a real failure is hidden, but the first thing read is now "Couldn't rename the album",
  // not the bare word an internal Result happened to carry.
  function humanizeErr(what, err) {
    const raw = String((err && err.message) || err || '').trim();
    return `Couldn't ${what}${raw ? ` — ${raw}` : ''}`;
  }
  // Virtual-copy state for the harness, so the version rows in the context menu are reachable
  // without a real sidecar on disk.
  let ltVersions = [], ltActive = 0;
  // Undo-reset mock state — mirrors the Rust one-slot buffer (last_reset_recipe/last_reset_edited)
  // so ?libtest=1 can exercise the "Reset edit" / "Undo last reset" context-menu pair without a
  // real Tauri backend.
  let ltLastResetRecipe = null, ltLastResetEdited = false, ltRecipe = '', ltEdited = false;
  let ltOfflineQueue = [], ltOfflineQueueNextId = 0;
  function ltMetaFor(p) {
    return /\.(mp4|mov|m4v)$/i.test(String(p || ''))
      ? { dur: 12.5, width: 3840, height: 2160, date: '2026-07-20' }
      : { camera: 'DC-S9', lens: 'LUMIX S 18-40', iso: 200, shutter: '1/250', aperture: 'f/5.6', focal_len: '28mm', date: '2026-07-20' };
  }
  // Call counters for the "no redundant work" regression test (library_perf.mjs): reopening an
  // already-cataloged folder must read from catalog_query, not re-walk via list_dir/
  // listDirRecursive — see Fix 1 of the catalog-backed-grid plan. Exposed on window below.
  let libtestListDirCalls = 0, libtestCatalogQueryCalls = 0;
  window.__libtestCallCounts = () => ({ listDir: libtestListDirCalls, catalogQuery: libtestCatalogQueryCalls });
  function libtestInvoke(cmd, args) {
    const A = args || {};
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XBhAAAAABJRU5ErkJggg==';
    const png = Uint8Array.from(atob(px), (c) => c.charCodeAt(0));
    switch (cmd) {
      case 'list_dir': {
        libtestListDirCalls++;
        const dir = String(A.path || '/test');
        if (/Folders only/.test(dir)) return Promise.resolve([]);
        const out = [];
        // ?libn=N synthesises a large folder. 18 is enough to eyeball layout, but grid cost is a
        // question about 500-5000 files and cannot be answered at 18 — see the virtualisation
        // budget in test/perf_bench.mjs.
        const N = Math.max(1, parseInt((/[?&]libn=(\d+)/.exec(location.search) || [])[1] || '18', 10));
        // ⚠️ Every 6th entry is a VIDEO. This mock used to emit nothing but RW2s, which is exactly
        // why a video-card defect (a revoked poster blob URL surviving in a JS cache, so every
        // clip painted a permanent broken-image "?") could never be reproduced in the harness —
        // CLAUDE.md §10.14's point about Library bugs being invisible without ?libtest=1 only
        // holds if the mock actually emits the kinds of entry the grid has to render.
        for (let i = 1; i <= N; i++) {
          const isVid = i % 6 === 0;
          out.push(isVid
            ? { path: `${dir}/P_TM${6000 + i}.MP4`, name: `P_TM${6000 + i}.MP4`, is_dir: false, is_image: false, is_video: true, kind: 'video', ext: 'mp4', mtime: 1700000000 + i, size: 90000000 + i }
            : { path: `${dir}/IMG_${1000 + i}.RW2`, name: `IMG_${1000 + i}.RW2`, is_dir: false, is_image: true, is_video: false, kind: 'raw', ext: 'rw2', mtime: 1700000000 + i, size: 1000 + i });
        }
        out.push({ path: `${dir}/sub`, name: 'sub', is_dir: true, is_image: false, kind: '', ext: '', mtime: 0, size: 0 });
        return Promise.resolve(out);
      }
      // ?libhangthumb=1 simulates the exact failure mode that once hung the whole boot sequence:
      // a single get_thumbnail_or_offline call that never resolves at all (not slow — genuinely
      // never settles). prefetchThumbnails' per-call timeout (library-ui.js) is what's supposed
      // to stop this from ever stalling boot again — this mock is what proves it, rather than
      // trusting the fix by inspection.
      case 'get_thumbnail': case 'get_thumbnail_or_offline': {
        const hang = (/[?&]libhangthumb=([\w,]+)/.exec(location.search) || [])[1];
        if (hang === 'all' || (hang && hang !== 'all' && new RegExp(hang.split(',').join('|')).test(A.path || ''))) return new Promise(() => {});
        return Promise.resolve(png.buffer);
      }
      case 'read_file_bytes': return Promise.resolve(png.buffer);
      case 'get_sidecar': return Promise.resolve({ rating: 0, label: '', favorite: false, edited: ltEdited, recipe: ltRecipe, versions: ltVersions, active: ltActive, last_reset_recipe: ltLastResetRecipe, last_reset_edited: ltLastResetEdited });
      case 'get_sidecar_batch': return Promise.resolve((A.paths || []).map(() => ({ rating: 0, label: '', favorite: false, edited: ltEdited, recipe: ltRecipe, versions: ltVersions, active: ltActive, last_reset_recipe: ltLastResetRecipe, last_reset_edited: ltLastResetEdited })));
      // reset_edit/undo_reset_edit — see CLAUDE.md's Reset-edit-undo item: captures/restores the
      // one-slot undo buffer exactly like the real Rust commands, so the libtest harness can
      // click through "Reset edit" then "Undo last reset" and see the edited badge come back.
      case 'reset_edit': {
        ltLastResetRecipe = ltRecipe; ltLastResetEdited = ltEdited;
        ltRecipe = ''; ltEdited = false;
        return Promise.resolve({ rating: 0, label: '', favorite: false, edited: ltEdited, recipe: ltRecipe, versions: ltVersions, active: ltActive, last_reset_recipe: ltLastResetRecipe, last_reset_edited: ltLastResetEdited });
      }
      case 'undo_reset_edit': {
        if (ltLastResetRecipe === null) return Promise.reject(new Error('Nothing to undo'));
        ltRecipe = ltLastResetRecipe; ltEdited = ltLastResetEdited;
        ltLastResetRecipe = null; ltLastResetEdited = false;
        return Promise.resolve({ rating: 0, label: '', favorite: false, edited: ltEdited, recipe: ltRecipe, versions: ltVersions, active: ltActive, last_reset_recipe: ltLastResetRecipe, last_reset_edited: ltLastResetEdited });
      }
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
      case 'set_sidecar': {
        // Mirror the Rust command's undo-buffer-clearing rule: a genuine edit save (non-empty
        // recipe, edited:true) supersedes any pending reset-undo buffer.
        if (A.edited && A.recipe) { ltRecipe = A.recipe; ltEdited = true; ltLastResetRecipe = null; ltLastResetEdited = false; }
        return Promise.resolve();
      }
      // N1a offline edit queue — mirrors catalog.rs's real conflict logic closely enough to
      // exercise the reconnect flow (?liboffq=1/?liboffqconflict=1, see wireOfflineQueueReconnect
      // below) without a real Tauri backend: queue_offline_edit stores a recipe against a path;
      // list_offline_queue reports each entry's conflict flag from `ltOfflineQueueConflict`
      // (settable via ?liboffqconflict=1 for the harness to exercise the prompt path);
      // apply_queued_edit/discard_queued_edit both remove the entry, the former also "writing"
      // it into the mock sidecar so a real assertion can check the recipe landed.
      case 'queue_offline_edit': {
        ltOfflineQueue = ltOfflineQueue.filter((q) => q.path !== A.path);
        ltOfflineQueue.push({ id: ++ltOfflineQueueNextId, path: A.path, recipe: A.recipe, queued_at: Date.now() / 1000 });
        return Promise.resolve();
      }
      case 'list_offline_queue': {
        const conflict = /[?&]liboffqconflict=1/.test(location.search);
        return Promise.resolve(ltOfflineQueue.map((q) => ({ ...q, conflict })));
      }
      case 'apply_queued_edit': {
        const q = ltOfflineQueue.find((x) => x.id === A.id);
        if (q) { ltRecipe = q.recipe; ltEdited = true; }
        ltOfflineQueue = ltOfflineQueue.filter((x) => x.id !== A.id);
        return Promise.resolve();
      }
      case 'discard_queued_edit': {
        ltOfflineQueue = ltOfflineQueue.filter((x) => x.id !== A.id);
        return Promise.resolve();
      }
      // A video's meta carries dur/width/height and no camera/lens, matching read_meta's real
      // video branch — that is what the grid's duration badge reads.
      case 'get_meta': return Promise.resolve(ltMetaFor(A.path));
      case 'get_meta_batch': return Promise.resolve((A.paths || []).map(ltMetaFor));
      case 'collection_counts': return Promise.resolve({ recents: 4, favorites: 2, edited: 3, exported: 1, flagged: 0, rejected: 0, duplicates: 2, gphotos: 1 });
      case 'album_list': return Promise.resolve(ltAlbums);
      case 'album_create': {
        if (ltAlbums.some((a) => a.name.toLowerCase() === String(A.name).toLowerCase())) return Promise.reject(new Error('exists'));
        const al = { id: 'alb' + (ltAlbums.length + 1), name: A.name, paths: [], updated: Date.now() / 1000 };
        ltAlbums.push(al); return Promise.resolve(al);
      }
      case 'album_rename': { const a = ltAlbums.find((x) => x.id === A.id); if (a) a.name = A.name; return Promise.resolve(); }
      case 'album_delete': { ltAlbums = ltAlbums.filter((x) => x.id !== A.id); return Promise.resolve(); }
      case 'album_add': {
        const a = ltAlbums.find((x) => x.id === A.id); if (!a) return Promise.reject(new Error('no album'));
        const before = a.paths.length;
        (A.paths || []).forEach((p) => { if (!a.paths.includes(p)) a.paths.push(p); });
        return Promise.resolve(a.paths.length - before);
      }
      case 'album_remove': { const a = ltAlbums.find((x) => x.id === A.id); if (a) a.paths = a.paths.filter((p) => !(A.paths || []).includes(p)); return Promise.resolve(); }
      case 'album_set_order': { const a = ltAlbums.find((x) => x.id === A.id); if (a) a.paths = (A.paths || []).filter((p) => a.paths.includes(p)); return Promise.resolve(); }
      case 'list_album': {
        const a = ltAlbums.find((x) => x.id === A.id); if (!a) return Promise.resolve([]);
        return Promise.resolve(a.paths.map((p, i) => ({ path: p, name: p.split('/').pop(), is_dir: false, is_image: true,
          kind: 'raw', mtime: 1700000000 + i, size: 1000 + i, missing: p.includes('ghost') })));
      }
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
      case 'ingest_copy': return new Promise((res) => setTimeout(() => res({ copied: 22, duplicates_skipped: 3, failed: [], dest_root: A.options.destRoot, bytes: 1.4e9 }), 900));
      case 'eject_volume': return Promise.resolve();
      case 'trash_file': case 'duplicate_file': return Promise.resolve();
      case 'plugin:dialog|open': return Promise.resolve('/test/Pictures/2026');
      case 'lr_downloads_dir': return Promise.resolve('/test/Lightroom Download');
      case 'gphotos_downloads_dir': return Promise.resolve('/test/Google Photos Download');
      case 'get_lr_thumb': return Promise.reject(new Error('miss')); // always a miss → exercises the network+save path
      case 'save_lr_thumb': return Promise.resolve();
      case 'list_collection': case 'list_exported': return Promise.resolve([]);
      case 'get_export_history': return Promise.resolve([]);
      // Catalog: `?libcat=1` synthesises N (from ?libn=N, default 18) catalog rows so "All
      // Photos" is screenshot-verifiable without a real SQLite catalog behind it. Every 7th
      // entry is marked offline, matching the plan's libtest convention for exercising the
      // offline card state in a plain browser.
      case 'catalog_add_root': return Promise.resolve({ id: 1, volume_id: 1, rel_path: '', kind: 'originals', abs_path: A.path, requested_rel_path: '' });
      case 'catalog_scan': return Promise.resolve({ scanned: 0, added: 0, marked_absent: 0 });
      case 'catalog_note_deleted': return Promise.resolve((A.paths || []).length);
      case 'get_quicklook_preview': return Promise.resolve(png);
      case 'catalog_dismiss_review': return Promise.resolve((A.paths || []).length);
      // trash_file/duplicate_file: no catalog involvement, just the underlying file op — a
      // harmless no-op mock, matching every other pure-Rust-side mutation's mock in this file.
      case 'trash_file': return Promise.resolve();
      case 'duplicate_file': return Promise.resolve(A.path ? A.path.replace(/(\.[^.]+)$/, ' copy$1') : '');
      case 'catalog_volumes': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve([]);
        // One online, one offline — CLAUDE.md's own stated convention for this exact case, so
        // the Drives section's two states are both screenshot-verifiable in one page load.
        return Promise.resolve([
          { id: 1, uuid: 'local', label: 'This Mac', last_path: '/', is_local: true, total_bytes: 0, online: true },
          { id: 2, uuid: 'ext-1', label: 'Archive T7', last_path: '/Volumes/Archive T7', is_local: false, total_bytes: 2e12, online: true },
          { id: 3, uuid: 'ext-2', label: 'Old LaCie', last_path: '/Volumes/Old LaCie', is_local: false, total_bytes: 1e12, online: false },
        ]);
      }
      case 'catalog_counts': {
        const N = /[?&]libcat=1/.test(location.search) ? Math.max(1, parseInt((/[?&]libn=(\d+)/.exec(location.search) || [])[1] || '18', 10)) : 0;
        return Promise.resolve({ all: N, blurry: N ? Math.max(1, Math.floor(N / 5)) : 0 });
      }
      case 'catalog_date_counts': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve({ days: [], no_date: 0 });
        // A small fixed spread across two months so the tree has something to expand — the
        // exact counts don't need to add up to ?libn's total, this is a layout/wiring check.
        return Promise.resolve({
          days: [
            { y: 2026, m: 8, d: 22, n: 4 }, { y: 2026, m: 8, d: 15, n: 2 }, { y: 2026, m: 7, d: 3, n: 6 },
            { y: 2025, m: 12, d: 25, n: 3 },
          ],
          no_date: 1,
        });
      }
      case 'cache_usage': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve({ offline_thumbs_bytes: 0, decode_cache_bytes: 0, working_thumbs_bytes: 0, budget_bytes: 20 * 1024 * 1024 * 1024 });
        return Promise.resolve({
          offline_thumbs_bytes: 3.2 * 1024 * 1024 * 1024,
          decode_cache_bytes: 5.1 * 1024 * 1024 * 1024,
          working_thumbs_bytes: 120 * 1024 * 1024,
          budget_bytes: 20 * 1024 * 1024 * 1024,
        });
      }
      case 'clear_cache_tier': return Promise.resolve(0);
      case 'catalog_root_cache_usage': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve([]);
        // Two roots on one volume so the per-root breakdown branch (>1 root) is exercised.
        return Promise.resolve([
          { root_id: 1, volume_label: 'Archive T7', rel_path: 'Originals/2025', abs_path: '/Volumes/Archive T7/Originals/2025', photo_count: 8, offline_thumbs_bytes: 1.1 * 1024 * 1024 * 1024 },
          { root_id: 2, volume_label: 'Archive T7', rel_path: 'Originals/2026', abs_path: '/Volumes/Archive T7/Originals/2026', photo_count: 12, offline_thumbs_bytes: 2.1 * 1024 * 1024 * 1024 },
        ]);
      }
      case 'clear_root_cache': return Promise.resolve(0);
      case 'catalog_hash': return Promise.resolve({ hashed: 0 });
      // Reached now that catalogRegisterFolder no longer short-circuits under LIBTEST (Fix 1 of
      // the catalog-backed-grid plan) — catalogRunBackgroundPhases' chain fires for real, so it
      // needs mocks too, even though there's nothing behind them in the harness to actually stack/
      // thumbnail/focus-score. `has_more: false` on catalog_thumbnails stops drainCatalogThumbnails
      // from looping forever against a mock that never has real backlog to drain.
      case 'catalog_stack': return Promise.resolve({ stacked: 0 });
      case 'catalog_thumbnails': return Promise.resolve({ generated: 0, has_more: false });
      case 'catalog_focus': return Promise.resolve({ scored: 0 });
      // One synthetic corrupt entry so the report popover is screenshot-verifiable too.
      case 'catalog_verify': return Promise.resolve({ checked: 20, ok: 19, changed: 0, corrupt: [{ id: 3, name: 'IMG_1003.RW2', path: '/test/AllPhotos/IMG_1003.RW2' }] });
      case 'catalog_keywords': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve([]);
        // Two-level tree: Travel > Iceland, plus a standalone Portrait leaf — enough to verify
        // nesting, counts, and the click-to-filter scope string all render correctly.
        return Promise.resolve([
          { id: 1, path: 'Travel', leaf: 'Travel', parent_id: null, n: 2 },
          { id: 2, path: 'Travel|Iceland', leaf: 'Iceland', parent_id: 1, n: 1 },
          { id: 3, path: 'Portrait', leaf: 'Portrait', parent_id: null, n: 1 },
        ]);
      }
      case 'set_keywords': return Promise.resolve();
      // Stateful (failure 13, CLAUDE.md people-pets plan) — earlier this array was a hardcoded
      // literal returned fresh every call, so rename/merge/delete resolved without the sidebar
      // ever reflecting it and no People UI change could be seen working in this harness. Module
      // scope, not per-call, so a rename/merge/delete genuinely persists for the rest of the tab.
      case 'catalog_people': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve([]);
        if (!window.__libtestPeople) {
          window.__libtestPeople = [
            { id: 1, name: 'Sofia', cover_face_id: 1, face_count: 412, auto: false },
            { id: 2, name: 'Marcus', cover_face_id: 2, face_count: 207, auto: false },
            { id: 3, name: 'Person 3', cover_face_id: 3, face_count: 33, auto: true },
            { id: 4, name: 'Person 4', cover_face_id: 4, face_count: 31, auto: true },
            { id: 5, name: 'Person 5', cover_face_id: 5, face_count: 12, auto: true },
          ];
        }
        return Promise.resolve(window.__libtestPeople.slice());
      }
      case 'catalog_face_crop': {
        // 2x2 solid-color JPEG, just enough bytes for the browser to decode and fire onload —
        // proves the avatar's loaded/fade wiring works without needing real face data.
        const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=';
        const bin = atob(b64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return Promise.resolve(bytes);
      }
      case 'catalog_faces_scan': return Promise.resolve({ scanned: 0, faces_found: 0 });
      case 'catalog_embed_faces': return Promise.resolve({ embedded: 0 });
      case 'catalog_cluster_faces': return Promise.resolve({ people: 0, clustered_faces: 0, unclustered_faces: 0 });
      case 'catalog_pets_scan': return Promise.resolve({ scanned: 0, pets_found: 0 });
      case 'catalog_rename_person': {
        const p = (window.__libtestPeople || []).find((x) => x.id === args.personId);
        if (p) { p.name = args.name; p.auto = false; }
        return Promise.resolve();
      }
      case 'catalog_merge_people': {
        const list = window.__libtestPeople || [];
        const from = list.find((x) => x.id === args.fromId);
        const into = list.find((x) => x.id === args.intoId);
        if (from && into) {
          into.face_count += from.face_count;
          into.auto = false;
          window.__libtestPeople = list.filter((x) => x.id !== args.fromId);
        }
        return Promise.resolve();
      }
      case 'catalog_delete_person': {
        window.__libtestPeople = (window.__libtestPeople || []).filter((x) => x.id !== args.personId);
        return Promise.resolve();
      }
      // Review mode (screen C) mocks — face_ids are synthesized deterministically from the
      // person id so the mock needs no separate face store: person 3 (33 faces) -> ids 300..332.
      case 'catalog_unnamed_clusters': {
        return Promise.resolve((window.__libtestPeople || []).filter((p) => p.auto).map((p) => ({
          person_id: p.id,
          cover_face_id: p.cover_face_id,
          face_count: p.face_count,
          face_ids: Array.from({ length: Math.min(p.face_count, 16) }, (_, i) => p.id * 100 + i),
        })));
      }
      case 'catalog_confirm_person': {
        const p = (window.__libtestPeople || []).find((x) => x.id === args.personId);
        if (p) p.auto = false;
        return Promise.resolve();
      }
      case 'catalog_split_faces': {
        // Mock doesn't track individual faces, so it only needs to make "into an existing
        // person" and "back to Unnamed" distinguishable enough for the UI flow to be testable.
        if (args.intoId) {
          const into = (window.__libtestPeople || []).find((x) => x.id === args.intoId);
          if (into) { into.face_count += (args.faceIds || []).length; into.auto = false; }
        }
        return Promise.resolve(args.intoId || 0);
      }
      case 'catalog_set_person_ignored': {
        const p = (window.__libtestPeople || []).find((x) => x.id === args.personId);
        if (p && args.ignored) window.__libtestPeople = (window.__libtestPeople || []).filter((x) => x.id !== args.personId);
        return Promise.resolve();
      }
      case 'catalog_set_person_kind': {
        const p = (window.__libtestPeople || []).find((x) => x.id === args.personId);
        if (p) p.kind = args.kind;
        return Promise.resolve();
      }
      case 'catalog_clip_embed': return Promise.resolve({ embedded: 0 });
      case 'catalog_clip_tags': {
        // R10: fixed fake suggestions so the Info panel's "Suggested" section is exercisable
        // under ?libtest=1 without a real CLIP model — deterministic per photo id so re-renders
        // don't jitter, and empty for one id to prove the "no suggestions" silent-empty state.
        if (A.photoId === 2) return Promise.resolve([]);
        return Promise.resolve([
          { term: 'landscape', score: 0.31 },
          { term: 'mountain', score: 0.27 },
          { term: 'sunset', score: 0.24 },
        ]);
      }
      case 'catalog_clip_search': {
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve([]);
        if (!A.text || !A.text.trim()) return Promise.resolve([]);
        // Deterministic-but-query-dependent synthetic ranking so the harness can verify the
        // grid actually reorders per query rather than always showing the same fixed set.
        const seed = [...A.text].reduce((s, c) => s + c.charCodeAt(0), 0);
        return Promise.resolve([3, 7, 1, 12, 5].map((id, i) => ({ id: ((id + seed) % 18) + 1, score: 0.9 - i * 0.1 })));
      }
      case 'catalog_query': {
        const q = A.q || {};
        // Ordinary folder browsing's own scope (Fix 1 of the catalog-backed-grid plan) — NOT
        // gated on ?libcat=1, since this is the everyday "open a folder" path every ?libtest=1
        // page already exercises, not just the opt-in Date/Search/catalog harness. Mirrors
        // list_dir's own synthetic shape/count (?libn=N, every 6th a video) so
        // library_perf.mjs's existing DOM/timing budgets keep measuring the same thing — grid
        // cost for N entries — through the code path that now actually feeds them in the real
        // app, and so a test can assert list_dir/listDirRecursive are NOT called on this path.
        if (q.folder) {
          libtestCatalogQueryCalls++;
          const N = Math.max(1, parseInt((/[?&]libn=(\d+)/.exec(location.search) || [])[1] || '18', 10));
          // ?liboffline=1 exercises the disconnected-drive scenario: every entry still comes
          // back (catalog_query's own include_offline default), just flagged offline — the
          // grid must stay fully populated, not blocked.
          const offline = /[?&]liboffline=1/.test(location.search);
          const entries = [];
          for (let i = 1; i <= N; i++) {
            const isVid = i % 6 === 0;
            entries.push(isVid
              ? { id: i, name: `P_TM${6000 + i}.MP4`, path: `/test/AllPhotos/P_TM${6000 + i}.MP4`, is_dir: false, is_image: false, is_video: true, kind: 'video', mtime: 1700000000 + i, size: 90000000 + i, missing: false, edited_ts: 0, offline, volume: 'Test', sharpness: null, blurry: false, stack_n: 0, thumb_path: null }
              : { id: i, name: `IMG_${1000 + i}.RW2`, path: `/test/AllPhotos/IMG_${1000 + i}.RW2`, is_dir: false, is_image: true, is_video: false, kind: 'raw', mtime: 1700000000 + i, size: 1000 + i, missing: false, edited_ts: 0, offline, volume: 'Test', sharpness: 400, blurry: false, stack_n: 0, thumb_path: null });
          }
          return Promise.resolve({ total: N, capped: false, entries });
        }
        if (!/[?&]libcat=1/.test(location.search)) return Promise.resolve({ total: 0, capped: false, entries: [] });
        const N = Math.max(1, parseInt((/[?&]libn=(\d+)/.exec(location.search) || [])[1] || '18', 10));
        // Expand-in-place mock: item 1 (see the stack_n below) is a synthetic 3-member stack —
        // returns its members directly, ignoring every other filter, matching the real
        // command's own "expand_stack overrides everything else" contract.
        if (q.expandStack) {
          return Promise.resolve({ total: 3, capped: false, entries: [
            { id: 1, name: 'IMG_1001.RW2', path: '/test/AllPhotos/IMG_1001.RW2', is_dir: false, is_image: true, is_video: false,
              kind: 'raw', mtime: 1700000001, size: 1001, missing: false, edited_ts: 0, offline: false, volume: 'Archive T7',
              sharpness: 400, blurry: false, stack_n: 3, thumb_path: null },
            { id: 101, name: 'IMG_1001.jpg', path: '/test/AllPhotos/Exports/IMG_1001.jpg', is_dir: false, is_image: true, is_video: false,
              kind: 'jpeg', mtime: 1700000101, size: 500, missing: false, edited_ts: 0, offline: false, volume: 'Archive T7',
              sharpness: 400, blurry: false, stack_n: 0, thumb_path: null },
            { id: 102, name: 'IMG_1001-v2.jpg', path: '/test/AllPhotos/Exports/IMG_1001-v2.jpg', is_dir: false, is_image: true, is_video: false,
              kind: 'jpeg', mtime: 1700000102, size: 500, missing: false, edited_ts: 0, offline: false, volume: 'Archive T7',
              sharpness: 400, blurry: false, stack_n: 0, thumb_path: null },
          ] });
        }
        // AI stack Phase D mock: photoIds overrides everything, same contract as expandStack —
        // returns exactly those synthetic ids (same per-i shape the plain view below builds).
        if (q.photoIds) {
          const entries = q.photoIds.filter((i) => i >= 1 && i <= N).map((i) => ({
            id: i, name: `IMG_${1000 + i}.RW2`, path: `/test/AllPhotos/IMG_${1000 + i}.RW2`,
            is_dir: false, is_image: true, is_video: false, kind: 'raw', mtime: 1700000000 + i, size: 1000 + i,
            missing: false, edited_ts: 0, offline: false, volume: 'Archive T7', sharpness: 400, blurry: false, stack_n: 0, thumb_path: null
          }));
          return Promise.resolve({ total: entries.length, capped: false, entries });
        }
        // Scoped mock: a date filter returns a visibly SMALLER slice than the full N, sized
        // from the same fixed day counts catalog_date_counts's mock uses above, so clicking
        // through the tree provably changes the grid rather than silently re-showing everything
        // — the structural thing this mock exists to let the harness catch.
        let scoped = N;
        if (q.blurryOnly) scoped = Math.max(1, Math.floor(N / 5));
        else if (q.keywords && q.keywords.length) scoped = 3;
        else if (q.noDate) scoped = 1;
        else if (q.year === 2026 && q.month === 8 && q.day === 22) scoped = 4;
        else if (q.year === 2026 && q.month === 8 && q.day === 15) scoped = 2;
        else if (q.year === 2026 && q.month === 8) scoped = 6;
        else if (q.year === 2026 && q.month === 7 && q.day === 3) scoped = 6;
        else if (q.year === 2026 && q.month === 7) scoped = 6;
        else if (q.year === 2026) scoped = 12;
        else if (q.year === 2025) scoped = 3;
        const n = Math.min(N, scoped);
        const entries = [];
        for (let i = 1; i <= n; i++) {
          const offline = i % 7 === 0;
          const blurry = q.blurryOnly ? true : i % 5 === 0;
          // Item 1 is a synthetic 3-member stack (see the expandStack branch above) — only in
          // the plain "all" view, so scoped/filtered views stay uncluttered by it.
          const isStackLeader = i === 1 && !q.blurryOnly && !q.noDate && q.year == null;
          entries.push({ id: i, name: `IMG_${1000 + i}.RW2`, path: `/test/AllPhotos/IMG_${1000 + i}.RW2`,
            is_dir: false, is_image: true, is_video: false, kind: 'raw', mtime: 1700000000 + i, size: 1000 + i,
            missing: false, edited_ts: 0, offline, volume: offline ? 'Old LaCie' : 'Archive T7',
            sharpness: blurry ? 20 : 400, blurry,
            stack_n: isStackLeader ? 3 : 0, thumb_path: isStackLeader ? '/test/AllPhotos/Exports/IMG_1001-v2.jpg' : null });
        }
        return Promise.resolve({ total: n, capped: false, entries });
      }
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
    if (/LUT 'dcp:[^']*' not registered/.test(s)) return 'Camera color profile not found';
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
  // Last-opened folder/photo, restored at the deskx startup path below — LS_ROOT only ever
  // remembered the library ROOT, not which subfolder or photo the user actually had open, so a
  // relaunch always landed back at the top of the tree with nothing open.
  const LS_LAST_FOLDER = 'chromasmith_lib_last_folder';
  const LS_LAST_PATH = 'chromasmith_lib_last_path';
  const state = {
    // ?libnoroot=1 exercises the true first-launch state (renderLibraryNoRoot) — otherwise
    // LIBTEST always has a root, so that path would be untestable in the harness.
    root: LIBTEST ? (/[?&]libnoroot=1/.test(location.search) ? '' : '/test/Photos') : (localStorage.getItem(LS_ROOT) || ''),
    expanded: new Set(),
    currentFolder: LIBTEST ? '' : (localStorage.getItem(LS_LAST_FOLDER) || ''),
    entries: [],           // image entries in the currently-viewed folder
    sidecars: new Map(),   // path -> {rating,label,edited,recipe} (cached client-side)
    meta: new Map(),       // path -> {camera,lens,date,iso}
    clipTags: new Map(),   // photo id -> [{term,score}] (R10 suggested-tag cache, see renderInfoPanel)
    dupeClusters: new Map(), // path -> clusterId (only present for clusters of size > 1)
    dupeClusterSizes: new Map(), // clusterId -> size
    _expandedStacks: new Set(), // leader ids the user has clicked open — catalog views only
    syncedPaths: new Set(),  // paths known-synced to Google Photos (gphotos registry, folder-local cache)
    offlineEditPaths: new Set(), // paths currently open against the reduced-res offline preview (N1a) — see openInEditorInner
    typeFilter: 'all',     // 'all' | 'raw' | 'jpeg' | 'png' | 'tiff' | 'heic' | 'webp' | 'hdr' | 'other' | 'video'
    cameraFilter: 'all',
    lensFilter: 'all',
    isoFilter: 'all',
    dupeFilter: 'all',     // 'all' | 'dupes'
    syncedFilter: 'all',   // 'all' | 'synced' | 'notsynced'
    showInfo: false,       // metadata panel for the focused photo (I) — see renderInfoPanel
    tagFilter: 'all',      // 'all' | 'red' | 'green' | 'edited' | 'noedited'
    // ⚠️ This existed in the saved-views capture list and the filter-id map before the feature
    // did — ROADMAP claimed star ratings had shipped and they never had, so those were dead
    // references to a control that was not in the DOM and a state key that was not here.
    ratingFilter: 'all',   // 'all' | '0' (unrated) | '1'..'5' (that many stars or more)
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
    gridAspect: localStorage.getItem('chromasmith_lib_gridaspect') === '1', // item 31: real aspect ratio vs square-crop thumbnails
    // Matches Lightroom's "Include Photos from Subfolders" — list_dir is deliberately one level
    // only (see its own doc comment), so a folder tree built by date (2026/08/22, 2026/08/23...)
    // showed nothing when the PARENT folder was selected, only when a leaf was. Real reported
    // confusion, not a hypothetical.
    includeSubfolders: localStorage.getItem('chromasmith_lib_subfolders') === '1',
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
    #lib-side{grid-row:4}#lib-bottom{grid-row:6}
    /* position:relative so the info panel and batch bar (both position:absolute, appended here)
       resolve against the GRID area. Without it they resolved against a far outer ancestor and
       landed on top of the filter toolbar. */
    #lib-main{grid-row:5;position:relative}
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
    /* DRK-style smart collections, above the folder tree in the same #lib-side scroll box. */
    .lib-coll-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;
      font-size:12px;color:var(--txt)}
    .lib-coll-row:hover{background:var(--sur2)}
    .lib-coll-row.on{background:rgba(212,144,58,.14);color:var(--acc)}
    .lib-coll-row.offline{cursor:default}
    .lib-coll-row.offline:hover{background:transparent}
    .lib-coll-ic{display:inline-flex;flex-shrink:0;color:inherit}
    .lib-coll-lb{flex:1}
    .lib-coll-count{font-family:var(--mono);font-size:10px;color:var(--mut)}
    .lib-coll-row.on .lib-coll-count{color:var(--acc)}
    .lib-coll-sep{height:1px;background:var(--bdr);margin:8px 2px}
    .lib-coll-heading{font-size:11px;font-weight:600;letter-spacing:0;color:var(--mut);padding:2px 8px 6px}
    /* People & Pets — face avatar in place of the generic .lib-coll-ic user glyph (people-pets
       wireframes screen A). 20px circle, filled lazily from catalog_face_crop (an <img> so a
       failed/never-scanned crop just shows the empty background rather than a broken-image icon
       — see .lib-face-ava img{visibility}). .unnamed gets a dashed ring, matching the
       "suggestion, not committed" language .lib-kw-suggest-chip already uses elsewhere in this
       file, since an un-renamed auto cluster is exactly that: the machine's guess, not yours. */
    .lib-face-ava{width:20px;height:20px;border-radius:50%;flex:0 0 auto;overflow:hidden;
      background:var(--sur2);border:1px solid var(--bdr);position:relative}
    .lib-face-ava.unnamed{border-style:dashed;border-color:var(--mut)}
    /* Pet vs person is a border-colour distinction, not a glyph — no emoji/unicode icons in
       desktop chrome (CLAUDE.md §3b). --acc2 is otherwise used for "the other" accent role. */
    .lib-face-ava.pet{border-color:var(--acc2)}
    .lib-face-ava.pet.unnamed{border-color:var(--acc2);opacity:.75}
    .lib-face-ava img{width:100%;height:100%;object-fit:cover;visibility:hidden}
    .lib-face-ava img.loaded{visibility:visible}
    /* Named list scrolls internally so Folders/Keywords never move as the count grows — the
       flat "Person 1..Person 40" flood this replaces (CLAUDE.md people-pets plan, failure 14). */
    .lib-people-scroll{max-height:150px;overflow-y:auto;margin:0 -4px;padding:0 4px}
    /* Review mode (people-pets wireframes screen C) — one unnamed cluster at a time, full-
       viewport, keyboard-driven. z-index above #lib-overlay's 4000, same pattern as
       #lib-quicklook (lazily created, appended to body, .on toggles display). */
    #lib-review{position:fixed;inset:0;z-index:4500;background:rgba(10,10,10,.94);display:none;
      flex-direction:column;color:var(--txt);font-family:var(--sans)}
    #lib-review.on{display:flex}
    .lib-review-top{display:flex;align-items:center;gap:10px;padding:12px 18px;
      border-bottom:1px solid var(--bdr);font-size:12px;color:var(--mut)}
    .lib-review-body{flex:1;overflow:auto;padding:18px;max-width:900px;margin:0 auto;width:100%}
    .lib-review-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;margin-bottom:16px}
    .lib-review-face{position:relative;border-radius:8px;overflow:hidden;background:var(--sur2);
      border:2px solid transparent;aspect-ratio:1;cursor:pointer}
    .lib-review-face.sel{border-color:var(--acc)}
    .lib-review-face.desel{opacity:.35}
    .lib-review-face img{width:100%;height:100%;object-fit:cover;visibility:hidden}
    .lib-review-face img.loaded{visibility:visible}
    .lib-review-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--bdr)}
    #lib-review-name{flex:1;background:var(--sur2);border:1px solid var(--acc);border-radius:8px;
      color:var(--txt);padding:9px 12px;font:500 14px var(--sans);min-width:0}
    .lib-review-kbd{font-family:var(--mono);font-size:10px;border:1px solid var(--bdr);border-radius:4px;
      padding:1px 5px;background:var(--sur2);color:var(--mut)}
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
    .lib-btn.on{background:var(--acc);color:#000;border-color:var(--acc)}
    .lib-btn.on.disabled-note{background:var(--sur2);color:var(--mut);border-color:var(--bdr)}
    #lib-aspect-toggle{padding:5px 8px;margin-left:6px}
    /* Info panel keyword chips (renderInfoPanel) — the leaf name only, full path in the tooltip
       (a photo tagged "Travel|Iceland|Reykjavik" would otherwise overflow a 232px panel). */
    .lib-kw-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:9px;
      background:var(--sur2);border:1px solid var(--bdr);font-size:10px;color:var(--txt)}
    .lib-kw-chip-x{cursor:pointer;color:var(--mut);font-size:12px;line-height:1}
    .lib-kw-chip-x:hover{color:var(--txt)}
    /* R10: zero-shot CLIP tag suggestions (renderInfoPanel) — visually distinct from a real
       keyword chip (dashed border + muted text, same --mut/opacity convention as .lib-chip-x
       above) since these aren't yet real keywords until clicked. Sized identically to
       .lib-kw-chip — same 28px-floor exemption ui_audit.mjs already grants that chip class. */
    .lib-kw-suggest-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:9px;
      background:transparent;border:1px dashed var(--bdr);font-size:10px;color:var(--mut);cursor:pointer}
    .lib-kw-suggest-chip:hover{color:var(--txt);border-color:var(--acc)}
    .lib-kw-suggest-chip-add{opacity:.7;font-size:11px;line-height:1}
    /* Quick Look (Space bar) — a full-viewport overlay, never part of the editor's own DOM,
       so it stays trivially cheap to open/close: no shader, no canvas, just an <img>. */
    #lib-quicklook{position:fixed;inset:0;z-index:500;background:rgba(10,10,10,.96);
      display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px}
    #lib-quicklook.on{display:flex}
    #lib-ql-img{max-width:92vw;max-height:86vh;object-fit:contain;opacity:0;transition:opacity .12s ease;
      border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
    #lib-ql-img.loaded{opacity:1}
    #lib-ql-caption{color:var(--mut);font-size:12px;font-family:var(--mono);letter-spacing:.02em}
    .lib-tree-node{font-size:12px;white-space:nowrap;user-select:none}
    .lib-tree-row{display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:6px;cursor:pointer}
    .lib-tree-row:hover{background:var(--sur2)}
    .lib-tree-row.on{background:var(--bdr)}
    .lib-tree-chev{width:14px;flex:0 0 14px;display:inline-flex;align-items:center;justify-content:center;opacity:.6;
      transform:rotate(-90deg);transition:transform .12s ease}
    .lib-tree-chev.open{transform:rotate(0)}
    .lib-tree-children{margin-left:14px}
    /* ── Activity indicator: one chained pipeline (walk -> metadata -> sidecar -> hash), not
       silent subsystems. Collapsed pill in the status bar; click expands a small popover. ── */
    .lib-act-pill{display:flex;align-items:center;gap:6px;background:var(--sur2);border:1px solid var(--bdr);
      border-radius:999px;padding:3px 9px 3px 5px;cursor:pointer;font-size:11px;color:var(--txt)}
    .lib-act-pill:hover{border-color:var(--acc)}
    .lib-act-ring{width:13px;height:13px;border-radius:50%;flex:0 0 auto;
      background:conic-gradient(var(--acc) var(--p,0%),var(--bdr) 0)}
    .lib-act-ring::after{content:'';position:absolute}
    .lib-act-pop{position:absolute;bottom:28px;right:0;background:var(--sur2);border:1px solid var(--bdr);
      border-radius:10px;width:260px;box-shadow:var(--lift-2,0 12px 30px -12px rgba(0,0,0,.6));z-index:20;
      font-family:var(--sans)}
    .lib-act-pop-head{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;
      border-bottom:1px solid var(--bdr);font-size:12px;font-weight:600}
    .lib-act-pop-cancel{font-size:11px;color:var(--mut);cursor:pointer;font-weight:400}
    .lib-act-pop-cancel:hover{color:var(--err,#e5484d)}
    .lib-act-pop-body{padding:9px 11px;display:flex;flex-direction:column;gap:7px}
    .lib-act-stage{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mut)}
    .lib-act-stage.active{color:var(--txt)}
    .lib-act-stage-n{margin-left:auto;font-family:var(--mono);font-size:10px;font-variant-numeric:tabular-nums}
    .lib-act-bar{height:3px;background:var(--bdr);border-radius:2px;overflow:hidden;margin:1px 0 2px 17px}
    .lib-act-bar > div{height:100%;background:var(--acc)}
    #lib-viewbar{display:flex;align-items:center;gap:8px;padding:0 12px 8px;flex-wrap:wrap}
    #lib-viewbar select,#lib-viewbar input[type=range]{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);
      border-radius:7px;padding:5px 7px;font-size:11px}
    #lib-viewbar .lib-seg{display:flex;border:1px solid var(--bdr);border-radius:7px;overflow:hidden}
    #lib-viewbar .lib-seg button{background:var(--sur2);border:none;color:var(--txt);font-size:11px;padding:5px 9px;cursor:pointer}
    #lib-viewbar .lib-seg button.on{background:var(--acc);color:#000}
    #lib-viewbar .lib-thumbsize{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--mut)}
    /* Reject/Pick still ride the sidecar's "label" field ("Red"/"Green") and get a frame
       highlight on the thumbnail — this is the reject/pick indicator, not a colour-label system. */
    .lib-card.lbl-red .lib-thumb-wrap{box-shadow:0 0 0 2px #e05252}
    .lib-card.lbl-green .lib-thumb-wrap{box-shadow:0 0 0 2px #5cb85c}
    #lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--lib-thumb,140px),1fr));gap:16px}
    #lib-grid.lib-dragover{outline:2px dashed var(--acc2);outline-offset:-6px;border-radius:8px}
    .lib-coll-row.lib-coll-dragover{outline:2px dashed var(--acc2);outline-offset:-2px;background:var(--sur2)}
    /* Real table: header row (#lib-list-head) and every .lib-card in list mode share this exact
       column template, so clicking a header lines up with the data underneath it. */
    :root{--lib-list-cols:52px minmax(120px,1fr) 92px 92px 132px 56px 68px 60px 56px 70px 56px 60px}
    #lib-list-head{display:none;position:sticky;top:0;z-index:20;background:var(--bg);
      grid-template-columns:var(--lib-list-cols);gap:10px;padding:4px 8px 6px;
      border-bottom:1px solid var(--bdr);font-size:11px;color:var(--mut);font-family:var(--sans);
      font-weight:600;letter-spacing:0}
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
    #lib-grid.list-view .lib-col{font-size:11px;color:var(--mut);font-family:var(--sans);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lib-meta-strip{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);color:#fff;
      font-size:10px;font-family:var(--sans);padding:3px 5px;line-height:1.3;
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
    /* Item 31: "Aspect ratio" grid mode — real aspect, no crop, ragged-right rows (not edge-to-
       edge justified: that needs a width-fitting layout pass, which is a bigger, riskier project
       — see the code comment at the toggle handler for why this scope was chosen instead).
       Pure CSS: flex-wrap rows of FIXED-HEIGHT cards; each image is "height:100%;width:auto", so
       its own intrinsic aspect ratio sets the card's width — the browser does the row-fitting,
       no JS layout math and nothing for virtualization's uniform-grid math to disagree with.
       Only ever applied below VIRT_MIN (see renderGrid) — a virtualized grid's row/col windowing
       assumes a uniform CSS grid, which this is not. */
    #lib-grid.aspect-view{display:flex;flex-flow:row wrap;align-items:flex-start}
    #lib-grid.aspect-view .lib-card{width:auto;flex:0 0 auto}
    /* Before the real thumbnail loads there's no intrinsic image size to derive a width from —
       hold a square placeholder (matching the normal grid's own look while loading) so cards
       don't collapse to zero width, then let the real aspect ratio take over once img.loaded. */
    #lib-grid.aspect-view .lib-thumb-wrap{aspect-ratio:auto;width:var(--lib-thumb,140px);height:var(--lib-thumb,140px)}
    #lib-grid.aspect-view .lib-thumb-wrap:has(img.loaded){width:auto}
    #lib-grid.aspect-view .lib-thumb-wrap img{width:auto;height:100%;object-fit:contain}
    /* Real thumbnails fade in over the skeleton/empty cell instead of popping in the instant
       get_thumbnail resolves — .loaded is added by the thumb pool once the blob URL is set. */
    #lib-grid:not(.list-view) .lib-thumb-wrap img{opacity:0;transition:opacity .15s ease}
    #lib-grid:not(.list-view) .lib-thumb-wrap img.loaded{opacity:1}
    .lib-card .lib-name{font-size:11px;font-family:var(--sans);color:var(--mut);
      padding:4px 6px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lib-tagrow{display:flex;align-items:center;gap:6px;padding:0 6px 6px}
    .lib-stars{display:inline-flex;gap:1px;line-height:1;user-select:none}
    .lib-star{color:var(--bdr);cursor:pointer;font-size:12px;padding:1px}
    .lib-star.on{color:#ffc35c}
    .lib-star:hover{color:#ffd98a}
    /* The filmstrip has no room for a star row; the rating still shows via the hover info strip. */
    body.deskx #lib-overlay:not(.full) .lib-stars{display:none}
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
    /* Small corner icon badges, DRK-style — no text pills. Edited (orange pen) sits
       top-right; the RAW "R" badge sits top-left so the two never collide. */
    .lib-edited-badge{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;
      background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2}
    .lib-edited-badge svg{width:10px;height:10px}
    .lib-raw-badge{position:absolute;top:4px;left:4px;width:18px;height:18px;border-radius:5px;
      background:rgba(0,0,0,.55);color:#cfcfd6;font-size:9px;font-weight:700;letter-spacing:.02em;
      display:flex;align-items:center;justify-content:center;z-index:2}
    /* Stack badge reuses the RAW badge's own corner slot (see the JS comment at its markup) —
       widens for a 2-digit count and gets a pointer cursor since, unlike every other corner
       badge, it's clickable (expand/collapse in place). */
    .lib-stack-badge{min-width:18px;width:auto;padding:0 4px;cursor:pointer;background:rgba(0,0,0,.7)}
    .lib-stack-badge:hover{background:rgba(0,0,0,.85)}
    /* Video: same corner-badge slot the RAW "R" chip uses (mutually exclusive — a file is one
       kind or the other), carrying the clip icon plus its duration. The gradient fill behind the
       thumbnail is the backdrop while the poster loads, and what stays visible if it can't. */
    .lib-video-badge{position:absolute;top:4px;left:4px;min-width:18px;height:18px;padding:0 5px;border-radius:5px;
      background:rgba(0,0,0,.6);color:#e6e6ea;font-size:10px;font-variant-numeric:tabular-nums;
      display:flex;align-items:center;justify-content:center;gap:3px;z-index:2}
    .lib-video-badge svg{width:10px;height:10px;flex:0 0 auto}
    .lib-thumb-video{background:linear-gradient(135deg,var(--sur2),var(--sur))}
    .lib-thumb-video:not(:has(img.loaded))::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      color:var(--mut);font-size:20px;opacity:.5;z-index:1}
    /* Posters are generated natively by AVFoundation and disk-cached like any photo thumbnail
       (see videothumb.rs), so show them the same way. */
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
    /* Every corner is already spoken for (raw/stack, edited, dupe, synced) — bottom-center is the
       one spot left, and this badge is rare enough (only while a volume is unreachable) that it
       never has to fight another badge for the same pixels. */
    .lib-offline-badge{position:absolute;bottom:4px;left:50%;transform:translateX(-50%);
      width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:center;z-index:2}
    #lib-grid.list-view .lib-offline-badge{position:static;width:16px;height:16px;transform:none}
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
    /* --sur2, not --sur1: there is no --sur1 token and this had NO fallback, so background
       resolved to nothing and the compare picker rendered as a default white system select on
       a dark panel — the one phantom-token site with a visible consequence. */
    .lib-cmp-head select{background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);
      border-radius:var(--r-sm);padding:3px 6px;font-size:10.5px;max-width:120px}
    .lib-cmp-canvas-wrap{flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000}
    .lib-cmp-canvas-wrap canvas{max-width:100%;max-height:100%;transform-origin:center center}
    .lib-cmp-chrome{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--bdr);font-size:12px}
    .lib-cmp-chrome .lib-flag{width:20px;height:20px;display:flex;align-items:center;justify-content:center;
      border-radius:5px;cursor:pointer;opacity:.6}
    .lib-cmp-chrome .lib-flag.on,.lib-cmp-chrome .lib-flag:hover{opacity:1;background:var(--bdr)}
    #lib-compare-bar{display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:11px;color:var(--mut)}
    .lib-cmp-pane.cmp-focus{outline:2px solid var(--acc);outline-offset:-2px;border-radius:6px}
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
    /* deskx (DRK shell): the docked panel becomes a 120px thumbnail FILMSTRIP — pure
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
    /* padding-top 22px (not the tighter horizontal 8px/6px): #lib-overlay already sits below the
       fixed deskbar (top:44px above), so this is the ONLY breathing room between the deskbar and
       the folder/cloud/history icons — 8px read as flush against the bar. Matches the same 22px
       bump on body.deskx .fx-panel / #fx-toolrail in chromasmith-22.html for the tools panel and
       right rail, so all three top-of-shell rows get equal clearance. */
    body.deskx #lib-overlay #lib-top{padding:22px 8px 6px;-webkit-app-region:no-drag}
    body.deskx #lib-overlay:not(.full) #lib-top{padding:22px 6px 6px;gap:4px;flex-wrap:wrap}
    body.deskx #lib-overlay:not(.full) #lib-top .lib-btn{padding:5px 7px}
    body.deskx #lib-overlay:not(.full) #lib-top .lib-title{display:none}
    /* The tree toggle only means anything in full mode (the filmstrip already force-hides
       #lib-side below) — its text label doesn't fit the 120px filmstrip's icon-only top bar. */
    body.deskx #lib-overlay:not(.full) #lib-tree-toggle{display:none}
    /* ROADMAP 11 — filmstrip affordances. The 120px strip is pure thumbnails, which means that
       while culling in the DRK shell there was no way to see WHICH photo you were on or
       whether you had already flagged it — the two things culling depends on. Both surface on
       hover (and on the current photo always), rather than permanently, so the strip stays a
       strip. Pointer-events off so they can never eat the click that selects the card. */
    body.deskx #lib-overlay:not(.full) .lib-card{position:relative}
    /* ⚠️ Default to hidden UNCONDITIONALLY. Scoping only the "show" rule to the filmstrip left the
       element with no display at all in the normal grid, where a div defaults to block — so the
       name + gradient rendered over every grid card. Caught by asserting the grid was unaffected,
       not by looking at the filmstrip. */
    .lib-strip-info{display:none}
    body.deskx #lib-overlay:not(.full) .lib-strip-info{
      position:absolute;left:0;right:0;bottom:0;padding:2px 4px 3px;pointer-events:none;
      background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,0));
      font-size:9px;line-height:1.25;color:#fff;opacity:0;transition:opacity .12s var(--ease,ease);
      display:flex;align-items:center;gap:3px;justify-content:space-between}
    body.deskx #lib-overlay:not(.full) .lib-card:hover .lib-strip-info{opacity:1}
    body.deskx #lib-overlay:not(.full) .lib-card:hover .lib-strip-info,
    body.deskx #lib-overlay:not(.full) .lib-card.sel .lib-strip-info{opacity:1}
    body.deskx #lib-overlay:not(.full) .lib-strip-name{
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    body.deskx #lib-overlay:not(.full) .lib-strip-flag{flex:none;width:7px;height:7px;border-radius:50%}
    /* The same markup therefore costs the grid nothing — it is inert until the filmstrip. */
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
      <button class="lib-btn lib-btn-icon" id="lib-info-btn" title="Get Info for the selected photo — I">${ic('info',17)}</button>
      <button class="lib-btn lib-btn-icon" id="lib-expand" title="Full-window view — G">${ic('fit',17)}</button>
    </div>
    <div id="lib-filters">
      <input id="lib-search" placeholder="Search filename… (Enter for AI search)" />
      <button class="lib-btn lib-btn-icon" id="lib-clip-search" title="Search photos by description, e.g. \"a dog on a beach\" — press Enter in the search box, or click this">${ic('search', 15)}</button>
      <select id="lib-source" title="Photo source">
        <option value="folder">This folder</option>
        <option value="edited">All Edited</option>
      </select>
      <label id="lib-subfolders-wrap" style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--mut);white-space:nowrap;cursor:pointer" title="Also show photos in every subfolder, not just this one — matches Lightroom's 'Include Photos from Subfolders'">
        <input type="checkbox" id="lib-subfolders">Subfolders</label>
      <div id="lib-filters-btn-wrap">
        <button class="lib-btn" id="lib-filters-btn" title="Filter by type, camera, lens, ISO, duplicates, sync status or tag/rating">Filters<span id="lib-filters-badge"></span></button>
        <div id="lib-filters-pop">
          <select id="lib-type-filter" title="Filter by file type">
            <option value="all">All types</option>
            <option value="raw">RAW</option><option value="jpeg">JPEG</option>
            <option value="png">PNG</option><option value="tiff">TIFF</option>
            <!-- heic/webp/hdr/other added alongside the format-widening work: kind_of() (Rust,
                 library.rs → formats::media_kind) has always emitted "heic" for iPhone photos —
                 there was no option here to reach it, so HEIC files were listable but never
                 filterable. "other" covers the desktop-only decode_image_v1 formats
                 (TGA/DDS/QOI/FF/PNM*/JXL) plus GIF/BMP/ICO/AVIF, none of which had a bucket of
                 their own. -->
            <option value="heic">HEIC</option><option value="webp">WebP</option>
            <option value="hdr">HDR/EXR</option><option value="other">Other</option>
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
          <select id="lib-rating-filter" title="Filter by star rating">
            <option value="all">Any rating</option>
            <option value="0">Unrated</option>
            <option value="1">★1+</option>
            <option value="2">★2+</option>
            <option value="3">★3+</option>
            <option value="4">★4+</option>
            <option value="5">★5</option>
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
      <button class="lib-btn" id="lib-aspect-toggle" title="Show thumbnails at their real aspect ratio instead of cropped to a square. Only available for folders under 400 photos (larger folders use a virtualized grid this can't apply to).">${ic('image',15)}</button>
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
        <option value="rating">Rating</option>
        <option value="editedts">Date edited</option>
      </select>
      <button class="lib-btn" id="lib-sort-dir" title="Reverse sort order">↑</button>
      <select id="lib-views" title="Saved filter + sort views"><option value="">Views…</option></select>
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
    <div id="lib-bottom">
      <span style="font-size:11px;color:var(--mut)" id="lib-count"></span>
      <span style="font-size:11px;color:var(--mut)" id="lib-thumb-progress"></span>
      <span id="lib-status-labels" style="font-size:11px;color:var(--mut);display:flex;gap:8px;align-items:center"></span>
      <span id="lib-activity"></span>
      <span style="flex:1"></span>
      <span style="font-size:11px;color:var(--mut)" id="lib-status-size"></span>
      <span style="font-size:11px;color:var(--mut)" id="lib-status-sel"></span>
    </div>
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
  // Extension list lives in chromasmith-22.html's FORMAT REGISTRY (RAW_FILE_EXT_RE) — this file
  // loads AFTER that script (build-desktop.sh injects <script src="library-ui.js"> right after
  // the main page script), so the global is already in scope. Referencing it directly, not a
  // narrower literal fallback, is deliberate: a silent fallback here is exactly the kind of
  // drift test/lint_formats.mjs exists to catch, and on desktop RAW_FILE_EXT_RE already
  // includes formats (like .ari) that a narrower local copy would silently exclude.
  const RAW_EXT_RE = RAW_FILE_EXT_RE;
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

  // ── recent folders (MRU, capped) — a DRK-style quick-access list so re-opening a
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
    // `ic` param replaces the emoji this menu used to prefix every label with (☁️/📌/📁) —
    // CLAUDE.md §3b: "No emoji and no unicode glyphs in desktop chrome; they render per-platform
    // and never match a stroke weight." Optional so the two plain "No recent folders yet" /
    // Google/Lightroom rows below that pass no icon still render exactly as before.
    const item = (label, path, icoName) => {
      const el = document.createElement('div');
      if (icoName) {
        const escLabel = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        el.innerHTML = `<span style="display:inline-flex;vertical-align:-3px;margin-right:7px;color:var(--mut)">${ic(icoName, 14)}</span>${escLabel}`;
      } else el.textContent = label;
      el.title = path;
      el.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center';
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
    if (gDir) item('Google Photos Download', gDir, 'cloud');
    if (lDir) item('Lightroom Download', lDir, 'cloud');
    if (pins.length) {
      if (gDir) menuSep();
      pins.forEach((p) => item(baseName(p), p, 'pin'));
    }
    if (state.currentFolder) {
      menuSep();
      const isPinned = getPinnedFolders().includes(state.currentFolder);
      const pinEl = document.createElement('div');
      pinEl.innerHTML = `<span style="display:inline-flex;vertical-align:-3px;margin-right:7px">${ic(isPinned ? 'close' : 'pin', 14)}</span>${isPinned ? 'Unpin current folder' : 'Pin current folder'}`;
      pinEl.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer;color:var(--mut);display:flex;align-items:center';
      pinEl.onmouseenter = () => { pinEl.style.background = 'var(--bdr)'; };
      pinEl.onmouseleave = () => { pinEl.style.background = ''; };
      pinEl.onclick = (ev) => { ev.stopPropagation(); togglePinnedFolder(state.currentFolder); closeRecentMenu(); };
      recentMenu.appendChild(pinEl);
    }
    const shownRecents = recents.filter((p) => !pins.includes(p));
    if (shownRecents.length) {
      menuSep();
      shownRecents.forEach((p) => item(baseName(p), p, 'folder'));
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
  // ⚠️ Bug #2: this was declared ONLY inside `if (LIBTEST)` below, so `window.__libInfo` was
  // undefined in the real packaged app — a "dead public API nobody calls" not because nothing
  // wanted to call it, but because it plain didn't exist outside the test harness. It's the
  // real trigger both the toolbar ⓘ button and the "Get Info" context-menu item call, so it must
  // exist unconditionally.
  window.__libInfo = (on) => { state.showInfo = on; renderInfoPanel(); };
  if (LIBTEST) {
    window.__libState = () => ({ m: state._virtMetrics, on: state._virtOn, n: (state._virtAll || []).length, range: state._virtRange });
    window.__libRenderGrid = () => renderGrid();
    window.__libSelect = (p) => { state.selected.add(p); };
    window.__libScrollTo = (p) => scrollLibraryToPath(p);
    window.__libClusterByHash = (pairs) => clusterByHash(pairs);
    window.__libOpenFolder = (path) => openFolder(path);
  }
  // Rows kept mounted beyond the viewport in each direction. This used to be a flat 2, which is
  // enough to avoid a visible GAP while scrolling but nowhere near enough to avoid the far more
  // annoying problem: scroll down a little and back up, and every card you just passed had been
  // unmounted and has to be fetched and decoded again, so the grid visibly re-loads photos you
  // were already looking at. The window is now sized to the row budget instead — see
  // virtOverscanRows() — so a small scroll stays entirely inside already-mounted rows.
  // ⚠️ VIRT_MAX_CARDS is the binding constraint, not a guess: test/library_perf.mjs asserts the
  // mounted `.lib-card` count stays <= 200 at n=5000 (and a 6,000-node total DOM budget, at ~18
  // nodes per card). 180 leaves headroom under that guard.
  const VIRT_MAX_CARDS = 180;
  const VIRT_MIN_OVERSCAN_ROWS = 2;
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

  /// Spends the whole mounted-card budget on overscan rather than mounting a fixed two rows.
  /// Derived from the LIVE metrics (cols/rowH), like everything else here, because both come from
  /// `auto-fill` and change with thumbnail size, dock state and window width — at 5 columns this
  /// gives ~36 mounted rows against the ~5 visible, so scrolling a screen or two in either
  /// direction re-uses mounted cards instead of re-fetching them.
  function virtOverscanRows(m, viewH) {
    const visibleRows = Math.max(1, Math.ceil(viewH / m.rowH));
    const budgetRows = Math.floor(VIRT_MAX_CARDS / Math.max(1, m.cols));
    // Split whatever the budget leaves over the visible band evenly above and below.
    return Math.max(VIRT_MIN_OVERSCAN_ROWS, Math.floor((budgetRows - visibleRows) / 2));
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
    const over = virtOverscanRows(m, viewH);
    const firstRow = Math.max(0, Math.floor(viewTop / m.rowH) - over);
    const lastRow = Math.min(totalRows - 1, Math.ceil((viewTop + viewH) / m.rowH) + over);
    if (!force && state._virtRange && state._virtRange[0] === firstRow && state._virtRange[1] === lastRow) return;
    state._virtRange = [firstRow, lastRow];
    const from = firstRow * m.cols, to = Math.min(all.length, (lastRow + 1) * m.cols);
    renderCards(gridEl, all.slice(from, to), all, false, {
      offset: from,
      padTop: firstRow * m.rowH,
      padBot: Math.max(0, (totalRows - 1 - lastRow) * m.rowH),
    });
  }

  /// Scrolls the sidebar grid so the given path's card is visible. Used after opening a photo
  /// into the editor so the newly-active card doesn't stay scrolled off-screen. Works whether or
  /// not the grid is virtualized: a virtualized grid may not have mounted a DOM card for `path`
  /// at all, so this computes the target row from state._virtAll/_virtMetrics and sets scrollTop
  /// directly (same coordinate space virtUpdate reads: scroller.scrollTop - gridEl.offsetTop),
  /// then forces a virtUpdate so the row actually mounts. Non-virtualized grids fall back to a
  /// plain scrollIntoView on the existing card.
  function scrollLibraryToPath(path) {
    if (!path) return;
    const gridEl = document.getElementById('lib-grid');
    if (!gridEl) return;
    if (state._virtOn) {
      // A caller may have toggled expanded/docked view (different column count) just before
      // this runs, without an intervening renderGrid() — refresh so row/scrollTop math below
      // isn't computed against stale geometry from the old layout.
      const fresh = virtMetrics(gridEl);
      if (fresh) { state._virtMetrics = fresh; state._virtRange = null; }
    }
    if (state._virtOn && state._virtMetrics) {
      const idx = (state._virtAll || []).findIndex((e) => e.path === path);
      if (idx < 0) return;
      const inRange = state._virtRange && idx >= state._virtRange[0] * state._virtMetrics.cols && idx < (state._virtRange[1] + 1) * state._virtMetrics.cols;
      if (inRange) {
        const card = gridEl.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
        if (card) { card.scrollIntoView({ block: 'nearest' }); return; }
      }
      const scroller = gridEl.parentElement && gridEl.parentElement.scrollHeight > gridEl.parentElement.clientHeight
        ? gridEl.parentElement : (gridEl.closest('#lib-overlay') || document.documentElement);
      const row = Math.floor(idx / state._virtMetrics.cols);
      const targetTop = gridEl.offsetTop + row * state._virtMetrics.rowH;
      scroller.scrollTop = Math.max(0, targetTop - scroller.clientHeight / 2 + state._virtMetrics.rowH / 2);
      virtUpdate(true);
      return;
    }
    const card = gridEl.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  // Thumbnail loader with a small concurrency pool + viewport priority. renderGrid used to
  // fire one get_thumbnail invoke per card synchronously — opening a 500-RAW folder launched
  // 500 concurrent Rust decodes at once (the <img loading="lazy"> attribute is useless here,
  // since the eager invoke IS the expensive part, not the <img> fetch). Cards report
  // visibility via an IntersectionObserver; visible cards jump the queue.
  const THUMB_POOL = 6;
  // _pickNextIdx() below strictly prefers any non-video job over a video one, so a mixed folder
  // paints ALL its photos (JPEG via the embedded-preview tier, then RAW) before the first clip is
  // touched. That ordering is about COST, not about blocking: a cold video poster is an
  // AVFoundation keyframe decode, roughly a RAW thumbnail's worth of work, and every one after
  // that is a disk-cache hit.
  // ⚠️ The separate, much smaller video cap this used to carry existed because posters were
  // decoded in the WebView from a whole-file read with multi-second timeouts. That path is gone
  // (see videothumb.rs), so the cap is the ordinary pool — kept as a named constant rather than
  // deleted so it is a one-line change if cold 4K generation ever needs throttling again.
  let _thumbActiveVideo = 0;
  const THUMB_POOL_VIDEO = THUMB_POOL;
  let _thumbQueue = []; // [{path, imgEl, visible}]
  let _thumbActive = 0;
  let _thumbGen = 0; // bumped per grid rebuild so stale queue entries from the previous folder are dropped
  // ── Decoded-thumbnail cache, keyed by path+mtime ────────────────────────────────────────────
  // The windowed grid rebuilds its whole DOM (`grid.innerHTML=''`) every time the mounted row
  // range changes, and each rebuilt card called loadThumb again. With no cache that meant a fresh
  // Tauri IPC round trip, Blob and createObjectURL for every card in the window on every row
  // boundary crossed — scroll down and back up and the grid visibly re-loaded photos already on
  // screen a moment earlier. The Rust side caches to disk, so this was never a re-decode, but it
  // was still a round trip and an <img> decode per card, which is exactly what the flicker was.
  //
  // ⚠️ The cache OWNS its URLs, and nothing else may revoke them. Getting this wrong is precisely
  // what broke video posters: a cached URL was also pushed into a per-generation revoke list, so a
  // grid rebuild revoked a URL the cache kept handing out, and every one of those cards became a
  // permanent broken-image "?". Eviction below is the ONLY place a cached URL is revoked, and it
  // only ever evicts entries that are no longer in the map.
  //
  // Keyed on mtime as well as path so a re-exported or re-edited file misses the cache rather than
  // showing its old thumbnail forever.
  const THUMB_CACHE_MAX = 1200; // ~360px JPEGs, so roughly 25-50MB retained at the cap
  const _thumbCache = new Map(); // "path@mtime" -> objectURL (insertion-ordered = LRU order)
  function thumbCacheGet(key) {
    const url = _thumbCache.get(key);
    if (url === undefined) return null;
    // Re-insert so the Map's insertion order stays a true recency order for the eviction below.
    _thumbCache.delete(key);
    _thumbCache.set(key, url);
    return url;
  }
  function thumbCachePut(key, url) {
    const prev = _thumbCache.get(key);
    if (prev && prev !== url) URL.revokeObjectURL(prev);
    _thumbCache.delete(key);
    _thumbCache.set(key, url);
    while (_thumbCache.size > THUMB_CACHE_MAX) {
      const oldest = _thumbCache.keys().next().value;
      const dead = _thumbCache.get(oldest);
      _thumbCache.delete(oldest);
      if (dead) URL.revokeObjectURL(dead);
    }
  }
  /// Drops a path's cached thumbnail across every mtime it was cached under — called after an
  /// in-app edit writes a new render, so the grid picks the new pixels up.
  function thumbCacheInvalidate(path) {
    for (const key of Array.from(_thumbCache.keys())) {
      if (key.slice(0, key.lastIndexOf('@')) === path) {
        const dead = _thumbCache.get(key);
        _thumbCache.delete(key);
        if (dead) URL.revokeObjectURL(dead);
      }
    }
  }
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
  // Priority: visible non-video first, then any non-video (JPEG tier-1/2 and RAW share the same
  // Rust get_thumbnail* path and are cheap either way), and only once no non-video job remains do
  // videos get picked — capped separately at THUMB_POOL_VIDEO regardless of visibility, so a
  // scrolled-into-view video can't blow past the small video concurrency budget.
  function _pickNextIdx() {
    let i = _thumbQueue.findIndex((t) => t.visible && !t.isVideo);
    if (i >= 0) return i;
    i = _thumbQueue.findIndex((t) => !t.isVideo);
    if (i >= 0) return i;
    if (_thumbActiveVideo >= THUMB_POOL_VIDEO) return -1;
    i = _thumbQueue.findIndex((t) => t.visible);
    if (i >= 0) return i;
    return _thumbQueue.length ? 0 : -1;
  }
  function _thumbPump() {
    while (_thumbActive < THUMB_POOL && _thumbQueue.length) {
      const i = _pickNextIdx();
      if (i < 0) break; // only videos left and the video pool is already full — wait for a slot
      const job = _thumbQueue.splice(i, 1)[0];
      // NOTE: job.imgEl.isConnected requires the card to already be in the DOM by the time
      // loadThumb() is called — renderGrid() must appendChild(card) BEFORE calling loadThumb(),
      // or every job is silently dropped here (this was the "thumbnails never load" bug: the
      // pump ran synchronously while cards were still detached, so isConnected was false for
      // every single job and _thumbActive never even incremented).
      if (job.gen !== _thumbGen || !job.imgEl.isConnected) continue; // grid was rebuilt — skip
      _thumbActive++;
      if (job.isVideo) _thumbActiveVideo++;
      updateThumbProgress();
      // Tier 1 (get_thumbnail_fast): pulls the camera's own embedded JPEG preview straight out
      // of the EXIF thumbnail IFD — no full-image decode, so it paints almost instantly. Falls
      // back to Err for RAWs and anything without an embedded preview, or if the read fails for
      // any reason; either way we fall through to the real tier-2 decode below, which also
      // replaces whatever tier-1 painted so the final thumbnail is always the accurate one.
      // ⚠️ Video takes this identical path — get_thumbnail_fast declines it on extension, so a
      // clip simply skips tier 1 and lands on tier 2, where library.rs generates the poster with
      // AVFoundation. There is deliberately no video branch here any more: the previous one
      // decoded clips in a hidden <video> and cached the resulting blob URL while ALSO handing it
      // to the per-generation revoke list below, so any grid rebuild revoked a URL the cache kept
      // serving and every video card became a permanent broken-image "?".
      invoke('get_thumbnail_fast', { path: job.path })
        .catch(() => null)
        .then((fastBuf) => {
          if (fastBuf && job.imgEl.isConnected) {
            // Tier 1 is deliberately NOT cached: tier 2 below replaces it a moment later with the
            // accurate render, and caching the embedded preview would mean serving the rougher
            // image from then on. Revoked as soon as tier 2 paints over it.
            const fastUrl = URL.createObjectURL(new Blob([fastBuf], { type: 'image/jpeg' }));
            job.imgEl.src = fastUrl;
            job.imgEl.classList.add('loaded');
            job._fastUrl = fastUrl;
          }
          // get_thumbnail_or_offline: falls back to the catalog's never-pruned offline
          // thumbnail tier when a direct decode fails (the common trigger being the volume
          // is unplugged) — a plain folder photo that decodes fine takes the exact same path
          // it always did, this only changes behavior for a catalog entry whose file isn't
          // currently reachable.
          return invoke('get_thumbnail_or_offline', { path: job.path });
        })
        .then((buf) => {
          const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
          thumbCachePut(job.key, url);
          if (job.imgEl.isConnected) {
            job.imgEl.src = url;
            job.imgEl.classList.add('loaded');
          }
          if (job._fastUrl) { URL.revokeObjectURL(job._fastUrl); job._fastUrl = null; }
        })
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
          if (job.isVideo) _thumbActiveVideo--;
          _thumbDoneCount++;
          updateThumbProgress();
          // ⚠️ Keeps the OUTER watchdog (chromasmith-22.html) alive while real per-card decode
          // progress is happening. Without this, only the SINGLE synthetic 'paint' phase event at
          // the start of firstPaintReady()'s wait ever bumped it — so on a real, slow decode batch
          // (contended cores, cold RAW demosaic) the outer watchdog's own 8s grace ran out and
          // force-revealed the library BEFORE this inner gate's wait finished, even though real
          // progress was actively happening the whole time. Confirmed live: fixing only the
          // starvation (deferring catalogRunBackgroundPhases) shrank the empty-grid window but
          // didn't close it, because this gap was still racing it independently. A no-op once the
          // splash element is gone (updateBootSplashProgress's own guard).
          if (typeof updateBootSplashProgress === 'function') {
            updateBootSplashProgress({ phase: 'paint', done: _thumbDoneCount, total: _thumbTotalCount });
          }
          _resolveThumbPaintWaiters();
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
  /// The real readiness gate for the boot splash: resolves once every card mounted in the
  /// CURRENT grid generation has settled — loaded OR failed, `_thumbDoneCount >= _thumbTotalCount`
  /// exactly mirrors updateThumbProgress's own "batch settled" condition above, which is the
  /// existing, already-correct completion check for this queue. This replaces the old boot gate
  /// (toggleLibrary().then(...)), which resolved once cards existed in the DOM, not once they had
  /// pixels — the root reason 12 prior fixes never closed this bug: they all sped up or
  /// instrumented that promise chain without changing what it actually measured.
  /// `_thumbPaintWaiters` is checked in loadThumb's job `.finally()` below, the one place every
  /// job (success or failure) is guaranteed to pass through.
  let _thumbPaintWaiters = [];
  function firstPaintReady(timeoutMs) {
    return new Promise((resolve) => {
      // Nothing queued yet (e.g. an empty folder, or every card was already a cache hit and
      // painted synchronously in loadThumb before this is even called) — already ready.
      if (_thumbTotalCount === 0 || _thumbDoneCount >= _thumbTotalCount) { resolve(); return; }
      const gen = _thumbGen;
      let settled = false;
      const done = () => { if (settled) return; settled = true; resolve(); };
      _thumbPaintWaiters.push({ gen, done });
      if (timeoutMs) setTimeout(done, timeoutMs); // never let a stuck/slow card hang the caller forever
    });
  }
  function _resolveThumbPaintWaiters() {
    if (_thumbDoneCount < _thumbTotalCount || !_thumbPaintWaiters.length) return;
    const waiters = _thumbPaintWaiters;
    _thumbPaintWaiters = [];
    for (const w of waiters) w.done();
  }
  function fmtDuration(sec) {
    if (!sec || !isFinite(sec)) return '';
    const m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return m + ':' + String(r).padStart(2, '0');
  }
  function loadThumb(path, imgEl, isVideo, mtime) {
    const key = path + '@' + (mtime || 0);
    // Already decoded and still retained — paint it synchronously and skip the pool entirely.
    // This is what stops a scroll that re-mounts a row from re-fetching every card in it.
    const hit = thumbCacheGet(key);
    if (hit) {
      imgEl.src = hit;
      imgEl.classList.add('loaded');
      return;
    }
    _thumbQueue.push({ path, key, imgEl, isVideo: !!isVideo, visible: false, gen: _thumbGen });
    _thumbTotalCount++;
    if (_thumbIO) _thumbIO.observe(imgEl);
    _thumbPump();
  }
  function thumbQueueReset() {
    _thumbGen++;
    if (_thumbIO) _thumbQueue.forEach((t) => _thumbIO.unobserve(t.imgEl));
    _thumbQueue = [];
    _thumbActive = 0; // defensive: never let a stale count strand future pumps
    _thumbActiveVideo = 0;
    // ⚠️ Deliberately does NOT touch _thumbCache. Its URLs are owned by the cache and are still
    // valid for whatever the grid re-mounts a moment later — revoking them here is exactly the
    // mistake that made cached video posters render as permanent broken images, and it would also
    // reintroduce the full re-fetch on every sort/filter/search that this cache exists to remove.
    // Retention is bounded by THUMB_CACHE_MAX's LRU eviction instead.
    _thumbFailCount = 0;
    _thumbTotalCount = 0;
    _thumbDoneCount = 0;
    _thumbFailToastShown = false;
    updateThumbProgress();
    // Any waiter armed for the generation just discarded can never see its own queue reach
    // done>=total (that queue is gone) — resolve them now rather than making them ride out their
    // own timeout for no reason (e.g. a boot that immediately switches folders again).
    if (_thumbPaintWaiters.length) {
      const waiters = _thumbPaintWaiters;
      _thumbPaintWaiters = [];
      for (const w of waiters) w.done();
    }
  }

  // Small orange pen icon for the "edited" corner badge — replaces the old EDITED text pill.
  // Color matches the app's accent orange (--acc, e.g. #e8a33d) used elsewhere in the UI.
  const EDITED_BADGE_HTML = '<div class="lib-edited-badge" title="Edited"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z" fill="#e8a33d"/>' +
    '<path d="M12.5 6.5l5 5" stroke="#00000055" stroke-width="1"/></svg></div>';
  const FLAG_SVG_GREEN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#46a758" stroke-width="2.4"><path d="M5 21V4" stroke-linecap="round"/><path d="M5 4h13l-3.2 4.5L18 13H5z" fill="#46a758" stroke="none"/></svg>';
  const FLAG_SVG_RED = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#e5484d" stroke-width="2.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
  const HEART_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="#e5484d" stroke="none"><path d="M12 20.5s-7.5-4.6-10-9.1C.6 8.1 2 4.8 5.2 4c2-.5 4 .3 5.3 2 1.3-1.7 3.3-2.5 5.3-2 3.2.8 4.6 4.1 3.2 7.4-2.5 4.5-10 9.1-10 9.1z"/></svg>';
  // Shown only on a card whose own volume is unreachable right now (CatalogEntry.offline,
  // Rust-computed per row) — the thumbnail is real, but it's coming from the cache, not a live
  // read of the original. A drive-disconnected glyph, not a text label, per the approved
  // boot-sequence storyboard.
  const OFFLINE_BADGE_HTML = '<div class="lib-offline-badge" title="Original not reachable right now — showing the cached preview">'
    + '<svg viewBox="0 0 24 24" width="10" height="10"><rect x="7" y="1" width="10" height="6" fill="#f2f0ea"/>'
    + '<rect x="4" y="7" width="16" height="16" rx="5" fill="#f2f0ea"/>'
    + '<line x1="8.5" y1="11.5" x2="15.5" y2="18.5" stroke="#00000090" stroke-width="2.3" stroke-linecap="round"/>'
    + '<line x1="15.5" y1="11.5" x2="8.5" y2="18.5" stroke="#00000090" stroke-width="2.3" stroke-linecap="round"/></svg></div>';
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
  /// Nothing has ever been added to the Library — the true first-launch state. Two distinct
  /// actions, not one: "Add photos" loads loose files straight into the editor (fxPickPhotos,
  /// chromasmith-22.html), "Add a folder" registers a folder with the Library so it's browsable
  /// and kept in sync (the same #lib-pick trigger pickFolder() already wires up elsewhere).
  function renderLibraryNoRoot() {
    const grid = document.getElementById('lib-grid');
    if (!grid) return;
    grid.innerHTML = '<div id="lib-empty" style="grid-column:1/-1;padding:60px 20px">Add photos or a folder'
      + '<div style="margin-top:14px;display:flex;gap:8px;justify-content:center">'
      + '<button class="lib-btn" id="lib-empty-addphotos">Add photos</button>'
      + '<button class="lib-btn" id="lib-empty-addfolder">Add a folder</button>'
      + '</div>'
      + '<div style="margin-top:10px;font-size:11px">Drop an image to start · '
      + '<a id="lib-empty-gphotos" style="color:var(--acc);cursor:pointer;text-decoration:underline">Google Photos…</a></div></div>';
    const addPhotos = document.getElementById('lib-empty-addphotos');
    if (addPhotos) addPhotos.onclick = () => { if (typeof window.fxPickPhotos === 'function') window.fxPickPhotos(); };
    const addFolder = document.getElementById('lib-empty-addfolder');
    if (addFolder) addFolder.onclick = () => pickFolder();
    const gphotos = document.getElementById('lib-empty-gphotos');
    if (gphotos) gphotos.onclick = () => { const b = document.getElementById('lib-gphotos'); if (b) b.click(); };
  }
  /// Persistent, not a toast — this is a standing fact about the current folder, not a one-off
  /// event. The point of the cache: the grid stays fully browsable (every card its cached
  /// preview) while a volume is unreachable, so this bar names what's true instead of blocking
  /// anything. Sticky-positioned inside #lib-main (already the scroll container) rather than a
  /// second fixed-position layer, so it never needs its own resize/scroll bookkeeping.
  function renderLibOfflineBar(offline) {
    const main = document.getElementById('lib-main');
    if (!main) return;
    let bar = document.getElementById('lib-offline-bar');
    if (!offline) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'lib-offline-bar';
      bar.style.cssText = 'position:sticky;bottom:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:8px;'
        + 'padding:7px 14px;margin-top:12px;font-size:11.5px;color:#e3b3a2;'
        + 'background:rgba(201,106,79,.16);border-top:1px solid rgba(201,106,79,.35);backdrop-filter:blur(6px)';
      bar.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#c96a4f;flex-shrink:0"></span>'
        + '<span id="lib-offline-bar-text"></span>';
      main.appendChild(bar);
    }
    const label = state.currentFolder ? baseName(state.currentFolder) : 'This folder';
    document.getElementById('lib-offline-bar-text').textContent =
      `${label} — drive not connected · showing cached previews. Reconnect to edit or export the originals.`;
  }
  // Reject/Pick/Favorite only — colour labels (Red/Yellow/Green/Blue/Purple dots) were removed.
  // Reject/Pick still ride the sidecar's free-form `label` string ("Red"/"Green"), unchanged.
  function flagsHtml(label, favorite) {
    return `<span class="lib-flag${label === 'Red' ? ' on' : ''}" data-flag="Red" title="Reject (X)">${FLAG_SVG_RED}</span>` +
           `<span class="lib-flag${label === 'Green' ? ' on' : ''}" data-flag="Green" title="Pick (flag)">${FLAG_SVG_GREEN}</span>` +
           `<span class="lib-flag lib-fav${favorite ? ' on' : ''}" data-flag="Favorite" title="Favorite (F)">${HEART_SVG}</span>`;
  }

  /// Five stars, filled to `n`. Click sets that rating; clicking the current rating clears it,
  /// which is the Lightroom behaviour and the only way to get back to unrated with the mouse.
  // ── Star ratings: BUILT, then switched off (user decision, 2026-08-16) ──────────────────────
  // Kept in the code rather than deleted, because the decision was "I no longer need it" and not
  // "it was wrong" — flip this to true and every surface comes back: the card overlay, the 0-5
  // keyboard shortcuts, the rating filter, the Rating sort key and list column.
  //
  // ⚠️ Switched off at the SURFACES, never in setRating or the sidecar schema. Ratings already
  // written to .xmp sidecars stay there and stay readable; turning the UI off must not silently
  // start dropping data the user recorded, or turning it back on would show an empty history.
  const STARS_ENABLED = false;
  function starsHtml(n) {
    if (!STARS_ENABLED) return '';
    n = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
    let out = '<span class="lib-stars">';
    for (let i = 1; i <= 5; i++) {
      out += `<span class="lib-star${i <= n ? ' on' : ''}" data-star="${i}" title="${i} star${i > 1 ? 's' : ''} (${i})">★</span>`;
    }
    return out + '</span>';
  }
  /// Mirrors setLabel exactly — optimistic local update, sidecar write, same failure handling —
  /// because a rating and a flag are the same kind of edit and should not drift apart.
  async function setRating(path, rating) {
    const cur = state.sidecars.get(path) || { rating: 0, label: '', edited: false };
    const n = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
    const updated = { ...cur, rating: n };
    state.sidecars.set(path, updated);
    await invoke('set_sidecar', { path, rating: n, label: updated.label, edited: updated.edited, favorite: updated.favorite })
      .catch((e) => sidecarWriteFailed(path, cur, e));
    const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
    const holder = card && card.querySelector('.lib-stars');
    if (holder) holder.outerHTML = starsHtml(n);
    if (typeof renderCollectionCounts === 'function') renderCollectionCounts();
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
        // N1a piece 1: a real decode source for a cached-only (offline) photo. There is no
        // full-resolution offline cache — building one would be a separate, much bigger
        // storage-budget undertaking (CLAUDE.md §2's payload-cost rule) — so when the real file
        // can't be read, this falls back to `get_thumbnail_or_offline`: the SAME never-pruned
        // 360px-long-edge JPEG the Library grid already shows offline (catalog.rs's "Scan phase
        // D: offline thumbnails"). Editing against it is real but REDUCED-QUALITY, and the UI
        // must stay honest about that (the toast below), not pretend it's the original.
        let buf, offlinePreview = false, hqOfflineCacheExt = null;
        try {
          buf = await invoke('read_file_bytes', { path });
        } catch (readErr) {
          // ⚠️ Checked BEFORE the reduced-quality fallback below — a photo in the guaranteed-
          // offline set (last 100 edited + last 100 added, see refreshHqOfflineIndex) has a REAL
          // full-resolution, DCP-accurate cached copy. Reading it here and leaving offlinePreview
          // FALSE is what makes it "no difference... as if downloaded": every offlinePreview-
          // gated special case below (the reduced-quality toast, the offline-edit queue, the
          // never-cache-under-the-real-key guard) simply doesn't apply, because as far as the
          // rest of this function is concerned, the read just succeeded normally.
          const hq = _hqOfflineByPath.get(path);
          if (hq) {
            try {
              buf = await invoke('read_file_bytes', { path: hq.path });
              hqOfflineCacheExt = (hq.path.match(/\.([^.\/]+)$/) || [, ''])[1].toLowerCase();
            } catch (hqErr) { buf = null; }
          }
          if (!buf) {
            try {
              buf = await invoke('get_thumbnail_or_offline', { path });
              offlinePreview = true;
            } catch (offlineErr) {
              throw readErr; // neither the real file, its hq_offline cache, nor any preview exists — surface the real error
            }
          }
        }
        // lastModified:0 (not the default Date.now()) — chromasmith-22.html's loadFXImages()
        // keys "is this the same photo already loaded" off name+size+lastModified so it knows
        // whether to reset per-photo state (export version, All-FX toggles) on load. A File
        // built fresh from read_file_bytes on every reopen would otherwise get a new
        // lastModified each time (today's timestamp), making the SAME photo look like a
        // different one on every single reopen and defeating that check entirely.
        // ⚠️ Mime derives from the CACHE file's real extension when hqOfflineCacheExt is set, not
        // `path`'s — a RAW source's hq_offline cache is a JPEG (DCP-decoded), so mimeFromName on
        // the ORIGINAL .RW2-style path would claim a RAW mimetype for bytes that are actually a
        // JPEG. A byte-copied still (already JPEG/HEIC/etc originally) has a matching extension
        // either way, so this is a no-op for that case.
        const fileMime = offlinePreview ? 'image/jpeg' : (hqOfflineCacheExt ? mimeFromName('x.' + hqOfflineCacheExt) : mimeFromName(path));
        const file = new File([buf], baseName(path), { type: fileMime, lastModified: 0 });
        await loadFXImages([file]); // bare identifier — see desktop-native.js's note on this
        if (fxImages[0]) {
          fxImages[0].fileSize = buf.byteLength; // shown as the "Size" row in the metadata panel
          fxImages[0].offlinePreview = offlinePreview;
          if (offlinePreview) {
            state.offlineEditPaths.add(path);
            if (typeof toast === 'function') {
              toast(`${baseName(path)} — drive not connected. Editing a reduced-quality offline preview; edits are queued and applied at full resolution once it reconnects.`, false);
            }
          } else {
            state.offlineEditPaths.delete(path);
          }
          const loadKey = `${baseName(path)}:${buf.byteLength}:0`; // must match loadFXImages' own key formula
          // Never cache a low-res offline stand-in under the real path's key — a later ONLINE
          // open must not be served this reduced preview from imgCache.
          if (!offlinePreview) imgCacheStore(path, fxImages[0], loadKey);
          // Write the disk cache in the background — best-effort, never blocks the UI. Only for
          // RAWs (a JPEG/PNG/TIFF decode is already fast; caching those buys nothing). Waits a
          // beat for the two-phase RAW decode's background NR refine (desktop-native.js) to
          // land first, so the CACHED copy is full quality, not the fast/no-NR first pass.
          if (isRaw && fxImages[0].img && !offlinePreview) {
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
      if (!LIBTEST) { try { localStorage.setItem(LS_LAST_PATH, path); } catch (e) {} }
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
      scrollLibraryToPath(path);
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
      // Drop the loader's cached copy too, or the next time this card is re-mounted by a scroll
      // the cache would paint the PRE-edit thumbnail straight back over this one.
      thumbCacheInvalidate(path);
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
      if (state.offlineEditPaths.has(path)) {
        // N1a piece 2: the real file/sidecar isn't reachable right now (that's exactly why this
        // path is in offlineEditPaths — see openInEditorInner) — there is nowhere for set_sidecar
        // to write to. Queue the recipe in the catalog DB instead; it replays for real once the
        // volume reconnects (see wireOfflineQueueReconnect below). This does NOT update the local
        // sidecar cache/UI "edited" badge as saved-for-real — it stays queued until applied.
        await invoke('queue_offline_edit', { path, recipe }).catch((e) => console.error('queue_offline_edit', e));
      } else {
        await invoke('set_sidecar', { path, rating: cur.rating, label: cur.label, edited: true, recipe }).catch((e) => console.error('auto-save recipe', e));
      }
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
    // Chevron rotates rather than swapping ▾/▸ glyphs — same mechanism as the editor's
    // .msk-group-chev, so a leaf's permanently-empty chevron slot doesn't need its own case.
    row.innerHTML = `<span class="lib-tree-chev${isExpanded ? ' open' : ''}">${ic('chevron', 11)}</span>`
      + `<span style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:var(--mut)">${ic('folder', 13)}</span>`
      + `<span>${baseName(path) || path}</span>`;
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
  // Batched IPC: openFolder used to fire one get_sidecar/get_meta invoke() PER FILE via
  // Promise.all — N Tauri IPC round trips just to open a folder, regardless of how cheap any
  // single call is. get_sidecar_batch/get_meta_batch (library.rs) take the whole path list in
  // one call and run the per-file work in parallel on the Rust side. Falls back to the original
  // per-path path (still cached individually) if the batch command itself fails, so one bad
  // call can't lose the whole folder.
  async function getSidecarsBatch(paths) {
    const need = paths.filter((p) => !state.sidecars.has(p));
    if (!need.length) return;
    try {
      const scs = await invoke('get_sidecar_batch', { paths: need });
      need.forEach((p, i) => state.sidecars.set(p, scs[i] || { rating: 0, label: '', edited: false, recipe: '' }));
    } catch (e) {
      console.warn('get_sidecar_batch failed, falling back to per-file', e);
      await Promise.all(need.map((p) => getSidecar(p)));
    }
  }
  async function getMetaBatch(paths) {
    const need = paths.filter((p) => !state.meta.has(p));
    if (!need.length) return;
    try {
      const ms = await invoke('get_meta_batch', { paths: need });
      need.forEach((p, i) => state.meta.set(p, ms[i] || { camera: null, lens: null, date: null, iso: null }));
    } catch (e) {
      console.warn('get_meta_batch failed, falling back to per-file', e);
      await Promise.all(need.map((p) => getMeta(p).catch(() => ({}))));
    }
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
  // ⚠️ EXACT, not approximate — banded/pigeonhole, not LSH-with-misses. Splitting the 64-bit
  // hash into BANDS=8 non-overlapping 8-bit segments guarantees (pigeonhole principle: BANDS >
  // DUPE_HAMMING_THRESHOLD=6) that any TRUE pair — Hamming distance <= threshold — must have AT
  // LEAST ONE band with zero differing bits, i.e. an identical band value. So comparing only
  // pairs that share a band value in common can never miss a real duplicate; it only skips pairs
  // that share NO band, which are provably >6 bits apart and would have failed the exact check
  // anyway. This was the plain O(n^2) nested loop over every pair — the same shape of bug this
  // session already fixed once in Rust (registry_set_cmd) — measured at ~1.7s for a real ~30k-
  // photo library's worth of pairs (444M comparisons). Banding turns the common case back toward
  // O(n): for uniformly-distributed hashes each band bucket holds roughly n/256 items, so the
  // total candidate-pair count collapses from n²/2 to roughly n²/256 per band. A `checked` Set
  // dedupes a pair that happens to share more than one band, so it's never verified twice.
  function clusterByHash(pairs) {
    const parent = new Map();
    const find = (p) => { while (parent.get(p) !== p) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); } return p; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    pairs.forEach(([p]) => parent.set(p, p));
    const n = pairs.length;
    const hi = new Int32Array(n), lo = new Int32Array(n);
    const hex = new Array(n);
    for (let i = 0; i < n; i++) {
      const h = (pairs[i][1] || '').padStart(16, '0');
      hex[i] = h;
      hi[i] = parseInt(h.slice(0, 8), 16) | 0;
      lo[i] = parseInt(h.slice(8, 16), 16) | 0;
    }
    const BANDS = 8; // 8 bands * 8 bits = 64 bits; BANDS(8) > DUPE_HAMMING_THRESHOLD(6) is the pigeonhole requirement
    const buckets = []; // one Map<bandValue, index[]> per band
    for (let b = 0; b < BANDS; b++) buckets.push(new Map());
    for (let i = 0; i < n; i++) {
      for (let b = 0; b < BANDS; b++) {
        const key = hex[i].slice(b * 2, b * 2 + 2);
        let arr = buckets[b].get(key);
        if (!arr) { arr = []; buckets[b].set(key, arr); }
        arr.push(i);
      }
    }
    // ⚠️ Deliberately NO dedup Set for a pair verified via more than one shared band. A first
    // version used a Set keyed on the string `i+','+j` — on a library with a large cluster of
    // near-identical photos (a burst sequence, brackets, timelapse frames — exactly the material
    // real libraries accumulate), those hashes tend to share MANY of the 8 bands at once, so the
    // SAME large candidate set got re-verified repeatedly, and EVERY check allocated a new heap
    // string as a Set key. Measured live on a real 57k-photo library via a stack sample of the
    // WebContent process: 71% of all samples were inside JavaScriptCore's `operationSetGet` doing
    // STRING equality comparisons — millions of ad-hoc string allocations froze the whole JS
    // thread (buttons unresponsive) for minutes. `union(a,b)` is already idempotent, so verifying
    // the same pair twice just costs a little redundant `popcount32` arithmetic on typed-array
    // values — cheap, no allocation — nowhere near the cost of the string Set it replaces.
    //
    // ⚠️ That reasoning held for SCATTERED near-duplicates but not for one huge tightly-packed
    // cluster: measured on a synthetic 3,000-photo cluster of fully-identical hashes (worst
    // case — every pair shares all 8 bands), dropping the dedup Set alone still took ~5.1s,
    // because every one of the 8 bands independently re-verified and re-unioned the SAME
    // ~4.5M pairs.
    //
    // Two layers fix this, and BOTH matter — a per-pair `find()` check alone (tried first, still
    // measured ~6.4s) doesn't help, because the x/y double loop over a huge bucket is O(k^2) in
    // ITERATION COUNT regardless of how cheap each iteration's body is; 31.5M redundant loop
    // iterations across 7 bands still costs real time even doing nothing per iteration.
    //   1. Per-BUCKET short-circuit: before even entering the double loop, an O(k) pass checks
    //      whether every item in this bucket already shares one root (fully connected by an
    //      earlier band) — if so, skip the whole O(k^2) re-verification for this band. Once a
    //      cluster is fully unioned (which happens on the FIRST band that processes it), every
    //      later band's copy of the same bucket collapses to a cheap O(k) walk instead of O(k^2).
    //   2. Per-PAIR `find()` check (kept from the first attempt): still worth having for the
    //      partially-connected case a bucket short-circuit alone can't catch — e.g. two SEPARATE
    //      sub-clusters that only merge into one root partway through a band's own loop.
    // No extra memory, no string keys — both layers just reuse state this algorithm already
    // maintains (the union-find structure itself).
    for (let b = 0; b < BANDS; b++) {
      for (const arr of buckets[b].values()) {
        if (arr.length < 2) continue;
        const root0 = find(pairs[arr[0]][0]);
        let allSame = true;
        for (let k = 1; k < arr.length; k++) {
          if (find(pairs[arr[k]][0]) !== root0) { allSame = false; break; }
        }
        if (allSame) continue; // whole bucket already one cluster — nothing new to learn here
        for (let x = 0; x < arr.length; x++) {
          const i = arr[x], ai = hi[i], bi = lo[i], pi = pairs[i][0];
          for (let y = x + 1; y < arr.length; y++) {
            const j = arr[y];
            const pj = pairs[j][0];
            if (find(pi) === find(pj)) continue; // already known to cluster together
            if (popcount32(ai ^ hi[j]) + popcount32(bi ^ lo[j]) <= DUPE_HAMMING_THRESHOLD) union(pi, pj);
          }
        }
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
    // ⚠️ ONE batched call, not one invoke() per photo. The per-path version (Promise.all over
    // registry_set_cmd) measured at 29,663 IPC calls / ~47GB of registry re-reads / ~0.9 BILLION
    // string comparisons on a real ~30k-photo folder — registry_set_cmd's own registry_read does
    // a full parse of the whole list and a linear scan on EVERY call. registry_set_many does one
    // read, one HashSet, one write for the whole batch.
    const present = [], absent = [];
    for (const p of paths) (state.dupeClusters.has(p) ? present : absent).push(p);
    invoke('registry_set_many', { name: 'duplicates', present, absent })
      .catch(() => {})
      .then(() => renderCollectionCounts());
    renderGrid();
  }

  // ── C3: Google-Photos-synced badge ────────────────────────────────────────────────────
  window.chromasmithRecordSynced = async (paths) => {
    if (!Array.isArray(paths)) return;
    // Was a serial await-in-loop (one invoke per path, awaited one at a time) — batched for the
    // same reason as runDupeDetection above, and this one was strictly worse than parallel since
    // it wasn't even concurrent.
    try { await invoke('registry_set_many', { name: 'gphotos', present: paths, absent: [] }); }
    catch (e) { console.error('registry_set_many(gphotos)', e); }
    paths.forEach((p) => state.syncedPaths.add(p));
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
      // Same batching fix as runDupeDetection's own comment — one call for the whole folder.
      await invoke('registry_set_many', { name: 'gphotos', present: entries.map((e) => e.path), absent: [] }).catch(() => {});
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
  /// Recursive listing for the "Include Photos from Subfolders" toggle. Deliberately a frontend
  /// BFS over the same list_dir the tree already uses (not a new Rust command) — this is plain
  /// folder browsing, not the SQLite catalog.
  /// ⚠️ Measured, not assumed: a naive one-at-a-time version of this (await list_dir in a serial
  /// loop) took 29 SECONDS to walk 4000 directories in a pure-mock test harness with ZERO real
  /// disk I/O — pure per-call/IPC overhead. That is the exact "silent multi-second freeze" class
  /// of bug this session already found and fixed once (scan_card) — reusing a naive serial walk
  /// here would have reintroduced it in a different place. Fixed with (1) bounded concurrency so
  /// several list_dir calls are in flight at once instead of one at a time, and (2) a progress
  /// toast every 50 directories so a genuinely large tree still gives feedback instead of going
  /// quiet. The directory cap is lower than a first pass (1000, not 4000) — a personal photo
  /// library's date-folder tree is realistically dozens to a few hundred directories; 1000 is
  /// generous headroom, not a wall anyone should realistically hit.
  const SUBFOLDER_WALK_CAP = 1000;
  const SUBFOLDER_WALK_CONCURRENCY = 8;
  async function listDirRecursive(rootPath) {
    const collected = [];
    let queue = [rootPath];
    let dirsWalked = 0;
    let capHit = false;
    // Fire one update BEFORE the first batch even starts. The boot splash's watchdog
    // (chromasmith-22.html's bumpBootSplashWatchdog) force-hides the splash if nothing bumps it
    // within its grace period — if the first slow stretch of this walk (a contended external
    // drive, cold OS file-cache) took longer than that grace period, the splash would vanish
    // with the bar never having rendered even once. This ping alone can't fix a walk that's
    // genuinely slow throughout, but it closes the specific window where the FIRST update never
    // arrives in time — measured to be exactly what was happening (see the plan's Root Cause 1).
    if (typeof updateBootSplashProgress === 'function') {
      updateBootSplashProgress({ phase: 'subfolders', done: 0, total: 0, current: '' });
    }
    while (queue.length) {
      const batch = queue.splice(0, SUBFOLDER_WALK_CONCURRENCY);
      const results = await Promise.all(batch.map((dir) => invoke('list_dir', { path: dir }).catch(() => [])));
      const nextQueue = [];
      for (let i = 0; i < batch.length; i++) {
        const dir = batch[i], entries = results[i];
        if (dir === rootPath) _treeListCache.set(rootPath, entries); // keep the tree's own cache in sync, same as the non-recursive path
        dirsWalked++;
        for (const e of entries) {
          if (e.is_dir) { if (dirsWalked + nextQueue.length < SUBFOLDER_WALK_CAP) nextQueue.push(e.path); else capHit = true; }
          else collected.push(e);
        }
      }
      queue = queue.concat(nextQueue);
      // Feed the boot splash's progress bar on EVERY batch (a no-op once #boot-splash-progress
      // is gone, same guard updateBootSplashProgress already uses for catalog-scan events) — not
      // throttled to every 50 dirs like the toast below. The watchdog only stays open as long as
      // updates keep arriving inside its grace window, so a throttle here directly controls
      // whether the splash survives a slow stretch, not just how chatty the UI looks.
      if (typeof updateBootSplashProgress === 'function') {
        updateBootSplashProgress({ phase: 'subfolders', done: collected.length, total: 0, current: '' });
      }
      if (dirsWalked % 50 < SUBFOLDER_WALK_CONCURRENCY && typeof toast === 'function') {
        toast(`Scanning subfolders… ${dirsWalked} folders, ${collected.length} photos found`, true);
      }
    }
    if (capHit && typeof toast === 'function') toast(`Stopped after ${SUBFOLDER_WALK_CAP} subfolders — this tree is unusually large`, false);
    return collected;
  }
  // Loads thumbnails STRAIGHT INTO `_thumbCache` (thumbCachePut, the same LRU the ordinary grid
  // read from) BEFORE any card exists — unlike the lazy `_thumbPump` above, which needs a live,
  // DOM-connected <img> per job and so can't run ahead of renderGrid(). This is what makes the
  // boot sequence's "Loading thumbnails…" phase real: once this resolves, renderGrid()'s own
  // loadThumb() calls hit thumbCacheGet() synchronously for everything it warmed, instead of each
  // card firing its own fresh IPC round trip.
  // ⚠️ Bounded TWO ways, both required — this has been wrong in both directions on this exact
  // library, so don't "simplify" either one away again:
  //   1. PREFETCH_CAP — the first N entries, a real screenful, not a whole folder page (an earlier
  //      version capped at 800, which no wall clock could realistically clear).
  //   2. PREFETCH_BUDGET_MS — a wall-clock deadline on the whole phase. A version WITHOUT this
  //      (reasoning that PREFETCH_CALL_TIMEOUT_MS alone bounds each call) was shipped and measured
  //      live against this user's real library: the status bar showed "Generating thumbnails… 0%"
  //      — a genuinely COLD on-disk thumbnail cache doing full RAW demosaic/decode for the first
  //      time, competing with this very prefetch for CPU cores against catalog.rs's own background
  //      bulk thumbnail pass. Each `get_thumbnail_or_offline` call can legitimately take far longer
  //      than a "fast fetch," so the per-item timeout alone let the loop keep dispatching new
  //      native decodes for MINUTES, never reaching renderGrid().
  //      That specific contention is now fixed at its root: catalog.rs's bulk thumbnail_run/focus-
  //      scoring batches run on their OWN smaller `decode_batch_pool()` (half of the app's already-
  //      reduced `cores-2` global rayon budget) instead of saturating every core, leaving real
  //      headroom for this prefetch's interactive `get_thumbnail_or_offline` calls (dispatched via
  //      Tauri's separate tokio pool). Measured live post-fix: the ordinary lazy per-card pump,
  //      hitting the exact same call, went from stuck at 0 progress for 50+s to steady ~7-8
  //      items/sec. The wall clock stays as a safety net (never remove it again without live
  //      re-measurement) but is now sized to let a genuinely cold 100-item batch actually finish —
  //      at ~7-8/s that's ~13-15s; 20s leaves real margin without reintroducing an unbounded stall.
  const PREFETCH_CAP = 100;
  const PREFETCH_BUDGET_MS = 20000;
  const PREFETCH_CONCURRENCY = 8;
  // A WARM cache fetch is fast (CLAUDE.md: RAW embedded-preview extraction measured at 97-175ms; a
  // cached JPEG is faster still) — 1200ms is generous headroom over that. This bounds the cost of
  // ONE stuck/slow item so a single pathological file can't hang its worker past the next
  // PREFETCH_BUDGET_MS check; it does NOT by itself bound the whole phase (see above) — a cold
  // cache generating real thumbnails can validly take longer than this per item, which is why the
  // wall-clock budget above is sized in whole seconds, not this constant scaled up.
  const PREFETCH_CALL_TIMEOUT_MS = 1200;
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  async function prefetchThumbnails(entries, onProgress) {
    const targets = entries.filter((e) => e.is_image || e.is_video).slice(0, PREFETCH_CAP)
      .filter((e) => !thumbCacheGet(e.path + '@' + (e.mtime || 0)));
    const total = targets.length;
    if (!total) return;
    // ⚠️ `done` counts CACHE HITS only, never attempts. A version that incremented on every
    // attempt (success or timeout) reported "100%" while a cold RAW-decode batch cached ZERO
    // thumbnails — every call rejected inside the try/catch below, `done++` still ran, and the
    // splash/pill read complete having warmed nothing. `attempted` drives the loop's own
    // termination bookkeeping only; `onProgress` gets the honest number.
    let done = 0;
    let attempted = 0;
    const deadline = Date.now() + PREFETCH_BUDGET_MS;
    onProgress(0, total);
    let next = 0;
    async function worker() {
      while (next < targets.length && Date.now() < deadline) {
        const e = targets[next++];
        try {
          const buf = await withTimeout(invoke('get_thumbnail_or_offline', { path: e.path }), PREFETCH_CALL_TIMEOUT_MS);
          thumbCachePut(e.path + '@' + (e.mtime || 0), URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })));
          done++;
        } catch (err) { /* left uncached — the ordinary lazy pump retries it once the card mounts */ }
        attempted++;
        onProgress(done, total);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, total) }, worker));
    return { done, attempted, total };
  }
  async function openFolder(path, opts) {
    if (compareState.active) exitCompareMode(); // switching folders while comparing would strand the panes on the old batch
    state.currentFolder = path;
    if (!LIBTEST) { try { localStorage.setItem(LS_LAST_FOLDER, path); } catch (e) {} }
    state.source = 'folder'; // leaving a collection/cloud view — clears their sidebar highlight below
    state.selected.clear();
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let entries;
    try {
      // The catalog is now the grid's own data source, not a side-effect kicked off after a
      // separate live filesystem walk — see catalogRegisterFolder's doc comment and the plan's
      // Fix 1. Awaited (not fire-and-forget): the catalog_query right below depends on it having
      // actually registered/scanned this folder. Still captured on `window` so the cold-boot
      // sequence can await the same promise it always has.
      const regPromise = catalogRegisterFolder(path);
      window._lastCatalogRegisterPromise = regPromise;
      const reg = await regPromise;
      if (reg) {
        const page = await invoke('catalog_query', { q: { folder: { volumeId: reg.volumeId, relDir: reg.relDir, recursive: state.includeSubfolders } } });
        entries = page.entries;
      } else {
        // Fallback only: the catalog couldn't register this folder (e.g. a permissions error a
        // plain read_dir would also hit) — fall back to the live walk so the grid still shows
        // something rather than nothing.
        if (state.includeSubfolders) {
          entries = await listDirRecursive(path);
        } else {
          entries = await invoke('list_dir', { path });
          _treeListCache.set(path, entries); // opening a folder is the natural "refresh its listing" moment
        }
      }
    } catch (e) {
      grid.innerHTML = `<div id="lib-empty">Can't read this folder.</div>`;
      return;
    }
    state.entries = entries.filter((e) => e.is_image || e.is_video);
    // A folder's entries all share one volume, so any one of them (CatalogEntry.offline, a
    // per-row field the SQL query already computes) says whether THIS folder's drive is
    // reachable right now. Undefined (the list_dir/listDirRecursive fallback path) reads as
    // false — that path only runs when the catalog itself failed to register the folder, an
    // edge case where "can't tell" is the honest answer anyway.
    renderLibOfflineBar(state.entries.length > 0 && !!state.entries[0].offline);
    // Boot's own initial folder open (see the toggleLibrary() call site) waits for the FIRST
    // screenful's worth of thumbnails to actually be in memory before it clears the splash — so
    // reopening whatever you were last editing paints instantly instead of a placeholder that
    // fills in a beat later. Never runs for an ordinary click; the lazy per-card pump already
    // handles that case well and prefetching on every folder switch would slow down browsing.
    if (opts && opts.prefetchThumbs) {
      await prefetchThumbnails(state.entries, (done, total) => {
        if (typeof updateBootSplashProgress === 'function') updateBootSplashProgress({ phase: 'cache', done, total });
      });
    }
    // Sidecars are cheap (small JSON reads) and flags/edited badges need them for first paint —
    // await those. Metadata is NOT cheap on a cold folder (a get_meta cache miss reads the whole
    // RAW file for the lens fallback), and awaiting it for EVERY file kept the grid on
    // "Loading…" until the last file finished — a big folder took tens of seconds before
    // showing anything. Render immediately instead and let meta land in the background, then
    // refresh filters + grid once so sort-by-ISO/camera-filter pick it up.
    await getSidecarsBatch(state.entries.map((e) => e.path));
    const openToken = (state._openToken = (state._openToken || 0) + 1);
    state.dupeClusters.clear(); state.dupeClusterSizes.clear();
    await renderGrid();
    // The bulk catalog phases (thumbnails/focus/hash) wait for THIS generation's own interactive
    // decode queue to settle before they're allowed to start competing for the same CPU pools —
    // see catalogRegisterFolder's doc comment for why firstPaintReady() has to be called here,
    // after renderGrid() has actually built the queue, and not any earlier.
    if (_catalogBgPending) {
      _catalogBgPending = false;
      firstPaintReady(15000).then(() => catalogRunBackgroundPhases());
    }
    const libMain = document.getElementById('lib-main');
    if (libMain) libMain.scrollTop = scrollByFolder.get(path) || 0;
    if (typeof renderCollections === 'function') renderCollections(); // drop stale collection/album highlight
    // Sync-status backfill runs in the background, gated on the same openToken so a fast
    // folder switch never lets stale results overwrite the new grid.
    //
    // ⚠️ Duplicate detection is DELIBERATELY NOT run here any more. It used to fire
    // automatically on every folder open — three rounds of fixes to make that fast enough
    // (batching the registry write, then the O(n^2) clustering, then a string-Set dedup inside
    // THAT fix) each bought headroom that the library's own growth ate right back, because the
    // real problem was never how fast the algorithm was: no mature photo app eagerly recomputes
    // a duplicate graph on every view. PhotoPrism hashes once at import time and persists it;
    // digiKam's duplicate MATCHING is an explicit "Find Duplicates" tool, not automatic. This
    // app now follows the same model — see the "Find duplicates…" row in the Drives panel
    // (runDupeDetectionOnDemand) — so whatever the real-world worst case turns out to be (a
    // huge burst of near-identical photos, a much bigger library, anything not yet seen) it can
    // only ever block when the user explicitly asks for it, not silently gate ordinary browsing.
    loadSyncedForFolder(state.entries, openToken);
    markFolderSyncedIfGphotosDownloads(path, state.entries);
    getMetaBatch(state.entries.map((e) => e.path)).then(() => {
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
      case 'rating': return sc.rating || 0;
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
    // A missing/unreadable file (deleted/moved since the last scan — real for the cross-folder
    // "recents"/"edited"/"exported"/album views, which stat fresh and flag rather than error)
    // has nothing to show: no thumbnail, no metadata, and opening it just toasts an error. Hide
    // it from the grid/list entirely instead of rendering a broken placeholder card for it.
    if (entry.missing) return false;
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
    // "N or more", except '0' which means exactly unrated — the two useful questions.
    if (state.ratingFilter !== 'all') {
      const want = parseInt(state.ratingFilter, 10);
      const got = sc.rating || 0;
      if (want === 0 ? got !== 0 : got < want) return false;
    }
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
    if (card) card.querySelector('.lib-flags').innerHTML = flagsHtml(label, updated.favorite);
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
  window.chromasmithRecordExport = async (version, snap, dest) => {
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
    // `dest` (the real on-disk path the export was written to, when the native save path can
    // report it — see saveFilesNative's own per-item {ok,path} result) is only meaningful for
    // the single-photo case. A batch has no reliable 1:1 mapping available at this call site
    // between `paths` (Library paths) and the render results (indexed by fxImages position) —
    // recording it against the wrong photo would silently mislink an unrelated stack, which is
    // worse than recording nothing (stack rule 1 in catalog.rs just skips a dest-less entry).
    await Promise.all(paths.map((p) => invoke('append_export_history', { path: p, version, recipe, dest: paths.length === 1 ? (dest || null) : null }).catch((e) => console.error('append_export_history', p, e))));
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
  // ⚠️ `files.okPaths` carries the paths that actually survived, in the SAME order as `files` —
  // a batch export/edit zips fxImages[i] back against paths[i] to restore per-photo crop/masks
  // (see the "Export N photos" context-menu item below); indexing the ORIGINAL `paths` array
  // there instead desyncs the moment any one photo fails to read (a missing/locked file mid-
  // selection), silently applying photo A's crop/masks to photo B's render — or, with several
  // failures compounding, exporting nothing recognizable at all.
  async function readPathsAsFiles(paths) {
    const files = []; const failed = []; const okPaths = [];
    for (const p of paths) {
      try { const buf = await invoke('read_file_bytes', { path: p }); files.push(new File([buf], baseName(p), { type: mimeFromName(p) })); okPaths.push(p); }
      catch (e) { console.error('read_file_bytes', p, e); failed.push(p); }
    }
    if (failed.length) toast(`Could not read ${failed.length} of ${paths.length} photo(s)`, false);
    files.okPaths = okPaths;
    return files;
  }

  // ── ROADMAP R13 part 2 (astro stacking) — a tiny modal so the user picks Mean vs Median,
  // same <dialog> pattern as offlineQueueConflictModal below. Mean is the default (plain noise
  // averaging); Median is offered alongside it because it's cheap to add given merge.rs already
  // computes both from the same aligned stack, and it's the real astrophotography choice when a
  // hot pixel, cosmic-ray hit, or a satellite/airplane light streak could contaminate one frame.
  function astroStackModeModal() {
    return new Promise((res) => {
      let dlg = document.getElementById('lib-astro-modal');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'lib-astro-modal';
        dlg.style.cssText = 'border:1px solid var(--bdr);border-radius:10px;background:var(--bg);color:var(--txt);padding:16px;max-width:360px;width:90vw;font-family:var(--sans);box-shadow:var(--lift-2)';
        dlg.innerHTML = '<div style="font-size:13px;line-height:1.5;margin-bottom:14px">Stack mode:<br>'
          + '<span style="opacity:.7;font-size:11px">Mean — plain noise-reducing average.<br>'
          + 'Median — also rejects hot pixels, cosmic-ray hits and satellite/airplane trails that hit only one frame.</span></div>'
          + '<div style="display:flex;gap:8px;justify-content:flex-end">'
          + '<button type="button" id="lib-astro-cancel" class="btn bgh">Cancel</button>'
          + '<button type="button" id="lib-astro-median" class="btn bgh">Median</button>'
          + '<button type="button" id="lib-astro-mean" class="btn bpri">Mean</button></div>';
        document.body.appendChild(dlg);
      }
      const finish = (v) => { dlg.close(); res(v); };
      dlg.querySelector('#lib-astro-mean').onclick = () => finish('mean');
      dlg.querySelector('#lib-astro-median').onclick = () => finish('median');
      dlg.querySelector('#lib-astro-cancel').onclick = () => finish(null);
      dlg.onkeydown = (e) => { if (e.key === 'Escape') finish(null); };
      dlg.showModal();
    });
  }

  // ── ROADMAP R13 part 1 (collage) — a small FIXED set of grid templates, not a freeform
  // drag-and-arrange layout: R13 is the roadmap's lowest-priority "merge family" item, and a
  // full freeform layout editor (drag/resize/reorder tiles) is a materially bigger UI lift than
  // this item's place in the batch justifies. Cells are normalized [x,y,w,h] rects in a unit
  // square; `aspect` is the OUTPUT canvas's width/height. Each template is offered only when the
  // selection count matches its cell count exactly, plus an "Auto grid" that works for any n>=2.
  const COLLAGE_TEMPLATES = [
    { id: '2-h', label: '2-up (side by side)', n: 2, aspect: 2, cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    { id: '2-v', label: '2-up (stacked)', n: 2, aspect: 0.6667, cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
    { id: '3-h', label: '3-up (row)', n: 3, aspect: 2.4, cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
    { id: '3-big', label: '3-up (1 large + 2)', n: 3, aspect: 1.3333, cells: [[0, 0, 0.6667, 1], [0.6667, 0, 0.3333, 0.5], [0.6667, 0.5, 0.3333, 0.5]] },
    { id: '4-grid', label: '4-up (2x2 grid)', n: 4, aspect: 1, cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  ];
  function autoGridTemplate(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cells = [];
    for (let i = 0; i < n; i++) {
      const cx = i % cols, cy = Math.floor(i / cols);
      cells.push([cx / cols, cy / rows, 1 / cols, 1 / rows]);
    }
    return { id: 'auto', label: `Auto grid (${cols}x${rows})`, n, aspect: (cols / rows) || 1, cells };
  }
  function collageTemplateModal(n) {
    return new Promise((res) => {
      let dlg = document.getElementById('lib-collage-modal');
      if (dlg) dlg.remove(); // rebuild every time — the offered template list depends on `n`
      dlg = document.createElement('dialog');
      dlg.id = 'lib-collage-modal';
      dlg.style.cssText = 'border:1px solid var(--bdr);border-radius:10px;background:var(--bg);color:var(--txt);padding:16px;max-width:360px;width:90vw;font-family:var(--sans);box-shadow:var(--lift-2)';
      const exact = COLLAGE_TEMPLATES.filter((t) => t.n === n);
      const templates = [...exact, autoGridTemplate(n)];
      const btns = templates.map((t, i) => `<button type="button" data-i="${i}" class="btn bgh" style="display:block;width:100%;text-align:left;margin-bottom:6px">${t.label}</button>`).join('');
      dlg.innerHTML = `<div style="font-size:13px;margin-bottom:10px">Collage layout for ${n} photos:</div>`
        + `<div>${btns}</div>`
        + '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button type="button" id="lib-collage-cancel" class="btn bgh">Cancel</button></div>';
      document.body.appendChild(dlg);
      const finish = (v) => { dlg.close(); dlg.remove(); res(v); };
      dlg.querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => finish(templates[Number(b.dataset.i)]); });
      dlg.querySelector('#lib-collage-cancel').onclick = () => finish(null);
      dlg.onkeydown = (e) => { if (e.key === 'Escape') finish(null); };
      dlg.showModal();
    });
  }
  // Bytes -> base64 in chunks (a naive per-char `+=` loop over a multi-MB PNG is slow; a single
  // `String.fromCharCode(...bytes)` spread can blow the call stack on a large array).
  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(bin);
  }
  // Composites `paths` onto one canvas per `tpl` (cover-fit crop into each cell, matching the
  // familiar "collage app" behavior rather than letterboxing), writes the result as a plain PNG
  // next to the first source photo via the SAME `write_file_bytes` command exports already use,
  // at the SAME collision-safe naming convention `merge_output_path` gives HDR/focus/astro
  // outputs (`collage_output_path` on the Rust side just calls it with a "-collage" suffix). No
  // alignment, no Rust pixel math — this is pure canvas compositing of already-decoded photos.
  async function createCollage(paths) {
    const n = paths.length;
    const tpl = await collageTemplateModal(n);
    if (!tpl) return;
    toast(`Building collage from ${n} photos…`);
    try {
      const files = await readPathsAsFiles(paths);
      if (!files.length) { toast('Could not read any of the selected photos', 'err'); return; }
      const okPaths = files.okPaths || paths;
      const bitmaps = await Promise.all(files.map((f) => createImageBitmap(f)));
      const CW = 3200;
      const CH = Math.round(CW / tpl.aspect);
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
      const gap = Math.round(CW * 0.006);
      tpl.cells.forEach((cell, i) => {
        const bm = bitmaps[i % bitmaps.length];
        const [cx, cy, cw, ch] = cell;
        const px = Math.round(cx * CW) + gap / 2;
        const py = Math.round(cy * CH) + gap / 2;
        const pw = Math.max(1, Math.round(cw * CW) - gap);
        const ph = Math.max(1, Math.round(ch * CH) - gap);
        // Cover-fit: scale up to fill the cell, crop the overflow, centered.
        const scale = Math.max(pw / bm.width, ph / bm.height);
        const sw = pw / scale, sh = ph / scale;
        const sx = (bm.width - sw) / 2, sy = (bm.height - sh) / 2;
        ctx.drawImage(bm, sx, sy, sw, sh, px, py, pw, ph);
      });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('canvas.toBlob returned null');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const outPath = await invoke('collage_output_path', { firstSource: okPaths[0] });
      await invoke('write_file_bytes', { path: outPath, dataB64: bytesToBase64(bytes) });
      toast('Collage saved — added to library');
      refreshView();
      openInEditor(outPath);
    } catch (e) { toast(humanizeErr('create collage', e), 'err'); }
  }

  // Shared batch-open: reads paths, loads them into the editor, and registers each in Recents
  // (touch_recent) — batch opens used to skip this entirely, so an externally-opened or
  // multi-selected batch never showed up in the Recents smart collection.
  async function openPathsInEditor(paths) {
    const files = await readPathsAsFiles(paths);
    if (!files.length) return files;
    const okPaths = files.okPaths || paths; // fallback keeps old behavior if a caller-supplied files array skipped readPathsAsFiles
    state.openedPath = '';
    window.chromasmithSourcePath = null;
    state.openedPaths = okPaths;
    await loadFXImages(files);
    // Seed shared FX (LUT/grain/halation/curves/etc.) from the first photo's saved recipe —
    // same reasoning as the "Export N photos" path below: without this the shared sliders
    // stay at whatever stale state the app was in, and exporting straight from here (without
    // first touching any slider) would silently render every photo unedited.
    try {
      const firstSc = await getSidecar(okPaths[0]);
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
    // Only offered while actually looking at Needs review — elsewhere it's a confusing no-op
    // (dismissing a photo that was never flagged does nothing visible), and "blurry" itself
    // stays true either way; this only ever hides it from THIS specific review list.
    if (state.source === 'catalog' && state.catalogScope === 'blurry') {
      item(`Not blurry — dismiss${n > 1 ? ` (${n})` : ''}`, async () => {
        try {
          await invoke('catalog_dismiss_review', { paths });
          toast(`Dismissed ${n} photo${n > 1 ? 's' : ''} from Needs review`);
          refreshView();
        } catch (e) { toast(humanizeErr('dismiss from review', e), 'err'); }
      });
    }
    sep();
    item('Reveal in Finder', () => invoke('reveal_in_finder', { path: paths[0] }).catch((e) => console.error('reveal_in_finder', e)));
    // ── Get Info (Bug #2 fix): the Info panel (renderInfoPanel) was fully built and functional
    // but had no discoverable trigger anywhere in the UI — only an undiscoverable 'i'/'I' keydown
    // shortcut (itself duplicated, with a second copy gated on state.source==='lr' that never
    // fired for local photos) and a dead `window.__libInfo` nobody called. Right-click → Get Info
    // is the conventional macOS/Lightroom entry point. Targets the first (or only) selected
    // photo via `_kbCursor`, same as the keyboard shortcut, so the panel shows THIS photo rather
    // than whatever was focused before the right-click.
    item('Get Info', () => { state._kbCursor = paths[0]; window.__libInfo(true); });
    // ── HDR merge / focus stack (ROADMAP R12) — same "select several, run a batch action" UX
    // as Reset edit above. Both write an ordinary new PNG next to the first selected photo
    // (merge.rs's merge_output_path) and refresh the grid so it shows up as a normal library
    // photo, not a special file type. Dimmed (not hidden — §10.13's lesson: a permanently
    // hidden control is a permanently unaudited one) below 2 selected, since a merge needs at
    // least 2 source photos.
    const mergeHdrItem = item('Merge exposures (HDR)…', async () => {
      toast(`Merging ${n} exposures…`);
      try {
        const outPath = await invoke('merge_hdr_photos', { paths });
        toast('HDR merge saved — added to library');
        refreshView();
        openInEditor(outPath);
      } catch (e) { toast(humanizeErr('merge exposures', e), 'err'); }
    });
    const mergeFocusItem = item('Focus stack…', async () => {
      toast(`Stacking ${n} photos…`);
      try {
        const outPath = await invoke('merge_focus_photos', { paths });
        toast('Focus stack saved — added to library');
        refreshView();
        openInEditor(outPath);
      } catch (e) { toast(humanizeErr('focus stack', e), 'err'); }
    });
    // ── Astro stacking (ROADMAP R13 part 2) — same batch-action shape as HDR/focus above,
    // reusing merge.rs's translation-only aligner + a new per-pixel mean/median blend.
    const mergeAstroItem = item('Astro stack…', async () => {
      const mode = await astroStackModeModal();
      if (!mode) return;
      toast(`Stacking ${n} photos (${mode})…`);
      try {
        const outPath = await invoke('merge_astro_photos', { paths, mode });
        toast('Astro stack saved — added to library');
        refreshView();
        openInEditor(outPath);
      } catch (e) { toast(humanizeErr('astro stack', e), 'err'); }
    });
    // ── Panorama (ROADMAP R13 part 3) — SCOPED to exactly 2 photos (see merge.rs's `pano`
    // module doc for why: a real similarity-transform aligner, validated on a known synthetic
    // transform, but not full feature-matching stitching — 3+ photos would need pairwise
    // chaining this pass didn't build). Only enabled at exactly 2 selected, not just >=2.
    const mergePanoItem = item('Stitch panorama (2 photos)…', async () => {
      toast('Stitching panorama…');
      try {
        const outPath = await invoke('merge_panorama_photos', { paths });
        toast('Panorama saved — added to library');
        refreshView();
        openInEditor(outPath);
      } catch (e) { toast(humanizeErr('stitch panorama', e), 'err'); }
    });
    // ── Collage (ROADMAP R13 part 1) — pure client-side canvas compositing, no alignment.
    const collageItem = item('Create collage…', () => createCollage(paths));
    // ── Scoped face/CLIP analysis (N4) — the sidebar's People search icon
    // ("Analyze photos — find faces and enable AI search") always scans the WHOLE library,
    // which stalled for hours on a 49,802-photo library. This scopes the exact same
    // faces_run → embed_run → cluster_run → clip_embed_run chain (runFindFaces) to just the
    // selected photos. Valid for any n>=1 (the menu only opens with a selection), so — unlike
    // the merge/pano items above — there's nothing to dim.
    item(`Find faces in selection${n > 1 ? ` (${n})` : ''}`, async () => {
      // Paths → ids: state.entries already carries `.id` alongside `.path` for everything
      // currently shown in the grid (the same field catalog_query/expandStack/photoIds results
      // use elsewhere), so no new lookup command is needed — just match on path.
      const byPath = new Map(state.entries.map((e) => [e.path, e.id]));
      const ids = paths.map((p) => byPath.get(p)).filter((id) => id != null);
      if (!ids.length) { toast('Could not resolve the selected photos', 'err'); return; }
      await runFindFaces(ids);
    });
    if (n < 2) {
      mergeHdrItem.style.opacity = '.4'; mergeHdrItem.style.pointerEvents = 'none';
      mergeFocusItem.style.opacity = '.4'; mergeFocusItem.style.pointerEvents = 'none';
      mergeAstroItem.style.opacity = '.4'; mergeAstroItem.style.pointerEvents = 'none';
      collageItem.style.opacity = '.4'; collageItem.style.pointerEvents = 'none';
    }
    if (n !== 2) { mergePanoItem.style.opacity = '.4'; mergePanoItem.style.pointerEvents = 'none'; }
    sep();
    item(`Export ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
      const files = await readPathsAsFiles(paths);
      if (!files.length) return;
      // ⚠️ Use the paths that actually survived readPathsAsFiles, in the SAME order as `files`/
      // `fxImages` below — indexing the original (pre-filter) `paths` desyncs the moment any one
      // photo fails to read (a missing/locked file mid-selection), so photo A's saved crop/masks
      // land on photo B's render, or a batch export comes out empty/wrong. See readPathsAsFiles'
      // own comment.
      const okPaths = files.okPaths || paths;
      state.openedPath = '';
    window.chromasmithSourcePath = null;
      state.openedPaths = okPaths;
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
        const firstSc = await getSidecar(okPaths[0]);
        if (firstSc.recipe) {
          applyUISnapshot(snapshotFromB64(firstSc.recipe));
          if (typeof applyRawDefaults === 'function') applyRawDefaults();
        }
      } catch (e) { console.error('seed shared FX for batch export', e); }
      // Restore each photo's own saved CROP/MASKS/independent-ADJUST before exporting (all
      // three are per-photo — see chromasmith-22.html's geomApplyToAll/mskCopyToAll/
      // adjToggleScope).
      for (let i = 0; i < okPaths.length; i++) {
        const sc = await getSidecar(okPaths[i]);
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
    const resetItem = item('Reset edit', async () => {
      // Undoable now (see undoResetItem below), but only ONE level and only until the next real
      // edit or the next reset overwrites the buffer — confirm anyway, matching the in-editor
      // "Reset all" (fxResetAll) which already does. This context-menu path could still wipe
      // edits on several selected photos at once with a single misclick, and closing the app
      // between now and using the undo item is fine (the buffer lives in the .xmp sidecar, not
      // in-memory) but forgetting about it is still a real way to lose the edit for good.
      // confirmModal, never window.confirm — see its own comment in chromasmith-22.html: an
      // unimplemented WKUIDelegate confirm panel makes window.confirm() return false with NO
      // dialog shown, so this ALWAYS took the early return in the packaged desktop app — "Reset
      // edit" from the Library context menu silently did nothing, every time.
      const label = n > 1 ? `${n} photos` : 'this photo';
      if (!await window.confirmModal(`Reset edit${n > 1 ? 's' : ''} on ${label}? You can undo this from the same menu, until the next edit or reset.`, 'Reset')) return;
      // reset_edit (library.rs) captures the discarded recipe/edited state into the sidecar's
      // own one-slot undo buffer and clears the active recipe in ONE atomic read-modify-write —
      // it replaces the old direct set_sidecar(...,edited:false,recipe:'') call, which had no
      // way to remember what it just threw away.
      await Promise.all(paths.map(async (p) => {
        const cur = await getSidecar(p);
        try {
          const updated = await invoke('reset_edit', { path: p });
          state.sidecars.set(p, updated);
        } catch (e) { sidecarWriteFailed(p, cur, e); return; }
        const card = grid && grid.querySelector(`.lib-card[data-path="${CSS.escape(p)}"]`);
        const badge = card && card.querySelector('.lib-edited-badge');
        if (badge) badge.remove();
        if (p === state.openedPath) { openInEditor(p); } // re-open to fall back to RAW defaults
      }));
      toast(n > 1 ? `Reset ${n} photos — Undo last reset is in this menu` : 'Reset edit — Undo last reset is in this menu');
    });
    if (!paths.some((p) => (state.sidecars.get(p) || {}).edited)) { resetItem.style.opacity = '.4'; resetItem.style.pointerEvents = 'none'; }
    // ── Undo last reset: a plain context-menu item (not a toast action — toast() is a shared,
    // action-less pill used everywhere in the app, and giving it buttons for one caller would
    // change its behavior for all of them) mirroring resetItem's own conditional-dimming pattern
    // just above. Enabled only when at least one selected photo actually has a pending buffer —
    // `last_reset_recipe` on its sidecar — and restores each photo INDEPENDENTLY (a multi-photo
    // reset can be partially undone: reset 3, then export 1, then undo the other 2).
    const undoResetItem = item('Undo last reset', async () => {
      const restorable = paths.filter((p) => (state.sidecars.get(p) || {}).last_reset_recipe);
      await Promise.all(restorable.map(async (p) => {
        const cur = await getSidecar(p);
        let updated;
        try {
          updated = await invoke('undo_reset_edit', { path: p });
          state.sidecars.set(p, updated);
        } catch (e) { sidecarWriteFailed(p, cur, e); return; }
        if (updated.edited) markCardEdited(p);
        if (p === state.openedPath) { openInEditor(p); }
      }));
      toast(restorable.length > 1 ? `Restored ${restorable.length} photos' edits` : 'Restored the edit');
    });
    if (!paths.some((p) => (state.sidecars.get(p) || {}).last_reset_recipe)) {
      undoResetItem.style.opacity = '.4';
      undoResetItem.style.pointerEvents = 'none';
    }
    sep();
    // ── Virtual copies: a second set of edits over the SAME file (no pixels duplicated).
    // Single selection only — "make a virtual copy of these 40 photos" is a different feature
    // with a different confirmation, and quietly doing it to a whole selection is not it.
    if (n === 1) {
      const vcPath = paths[0];
      const vsc = state.sidecars.get(vcPath) || {};
      const vers = vsc.versions || [];
      item(vers.length ? `New virtual copy… (${vers.length} versions)` : 'New virtual copy…', async () => {
        // askTextModal (a global from chromasmith-22.html), never window.prompt: prompt() is a
        // silent no-op under the Tauri/WKWebView shell — and this file ONLY runs there, so the
        // row appeared to do nothing at all. Fall back to prompt() only if the host page somehow
        // predates the helper, which is strictly better than throwing.
        const ask = window.askTextModal
          ? window.askTextModal('Name this version', '', vers.length ? `Copy ${vers.length}` : 'Copy 1')
          : Promise.resolve(window.prompt('Name this version', vers.length ? `Copy ${vers.length}` : 'Copy 1'));
        const name = await ask;
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
          // confirmModal, never window.confirm — see the "Reset edit" comment above.
          if (!await window.confirmModal(`Delete version "${v.name}"? This cannot be undone.`, 'Delete')) return;
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
      await refreshView();
    });
    // Was prefixed with a 🗑️ emoji — every other row in this same menu (Reject, Pick, Edit,
    // Duplicate) is plain text, and CLAUDE.md §3b is explicit: no emoji in desktop chrome, they
    // render per-platform and never match this menu's own stroke-icon language.
    item(`Delete ${n > 1 ? n + ' photos' : ''}`.trim(), async () => {
      const label = n > 1 ? `these ${n} photos` : `"${baseName(paths[0])}"`;
      // confirmModal, never window.confirm — see the "Reset edit" comment above. This one is the
      // sharpest case: it silently returning false meant "Move to Trash" from the Library
      // context menu did not just fail to ask — it never moved a single photo, ever.
      if (!await window.confirmModal(`Move ${label} to the Trash?`, 'Move to Trash')) return;
      const trashed = [];
      for (const p of paths) {
        try {
          await invoke('trash_file', { path: p });
          state.sidecars.delete(p); state.meta.delete(p); imgCache.delete(p);
          trashed.push(p);
        }
        catch (e) { console.error('trash_file', p, e); toast('Could not delete ' + baseName(p)); }
      }
      // Best-effort, and only for what actually made it to Trash — a catalog row lagging behind
      // by one scan is harmless; trashing a file that's still shown as present is what actually
      // confuses a user. Never blocks on this: the real, recoverable action already happened.
      if (trashed.length) invoke('catalog_note_deleted', { paths: trashed }).catch((e) => console.error('catalog_note_deleted', e));
      state.selected.clear();
      await refreshView();
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
    // e.target===wrap means the click landed on the empty background AROUND the photo, not the
    // photo itself — chromasmith-22.html's own contextmenu handler on #fx-wrap owns that case now
    // (a background-color picker), so defer to it instead of covering the background with this
    // photo-edit menu too.
    if (wrap) wrap.addEventListener('contextmenu', (e) => {
      if (!state.openedPath || e.target === wrap) return;
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
    // Item 31: aspect-ratio thumbnails only below VIRT_MIN — virtualization's row/col windowing
    // (virtMetrics) assumes a uniform CSS grid, which the flex-wrap ragged-right layout is not.
    grid.classList.toggle('aspect-view', state.gridAspect && !isList && !virtOn);
    const aspectBtn = document.getElementById('lib-aspect-toggle');
    if (aspectBtn) {
      aspectBtn.classList.toggle('on', state.gridAspect);
      const tooLarge = state.gridAspect && virtOn && !isList;
      aspectBtn.classList.toggle('disabled-note', tooLarge);
      if (tooLarge) aspectBtn.title = `Real-aspect thumbnails are on, but this folder (${shown.length} photos) is over the 400-photo virtualized-grid threshold — showing square crops here instead.`;
    }
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
        (sc.label ? ' lbl-' + sc.label.toLowerCase() : '') + (entry.missing ? ' lib-missing' : '');
      card.dataset.path = entry.path;
      // Stack badge takes over the RAW badge's own top-left corner when this card represents
      // a stack (per the plan: "the grid draws a +2 badge in the existing .lib-raw-badge corner
      // slot") — a stack's leader is virtually always the RAW, so showing both would be
      // redundant, and there is no other free corner (Edited/Dupe/Synced already own the rest).
      const isExpandedStackForRaw = entry.stack_n > 1 && state._expandedStacks.has(entry.id);
      const rawBadge = entry.stack_n > 1
        ? `<div class="lib-raw-badge lib-stack-badge" data-stack-toggle="${entry.id}" title="${entry.stack_n} in this stack — click to ${isExpandedStackForRaw ? 'collapse' : 'expand'}">${isExpandedStackForRaw ? '⌃' : '+' + (entry.stack_n - 1)}</div>`
        : entry.kind === 'raw' ? `<div class="lib-raw-badge" title="RAW file">R</div>` : '';
      // The duration comes from state.meta (read_meta's container parse in Rust), NOT from
      // decoding the clip — so the badge is right even for one AVFoundation can't produce a
      // poster for, and it no longer has to wait on a decode to appear.
      const videoDur = entry.is_video ? fmtDuration((state.meta.get(entry.path) || {}).dur) : '';
      const videoBadge = entry.is_video
        ? `<div class="lib-video-badge" title="Video clip">${ic('video',10)}${videoDur ? `<span>${videoDur}</span>` : ''}</div>`
        : '';
      const dupeClusterId = state.dupeClusters.get(entry.path);
      const dupeSize = dupeClusterId ? state.dupeClusterSizes.get(dupeClusterId) : 0;
      const dupeBadge = dupeSize > 1
        ? `<div class="lib-dupe-badge" title="${dupeSize} similar photos (a RAW and its JPEG sibling clustering together is expected)">⧉${dupeSize}</div>`
        : '';
      const syncedBadge = state.syncedPaths.has(entry.path) ? `<div class="lib-synced-badge" title="Synced to Google Photos">☁</div>` : '';
      const offlineBadge = entry.offline ? OFFLINE_BADGE_HTML : '';
      if (isList) {
        const m = state.meta.get(entry.path) || {};
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        card.innerHTML = `<div class="lib-thumb-wrap${entry.is_video ? ' lib-thumb-video' : ''}"><img loading="lazy" alt=""></div>
          <div class="lib-name">${esc(entry.name)}${entry.missing ? ' (missing)' : ''}${sc.edited ? EDITED_BADGE_HTML : ''}${rawBadge}${videoBadge}${dupeBadge}${syncedBadge}${offlineBadge}</div>
          <div class="lib-col">${esc(m.date)}</div>
          <div class="lib-col">${esc(fmtEditedTs(entry.edited_ts))}</div>
          <div class="lib-col">${esc(m.camera)}</div>
          <div class="lib-col">${m.iso ? esc(m.iso) : ''}</div>
          <div class="lib-col">${esc(m.shutter)}</div>
          <div class="lib-col">${esc(m.aperture)}</div>
          <div class="lib-col">${esc(m.focal_len)}</div>
          <div class="lib-flags">${flagsHtml(sc.label, sc.favorite)}</div>${starsHtml(sc.rating)}
          <div class="lib-col">${sc.edited ? 'Yes' : ''}</div>`;
      } else {
        const stripFlag = sc.label === 'Red' ? `<span class="lib-strip-flag" style="background:#e05252"></span>`
          : sc.label === 'Green' ? `<span class="lib-strip-flag" style="background:#5cb85c"></span>` : '';
        const escName = String(entry.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const stripInfo = `<div class="lib-strip-info"><span class="lib-strip-name">${escName}</span>${stripFlag}</div>`;
        card.innerHTML = `<div class="lib-thumb-wrap${entry.is_video ? ' lib-thumb-video' : ''}"><img loading="lazy" alt="">${metaStripHtml(entry)}
            <div class="lib-flags">${flagsHtml(sc.label, sc.favorite)}</div>${starsHtml(sc.rating)}
          </div>
          ${sc.edited ? EDITED_BADGE_HTML : ''}
          ${rawBadge}
          ${videoBadge}
          ${dupeBadge}
          ${syncedBadge}
          ${offlineBadge}
          ${state.showTitle ? `<div class="lib-name">${entry.name}${entry.missing ? ' (missing)' : ''}</div>` : ''}
          ${stripInfo}`;
      }
      frag.appendChild(card);
      built.push({ entry, card, idx });
    });
    grid.appendChild(frag);
    // Second pass: every card is now connected, so loadThumb()'s isConnected check (see its
    // comment) sees it correctly instead of silently dropping the job.
    built.forEach(({ entry, card, idx }) => {
      const img = card.querySelector('img');
      // Video is an ORDINARY thumbnail job now — get_thumbnail generates its poster natively via
      // AVFoundation (see videothumb.rs), so it needs no special path here and gets the same disk
      // cache every photo does.
      // A stack card shows its newest EXPORT (thumb_path) even though `entry.path`/click target
      // stay the RAW leader — the plan's explicit split between "what you look at" and "what
      // opening/editing/rating acts on".
      loadThumb(entry.thumb_path || entry.path, img, entry.is_video, entry.mtime);
      card.querySelector('.lib-thumb-wrap').onclick = (e) => handleCardClick(e, entry, idx, shown);
      card.querySelector('.lib-thumb-wrap').ondblclick = (e) => { e.stopPropagation(); handleCardDblClick(e, entry); };
      const stackBadgeEl = card.querySelector('.lib-stack-badge');
      if (stackBadgeEl) stackBadgeEl.onclick = (e) => { e.stopPropagation(); toggleStackExpanded(entry.id); };
      const starRow = card.querySelector('.lib-stars');
      if (starRow) starRow.onclick = (e) => {
        const st = e.target.closest('.lib-star');
        if (!st) return;
        e.stopPropagation();
        const want = parseInt(st.dataset.star, 10);
        const cur = (state.sidecars.get(entry.path) || {}).rating || 0;
        // Clicking the star you are already on clears the rating — otherwise 1 star is a trap
        // you can never get out of with the mouse.
        setRating(entry.path, want === cur ? 0 : want);
      };
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

  /// A metadata panel for the focused photo. The list view already exposes EXIF as columns, but
  /// the GRID had no way to see any of it without opening the editor — and the grid is where
  /// culling happens, which is exactly when "what lens was this" gets asked.
  ///
  /// Reuses getMeta's cache, so opening the panel costs nothing on a photo the grid has already
  /// described; the sidecar (rating/label/edited) comes from state.sidecars for the same reason.
  function renderInfoPanel() {
    // Falls back to the first of a multi-selection rather than showing nothing: with several
    // photos selected the panel still has a sensible subject (the same "active photo" idea
    // Lightroom uses), and blanking the panel the moment a second photo is picked reads as a bug.
    const path = state._kbCursor || state.openedPath
      || (state.selected.size ? [...state.selected][0] : null);
    let el = document.getElementById('lib-info');
    // Bug #2: invoking Get Info with nothing selected/focused used to silently do nothing —
    // no panel, no feedback, indistinguishable from the trigger being broken. Toast instead.
    if (state.showInfo && !path) { toast('Select a photo first to see its info'); state.showInfo = false; }
    if (!state.showInfo || !path) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'lib-info';
      // --glass-bg + --lift-2, matching every other floating surface (#fx-overflow-menu, the
      // context menus, the toast). `var(--pan,#1c1c1e)` was a phantom token, so this panel was
      // pinned to a hardcoded near-black that no theme could reach.
      el.style.cssText = 'position:absolute;right:12px;top:56px;width:232px;z-index:38;padding:10px 12px;'
        + 'border-radius:10px;background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);'
        + 'backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);'
        + 'box-shadow:var(--lift-2);font-size:11px;line-height:1.55';
      (document.getElementById('lib-main') || document.body).appendChild(el);
    }
    const entry = (state.entries || []).find((e) => e.path === path) || {};
    const m = state.meta.get(path) || {};
    const sc = state.sidecars.get(path) || {};
    if (!state.meta.has(path)) getMeta(path).then(() => { if (state.showInfo) renderInfoPanel(); }).catch(() => {});
    // Bug #3 fix: the Keywords chips read state.sidecars, but unlike meta above, nothing ever
    // fetched it here — a photo whose sidecar hadn't already been prefetched by the grid's batch
    // scan (e.g. focused via keyboard cursor ahead of the grid's own virtualized batch, or a
    // freshly-opened folder) rendered a permanently-empty Keywords box with no fetch and no
    // re-render, indistinguishable from "this photo genuinely has no keywords".
    if (!state.sidecars.has(path)) getSidecar(path).then(() => { if (state.showInfo) renderInfoPanel(); }).catch(() => {});
    const fmt = (b) => !b ? '' : b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
    const row = (k, v) => v ? `<div style="display:flex;gap:8px"><span style="color:var(--mut);min-width:74px">${k}</span><span style="flex:1;word-break:break-word">${esc(String(v))}</span></div>` : '';
    const kwChips = (sc.keywords || []).map((k) => {
      const leaf = k.split('|').pop();
      return `<span class="lib-kw-chip" data-kw="${esc(k)}" title="${esc(k)}">${esc(leaf)}<span class="lib-kw-chip-x" data-kw-remove="${esc(k)}">×</span></span>`;
    }).join('');
    // R10: zero-shot CLIP tag suggestions. Cached by photo id (same "fetch once, re-render from
    // cache" idea getMeta's path-keyed Map already uses above) so re-rendering the panel — e.g.
    // right after a keyword is added — never costs a second round trip. A photo not yet
    // CLIP-analyzed comes back an empty array (not an error, see catalog_clip_tags), which is
    // indistinguishable here from "no cache entry yet" only until the fetch below resolves.
    const kwSet = new Set(sc.keywords || []);
    let suggestChips = '';
    if (entry.id != null) {
      if (!state.clipTags.has(entry.id)) {
        state.clipTags.set(entry.id, []); // placeholder so we don't refetch while the real request is in flight
        invoke('catalog_clip_tags', { photoId: entry.id })
          .then((hits) => { state.clipTags.set(entry.id, hits || []); if (state.showInfo) renderInfoPanel(); })
          .catch(() => {});
      } else {
        const suggestions = (state.clipTags.get(entry.id) || []).filter((h) => !kwSet.has(h.term));
        if (suggestions.length) {
          suggestChips = `<div style="margin-top:8px"><div style="color:var(--mut);margin-bottom:4px">Suggested</div>`
            + `<div id="lib-info-suggest-chips" style="display:flex;flex-wrap:wrap;gap:4px">`
            + suggestions.map((h) => `<span class="lib-kw-suggest-chip" data-suggest="${esc(h.term)}" title="${Math.round(h.score * 100)}% match">`
              + `${esc(h.term)}<span class="lib-kw-suggest-chip-add">+</span></span>`).join('')
            + `</div></div>`;
        }
      }
    }
    // Autocomplete against every keyword path already known to the catalog — best-effort
    // (keywordTree only refreshes on the same cadence as the rest of the catalog, i.e. on
    // scan/folder-open, matching how ratings/labels already lag one scan behind a foreign
    // edit elsewhere in this app; see the plan's own "Authority: the .xmp always wins" section).
    const kwOptions = keywordTree.map((n) => `<option value="${esc(n.path)}">`).join('');
    el.innerHTML = `<div style="font-weight:600;margin-bottom:6px;word-break:break-all">${esc(entry.name || baseName(path))}</div>`
      + row('Date', m.date) + row('Camera', m.camera) + row('Lens', m.lens)
      + row('ISO', m.iso) + row('Shutter', m.shutter) + row('Aperture', m.aperture)
      + row('Focal', m.focal_len) + row('Size', fmt(entry.size))
      + row('Label', sc.label) + row('Edited', sc.edited ? 'Yes' : '')
      + `<div style="margin-top:8px"><div style="color:var(--mut);margin-bottom:4px">Keywords</div>`
      + `<div id="lib-info-kw-chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px">${kwChips}</div>`
      + `<input id="lib-info-kw-add" list="lib-kw-datalist" placeholder="Add keyword…" `
      + `style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 6px;border-radius:5px;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt)">`
      + `<datalist id="lib-kw-datalist">${kwOptions}</datalist></div>`
      + suggestChips
      + `<div style="margin-top:8px;text-align:right"><button class="lib-btn" id="lib-info-close">Close</button></div>`;
    const c = document.getElementById('lib-info-close');
    if (c) c.onclick = () => { state.showInfo = false; renderInfoPanel(); };
    el.querySelectorAll('[data-kw-remove]').forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); removeKeywordFromPhoto(path, x.dataset.kwRemove); };
    });
    el.querySelectorAll('[data-suggest]').forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); addKeywordToPhoto(path, x.dataset.suggest); };
    });
    const addInput = document.getElementById('lib-info-kw-add');
    if (addInput) {
      addInput.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.stopPropagation();
        const v = addInput.value.trim();
        if (v) addKeywordToPhoto(path, v);
        addInput.value = '';
      };
      // A photo grid keydown handler (space/arrows/delete) lives above the panel and would
      // otherwise steal every keystroke typed here — the star-rating / flag shortcuts firing
      // while typing a tag name is exactly the kind of bug that's invisible until you hit it.
      addInput.onkeyup = (e) => e.stopPropagation();
    }
  }

  // The Info panel shows one photo's chips (the focused/first-of-selection one — see
  // renderInfoPanel's own comment), but editing keywords from it should act on the WHOLE
  // selection, matching the keyword-tree drag-and-drop path below which already does this via
  // Promise.all. Without this, typing a tag with 5 photos selected silently tagged only 1.
  function infoPanelTargetPaths(path) {
    return (state.selected.size > 1 && state.selected.has(path)) ? [...state.selected] : [path];
  }

  /// Full hierarchical paths this photo carries, tagged via the info panel or drag-to-tag. The
  /// merge (existing + new, deduped) happens here rather than in the caller so both entry
  /// points share one rule.
  async function addKeywordToPhoto(path, keyword) {
    const paths = infoPanelTargetPaths(path);
    await Promise.all(paths.map(async (p) => {
      const sc = state.sidecars.get(p) || { keywords: [] };
      const current = sc.keywords || [];
      if (current.includes(keyword)) return;
      const next = [...current, keyword];
      try {
        await invoke('set_keywords', { path: p, keywords: next });
        state.sidecars.set(p, { ...sc, keywords: next });
      } catch (e) { toast(humanizeErr('tag the photo', e), 'err'); }
    }));
    if (paths.length > 1) toast(`Tagged ${paths.length} photos "${keyword}"`);
    renderInfoPanel();
  }
  async function removeKeywordFromPhoto(path, keyword) {
    const paths = infoPanelTargetPaths(path);
    await Promise.all(paths.map(async (p) => {
      const sc = state.sidecars.get(p) || { keywords: [] };
      const next = (sc.keywords || []).filter((k) => k !== keyword);
      try {
        await invoke('set_keywords', { path: p, keywords: next });
        state.sidecars.set(p, { ...sc, keywords: next });
      } catch (e) { toast(humanizeErr('remove the tag', e), 'err'); }
    }));
    renderInfoPanel();
  }

  /// Operations that only make sense on a multi-selection, surfaced as a bar rather than living
  /// exclusively in a right-click menu — the context menu is fine when you know it is there, and
  /// invisible when you do not. Shown only when more than one photo is selected, so it costs a
  /// single-photo workflow nothing.
  function renderBatchBar() {
    let bar = document.getElementById('lib-batchbar');
    const n = state.selected.size;
    if (n < 2) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'lib-batchbar';
      bar.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:14px;z-index:40;'
        + 'display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:10px;'
        + 'background:var(--glass-bg);-webkit-backdrop-filter:blur(20px) saturate(1.4);'
        + 'backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--bdr);box-shadow:var(--lift-2)';
      (document.getElementById('lib-main') || document.body).appendChild(bar);
    }
    const paths = () => Array.from(state.selected);
    bar.innerHTML = `<span style="font-size:11px;color:var(--mut)">${n} selected</span>`
      + `<span style="width:1px;height:16px;background:var(--bdr)"></span>`
      + `<button class="lib-btn" data-act="reject">Reject</button>`
      + `<button class="lib-btn" data-act="pick">Pick</button>`
      + `<button class="lib-btn" data-act="clear-label">Clear flag</button>`
      + `<button class="lib-btn" data-act="fav">Favorite</button>`
      + `<button class="lib-btn" data-act="deselect">Deselect</button>`;
    bar.querySelector('[data-act="reject"]').onclick = () => paths().forEach((p) => setLabel(p, 'Red'));
    bar.querySelector('[data-act="pick"]').onclick = () => paths().forEach((p) => setLabel(p, 'Green'));
    bar.querySelector('[data-act="clear-label"]').onclick = () => paths().forEach((p) => setLabel(p, ''));
    bar.querySelector('[data-act="fav"]').onclick = () => paths().forEach((p) => setFavorite(p, true));
    bar.querySelector('[data-act="deselect"]').onclick = () => { state.selected.clear(); renderGrid(); };
  }

  /// A real status bar rather than two loose spans: what the current filter is actually showing,
  /// how it breaks down by Reject/Pick/Favorite, and what the selection weighs. The tallies are
  /// the point — when culling, "how many did I flag" is the question the grid cannot answer at a
  /// glance once a folder is bigger than a screen.
  function renderStatusBar(shown) {
    const lblEl = document.getElementById('lib-status-labels');
    const sizeEl = document.getElementById('lib-status-size');
    const selEl = document.getElementById('lib-status-sel');
    if (!lblEl) return;
    let rejected = 0, picked = 0, favorited = 0, bytes = 0;
    for (const e of shown) {
      bytes += e.size || 0;
      const sc = state.sidecars.get(e.path);
      if (!sc) continue;
      if (sc.label === 'Red') rejected++;
      else if (sc.label === 'Green') picked++;
      if (sc.favorite) favorited++;
    }
    const dot = (css) => `<span style="width:8px;height:8px;border-radius:50%;background:${css};display:inline-block"></span>`;
    lblEl.innerHTML = [
      rejected ? `<span style="display:inline-flex;align-items:center;gap:3px">${dot('#e05252')}${rejected}</span>` : '',
      picked ? `<span style="display:inline-flex;align-items:center;gap:3px">${dot('#5cb85c')}${picked}</span>` : '',
      favorited ? `<span style="display:inline-flex;align-items:center;gap:3px">${dot('#e0c04a')}${favorited}</span>` : '',
    ].filter(Boolean).join('');
    const fmt = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB';
    sizeEl.textContent = shown.length ? fmt(bytes) : '';
    if (state.selected.size) {
      let sel = 0;
      for (const e of shown) if (state.selected.has(e.path)) sel += e.size || 0;
      selEl.textContent = `${state.selected.size} selected · ${fmt(sel)}`;
    } else selEl.textContent = '';
  }

  /// Everything renderGrid did AFTER the cards: empty states, counts, selection chrome.
  function renderGridTail(shown) {
    renderStatusBar(shown);
    renderBatchBar();
    renderInfoPanel();
    const grid = document.getElementById('lib-grid');
    if (!shown.length && state.entries.length) {
      // Only the richer "nothing matches" message when a filter/search actually hid photos —
      // an empty FOLDER (state.entries.length === 0) gets its own message below instead.
      grid.innerHTML = '<div id="lib-empty">No photos match the current filters.<br>'
        + '<a id="lib-empty-clear" style="color:var(--acc);cursor:pointer;text-decoration:underline">Clear filters</a></div>';
      const clearLink = document.getElementById('lib-empty-clear');
      if (clearLink) clearLink.onclick = () => clearAllLibFilters();
    } else if (!shown.length) {
      // An empty folder is a dead end without a way out of it. The two things that actually fill
      // one are a card and a folder, so offer both rather than just stating the fact.
      grid.innerHTML = '<div id="lib-empty">No photos in this folder.'
        + '<div style="margin-top:14px;display:flex;gap:8px;justify-content:center">'
        + '<button class="lib-btn" id="lib-empty-import">Import from card…</button>'
        + '<button class="lib-btn" id="lib-empty-open">Choose another folder…</button>'
        + '</div></div>';
      const impBtn = document.getElementById('lib-empty-import');
      if (impBtn) impBtn.onclick = () => {
        // Jump to the Devices section if a card is already mounted, otherwise say why not.
        const dev = document.querySelector('.lib-card-row[data-card]');
        if (dev) { dev.click(); dev.scrollIntoView({ block: 'nearest' }); }
        else toast('No camera card detected — insert one and it appears under Devices');
      };
      const openBtn = document.getElementById('lib-empty-open');
      if (openBtn) openBtn.onclick = () => { const b = document.getElementById('lib-pick'); if (b) b.click(); };
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
    // Which pane flags/labels apply to. B by default because that is the pane the arrows cycle:
    // Compare is "hold A, judge candidates in B", so the candidate is what you are rating.
    focus: 'B',
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
          <div class="lib-flag" data-pane="${which}" data-flag="Red" title="Reject">${ic('close', 12)}</div>
          <div class="lib-flag" data-pane="${which}" data-flag="Favorite" title="Favorite">${ic('heart',15)}</div>
          <span style="margin-left:auto;color:var(--mut);font-size:10px" class="lib-cmp-name" data-pane="${which}"></span>
        </div>
      </div>`;
    host.innerHTML = `
      <div id="lib-compare-bar">
        <span>Compare — ←/→ cycles the right pane · ⏎ promotes it · X/P/U and color keys flag · Tab swaps pane · Esc exits</span>
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
  /// Applies a label from Compare and repaints just the affected pane's flag row. Routed through
  /// the grid's own setLabel so the sidecar write, the cache update and the grid's later repaint
  /// all stay in one place — a second writer here is how the two views drift apart, which is the
  /// defect ROADMAP 14 describes.
  async function compareApplyLabel(path, label) {
    await setLabel(path, label);
    ['A', 'B'].forEach((w) => {
      if (comparePathForIdx(compareState[w === 'A' ? 'paneA' : 'paneB'].idx) === path) renderComparePane(w);
    });
    compareSyncFocus();
  }
  /// Marks which pane the keyboard is acting on. Without a visible marker, Tab silently changes
  /// what X does — the kind of hidden mode that makes a culling shortcut untrustworthy.
  function compareSyncFocus() {
    const host = document.getElementById('lib-compare');
    if (!host) return;
    host.querySelectorAll('.lib-cmp-pane').forEach((el) => {
      el.classList.toggle('cmp-focus', el.dataset.pane === compareState.focus);
    });
    const bar = document.getElementById('lib-compare-bar');
    if (bar) {
      const t = bar.querySelector('.cmp-focus-note') || (() => {
        const sp = document.createElement('span'); sp.className = 'cmp-focus-note';
        sp.style.cssText = 'margin-left:auto;color:var(--acc)'; bar.appendChild(sp); return sp;
      })();
      t.textContent = `X/P/U → pane ${compareState.focus} (Tab swaps)`;
    }
  }

  // ── ROADMAP 12: saved filter/sort views ─────────────────────────────────────────────────
  // A named snapshot of the filter bar plus the sort. Not a smart collection: a collection asks
  // "which photos", a view asks "how am I looking at this folder" — so this deliberately does NOT
  // capture the folder, and applying one leaves you where you are.
  const LS_VIEWS = 'chromasmith_lib_views';
  // Exactly the fields the filter popover and the sort control own. Listed explicitly rather than
  // cloned from `state`, so a future unrelated state field can never silently become part of a
  // saved view (and so an old saved view stays readable when one is added).
  const VIEW_FIELDS = ['typeFilter','cameraFilter','lensFilter','isoFilter','dupeFilter',
                       'syncedFilter','tagFilter','ratingFilter','search','sortBy','sortDir',
                       'viewMode','thumbSize'];
  function loadViews() {
    try { const v = JSON.parse(localStorage.getItem(LS_VIEWS) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  function saveViews(v) { try { localStorage.setItem(LS_VIEWS, JSON.stringify(v)); } catch {} }
  function captureView() {
    const out = {};
    VIEW_FIELDS.forEach((k) => { if (state[k] !== undefined) out[k] = state[k]; });
    return out;
  }
  function applyView(v) {
    if (!v || !v.fields) return;
    VIEW_FIELDS.forEach((k) => { if (v.fields[k] !== undefined) state[k] = v.fields[k]; });
    // Persist the two that have their own localStorage keys, so a view survives a reload the same
    // way manually setting them would.
    try {
      localStorage.setItem('chromasmith_lib_sort', state.sortBy);
      localStorage.setItem('chromasmith_lib_sortdir', state.sortDir);
      localStorage.setItem('chromasmith_lib_view', state.viewMode);
      localStorage.setItem('chromasmith_lib_thumbsize', String(state.thumbSize));
    } catch {}
    syncFilterControls();
    renderGrid();
    renderViewsMenu();
    if (typeof toast === 'function') toast(`View: ${v.name}`, true);
  }
  /// Pushes the restored values back into the actual <select>s, or the popover would keep showing
  /// the previous view's settings while the grid showed the new one.
  function syncFilterControls() {
    // ⚠️ These ids all end in "-filter"; an earlier version of this map omitted that suffix on
    // every entry except lib-sort, so getElementById returned null for seven of the eight and
    // applying a saved view left every dropdown showing the PREVIOUS view's settings while the
    // grid showed the new one — the exact failure this function's comment promises to prevent.
    const map = { 'lib-type-filter': 'typeFilter', 'lib-camera-filter': 'cameraFilter',
                  'lib-lens-filter': 'lensFilter', 'lib-iso-filter': 'isoFilter',
                  'lib-dupe-filter': 'dupeFilter', 'lib-synced-filter': 'syncedFilter',
                  'lib-tag-filter': 'tagFilter', 'lib-rating-filter': 'ratingFilter',
                  'lib-sort': 'sortBy' };
    Object.entries(map).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el && state[key] !== undefined) el.value = state[key];
    });
    const se = document.getElementById('lib-search');
    if (se) se.value = state.search || '';
    if (typeof updateFilterChips === 'function') updateFilterChips();
  }
  function renderViewsMenu() {
    const sel = document.getElementById('lib-views');
    if (!sel) return;
    const views = loadViews();
    sel.innerHTML = '<option value="">Views…</option>'
      + views.map((v, i) => `<option value="${i}">${String(v.name).replace(/</g,'&lt;')}</option>`).join('')
      // <option> text is always plain text — no element can be injected here, so these two stay
      // words rather than icons. U+FF0B FULLWIDTH PLUS -> a plain "+"; the ✕ was redundant next
      // to "Delete" and is dropped rather than swapped for another glyph.
      + '<option value="__save">+ Save current…</option>'
      + (views.length ? '<option value="__del">Delete a view…</option>' : '');
    sel.value = '';
  }
  async function onViewsChange(e) {
    const v = e.target.value;
    const views = loadViews();
    // askTextModal, never window.prompt — same silent-no-op-under-WKWebView bug as the version
    // rename above; found by grepping for the pattern after fixing that one.
    if (v === '__save') {
      const name = await window.askTextModal('Name this view', 'Filters + sort, not the folder', '');
      if (name && name.trim()) { views.push({ name: name.trim(), fields: captureView() }); saveViews(views); }
      renderViewsMenu();
      return;
    }
    if (v === '__del') {
      const name = await window.askTextModal('Delete which view?', views.map((x) => '· ' + x.name).join('\n'), '');
      if (name) { saveViews(views.filter((x) => x.name !== name.trim())); }
      renderViewsMenu();
      return;
    }
    if (v !== '') applyView(views[parseInt(v, 10)]);
    renderViewsMenu();
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
  // Bug #2 fix: discoverable Info-panel trigger — window.__libInfo(true) already existed and
  // worked, it just had no button anywhere pointing at it. Uses the same _kbCursor/openedPath/
  // selected fallback renderInfoPanel already reads, so no new "what's the target" logic needed.
  overlay.querySelector('#lib-info-btn').onclick = () => window.__libInfo(true);
  function toggleExpandedView(force) {
    state.expanded_view = force !== undefined ? force : !state.expanded_view;
    overlay.classList.toggle('full', state.expanded_view);
    document.body.classList.toggle('lib-full', state.expanded_view);
    syncDockPadding();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  window.chromasmithToggleExpandedView = () => { if (state.open) toggleExpandedView(); }; // menu-bar "Toggle Full Library" — no-op if the Library isn't even open

  // ⚠️ Boot-time safety valve (chromasmith-22.html's bumpBootSplashWatchdog) — the reported "blank
  // editor on launch" bug. The normal startup chain (toggleLibrary().then(() => toggleExpandedView
  // (true) ...)) only calls toggleExpandedView AFTER renderTree()/openFolder() and the catalog-scan
  // promise all resolve — on a large library (measured: 57k photos) that can legitimately run long
  // enough to freeze the main thread past the splash watchdog's grace period. When the watchdog
  // fires, hideBootSplash() runs regardless of whether that chain ever finished — so the app landed
  // on the untouched default DOM: the bare editor, Library still only docked (not expanded) or not
  // even opened, because the awaited chain was still stuck. This forces the SAME visual end state
  // the happy path reaches — Library open + expanded — synchronously and unconditionally, so the
  // splash is NEVER hidden while leaving the editor as the visible fallback. Safe to call even mid-
  // load: it only touches state.open/expanded_view/overlay/body classes, never re-fetches, so it
  // can't race or duplicate the in-flight toggleLibrary() call — that call keeps running and will
  // still populate the grid once it finishes.
  window.chromasmithForceLibraryReady = function () {
    if (!state.open) {
      state.open = true;
      overlay.classList.add('on');
      document.body.classList.add('lib-docked');
      syncDockPadding();
    }
    if (!state.expanded_view) toggleExpandedView(true);
  };

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
  // ── Quick Look (Space) ──────────────────────────────────────────────────────────────────
  // Photo Mechanic's core trick: flip through a folder at speed using only the fast embedded-
  // JPEG preview (get_quicklook_preview — no RAW demosaic), so culling never pays for a full
  // decode. Deliberately NEVER touches the real editor-open pipeline (openInEditorInner) —
  // leaving Quick Look, however you leave it, triggers no decode at all; only pressing Enter to
  // actually open the photo does, exactly like every other path into the editor already does.
  const quicklook = { active: false, path: '', url: '' };
  function quicklookEl() {
    let el = document.getElementById('lib-quicklook');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lib-quicklook';
    el.innerHTML = `<img id="lib-ql-img" alt="">
      <div id="lib-ql-caption"></div>`;
    document.body.appendChild(el);
    return el;
  }
  async function showQuickLook(path) {
    if (!path) return;
    quicklook.active = true;
    quicklook.path = path;
    const el = quicklookEl();
    el.classList.add('on');
    const img = document.getElementById('lib-ql-img');
    const caption = document.getElementById('lib-ql-caption');
    caption.textContent = baseName(path) + ' — loading…';
    img.classList.remove('loaded');
    try {
      const buf = await invoke('get_quicklook_preview', { path });
      if (quicklook.path !== path) return; // superseded by a newer Quick Look photo
      if (quicklook.url) URL.revokeObjectURL(quicklook.url);
      quicklook.url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      img.src = quicklook.url;
      img.classList.add('loaded');
      caption.textContent = baseName(path);
    } catch (e) {
      caption.textContent = baseName(path) + ' — preview unavailable';
    }
  }
  function hideQuickLook() {
    quicklook.active = false;
    quicklook.path = '';
    const el = document.getElementById('lib-quicklook');
    if (el) el.classList.remove('on');
    if (quicklook.url) { URL.revokeObjectURL(quicklook.url); quicklook.url = ''; }
  }

  document.addEventListener('keydown', (e) => {
    if (!state.open) return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea,[contenteditable]')) return;
    // Own early-return branch, same pattern as the Compare-mode branch below — Quick Look's
    // arrows/space/escape/enter/rating-flag keys must never also fall through to the grid's
    // OWN cursor-movement handling further down.
    if (quicklook.active) {
      const shownQl = sortEntries(state.entries.filter(passesFilters));
      const idxQl = shownQl.findIndex((en) => en.path === quicklook.path);
      const gotoQl = (delta) => {
        if (!shownQl.length) return;
        const next = Math.max(0, Math.min(shownQl.length - 1, (idxQl < 0 ? 0 : idxQl) + delta));
        showQuickLook(shownQl[next].path);
      };
      if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); hideQuickLook(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); gotoQl(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); gotoQl(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); const p = quicklook.path; hideQuickLook(); openInEditor(p); return; }
      if (STARS_ENABLED && e.key >= '0' && e.key <= '5' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); setRating(quicklook.path, parseInt(e.key, 10)); toast(`Rated ${e.key} star${e.key === '1' ? '' : 's'}`); return;
      }
      if (e.key === 'x' || e.key === 'X') { e.preventDefault(); setLabel(quicklook.path, 'Red'); toast('Rejected'); return; }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setLabel(quicklook.path, 'Green'); toast('Picked'); return; }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); setLabel(quicklook.path, ''); toast('Flag cleared'); return; }
      return;
    }
    // Space opens Quick Look for whatever's currently highlighted — same target resolution
    // order kbTargets() below uses (cursor, then the open photo), so it's the photo you'd
    // expect it to be regardless of whether you got here by mouse or keyboard.
    if (e.key === ' ' && state.source !== 'lr' && state.viewMode !== 'compare') {
      const target = state._kbCursor || state.openedPath || (state.selected.size === 1 ? [...state.selected][0] : '');
      if (target) { e.preventDefault(); showQuickLook(target); return; }
    }
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
      if (e.key === 'i' || e.key === 'I') { state.showInfo = !state.showInfo; renderInfoPanel(); return; }
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
      // ROADMAP 14 — grid parity. Culling is the whole point of Compare, and until now the one
      // thing you could not do here was the culling verb itself: X/P/U and the colour labels were
      // grid-only, so judging two frames side by side meant leaving Compare to act on the answer.
      // Same setLabel() the grid calls, so there is no second write path to keep in sync.
      const target = comparePathForIdx(compareState[compareState.focus === 'A' ? 'paneA' : 'paneB'].idx);
      if (!target) return;
      // Ratings work here exactly as they do in the grid — that parity IS ROADMAP Library 14,
      // and compare is where a rating is most useful, since it is the mode built for choosing
      // between two frames.
      if (STARS_ENABLED && e.key >= '0' && e.key <= '5' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const n = parseInt(e.key, 10);
        e.preventDefault(); if (target) setRating(target, n); return;
      }
      if (e.key === 'x' || e.key === 'X') { e.preventDefault(); compareApplyLabel(target, 'Red'); return; }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); compareApplyLabel(target, 'Green'); return; }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); compareApplyLabel(target, ''); return; }
      // Tab swaps which pane the above applies to — without it, B's rating is reachable and A's
      // is not, which is exactly the asymmetry this item was filed about.
      if (e.key === 'Tab') { e.preventDefault(); compareState.focus = compareState.focus === 'A' ? 'B' : 'A'; compareSyncFocus(); return; }
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
    // 0-5 set a rating on the same targets X/P/U flag — ROADMAP Library 2, which had been
    // recorded as shipped but never was.
    if (STARS_ENABLED && e.key >= '0' && e.key <= '5' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const n = parseInt(e.key, 10);
      e.preventDefault(); kbTargets().forEach((p) => setRating(p, n)); return;
    }
    if (e.key === 'x' || e.key === 'X') { kbTargets().forEach((p) => setLabel(p, 'Red')); return; }
    if (e.key === 'p' || e.key === 'P') { kbTargets().forEach((p) => setLabel(p, 'Green')); return; }
    if (e.key === 'i' || e.key === 'I') { state.showInfo = !state.showInfo; renderInfoPanel(); return; }
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
  if (!STARS_ENABLED) {
    // Sort option and list column are the two surfaces that are pure markup rather than a
    // starsHtml() call, so they need removing explicitly or the grid offers a sort by a value
    // nothing displays.
    const so = overlay.querySelector('#lib-sort option[value="rating"]');
    if (so) so.remove();
    if (state.sortBy === 'rating') { state.sortBy = 'name'; try { localStorage.setItem('chromasmith_lib_sort', 'name'); } catch {} }
  }
  const _rf = overlay.querySelector('#lib-rating-filter');
  if (_rf) {
    _rf.onchange = (e) => { state.ratingFilter = e.target.value; renderGrid(); };
    // Hide the control AND its label row, not just the <select> — a stray "Rating" label above an
    // invisible dropdown is worse than either.
    if (!STARS_ENABLED) { const row = _rf.closest('label') || _rf.parentElement; if (row) row.style.display = 'none'; }
  }
  // ── Filters popover: toggle button, active-filter chips, clear-all ──────────────────────
  const FILTER_SELECT_IDS = ['lib-type-filter', 'lib-camera-filter', 'lib-lens-filter', 'lib-iso-filter', 'lib-dupe-filter', 'lib-synced-filter', 'lib-tag-filter', 'lib-rating-filter'];
  function syncFilterUI() {
    const chipsEl = document.getElementById('lib-filter-chips');
    const badgeEl = document.getElementById('lib-filters-badge');
    if (!chipsEl || !badgeEl) return;
    const active = FILTER_SELECT_IDS.map((id) => document.getElementById(id)).filter((sel) => sel && sel.value !== 'all');
    badgeEl.textContent = active.length ? String(active.length) : '';
    badgeEl.classList.toggle('on', active.length > 0);
    chipsEl.innerHTML = active.map((sel) => {
      const opt = sel.options[sel.selectedIndex];
      return `<span class="lib-chip">${opt ? opt.textContent : sel.value}<span class="lib-chip-x" data-for="${sel.id}" title="Remove filter">${ic('close', 10)}</span></span>`;
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
  // ⚠️ `filtersPop` picks up an inline `style="display:none"` before this ever runs (some earlier
  // pass — layout measurement, a stale saved-view restore, or the initial no-flash render — sets
  // it directly), and an inline style always wins over the `#lib-filters-pop.on{display:flex}`
  // stylesheet rule no matter what class is toggled. That left the button visibly doing nothing:
  // the class flipped to "on" every click, the popover just never painted. Clear the inline
  // property explicitly instead of relying on the class alone to win the cascade.
  filtersBtn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = !filtersPop.classList.contains('on');
    filtersPop.classList.toggle('on', willOpen);
    filtersPop.style.display = willOpen ? '' : 'none';
  };
  document.addEventListener('click', (e) => {
    if (filtersPop.classList.contains('on') && !filtersPop.contains(e.target) && e.target !== filtersBtn) { filtersPop.classList.remove('on'); filtersPop.style.display = 'none'; }
  });
  overlay.querySelector('#lib-filters-clear').onclick = () => clearAllLibFilters();
  const aspectToggleBtn = overlay.querySelector('#lib-aspect-toggle');
  if (aspectToggleBtn) aspectToggleBtn.onclick = () => {
    state.gridAspect = !state.gridAspect;
    try { localStorage.setItem('chromasmith_lib_gridaspect', state.gridAspect ? '1' : '0'); } catch {}
    renderGrid();
  };
  let searchDebounce;
  const searchInput = overlay.querySelector('#lib-search');
  searchInput.oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.search = e.target.value.toLowerCase(); renderGrid(); }, 150);
  };
  // AI stack Phase D: Enter runs a semantic (CLIP) search over the whole catalog instead of the
  // live filename filter oninput already does — a deliberately different gesture (type-to-filter
  // vs press-Enter-to-search) so the common case (narrowing the current view by filename) stays
  // instant with no round trip, and the AI search is opt-in per query, not a live-as-you-type
  // model call on every keystroke.
  searchInput.onkeydown = (e) => { if (e.key === 'Enter' && searchInput.value.trim()) runClipTextSearch(searchInput.value.trim()); };
  const clipSearchBtn = overlay.querySelector('#lib-clip-search');
  if (clipSearchBtn) clipSearchBtn.onclick = () => { if (searchInput.value.trim()) runClipTextSearch(searchInput.value.trim()); };

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

  const viewsSel = overlay.querySelector('#lib-views');
  if (viewsSel) { viewsSel.onchange = onViewsChange; renderViewsMenu(); }
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
  // the DRK-style sidebar (renderCollections(), below the folder tree wiring). "edited"
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
  {
    const subCb = overlay.querySelector('#lib-subfolders');
    subCb.checked = state.includeSubfolders;
    subCb.onchange = async () => {
      state.includeSubfolders = subCb.checked;
      try { localStorage.setItem('chromasmith_lib_subfolders', state.includeSubfolders ? '1' : '0'); } catch {}
      if (state.source === 'folder' && state.currentFolder) await openFolder(state.currentFolder);
    };
  }
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
    {
      const paths = entries.filter((e) => !e.missing).map((e) => e.path);
      await Promise.all([getSidecarsBatch(paths), getMetaBatch(paths)]);
    }
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
    {
      const paths = entries.filter((e) => !e.missing).map((e) => e.path);
      await Promise.all([getSidecarsBatch(paths), getMetaBatch(paths)]);
    }
    await renderGrid();
    renderCollections();
  // Albums load once at startup, then only after a mutation — the list is small and lives in one
  // JSON file, so re-reading it on every grid render would be pure waste.
  refreshAlbums();
  }

  // ── DRK-style sidebar: smart collections above the folder tree ─────────────────────
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

  // ── Catalog: "All Photos" (library-catalog plan, phase 1) ────────────────────────────────
  // Minimal wiring for now — a live count + a grid fed by catalog_query. No date browser,
  // stacking, keywords or offline-thumbnail UI yet; those build on this once the backend
  // supports them (see catalog.rs's own top-of-file scope comment).
  let catalogCounts = { all: 0, blurry: 0 };
  let catalogVolumes = [];

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let dateCounts = { days: [], no_date: 0 };
  // Own expansion Set, not state.expanded (that's keyed by folder path) — keyed by scope
  // string ('2026', '2026:8') so it survives a renderCollections() re-render the same way the
  // real folder tree's state.expanded does.
  // Seeded OPEN at the root: this tree answers a year/month/day click with a single indexed
  // catalog query — no directory walk, no per-file stat, no rescan — which is exactly what
  // navigating a <root>/<year>/<month>/<day> archive wants. Collapsed by default it was easy to
  // miss entirely below the filesystem folder tree, so the slow path got used for a job the fast
  // one already did better. Still a plain toggle; closing it sticks for the session.
  const dateExpanded = new Set(['__root__']);

  let keywordTree = []; // flat KeywordNode list from catalog_keywords — nested client-side, same as dateCounts
  const kwExpanded = new Set(); // keyed by keyword id (a stable primary key, unlike a path a rename would change)

  // AI stack Phase C — People sidebar. Flat, not a tree like Keywords: `people` has no hierarchy.
  let peopleList = []; // PersonNode[] from catalog_people
  function refreshPeople() {
    return invoke('catalog_people').then((nodes) => { peopleList = nodes || []; renderCollections(); }).catch(() => {});
  }

  function refreshCatalogCounts() {
    invoke('catalog_counts').then((counts) => { catalogCounts = counts; renderCollections(); }).catch(() => {});
    invoke('catalog_date_counts').then((counts) => { dateCounts = counts; renderCollections(); }).catch(() => {});
    invoke('catalog_volumes').then((vols) => { catalogVolumes = vols || []; renderCollections(); }).catch(() => {});
    invoke('catalog_keywords').then((nodes) => { keywordTree = nodes || []; renderCollections(); }).catch(() => {});
    refreshPeople();
    refreshCacheUsage();
  }

  /// Manual, on-demand — same posture as "Verify library…": face detection/embedding AND CLIP
  /// embedding are each a real per-photo decode+inference cost (unlike thumb/focus/hash, which
  /// are cheap enough to auto-chain in catalogRunBackgroundPhases), so this only runs when
  /// explicitly asked for, not on every folder open. One trigger for both AI-stack features
  /// (People AND search) rather than two separate buttons — a user who wants one almost always
  /// wants the other, and both need the same expensive per-photo decode anyway. Chains detect →
  /// face-embed → cluster, then CLIP-embed; re-clustering is cheap (pure math over already-
  /// embedded vectors) so it's safe to always re-run after a scan turns up anything new.
  /// `photoIds` (optional): scope the scan to exactly these photo ids instead of the whole
  /// library — the context-menu "Find faces in selection" path (N4). Undefined/omitted
  /// reproduces the sidebar button's existing full-library behavior exactly: Tauri's `invoke`
  /// drops an `undefined` property before serializing, so `{ photo_ids: undefined }` arrives on
  /// the Rust side indistinguishable from no `photo_ids` key at all, and `Option<Vec<i64>>`
  /// defaults to `None` either way. Clustering is always unscoped (cheap pure math over
  /// already-embedded vectors — see cluster_run's own doc comment for why it must see the whole
  /// DB), so it is never passed photoIds.
  async function runFindFaces(photoIds) {
    toast(photoIds ? `Analyzing ${photoIds.length} photo${photoIds.length > 1 ? 's' : ''}…` : 'Analyzing photos…');
    // ⚠️ Before this, a scoped (N4) scan showed only the toast above — the real per-phase
    // progress ('catalog-scan' events from catalog_faces_scan/catalog_embed_faces/
    // catalog_clip_embed) already reaches wireActivityListeners' generic 'catalog-scan' handler
    // regardless of scope, but there was no IMMEDIATE feedback the moment the button is clicked:
    // catalog_faces_scan's first progress event doesn't fire until after the first photo has
    // decoded+run through SCRFD, which can be a visible beat on a single scoped photo. Priming
    // the pill here (same 'catalog' kind + 'faces' stage the real events use) means the bar is
    // already showing before the first real event arrives, not just after.
    activityUpdate('catalog', { stage: 'faces', done: 0, total: photoIds ? photoIds.length : 0, current: '' });
    try {
      await invoke('catalog_faces_scan', { photoIds });
      await invoke('catalog_embed_faces', { photoIds });
      const r = await invoke('catalog_cluster_faces');
      // Pets (RT-DETR, petdetect.rs) piggyback on the same "Analyze photos" action — one button,
      // one People & Pets section, matching the wireframes' whole point of unifying the two.
      // No embed/cluster step: a detection has no re-identification embedding to group sightings
      // on, so each one becomes its own auto pet-person directly (see pets_run's own comment) —
      // it shows up in the SAME Unnamed review queue faces do, ready for the user to name via
      // the ordinary review-mode flow (which, for a pet, is the fast path INTO subject.rs's
      // Teach/Find loop rather than a replacement for it).
      const rp = await invoke('catalog_pets_scan', { photoIds }).catch(() => ({ pets_found: 0 }));
      await invoke('catalog_clip_embed', { photoIds });
      await refreshPeople();
      activityUpdate('catalog', { stage: 'done', done: photoIds ? photoIds.length : 0, total: photoIds ? photoIds.length : 0 });
      const parts = [];
      if (r.people) parts.push(`${r.people} ${r.people === 1 ? 'person' : 'people'}`);
      if (rp.pets_found) parts.push(`${rp.pets_found} ${rp.pets_found === 1 ? 'pet' : 'pets'}`);
      toast(parts.length ? `Found ${parts.join(' and ')}` : 'Photos analyzed — try searching by description', true);
    } catch (e) {
      activity.visible = false; renderActivity();
      toast(humanizeErr('analyze photos', e), 'err');
    }
  }

  /// AI stack Phase D: natural-language photo search. Two round trips, not one — `catalog_clip_search`
  /// only returns `{id, score}` (it doesn't have full row data to hand back), so `catalog_query`'s
  /// new `photoIds` override filter (mirrors `expandStack`'s own override shape) fetches the real
  /// grid rows for those exact ids. SQL's `IN (...)` does not preserve input order, so the
  /// returned entries are re-sorted here by the score list — the whole point of a ranked search.
  async function runClipTextSearch(text) {
    state.source = 'catalog';
    state.catalogScope = `search:${text}`;
    state.selected.clear();
    // The AI query text lives in the SAME #lib-search box the live filename filter reads from
    // (state.search) — clear it here or renderGrid() re-applies it as a substring filter on top
    // of the CLIP results and (almost always) filters every single one back out.
    state.search = '';
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let hits;
    try { hits = await invoke('catalog_clip_search', { text, limit: 200 }); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not search photos.</div>'; return; }
    if (!hits.length) {
      // Bug #1 fix: catalog_clip_search now drops photos scoring below a real minimum-similarity
      // cutoff (see catalog.rs's CLIP_SEARCH_MIN_SCORE), so an empty result is no longer proof
      // that nothing has been analyzed — it's now the ALSO-correct "your query genuinely matched
      // nothing" case (e.g. a nonsense string). Disambiguate via catalog_counts' clip_scanned,
      // rather than showing the "click the search icon first" message when photos WERE analyzed
      // and the search is just working correctly.
      let analyzedAny = false;
      try { const counts = await invoke('catalog_counts'); analyzedAny = (counts.clip_scanned || 0) > 0; } catch (e) {}
      grid.innerHTML = analyzedAny
        ? '<div id="lib-empty">No matching photos found.</div>'
        : '<div id="lib-empty">No photos have been analyzed for search yet — click the search icon next to "People" in the sidebar first.</div>';
      state.entries = [];
      renderCollections();
      return;
    }
    const order = new Map(hits.map((h, i) => [h.id, i]));
    let page;
    try { page = await invoke('catalog_query', { q: { photoIds: hits.map((h) => h.id) } }); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not load search results.</div>'; return; }
    const entries = page.entries.slice().sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    state.entries = entries;
    if (!entries.length) {
      grid.innerHTML = '<div id="lib-empty">No matching photos found.</div>';
      renderCollections();
      return;
    }
    {
      const paths = entries.filter((e) => !e.offline).map((e) => e.path);
      await Promise.all([getSidecarsBatch(paths), getMetaBatch(paths)]);
    }
    await renderGrid();
    renderCollections();
  }

  let cacheUsage = null; // {offline_thumbs_bytes, decode_cache_bytes, working_thumbs_bytes, budget_bytes}
  // Backlog item 4/15, v1 (warn-only): the offline-thumbnail tier is documented as never
  // auto-cleared, so a single big shoot can fill the whole 20GB budget with no automatic relief
  // and no warning before it's full — the user only ever finds out reactively via "Free up
  // space…". This adds a one-time-per-session proactive nudge once usage crosses 90%, so the
  // budget doesn't fill silently. Full LRU eviction (with the "don't evict an offline thumbnail
  // for a currently-unplugged volume" guard) is a deliberate fast-follow, not done here — that's
  // the riskier half of this item and warrants its own pass.
  const CACHE_WARN_PCT = 90;
  let _cacheWarnShown = false;
  function refreshCacheUsage() {
    invoke('cache_usage').then((u) => {
      cacheUsage = u;
      renderCollections();
      if (!_cacheWarnShown && u.budget_bytes > 0) {
        // Includes working_thumbs — the row below used to omit it entirely, so the number shown
        // ("using ~1.1GB of 20GB") disagreed with what was actually on disk (that tier alone
        // measured 1.2GB on a real ~30k-photo library) and made the warning threshold too.
        const pct = Math.round(((u.offline_thumbs_bytes + u.decode_cache_bytes + u.working_thumbs_bytes) / u.budget_bytes) * 100);
        if (pct >= CACHE_WARN_PCT) {
          _cacheWarnShown = true;
          if (typeof toast === 'function') toast(`Approaching your ${fmtGB(u.budget_bytes)}GB cache budget (${pct}% used) — free up space in Drives`, false);
        }
      }
    }).catch(() => {});
  }
  function fmtGB(bytes) { return (bytes / (1024 * 1024 * 1024)).toFixed(1); }

  /// "using X of 20GB" (the plan's own wireframe wording) — local cache usage, not a per-volume
  /// fact, so it renders even with zero external volumes catalogued (a purely-local-photos user
  /// still has an offline-thumbnail tier and a decode cache). Placed inside Drives because the
  /// budget IS what makes offline browsing of an unplugged drive possible — this is where a user
  /// looking for "why is this taking up space" would look first.
  function cacheUsageRowHtml() {
    if (!cacheUsage) return '';
    // ⚠️ Was offline_thumbs + decode ONLY — the working-thumbnails tier (thumbnail/meta/phash
    // cache) is real disk usage the pruner enforces a cap on, and omitting it here made this
    // number actively misleading: it read "~1.1GB of 20GB" while that tier alone sat at 1.2GB.
    const used = cacheUsage.offline_thumbs_bytes + cacheUsage.decode_cache_bytes + cacheUsage.working_thumbs_bytes;
    const pct = Math.min(100, Math.round((used / cacheUsage.budget_bytes) * 100));
    const nearFull = pct >= CACHE_WARN_PCT; // persistent visual cue alongside the one-shot toast
    return `<div class="lib-coll-row" style="cursor:default" title="Offline thumbnails: ${fmtGB(cacheUsage.offline_thumbs_bytes)} GB (never auto-cleared) · Decode cache: ${fmtGB(cacheUsage.decode_cache_bytes)} GB (auto-managed) · Working thumbnails: ${fmtGB(cacheUsage.working_thumbs_bytes)} GB (auto-managed)">
        <span class="lib-coll-ic">${ic('drive', 13)}</span>
        <span class="lib-coll-lb" style="color:${nearFull ? 'var(--err,#e05454)' : 'var(--mut)'}">Using ${fmtGB(used)} of ${fmtGB(cacheUsage.budget_bytes)} GB${nearFull ? ' — approaching budget' : ''}</span>
      </div>
      <div style="padding:0 10px 6px"><div style="height:3px;border-radius:2px;background:var(--sur2);overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${nearFull ? 'var(--err,#e05454)' : 'var(--acc)'}"></div>
      </div></div>
      <div class="lib-coll-row" data-cache-free="1" style="cursor:pointer">
        <span class="lib-coll-ic"></span><span class="lib-coll-lb" style="color:var(--mut)">Free up space…</span>
      </div>
      <div class="lib-coll-row" data-verify-library="1" style="cursor:pointer" title="Re-checks every already-hashed photo against its stored hash — flags any that changed WITHOUT its file date moving, which is what silent corruption looks like. New/never-hashed photos are already covered automatically in the background.">
        <span class="lib-coll-ic"></span><span class="lib-coll-lb" style="color:var(--mut)">Verify library…</span>
      </div>
      <div class="lib-coll-row" data-find-duplicates="1" style="cursor:pointer" title="Perceptual-hash duplicate detection for the CURRENT folder — deliberately manual, same as digiKam's own Find Duplicates tool, rather than an automatic pass on every folder open.">
        <span class="lib-coll-ic"></span><span class="lib-coll-lb" style="color:var(--mut)">Find duplicates…</span>
      </div>`;
  }

  /// Manual, on-demand — see runDupeDetection's own call site in openFolder for why this is no
  /// longer automatic. Scoped to the currently-open folder (state.entries), matching what the
  /// automatic version used to cover; a whole-catalog version (using the indexed photos.phash
  /// column instead of this per-folder file-cache path) is a real future improvement but a
  /// separate, larger change.
  async function runDupeDetectionOnDemand() {
    if (state.source !== 'folder' || !state.entries.length) {
      toast('Open a folder first');
      return;
    }
    activityUpdate('catalog', { stage: 'hash', done: 0, total: state.entries.length, current: 'Finding duplicates…' });
    try {
      await runDupeDetection(state.entries.map((e) => e.path), state._openToken);
      const dupeCount = new Set(state.dupeClusters.values()).size;
      toast(dupeCount ? `Found ${dupeCount} duplicate group${dupeCount === 1 ? '' : 's'}` : 'No duplicates found');
    } finally {
      activityUpdate('catalog', { stage: 'done', done: state.entries.length, total: state.entries.length });
    }
  }

  /// Manual, on-demand — see the plan's own logged decision: hashing a NEW file is cheap and
  /// already auto-chained (catalogRunBackgroundPhases), but re-verifying every ALREADY-hashed
  /// photo is a full re-read of the whole archive, so it only runs when explicitly asked for.
  async function runVerifyLibrary() {
    toast('Verifying library…');
    let result;
    try { result = await invoke('catalog_verify'); }
    catch (e) { toast(humanizeErr('verify the library', e), 'err'); return; }
    if (!result.corrupt || !result.corrupt.length) {
      toast(`Verified ${result.checked} photo${result.checked === 1 ? '' : 's'} — none corrupted` + (result.changed ? ` (${result.changed} edited since last check, re-baselined)` : ''));
      return;
    }
    // A real finding — never bury this in a toast that auto-dismisses. Same popover shape the
    // cache-tier menu uses, but a read-only report rather than clickable actions: this isn't a
    // "pick one" decision, it's "here is what needs your attention."
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'background:var(--sur2);border:1px solid var(--bdr);border-radius:9px;padding:14px;'
      + 'min-width:320px;max-width:480px;max-height:60vh;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:12px';
    const esc2 = (s2) => String(s2 || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    menu.innerHTML = `<div style="font-weight:600;margin-bottom:8px;color:#e5484d">${result.corrupt.length} photo${result.corrupt.length === 1 ? '' : 's'} may be corrupted</div>`
      + `<div style="color:var(--mut);margin-bottom:10px">Content changed without the file's own modified date changing — the pattern real bit rot looks like, not an edit.</div>`
      + result.corrupt.map((c) => `<div style="padding:4px 0;border-top:1px solid var(--bdr);word-break:break-all">${esc2(c.name)}</div>`).join('')
      + `<div style="margin-top:10px;text-align:right"><button class="lib-btn" id="lib-verify-close">Close</button></div>`;
    document.body.appendChild(menu);
    document.getElementById('lib-verify-close').onclick = () => menu.remove();
  }

  function drivesSectionHtml() {
    // "This Mac" itself is always online and isn't the thing this section exists to show —
    // only external volumes (an SSD that may or may not currently be plugged in) are worth a
    // row here. The cache-usage row below is unrelated to any specific volume and renders
    // regardless.
    const external = catalogVolumes.filter((v) => !v.is_local);
    const rows = external.map((v) => `
      <div class="lib-coll-row${v.online ? '' : ' offline'}" title="${esc(v.last_path)}${v.online ? '' : ' — not connected'}">
        <span class="lib-coll-ic" style="${v.online ? '' : 'opacity:.5'}">${ic('drive', 13)}</span>
        <span class="lib-coll-lb"${v.online ? '' : ' style="color:var(--mut)"'}>${esc(v.label)}</span>
        <span class="lib-coll-count">${v.online ? '' : '·'}</span>
      </div>`).join('');
    const cacheRow = cacheUsageRowHtml();
    if (!rows && !cacheRow) return '';
    return `<div class="lib-coll-heading">Drives</div>${rows}${cacheRow}<div class="lib-coll-sep"></div>`;
  }

  /// Nests the flat (y,m,d,n) rows catalog_date_counts returns into a Year › Month › Day tree
  /// and renders it with the exact same .lib-tree-* classes/chevron the real folder tree uses
  /// (buildTreeNode, above) — one fetch already has every count at every level, so no lazy
  /// per-node loading is needed even across many years.
  function dateTreeHtml() {
    const years = new Map();
    for (const row of dateCounts.days) {
      if (!years.has(row.y)) years.set(row.y, { n: 0, months: new Map() });
      const y = years.get(row.y);
      y.n += row.n;
      if (!y.months.has(row.m)) y.months.set(row.m, { n: 0, days: [] });
      const mo = y.months.get(row.m);
      mo.n += row.n;
      mo.days.push(row);
    }
    const sortedYears = Array.from(years.keys()).sort((a, b) => b - a);
    // ⚠️ The chevron carries its OWN data-chev-toggle marker and is a separate click target from
    // the rest of the row (wired below) — expanding a year/month to see its children must never
    // fire a catalog_query. It used to: one shared row.onclick did both unconditionally, so
    // merely expanding "2025" to look at its months also queried and loaded every photo in all of
    // 2025 (openCatalogView's limit:null result set, plus a getSidecarsBatch/getMetaBatch pass
    // over every path) before the tree even finished opening — on a large library that reads as
    // the whole app freezing just from browsing the tree.
    const chev = (open) => `<span class="lib-tree-chev${open ? ' open' : ''}" data-chev-toggle="1">${ic('chevron', 11)}</span>`;
    // toggleKey is the BARE year or "year:month" string dateExpanded is actually keyed by
    // (yOpen/mOpen below read dateExpanded.has(`${y}`) / has(`${y}:${m}`)) — deliberately NOT
    // the same string as `scope` (which is the full "date:..." catalog_query scope).
    const row = (scope, toggleKey, label, count, hasChildren, open) => `
      <div class="lib-tree-row${state.catalogScope === scope ? ' on' : ''}" data-date-scope="${scope}" data-date-toggle="${hasChildren ? toggleKey : ''}">
        ${hasChildren ? chev(open) : '<span class="lib-tree-chev"></span>'}
        <span style="flex:1">${label}</span><span class="coll-count" style="font-family:var(--mono);font-size:10px;color:var(--mut)">${count}</span>
      </div>`;
    let html = '';
    for (const y of sortedYears) {
      const yOpen = dateExpanded.has(`${y}`);
      const yData = years.get(y);
      html += row(`date:${y}`, `${y}`, y, yData.n, true, yOpen);
      if (yOpen) {
        html += '<div class="lib-tree-children">';
        const sortedMonths = Array.from(yData.months.keys()).sort((a, b) => b - a);
        for (const m of sortedMonths) {
          const mKey = `${y}:${m}`;
          const mOpen = dateExpanded.has(mKey);
          const mData = yData.months.get(m);
          html += row(`date:${y}:${m}`, mKey, MONTH_NAMES[m - 1] || m, mData.n, true, mOpen);
          if (mOpen) {
            html += '<div class="lib-tree-children">';
            const sortedDays = mData.days.slice().sort((a, b) => b.d - a.d);
            for (const dRow of sortedDays) {
              html += row(`date:${y}:${m}:${dRow.d}`, '', dRow.d, dRow.n, false, false);
            }
            html += '</div>';
          }
        }
        html += '</div>';
      }
    }
    if (dateCounts.no_date) {
      html += row('date-nodate', '', 'No date', dateCounts.no_date, false, false);
    }
    return html;
  }

  /// Nests the flat KeywordNode list into a tree by parent_id and renders it with the same
  /// .lib-tree-* markup dateTreeHtml uses. Own top-level section (per the plan's wireframe:
  /// "[Collections] [Albums] [Keywords] [Devices] [Cloud] [Folders]") rather than folded into
  /// the Library section the way By Date is — keywords are a user-built taxonomy, not a
  /// built-in browse axis, and a photo can carry many of them at once instead of exactly one.
  function keywordsSectionHtml() {
    if (!keywordTree.length) return '';
    const byParent = new Map();
    for (const n of keywordTree) {
      const key = n.parent_id == null ? '__root__' : n.parent_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(n);
    }
    const chev = (open) => `<span class="lib-tree-chev${open ? ' open' : ''}">${ic('chevron', 11)}</span>`;
    const renderLevel = (parentKey) => {
      const kids = (byParent.get(parentKey) || []).slice().sort((a, b) => a.leaf.localeCompare(b.leaf));
      return kids.map((n) => {
        const hasChildren = byParent.has(n.id);
        const open = kwExpanded.has(n.id);
        const scope = `kw:${n.path}`;
        return `<div class="lib-tree-row${state.catalogScope === scope ? ' on' : ''}" data-kw-scope="${scope}" data-kw-id="${n.id}" data-kw-toggle="${hasChildren ? n.id : ''}" data-kw-path="${esc(n.path)}">
            ${hasChildren ? chev(open) : '<span class="lib-tree-chev"></span>'}
            <span style="flex:1">${esc(n.leaf)}</span><span class="coll-count" style="font-family:var(--mono);font-size:10px;color:var(--mut)">${n.n || ''}</span>
          </div>${hasChildren && open ? `<div class="lib-tree-children">${renderLevel(n.id)}</div>` : ''}`;
      }).join('');
    };
    return `<div class="lib-tree-node" id="lib-keyword-tree">
        <div class="lib-tree-row" data-kw-tree-toggle="1">
          <span class="lib-tree-chev${kwExpanded.has('__root__') ? ' open' : ''}">${ic('chevron', 11)}</span>
          <span style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:var(--mut)">${ic('tag', 13)}</span>
          <span>Keywords</span>
        </div>
        ${kwExpanded.has('__root__') ? `<div class="lib-tree-children">${renderLevel('__root__')}</div>` : ''}
      </div><div class="lib-coll-sep"></div>`;
  }

  /// Loads one person's face crop lazily via `catalog_face_crop` and fades it into the given
  /// <img>. Fire-and-forget: a scan that hasn't run, an offline volume, or a person with no
  /// `cover_face_id` all just leave the avatar's plain background showing — see people-pets
  /// wireframes screen A ("no face thumbnails anywhere" was the #1 cited defect; this is the
  /// backend call that already existed — `catalog_photo_faces`'s sibling — and was never wired
  /// to anything on the frontend before this).
  function loadFaceCrop(faceId, imgEl) {
    if (faceId == null) return;
    invoke('catalog_face_crop', { faceId }).then((buf) => {
      if (!imgEl.isConnected) return;
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      imgEl.src = url;
      imgEl.classList.add('loaded');
      imgEl.onload = () => URL.revokeObjectURL(url);
    }).catch(() => {});
  }
  function faceAvaHtml(person, size) {
    let cls = 'lib-face-ava';
    if (person.kind === 'pet') cls += ' pet';
    if (person.auto) cls += ' unnamed';
    const style = size ? ` style="width:${size}px;height:${size}px"` : '';
    return `<span class="${cls}"${style} data-face-id="${person.cover_face_id ?? ''}"><img alt=""></span>`;
  }
  /// Named people are the section — sorted by descending face count, own bounded/scrolling list
  /// so it can never push Folders/Keywords off screen (people-pets wireframes screen A, failure
  /// 14: a scan used to render "Person 1..Person N" as flat rows and flood the sidebar). Every
  /// still-machine-generated cluster (`auto:true`, see catalog.rs's `people.auto`) collapses
  /// behind one pinned, counted "Unnamed" row instead of appearing as a row of its own — naming
  /// a cluster is what promotes it into the named list above.
  function peopleSectionHtml() {
    const scanLabel = 'Analyze photos — find faces and enable AI search';
    const scanGlyph = `<span id="lib-people-scan" title="${scanLabel}" style="float:right;cursor:pointer;padding:0 4px">${ic('search', 13)}</span>`;
    if (!peopleList.length) {
      return `<div class="lib-coll-sep"></div><div class="lib-coll-heading">People &amp; Pets${scanGlyph}</div>`
        + `<div class="lib-coll-row" style="opacity:.5;cursor:default">No people found yet</div>`;
    }
    const named = peopleList.filter((p) => !p.auto).sort((a, b) => (b.face_count - a.face_count) || a.name.localeCompare(b.name));
    const unnamedCount = peopleList.filter((p) => p.auto).reduce((n, p) => n + (p.face_count || 0), 0);
    const row = (p) => {
      const scope = `person:${p.id}`;
      return `<div class="lib-coll-row${state.catalogScope === scope && state.source === 'catalog' ? ' on' : ''}" data-person="${p.id}">
        ${faceAvaHtml(p)}<span class="lib-coll-lb">${esc(p.name)}</span>
        <span class="lib-coll-count">${p.face_count || ''}</span>
      </div>`;
    };
    const namedRows = named.length
      ? `<div class="lib-people-scroll">${named.map(row).join('')}</div>`
      : `<div class="lib-coll-row" style="opacity:.5;cursor:default">Review faces to name people</div>`;
    const unnamedRow = `<div class="lib-coll-row${state.catalogScope === 'person:unnamed' ? ' on' : ''}" data-people-review="1">
        <span class="lib-face-ava unnamed"></span><span class="lib-coll-lb">Unnamed</span>
        <span class="lib-coll-count">${unnamedCount || ''}</span>
      </div>`;
    return `<div class="lib-coll-sep"></div><div class="lib-coll-heading">People &amp; Pets${scanGlyph}</div>`
      + namedRows + unnamedRow;
  }
  function wirePeopleRows(host) {
    const scanBtn = host.querySelector('#lib-people-scan');
    if (scanBtn) scanBtn.onclick = (e) => { e.stopPropagation(); runFindFaces(); };
    host.querySelectorAll('.lib-face-ava[data-face-id]').forEach((ava) => {
      const faceId = parseInt(ava.dataset.faceId, 10);
      const img = ava.querySelector('img');
      if (img && Number.isFinite(faceId)) loadFaceCrop(faceId, img);
    });
    host.querySelectorAll('.lib-coll-row[data-person]').forEach((row) => {
      const id = parseInt(row.dataset.person, 10);
      row.onclick = () => openCatalogView(`person:${id}`);
      row.oncontextmenu = (e) => { e.preventDefault(); showPersonMenu(e, id); };
    });
    const reviewRow = host.querySelector('[data-people-review]');
    if (reviewRow) reviewRow.onclick = () => openReviewFaces();
  }

  // ── Review mode (people-pets wireframes screen C) ──────────────────────────────────────────
  // One unnamed cluster at a time, full-viewport, keyboard-driven — the answer to CLAUDE.md
  // failures #2/#3/#6/#7: unclustered/unnamed faces were computed then thrown away, there was no
  // confirm/reject step, and naming was one person at a time through a right-click modal.
  const reviewState = { clusters: [], idx: 0, deselected: new Set() };
  function reviewEl() {
    let el = document.getElementById('lib-review');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lib-review';
    el.innerHTML = `
      <div class="lib-review-top">
        <span>Review faces</span>
        <span id="lib-review-pos" style="margin-left:6px"></span>
        <span style="margin-left:auto;cursor:pointer" id="lib-review-close">Esc to exit</span>
      </div>
      <div class="lib-review-body">
        <div class="lib-review-grid" id="lib-review-grid"></div>
        <div class="lib-review-foot">
          <input id="lib-review-name" placeholder="Name this person or pet…" list="lib-review-names" autocomplete="off">
          <datalist id="lib-review-names"></datalist>
          <span class="lib-btn" id="lib-review-confirm">Name &amp; next</span>
          <span class="lib-btn" id="lib-review-ignore">Ignore</span>
          <span class="lib-btn" id="lib-review-skip">Skip</span>
        </div>
        <div style="padding:0 18px 4px;display:flex;gap:14px;flex-wrap:wrap">
          <span class="lib-review-kbd">↵</span><span class="mut" style="font-size:11px">Name &amp; next</span>
          <span class="lib-review-kbd">X</span><span class="mut" style="font-size:11px">Ignore</span>
          <span class="lib-review-kbd">Space</span><span class="mut" style="font-size:11px">Toggle face (excluded faces return to Unnamed)</span>
          <span class="lib-review-kbd">→</span><span class="mut" style="font-size:11px">Skip</span>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#lib-review-close').onclick = closeReviewFaces;
    el.querySelector('#lib-review-confirm').onclick = reviewConfirmCurrent;
    el.querySelector('#lib-review-ignore').onclick = reviewIgnoreCurrent;
    el.querySelector('#lib-review-skip').onclick = () => reviewGoTo(reviewState.idx + 1);
    // ⚠️ Bound directly on the input, not just relied on via document-level bubbling below —
    // the input carries a `list=` (datalist) attribute, and at least one Chromium build was
    // observed swallowing the keydown entirely while its autocomplete popup was open, so Enter
    // never reached the document listener. Binding here means it fires regardless.
    el.querySelector('#lib-review-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); reviewConfirmCurrent(); }
    });
    return el;
  }
  async function openReviewFaces() {
    let clusters;
    try { clusters = await invoke('catalog_unnamed_clusters'); }
    catch (err) { toast(humanizeErr('load faces to review', err), 'err'); return; }
    if (!clusters || !clusters.length) { toast('No unnamed faces to review'); return; }
    reviewState.clusters = clusters;
    reviewState.idx = 0;
    const el = reviewEl();
    el.classList.add('on');
    const datalist = el.querySelector('#lib-review-names');
    datalist.innerHTML = peopleList.filter((p) => !p.auto).map((p) => `<option value="${esc(p.name)}">`).join('');
    reviewRenderCurrent();
  }
  function closeReviewFaces() {
    const el = document.getElementById('lib-review');
    if (el) el.classList.remove('on');
    reviewState.clusters = [];
  }
  function reviewGoTo(idx) {
    if (idx >= reviewState.clusters.length) { closeReviewFaces(); refreshPeople(); toast('All caught up — no more faces to review', true); return; }
    reviewState.idx = idx;
    reviewRenderCurrent();
  }
  function reviewRenderCurrent() {
    const c = reviewState.clusters[reviewState.idx];
    if (!c) { reviewGoTo(reviewState.idx + 1); return; }
    reviewState.deselected = new Set();
    const speciesHint = c.species ? ` · ${c.species[0].toUpperCase()}${c.species.slice(1)} detected` : '';
    document.getElementById('lib-review-pos').textContent = `· cluster ${reviewState.idx + 1} of ${reviewState.clusters.length} · ${c.face_count} face${c.face_count === 1 ? '' : 's'}${speciesHint}`;
    const nameInput = document.getElementById('lib-review-name');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 0);
    const grid = document.getElementById('lib-review-grid');
    grid.innerHTML = c.face_ids.map((fid) => `<div class="lib-review-face sel" data-face-id="${fid}"><img alt=""></div>`).join('');
    grid.querySelectorAll('.lib-review-face').forEach((cell) => {
      const fid = parseInt(cell.dataset.faceId, 10);
      loadFaceCrop(fid, cell.querySelector('img'));
      cell.onclick = () => {
        if (reviewState.deselected.has(fid)) reviewState.deselected.delete(fid);
        else reviewState.deselected.add(fid);
        cell.classList.toggle('desel', reviewState.deselected.has(fid));
        cell.classList.toggle('sel', !reviewState.deselected.has(fid));
      };
    });
  }
  async function reviewConfirmCurrent() {
    const c = reviewState.clusters[reviewState.idx];
    if (!c) return;
    const name = document.getElementById('lib-review-name').value.trim();
    if (!name) { toast('Type a name first'); return; }
    const selectedIds = c.face_ids.filter((id) => !reviewState.deselected.has(id));
    const excludedIds = c.face_ids.filter((id) => reviewState.deselected.has(id));
    try {
      const existing = peopleList.find((p) => !p.auto && p.name.toLowerCase() === name.toLowerCase());
      if (excludedIds.length) await invoke('catalog_split_faces', { faceIds: excludedIds, intoId: null, intoName: null });
      if (existing) {
        // Move the confirmed faces into the existing person and confirm them there.
        await invoke('catalog_split_faces', { faceIds: selectedIds, intoId: existing.id, intoName: null });
        await invoke('catalog_confirm_person', { personId: existing.id, faceIds: selectedIds });
      } else {
        await invoke('catalog_rename_person', { personId: c.person_id, name });
        await invoke('catalog_confirm_person', { personId: c.person_id, faceIds: selectedIds.length ? selectedIds : null });
      }
      await refreshPeople();
      toast(`Named ${selectedIds.length} face${selectedIds.length === 1 ? '' : 's'} "${name}"`, true);
      reviewGoTo(reviewState.idx + 1);
    } catch (err) { toast(humanizeErr('confirm this person', err), 'err'); }
  }
  async function reviewIgnoreCurrent() {
    const c = reviewState.clusters[reviewState.idx];
    if (!c) return;
    try {
      await invoke('catalog_set_person_ignored', { personId: c.person_id, ignored: true });
      await refreshPeople();
      reviewGoTo(reviewState.idx + 1);
    } catch (err) { toast(humanizeErr('ignore this person', err), 'err'); }
  }
  document.addEventListener('keydown', (e) => {
    const el = document.getElementById('lib-review');
    if (!el || !el.classList.contains('on')) return;
    if (e.key === 'Escape') { closeReviewFaces(); return; }
    const t = e.target;
    const inField = t && t.closest && t.closest('input,textarea');
    if (e.key === 'Enter' && inField) { e.preventDefault(); reviewConfirmCurrent(); return; }
    if (inField) return;
    if (e.key.toLowerCase() === 'x') { reviewIgnoreCurrent(); return; }
    if (e.key === 'ArrowRight') { reviewGoTo(reviewState.idx + 1); return; }
  });
  /// Visual multi-candidate picker (people-pets wireframes screen D) — replaces the old
  /// "retype a name from this newline list" merge flow (failure #8), which failed outright on
  /// any typo and had no picker at all. Reuses `.lib-coll-row`/`.lib-face-ava` so a candidate
  /// row looks exactly like its sidebar row, face crop included. Resolves to the chosen
  /// PersonNode, or null if dismissed.
  function pickPersonModal(title, candidates) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,10,.6);'
        + 'display:flex;align-items:center;justify-content:center';
      const sorted = candidates.slice().sort((a, b) => (b.face_count - a.face_count) || a.name.localeCompare(b.name));
      wrap.innerHTML = `<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:10px;
          padding:14px;min-width:260px;max-width:340px;max-height:70vh;overflow:auto;box-shadow:var(--lift-2)">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">${esc(title)}</div>
        <div id="lib-pick-rows"></div>
        <div class="lib-coll-row" data-pick-cancel style="opacity:.6;margin-top:6px">Cancel</div>
      </div>`;
      const rows = wrap.querySelector('#lib-pick-rows');
      sorted.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'lib-coll-row';
        row.innerHTML = `${faceAvaHtml(c)}<span class="lib-coll-lb">${esc(c.name)}</span><span class="lib-coll-count">${c.face_count || ''}</span>`;
        row.onclick = () => { wrap.remove(); resolve(c); };
        rows.appendChild(row);
        const ava = row.querySelector('.lib-face-ava[data-face-id]');
        const img = ava && ava.querySelector('img');
        const faceId = ava && parseInt(ava.dataset.faceId, 10);
        if (img && Number.isFinite(faceId)) loadFaceCrop(faceId, img);
      });
      wrap.querySelector('[data-pick-cancel]').onclick = () => { wrap.remove(); resolve(null); };
      wrap.onclick = (e) => { if (e.target === wrap) { wrap.remove(); resolve(null); } };
      document.body.appendChild(wrap);
    });
  }
  function showPersonMenu(e, id) {
    const p = peopleList.find((x) => x.id === id);
    if (!p) return;
    const items = [
      ['Rename…', async () => {
        const name = await window.askTextModal('Rename person', '', p.name);
        if (!name) return;
        try { await invoke('catalog_rename_person', { personId: id, name }); await refreshPeople(); }
        catch (err) { toast(humanizeErr('rename this person', err), 'err'); }
      }],
      ['Merge into…', async () => {
        const others = peopleList.filter((x) => x.id !== id);
        if (!others.length) { toast('No other people to merge into'); return; }
        const target = await pickPersonModal(`Merge "${p.name}" into…`, others);
        if (!target) return;
        try {
          await invoke('catalog_merge_people', { fromId: id, intoId: target.id });
          if (state.catalogScope === `person:${id}`) await openCatalogView(`person:${target.id}`);
          await refreshPeople();
          toast(`Merged "${p.name}" into "${target.name}"`, true);
        } catch (err) { toast(humanizeErr('merge these people', err), 'err'); }
      }],
      [p.kind === 'pet' ? 'Mark as Person' : 'Mark as Pet', async () => {
        try { await invoke('catalog_set_person_kind', { personId: id, kind: p.kind === 'pet' ? 'person' : 'pet' }); await refreshPeople(); }
        catch (err) { toast(humanizeErr('change person/pet', err), 'err'); }
      }],
      ['Ignore (stop suggesting)', async () => {
        try {
          await invoke('catalog_set_person_ignored', { personId: id, ignored: true });
          if (state.catalogScope === `person:${id}`) { state.source = 'folder'; state.entries = []; renderGrid(); }
          await refreshPeople();
          toast(`Ignored "${p.name}"`, true);
        } catch (err) { toast(humanizeErr('ignore this person', err), 'err'); }
      }],
      [`Delete "${p.name}"`, async () => {
        if (!await window.confirmModal(`Delete "${p.name}"?\n\nTheir photos stay exactly where they are — only this person's grouping is removed. A future face scan may re-group them.`, 'Delete')) return;
        await invoke('catalog_delete_person', { personId: id }).catch((err) => toast(humanizeErr('delete this person', err), 'err'));
        if (state.catalogScope === `person:${id}`) { state.source = 'folder'; state.entries = []; renderGrid(); }
        await refreshPeople();
      }],
    ];
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--sur2);border:1px solid var(--bdr);'
      + 'border-radius:7px;padding:4px;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:12px';
    items.forEach(([label, fn]) => {
      const it = document.createElement('div');
      it.textContent = label;
      it.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      it.onmouseenter = () => { it.style.background = 'var(--bdr)'; };
      it.onmouseleave = () => { it.style.background = ''; };
      it.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(it);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 90) + 'px';
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  function catalogSectionHtml() {
    // "Needs review" only appears once something is actually flagged — an empty row promising
    // a feature with nothing behind it reads as broken, not reassuring. Never auto-hides once a
    // photo is fixed/deleted/dismissed from it though: it's driven by catalogCounts.blurry like
    // every other row here, so it just goes away on its own once the count returns to 0.
    const reviewRow = catalogCounts.blurry ? `
      <div class="lib-coll-row${state.source === 'catalog' && state.catalogScope === 'blurry' ? ' on' : ''}" data-catalog="blurry" title="Photos flagged as possibly out of focus — review, never auto-deleted">
        <span class="lib-coll-ic">${ic('focus', 14)}</span><span class="lib-coll-lb">Needs review</span>
        <span class="lib-coll-count">${catalogCounts.blurry}</span>
      </div>` : '';
    return `<div class="lib-coll-row${state.source === 'catalog' && state.catalogScope === 'all' ? ' on' : ''}" data-catalog="all">
        <span class="lib-coll-ic">${ic('image', 14)}</span><span class="lib-coll-lb">All Photos</span>
        <span class="lib-coll-count">${catalogCounts.all || ''}</span>
      </div>${reviewRow}
      <div class="lib-tree-node" id="lib-date-tree">
        <div class="lib-tree-row" data-date-tree-toggle="1">
          <span class="lib-tree-chev${dateExpanded.has('__root__') ? ' open' : ''}">${ic('chevron', 11)}</span>
          <span style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:var(--mut)">${ic('calendar', 13)}</span>
          <span>By Date</span>
        </div>
        ${dateExpanded.has('__root__') ? `<div class="lib-tree-children">${dateTreeHtml()}</div>` : ''}
      </div>
      <div class="lib-coll-sep"></div>${drivesSectionHtml()}`;
  }

  /// Registers `path` with the catalog and — at most once per COVERING ROOT per session — runs
  /// the real (walk-skip-optimized) scan for it, then resolves with `{volumeId, relDir}` so
  /// `openFolder` can read the grid's own entries STRAIGHT FROM THE CATALOG instead of a separate
  /// live filesystem walk. This is the fix for the deepest issue found across several rounds of
  /// this session's work: ordinary folder browsing used to run its own independent, uncached
  /// `list_dir`/`listDirRecursive` walk on every open, completely separate from this scan — so
  /// every optimization made to the CATALOG's own walk (this function, `catalog_scan`) never
  /// changed what was actually on screen. Awaited by `openFolder` now, not fire-and-forget.
  //
  // `catalog_add_root` is cheap (an ancestor lookup + upsert, not a walk) — safe to call on every
  // folder open, unlike the scan below. Deduped by ROOT ID, not volume: an earlier version of
  // this capped by volume_id (matching the OLD, pre-catalog-backed-grid reasoning: "the scan is
  // already incremental, so repeating it is merely pointless, never wrong"). That stopped being
  // true the moment the grid started reading from the catalog — `catalog_scan(volume_id)` walks
  // every ROOT registered for that volume, but a root registered AFTER the volume's one-per-
  // session scan already ran would never get walked at all, and its folder would show an empty
  // grid despite having real files on disk. Root-id keying still skips the redundant rescan when
  // clicking through an already-covered root's own subfolders (catalog_add_root's ancestor
  // collapse returns the SAME root id for those), while still triggering a real scan — cheap,
  // thanks to walk-skip, for anything already walked and unchanged — for a genuinely new root.
  const _catalogScannedRoots = new Set();
  // ⚠️ Set (not fired) here, deliberately. This used to call catalogRunBackgroundPhases()
  // directly, fire-and-forget, the MOMENT catalog_scan resolved — which is BEFORE openFolder has
  // even called renderGrid(), let alone before the first screenful's interactive thumbnails have
  // decoded. The bulk thumbnail/focus/hash pass (decode_batch_pool + the writer-lock chain) then
  // raced the interactive get_thumbnail_or_offline calls for the exact same CPU cores for the
  // entire first-paint window — confirmed live: fixing ONLY the readiness gate (firstPaintReady,
  // below) without ALSO fixing this made no visible difference on the real 57k-photo library,
  // because the gate's own bounded wait kept timing out against real contention it did nothing to
  // remove. openFolder flips this flag into an actual firstPaintReady().then(...) call, once
  // AFTER its own renderGrid() has run and the queue this generation's decode work sits in
  // actually exists — calling firstPaintReady() from here instead would just resolve instantly
  // (nothing queued yet) and be no fix at all.
  let _catalogBgPending = false;
  function catalogRegisterFolder(path) {
    return invoke('catalog_add_root', { path, kind: null })
      .then((root) => {
        if (!root) return null;
        const needsScan = !_catalogScannedRoots.has(root.id);
        if (needsScan) _catalogScannedRoots.add(root.id);
        const scanPromise = needsScan ? invoke('catalog_scan', { volumeId: root.volume_id }).then(() => true) : Promise.resolve(false);
        return scanPromise.then((scanned) => {
          if (scanned) { refreshCatalogCounts(); _catalogBgPending = true; }
          return { volumeId: root.volume_id, relDir: root.requested_rel_path };
        });
      })
      .catch((e) => { console.error('catalog_add_root/scan', path, e); return null; });
  }

  /// Thumbnails (the offline-browsing tier) and focus scoring are deliberately NOT part of
  /// catalog_scan's own chain on the Rust side — decoding every photo is far more expensive
  /// than reading an EXIF header or a small XMP sidecar, so folding it into the scan that fires
  /// on every ordinary folder-open would make routine browsing noticeably slower. Run here
  /// instead, once, in the background, after the fast walk/metadata/sidecar sync has already
  /// left the grid showing real data. `_catalogBgRunning` just skips overlap on rapid repeated
  /// folder-opens — nothing is lost by skipping, since the rows a skipped run would have picked
  /// up (thumb=0 / focus_at stale) are still exactly where the NEXT run will find them.
  /// Repeatedly invokes catalog_thumbnails (now one 32-item batch per call — see thumbnail_run's
  /// own comment) with a real pacing delay between calls, instead of a single invoke() that used
  /// to loop Rust-side until the ENTIRE backlog was clear. Measured before this change: ~11
  /// minutes of unbroken parallel decoding for ~27,000 newly-imported photos, competing with the
  /// interactive grid and everything else for the whole duration. An ordinary relaunch with
  /// nothing new still costs exactly one invoke() (thumb=0 candidate set is empty, has_more is
  /// false immediately) — this only changes the shape of what happens when there's real,
  /// genuinely new work to do, not whether there's any work at all.
  function drainCatalogThumbnails() {
    return invoke('catalog_thumbnails').then((r) => {
      if (!r || !r.has_more) return;
      return new Promise((resolve) => setTimeout(resolve, 200)).then(drainCatalogThumbnails);
    });
  }
  let _catalogBgRunning = false;
  function catalogRunBackgroundPhases() {
    if (LIBTEST || _catalogBgRunning) return;
    _catalogBgRunning = true;
    invoke('catalog_stack')
      .then(() => drainCatalogThumbnails())
      .then(() => invoke('catalog_focus'))
      // Hashing a NEW file is a bounded one-time cost (hash_run only touches unhashed/changed-
      // mtime rows), same shape as thumbnails/focus — safe to auto-chain. Re-verifying every
      // ALREADY-hashed file (detecting drift) is unbounded and stays a manual "Verify library"
      // action (showVerifyMenu) — see the plan's own logged decision on this split.
      .then(() => invoke('catalog_hash'))
      .catch((e) => console.error('catalog background phases', e))
      .finally(() => { _catalogBgRunning = false; refreshCatalogCounts(); });
  }

  // ── Guaranteed-offline tier (hq_offline): last-100-edited + last-100-added, full resolution,
  // DCP-accurate for RAW — the user's own explicit ask was "treat those 200 photos as if they
  // have been downloaded... no difference between them and the ones on the external drive." See
  // catalog.rs's hq_offline_run for the generation/eviction logic; this is purely the frontend
  // side: an index the editor consults on open, the paced drain loop, camera-LUT self-heal, and
  // the quit-block dialog for the one thing the user separately asked for — never lose in-
  // progress work silently by quitting mid-generation.
  let _hqOfflineByPath = new Map(); // original path -> {path: cached file path, reason}
  let _hqOfflineDraining = false;

  async function refreshHqOfflineIndex() {
    if (LIBTEST) return;
    try {
      const entries = await invoke('catalog_hq_offline_list');
      _hqOfflineByPath = new Map((entries || []).map((e) => [e.original_path, { path: e.path, reason: e.reason }]));
    } catch (e) { console.error('catalog_hq_offline_list', e); }
  }

  /// Minimal reimplementation of desktop-native.js's own `framedInvoke` (private to that file's
  /// IIFE, not reachable from here) — same wire format store_dcp_lut expects: [u32 jsonLen][json
  /// utf8][payload]. Kept tiny and local rather than restructuring desktop-native.js to export it.
  function _hqFramedInvoke(cmd, jsonObj, payload) {
    const json = new TextEncoder().encode(JSON.stringify(jsonObj));
    const framed = new Uint8Array(4 + json.length + payload.length);
    new DataView(framed.buffer).setUint32(0, json.length, true);
    framed.set(json, 4);
    framed.set(payload, 4 + json.length);
    return invoke(cmd, framed);
  }

  /// Reactive self-heal for hq_offline_run's `pending_raw_sample`: a RAW whose camera has no
  /// persisted "Camera Standard" DCP LUT yet (the common gap — a freshly imported photo the
  /// editor has never opened, so the normal RAW-open bake never ran). Peeks the camera, resolves
  /// + bakes + persists via the EXACT same functions the interactive editor already calls on
  /// every RAW load (resolveDcpSource/getDcpLUT, chromasmith-22.html) — this reuses tested,
  /// working code rather than re-deriving DCP resolution logic here. Best-effort: any failure
  /// just leaves this camera skipped for one more drain round, never a hard error surfaced to
  /// the user (a background cache warm-up is not worth interrupting anyone over).
  async function hqOfflineTryBakeCameraFor(rawPath) {
    try {
      const buf = await invoke('read_file_bytes', { path: rawPath });
      const ident = await invoke('peek_raw_camera', new Uint8Array(buf));
      const dcpSource = (typeof resolveDcpSource === 'function') ? await resolveDcpSource(ident.make || '', ident.model || '') : null;
      const camPrefix = dcpSource ? dcpSource.prefix : null;
      if (!camPrefix) return false;
      const lut = await getDcpLUT(camPrefix, 'Standard', 200, dcpSource.source);
      await _hqFramedInvoke('store_dcp_lut', { key: 'dcp:' + camPrefix + ':Standard', make: ident.make || '' },
        new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength));
      return true;
    } catch (e) {
      console.error('hqOfflineTryBakeCameraFor', rawPath, e);
      return false;
    }
  }

  /// Paced drain loop — one small batch per `catalog_hq_offline` call (Rust caps it at 4, full
  /// RAW decode being "multi-second to ~15s" per photo, nowhere near thumbnail_run's pace), with
  /// a real gap between calls so this never reads as a stall on top of everything else the app
  /// might be doing. `hq_offline_active` is reported to Rust for the whole loop's duration (not
  /// per-call) so the quit-block window-close handler reflects "the drain sequence is still
  /// going," not just "one IPC call happens to be in flight" — see CatalogState's own doc
  /// comment on that field.
  async function hqOfflineDrainLoop() {
    if (LIBTEST || _hqOfflineDraining) return;
    _hqOfflineDraining = true;
    if (!LIBTEST) invoke('catalog_hq_offline_set_active', { active: true }).catch(() => {});
    try {
      let bakedThisRound = new Set();
      for (;;) {
        let r;
        try {
          r = await invoke('catalog_hq_offline');
        } catch (e) { console.error('catalog_hq_offline', e); break; }
        if (!r) break;
        if (r.pending_raw_sample && !bakedThisRound.has(r.pending_raw_sample)) {
          bakedThisRound.add(r.pending_raw_sample); // never retry the SAME file twice in one loop — a genuine decode failure must not spin forever
          await hqOfflineTryBakeCameraFor(r.pending_raw_sample);
        }
        if ((r.generated || 0) > 0 || (r.evicted || 0) > 0) {
          await refreshHqOfflineIndex();
        }
        // Caught up: nothing generated, nothing evicted, and no camera still needs baking.
        if ((r.generated || 0) === 0 && (r.evicted || 0) === 0 && !r.pending_raw_sample) break;
        await new Promise((resolve) => setTimeout(resolve, 400)); // real gap between heavy full-res decodes
      }
    } finally {
      _hqOfflineDraining = false;
      if (!LIBTEST) invoke('catalog_hq_offline_set_active', { active: false }).catch(() => {});
    }
  }

  // Quit-block dialog: main.rs's window-close handler prevents the close and emits this event
  // whenever hq_offline_active is true at the moment the user tries to quit — the user's own
  // explicit ask ("if i try to close the app before it finishes, i should get an alert... with
  // the option to cancel it and close it"). "Cancel and quit" calls hq_offline_force_quit, which
  // sets the cancel flag (stops the in-flight decode between items) and exits for real — never
  // window.close(), which would just re-fire this same event and loop.
  function hqOfflineQuitBlockedModal() {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.id = 'hq-offline-quit-modal';
      d.style.cssText = 'border:none;border-radius:10px;padding:0;background:var(--sur1,#1c1c1f);color:var(--tx1,#f0ece2);max-width:380px';
      d.innerHTML = `
        <div style="padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px">Still preparing offline photos</div>
          <div style="font-size:12px;color:var(--tx2,#9a968c);line-height:1.5;margin-bottom:16px">
            Chromasmith is still caching your most recently edited and added photos for offline use. Quitting now will leave this unfinished — you can wait a moment, or quit anyway and pick up where it left off next time.
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="hq-offline-quit-wait" style="padding:6px 14px;border-radius:6px;border:1px solid var(--bd1,#333);background:transparent;color:inherit;cursor:pointer">Wait</button>
            <button id="hq-offline-quit-anyway" style="padding:6px 14px;border-radius:6px;border:none;background:#e5484d;color:#fff;cursor:pointer">Quit anyway</button>
          </div>
        </div>`;
      document.body.appendChild(d);
      d.showModal();
      const cleanup = (choice) => { d.close(); d.remove(); resolve(choice); };
      d.querySelector('#hq-offline-quit-wait').onclick = () => cleanup('wait');
      d.querySelector('#hq-offline-quit-anyway').onclick = () => cleanup('quit');
      d.addEventListener('cancel', () => cleanup('wait')); // Escape key — default to the safe choice
    });
  }
  if (!LIBTEST && window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('hq-offline-quit-blocked', async () => {
      // A second close attempt while the dialog is already up must not stack a duplicate.
      if (document.getElementById('hq-offline-quit-modal')) return;
      const choice = await hqOfflineQuitBlockedModal();
      if (choice === 'quit') { try { await invoke('hq_offline_force_quit'); } catch (e) {} }
    }).catch(() => {});
  }

  // ── Activity indicator ────────────────────────────────────────────────────────────────────
  // One chained pipeline, not three silent subsystems — a copy/scan that's actually running
  // has to be visible somewhere, or "why hasn't All Photos updated yet" has no answer. Backed
  // by the SAME progress events the Rust side already emits for every scan phase
  // (catalog-scan: {phase,done,total,current}) and card import (ingest-progress:
  // {done,total,current,bytes_done,bytes_total}) — nothing new on the Rust side, this just
  // gives those events somewhere to land.
  const STAGE_LABELS = { walk: 'Scanning folders', subfolders: 'Scanning subfolders', metadata: 'Reading photo info', sidecar: 'Syncing ratings', cache: 'Loading thumbnails', thumb: 'Generating thumbnails', focus: 'Checking focus', hash: 'Hashing new photos', verify: 'Checking for corruption', copy: 'Copying', faces: 'Finding faces', embed: 'Analyzing faces', clip: 'Indexing for search', paint: 'Loading thumbnails' };
  const STAGE_ORDER = ['copy', 'walk', 'metadata', 'sidecar', 'thumb', 'focus', 'hash', 'verify', 'faces', 'embed', 'clip'];
  let activity = { visible: false, expanded: false, kind: '', stage: '', done: 0, total: 0, current: '', doneAt: 0 };
  let _activityClearTimer = null;

  function activityFrac() {
    if (activity.kind === 'import' && activity.total) return activity.done / activity.total;
    if (activity.total) return activity.done / activity.total;
    return 0;
  }

  function renderActivity() {
    const el = document.getElementById('lib-activity');
    if (!el) return;
    if (!activity.visible) { el.innerHTML = ''; return; }
    const pct = Math.round(activityFrac() * 100);
    // While the initial directory walk is still running, `total` is genuinely unknown (it's
    // only known once the whole tree has been enumerated — see walk_root's own comment) — so
    // there is nothing to show a percentage OF. Showing the running count instead ("Indexing…
    // 4,213 found") is what actually answers "is this doing something or stuck", which a
    // permanently-0% ring cannot.
    // 'job' is the generic lane (N3.2): merges, the named-subject library scan, and any future
    // one-off long op that doesn't fit the catalog/import stage lists. It carries its OWN label
    // (activity.label) and cancel callback (activity.cancelFn) instead of STAGE_LABELS/a fixed
    // cancel command — unifying the SCHEMA (kind/stage/done/total/current + one visible place)
    // without forcing every job through the catalog-scan-shaped stage list it doesn't have.
    const isGenericJob = activity.kind !== 'import' && activity.kind !== 'catalog';
    const label = isGenericJob
      ? (activity.stage === 'done' ? (activity.label || 'Job') + ' done' : (activity.label || 'Working') + '…')
      : activity.stage === 'done'
      ? (activity.kind === 'import' ? 'Imported' : 'Indexed') + (activity.total ? ` ${activity.total}` : '')
      : activity.stage === 'walk' && !activity.total && activity.done
      ? `Indexing… ${activity.done.toLocaleString()} found`
      : (STAGE_LABELS[activity.stage] || 'Working') + '…';
    // ⚠️ The ring + "· NN%" text alone doesn't read as "there's a progress bar" — a real user
    // testing N4 didn't recognize it as one and had to be told to click-to-expand to see the
    // actual `.lib-act-bar`. Show that same bar markup in the COLLAPSED pill too, not only once
    // expanded, so "is this doing something" is answerable at a glance. Kept out of the `<span>`
    // pill itself (a bar under inline text needs its own block) — sits directly under the pill.
    const collapsedBar = !activity.expanded && activity.stage !== 'done' && activity.total
      ? `<div class="lib-act-bar" style="position:absolute;left:0;right:0;top:100%;margin:2px 0 0"><div style="width:${pct}%"></div></div>` : '';
    let html = `<span class="lib-act-pill" id="lib-act-pill" style="position:relative">
      <span class="lib-act-ring" style="--p:${pct}%"></span><span>${esc(label)}${activity.stage !== 'done' && activity.total ? ` · ${pct}%` : ''}</span>${collapsedBar}`;
    if (activity.expanded && isGenericJob) {
      const bar = activity.stage !== 'done' && activity.total
        ? `<div class="lib-act-bar"><div style="width:${Math.round((activity.done / activity.total) * 100)}%"></div></div>` : '';
      html += `<div class="lib-act-pop" onclick="event.stopPropagation()">
        <div class="lib-act-pop-head"><span>${esc(activity.label || 'Job')}</span>
          <span class="lib-act-pop-cancel" id="lib-act-cancel">${activity.stage === 'done' ? 'Dismiss' : (activity.cancelFn ? 'Cancel' : '')}</span></div>
        <div class="lib-act-pop-body">
          <div class="lib-act-stage active"><span style="width:12px;display:inline-block;text-align:center">${activity.stage === 'done' ? '✓' : '›'}</span><span>${esc(activity.current || activity.label || 'Working')}</span><span class="lib-act-stage-n">${activity.stage === 'done' ? '' : (activity.total ? `${activity.done} of ${activity.total}` : '')}</span></div>${bar}
        </div></div>`;
    } else if (activity.expanded) {
      const stages = STAGE_ORDER.filter((s) => s === 'copy' ? activity.kind === 'import' : activity.kind === 'catalog');
      const activeIdx = stages.indexOf(activity.stage);
      html += `<div class="lib-act-pop" onclick="event.stopPropagation()">
        <div class="lib-act-pop-head"><span>${activity.stage === 'done'
            ? (activity.kind === 'import' ? 'Imported' : 'Indexed')
            : (activity.kind === 'import' ? 'Importing' : 'Indexing library')}</span>
          <span class="lib-act-pop-cancel" id="lib-act-cancel">${activity.stage === 'done' ? 'Dismiss' : 'Cancel'}</span></div>
        <div class="lib-act-pop-body">`
        + stages.map((s, i) => {
          const cls = activity.stage === 'done' || i < activeIdx ? '' : i === activeIdx ? 'active' : '';
          const icon = activity.stage === 'done' || i < activeIdx ? '✓' : i === activeIdx ? '›' : '·';
          const n = i === activeIdx && activity.stage !== 'done' ? `${activity.done} of ${activity.total}` : (i < activeIdx || activity.stage === 'done' ? '' : 'queued');
          const bar = i === activeIdx && activity.stage !== 'done' && activity.total
            ? `<div class="lib-act-bar"><div style="width:${Math.round((activity.done / activity.total) * 100)}%"></div></div>` : '';
          return `<div class="lib-act-stage ${cls}"><span style="width:12px;display:inline-block;text-align:center">${icon}</span><span>${STAGE_LABELS[s]}</span><span class="lib-act-stage-n">${n}</span></div>${bar}`;
        }).join('')
        + `</div>`
        + (activity.failed && activity.failed.length
          ? `<div style="padding:8px 11px;border-top:1px solid var(--bdr);background:rgba(229,72,77,.08)">`
            + activity.failed.slice(0, 8).map((f) => `<div style="font-size:10px;color:var(--mut);padding:1px 0">${esc(f)}</div>`).join('')
            + (activity.failed.length > 8 ? `<div style="font-size:10px;color:var(--mut)">…and ${activity.failed.length - 8} more</div>` : '')
            + `</div>`
          : '')
        + `</div>`;
    }
    html += `</span>`;
    el.innerHTML = html;
    const pill = document.getElementById('lib-act-pill');
    if (pill) pill.onclick = (e) => { e.stopPropagation(); activity.expanded = !activity.expanded; renderActivity(); };
    // The pill sits near the LEFT of the bottom bar (lib-count/thumb-progress/status-labels all
    // come before it), but .lib-act-pop's CSS was a plain right:0 — meaning "align the popover's
    // right edge to the pill's right edge", i.e. extend LEFTWARD from a pill that's often close
    // to x=0. A 260px-wide popover from a pill near the left edge runs straight off the left side
    // of the window — reported live, not hypothetical. #lib-filters-pop's right:0 is safe because
    // its own trigger button is anchored at the far right of its row; this pill has no such
    // guarantee, so it needs a real viewport clamp instead of a fixed-corner CSS assumption.
    const pop = pill && pill.querySelector('.lib-act-pop');
    if (pop) {
      const pr = pill.getBoundingClientRect();
      const pw = pop.offsetWidth || 260;
      const margin = 8;
      let desiredLeft = pr.right - pw; // default: right-aligned to the pill, same as before
      desiredLeft = Math.max(margin, Math.min(desiredLeft, window.innerWidth - pw - margin));
      pop.style.left = (desiredLeft - pr.left) + 'px';
      pop.style.right = 'auto';
    }
    const cancelBtn = document.getElementById('lib-act-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        if (activity.stage === 'done') { activity.visible = false; renderActivity(); return; }
        if (activity.kind === 'catalog') invoke('catalog_scan_cancel').catch(() => {});
        else if (typeof activity.cancelFn === 'function') { try { activity.cancelFn(); } catch (e) {} }
        activity.expanded = false;
        renderActivity();
      };
    }
  }

  function activityUpdate(kind, patch) {
    if (_activityClearTimer) { clearTimeout(_activityClearTimer); _activityClearTimer = null; }
    activity = { ...activity, kind, visible: true, ...patch };
    renderActivity();
    if (activity.stage === 'done') {
      // Failures (a nonempty failure list on the import side) don't auto-clear — the whole
      // point of surfacing this at all is so "3 files failed" isn't something only the console
      // saw. A clean finish clears itself after a few seconds so it doesn't linger forever.
      const hasFailures = kind === 'import' && activity.failed && activity.failed.length;
      if (!hasFailures) {
        _activityClearTimer = setTimeout(() => { activity.visible = false; renderActivity(); }, 8000);
      }
    }
  }

  if (LIBTEST) {
    // No real backend under libtest to fire real catalog-scan/ingest-progress events — this is
    // the same "manual debug trigger" pattern window.libtestLrConnect() already uses, so the
    // indicator's in-progress/done/failed states are screenshot-verifiable without one.
    window.libtestFireActivity = (state) => {
      if (state === 'progress') activityUpdate('catalog', { stage: 'metadata', done: 40, total: 120 });
      else if (state === 'done') activityUpdate('catalog', { stage: 'done', done: 120, total: 120 });
      else if (state === 'import-failed') activityUpdate('import', { stage: 'done', done: 21, total: 24, failed: ['P1000512.RW2: read error', 'P1000513.RW2: read error', 'P1000889.RW2: disk full'] });
    };
    // Same reasoning: the info panel's own trigger is the 'i' keyboard shortcut, gated on
    // state.open (the docked/deskx harness never goes through toggleLibrary(), so state.open
    // is never true here) — this is what makes the keyword-chip editor screenshot-verifiable.
    window.libtestShowInfoPanel = (path) => { state._kbCursor = path; state.showInfo = true; renderInfoPanel(); };
    // Same reasoning: Quick Look's real trigger (Space) is gated on state.open, which the
    // docked/deskx harness never sets.
    window.libtestShowQuickLook = (path) => showQuickLook(path);
  }

  /// Mirrors a catalog-scan progress event onto the BOOT SPLASH specifically — separate from the
  /// ordinary activity pill, which only exists once the app's own chrome has rendered. A no-op
  /// once `#boot-splash` is gone (the common case: every scan after the first one during a
  /// session), so this costs nothing outside the one moment it exists for.
  window._bootStageLabelFor = (phase) => STAGE_LABELS[phase] || phase || 'Indexing';
  // ⚠️ One bar for the whole boot sequence — chromasmith-22.html's bootProgressSet owns the
  // actual bar width (weighted phase slices + a monotonic guard so it can never visibly regress
  // or restart; see its own comment). This function's job is now just: forward the raw event
  // there, and render a label that reads as ONE ongoing process rather than a new phase starting
  // over each time — "Preparing your library… 62%", not "Reading photo info… 4,201 / 9,800" that
  // then jumps to a differently-worded, differently-scaled line a moment later.
  function updateBootSplashProgress(p) {
    const wrap = document.getElementById('boot-splash-progress');
    if (!wrap) return;
    // Read by chromasmith-22.html's watchdog if it fires while this splash is still up, so the
    // stall banner can name the actual stage instead of a generic "startup".
    window._bootLastPhase = p.phase;
    if (typeof window.bumpBootSplashWatchdog === 'function') window.bumpBootSplashWatchdog(8000);
    if (typeof window.bootProgressSet === 'function') window.bootProgressSet(p.phase, p.done || 0, p.total || 0);
    const label = document.getElementById('boot-splash-label');
    if (!label) return;
    const shown = typeof window._bootShownPct === 'number' ? Math.round(window._bootShownPct) : 0;
    label.textContent = shown > 0 ? `Preparing your library… ${shown}%` : 'Preparing your library…';
  }
  function wireActivityListeners() {
    if (!window.__TAURI__ || !window.__TAURI__.event) return; // LIBTEST's mock listen() is a harmless no-op
    window.__TAURI__.event.listen('catalog-scan', (ev) => {
      const p = ev.payload || {};
      activityUpdate('catalog', { stage: p.phase, done: p.done || 0, total: p.total || 0, current: p.current || '' });
      updateBootSplashProgress(p);
      if (p.phase === 'done') refreshCatalogCounts();
    }).catch(() => {});
    window.__TAURI__.event.listen('ingest-progress', (ev) => {
      const p = ev.payload || {};
      const done = p.total && p.done >= p.total ? p.total : p.done;
      activityUpdate('import', { stage: p.total && done >= p.total ? 'done' : 'copy', done, total: p.total || 0, current: p.current || '' });
    }).catch(() => {});
    // N3.2: the generic lane for anything that isn't a catalog scan or a card import — today
    // that's merge.rs's HDR/focus/astro/panorama commands (main.rs emits this alongside them,
    // coarse phase-level since their inner loops are numerical pyramids not worth instrumenting
    // per-pixel — see ROADMAP.md's N3 writeup). Schema is the SAME {phase,done,total,current}
    // shape as catalog-scan, plus a `job`/`label` so this one event name can carry many kinds of
    // work without a new event per feature.
    window.__TAURI__.event.listen('job-progress', (ev) => {
      const p = ev.payload || {};
      activityUpdate(p.job || 'job', { label: p.label || p.job, stage: p.phase || 'working', done: p.done || 0, total: p.total || 0, current: p.current || '' });
    }).catch(() => {});
  }

  /// Public entry point for JS-side long-running ops that aren't Rust events — the Named-Subject
  /// "Find across library" scan (chromasmith-22.html's subjFindAll) previously ran a bespoke
  /// _subjScanBusy/_subjScanProgress pair with its own inline panel and nothing in the shared
  /// activity indicator, so it was invisible from anywhere else in the app (ROADMAP N3.2). It
  /// keeps its own inline per-photo results list (that UI has no equivalent in this generic
  /// pill), but now ALSO mirrors progress here so there's one consistent place showing "is
  /// anything running" regardless of which feature started it. `patch.cancelFn`, if given, wires
  /// the pill's own Cancel button; omit it for a job with no cancel path.
  window.libActivityJob = function (job, patch) { activityUpdate(job, patch || {}); };
  window.libActivityJobDone = function (job, extra) { activityUpdate(job, { stage: 'done', ...(extra || {}) }); };

  // ── N3.3: shared blocking-wait modal — the FALLBACK UI ──────────────────────────────────────
  // Every long-running op in the N3 inventory (catalog scans via N3.1's reader/writer split,
  // merges via spawn_blocking, the subject scan, stills/video export/tiled render) is already
  // non-blocking by construction, so nothing in this codebase calls this today — see ROADMAP.md's
  // N3 writeup for the honest "found none" note. It exists as a real, ready-to-use escape hatch
  // for the rare FUTURE op that genuinely can't be made safe to run alongside other work: an
  // unmissable centered <dialog> (same construction as `lib-offq-modal` above — plain
  // `document.createElement('dialog')` + inline styles, no framework) stating what's running and
  // that the app must wait, with the SAME progress-bar markup class (`.lib-act-bar`) the activity
  // pill already uses so a viewer sees one consistent progress-bar look everywhere in the app.
  // ⚠️ Deliberately NOT wired to any job automatically — a caller opens it explicitly
  // (`libBlockingWaitModal.show(label)`), then feeds it progress via the SAME `libActivityJob`
  // schema (`libBlockingWaitModal.update({done,total,current})`), then closes it
  // (`libBlockingWaitModal.hide()`) when the op finishes. Using this for something that COULD run
  // concurrently with other work is a regression, not a shortcut — N3.2's non-modal panel is the
  // default and should be tried first.
  window.libBlockingWaitModal = (() => {
    let dlg = null;
    function ensure() {
      if (dlg) return dlg;
      dlg = document.createElement('dialog');
      dlg.id = 'lib-blocking-wait-modal';
      dlg.style.cssText = 'border:1px solid var(--bdr);border-radius:10px;background:var(--bg);color:var(--txt);padding:18px 20px;max-width:420px;width:90vw;font-family:var(--sans);box-shadow:var(--lift-2)';
      dlg.innerHTML = '<div id="lib-bwm-title" style="font-size:13px;font-weight:600;margin-bottom:6px"></div>'
        + '<div id="lib-bwm-sub" style="font-size:12px;color:var(--mut);margin-bottom:12px">Please wait — this can\'t run alongside other work.</div>'
        + '<div class="lib-act-bar" style="margin-bottom:6px"><div id="lib-bwm-bar" style="width:0%"></div></div>'
        + '<div id="lib-bwm-current" style="font-size:11px;color:var(--mut)"></div>';
      document.body.appendChild(dlg);
      // No close button/Escape handler on purpose — this models a genuine "the app must wait"
      // state, not a dismissible notice. Dismissal happens only via hide(), called by the caller
      // once the blocking op actually finishes.
      dlg.addEventListener('cancel', (e) => e.preventDefault());
      return dlg;
    }
    return {
      show(label) { const d = ensure(); d.querySelector('#lib-bwm-title').textContent = label || 'Working…'; d.querySelector('#lib-bwm-bar').style.width = '0%'; d.querySelector('#lib-bwm-current').textContent = ''; if (!d.open) d.showModal(); },
      update({ done, total, current } = {}) { const d = ensure(); const pct = total ? Math.round((done / total) * 100) : 0; d.querySelector('#lib-bwm-bar').style.width = pct + '%'; d.querySelector('#lib-bwm-current').textContent = current || (total ? `${done} of ${total}` : ''); },
      hide() { if (dlg && dlg.open) dlg.close(); },
    };
  })();

  async function openCatalogView(scope) {
    state.source = 'catalog';
    state.catalogScope = scope || 'all';
    state.selected.clear();
    const grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let page;
    try {
      // Scope encoding: 'all', or 'date:YYYY', 'date:YYYY:M', 'date:YYYY:M:D' — parsed here
      // rather than passed as separate arguments so state.catalogScope stays one plain string,
      // the same shape a saved view or a URL could carry.
      const dateParts = scope && scope.startsWith('date:') ? scope.slice(5).split(':').map(Number) : null;
      const kwPath = scope && scope.startsWith('kw:') ? scope.slice(3) : null;
      const personId = scope && scope.startsWith('person:') ? parseInt(scope.slice(7), 10) : null;
      const q = { kind: null, text: null, includeOffline: true, limit: null,
        year: dateParts ? dateParts[0] : null, month: dateParts ? (dateParts[1] || null) : null, day: dateParts ? (dateParts[2] || null) : null,
        noDate: scope === 'date-nodate', blurryOnly: scope === 'blurry', keywords: kwPath ? [kwPath] : [], personId };
      page = await invoke('catalog_query', { q });
    } catch (e) {
      grid.innerHTML = '<div id="lib-empty">Could not load the catalog.</div>';
      return;
    }
    // Splice in any stack the user has expanded — the grouped query above always returns ONE
    // row per stack, so an expansion the user asked for (badge click, tracked in
    // state._expandedStacks by the stack's leader id) has to be fetched separately and spliced
    // back into place. Best-effort: if the expansion fetch fails, the row just stays collapsed
    // rather than blocking the whole view.
    let entries = page.entries;
    if (state._expandedStacks.size) {
      const spliced = [];
      for (const entry of entries) {
        if (entry.stack_n > 1 && state._expandedStacks.has(entry.id)) {
          try {
            const sub = await invoke('catalog_query', { q: { expandStack: entry.id } });
            spliced.push(...sub.entries);
            continue;
          } catch (e) { /* fall through — show the collapsed row instead */ }
        }
        spliced.push(entry);
      }
      entries = spliced;
    }
    state.entries = entries;
    if (!entries.length) {
      grid.innerHTML = '<div id="lib-empty">Nothing here — open a folder in the Library and it\'ll appear here.</div>';
      renderCollections();
      return;
    }
    // ⚠️ Meta is loaded in the BACKGROUND, same split openFolder already uses and for the exact
    // same reason (its own comment: "get_meta cache miss reads the whole RAW file... awaiting it
    // for EVERY file kept the grid on Loading... until the last file finished"). This scope can
    // be a whole YEAR or "All Photos" across the entire library — unlike the album/exported/
    // search views that share this general shape, catalog_query here has no natural size cap, so
    // awaiting a full getMetaBatch before ANY render was a single, silent, potentially
    // many-thousand-file IPC call with no progress signal at all: no activity pill (that's
    // catalog_scan, a different command), no thumb-progress readout (nothing had been queued for
    // thumbnails yet, since renderGrid hadn't run), nothing — exactly "taking forever with zero
    // indication of what's happening." Sidecars stay awaited (small JSON reads, needed for
    // flags/edited badges to be right on first paint); the openToken guard below is the same
    // "user moved on" check openFolder's own background meta pass uses.
    const openToken = (state._openToken = (state._openToken || 0) + 1);
    {
      const paths = entries.filter((e) => !e.offline).map((e) => e.path);
      await getSidecarsBatch(paths);
      getMetaBatch(paths).then(() => {
        if (state._openToken !== openToken || state.source !== 'catalog') return; // user moved on
        renderGrid();
      });
    }
    await renderGrid();
    renderCollections();
  }

  /// Toggles a stack's expanded/collapsed state (the badge's click handler) and re-renders via
  /// the same path a filter change uses, so the splice-in logic above is the only place that
  /// needs to know about expansion at all.
  function toggleStackExpanded(leaderId) {
    if (state._expandedStacks.has(leaderId)) state._expandedStacks.delete(leaderId);
    else state._expandedStacks.add(leaderId);
    refreshView();
  }

  /// The one thing every post-mutation refresh (delete, duplicate, ...) should call instead of
  /// reaching for `openFolder` directly. Before this existed, three call sites each hard-coded
  /// `if (state.currentFolder) await openFolder(state.currentFolder)` — which is a silent no-op
  /// in a catalog view (`state.currentFolder` is '' there), so deleting a photo from All Photos
  /// would leave it sitting in the grid looking undeleted until something else forced a
  /// re-render. This knows about every scope the grid can currently be showing.
  function refreshView() {
    if (state.source === 'catalog') return openCatalogView(state.catalogScope);
    if (state.currentFolder) return openFolder(state.currentFolder);
    return renderGrid();
  }

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

  const FOLDER_PICK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 11v6M9 14h6"/></svg>';

  /// Lets a non-DCIM card reader or a plain external-drive folder reach the same import sheet a
  /// detected card does. `refreshVolumes()` only surfaces volumes with a DCIM folder — this row
  /// is the ONLY way anything else (a card that doesn't create DCIM, or importing from a folder
  /// that isn't a card at all) can reach `openImportPanel`. Always shown, not gated on any
  /// volume being detected, so it works even with nothing currently plugged in.
  async function pickImportFolder() {
    try {
      const chosen = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false } });
      const path = Array.isArray(chosen) ? chosen[0] : chosen;
      if (path) openImportPanel(path);
    } catch (e) { console.error('pick import folder', e); }
  }

  function devicesSectionHtml() {
    const rows = cardState.volumes.map((v) => `
      <div class="lib-coll-row lib-card-row" data-card="${esc(v.path)}" title="${esc(v.path)} — click to import">
        <span class="lib-coll-ic">${CARD_SVG}</span><span class="lib-coll-lb">${esc(v.name)}</span>
        <span class="lib-coll-count">${v.total_bytes ? fmtBytes(v.total_bytes - v.free_bytes) : ''}</span>
      </div>`).join('');
    const pickRow = `
      <div class="lib-coll-row lib-card-row" data-card-pick="1" title="Import from any folder — a card reader without DCIM, or an existing external drive">
        <span class="lib-coll-ic">${FOLDER_PICK_SVG}</span><span class="lib-coll-lb">Choose folder…</span>
      </div>`;
    return '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Devices</div>' + rows + pickRow;
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
    // scan_card now runs off the main thread and emits progress as it walks — a real card with
    // thousands of RAWs (each needing an EXIF read for its capture date) can take a while, and
    // the static "Scanning card..." label used to be the ONLY thing on screen for that whole time
    // with zero feedback, indistinguishable from a hang. See ingest.rs's ScanProgress.
    let scanUnlisten = null;
    if (window.__TAURI__?.event) {
      scanUnlisten = await window.__TAURI__.event.listen('scan-progress', (ev) => {
        const p = ev.payload || {};
        const sub = document.getElementById('imp-sub');
        if (sub) sub.textContent = `Scanning card... ${p.scanned || 0} files found` + (p.current ? ` (${p.current})` : '');
      });
    }
    try {
      files = await invoke('scan_card', { path: cardPath, destRoot: prefs.dest || null });
    } catch (e) {
      document.getElementById('imp-sub').textContent = 'Could not read this card: ' + String(e.message || e);
      return;
    } finally {
      if (scanUnlisten) scanUnlisten();
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

    // ── Item 2: day-grouped, thumbnail preview + subset select ──────────────────────────────
    // Previously every file on the card was always imported — no way to preview what's actually
    // there or pick a subset before copying. `scan_card` already returns a per-file capture DATE
    // (EXIF DateTimeOriginal, not file mtime — see this file's own header comment) and `ingest_run`
    // already accepts an `options.only` path allowlist (added for exactly this, never wired up
    // from the UI until now) — so this is purely a frontend feature, no backend change needed.
    // Selection defaults to "everything checked" (the common case is importing the whole card);
    // unchecking is the exception, not the default.
    const selected = new Set(files.map((f) => f.path));
    // Calendar day, local time (grouping decision) — a shoot spanning midnight shows as two
    // groups, matching how every calendar/date UI already works; no configurable day-start.
    const dayGroups = new Map(); // 'YYYY-MM-DD' | '\0nodate' -> CardFile[]
    for (const f of files) {
      const k = f.date || '\0nodate';
      if (!dayGroups.has(k)) dayGroups.set(k, []);
      dayGroups.get(k).push(f);
    }
    // Newest first, throughout: most recent shoot day at the top, and within a day the
    // last-shot-of-the-day tile first too (files arrive from scan_card name-sorted ascending,
    // i.e. capture order, so reversing each day's array is enough — no per-file timestamp to
    // sort by, only a per-file DAY string). "No capture date" always sits last regardless of
    // sort direction — it's the least reliable group, not "the newest".
    const dayKeys = [...dayGroups.keys()].filter((k) => k !== '\0nodate').sort().reverse();
    if (dayGroups.has('\0nodate')) dayKeys.push('\0nodate');
    for (const k of dayKeys) dayGroups.get(k).reverse();
    const flat = dayKeys.flatMap((k) => dayGroups.get(k)); // stable order for shift-click range select
    const pathIdx = new Map(flat.map((f, i) => [f.path, i]));
    let rangeAnchor = -1;
    // Item request: thumbnails hidden by default, per-day expand reveals them (and is what
    // actually triggers the lazy thumbnail fetch below — a collapsed day's tiles are never even
    // created, not just visually hidden, so its thumbnails are never requested until expanded).
    const expandedDays = new Set();
    function dayLabel(k) {
      if (k === '\0nodate') return 'No capture date';
      const d = new Date(k + 'T00:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    }
    function updateSelSummary() {
      const selFiles = files.filter((f) => selected.has(f.path));
      const selBytes = selFiles.reduce((a, f) => a + (f.size || 0), 0);
      const el = document.getElementById('imp-sub');
      if (el) el.innerHTML = `${selFiles.length} of ${files.length} selected · ${fmtBytes(selBytes)} · ${esc(span)}` +
        (dupes ? ` · <span style="color:var(--acc)">${dupes} already imported</span>` : '');
      const go = document.getElementById('imp-go');
      if (go) go.disabled = selFiles.length === 0;
      if (go) go.style.opacity = selFiles.length === 0 ? '.5' : '';
    }
    function tileEl(f) {
      const path = f.path;
      const el = document.createElement('div');
      el.className = 'imp-tile';
      el.dataset.path = path;
      el.style.cssText = 'position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;background:var(--sur2);cursor:pointer;flex:0 0 auto';
      el.innerHTML = `<div class="imp-tile-img" style="width:100%;height:100%;background:#000 center/cover no-repeat"></div>
        <div class="imp-tile-check" style="position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,.55);border:1.5px solid rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center">
          <svg class="imp-tile-mark" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="3" style="display:${selected.has(path) ? '' : 'none'}"><path d="M4 12l5 5L20 6"/></svg>
        </div>
        ${f.duplicate ? '<div style="position:absolute;bottom:2px;right:3px;font-size:9px;color:#fff;background:rgba(0,0,0,.6);border-radius:3px;padding:0 3px">dup</div>' : ''}
        <div style="position:absolute;bottom:2px;left:3px;right:${f.duplicate ? '22px' : '3px'};font-size:9px;color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>`;
      el.classList.toggle('imp-tile-sel', selected.has(path));
      el.onclick = (ev) => {
        const idx = pathIdx.get(path);
        if (ev.shiftKey && rangeAnchor >= 0) {
          const [lo, hi] = [rangeAnchor, idx].sort((a, b) => a - b);
          for (let i = lo; i <= hi; i++) selected.add(flat[i].path);
        } else {
          if (selected.has(path)) selected.delete(path); else selected.add(path);
          rangeAnchor = idx;
        }
        renderTiles();
        updateSelSummary();
      };
      return el;
    }
    // Lazy thumbnail load, same tiered fast(embedded-JPEG)/fallback(decode) invoke pattern the
    // main Library grid already uses (get_thumbnail_fast -> get_thumbnail_or_offline) — proven
    // to work for RAW/JPEG/HEIC alike, so reused as-is rather than a new thumbnail path.
    const thumbUrls = [];
    let thumbActive = 0;
    const thumbQueue = [];
    function pumpThumbs() {
      while (thumbActive < 4 && thumbQueue.length) {
        const job = thumbQueue.shift();
        if (!job.el.isConnected) continue;
        thumbActive++;
        invoke('get_thumbnail_fast', { path: job.path }).catch(() => null)
          .then((fastBuf) => {
            if (fastBuf) return fastBuf;
            return invoke('get_thumbnail_or_offline', { path: job.path }).catch(() => null);
          })
          .then((buf) => {
            if (buf && job.el.isConnected) {
              const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
              thumbUrls.push(url);
              const img = job.el.querySelector('.imp-tile-img');
              if (img) img.style.backgroundImage = `url(${url})`;
            }
          })
          .catch(() => {})
          .finally(() => { thumbActive--; pumpThumbs(); });
      }
    }
    let tileIO = null;
    function renderTiles() {
      const host = document.getElementById('imp-days');
      if (!host) return;
      if (tileIO) tileIO.disconnect();
      thumbQueue.length = 0;
      host.innerHTML = '';
      tileIO = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) {
          const path = e.target.dataset.path;
          thumbQueue.push({ path, el: e.target });
          tileIO.unobserve(e.target);
        }
        pumpThumbs();
      }, { root: host, rootMargin: '150px' });
      for (const k of dayKeys) {
        const dayFiles = dayGroups.get(k);
        const dayAllSel = dayFiles.every((f) => selected.has(f.path));
        const daySomeSel = dayFiles.some((f) => selected.has(f.path));
        const dayBytes = dayFiles.reduce((a, f) => a + (f.size || 0), 0);
        const isOpen = expandedDays.has(k);
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 2px;cursor:pointer;font-size:12px;font-weight:600;margin-top:6px';
        head.innerHTML = `<input type="checkbox" ${dayAllSel ? 'checked' : ''} style="width:15px;height:15px">
          <span class="imp-day-chev" style="display:inline-flex;transition:transform .12s ease;transform:rotate(${isOpen ? '90' : '0'}deg)">${ic('chevron', 12)}</span>
          <span>${esc(dayLabel(k))}</span><span style="font-weight:400;color:var(--mut)">${dayFiles.length} · ${fmtBytes(dayBytes)}</span>`;
        const headCb = head.querySelector('input');
        if (!dayAllSel && daySomeSel) headCb.indeterminate = true;
        const toggleSelectDay = () => {
          const willSelect = !dayAllSel;
          for (const f of dayFiles) { if (willSelect) selected.add(f.path); else selected.delete(f.path); }
          renderTiles(); updateSelSummary();
        };
        const toggleExpandDay = () => {
          if (expandedDays.has(k)) expandedDays.delete(k); else expandedDays.add(k);
          renderTiles();
        };
        // Checkbox selects/deselects the day; clicking the rest of the row expands/collapses it
        // (browsing and selecting are different intents — a day you don't want to open at all
        // should still be selectable/deselectable in bulk without paying for its thumbnails).
        headCb.onclick = (ev) => { ev.stopPropagation(); toggleSelectDay(); };
        head.onclick = (ev) => { if (ev.target !== headCb) toggleExpandDay(); };
        host.appendChild(head);
        if (isOpen) {
          const grid = document.createElement('div');
          grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 4px';
          for (const f of dayFiles) { const t = tileEl(f); grid.appendChild(t); tileIO.observe(t); }
          host.appendChild(grid);
        }
      }
    }

    const row = (label, html, hint) => `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;color:var(--mut);margin-bottom:4px">${label}</div>
        ${html}${hint ? `<div style="font-size:11px;color:var(--mut);margin-top:3px">${hint}</div>` : ''}</div>`;
    const inputCss = 'width:100%;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:7px;padding:7px 9px;font-size:12px;font-family:var(--sans)';
    document.getElementById('imp-body').innerHTML =
      row('Photos', `<div style="display:flex;gap:6px;margin-bottom:6px">
          <button id="imp-select-all" type="button" style="background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer">Select all</button>
          <button id="imp-select-none" type="button" style="background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer">Deselect all</button>
        </div>
        <div id="imp-days" style="max-height:260px;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:4px 8px"></div>`,
        'Click a day to expand it, its checkbox to select/deselect it, a photo to toggle it, shift-click for a range.')
      + row('Copy to', `<div style="display:flex;gap:6px"><input id="imp-dest" style="${inputCss}" value="${esc(prefs.dest || '')}" placeholder="Choose a destination folder…" readonly>
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
          <button id="imp-backup-clear" title="Clear" style="background:var(--sur2);border:1px solid var(--bdr);color:var(--mut);border-radius:7px;padding:7px 9px;cursor:pointer;display:inline-flex;align-items:center">${ic('close', 14)}</button></div>`,
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
    $('imp-select-all').onclick = () => { for (const f of files) selected.add(f.path); renderTiles(); updateSelSummary(); };
    $('imp-select-none').onclick = () => { selected.clear(); renderTiles(); updateSelSummary(); };
    renderTiles();
    updateSelSummary();
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
      if (selected.size === 0) return; // imp-go is disabled in this state too; belt and suspenders
      const opts = {
        destRoot: dest,
        backupRoot: $('imp-backup').value.trim() || null,
        folderTemplate: $('imp-folder').value,
        filenameTemplate: $('imp-name').value,
        skipDuplicates: $('imp-skip').checked,
        only: selected.size === files.length ? [] : [...selected], // [] means "everything" server-side; only send a real allowlist when it's a genuine subset
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
        // ingest_run re-verifies duplicate flags against the CURRENT destination itself
        // (the user may have changed "Copy to" after the scan above), so it's safe to hand
        // back exactly what scan_card returned rather than re-scanning the card here too.
        const res = await invoke('ingest_copy', { files, options: opts });
        if (unlisten) unlisten();
        cardState.scanning = false;
        const failed = (res.failed || []).length;
        const dupNote = res.duplicates_skipped ? ` · ${res.duplicates_skipped} already imported, skipped` : '';
        if (typeof toast === 'function') {
          toast(failed
            ? `Imported ${res.copied} of ${res.copied + failed} — ${failed} failed${dupNote}`
            : `Imported ${res.copied} file${res.copied === 1 ? '' : 's'} (${fmtBytes(res.bytes)})${dupNote}`, !failed);
        }
        // Per-file failures are listed, not summarised away: a card that dropped three files is
        // exactly when the user needs to know WHICH three before formatting it. Surfaced in the
        // activity popover too (not just the console) — that's the one place this stays visible
        // after the import modal itself has been closed, and is why activityUpdate's own
        // hasFailures check keys off this exact field instead of auto-clearing.
        if (failed) console.warn('import failures:', res.failed);
        activityUpdate('import', { stage: 'done', done: res.copied, total: res.copied + failed, failed: res.failed || [] });
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

  // ── Albums: user-made collections that LINK to photos rather than copying them ─────────────
  // Every collection above this is DERIVED (edited/favorites/exported/rejected are each computed
  // from a per-photo fact). An album is the missing manual one: "these 40 frames are the Geneva
  // set", with no way to say that short of moving files on disk.
  //
  // ⚠️ It stores PATHS, never pixels (see library.rs's album_* commands). A photo can sit in any
  // number of albums at full quality, and deleting an album cannot lose a photograph. The cost is
  // that an album goes stale if a file is moved outside the app — handled by `missing` entries
  // rather than by silently dropping them.
  let _albums = [];
  function albumsSectionHtml() {
    const rows = _albums.map((a) => `
      <div class="lib-coll-row${state.source === 'album:' + a.id ? ' on' : ''}" data-album="${a.id}" title="${esc2(a.name)} — ${a.paths.length} photo${a.paths.length === 1 ? '' : 's'}">
        <span class="lib-coll-ic">${ALBUM_SVG}</span><span class="lib-coll-lb">${esc2(a.name)}</span>
        <span class="lib-coll-count">${a.paths.length || ''}</span>
      </div>`).join('');
    return '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Albums'
      + `<span id="lib-album-new" title="New album" style="float:right;cursor:pointer;padding:0 4px">+</span>`
      + '</div>' + (rows || '<div class="lib-coll-row" style="opacity:.5;cursor:default">No albums yet</div>');
  }
  const ALBUM_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H3z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2"/></svg>';
  async function refreshAlbums() {
    _albums = await invoke('album_list').catch(() => []);
    renderCollections();
  }
  function wireAlbumRows(host) {
    const nb = host.querySelector('#lib-album-new');
    if (nb) nb.onclick = async (e) => {
      e.stopPropagation();
      const name = await window.askTextModal('Album name', '', '');
      if (!name) return;
      try { await invoke('album_create', { name }); await refreshAlbums(); toast(`Album "${name}" created`, true); }
      catch (err) { toast(humanizeErr('create the album', err), 'err'); }
    };
    host.querySelectorAll('.lib-coll-row[data-album]').forEach((row) => {
      const id = row.dataset.album;
      row.onclick = () => openAlbumView(id);
      row.oncontextmenu = (e) => { e.preventDefault(); showAlbumMenu(e, id); };
      // Same drag contract the Favorites/Flagged/Rejected rows use, so dropping onto an album is
      // the same gesture with the same data — it just appends to a list instead of setting a flag.
      row.ondragover = (e) => {
        if (!Array.from(e.dataTransfer.types || []).includes('application/x-chromasmith-paths')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        row.classList.add('lib-coll-dragover');
      };
      row.ondragleave = () => row.classList.remove('lib-coll-dragover');
      row.ondrop = async (e) => {
        e.preventDefault();
        row.classList.remove('lib-coll-dragover');
        let paths = [];
        try { paths = JSON.parse(e.dataTransfer.getData('application/x-chromasmith-paths') || '[]'); } catch { /* ignore */ }
        if (!paths.length) return;
        const added = await invoke('album_add', { id, paths }).catch((err) => { toast(humanizeErr('add to the album', err), 'err'); return 0; });
        await refreshAlbums();
        // Says what actually happened: re-dragging photos already in an album is a common gesture
        // and reporting "3 added" when nothing changed would be a lie.
        const dup = paths.length - added;
        toast(added
          ? `${added} added${dup ? `, ${dup} already there` : ''}`
          : `Already in this album`, true);
      };
    });
  }
  async function openAlbumView(id) {
    state.source = 'album:' + id;
    lrState.album = null;
    state.selected.clear();
    grid = document.getElementById('lib-grid');
    grid.innerHTML = libSkeletonHtml();
    let entries;
    try { entries = await invoke('list_album', { id }); }
    catch (e) { grid.innerHTML = '<div id="lib-empty">Could not load this album.</div>'; return; }
    state.entries = entries;
    {
      const paths = entries.filter((e) => !e.missing).map((e) => e.path);
      await Promise.all([getSidecarsBatch(paths), getMetaBatch(paths)]);
    }
    await renderGrid();
    renderCollections();
    const missing = entries.filter((e) => e.missing).length;
    if (missing) toast(`${missing} photo${missing === 1 ? '' : 's'} in this album can't be found on disk`, false);
  }
  function showAlbumMenu(e, id) {
    const a = _albums.find((x) => x.id === id);
    if (!a) return;
    const items = [
      ['Rename…', async () => {
        const name = await window.askTextModal('Rename album', '', a.name);
        if (!name) return;
        try { await invoke('album_rename', { id, name }); await refreshAlbums(); }
        catch (err) { toast(humanizeErr('rename the album', err), 'err'); }
      }],
      [`Delete "${a.name}"`, async () => {
        // Deliberately blunt about what is and isn't destroyed — the whole point of an album is
        // that throwing it away is safe, and the user should know that before confirming.
        // confirmModal, never window.confirm — see the "Reset edit" comment above.
        if (!await window.confirmModal(`Delete the album "${a.name}"?\n\nThe ${a.paths.length} photo${a.paths.length === 1 ? '' : 's'} in it stay exactly where they are on disk — only the list is removed.`, 'Delete')) return;
        await invoke('album_delete', { id }).catch((err) => toast(humanizeErr('delete the album', err), 'err'));
        if (state.source === 'album:' + id) { state.source = 'folder'; state.entries = []; renderGrid(); }
        await refreshAlbums();
      }],
    ];
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--sur2);border:1px solid var(--bdr);'
      + 'border-radius:7px;padding:4px;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:12px';
    items.forEach(([label, fn]) => {
      const it = document.createElement('div');
      it.textContent = label;
      it.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      it.onmouseenter = () => { it.style.background = 'var(--bdr)'; };
      it.onmouseleave = () => { it.style.background = ''; };
      it.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(it);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 90) + 'px';
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  /// Offline thumbnails split per-root once there's more than one root catalogued — a user
  /// with an old archive volume plus a current one otherwise has no way to clear just one.
  /// Decode cache stays global-only (opaque hashed cache keys, no root column to filter on —
  /// see catalog_root_cache_usage's own doc comment) — one item, not one per root, for that.
  async function showCacheMenu(e) {
    if (!cacheUsage) return;
    const x = Math.min(e.clientX, window.innerWidth - 260);
    const y = Math.min(e.clientY, window.innerHeight - 90);
    let rootUsage = [];
    try { rootUsage = await invoke('catalog_root_cache_usage'); } catch (err) { /* fall back to the global-only view below */ }

    const items = [];
    if (rootUsage.length > 1) {
      for (const r of rootUsage) {
        const label = r.rel_path ? `${r.volume_label} / ${r.rel_path}` : `${r.volume_label} (whole volume)`;
        items.push([`Clear ${label} thumbnails (${fmtGB(r.offline_thumbs_bytes)} GB)`, async () => {
          if (!await window.confirmModal(`Clear offline thumbnails for ${label}?\n\nThey regenerate automatically next time this root is scanned while connected — but until then, browsing while unplugged shows blank cards instead of thumbnails.`, 'Clear')) return;
          try { await invoke('clear_root_cache', { rootId: r.root_id }); toast(`Cleared ${label}`); refreshCacheUsage(); }
          catch (err) { toast(humanizeErr('clear that root\'s thumbnails', err), 'err'); }
        }]);
      }
    } else {
      items.push([`Clear offline thumbnails (${fmtGB(cacheUsage.offline_thumbs_bytes)} GB)`, async () => {
        // confirmModal, never window.confirm — matches the album-delete confirm above. Worth
        // spelling out what's actually lost: nothing on the drive, just the never-pruned
        // never-changes-on-its-own cache that makes an UNPLUGGED drive browsable.
        if (!await window.confirmModal('Clear offline thumbnails?\n\nThey regenerate automatically next time each drive is scanned while connected — but until then, browsing while unplugged shows blank cards instead of thumbnails.', 'Clear')) return;
        try { await invoke('clear_cache_tier', { tier: 'offline_thumbs' }); toast('Offline thumbnails cleared'); refreshCacheUsage(); }
        catch (err) { toast(humanizeErr('clear offline thumbnails', err), 'err'); }
      }]);
    }
    items.push([`Clear decode cache (${fmtGB(cacheUsage.decode_cache_bytes)} GB)`, async () => {
      try { await invoke('clear_cache_tier', { tier: 'decode' }); toast('Decode cache cleared'); refreshCacheUsage(); }
      catch (err) { toast(humanizeErr('clear the decode cache', err), 'err'); }
    }]);

    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--sur2);border:1px solid var(--bdr);'
      + 'border-radius:7px;padding:4px;min-width:220px;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:12px';
    items.forEach(([label, fn]) => {
      const it = document.createElement('div');
      it.textContent = label;
      it.style.cssText = 'padding:7px 10px;border-radius:5px;cursor:pointer';
      it.onmouseenter = () => { it.style.background = 'var(--bdr)'; };
      it.onmouseleave = () => { it.style.background = ''; };
      it.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(it);
    });
    document.body.appendChild(menu);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  function renderCollections() {
    const host = document.getElementById('lib-collections');
    if (!host) return;
    host.innerHTML = catalogSectionHtml() + '<div class="lib-coll-heading">Collections</div>' + COLLECTIONS.map((c) => `
      <div class="lib-coll-row${state.source === c.name ? ' on' : ''}" data-coll="${c.name}">
        <span class="lib-coll-ic">${c.icon}</span><span class="lib-coll-lb">${c.label}</span>
        <span class="lib-coll-count">${collectionCounts[c.name] || ''}</span>
      </div>`).join('') + albumsSectionHtml() + keywordsSectionHtml() + peopleSectionHtml() + devicesSectionHtml() + cloudSectionHtml() + '<div class="lib-coll-sep"></div><div class="lib-coll-heading">Folders</div>';
    wireAlbumRows(host);
    wirePeopleRows(host);
    host.querySelectorAll('.lib-coll-row[data-catalog]').forEach((row) => {
      row.onclick = () => openCatalogView(row.dataset.catalog);
    });
    const freeUpRow = host.querySelector('[data-cache-free]');
    if (freeUpRow) freeUpRow.onclick = (e) => showCacheMenu(e);
    const verifyRow = host.querySelector('[data-verify-library]');
    if (verifyRow) verifyRow.onclick = () => runVerifyLibrary();
    const findDupesRow = host.querySelector('[data-find-duplicates]');
    if (findDupesRow) findDupesRow.onclick = () => runDupeDetectionOnDemand();
    // "By Date" root row: toggles the whole tree open/closed, same gesture the real folder
    // tree's own root uses, but never navigates on its own (a bare "By Date" click isn't a
    // filterable scope — unlike every row inside it).
    const dateTreeRoot = host.querySelector('[data-date-tree-toggle]');
    if (dateTreeRoot) {
      dateTreeRoot.onclick = () => {
        if (dateExpanded.has('__root__')) dateExpanded.delete('__root__'); else dateExpanded.add('__root__');
        renderCollections();
      };
    }
    host.querySelectorAll('.lib-tree-row[data-date-scope]').forEach((row) => {
      const toggleKey = row.dataset.dateToggle;
      // Chevron: LOCAL state only — toggle which children are visible, re-render the sidebar
      // from the counts already in memory (refreshCatalogCounts fetched them), and stop right
      // there. No invoke, no catalog_query, no photo load — this is what makes "just looking at
      // the tree" cheap regardless of how large the library is.
      const chevEl = row.querySelector('[data-chev-toggle]');
      if (chevEl && toggleKey) {
        chevEl.onclick = (e) => {
          e.stopPropagation();
          if (dateExpanded.has(toggleKey)) dateExpanded.delete(toggleKey); else dateExpanded.add(toggleKey);
          renderCollections();
        };
      }
      // Row (label/count — anywhere but the chevron, which already stopped its own
      // propagation): the actual "load these photos" action. Also EXPANDS (never collapses) the
      // node so picking a year still reveals its months as a convenience, but that expansion is
      // free — it's a re-render from data already in hand, not a second query — and collapsing
      // stays the chevron's job alone so selecting a date can never surprise-close the tree.
      row.onclick = (e) => {
        e.stopPropagation();
        if (toggleKey) dateExpanded.add(toggleKey);
        openCatalogView(row.dataset.dateScope);
      };
    });
    // "Keywords" root row: same expand-only gesture as "By Date"'s own root.
    const kwTreeRoot = host.querySelector('[data-kw-tree-toggle]');
    if (kwTreeRoot) {
      kwTreeRoot.onclick = () => {
        if (kwExpanded.has('__root__')) kwExpanded.delete('__root__'); else kwExpanded.add('__root__');
        renderCollections();
      };
    }
    host.querySelectorAll('.lib-tree-row[data-kw-scope]').forEach((row) => {
      row.onclick = (e) => {
        e.stopPropagation();
        const toggleKey = row.dataset.kwToggle;
        if (toggleKey) {
          const id = parseInt(toggleKey, 10);
          if (kwExpanded.has(id)) kwExpanded.delete(id); else kwExpanded.add(id);
        }
        openCatalogView(row.dataset.kwScope);
      };
      // Drag-to-tag: same contract the album rows use (application/x-chromasmith-paths), just
      // calling set_keywords per photo instead of album_add.
      row.ondragover = (e) => {
        if (!Array.from(e.dataTransfer.types || []).includes('application/x-chromasmith-paths')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        row.classList.add('lib-coll-dragover');
      };
      row.ondragleave = () => row.classList.remove('lib-coll-dragover');
      row.ondrop = async (e) => {
        e.preventDefault();
        row.classList.remove('lib-coll-dragover');
        let paths = [];
        try { paths = JSON.parse(e.dataTransfer.getData('application/x-chromasmith-paths') || '[]'); } catch { /* ignore */ }
        if (!paths.length) return;
        const kwPath = row.dataset.kwPath;
        await Promise.all(paths.map((p) => addKeywordToPhoto(p, kwPath)));
        toast(`Tagged ${paths.length} photo${paths.length > 1 ? 's' : ''} "${kwPath.split('|').pop()}"`);
      };
    });
    host.querySelectorAll('.lib-card-row[data-card]').forEach((row) => {
      row.onclick = () => openImportPanel(row.dataset.card);
    });
    host.querySelectorAll('.lib-card-row[data-card-pick]').forEach((row) => {
      row.onclick = () => pickImportFolder();
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
  // ⚠️ NOT guarded on LIBTEST — unlike catalogRegisterFolder (which has no meaningful mock to
  // run against), catalog_counts/catalog_date_counts ARE mocked, and gating this away from
  // libtest would mean the date tree and sidebar counts are never exercised by the one harness
  // that can screenshot-verify a sidebar layout bug (CLAUDE.md §10.14) — which is exactly the
  // bug this comment replaced: the date tree rendered permanently empty under ?libtest=1&libcat=1
  // because this call never ran to populate dateCounts in the first place.
  refreshCatalogCounts();
  wireActivityListeners();
  // Click anywhere outside the popover collapses it — the same "click-away closes it" gesture
  // every other popover/menu in this file already uses.
  document.addEventListener('click', () => {
    if (activity.expanded) { activity.expanded = false; renderActivity(); }
  });

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

  async function toggleLibrary(opts) {
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
      // First-ever launch (or every folder removed): show the in-app empty state with two
      // explicit actions, rather than immediately popping the OS folder picker — a modal dialog
      // appearing over a screen the user hasn't even seen yet reads as the app grabbing control,
      // and it means the "first two minutes" storyboard's first-launch frame is unreachable.
      if (!state.root) { renderLibraryNoRoot(); return; }
      const openOpts = opts && opts.prefetchThumbs ? { prefetchThumbs: true } : undefined;
      if (state.currentFolder) await openFolder(state.currentFolder, openOpts);
      else await openFolder(state.root, openOpts);
    }
  }
  window.chromasmithToggleLibrary = toggleLibrary; // called from the header button in desktop-native.js

  window.__TAURI__.event.listen('menu-library', toggleLibrary);
  // File > Open Recent (main.rs) — surfaces the SAME recents dropdown the header's own Recent
  // button (#lib-recent) already builds from getRecentFolders(), rather than keeping a second,
  // Rust-side mirror of that list in sync. toggleRecentMenu positions itself off #lib-recent's
  // own bounding rect, which is only meaningful once the Library panel is actually open — so
  // open it first (a no-op if it already is) before showing the popover.
  window.__TAURI__.event.listen('menu-open-recent', async () => {
    if (!state.open) await toggleLibrary();
    toggleRecentMenu({ stopPropagation() {} });
  });

  // N1a piece 3/4: reconnect detection + batched conflict prompt for the offline edit queue.
  // Deliberately reuses the SAME 4s poll below (not a new timer) — a reconnect is exactly the
  // "catalog_volumes came back online" event that poll already watches for. Two-way flow:
  //   - no-conflict entries (original unchanged since queueing) replay silently, one at a time
  //   - conflicted entries are batched into ONE prompt for the whole set, never one per photo
  // `offlineQueuePromptOpen` guards against re-opening the modal on the next poll tick while the
  // user hasn't answered the current one yet.
  let offlineQueuePromptOpen = false;
  function offlineQueueConflictModal(n) {
    return new Promise((res) => {
      let dlg = document.getElementById('lib-offq-modal');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'lib-offq-modal';
        dlg.style.cssText = 'border:1px solid var(--bdr);border-radius:10px;background:var(--bg);color:var(--txt);padding:16px;max-width:440px;width:90vw;font-family:var(--sans);box-shadow:var(--lift-2)';
        dlg.innerHTML = '<div id="lib-offq-msg" style="font-size:13px;line-height:1.5;white-space:pre-wrap;margin-bottom:14px"></div>'
          + '<div style="display:flex;gap:8px;justify-content:flex-end">'
          + '<button type="button" id="lib-offq-ignore" class="btn bgh">Ignore queued edits</button>'
          + '<button type="button" id="lib-offq-apply" class="btn bpri">Apply queued edits anyway</button></div>';
        document.body.appendChild(dlg);
      }
      dlg.querySelector('#lib-offq-msg').textContent =
        `${n} photo${n > 1 ? 's were' : ' was'} edited offline and ${n > 1 ? 'their' : 'its'} original${n > 1 ? 's have' : ' has'} since changed.\n\n`
        + 'Ignore queued edits — discard them, leave the changed original untouched.\n'
        + 'Apply queued edits anyway — apply them to the original as it is now.';
      const finish = (v) => { dlg.close(); res(v); };
      dlg.querySelector('#lib-offq-apply').onclick = () => finish('apply');
      dlg.querySelector('#lib-offq-ignore').onclick = () => finish('ignore');
      dlg.onkeydown = (e) => { if (e.key === 'Escape') finish(null); };
      dlg.showModal();
    });
  }
  async function checkOfflineQueueOnReconnect() {
    if (offlineQueuePromptOpen) return;
    let queued;
    try { queued = await invoke('list_offline_queue'); } catch (e) { console.error('list_offline_queue', e); return; }
    if (!queued || !queued.length) return;
    const noConflict = queued.filter((q) => !q.conflict);
    const conflicted = queued.filter((q) => q.conflict);
    // Non-conflicted entries replay silently and automatically — no prompt for the common case.
    for (const q of noConflict) {
      try { await invoke('apply_queued_edit', { id: q.id }); } catch (e) { console.error('apply_queued_edit', e); }
    }
    if (noConflict.length && typeof toast === 'function') {
      toast(`${noConflict.length} offline edit${noConflict.length > 1 ? 's' : ''} applied now that the drive is reconnected.`, true);
    }
    if (!conflicted.length) return;
    // Genuinely conflicted entries — batched into ONE prompt for the whole set, never one per
    // photo (see this section's header comment).
    offlineQueuePromptOpen = true;
    try {
      const choice = await offlineQueueConflictModal(conflicted.length);
      if (choice === 'apply') {
        for (const q of conflicted) { try { await invoke('apply_queued_edit', { id: q.id }); } catch (e) { console.error('apply_queued_edit', e); } }
        if (typeof toast === 'function') toast(`Applied ${conflicted.length} queued edit${conflicted.length > 1 ? 's' : ''} despite the change${conflicted.length > 1 ? 's' : ''}.`, true);
      } else if (choice === 'ignore') {
        for (const q of conflicted) { try { await invoke('discard_queued_edit', { id: q.id }); } catch (e) { console.error('discard_queued_edit', e); } }
        if (typeof toast === 'function') toast(`Discarded ${conflicted.length} queued edit${conflicted.length > 1 ? 's' : ''}.`, false);
      }
      // choice === null (dismissed via Escape): leave the entries queued — the next reconnect
      // poll will re-check and prompt again, rather than silently resolving anything either way.
    } finally {
      offlineQueuePromptOpen = false;
    }
  }

  // Card detection. macOS emits no mount notification that reaches a Tauri webview, so this
  // polls /Volumes — cheap (one readdir plus a statfs per volume) and only while the Library is
  // actually open, so a backgrounded app does no work.
  refreshVolumes();
  setInterval(() => {
    const ov = document.getElementById('lib-overlay');
    if (!ov || ov.style.display === 'none') return;
    refreshVolumes();
    // Reuses this same poll for the Drives section's online/offline state, rather than a
    // second timer — a catalogued external drive being plugged or unplugged is exactly the
    // same kind of event refreshVolumes() already watches for.
    if (!LIBTEST) invoke('catalog_volumes').then((vols) => { catalogVolumes = vols || []; renderCollections(); }).catch(() => {});
    if (!LIBTEST || /[?&]liboffq=1/.test(location.search)) checkOfflineQueueOnReconnect();
  }, 4000);
  // Exposed for the harness (?liboffq=1) — driving a real 4s wait per test run is wasteful, so
  // test/library_perf.mjs-style probes can call this directly instead of racing the timer.
  window.chromasmithCheckOfflineQueue = checkOfflineQueueOnReconnect;

  // ── deskx home screen: the app opens to the full-window Library, not the editor (matches
  // the approved DRK-style wireframe). desktop-native.js sets body.deskx synchronously
  // before this script runs (build-desktop.sh loads it first), so the class is already present
  // here. Runs once at startup only — afterward the user's own open/close/expand actions own
  // the state. ──
  if (document.body.classList.contains('deskx')) {
    // Boot splash (chromasmith-22.html's #boot-splash, shown by default with no JS needed):
    // covers the flicker between the web layout's first paint, deskx switching in, and this
    // async open+expand actually landing — previously the user watched all of that happen
    // live. Hidden here, right after the Library has actually settled into its final
    // full-window state, not a moment earlier.
    toggleLibrary({ prefetchThumbs: true }).then(async () => {
      toggleExpandedView(true);
      // ⚠️ Wait for the actual catalog SCAN (not just the folder listing toggleLibrary's own
      // promise already covers) before doing anything else. openFolder (called from inside
      // toggleLibrary, above) kicks off catalogRegisterFolder — historically fire-and-forget —
      // and stashes its promise on window._lastCatalogRegisterPromise once it settles into a
      // real invoke() chain. Without this await, the splash used to hide as soon as the folder's
      // file LISTING was ready (fast), while the actual indexing work (the walk + metadata read
      // that this whole session's fixes are about) kept running invisibly behind an app that
      // already looked ready — which is exactly what made it look "stuck" once you tried to use
      // it. The progress bar wired into updateBootSplashProgress (this file, wireActivityListeners)
      // is what the user sees while this await is in flight.
      if (window._lastCatalogRegisterPromise) { try { await window._lastCatalogRegisterPromise; } catch (e) {} }
      // ⚠️ THE readiness fix. Everything above this line only guarantees CARDS exist in the DOM
      // — renderGrid() resolves once it has appended elements, not once their <img>s have pixels
      // (loadThumb queues each card's decode and returns immediately). Twelve prior attempts at
      // this exact bug all sped up or better-instrumented the chain above without ever changing
      // that fact, which is why the Library kept revealing itself full of empty grey cards no
      // matter how fast/reliable the scan got. firstPaintReady() (this file) resolves once every
      // card mounted in the CURRENT grid generation has actually settled — loaded or failed —
      // which is the one thing the old gate never measured. Bounded to 8s so a single
      // pathological card (matches the outer watchdog's own grace) can't hang the splash forever;
      // the outer bumpBootSplashWatchdog safety net still applies on top of this.
      // ⚠️ Seed with the REAL counts already sitting in _thumbDoneCount/_thumbTotalCount (set by
      // renderGrid()'s own loadThumb() calls, just above), not total:0. A fake total:0 here
      // forces updateBootSplashProgress into its indeterminate "trickle" branch — which RESETS
      // the bar to 0% on every phase-key change — for a phase that already has a real number
      // available, producing exactly the "bar reaches the end and restarts" flash this replaces.
      updateBootSplashProgress({ phase: 'paint', done: _thumbDoneCount, total: _thumbTotalCount, current: '' });
      await firstPaintReady(8000);
      // ⚠️ Deliberately does NOT auto-reopen the last-edited photo any more. It used to, right
      // here, via `openInEditor(lastPath)` — and that turned out to be actively harmful, not
      // just heavy: it has NO progress events wired to it (unlike the catalog scan above, which
      // feeds updateBootSplashProgress/bumpBootSplashWatchdog), so on a busy launch — the scan
      // and this RAW decode competing for I/O on the same external drive — it could easily run
      // long enough for the watchdog's own no-progress timeout to fire and reveal the app BEFORE
      // the photo had finished loading, landing on the empty "Add photos" placeholder while the
      // background scan kept running — confirmed live: exactly the symptom reported. On top of
      // that, it forced a full RAW demosaic + WebGL render on every single cold launch whether or
      // not the user wanted to keep editing that photo. The app now opens straight to the
      // Library, matching most photo apps' own "you land in the browser, not mid-edit" default;
      // opening a specific photo is one click away, same as it's always been.
      if (typeof window.hideBootSplash === 'function') window.hideBootSplash();
      // Guaranteed-offline tier: warm the index immediately (cheap, just a DB read — so the
      // editor can already treat a cached photo as local even before this launch's drain loop
      // does any new work), then start the paced drain AFTER the splash is down, same gating
      // reasoning as catalogRunBackgroundPhases — this must never compete with first paint.
      refreshHqOfflineIndex().then(() => hqOfflineDrainLoop());
    });
  }
  // "Live, re-evaluated set" (the user's own explicit requirement): re-check periodically while
  // the app is open, not just once at boot, so an edit or import made mid-session promotes a
  // photo into the guaranteed-offline set without waiting for the next relaunch. 90s, not
  // continuous — a full drain pass touches the DB and (when there's real work) does full RAW
  // decodes, so this stays a background heartbeat, not a tight poll.
  if (!LIBTEST) setInterval(() => { hqOfflineDrainLoop(); }, 90000);
})();
