import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// In-memory subset for the costs ledger: real aggregation over seeded
// ai_usage rows so AVG/MAX latency math is proven, not assumed.
type Usage = {
  project_id: string; user_id: string; op_id: string; attempt: number; task: string;
  provider: string; model: string; input_tokens: number; output_tokens: number;
  cost_usd: number; ms: number; ok: number; error: string | null; created_at: string;
};

function makeDb() {
  // Suite exercises creator flows; signup defaults live in roles.test.ts.
  const users = new Map<string, { id: string; email: string; role: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, { id: string; creator_id: string; level: string }>();
  const usage: Usage[] = [];
  return {
    usage,
    seedProject(id: string, creator_id: string, level = 'A1') {
      projects.set(id, { id, creator_id, level });
    },
    setRole(userId: string, role: string) {
      const u = [...users.values()].find((x) => x.id === userId);
      if (u) u.role = role;
    },
    seedUsage(row: Omit<Usage, 'created_at'> & { created_at?: string }) {
      usage.push({ created_at: new Date().toISOString(), ...row });
    },
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const query = (...params: unknown[]) => {
          const projectId = params[0] as string;
          const rows = usage.filter((u) => u.project_id === projectId);
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
                return u ? { id: u.id, email: u.email, role: u.role, expires_at: s.expires_at } : null;
              }
              if (q.startsWith('SELECT * FROM projects WHERE id = ?')) {
                const r = projects.get(params[0] as string);
                return r && (r.creator_id === params[1] || params[1] === undefined) ? r : null;
              }
              if (q.startsWith('SELECT SUM(cost_usd) AS total')) {
                const firstTry = rows.filter((u) => u.attempt === 1);
                const retry = rows.filter((u) => u.attempt > 1);
                const sum = (rs: Usage[]) => rs.reduce((a, u) => a + u.cost_usd, 0);
                return { total: sum(rows), first_try_cost: sum(firstTry), retry_overhead: sum(retry) };
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT user_id, strftime')) {
                const by = new Map<string, Usage[]>();
                for (const u of usage) {
                  const k = `${u.user_id}|${u.created_at.slice(0, 7)}`;
                  by.set(k, [...(by.get(k) ?? []), u]);
                }
                return {
                  results: [...by.entries()].map(([k, rs]) => {
                    const [user_id, month] = k.split('|');
                    return { user_id, month, cost: rs.reduce((a, u) => a + u.cost_usd, 0) };
                  }),
                };
              }
              if (q.startsWith('SELECT p.level')) {
                const daily = q.includes('%Y-%m-%d');
                const len = daily ? 10 : 7;
                const by = new Map<string, Usage[]>();
                for (const u of usage) {
                  if (!u.project_id) continue;
                  const level = projects.get(u.project_id)?.level;
                  if (!level) continue;
                  const k = `${level}|${u.created_at.slice(0, len)}`;
                  by.set(k, [...(by.get(k) ?? []), u]);
                }
                return {
                  results: [...by.entries()].map(([k, rs]) => {
                    const [level, period] = k.split('|');
                    const cost = rs.reduce((a, u) => a + u.cost_usd, 0);
                    return daily ? { level, day: period, cost } : { level, month: period, cost };
                  }),
                };
              }
              if (q.startsWith('SELECT task, SUM(cost_usd)')) {
                const by = new Map<string, Usage[]>();
                for (const u of rows) by.set(u.task, [...(by.get(u.task) ?? []), u]);
                return {
                  results: [...by.entries()].map(([task, rs]) => ({
                    task,
                    cost: rs.reduce((a, u) => a + u.cost_usd, 0),
                    calls: rs.length,
                    tokens_in: rs.reduce((a, u) => a + u.input_tokens, 0),
                    tokens_out: rs.reduce((a, u) => a + u.output_tokens, 0),
                    avg_ms: rs.reduce((a, u) => a + u.ms, 0) / rs.length,
                    max_ms: Math.max(...rs.map((u) => u.ms)),
                  })),
                };
              }
              if (q.startsWith('SELECT model, SUM(cost_usd)')) {
                const by = new Map<string, Usage[]>();
                for (const u of rows) by.set(u.model, [...(by.get(u.model) ?? []), u]);
                return {
                  results: [...by.entries()].map(([model, rs]) => ({
                    model,
                    cost: rs.reduce((a, u) => a + u.cost_usd, 0),
                    calls: rs.length,
                    tokens_in: rs.reduce((a, u) => a + u.input_tokens, 0),
                    tokens_out: rs.reduce((a, u) => a + u.output_tokens, 0),
                    avg_ms: rs.reduce((a, u) => a + u.ms, 0) / rs.length,
                    max_ms: Math.max(...rs.map((u) => u.ms)),
                  })),
                };
              }
              if (q.startsWith('SELECT model, task, COUNT(*) AS retries')) {
                return { results: [] };
              }
              if (q.startsWith('SELECT op_id, attempt, task')) {
                return {
                  results: rows.map((u) => ({
                    op_id: u.op_id, attempt: u.attempt, task: u.task, provider: u.provider,
                    model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens,
                    cost_usd: u.cost_usd, ms: u.ms, ok: u.ok, error: u.error, created_at: u.created_at,
                  })),
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO users')) {
                const [id, email] = params as [string, string, ...unknown[]];
                users.set(id, { id, email, role: 'creator' });
              } else if (q.startsWith('INSERT INTO sessions')) {
                const [h, uid, exp] = params as [string, string, number];
                sessions.set(h, { user_id: uid, expires_at: exp });
              } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
                for (const [k, v] of sessions) {
                  if (v.user_id === params[0] && v.expires_at < (params[1] as number)) sessions.delete(k);
                }
              } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
                sessions.delete(params[0] as string);
              }
              return { success: true };
            },
          };
      };
      return {
        bind: (...params: unknown[]) => query(...params),
        first: () => query().first(),
        all: () => query().all(),
        run: () => query().run(),
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true', MODEL_API_KEY: 'test-key' });

async function signIn(db: Db): Promise<{ cookie: string; userId: string }> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'c@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  const cookie = (v.headers.get('set-cookie') ?? '').split(';')[0];
  const me = (await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json()) as { user: { id: string } };
  return { cookie, userId: me.user.id };
}

