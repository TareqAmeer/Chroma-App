// CHR-239: tiny, dependency-free static gallery document builder. Callers provide
// already-exported, gallery-relative image files so preview and folder export can
// consume the same HTML string without a second rendering implementation.
const TEMPLATES = new Set(['grid', 'filmstrip', 'minimal']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function assetUrl(value) {
  const path = String(value ?? '');
  if (!path || path.startsWith('/') || path.includes('\\') || /[:?#\u0000-\u001f]/.test(path)) {
    throw new TypeError(`Gallery image must be a relative asset path: ${path}`);
  }
  const segments = path.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`Gallery image path cannot contain empty or traversal segments: ${path}`);
  }
  return segments.map(encodeURIComponent).join('/');
}

/**
 * Build one self-contained static gallery page.
 * @param {{title?: string, collectionTitle?: string, contact?: string, template?: string, columns?: number,
 * photos: Array<{src: string, alt?: string, caption?: string}>}} options
 */
export function buildStaticGallery(options = {}) {
  const template = TEMPLATES.has(options.template) ? options.template : 'grid';
  const columns = Math.max(1, Math.min(8, Math.round(Number(options.columns) || 3)));
  const photos = Array.isArray(options.photos) ? options.photos : [];
  const entries = photos.map((photo, index) => {
    if (!photo || typeof photo !== 'object') throw new TypeError(`Photo ${index + 1} must be an object`);
    const src = assetUrl(photo.src);
    const caption = escapeHtml(photo.caption || '');
    const alt = escapeHtml(photo.alt || photo.caption || `Photo ${index + 1}`);
    return `<figure><a href="${src}" data-gallery-image><img src="${src}" alt="${alt}" loading="lazy" decoding="async"></a>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }).join('\n');
  const title = escapeHtml(options.title || 'Photo gallery');
  const collectionTitle = escapeHtml(options.collectionTitle || '');
  const contact = escapeHtml(options.contact || '');
  const contactMarkup = contact ? `<a class="contact" href="mailto:${encodeURIComponent(String(options.contact))}">${contact}</a>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${title}</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#20201f;background:#faf9f6}*{box-sizing:border-box}body{margin:0}
header{max-width:1200px;margin:0 auto;padding:clamp(1.25rem,5vw,4rem) 1.25rem 1.5rem}h1{font-size:clamp(1.8rem,5vw,3.5rem);line-height:1.05;margin:0}header p{color:#65635f;margin:.65rem 0 0}.contact{display:inline-block;margin-top:.6rem;color:inherit}
main{max-width:1200px;margin:0 auto;padding:0 1.25rem 3rem}.photos{--columns:${columns};display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:clamp(.5rem,2vw,1.25rem);align-items:start}
figure{margin:0;min-width:0}figure>a{display:block;overflow:hidden;background:#e9e7e2}img{display:block;width:100%;height:auto;max-height:72vh;object-fit:cover}figcaption{padding:.45rem .1rem;color:#555;font-size:.9rem}
body[data-template="filmstrip"] .photos{display:flex;gap:.75rem;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:1rem}body[data-template="filmstrip"] figure{flex:0 0 min(78vw,900px);scroll-snap-align:center}body[data-template="filmstrip"] img{max-height:78vh;object-fit:contain}
body[data-template="minimal"] header{padding-bottom:.75rem}body[data-template="minimal"] h1{font-size:1.25rem;font-weight:500}body[data-template="minimal"] header p,body[data-template="minimal"] .contact{font-size:.85rem}body[data-template="minimal"] .photos{gap:2px}body[data-template="minimal"] figcaption{font-size:.75rem;padding:.25rem}
@media(max-width:700px){.photos{--columns:min(var(--columns),2)}body[data-template="filmstrip"] figure{flex-basis:88vw}}
@media(max-width:420px){.photos{--columns:1}body[data-template="minimal"] .photos{--columns:2}}
dialog{max-width:96vw;max-height:96vh;padding:.5rem;border:0;background:#111;color:#fff}dialog::backdrop{background:#000d}dialog img{max-width:92vw;max-height:88vh;width:auto;object-fit:contain}dialog button{position:absolute;top:.5rem;right:.5rem;border:0;border-radius:50%;width:2.5rem;height:2.5rem;font-size:1.5rem;cursor:pointer}
</style></head><body data-template="${template}">
<header><h1>${title}</h1>${collectionTitle ? `<p>${collectionTitle}</p>` : ''}${contactMarkup}</header>
<main><section class="photos" aria-label="${escapeHtml(collectionTitle || title)}">${entries}</section></main>
<dialog aria-label="Photo viewer"><button type="button" aria-label="Close photo">×</button><img alt=""></dialog>
<script>const d=document.querySelector('dialog'),v=d.querySelector('img');document.querySelectorAll('[data-gallery-image]').forEach(a=>a.addEventListener('click',e=>{if(!d.showModal)return;e.preventDefault();v.src=a.href;v.alt=a.querySelector('img').alt;d.showModal()}));d.querySelector('button').addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close()});d.addEventListener('close',()=>{v.removeAttribute('src');v.alt=''})</script>
</body></html>`;
}

export const STATIC_GALLERY_TEMPLATES = Object.freeze(['grid', 'filmstrip', 'minimal']);
