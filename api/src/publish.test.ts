import { afterEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// In-memory D1 subset for the publish route (projects/scenes/panels seeded
// directly, books + jobs + ai_usage tracked). Model calls stubbed at fetch.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, Record<string, unknown>>();
  const scenes = new Map<string, Record<string, unknown>>();
  const panels: Record<string, unknown>[] = [];
  const books = new Map<string, Record<string, unknown>>();
  const usage: Record<string, unknown>[] = [];
  const jobs = new Map<string, Record<string, unknown>>();

  const db = {
    usage,
    jobs,
    books,
    projects,
    seedProject(row: Record<string, unknown>) {
      projects.set(row.id as string, row);
    },
    seedScene(projectId: string, sceneNumber: number, data: unknown) {
      const id = crypto.randomUUID();
      scenes.set(id, { id, project_id: projectId, scene_number: sceneNumber, data_json: JSON.stringify(data), updated_at: new Date().toISOString() });
    },
    seedPanel(projectId: string, sceneNumber: number, imageKey: string, maskKey: string) {
      panels.push({ id: crypto.randomUUID(), project_id: projectId, scene_number: sceneNumber, image_key: imageKey, mask_key: maskKey, created_at: new Date().toISOString() });
    },
    seedUsage(userId: string, n: number) {
      const day = new Date().toISOString();
      for (let i = 0; i < n; i++) {
        usage.push({ user_id: userId, task: 'safety', created_at: day, attempt: 1, ok: 1 });
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
              if (q.startsWith('SELECT id, published_at FROM books WHERE project_id')) {
                const r = [...books.values()].find((x) => x.project_id === params[0]);
                return r ? { id: r.id, published_at: r.published_at } : null;
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
              if (q.startsWith('SELECT scene_number, image_key, mask_key FROM panels WHERE project_id')) {
                return { results: panels.filter((x) => x.project_id === params[0]) };
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
              } else if (q.startsWith('INSERT INTO ai_usage')) {
                const [project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at] =
                  params as unknown[];
                usage.push({ project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at });
              } else if (q.startsWith('INSERT INTO jobs')) {
                const [id, user_id, project_id, payload, created_at, updated_at] = params as string[];
                jobs.set(id, { id, user_id, project_id, kind: 'package', payload, status: 'running', created_at, updated_at });
              } else if (q.startsWith('UPDATE jobs SET')) {
                const [status, result, error, updated_at, id] = params as [string, string | null, string | null, string, string];
                const row = jobs.get(id);
                if (row) Object.assign(row, { status, result, error, updated_at });
              } else if (q.startsWith('INSERT INTO books')) {
                const [id, project_id, creator_id, title, description, level, reading_level, cover_url, manifest_json, published_at, updated_at] =
                  params as unknown[];
                books.set(id as string, { id, project_id, creator_id, title, description, level, reading_level, cover_url, manifest_json, published_at, updated_at });
              } else if (q.startsWith('UPDATE books SET')) {
                const [title, description, level, reading_level, cover_url, manifest_json, updated_at, id] = params as unknown[];
                const row = books.get(id as string);
                if (row) Object.assign(row, { title, description, level, reading_level, cover_url, manifest_json, updated_at });
              } else if (q.startsWith("UPDATE projects SET status = 'published'")) {
                const [updated_at, id] = params as [string, string];
                const row = projects.get(id);
                if (row) Object.assign(row, { status: 'published', updated_at });
              } else if (q.startsWith('UPDATE projects SET title')) {
                const [title, description, level, purpose, cast_json, updated_at, id] = params as string[];
                const row = projects.get(id);
                if (row) Object.assign(row, { title, description, level, purpose, cast_json, updated_at });
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

type Env = ReturnType<typeof ENV>;

async function signIn(db: Db): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'p@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

const realFetch = globalThis.fetch;

function stubSafety(verdict: string) {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: verdict } }],
        usage: { prompt_tokens: 50, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
}

async function userIdOf(cookie: string, env: Env): Promise<string> {
  const me = (await (
    await app.request('/api/auth/me', { headers: { cookie } }, env)
  ).json()) as { user: { id: string } };
  return me.user.id;
}

function seedBook(db: Db, creatorId: string, level = 'A1') {
  const pid = crypto.randomUUID();
  db.seedProject({
    id: pid,
    creator_id: creatorId,
    title: 'T',
    description: 'A test comic',
    level,
    purpose: 'learning',
    status: 'draft',
    cast_json: '{"characters":[],"places":[]}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.seedScene(pid, 1, { narration: 'Noy walks to the rice field.', bubbles: [{ speaker: 'Noy', text: "Let's go!" }] });
  db.seedScene(pid, 2, { narration: 'A red bird sings.', bubbles: [] });
  return pid;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: body === null ? undefined : JSON.stringify(body),
});

interface BookBody {
  job: { id: string; status: string };
  book: {
    id: string;
    project_id: string;
    reading_level: string;
    cover_url: string | null;
    manifest_json: string;
    published_at: string;
    manifest: {
      version: number;
      title: string;
      level: string;
      reading_level: string;
      cover: string | null;
      scenes: { scene_number: number; image_url: string | null; mask_url: string | null }[];
    };
  };
}

describe('Publish endpoint', () => {
  it('screens safe, packages manifest v2, creates the book with cover', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    db.seedPanel(pid, 1, `${pid}-1.png`, `${pid}-1-mask.png`);
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookBody;
    expect(body.job.status).toBe('complete');
    expect(body.book.project_id).toBe(pid);
    expect(body.book.reading_level).toBe('beginner');
    expect(body.book.cover_url).toBe(`/api/ai/art/${pid}-1.png`);
    expect(body.book.manifest.version).toBe(2);
    expect(body.book.manifest.title).toBe('T');
    expect(body.book.manifest.scenes).toHaveLength(2);
    expect(body.book.manifest.scenes[0].image_url).toBe(`/api/ai/art/${pid}-1.png`);
    expect(body.book.manifest.scenes[0].mask_url).toBe(`/api/ai/art/${pid}-1-mask.png`);
    expect(body.book.manifest.scenes[1].image_url).toBeNull();
    expect(JSON.parse(body.book.manifest_json) as { version: number }).toEqual(body.book.manifest);

    expect(db.books.size).toBe(1);
    const proj = (await (
      await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)
    ).json()) as { project: { status: string } };
    expect(proj.project.status).toBe('published');

    const job = db.jobs.get(body.job.id);
    expect(job?.status).toBe('complete');
    const safety = db.usage.filter((u) => u.task === 'safety');
    expect(safety).toHaveLength(1);
    expect(safety[0].ok).toBe(1);
    expect(safety[0].model).toBe('muse-spark-1.3');
  });

  it('unsafe content blocks publish with 422 and no book', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubSafety('unsafe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unsafe content' });
    expect(db.books.size).toBe(0);
    const failed = [...db.jobs.values()].find((j) => j.status === 'failed');
    expect(failed?.error).toBe('unsafe content');
    const proj = (await (
      await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)
    ).json()) as { project: { status: string } };
    expect(proj.project.status).toBe('draft');
  });

  it('rejects foreign projects, empty drafts, missing key, spent quota, anon users', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    // A draft with no scenes at all.
    const pidEmpty = crypto.randomUUID();
    db.seedProject({
      id: pidEmpty,
      creator_id: uid,
      title: 'E',
      description: '',
      level: 'A1',
      purpose: 'learning',
      status: 'draft',
      cast_json: '{"characters":[],"places":[]}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    stubSafety('safe');

    expect((await app.request(`/api/projects/missing/publish`, json('POST', {}, cookie), env)).status).toBe(404);
    expect((await app.request(`/api/projects/${pidEmpty}/publish`, json('POST', {}, cookie), env)).status).toBe(
      400,
    );
    expect(
      (await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), ENV(db, false))).status,
    ).toBe(503);
    expect((await app.request(`/api/projects/${pid}/publish`, json('POST', {}), env)).status).toBe(401);
    db.seedUsage(uid, 50);
    expect((await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)).status).toBe(429);
  });

  it('republish updates the same book row and keeps published_at', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubSafety('safe');

    const first = (await (
      await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)
    ).json()) as BookBody;
    await app.request(
      `/api/projects/${pid}`,
      json('PATCH', { title: 'T2' }, cookie),
      env,
    );
    const second = (await (
      await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)
    ).json()) as BookBody;

    expect(second.book.id).toBe(first.book.id);
    expect(db.books.size).toBe(1);
    expect(second.book.manifest.title).toBe('T2');
    expect(second.book.published_at).toBe(first.book.published_at);
  });
});
