import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import type { BookRow } from './projects';
import { readJson } from './ai/http';

// Public read route for published books (Step 5a). No session gate —
// index.ts exempts /api/share/*. Only published books exist in `books`,
// so reachability itself is the gate. Keys are unguessable UUIDs.
export const share = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const NOT_FOUND = { error: 'not found' } as const;
const INVALID = { error: 'invalid request' } as const;

share.get('/:bookId', async (c) => {
  const book = await c.env.DB.prepare('SELECT * FROM books WHERE id = ?')
    .bind(c.req.param('bookId'))
    .first<BookRow>();
  if (!book) return c.json(NOT_FOUND, 404);
  return c.json({ book: { ...book, manifest: JSON.parse(book.manifest_json) as unknown } });
});

// Dual reading (Step 6a): one shared scene position per book, polling.
// Same public gate as the share route so a second device on the link stays
// in sync. First scene is the default until someone moves.
share.get('/:bookId/position', async (c) => {
  const book = await c.env.DB.prepare('SELECT id FROM books WHERE id = ?')
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
  const book = await c.env.DB.prepare('SELECT id FROM books WHERE id = ?')
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
