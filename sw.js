/* CHRO-MA-SMITH service worker.
   Two jobs: (1) re-apply COOP/COEP to every same-origin response, because GitHub Pages
   cannot send headers and libraw-wasm needs cross-origin isolation; (2) keep a versioned
   offline shell so an installed home-screen app opens without a network.
   Replaces coi-serviceworker.min.js on http(s); that file stays as the fallback path. */

const VERSION = 'v1';
const SHELL = `cs-shell-${VERSION}`;
const RUNTIME = `cs-runtime-${VERSION}`;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const APP = new URL('./chromasmith-22.html', self.registration.scope).href;

const CORE = [
  './chromasmith-22.html',
  './manifest.webmanifest',
  './favicon.ico',
  './assets/brand/apple-touch-icon.png',
  './assets/brand/icon-512.png',
];

const OFFLINE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>CHRO-MA-SMITH</title>
<style>html,body{margin:0;height:100%;background:#0b0b0a;color:#e8e6e1;
font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:32px;text-align:center}
p{max-width:22em}</style></head><body><div>
<p><strong>Offline</strong><br>Open the app once while online so the shell and assets get cached.</p>
</div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(CORE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    for (const key of await caches.keys()) {
      if (!keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function crossOriginIsolation(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cacheable(response) {
  if (!response || !response.ok) return false;
  const length = Number(response.headers.get('content-length'));
  return !(length > MAX_CACHE_BYTES);
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
    return crossOriginIsolation(response);
  } catch (error) {
    const cached = (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(APP)) ||
      (await caches.match('./chromasmith-22.html', { ignoreSearch: true }));
    if (cached) return crossOriginIsolation(cached);
    return new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((response) => {
    if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  if (cached) return crossOriginIsolation(cached);
  const fresh = await network;
  return crossOriginIsolation(fresh || new Response('', { status: 504 }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.href === APP) return;
  event.respondWith(staleWhileRevalidate(request));
});
