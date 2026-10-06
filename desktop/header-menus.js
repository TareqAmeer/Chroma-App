// Windows title bar combines application menus and window controls; macOS retains its system menu.
(function () {
  if (!window.__TAURI__) return;
  const groups = {
    File: [['Open Photo…', 'menu-open'], ['Open Folder…', 'menu-open-folder'], ['Open Recent…', 'menu-open-recent'], ['Library…', 'menu-library'], ['Save Session', 'menu-save-session'], ['Load Session…', 'menu-load-session'], ['Export…', 'menu-export'], null, ['Exit', 'window-close']],
    Edit: [['Undo', 'menu-undo'], ['Redo', 'menu-redo'], ['Copy Edit', 'menu-copy-edit'], ['Paste Edit', 'menu-paste-edit'], ['Reset Edit', 'menu-reset-edit'], ['Settings…', 'menu-preferences']],
    Photo: [['Reject', 'menu-reject'], ['Pick (Flag)', 'menu-pick'], ['Clear Flag', 'menu-clear-flag'], null, ['Rotate Left', 'menu-rotate-left'], ['Rotate Right', 'menu-rotate-right'], ['Flip Horizontal', 'menu-flip-h'], ['Flip Vertical', 'menu-flip-v'], ['Crop / Straighten', 'menu-crop'], null, ['Auto Enhance', 'menu-auto-enhance'], ['White Balance Eyedropper', 'menu-wb-eyedrop'], ['Reshuffle Film Artifacts', 'menu-reshuffle-artifacts']],
    View: [['Zoom In', 'menu-zoom-in'], ['Zoom Out', 'menu-zoom-out'], ['Zoom to Fit', 'menu-zoom-fit'], ['Zoom to 100%', 'menu-zoom-100'], ['Before/After Split', 'menu-split'], ['Histogram', 'menu-histogram'], ['1:1 Loupe', 'menu-loupe'], ['Full Library', 'menu-expand-library'], null, ['Full Screen', 'window-fullscreen']],
    Help: [['Search Commands…', 'menu-search'], ['Keyboard Shortcuts…', 'menu-shortcuts'], ['Chromasmith Guide', 'menu-guide'], ["What's New", 'menu-whatsnew'], ['Welcome Tour', 'menu-tour'], ['About Chromasmith', 'menu-settings']],
  };
  const style = document.createElement('style');
  style.textContent = `
    body.cs-windows-titlebar{--cs-titlebar-h:32px}
    body.deskx.cs-windows-titlebar #fx-deskbar,body.deskx.cs-windows-titlebar #cs-brand{top:var(--cs-titlebar-h)}
    body.deskx.cs-windows-titlebar main{padding-top:calc(var(--deskx-topbar-h) + var(--cs-titlebar-h))}
    body.deskx.cs-windows-titlebar .fx-layout{height:calc(100vh - var(--deskx-topbar-h) - var(--cs-titlebar-h))}
    body.deskx.cs-windows-titlebar #lib-overlay{top:calc(var(--deskx-topbar-h) + var(--cs-titlebar-h))}
    body.deskx.cs-windows-titlebar #lib-overlay:not(.full){height:calc(100vh - var(--deskx-topbar-h) - var(--cs-titlebar-h))}
    body.deskx.cs-windows-titlebar #lib-overlay.full{top:var(--cs-titlebar-h);height:calc(100vh - var(--cs-titlebar-h))}
    body.sk2.deskx.cs-windows-titlebar #sk2-export{top:calc(var(--deskx-topbar-h) + var(--cs-titlebar-h))}
    body.cs-windows-titlebar #fx-settings-menu{top:calc(46px + var(--cs-titlebar-h))}
    #cs-windows-titlebar{position:fixed;inset:0 0 auto;height:32px;display:flex;align-items:center;gap:12px;padding-left:10px;background:var(--bg);color:var(--txt);font:12px var(--sans,system-ui);z-index:20000;border-bottom:1px solid var(--bdr);user-select:none}
    .cs-titlebar-name{font-size:12px;white-space:nowrap;pointer-events:none}
    .cs-titlebar-drag{flex:1;align-self:stretch;min-width:32px}
    .cs-titlebar-controls{display:flex;height:100%;flex-shrink:0}
    .cs-titlebar-controls button{width:46px;height:32px;border:0;background:none;color:inherit;display:grid;place-items:center;cursor:default}
    .cs-titlebar-controls button:hover{background:var(--sur2)}
    .cs-titlebar-controls button:last-child:hover{background:#c42b1c;color:#fff}
    .cs-titlebar-controls svg{width:12px;height:12px;pointer-events:none}
    .cs-header-menu-popup [role=separator]{height:1px;background:var(--bdr);margin:4px}
    .cs-header-menus{display:flex;align-items:center;gap:2px;flex-shrink:0;-webkit-app-region:no-drag}
    .cs-header-menu-button{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;min-height:28px;padding:4px 7px!important;white-space:nowrap}
    .cs-header-menu-button:hover{background:var(--sur2)}
    .cs-header-menu-button[aria-expanded=true]{background:var(--txt,#ddd)!important;color:var(--bg,#222)!important}
    .cs-header-menu-popup{position:fixed;z-index:20001;min-width:190px;max-height:calc(100vh - 80px);overflow:auto;padding:4px;background:var(--sur,#222);color:var(--txt,#ddd);border:1px solid var(--bdr,#555);box-shadow:0 4px 16px #0004;-webkit-app-region:no-drag}
    .cs-header-menu-popup[hidden]{display:none}
    .cs-header-menu-popup button{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;font:inherit;font-size:12px;min-height:30px;padding:6px 10px;cursor:pointer}
    .cs-header-menu-popup button:disabled{opacity:.45;cursor:default}
    .cs-header-menu-popup button:not(:disabled):hover,.cs-header-menu-popup button:focus-visible{background:var(--txt,#ddd);color:var(--bg,#222);outline:0}
    .cs-header-menu-button:focus-visible{outline:2px solid currentColor;outline-offset:1px}
  `;
  document.head.appendChild(style);
  let active = null;
  function close(restore = false) {
    if (!active) return;
    const { button, popup } = active;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    active = null;
    if (restore) button.focus();
  }
  function mount(host) {
    if (!host || host.querySelector('.cs-header-menus')) return;
    const bar = document.createElement('nav');
    bar.className = 'cs-header-menus';
    bar.setAttribute('role', 'menubar');
    bar.setAttribute('aria-label', 'Application menu');
    Object.entries(groups).forEach(([label, items], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cs-header-menu-button';
      button.textContent = label;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      button.tabIndex = index === 0 ? 0 : -1;
      const popup = document.createElement('div');
      popup.className = 'cs-header-menu-popup';
      popup.id = `cs-titlebar-${label.toLowerCase()}-menu`;
      popup.setAttribute('role', 'menu');
      popup.setAttribute('aria-label', label);
      popup.hidden = true;
      button.setAttribute('aria-controls', popup.id);
      items.forEach(entry => {
        if (!entry) {
          const divider = document.createElement('div');
          divider.setAttribute('role', 'separator'); popup.appendChild(divider); return;
        }
        const [name, action] = entry;
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = name;
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1; item.dataset.action = action;
        item.addEventListener('click', () => {
          close(true);
          Promise.resolve().then(() => runAction(action)).catch(e => console.error(action, e));
        });
        popup.appendChild(item);
      });
      function open(focus = false) {
        close();
        const rect = button.getBoundingClientRect();
        popup.querySelectorAll('button').forEach(item => {
          const reason = unavailable(item.dataset.action);
          item.disabled = !!reason; item.title = reason;
        });
        popup.hidden = false;
        popup.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - popup.offsetWidth - 4))}px`;
        popup.style.top = `${rect.bottom + 4}px`;
        button.setAttribute('aria-expanded', 'true');
        active = { button, popup };
        if (focus) popup.querySelector('button:not(:disabled)')?.focus();
      }
      button.addEventListener('focus', () => { bar.querySelectorAll('.cs-header-menu-button').forEach(b => b.tabIndex = b === button ? 0 : -1); });
      button.addEventListener('click', () => active?.button === button ? close() : open());
      button.addEventListener('pointerenter', () => { if (active && active.button.closest('nav') === bar) open(); });
      button.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); open(true); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          const buttons = [...bar.querySelectorAll('.cs-header-menu-button')];
          const next = buttons[(index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
          buttons.forEach(b => b.tabIndex = b === next ? 0 : -1);
          close(); next.focus();
        }
      });
      popup.addEventListener('keydown', e => {
        const entries = [...popup.querySelectorAll('button:not(:disabled)')];
        const current = entries.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
          entries[next]?.focus();
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          const buttons = [...bar.querySelectorAll('.cs-header-menu-button')];
          const next = buttons[(index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
          close(); next.focus(); next.click();
          active?.popup.querySelector('button:not(:disabled)')?.focus();
        }
        if (e.key === 'Tab') close(true);
      });
      bar.append(button, popup);
    });
    host.prepend(bar);
  }
  function unavailable(action) {
    const context = window.chromasmithMenuContext?.() || {};
    const gallery = !!context.galleryFull;
    const photo = !gallery && typeof fxImages !== 'undefined' && fxImages.length > 0;
    const targets = gallery ? context.selectionCount > 0 : photo;
    if (['menu-export', 'menu-copy-edit', 'menu-reject', 'menu-pick', 'menu-clear-flag'].includes(action) && !targets) return 'Select or open a photo first';
    if (action === 'menu-paste-edit' && (!targets || !window.__copiedRecipe)) return 'Copy an edit and select or open a photo first';
    const photoOnly = ['menu-undo', 'menu-redo', 'menu-reset-edit', 'menu-save-session', 'menu-rotate-left', 'menu-rotate-right', 'menu-flip-h', 'menu-flip-v', 'menu-crop', 'menu-auto-enhance', 'menu-wb-eyedrop', 'menu-reshuffle-artifacts', 'menu-zoom-in', 'menu-zoom-out', 'menu-zoom-fit', 'menu-zoom-100', 'menu-split', 'menu-histogram', 'menu-loupe'];
    return photoOnly.includes(action) && !photo ? 'Open a photo in Studio first' : '';
  }
  const getWindow = () => window.__TAURI__.window.getCurrentWindow();
  async function runAction(action) {
    if (action === 'window-close') return getWindow().close();
    if (action === 'window-minimize') return getWindow().minimize();
    if (action === 'window-maximize') return getWindow().toggleMaximize();
    if (action === 'window-fullscreen') {
      const win = getWindow();
      return win.setFullscreen(!await win.isFullscreen());
    }
    return window.chromasmithRunMenuAction(action);
  }
  function sync() {
    if (window.CS_PLATFORM?.os !== 'windows' || document.getElementById('cs-windows-titlebar')) return;
    document.body.classList.add('cs-windows-titlebar');
    const titlebar = document.createElement('div');
    titlebar.id = 'cs-windows-titlebar';
    const name = document.createElement('span');
    name.className = 'cs-titlebar-name'; name.textContent = 'Chromasmith';
    const drag = document.createElement('div');
    drag.className = 'cs-titlebar-drag';
    drag.addEventListener('pointerdown', e => {
      if (e.button === 0 && e.detail === 1) getWindow().startDragging().catch(console.error);
    });
    drag.addEventListener('dblclick', () => runAction('window-maximize').catch(console.error));
    const controls = document.createElement('div'); controls.className = 'cs-titlebar-controls';
    const paths = ['<path d="M1 6h10"/>', '<rect x="1.5" y="1.5" width="9" height="9"/>', '<path d="m1.5 1.5 9 9m0-9-9 9"/>'];
    ['Minimize', 'Maximize / Restore', 'Close'].forEach((label, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('aria-label', label); button.title = label;
      button.innerHTML = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor">${paths[i]}</svg>`;
      button.addEventListener('click', () => runAction(['window-minimize', 'window-maximize', 'window-close'][i]).catch(console.error));
      controls.appendChild(button);
    });
    const syncMaximize = async () => {
      const win = getWindow();
      if (!win.isMaximized) return;
      const maximized = await win.isMaximized();
      controls.children[1].title = maximized ? 'Restore' : 'Maximize';
      controls.children[1].innerHTML = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor">${maximized ? '<path d="M3.5 3.5v-2h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/>' : paths[1]}</svg>`;
    };
    syncMaximize().catch(console.error);
    window.addEventListener('resize', () => syncMaximize().catch(console.error));
    titlebar.append(name, drag, controls);
    mount(titlebar);
    document.body.appendChild(titlebar);
  }
  sync();
  window.addEventListener('cs-platform-ready', sync);
  document.addEventListener('pointerdown', e => { if (active && !active.popup.contains(e.target) && !active.button.closest('nav').contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) { e.preventDefault(); e.stopImmediatePropagation(); close(true); } }, true);
  window.addEventListener('resize', () => close());
  window.addEventListener('blur', () => close());
}());
