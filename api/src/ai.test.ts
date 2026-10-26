import { afterEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// In-memory D1 subset for the AI routes (extends the projects-test pattern
// with ai_usage + jobs). Model calls are stubbed at fetch, never network.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, Record<string, unknown>>();
  const scenes = new Map<string, Record<string, unknown>>();
  const usage: Record<string, unknown>[] = [];
  const jobs = new Map<string, Record<string, unknown>>();

  const db = {
    usage,
    seedUsage(userId: string, n: number) {
      const day = new Date().toISOString();
      for (let i = 0; i < n; i++) {
        usage.push({ user_id: userId, task: 'idea', created_at: day, attempt: 1, ok: 1 });
      }
    },
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
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
              if (q.startsWith('SELECT * FROM projects WHERE id = ? AND creator_id')) {
                const r = projects.get(params[0] as string);
                return r && r.creator_id === params[1] ? r : null;
              }
              if (q.startsWith('SELECT COUNT(*) AS n FROM ai_usage')) {
                const today = new Date().toISOString().slice(0, 10);
                const n = usage.filter(
                  (u) => u.user_id === params[0] && (u.created_at as string).slice(0, 10) === today,
                ).length;
                return { n };
              }
              if (q.startsWith('SELECT id FROM scenes WHERE project_id = ? AND scene_number')) {
                const r = [...scenes.values()].find((x) => x.project_id === params[0] && x.scene_number === params[1]);
                return r ? { id: r.id } : null;
              }
              if (q.startsWith('SELECT MAX(scene_number)')) {
                const nums = [...scenes.values()]
                  .filter((x) => x.project_id === params[0])
                  .map((x) => x.scene_number as number);
                return { m: nums.length ? Math.max(...nums) : null };
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT * FROM scenes WHERE project_id = ? ORDER BY')) {
                return {
                  results: [...scenes.values()]
                    .filter((x) => x.project_id === params[0])
                    .sort((a, b) => (a.scene_number as number) - (b.scene_number as number)),
                };
              }
              if (q.startsWith('SELECT id FROM scenes WHERE project_id')) {
                return { results: [...scenes.values()].filter((x) => x.project_id === params[0]).map((x) => ({ id: x.id })) };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO users')) {
                const [id, email] = params as string[];
                users.set(id, { id, email });
              } else if (q.startsWith('INSERT INTO sessions')) {
                const [h, uid, exp] = params as [string, string, number];
                sessions.set(h, { user_id: uid, expires_at: exp });
              } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
                for (const [k, v] of sessions) {
                  if (v.user_id === params[0] && v.expires_at < (params[1] as number)) sessions.delete(k);
                }
              } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
                sessions.delete(params[0] as string);
              } else if (q.startsWith('INSERT INTO projects')) {
                const [id, creator_id, title, description, level, purpose, status, cast_json, created_at, updated_at] =
                  params as string[];
                projects.set(id, { id, creator_id, title, description, level, purpose, status, cast_json, created_at, updated_at });
              } else if (q.startsWith('INSERT INTO scenes')) {
                const [id, project_id, scene_number, data_json, updated_at] = params as [string, string, number, string, string];
                scenes.set(id, { id, project_id, scene_number, data_json, updated_at });
              } else if (q.startsWith('INSERT INTO ai_usage')) {
                const [project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at] =
                  params as unknown[];
                usage.push({ project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at });
              } else if (q.startsWith('INSERT INTO jobs')) {
                const [id, user_id, project_id, kind, payload, status, created_at, updated_at] = params as string[];
                jobs.set(id, { id, user_id, project_id, kind, payload, status, created_at, updated_at });
              } else if (q.startsWith('UPDATE jobs SET')) {
                const [status, result, error, updated_at, id] = params as [string, string | null, string | null, string, string];
                const row = jobs.get(id);
                if (row) Object.assign(row, { status, result, error, updated_at });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db;
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db, withKey = true) => ({
  DB: db as unknown as D1Database,
  DEV_LINKS: 'true',
  ...(withKey ? { MODEL_API_KEY: 'test-key' } : {}),
});

async function signIn(db: Db): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'w@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

const realFetch = globalThis.fetch;

