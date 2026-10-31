import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { bustShareCache, cachedJson } from './cache';
import type { Bindings, Variables } from './types';

// Map-backed Cache API stand-in: same key semantics (exact request URL),
// clone-on-store like the real thing.
function stubCaches() {
  const store = new Map<string, Response>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  const deleted: string[] = [];
  (globalThis as { caches?: unknown }).caches = {
    default: {
      match: async (r: Request) => (store.get(key(r))?.clone() ?? undefined),
      put: async (r: Request, res: Response) => {
        store.set(key(r), res.clone());
      },
      delete: async (r: Request | string) => {
        deleted.push(key(r));
        return store.delete(key(r));
      },
    },
  };
  return { store, deleted };
}

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

type App = Hono<{ Bindings: Bindings; Variables: Variables }>;

function build() {
  const app: App = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  let hits = 0;
  let misses = 0;
  app.get('/thing', (c) =>
    cachedJson(c, 3600, async () => {
      hits++;
      return { status: 200, body: { n: hits } };
    }),
  );
  app.get('/missing', (c) =>
    cachedJson(c, 3600, async () => {
      misses++;
      return { status: 404, body: { error: 'not found' } };
    }),
  );
  return { app, calls: () => ({ hits, misses }) };
}

const get = (app: App, path: string) => app.request(path, {}, {} as Bindings);

describe('cachedJson', () => {
  it('loads directly on every request without a cache', async () => {
    const { app } = build();
    expect(await (await get(app, '/thing')).json()).toEqual({ n: 1 });
    expect(await (await get(app, '/thing')).json()).toEqual({ n: 2 });
  });

  it('serves hits with zero loader calls and a public TTL', async () => {
    stubCaches();
    const { app, calls } = build();
    const first = await get(app, '/thing');
    expect(await first.json()).toEqual({ n: 1 });
    expect(first.headers.get('cache-control')).toBe('public, max-age=3600');
    const second = await get(app, '/thing');
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(calls()).toEqual({ hits: 1, misses: 0 });
  });

  it('caches misses briefly instead of hammering the origin', async () => {
    stubCaches();
    const { app, calls } = build();
    const first = await get(app, '/missing');
    expect(first.status).toBe(404);
    expect(first.headers.get('cache-control')).toBe('public, max-age=60');
    const second = await get(app, '/missing');
    expect(second.status).toBe(404);
    expect(calls()).toEqual({ hits: 0, misses: 1 });
  });
});

describe('bustShareCache', () => {
  it('is a no-op without a cache and deletes exact keys with one', async () => {
    await bustShareCache('http://localhost', 'b1');
    const { deleted } = stubCaches();
    await bustShareCache('http://localhost', 'b1');
    expect(deleted).toEqual(['http://localhost/api/share/books', 'http://localhost/api/share/b1']);
  });
});
