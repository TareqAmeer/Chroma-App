// Shared by control_sweep.mjs (Playwright, Chromium) and real_app_sweep.mjs (the real desktop
// app over its automation channel). Both functions run IN THE PAGE, so they must stay
// self-contained: no closures over module scope.
// Runs in the page: list visible, enabled interactive elements with stable keys.
export function enumerate() {
  const sel = 'button,summary,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=option],input:not([type=hidden]),select,textarea,a[href],[onclick],[tabindex="0"]';
  const seen = new Map(), out = []; window.__sweepEls = new Map();
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled || el.closest('[inert],[aria-hidden=true]')) continue;
    // Closed <details> content still has layout boxes in Chromium but is never painted or
    // focusable (the Export sheet's "More" cards were reported inert for this reason).
    if (el.closest('details:not([open])') && !el.closest('summary')) continue;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const inView = !(r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth);
    // Below the fold of a scrolling panel is still reachable (locate() scrolls it in); off-screen
    // with nothing to scroll is not. Tall panels lost their lower controls to "unreach" (CHR-230).
    if (!inView) {
      let a = el.parentElement, scrollable = false;
      for (; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight) { scrollable = true; break; } }
      if (!scrollable) continue;
    }
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (inView) { const top = document.elementFromPoint(cx, cy); if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; } // covered
    const data = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-sweep')).map((a) => `${a.name}=${a.value}`).slice(0, 3).join(',');
    // Trailing live counts ("Favorites 2") change as the sweep flags photos; keep them out of the key.
    let label = ((el.id ? '#' + el.id : '') || el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('name') || el.getAttribute('placeholder') || '').replace(/\s+[\d,]+$/, '');
    // These controls have live text that changes after activation or between fixture boots.
    // Use a DOM identity/content invariant instead of their presentation label.
    if (el.matches('.sk2x-proof-toggle')) label = 'Export proof toggle';
    const historyList = el.closest('#fx-settings-history-list,#fx-timeline-popover');
    if (historyList && el.tagName === 'BUTTON' && el.firstElementChild?.tagName === 'SPAN') {
      label = `History row ${el.firstElementChild.textContent.trim()}`;
    }
    const base = `${el.tagName.toLowerCase()}${el.type ? ':' + el.type : ''}|${label}|${data}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const family = `${el.tagName}|${el.type || ''}|${el.className}|${[...el.attributes].map((a) => a.name).filter((a) => a.startsWith('data-')).sort().join(',')}`;
    const stateful = el.classList.contains('on') || el.classList.contains('active') || el.classList.contains('lib-sel') || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-selected');
    const selected = el.classList.contains('on') || el.classList.contains('active') || el.classList.contains('lib-sel') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
    (window.__sweepEls = window.__sweepEls || new Map()).set(`${base}|${n}`, el);
    out.push({ family, selected, stateful, key: `${base}|${n}`, kind: el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? (el.type || el.tagName.toLowerCase()) : 'click', label, x: cx, y: cy });
  }
  return out;
}

// Skip a replay only when a stateful control is already at its recorded destination. Ordinary
// buttons have no destination state and must always be activated to reopen menus and dialogs.
export function alreadyAtReplayDestination(destination, current) {
  return destination != null && current.stateful && current.selected === destination;
}

// Runs in the page: color inputs need a value change, not a click on their native picker.
export function setColorInput({ x, y }) {
  const el = document.elementFromPoint(x, y)?.closest('input[type="color"]'); if (!el) return false;
  const next = el.value.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff';
  el.value = next; el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true })); return true;
}

// Runs in the page: a cheap fingerprint of everything a control could observably change.
export function fingerprint() {
  let h = 0; const s = document.body.innerHTML + '|' + location.href + '|' +
    [...document.querySelectorAll('input,select,textarea')].map((e) => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value).join(',');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  let c = '';
  try {
    const cv = [...document.querySelectorAll('canvas')].filter((x) => x.width > 50 && x.offsetParent).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (cv) { const t = document.createElement('canvas'); t.width = t.height = 8; const g = t.getContext('2d'); g.drawImage(cv, 0, 0, 8, 8); c = [...g.getImageData(0, 0, 8, 8).data].join(''); }
  } catch (_) {}
  return h + ':' + c.length + ':' + c.slice(0, 256);
}

// Runs in the page: scroll a control from the last enumerate() into view and return its centre
// (null if it is gone or covered once in view).
export function locate(key) {
  const el = window.__sweepEls && window.__sweepEls.get(key);
  if (!el || !el.isConnected) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  if (!top || (top !== el && !el.contains(top) && !top.contains(el))) return null;
  return { x, y };
}
