import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from './types';
import { isRecord } from './validate';
import { easierLevels } from './levels';
import type { Level } from './levels';

// Word-miss loop: words the reader tapped in the Reader, or words tested
// by exam items answered wrong. One row per reader per word; repeats bump
// the counter. Powers the My Words deck (GET/DELETE) and the recommended
// books shelf (GET /recommend, ranked by missed-word overlap via the
// library book_words map). $0: pure D1 reads/writes, no AI.

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// Same normalization as the Reader's cleanWord: lowercase, letters plus
// interior hyphens/apostrophes (don't, well-known).
const WORD_RE = /^[a-z][a-z'-]{0,31}$/;
const SOURCES = ['reader', 'exam'] as const;

function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as string[]).includes(v);
}

async function recordMiss(
  db: D1Database,
  userId: string,
  word: string,
  level: Level,
  source: (typeof SOURCES)[number],
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_word_misses (user_id, word, level, source, misses, last_seen)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (user_id, word) DO UPDATE SET
         misses = user_word_misses.misses + 1,
         level = excluded.level,
         source = excluded.source,
         last_seen = excluded.last_seen`,
    )
    .bind(userId, word, level, source, now)
    .run();
}

export { recordMiss };

export const misses = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Record one stumble. The Reader dedupes per word per book-open; the exam
// submit path records one row per missed item's tested words.
misses.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body) || typeof body.word !== 'string' || !WORD_RE.test(body.word)) {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isLevel(body.level)) return c.json({ error: 'invalid request' }, 400);
  if (body.source !== 'reader' && body.source !== 'exam') {
    return c.json({ error: 'invalid request' }, 400);
  }
  await recordMiss(c.env.DB, c.get('userId'), body.word, body.level, body.source);
  return c.json({ ok: true, word: body.word });
});

// My Words deck source: most-missed first.
misses.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT word, level, source, misses, last_seen FROM user_word_misses WHERE user_id = ? ORDER BY misses DESC, last_seen DESC LIMIT 100',
  )
    .bind(c.get('userId'))
    .all<{ word: string; level: string; source: string; misses: number; last_seen: string }>();
  return c.json({ misses: results ?? [] });
});

// 'Got it': the learner knows this word — drop it from the deck.
misses.delete('/:word', async (c) => {
  const word = c.req.param('word').toLowerCase();
  if (!WORD_RE.test(word)) return c.json({ error: 'invalid request' }, 400);
  await c.env.DB.prepare('DELETE FROM user_word_misses WHERE user_id = ? AND word = ?')
    .bind(c.get('userId'), word)
    .run();
  return c.json({ ok: true });
});

// Recommended books: rank library books by how many of the reader's missed
// words they teach (book_words map), restricted to the reader's level and
// below. D1 cannot join across databases, so misses are read first and the
// library query uses a bounded IN list (<=100 words).
misses.get('/recommend', async (c) => {
  const uid = c.get('userId');
  const qLevel = c.req.query('level');
  const { results: missRows } = await c.env.DB.prepare(
    'SELECT word, level FROM user_word_misses WHERE user_id = ? LIMIT 100',
  )
    .bind(uid)
    .all<{ word: string; level: string }>();
  const missList = missRows ?? [];
  if (missList.length === 0) return c.json({ books: [] });

  // Default reader level: the highest level the reader stumbled at.
  // easierLevels already restricts to that level and below.
  const knownRanks = missList
    .map((m) => LEVELS.indexOf(m.level as Level))
    .filter((r) => r >= 0);
  const readerLevel: Level =
    qLevel && isLevel(qLevel) ? qLevel : LEVELS[Math.max(...knownRanks, 0)];
  const allowed = easierLevels(readerLevel);

  const words = [...new Set(missList.map((m) => m.word))];
  const inWords = words.map(() => '?').join(',');
  const inLevels = allowed.map(() => '?').join(',');
  const { results: hits } = await c.env.LIBRARY_DB.prepare(
    `SELECT book_id, COUNT(DISTINCT word) AS hits, GROUP_CONCAT(DISTINCT word) AS matched
     FROM book_words WHERE word IN (${inWords}) AND level IN (${inLevels})
     GROUP BY book_id ORDER BY hits DESC LIMIT 12`,
  )
    .bind(...words, ...allowed)
    .all<{ book_id: string; hits: number; matched: string }>();
  const hitList = hits ?? [];
  if (hitList.length === 0) return c.json({ books: [] });

  const ids = [...new Set(hitList.map((h) => h.book_id))];
  const { results: books } = await c.env.LIBRARY_DB.prepare(
    `SELECT id, title, level, cover_url FROM books WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ id: string; title: string; level: string; cover_url: string | null }>();
  const byId = new Map((books ?? []).map((b) => [b.id, b]));
  return c.json({
    books: hitList.flatMap((h) => {
      const b = byId.get(h.book_id);
      return b
        ? [{ id: b.id, title: b.title, level: b.level, cover_url: b.cover_url, hits: h.hits, matched: (h.matched ?? '').split(',').filter(Boolean) }]
        : [];
    }),
  });
});
