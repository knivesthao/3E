import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { BANKS, type ExamLevel } from './exam-banks';

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0012_exam_level.sql'),
  'utf8',
);

const ANSWERS = new Map<ExamLevel, Map<string, number>>(
  (['A1', 'A2', 'B1', 'B2'] as const).map((level) => [level, new Map(BANKS[level].map((q) => [q.id, q.answer]))]),
);
const correctFor = (level: ExamLevel, form: string[]) =>
  form.map((id) => ({ id, choice: ANSWERS.get(level)?.get(id) ?? 0 }));

interface Attempt {
  id: string;
  user_id: string;
  level: string;
  score: number;
  total: number;
  answers_json: string;
  created_at: string;
}

function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const attempts: Attempt[] = [];
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
        } else if (q.startsWith('INSERT INTO user_word_misses')) {
          // Miss-loop writes are covered by misses tests, not asserted here.
        } else if (q.startsWith('INSERT INTO exam_attempts')) {
          const [id, user_id, score, total, answers_json, created_at, level] = params as [
            string, string, number, number, string, string, string,
          ];
          attempts.push({ id, user_id, level, score, total, answers_json, created_at });
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
          const rows = attempts.filter((a) => a.user_id === params[0] && a.level === params[1]);
          return { n: rows.length, best: rows.length ? Math.max(...rows.map((a) => a.score)) : null };
        }
        if (q.startsWith('SELECT id, level, score, total, answers_json, created_at FROM exam_attempts')) {
          return attempts.find((a) => a.id === params[0] && a.user_id === params[1]) ?? null;
        }
        return null;
      };
      const all = async (params: unknown[]) => {
        if (q.startsWith('SELECT id, level, score, total, created_at FROM exam_attempts')) {
          const rows = attempts
            .filter((a) => a.user_id === params[0] && (!params[1] || a.level === params[1]))
            .reverse();
          return { results: rows };
        }
        return { results: [] };
      };
      return {
        bind: (...params: unknown[]) => ({
          first: () => first(params),
          run: () => run(params),
          all: () => all(params),
        }),
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true', MODEL_API_KEY: 'test-key' });

async function signIn(db: Db, email: string): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('0012_exam_level migration', () => {
  it('adds a defaulted level column to exam_attempts', () => {
    expect(migration).toContain('ALTER TABLE exam_attempts ADD COLUMN level');
    expect(migration).toContain("DEFAULT 'A1'");
  });
});

describe('level-parameterized exam API', () => {
  it('serves per-level forms and rejects unknown levels', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'e@example.com');
    const env = ENV(db);
    for (const level of ['A1', 'A2', 'B1', 'B2']) {
      const res = await app.request(`/api/exam?level=${level}`, { headers: { cookie } }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        level: string;
        questions: { id: string; part: number }[];
        total: number;
      };
      expect(body.level).toBe(level);
      expect(body.total).toBe(12);
      expect(body.questions).toHaveLength(12);
      expect(JSON.stringify(body)).not.toContain('"answer"');
    }
    expect((await app.request('/api/exam?level=C9', { headers: { cookie } }, env)).status).toBe(400);
    const def = (await (await app.request('/api/exam', { headers: { cookie } }, env)).json()) as { level: string };
    expect(def.level).toBe('A1');
  });

  it('grades per level and tracks best separately', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'e@example.com');
    const env = ENV(db);
    const b2Form = BANKS.B2.map((q) => q.id);
    const res = await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level: 'B2', form: b2Form, answers: correctFor('B2', b2Form) }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { level: string; score: number; total: number; passed: boolean };
    expect(body).toMatchObject({ level: 'B2', score: 24, total: 24, passed: true });
    expect(db.attempts[0]?.level).toBe('B2');

    const bestB2 = (await (await app.request('/api/exam/best?level=B2', { headers: { cookie } }, env)).json()) as {
      level: string;
      attempts: number;
      best: number;
    };
    expect(bestB2).toMatchObject({ level: 'B2', attempts: 1, best: 24 });
    const bestA1 = (await (await app.request('/api/exam/best?level=A1', { headers: { cookie } }, env)).json()) as {
      attempts: number;
      best: number | null;
    };
    expect(bestA1).toMatchObject({ attempts: 0, best: null });
  });

  it('rejects cross-level ids and unknown submit levels', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'e@example.com');
    const env = ENV(db);
    const post = (payload: unknown) =>
      app.request(
        '/api/exam/submit',
        { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(payload) },
        env,
      );
    // A2 ids under the default A1 level.
    expect(
      (await post({ form: ['a2-p1a'], answers: [{ id: 'a2-p1a', choice: 0 }] })).status,
    ).toBe(400);
    // Unknown level.
    expect(
      (await post({ level: 'C9', form: ['p1a'], answers: [{ id: 'p1a', choice: 0 }] })).status,
    ).toBe(400);
  });

  it('lists history newest-first and replays each attempt for review', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'e@example.com');
    const env = ENV(db);
    const a1Form = BANKS.A1.map((q) => q.id);
    await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ form: a1Form.slice(0, 12), answers: correctFor('A1', a1Form.slice(0, 3)) }),
      },
      env,
    );
    const b2Form = BANKS.B2.map((q) => q.id);
    await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level: 'B2', form: b2Form, answers: correctFor('B2', b2Form) }),
      },
      env,
    );

    const list = (await (await app.request('/api/exam/history', { headers: { cookie } }, env)).json()) as {
      attempts: { id: string; level: string; score: number; total: number; passed: boolean; created_at: string }[];
    };
    expect(list.attempts).toHaveLength(2);
    // Newest first: the perfect B2 paper, then the partial A1 paper.
    expect(list.attempts.map((a) => a.level)).toEqual(['B2', 'A1']);
    expect(list.attempts[0]).toMatchObject({ score: 24, total: 24, passed: true });
    expect(list.attempts[1]).toMatchObject({ score: 3, total: 12, passed: false });

    const filtered = (await (await app.request('/api/exam/history?level=A1', { headers: { cookie } }, env)).json()) as {
      attempts: { level: string }[];
    };
    expect(filtered.attempts).toHaveLength(1);
    expect(filtered.attempts[0]?.level).toBe('A1');

    const detail = (await (
      await app.request(`/api/exam/history/${list.attempts[0]?.id}`, { headers: { cookie } }, env)
    ).json()) as {
      level: string;
      score: number;
      items: {
        id: string;
        part: number;
        prompt: string;
        options: string[];
        choice: number | null;
        answer: number;
        correct: boolean;
        explanation: string;
      }[];
    };
    expect(detail.level).toBe('B2');
    expect(detail.items).toHaveLength(24);
    const first = detail.items[0];
    expect(first?.prompt.length).toBeGreaterThan(0);
    expect(first?.options.length).toBeGreaterThanOrEqual(2);
    expect(first?.choice).toBe(first?.answer);
    expect(first?.correct).toBe(true);
    expect(first?.explanation.length).toBeGreaterThan(0);
  });

  it('keeps attempts private and reads pre-level rows without choices', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'mine@example.com');
    const other = await signIn(db, 'other@example.com');
    const env = ENV(db);
    const a1Form = BANKS.A1.map((q) => q.id);
    await app.request(
      '/api/exam/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ form: a1Form.slice(0, 1), answers: [] }),
      },
      env,
    );
    // Legacy row: stored before levels/choices existed.
    const owner = db.attempts[0]?.user_id as string;
    db.attempts.push({
      id: 'legacy-1',
      user_id: owner,
      level: 'A1',
      score: 1,
      total: 1,
      answers_json: JSON.stringify({
        form: ['p1a'],
        review: [{ id: 'p1a', correct: false, answer: 0, explanation: 'A cat says meow.' }],
      }),
      created_at: new Date().toISOString(),
    });

    const res = await app.request('/api/exam/history/legacy-1', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { items: { choice: number | null }[] };
    expect(detail.items[0]?.choice).toBeNull();

    // Another user cannot open it.
    expect((await app.request('/api/exam/history/legacy-1', { headers: { cookie: other } }, env)).status).toBe(404);
  });
});
