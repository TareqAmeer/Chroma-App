#!/usr/bin/env node
// Live-source preview of the Library UI — the tool the wireframe-fidelity handover called for.
//
// The problem this replaces: every look at a Library change required `bash build-desktop.sh`
// (a staging copy) followed by a manual browser refresh. This server does neither. It serves
// `/desktop/dist/index.html` by SYNTHESISING it in memory from the same source files
// build-desktop.sh stages from (chromasmith-22.html + the injected <script> tags), and serves
// desktop/library-ui.js, desktop/desktop-native.js and vendor/ straight off disk — so an edit
// to desktop/library-ui.js is live on the next reload, no build step in between.
//
// ⚠️ This does NOT replace build-desktop.sh. `desktop/dist/` stays the tests' actual source of
// truth (test/wireframe_behaviour.mjs, test/library_perf.mjs, etc. all read desktop/dist/ from
// disk) — the build is still mandatory before any check. This server exists purely for the
// iteration loop in between: make an edit, refresh, look, without waiting on the build.
//
// Usage: npm run preview [-- --port=4500]
// Opens on the same URL contract the tests use: ?libtest=1&libcat=1&libn=60 by default (the
// mock backend + catalog counts + a synthetic 60-file folder — see library-ui.js:16,234-240 —
// so what you see here is the same mock state the behaviour suite drives). Any other query
// string works too, e.g. http://127.0.0.1:PORT/?libn=200&deskx=1 for a phone-shell look.
import { createServer } from 'node:http';
import { readFile, watch } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = parseInt((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] || '4500', 10);

// Same injection build-desktop.sh performs, kept in sync deliberately (both read the same
// literal script tags) — see its own comment for why rfind, not the first match, is required.
function injectShellScripts(html) {
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) throw new Error('index.html has no </body> to inject before');
  const tags = '<script src="/desktop/library-ui.js.reload-shim"></script>\n'
    + '<script src="desktop-native.js"></script>\n<script src="library-ui.js"></script>\n';
  return html.slice(0, idx) + tags + html.slice(idx);
}

// Injected only here, never in build-desktop.sh's output — a tiny SSE client that reloads the
// page when the watcher (below) sees a source file change. Served as a fake "library-ui.js"
// sibling path so it needs no change to the injection point above.
const RELOAD_SHIM = `
(() => {
  const es = new EventSource('/__preview_reload');
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
})();
`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json',
  '.bin': 'application/octet-stream',
};

// SSE clients waiting on a reload signal.
const reloadClients = new Set();
function broadcastReload() {
  for (const res of reloadClients) res.write('data: reload\n\n');
}

// Watch the three source files build-desktop.sh stages. fs.watch on individual files (not a
// directory recursive watch) keeps this cheap and avoids reacting to unrelated churn under
// vendor/ or test/output/.
const WATCHED = ['chromasmith-22.html', 'desktop/library-ui.js', 'desktop/desktop-native.js'];
for (const rel of WATCHED) {
  (async () => {
    try {
      const watcher = watch(path.join(ROOT, rel));
      for await (const _ of watcher) {
        console.log(`[preview] ${rel} changed — reloading connected tabs`);
        broadcastReload();
      }
    } catch (e) { /* file briefly missing during a save — next watch cycle picks it back up */ }
  })();
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let p = decodeURIComponent(u.pathname);

  if (p === '/__preview_reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  if (p === '/desktop/library-ui.js.reload-shim') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(RELOAD_SHIM);
    return;
  }

  // The synthesised entry point. Anything requesting the dist HTML — including the bare
  // root, matching how the built app is normally opened — gets it built fresh from source.
  if (p === '/' || p === '/index.html' || p === '/desktop/dist/index.html' || p === '/desktop/dist/') {
    try {
      const html = injectShellScripts(await readFile(path.join(ROOT, 'chromasmith-22.html'), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
    return;
  }

  // library-ui.js / desktop-native.js / vendor/* served live from the working tree, whether
  // requested as bare filenames (how the synthesised index.html above references them) or
  // under /desktop/dist/... (how a direct link into the "built" tree would ask for them).
  if (p === '/library-ui.js' || p === '/desktop/dist/library-ui.js') p = '/desktop/library-ui.js';
  if (p === '/desktop-native.js' || p === '/desktop/dist/desktop-native.js') p = '/desktop/desktop-native.js';
  if (p.startsWith('/desktop/dist/vendor/')) p = p.replace('/desktop/dist/vendor/', '/vendor/');

  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found: ' + p);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const qs = 'libtest=1&libcat=1&libn=60';
  console.log(`\nChromasmith Library — live source preview`);
  console.log(`  ${`http://127.0.0.1:${PORT}/?${qs}`}`);
  console.log(`\nServing desktop/library-ui.js and desktop/desktop-native.js LIVE from disk —`);
  console.log(`edit either file and the open tab reloads automatically.`);
  console.log(`\nThis is NOT desktop/dist/ — run 'bash build-desktop.sh' before any test/check.\n`);
});
