// Boardo's service worker. Generated into dist/sw.js at build time (see vite.config.ts), which
// fills in the cache version and the build's file list.
// Pages: network first, falling back to the cached copy offline. Build files: cache first.
// Everything else (the API, at /api/ on the app's own address, and attachments) goes straight
// to the network.

const CACHE = 'boardo-__VERSION__';
const ASSETS = __ASSETS__;
/** The API, for what a notification should say. */
const API = __API__;

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

// ---------- notifications ----------
// A board sends an empty push when there's an update in the bell for the person signed in here
// (worker/src/inbox.ts). Ask the API what's new and show each one not shown here yet; more than
// three at once become one that says how many. A push must always show something.

self.addEventListener('push', (e) => e.waitUntil(showUpdates()));

async function showUpdates() {
  let notes = [];
  let unseen = 0;
  try {
    const token = await sessionToken();
    if (token) {
      const res = await fetch(API + '/notes', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.ok) ({ notes, unseen } = await res.json());
    }
  } catch {
    /* offline: say so plainly below */
  }
  try {
    if (unseen) await self.navigator.setAppBadge?.(unseen);
    else await self.navigator.clearAppBadge?.();
  } catch {
    /* no badges here */
  }
  const after = await lastShown();
  const fresh = notes.filter((n) => !n.read && n.at > after).reverse();
  if (!fresh.length) return show('Boardo', "There's something new for you in Boardo.", 'boardo', null);
  await setLastShown(Math.max(...fresh.map((n) => n.at)));
  if (fresh.length > 3) return show('Boardo', `${fresh.length} new updates`, 'boardo', null);
  for (const n of fresh) await show(n.boardName, line(n) + (n.quote ? `\n“${n.quote}”` : ''), n.id, n.id);
}

function show(title, body, tag, note) {
  return self.registration.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { note } });
}

/** Tapping one opens Boardo on its card: the open copy if there is one. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const note = e.notification.data?.note ?? null;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        if (note) open.postMessage({ t: 'open-note', id: note });
        return;
      }
      return self.clients.openWindow(note ? `./?note=${encodeURIComponent(note)}` : './');
    }),
  );
});

/** What an update says (src/lib/notetext.ts, briefly). */
function line(n) {
  const who = n.by?.name ?? 'Someone';
  const card = n.title || 'a card';
  const role = n.to === 'admin' ? 'an admin' : 'a member';
  switch (n.kind) {
    case 'mention':
      return `${who} mentioned you in ${card}`;
    case 'assigned':
      return `${who} added you to ${card}`;
    case 'unassigned':
      return `${who} took you off ${card}`;
    case 'comment':
      return `${who} commented on ${card}`;
    case 'status':
      return n.to ? `${who} set ${card} to ${n.to}` : `${who} took the status off ${card}`;
    case 'completed':
      return `${card} is completed.`;
    case 'due':
      return n.to ? `${who} moved the due date of ${card} to ${dayLabel(n.to)}` : `${who} took the due date off ${card}`;
    case 'unblocked':
      return `${n.dep || 'A card'} is done, so you can start ${card}`;
    case 'added':
      return `${who} added you to ${n.boardName} as ${role}`;
    case 'role':
      return `${who} made you ${role} of ${n.boardName}`;
    case 'removed':
      return `${who} took you out of ${n.boardName}`;
  }
  return 'Something changed';
}

function dayLabel(v) {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The sign-in on this device, from the app's own store. Never makes that store if it isn't there. */
function sessionToken() {
  return new Promise((resolve) => {
    const req = indexedDB.open('boardo');
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction('meta').objectStore('meta').get('session');
        get.onsuccess = () => (db.close(), resolve(get.result?.token ?? null));
        get.onerror = () => (db.close(), resolve(null));
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

// When the newest update shown here was, kept in a cache of its own (not one of the build's).
async function lastShown() {
  const hit = await (await caches.open('notes-state')).match('last');
  return hit ? Number(await hit.text()) || 0 : 0;
}
async function setLastShown(at) {
  await (await caches.open('notes-state')).put('last', new Response(String(at)));
}
