import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { DAILY_AI_LIMIT } from './ai/config';

// Minimal stub: real session flow (request-link + verify), COUNT(*)
// answers for the stats tables, and exam_attempts rows for item stats.
// Specs needs no DB at all.
function makeDb(counts: Record<string, number>, examRows: string[] = []) {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const defs = new Map<string, Record<string, unknown>>();
  const seedJobs = new Map<string, Record<string, unknown>>();
  return {
    defs,
    counts,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const all = async (params: unknown[] = []) => {
        if (q.startsWith('SELECT answers_json FROM exam_attempts')) {
          return { results: examRows.map((answers_json) => ({ answers_json })) };
        }
        if (q.startsWith('SELECT word, level FROM definitions')) {
          const levels = new Set(params as string[]);
          return {
            results: [...defs.values()]
              .filter((d) => levels.size === 0 || levels.has(d.level as string))
              .map((d) => ({ word: d.word, level: d.level })),
          };
        }
        if (q.startsWith('SELECT scope, levels, shard') && q.includes('FROM seed_jobs')) {
          return { results: [...seedJobs.values()] };
        }
        return { results: [] };
      };
      const first = async (params: unknown[]) => {
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
              if (q.startsWith('SELECT COUNT(*) AS n FROM')) {
                const table = q.split('FROM ')[1];
                // Books live in the library store; the app stub knows none.
                if (table === 'books') return { n: 0 };
                return { n: counts[table] ?? 0 };
              }
              return null;
            };
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT OR IGNORE INTO definitions')) {
          const [word, level, lang] = params as [string, string, string, ...unknown[]];
          const k = `${word}|${level}|${lang}`;
          if (!defs.has(k)) defs.set(k, { word, level, lang });
        } else if (q.startsWith('INSERT INTO seed_jobs')) {
          const [id, scope, levels, shard, status, total, done, missed_json, error, run_url, started_at, updated_at] =
            params as unknown[];
          seedJobs.set(scope as string, {
            id, scope, levels, shard, status, total, done, missed_json, error, run_url, started_at, updated_at,
          });
        } else if (q.startsWith('INSERT INTO users')) {
          const [id, email] = params as [string, string, ...unknown[]];
          users.set(id, { id, email });
        } else if (q.startsWith('INSERT INTO sessions')) {
          const [id_hash, user_id, expires_at] = params as [string, string, number];
          sessions.set(id_hash, { user_id, expires_at });
        } else if (q.startsWith('DELETE FROM sessions')) {
          if (q.includes('id_hash')) sessions.delete(params[0] as string);
        }
        return { success: true };
      };
      return {
        bind: (...params: unknown[]) => ({
          first: () => first(params),
          run: () => run(params),
          all: () => all(params),
        }),
        first: () => first([]),
        all: () => all([]),
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;

// Library-store stub (3e-books): answers only the books count.
function makeLibraryDb(counts: Record<string, number>) {
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async () => {
        if (q.startsWith('SELECT COUNT(*) AS n FROM books')) return { n: counts.books ?? 0 };
        return null;
      };
      return {
        bind: () => ({ first, run: async () => ({ success: true }), all: async () => ({ results: [] }) }),
        first,
        all: async () => ({ results: [] }),
      };
    },
  };
}

const ENV = (db: Db) => ({
  DB: db as unknown as D1Database,
  LIBRARY_DB: makeLibraryDb(db.counts) as unknown as D1Database,
  DEV_LINKS: 'true',
  MODEL_API_KEY: 'test-key',
});

async function signIn(db: Db): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('GET /api/admin/specs', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/admin/specs');
    expect(res.status).toBe(401);
  });

  it('reports models and wiring without secret material', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const res = await app.request('/api/admin/specs', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      models: {
        text: 'muse-spark-1.3',
        image: 'muse-image-1.0',
        segment: 'sam-3.1',
      },
      basetenConfigured: false,
      dailyAiLimit: DAILY_AI_LIMIT,
    });
    expect(JSON.stringify(body)).not.toMatch(/test-key|sk-|bearer/i);
  });
});

