import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { QUESTIONS } from './exam';

// Missed-word loop + progress summary over in-memory stubs: record bumps,
// validation rejects, 'Got it' clears, recommendations rank by overlap,
// exam misses feed the deck, summary combines books/flash/exam.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const misses = new Map<string, { word: string; level: string; source: string; misses: number; last_seen: string }>();
  const flash = new Map<string, { seen: number; known: number }>();
  const attempts: { user_id: string; score: number }[] = [];
  const sync = new Map<string, { book_id: string; scene_number: number; updated_by: string | null }>();
  const books = new Map<string, { id: string; title: string; level: string; cover_url: string | null; manifest_json: string }>();
  const wordRows: { book_id: string; word: string; level: string }[] = [];
  const missKey = (uid: string, word: string) => `${uid}:${word}`;
  return {
    seedSync(book_id: string, scene_number: number, updated_by: string | null) {
      sync.set(book_id, { book_id, scene_number, updated_by });
    },
    seedBook(id: string, title: string, level: string, scenes: number) {
      books.set(id, {
        id,
        title,
        level,
        cover_url: null,
        manifest_json: JSON.stringify({ scenes: Array.from({ length: scenes }, (_, i) => ({ scene_number: i + 1 })) }),
      });
    },
    seedWordRow(book_id: string, word: string, level: string) {
      wordRows.push({ book_id, word, level });
    },
    books,
    wordRows,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
          const uid = params[0] as string;
          return {
            first: async () => {
              if (q.startsWith('SELECT id FROM users WHERE email')) {
                const u = [...users.values()].find((x) => x.email === params[0]);
                return u ? { id: u.id } : null;
              }
              if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
                return sessions.get(params[0] as string) ?? null;
              }
              if (q.startsWith('SELECT users.id, users.email')) {
                const s = sessions.get(params[0] as string);
                if (!s) return null;
                const u = users.get(s.user_id);
                return u ? { id: u.id, email: u.email, expires_at: s.expires_at } : null;
              }
              if (q.startsWith('SELECT COALESCE(SUM(seen)')) {
                const rows = [...flash.entries()].filter(([k]) => k.startsWith(`${uid}:`));
                return {
                  seen: rows.reduce((s, [, r]) => s + r.seen, 0),
                  known: rows.reduce((s, [, r]) => s + r.known, 0),
                };
              }
              if (q.startsWith('SELECT COUNT(*) AS n, MAX(score) AS best FROM exam_attempts')) {
                const rows = attempts.filter((a) => a.user_id === uid);
                return { n: rows.length, best: rows.length ? Math.max(...rows.map((a) => a.score)) : null };
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT word, level, source, misses, last_seen FROM user_word_misses')) {
                const mine = [...misses.entries()]
                  .filter(([k]) => k.startsWith(`${uid}:`))
                  .map(([, m]) => m)
                  .sort((a, b) => b.misses - a.misses || (a.last_seen < b.last_seen ? 1 : -1));
                return { results: mine };
              }
              if (q.startsWith('SELECT word, level FROM user_word_misses')) {
                return {
                  results: [...misses.entries()]
                    .filter(([k]) => k.startsWith(`${uid}:`))
                    .map(([, m]) => ({ word: m.word, level: m.level })),
                };
              }
              if (q.startsWith('SELECT book_id, scene_number FROM reading_sync WHERE updated_by')) {
                return {
                  results: [...sync.values()]
                    .filter((s) => s.updated_by === uid)
                    .map((s) => ({ book_id: s.book_id, scene_number: s.scene_number })),
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO users')) {
                const [id, email] = params as [string, string, ...unknown[]];
                users.set(id, { id, email });
              } else if (q.startsWith('INSERT INTO sessions')) {
                const [h, id2, exp] = params as [string, string, number];
                sessions.set(h, { user_id: id2, expires_at: exp });
              } else if (q.startsWith('DELETE FROM sessions')) {
                sessions.delete(params[0] as string);
              } else if (q.startsWith('INSERT INTO user_word_misses')) {
                const [, word, level, source, now] = params as [string, string, string, string, string];
                const k = missKey(uid, word);
                const prev = misses.get(k);
                misses.set(k, prev
                  ? { word, level, source, misses: prev.misses + 1, last_seen: now }
                  : { word, level, source, misses: 1, last_seen: now });
              } else if (q.startsWith('DELETE FROM user_word_misses')) {
                misses.delete(missKey(uid, params[1] as string));
              } else if (q.startsWith('INSERT INTO user_flash_progress')) {
                const [, set, seen, known] = params as [string, string, number, number];
                const k = `${uid}:${set}`;
                const prev = flash.get(k) ?? { seen: 0, known: 0 };
                flash.set(k, { seen: prev.seen + seen, known: prev.known + known });
              } else if (q.startsWith('INSERT INTO exam_attempts')) {
                const [, u2, score] = params as [string, string, number, ...unknown[]];
                attempts.push({ user_id: u2, score });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;

// Library-store stub (3e-books): book_words overlap + book rows by id.
function makeLibraryDb(db: Db) {
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => null,
            all: async () => {
              if (q.startsWith('SELECT book_id, COUNT(DISTINCT word)')) {
                const wordCount = q.split('WHERE word IN (')[1].split(') AND')[0].split(',').length;
                const words = params.slice(0, wordCount) as string[];
                const levels = params.slice(wordCount) as string[];
                const byBook = new Map<string, Set<string>>();
                for (const r of db.wordRows) {
                  if (words.includes(r.word) && levels.includes(r.level)) {
                    const set = byBook.get(r.book_id) ?? new Set<string>();
                    set.add(r.word);
                    byBook.set(r.book_id, set);
                  }
                }
                const results = [...byBook.entries()].map(([book_id, set]) => ({
                  book_id,
                  hits: set.size,
                  matched: [...set].join(','),
                }));
                results.sort((a, b) => b.hits - a.hits);
                return { results: results.slice(0, 12) };
              }
              if (q.startsWith('SELECT id, title, level, cover_url FROM books WHERE id IN')) {
                return { results: (params as string[]).map((id) => db.books.get(id)).filter((b) => b !== undefined) };
              }
              if (q.startsWith('SELECT id, title, cover_url, manifest_json FROM books WHERE id IN')) {
                return { results: (params as string[]).map((id) => db.books.get(id)).filter((b) => b !== undefined) };
              }
              return { results: [] };
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
}

const ENV = (db: Db) => ({
  DB: db as unknown as D1Database,
  LIBRARY_DB: makeLibraryDb(db) as unknown as D1Database,
  DEV_LINKS: 'true',
});

async function signIn(db: Db): Promise<{ cookie: string; userId: string }> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'f@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  const cookie = (v.headers.get('set-cookie') ?? '').split(';')[0];
  const me = (await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json()) as { user: { id: string } };
  return { cookie, userId: me.user.id };
}

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify(body),
});

describe('word misses', () => {
  it('requires a session', async () => {
    const db = makeDb();
    expect((await app.request('/api/misses', {}, ENV(db))).status).toBe(401);
    expect((await app.request('/api/misses/recommend', {}, ENV(db))).status).toBe(401);
    expect((await app.request('/api/progress/summary', {}, ENV(db))).status).toBe(401);
  });

  it('rejects bad words, levels, and sources', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const env = ENV(db);
    for (const body of [
      { word: 'Cat', level: 'A1', source: 'reader' },
      { word: '', level: 'A1', source: 'reader' },
      { word: 'cat!', level: 'A1', source: 'reader' },
      { word: 'cat', level: 'Z9', source: 'reader' },
      { word: 'cat', level: 'A1', source: 'mic' },
      { word: 'x'.repeat(40), level: 'A1', source: 'reader' },
    ]) {
      expect((await app.request('/api/misses', json(cookie, body), env)).status).toBe(400);
    }
  });

  it('records repeats and lists most-missed first', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const env = ENV(db);
    await app.request('/api/misses', json(cookie, { word: 'cat', level: 'A1', source: 'reader' }), env);
    await app.request('/api/misses', json(cookie, { word: 'sun', level: 'A1', source: 'reader' }), env);
    await app.request('/api/misses', json(cookie, { word: 'sun', level: 'A1', source: 'reader' }), env);
    const res = await app.request('/api/misses', { headers: { cookie } }, env);
    const { misses } = (await res.json()) as { misses: { word: string; misses: number; source: string }[] };
    expect(misses.map((m) => [m.word, m.misses])).toEqual([['sun', 2], ['cat', 1]]);
    expect(misses[0].source).toBe('reader');
  });

  it('clears a learned word and rejects bad deletes', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const env = ENV(db);
    await app.request('/api/misses', json(cookie, { word: 'cat', level: 'A1', source: 'reader' }), env);
    expect((await app.request('/api/misses/CAT', { method: 'DELETE', headers: { cookie } }, env)).status).toBe(200);
    const { misses } = (await (await app.request('/api/misses', { headers: { cookie } }, env)).json()) as { misses: unknown[] };
    expect(misses).toEqual([]);
    expect((await app.request('/api/misses/bad!', { method: 'DELETE', headers: { cookie } }, env)).status).toBe(400);
  });

  it('recommends books by missed-word overlap at or below the reader level', async () => {
    const db = makeDb();
    db.seedBook('b1', 'Sun House', 'A1', 6);
    db.seedBook('b2', 'Quantum Dreams', 'C2', 6);
    db.seedWordRow('b1', 'sun', 'A1');
    db.seedWordRow('b1', 'house', 'A1');
    db.seedWordRow('b2', 'sun', 'C2');
    const { cookie } = await signIn(db);
    const env = ENV(db);
    await app.request('/api/misses', json(cookie, { word: 'sun', level: 'A2', source: 'reader' }), env);
    await app.request('/api/misses', json(cookie, { word: 'house', level: 'A2', source: 'exam' }), env);
    const res = await app.request('/api/misses/recommend', { headers: { cookie } }, env);
    const { books } = (await res.json()) as { books: { id: string; hits: number; matched: string[] }[] };
    // Reader level defaults to the highest miss level (A2): the C2 book is
    // out even though it also teaches 'sun'.
    expect(books.map((b) => [b.id, b.hits])).toEqual([['b1', 2]]);
    expect(books[0].matched.sort()).toEqual(['house', 'sun']);
  });

  it('returns no recommendations without misses', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const res = await app.request('/api/misses/recommend', { headers: { cookie } }, ENV(db));
    expect(((await res.json()) as { books: unknown[] }).books).toEqual([]);
  });
});

