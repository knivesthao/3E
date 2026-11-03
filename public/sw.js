// 3E offline worker (Phase 4.4): runtime caching only, no build step.
// - Book catalog + manifests (/api/share/* JSON): stale-while-revalidate.
// - Panel art (/api/ai/art/*, immutable R2 bytes): cache-first.
// - Page navigations: network-first, falling back to the last cached shell.
// - Everything else (writes, exam, AI, positions): network only, untouched.
// Version the cache name to invalidate everything on the next strategy change.
const VERSION = 'e3-v1';
const SHELL_KEY = '/__e3-shell__';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(
      () => self.clients.claim(),
    ),
  );
});

function isArt(url) {
  return url.pathname.startsWith('/api/ai/art/');
}

function isShareJson(url) {
  return url.pathname === '/api/share/books' || /^\/api\/share\/[^/]+$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isArt(url)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (isShareJson(url)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        return hit ?? network.then((res) => res ?? new Response('{"error":"offline"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }));
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(SHELL_KEY, res.clone());
          return res;
        } catch {
          const shell = await cache.match(SHELL_KEY);
          return (
            shell ??
            new Response('3E needs a connection for this page.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            })
          );
        }
      }),
    );
  }
});