describe('GET /api/admin/stats', () => {
  it('returns aggregate counts, no per-user rows', async () => {
    const db = makeDb({ users: 2, projects: 3, scenes: 12, books: 1, panels: 4, jobs: 5, ai_usage: 40 });
    const cookie = await signIn(db);
    const res = await app.request('/api/admin/stats', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      counts: { users: 2, projects: 3, scenes: 12, books: 1, panels: 4, jobs: 5, ai_usage: 40 },
    });
  });
});

describe('GET /api/admin/exam-items', () => {
  const reviewRow = (review: { id: string; correct: boolean }[]) =>
    JSON.stringify({ form: review.map((r) => r.id), review });
  const legacyRow = (answers: { id: string; choice: number }[]) => JSON.stringify(answers);

  it('requires a session', async () => {
    expect((await app.request('/api/admin/exam-items')).status).toBe(401);
  });

  it('computes per-item difficulty from stored reviews', async () => {
    const db = makeDb({}, [
      reviewRow([
        { id: 'p1a', correct: true },
        { id: 'p2a', correct: false },
      ]),
      reviewRow([
        { id: 'p1a', correct: false },
        { id: 'p2a', correct: false },
      ]),
      legacyRow([{ id: 'p3a', choice: 0 }]),
      'not-json{{{',
    ]);
    const cookie = await signIn(db);
    const res = await app.request('/api/admin/exam-items', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; attempts: number; correct: number; pct: number | null }[];
    };
    const byId = new Map(body.items.map((i) => [i.id, i]));
    expect(byId.get('p1a')).toMatchObject({ attempts: 2, correct: 1, pct: 50 });
    expect(byId.get('p2a')).toMatchObject({ attempts: 2, correct: 0, pct: 0 });
    // Legacy answers-only row: exposure counted, correctness unknown.
    expect(byId.get('p3a')).toMatchObject({ attempts: 1, correct: 0, pct: 0 });
  });
});

describe('POST /api/admin/definitions', () => {
  const post = (db: Db, body: unknown, cookie?: string, devLinks = true) =>
    app.request('/api/admin/definitions', {
      method: 'POST',
      headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { DB: db as unknown as D1Database, DEV_LINKS: devLinks ? 'true' : 'false', MODEL_API_KEY: 'test-key' });

  it('requires a session and dev mode', async () => {
    const db = makeDb({});
    expect((await post(db, { rows: [] })).status).toBe(401);
    const cookie = await signIn(db);
    expect((await post(db, { rows: [] }, cookie, false)).status).toBe(404);
  });

  it('stores valid rows, skips invalid ones, and reseeds idempotently', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const rows = [
      { word: 'Cat', level: 'A1', gloss: 'a small pet', verified: 1 },
      { word: 'x'.repeat(51), level: 'A1', gloss: 'too long a word' },
      { word: 'dog', level: 'Z9', gloss: 'bad level' },
      { word: 'fish', level: 'A1', gloss: '' },
    ];
    const res = await post(db, { rows }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 1 });
    expect(db.defs.size).toBe(1);
    expect(db.defs.get('cat|A1|en')).toMatchObject({ word: 'cat', level: 'A1', lang: 'en' });
    // Reseed: same row accepted again but never duplicated.
    const res2 = await post(db, { rows: [rows[0]] }, cookie);
    expect(res2.status).toBe(200);
    expect(db.defs.size).toBe(1);
  });

  it('stores HSK rows under lang zh and still rejects bad levels', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const rows = [
      { word: '妈妈', level: 'HSK1', gloss: 'mother', verified: 1 },
      { word: '你好', level: 'HSK1', gloss: 'hello', verified: 0 },
      { word: '电脑', level: 'HSK9', gloss: 'bad band' },
    ];
    const res = await post(db, { rows, lang: 'zh' }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 2 });
    expect(db.defs.get('妈妈|HSK1|zh')).toMatchObject({ word: '妈妈', level: 'HSK1', lang: 'zh' });
    expect(db.defs.has('你好|HSK1|zh')).toBe(true);
    expect(db.defs.size).toBe(2);
  });

  it('rejects empty and oversized batches', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    expect((await post(db, { rows: [] }, cookie)).status).toBe(400);
    const big = Array.from({ length: 201 }, (_, i) => ({ word: `w${i}`, level: 'A1', gloss: 'g' }));
    expect((await post(db, { rows: big }, cookie)).status).toBe(400);
  });
});