describe('exam missed words', () => {
  it('records missed item vocabulary and returns it for practice', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const env = ENV(db);
    const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
    const form = QUESTIONS.map((q) => q.id);
    const answers = form.map((id) => ({
      id,
      choice: id === 'p1a' ? (byId.get(id)!.answer + 1) % 4 : byId.get(id)!.answer,
    }));
    const res = await app.request('/api/exam/submit', json(cookie, { form, answers }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { missedWords: string[] };
    expect(body.missedWords).toContain('cat');
    const { misses } = (await (await app.request('/api/misses', { headers: { cookie } }, env)).json()) as {
      misses: { word: string; source: string; level: string }[];
    };
    expect(misses).toContainEqual(expect.objectContaining({ word: 'cat', source: 'exam', level: 'A1' }));
  });
});

describe('progress summary', () => {
  it('rejects bad sets and deltas', async () => {
    const db = makeDb();
    const { cookie } = await signIn(db);
    const env = ENV(db);
    expect((await app.request('/api/progress/flash/nope', json(cookie, { seen: 1, known: 0 }), env)).status).toBe(400);
    expect((await app.request('/api/progress/flash/A1', json(cookie, { seen: -1, known: 0 }), env)).status).toBe(400);
    expect((await app.request('/api/progress/flash/A1', json(cookie, { seen: 1.5, known: 0 }), env)).status).toBe(400);
  });

  it('combines books, flash totals, and exam best', async () => {
    const db = makeDb();
    db.seedBook('b1', 'Done Book', 'A1', 3);
    db.seedBook('b2', 'Open Book', 'A1', 3);
    const { cookie, userId } = await signIn(db);
    const env = ENV(db);
    db.seedSync('b1', 3, userId);
    db.seedSync('b2', 1, userId);
    await app.request('/api/progress/flash/A1', json(cookie, { seen: 6, known: 0 }), env);
    await app.request('/api/progress/flash/mine', json(cookie, { seen: 0, known: 2 }), env);
    const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
    const form = QUESTIONS.map((q) => q.id);
    await app.request(
      '/api/exam/submit',
      json(cookie, { form, answers: form.map((id) => ({ id, choice: byId.get(id)!.answer })) }),
      env,
    );
    const res = await app.request('/api/progress/summary', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const s = (await res.json()) as {
      booksStarted: number;
      booksFinished: number;
      finished: { id: string }[];
      flashSeen: number;
      flashKnown: number;
      examAttempts: number;
      examBest: number | null;
    };
    expect(s.booksStarted).toBe(2);
    expect(s.booksFinished).toBe(1);
    expect(s.finished.map((b) => b.id)).toEqual(['b1']);
    expect(s.flashSeen).toBe(6);
    expect(s.flashKnown).toBe(2);
    expect(s.examAttempts).toBe(1);
    expect(s.examBest).toBe(24);
  });
});