function stubFetch(handler: (prompt: string) => unknown) {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse((init?.body ?? '{}') as string) as { messages?: { content?: string }[] };
    const prompt = body.messages?.[0]?.content ?? '';
    const payload = handler(prompt);
    if (payload instanceof Response) return payload;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function draftReply(missing: number[]) {
  return {
    scenes: missing.map((n) => ({
      scene_number: n,
      narration: 'A boy sees a red bird',
      bubbles: [{ speaker: 'Boy', text: 'Look' }],
      new_words: [],
    })),
  };
}

function modelReply(prompt: string): unknown {
  if (prompt.includes('comics writer')) {
    const target = Number(/Target scene count: (\d+)/.exec(prompt)?.[1] ?? 6);
    // scenesJson is single-line: stay on the line so greedy matching never
    // swallows the trailing "New words so far: [...]" line.
    const soFar = JSON.parse(/Scenes so far: (\[[^\n]*\])/.exec(prompt)?.[1] ?? '[]') as { scene_number: number }[];
    const have = new Set(soFar.map((s) => s.scene_number));
    return draftReply(Array.from({ length: target }, (_, i) => i + 1).filter((n) => !have.has(n)));
  }
  if (prompt.includes('QA editor')) {
    return { passed: true, reason: 'ok', simplified: '', vocabulary: [] };
  }
  if (prompt.includes('rough idea')) {
    return { description: 'A comic about a boy and a bird.', level: 'A2' };
  }
  if (prompt.includes('young English learners')) {
    // The first item shares its line with a "Words: " prefix
    // ("Words: 1. field"), so accept a leading space as well as ^.
    const words = [...prompt.matchAll(/(?:^| )(\d+)\. (.+)$/gm)].map((m) => m[2]);
    return { meanings: words.map((w) => ({ word: w, meaning: `simple ${w}` })) };
  }
  if (prompt.includes('makes English easier')) {
    return { rewritten: 'A boy is happy.' };
  }
  throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
}

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function makeProject(db: Db, cookie: string): Promise<string> {
  const env = ENV(db);
  const res = await app.request('/api/projects', json('POST', { title: 'T', level: 'A1' }, cookie), env);
  return ((await res.json()) as { project: { id: string } }).project.id;
}

describe('AI endpoints', () => {
  it('idea returns description + level', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(modelReply);
    const res = await app.request('/api/ai/idea', json('POST', { idea: 'a bird' }, cookie), ENV(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ description: 'A comic about a boy and a bird.', level: 'A2' });
  });

  it('rejects bad input, anon users, missing key, and spent quota', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(modelReply);
    const env = ENV(db);
    expect((await app.request('/api/ai/idea', json('POST', { idea: '' }, cookie), env)).status).toBe(400);
    expect((await app.request('/api/ai/idea', json('POST', { idea: 'x' }), env)).status).toBe(401);
    expect((await app.request('/api/ai/idea', json('POST', { idea: 'x' }, cookie), ENV(db, false))).status).toBe(503);
    const me = (await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json()) as {
      user: { id: string };
    };
    db.seedUsage(me.user.id, 50);
    expect((await app.request('/api/ai/idea', json('POST', { idea: 'x' }, cookie), env)).status).toBe(429);
  });

  it('finish fills six leveled scenes and records the job', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(modelReply);
    const env = ENV(db);
    const pid = await makeProject(db, cookie);
    const res = await app.request('/api/ai/finish', json('POST', { projectId: pid }, cookie), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { status: string }; saved: number[]; failed: unknown[] };
    expect(body.job.status).toBe('complete');
    expect(body.saved).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.failed).toEqual([]);
    const proj = (await (await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)).json()) as {
      scenes: { data_json: string }[];
    };
    expect(proj.scenes).toHaveLength(6);
    expect(db.usage.length).toBeGreaterThan(0);
    expect(db.usage.every((u) => u.op_id !== undefined && (u.attempt as number) >= 1)).toBe(true);
  });

  it('retries once on invalid JSON then succeeds', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    let calls = 0;
    stubFetch((prompt) => {
      calls++;
      if (prompt.includes('rough idea') && calls === 1) return 'not json{{{';
      return modelReply(prompt);
    });
    const res = await app.request('/api/ai/idea', json('POST', { idea: 'a bird' }, cookie), ENV(db));
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('meanings keeps order; simplify reports the gate', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(modelReply);
    const env = ENV(db);
    const m = await app.request(
      '/api/ai/meanings', json('POST', { words: ['field', 'bird'], level: 'A1' }, cookie), env);
    expect(await m.json()).toEqual({
      meanings: [
        { word: 'field', meaning: 'simple field' },
        { word: 'bird', meaning: 'simple bird' },
      ],
    });
    const s = await app.request(
      '/api/ai/simplify', json('POST', { text: 'The boy is happy.', level: 'A1' }, cookie), env);
    const sb = (await s.json()) as { rewritten: string; check: { passed: boolean } };
    expect(sb.rewritten).toBe('A boy is happy.');
    expect(sb.check.passed).toBe(true);
  });
});
