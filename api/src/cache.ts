import type { Context } from 'hono';

// Edge cache-aside for public, identical-for-everyone GETs (catalog, book
// manifests). caches.default is per-PoP and free — no new service, no new
// bill. Degrades to a direct load wherever the Cache API is absent (tests,
// non-worker runtimes). 404s cache briefly (thundering-herd guard); publish
// busts by exact key, so a book published after a miss appears immediately.
// Do NOT route pulsing-fresh data here: the position poll bypasses the
// cache by simply not calling this.
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

function edgeCache(): EdgeCache | undefined {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
}

export async function cachedJson(
  c: Context,
  ttlSeconds: number,
  loader: () => Promise<{ status: number; body: unknown }>,
  missTtlSeconds = 60,
): Promise<Response> {
  const headersFor = (status: number) => ({
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${status === 200 ? ttlSeconds : missTtlSeconds}`,
  });
  const store = edgeCache();
  if (!store) {
    const { status, body } = await loader();
    return new Response(JSON.stringify(body), { status, headers: headersFor(status) });
  }
  const hit = await store.match(c.req.raw);
  if (hit) return hit;
  const { status, body } = await loader();
  const res = new Response(JSON.stringify(body), { status, headers: headersFor(status) });
  await store.put(c.req.raw, res.clone());
  return res;
}

// Publish invalidation: exact keys the catalog + book were cached under.
// Safe to call without a cache (dev/tests): no-op.
export async function bustShareCache(origin: string, bookId?: string): Promise<void> {
  const store = edgeCache();
  if (!store) return;
  await store.delete(new Request(`${origin}/api/share/books`));
  if (bookId) await store.delete(new Request(`${origin}/api/share/${bookId}`));
}
