import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// Minimal stub: real session flow (request-link + verify), COUNT(*)
// answers for the stats tables, and exam_attempts rows for item stats.
// Specs needs no DB at all.
function makeDb(counts: Record<string, number>, examRows: string[] = []) {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const all = async () => {
        if (q.startsWith('SELECT answers_json FROM exam_attempts')) {
          return { results: examRows.map((answers_json) => ({ answers_json })) };
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
                return { n: counts[table] ?? 0 };
              }
              return null;
            };
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT INTO users')) {
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
          all: () => all(),
        }),
        first: () => first([]),
        all: () => all(),
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true', MODEL_API_KEY: 'test-key' });

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
      dailyAiLimit: 50,
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