describe('seed job ledger', () => {
  const postJob = (db: Db, body: unknown, cookie: string, links = 'true') =>
    app.request('/api/admin/seed-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    }, { ...ENV(db), DEV_LINKS: links });

  it('upserts heartbeats and lists jobs with parsed misses', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const env = ENV(db);
    const run = { levels: ['B2'], shard: '0/2', status: 'running', total: 3153, done: 10, missed: [], run_url: 'https://example.com/run/1' };
    const res = await app.request('/api/admin/seed-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(run),
    }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, scope: 'B2@0/2' });

    const fin = await app.request('/api/admin/seed-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ ...run, status: 'done', done: 3150, missed: ['B2|abandon', 'B2|zoo'] }),
    }, env);
    expect(fin.status).toBe(200);

    const list = await app.request('/api/admin/seed-jobs', { headers: { cookie } }, env);
    expect(list.status).toBe(200);
    const { jobs } = (await list.json()) as { jobs: Record<string, unknown>[] };
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      scope: 'B2@0/2', levels: 'B2', shard: '0/2', status: 'done', total: 3153, done: 3150,
      missed: ['B2|abandon', 'B2|zoo'], run_url: 'https://example.com/run/1',
    });
    expect(jobs[0]).not.toHaveProperty('missed_json');
  });

  it('rejects bad levels and normalizes bad shards', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const env = ENV(db);
    expect((await postJob(db, { levels: ['XX'] }, cookie)).status).toBe(400);
    expect((await postJob(db, { levels: [] }, cookie)).status).toBe(400);
    const res = await postJob(db, { levels: ['C1'], shard: 'nope' }, cookie);
    expect(res.status).toBe(200);
    const list = (await (await app.request('/api/admin/seed-jobs', { headers: { cookie } }, env)).json()) as {
      jobs: { shard: string }[];
    };
    expect(list.jobs[0].shard).toBe('');
  });

  it('is dev-only like the definitions route', async () => {
    const db = makeDb({});
    const cookie = await signIn(db);
    const env = { ...ENV(db), DEV_LINKS: 'false' };
    expect((await app.request('/api/admin/seed-jobs', { headers: { cookie } }, env)).status).toBe(404);
    expect(
      (await app.request('/api/admin/seed-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: '{}',
      }, env)).status,
    ).toBe(404);
    expect((await app.request('/api/admin/done-words?levels=B2', { headers: { cookie } }, env)).status).toBe(404);
  });

  it('reports defined words for resume', async () => {
    const db = makeDb({});
    db.defs.set('cat|B1|en', { word: 'cat', level: 'B1', lang: 'en' });
    db.defs.set('dog|B2|en', { word: 'dog', level: 'B2', lang: 'en' });
    const cookie = await signIn(db);
    const env = ENV(db);
    const res = await app.request('/api/admin/done-words?levels=B1,B2', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: ['B1|cat', 'B2|dog'] });
    expect((await app.request('/api/admin/done-words?levels=XX', { headers: { cookie } }, env)).status).toBe(400);
    expect((await app.request('/api/admin/done-words', { headers: { cookie } }, env)).status).toBe(400);
  });
});
