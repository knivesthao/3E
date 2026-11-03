import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { FORM_SIZE, PASS_MARK, QUESTIONS } from './exam';

function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const attempts: { user_id: string; score: number; total: number }[] = [];
  return {
    attempts,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT INTO users')) {
          const [id, email] = params as [string, string, ...unknown[]];
          users.set(id, { id, email });
        } else if (q.startsWith('INSERT INTO sessions')) {
          const [id_hash, user_id, expires_at] = params as [string, string, number];
          sessions.set(id_hash, { user_id, expires_at });
        } else if (q.startsWith('INSERT INTO exam_attempts')) {
          const [, user_id, score, total] = params as [string, string, number, number, string, string];
          attempts.push({ user_id, score, total });
        } else if (q.startsWith('DELETE FROM sessions')) {
          if (q.includes('id_hash')) sessions.delete(params[0] as string);
        }
        return { success: true };
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
        if (q.startsWith('SELECT COUNT(*) AS n, MAX(score) AS best FROM exam_attempts')) {
          const rows = attempts.filter((a) => a.user_id === params[0]);
          return { n: rows.length, best: rows.length ? Math.max(...rows.map((a) => a.score)) : null };
        }
        return null;
      };
      return { bind: (...params: unknown[]) => ({ first: () => first(params), run: () => run(params) }), first: () => first([]) };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true', MODEL_API_KEY: 'test-key' });

async function signIn(db: Db): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
const fullForm = QUESTIONS.map((q) => q.id);
const correctFor = (form: string[]) => form.map((id) => ({ id, choice: (byId.get(id) as { answer: number }).answer }));

describe('GET /api/exam', () => {
  it('requires a session', async () => {
    expect((await app.request('/api/exam')).status).toBe(401);
  });

  it('serves a rotating form with 3 per part and no answers', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const res = await app.request('/api/exam', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      questions: { id: string; part: number }[];
      total: number;
      passMark: number;
    };
    expect(body.total).toBe(FORM_SIZE);
    expect(body.passMark).toBe(PASS_MARK);
    expect(body.questions).toHaveLength(FORM_SIZE);
    for (let part = 1; part <= 4; part++) {
      expect(body.questions.filter((q) => q.part === part)).toHaveLength(3);
    }
    expect(JSON.stringify(body)).not.toContain('"answer"');
  });
});

describe('POST /api/exam/submit', () => {
  it('grades a perfect paper and stores the attempt', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const res = await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ form: fullForm, answers: correctFor(fullForm) }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { score: number; total: number; passed: boolean; review: { correct: boolean }[] };
    expect(body.score).toBe(QUESTIONS.length);
    expect(body.total).toBe(QUESTIONS.length);
    expect(body.passed).toBe(true);
    expect(body.review.every((r) => r.correct)).toBe(true);
    expect(db.attempts).toHaveLength(1);

    const best = (await (await app.request('/api/exam/best', { headers: { cookie } }, env)).json()) as {
      attempts: number;
      best: number;
      total: number;
    };
    expect(best).toMatchObject({ attempts: 1, best: QUESTIONS.length, total: FORM_SIZE });
  });

  it('marks served-but-unanswered questions wrong', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const form = fullForm.slice(0, 12);
    const res = await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ form, answers: correctFor(form.slice(0, 3)) }),
      },
      ENV(db),
    );
    const body = (await res.json()) as { score: number; total: number; passed: boolean; message: string };
    expect(body.score).toBe(3);
    expect(body.total).toBe(12);
    expect(body.passed).toBe(false);
    expect(body.message).toContain('Keep practicing');
  });

  it('rejects bad forms and out-of-form answers', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const bad = [
      {},
      { answers: [] },
      { form: [], answers: [] },
      { form: ['nope'], answers: [] },
      { form: ['p1a', 'p1a'], answers: [] },
      { form: ['p1a'], answers: [{ id: 'p1b', choice: 0 }] },
      { form: ['p1a'], answers: [{ id: 'p1a', choice: 0 }, { id: 'p1a', choice: 1 }] },
    ];
    for (const payload of bad) {
      const res = await app.request(
        '/api/exam/submit',
        { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(payload) },
        env,
      );
      expect(res.status).toBe(400);
    }
  });
});
