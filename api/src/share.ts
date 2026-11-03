import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import type { BookRow } from './projects';
import { readJson } from './ai/http';
import { cachedJson } from './cache';

// Public read route for published books (Step 5a). No session gate —
// index.ts exempts /api/share/*. Only published books exist in `books`,
// so reachability itself is the gate. Keys are unguessable UUIDs.
export const share = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const NOT_FOUND = { error: 'not found' } as const;
const INVALID = { error: 'invalid request' } as const;

// Public catalog for the Library page. Same gate as reading: only published
// books exist in `books`, newest first. Cover + level + focus tags, no
// manifest payload. Edge-cached (busted on publish): hits cost zero D1 reads.
share.get('/books', async (c) => {
  return cachedJson(c, 3600, async () => {
    const { results } = await c.env.LIBRARY_DB.prepare(
      'SELECT id, title, level, tags_json, cover_url, published_at FROM books ORDER BY published_at DESC',
    )
      .bind()
      .all<{
        id: string;
        title: string;
        level: string;
        tags_json: string | null;
        cover_url: string | null;
        published_at: string;
      }>();
    return { status: 200, body: { books: results.map((r) => ({ ...r, tags: tagsOf(r) })) } };
  });
});

share.get('/:bookId', async (c) => {
  // One read on miss, zero on hit — including 404s, which cache briefly.
  // Safe: publish busts the exact key, so a late-published book appears.
  return cachedJson(c, 3600, async () => {
    const book = await c.env.LIBRARY_DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(c.req.param('bookId'))
      .first<BookRow>();
    if (!book) return { status: 404, body: NOT_FOUND };
    return {
      status: 200,
      body: { book: { ...book, tags: tagsOf(book), manifest: JSON.parse(book.manifest_json) as unknown } },
    };
  });
});

// tags_json predates some rows and hand edits: never let a bad value break
// the catalog — unparseable means untagged.
function tagsOf(row: { tags_json?: unknown }): string[] {
  try {
    const v = typeof row.tags_json === 'string' ? (JSON.parse(row.tags_json) as unknown) : [];
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// Dual reading (Step 6a): one shared scene position per book, polling.
// Same public gate as the share route so a second device on the link stays
// in sync. First scene is the default until someone moves. Deliberately
// NEVER edge-cached: polled every few seconds, freshness beats speed here.
share.get('/:bookId/words', async (c) => {
  // Defined-words map for the Reader: which words of this book have a
  // dictionary gloss, so undefined words render as plain text instead of
  // inviting a lookup that can only fail. Public (same gate as the book:
  // reachability). Deliberately NOT edge-cached: one cheap D1 read per
  // book-open, always fresh after republish, no bust wiring to forget.
  const bookId = c.req.param('bookId');
  const book = await c.env.LIBRARY_DB.prepare('SELECT id FROM books WHERE id = ?')
    .bind(bookId)
    .first<{ id: string }>();
  if (!book) return c.json(NOT_FOUND, 404);
  const { results } = await c.env.LIBRARY_DB.prepare(
    'SELECT word FROM book_words WHERE book_id = ? AND defined = 1',
  )
    .bind(bookId)
    .all<{ word: string }>();
  return c.json({ words: [...new Set((results ?? []).map((r) => r.word))] });
});

share.get('/:bookId/position', async (c) => {
  const book = await c.env.LIBRARY_DB.prepare('SELECT id FROM books WHERE id = ?')
    .bind(c.req.param('bookId'))
    .first<{ id: string }>();
  if (!book) return c.json(NOT_FOUND, 404);
  const row = await c.env.DB.prepare('SELECT scene_number, updated_at FROM reading_sync WHERE book_id = ?')
    .bind(book.id)
    .first<{ scene_number: number; updated_at: string }>();
  return c.json(row ?? { scene_number: 1, updated_at: null });
});

share.post('/:bookId/position', async (c) => {
  const body = await readJson(c);
  const scene = (body as { scene_number?: unknown } | null)?.scene_number;
  if (typeof scene !== 'number' || !Number.isInteger(scene) || scene < 1 || scene > 1000) {
    return c.json(INVALID, 400);
  }
  const book = await c.env.LIBRARY_DB.prepare('SELECT id FROM books WHERE id = ?')
    .bind(c.req.param('bookId'))
    .first<{ id: string }>();
  if (!book) return c.json(NOT_FOUND, 404);
  const now = new Date().toISOString();
  const updatedBy = (c.get('userId') as string | undefined) ?? null;
  await c.env.DB.prepare(
    `INSERT INTO reading_sync (book_id, scene_number, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET scene_number = excluded.scene_number, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(book.id, scene, updatedBy, now)
    .run();
  return c.json({ ok: true as const, scene_number: scene });
});
