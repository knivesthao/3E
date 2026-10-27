// 3E service worker (Step 5b): app shell + published books + panels cached
// for offline reading. Bump V to invalidate.
const V = 'e3-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(V)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheFirst = (req) =>
  caches.open(V).then((c) =>
    c.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        }),
    ),
  );

const netFirst = (req) =>
  caches.open(V).then((c) =>
    fetch(req)
      .then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })
      .catch(() => c.match(req)),
  );

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const p = u.pathname;
  if (
    p.startsWith('/api/share/') ||
    p.startsWith('/api/ai/art/') ||
    p.startsWith('/assets/') ||
    p === '/icon.svg' ||
    p === '/manifest.webmanifest'
  ) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  e.respondWith(netFirst(e.request));
});
