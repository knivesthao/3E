import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { isRecord } from './validate';
import { finishedBooks } from './shelf';

// Reader progress: flashcard deck totals plus a summary combining books
// (reading_sync positions via the shared shelf helper), exams (existing
// exam_attempts table — no new table), and flash totals. Writes carry the
// session user id only; no client-supplied user ids anywhere.

const SET_KEYS = [
  'letters',
  'names',
  'teams',
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'mine',
] as const;

export const progress = new Hono<{ Bindings: Bindings; Variables: Variables }>({
  strict: false,
});

// Add to a deck's counters (seen when a deck completes, known for 'Got it'
// clears in the My Words deck). Deltas only, so StrictMode double-fires in
// dev stay small and the client guards with a ref.
progress.post('/flash/:set', async (c) => {
  const set = c.req.param('set');
  if (!(SET_KEYS as readonly string[]).includes(set)) {
    return c.json({ error: 'invalid request' }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body)) return c.json({ error: 'invalid request' }, 400);
  const seen = body.seen === undefined ? 0 : body.seen;
  const known = body.known === undefined ? 0 : body.known;
  if (
    typeof seen !== 'number' ||
    typeof known !== 'number' ||
    !Number.isInteger(seen) ||
    !Number.isInteger(known) ||
    seen < 0 ||
    known < 0 ||
    seen > 10000 ||
    known > 10000
  ) {
    return c.json({ error: 'invalid request' }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO user_flash_progress (user_id, set_key, seen, known, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, set_key) DO UPDATE SET
       seen = user_flash_progress.seen + excluded.seen,
       known = user_flash_progress.known + excluded.known,
       updated_at = excluded.updated_at`,
  )
    .bind(c.get('userId'), set, seen, known, now)
    .run();
  return c.json({ ok: true });
});

// One card for the About tab: books started/finished, flash totals, exam
// attempts/best. Hidden entirely when signed out (session gate 401s).
progress.get('/summary', async (c) => {
  const uid = c.get('userId');
  const [flashRow, examRow, shelf] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(seen), 0) AS seen, COALESCE(SUM(known), 0) AS known FROM user_flash_progress WHERE user_id = ?',
    )
      .bind(uid)
      .first<{ seen: number | null; known: number | null }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n, MAX(score) AS best FROM exam_attempts WHERE user_id = ?')
      .bind(uid)
      .first<{ n: number | null; best: number | null }>(),
    finishedBooks(c.env.DB, c.env.LIBRARY_DB, uid),
  ]);
  return c.json({
    booksStarted: shelf.started,
    booksFinished: shelf.finished.length,
    finished: shelf.finished,
    flashSeen: flashRow?.seen ?? 0,
    flashKnown: flashRow?.known ?? 0,
    examAttempts: examRow?.n ?? 0,
    examBest: examRow?.best ?? null,
  });
});
