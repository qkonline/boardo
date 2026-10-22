// Boardo's service worker. Generated into dist/sw.js at build time (see vite.config.ts), which
// fills in the cache version and the build's file list.
// Pages: network first, falling back to the cached copy offline. Build files: cache first.
// Everything else (the API, attachments) goes straight to the network.

const CACHE = 'boardo-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...ASSETS])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('boardo-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Which build is current: always the server's answer, never a cached one.
  if (url.pathname === scope.pathname + 'version.json') return;

  if (req.mode === 'navigate') {
    const isShell = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isShell && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match(isShell ? './' : req).then((hit) => hit || caches.match('./'))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
