// Boardo's service worker. Generated into dist/sw.js at build time (see vite.config.ts), which
// fills in the cache version and the build's file list.
// Pages: network first, falling back to the cached copy offline. Build files: cache first.
// Everything else (the API, at /api/ on the app's own address, and attachments) goes straight
// to the network.

const CACHE = 'boardo-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...ASSETS])));
});

// The previous build's cache stays until the one after: a page it served may still be loading
// its files when this worker takes over (it activates at once), and on the server they're gone.
// caches.keys() lists caches oldest first.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const older = (await caches.keys()).filter((k) => k.startsWith('boardo-') && k !== CACHE);
      for (const k of older.slice(0, -1)) await caches.delete(k);
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
  // Which build is current: always the server's answer, never a cached one. Nor the API.
  if (url.pathname === scope.pathname + 'version.json' || url.pathname.startsWith(scope.pathname + 'api/')) return;

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

  // Build files never vary (their names carry a hash of their content), whatever a server's Vary says.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(
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