function row(db: Db, uid: string, pid: string, task: string, ms: number, cost: number, model = 'muse-spark-1.3') {
  db.seedUsage({
    project_id: pid, user_id: uid, op_id: `${task}-${ms}`, attempt: 1, task,
    provider: 'meta-model-api', model, input_tokens: 10, output_tokens: 5,
    cost_usd: cost, ms, ok: 1, error: null,
  });
}

describe('GET /api/admin/costs/book', () => {
  it('requires a session and a project you own', async () => {
    const db = makeDb();
    expect((await app.request('/api/admin/costs/book?projectId=x')).status).toBe(401);
    const { cookie } = await signIn(db);
    expect((await app.request('/api/admin/costs/book?projectId=nope', { headers: { cookie } }, ENV(db))).status).toBe(404);
    expect((await app.request('/api/admin/costs/book', { headers: { cookie } }, ENV(db))).status).toBe(400);
  });

  it('reports avg and slowest latency per task and model, plus per-attempt ms', async () => {
    const db = makeDb();
    const { cookie, userId } = await signIn(db);
    const pid = 'book-1';
    db.seedProject(pid, userId);
    row(db, userId, pid, 'art', 100, 0.01, 'muse-image-1.0');
    row(db, userId, pid, 'art', 300, 0.01, 'muse-image-1.0');
    row(db, userId, pid, 'meanings', 2000, 0.0);
    const res = await app.request(`/api/admin/costs/book?projectId=${pid}`, { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { total: number };
      by_task: { task: string; calls: number; avg_ms: number; max_ms: number }[];
      by_model: { model: string; calls: number; avg_ms: number; max_ms: number }[];
      attempts: { task: string; ms: number }[];
    };
    expect(body.totals.total).toBeCloseTo(0.02);
    const art = body.by_task.find((t) => t.task === 'art');
    expect(art).toMatchObject({ calls: 2, avg_ms: 200, max_ms: 300 });
    const meanings = body.by_task.find((t) => t.task === 'meanings');
    expect(meanings).toMatchObject({ calls: 1, avg_ms: 2000, max_ms: 2000 });
    const img = body.by_model.find((m) => m.model === 'muse-image-1.0');
    expect(img).toMatchObject({ calls: 2, avg_ms: 200, max_ms: 300 });
    expect(body.attempts).toHaveLength(3);
    expect(body.attempts.map((a) => a.ms).sort((a, b) => a - b)).toEqual([100, 300, 2000]);
  });

  it('isolates projects: other books never leak in', async () => {
    const db = makeDb();
    const { cookie, userId } = await signIn(db);
    db.seedProject('mine', userId);
    db.seedProject('theirs', 'someone-else');
    row(db, userId, 'mine', 'art', 100, 0.01);
    row(db, 'someone-else', 'theirs', 'art', 9999, 9.99);
    const res = await app.request('/api/admin/costs/book?projectId=mine', { headers: { cookie } }, ENV(db));
    const body = (await res.json()) as { totals: { total: number }; attempts: unknown[] };
    expect(body.totals.total).toBeCloseTo(0.01);
    expect(body.attempts).toHaveLength(1);
  });
});

describe('GET /api/admin/costs/overview', () => {
  it('is admin-only and reports book spend by level and day', async () => {
    const db = makeDb();
    const { cookie, userId } = await signIn(db);
    expect((await app.request('/api/admin/costs/overview', { headers: { cookie } }, ENV(db))).status).toBe(403);
    db.setRole(userId, 'admin');
    db.seedProject('a1-book', userId, 'A1');
    db.seedProject('b2-book', userId, 'B2');
    const seed = (project_id: string, cost: number, created_at: string) =>
      db.seedUsage({
        project_id, user_id: userId, op_id: `${project_id}-${created_at}`, attempt: 1, task: 'draft',
        provider: 'meta-model-api', model: 'muse-spark-1.3', input_tokens: 1, output_tokens: 1,
        cost_usd: cost, ms: 10, ok: 1, error: null, created_at,
      });
    seed('a1-book', 0.01, '2026-11-03T10:00:00.000Z');
    seed('a1-book', 0.02, '2026-11-04T10:00:00.000Z');
    seed('b2-book', 0.05, '2026-11-04T11:00:00.000Z');
    // Project-less dictionary lookups stay out of the book series.
    seed('', 9.99, '2026-11-04T12:00:00.000Z');
    const res = await app.request('/api/admin/costs/overview', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      by_user_month: { user_id: string; month: string; cost: number }[];
      by_level_month: { level: string; month: string; cost: number }[];
      by_level_day: { level: string; day: string; cost: number }[];
    };
    expect(body.by_level_day).toHaveLength(3);
    const a1 = body.by_level_day.filter((r) => r.level === 'A1').sort((a, b) => (a.day < b.day ? -1 : 1));
    expect(a1).toMatchObject([
      { day: '2026-11-03', cost: 0.01 },
      { day: '2026-11-04', cost: 0.02 },
    ]);
    expect(body.by_level_day.find((r) => r.level === 'B2')).toMatchObject({ day: '2026-11-04', cost: 0.05 });
    expect(body.by_level_month).toHaveLength(2);
  });
});
