// Shared by control_sweep.mjs (Playwright, Chromium) and real_app_sweep.mjs (the real desktop
// app over its automation channel). Both functions run IN THE PAGE, so they must stay
// self-contained: no closures over module scope.
// Runs in the page: list visible, enabled interactive elements with stable keys.
export function enumerate() {
  const sel = 'button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=option],input:not([type=hidden]),select,textarea,a[href],[onclick],[tabindex="0"]';
  const seen = new Map(), out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled || el.closest('[inert],[aria-hidden=true]')) continue;
    // Closed <details> content still has layout boxes in Chromium but is never painted or
    // focusable (the Export sheet's "More" cards were reported inert for this reason).
    if (el.closest('details:not([open])') && !el.closest('summary')) continue;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // covered
    const data = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-sweep')).map((a) => `${a.name}=${a.value}`).slice(0, 3).join(',');
    const label = (el.id ? '#' + el.id : '') || el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('name') || el.getAttribute('placeholder') || '';
    const base = `${el.tagName.toLowerCase()}${el.type ? ':' + el.type : ''}|${label}|${data}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const family = `${el.tagName}|${el.type || ''}|${el.className}|${[...el.attributes].map((a) => a.name).filter((a) => a.startsWith('data-')).sort().join(',')}`;
    const selected = el.classList.contains('on') || el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
    out.push({ family, selected, key: `${base}|${n}`, kind: el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? (el.type || el.tagName.toLowerCase()) : 'click', label, x: cx, y: cy });
  }
  return out;
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
