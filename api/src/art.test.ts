import { afterEach, describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import app from './index';

// In-memory D1 subset for the art routes (projects/scenes seeded directly,
// panels + jobs + ai_usage tracked). Model calls are stubbed at fetch.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, Record<string, unknown>>();
  const scenes = new Map<string, Record<string, unknown>>();
  const panels: Record<string, unknown>[] = [];
  const usage: Record<string, unknown>[] = [];
  const jobs = new Map<string, Record<string, unknown>>();

  const db = {
    usage,
    jobs,
    panels,
    seedProject(row: Record<string, unknown>) {
      projects.set(row.id as string, row);
    },
    seedScene(projectId: string, sceneNumber: number, data: unknown) {
      const id = crypto.randomUUID();
      scenes.set(id, { id, project_id: projectId, scene_number: sceneNumber, data_json: JSON.stringify(data), updated_at: new Date().toISOString() });
    },
    seedUsage(userId: string, n: number) {
      const day = new Date().toISOString();
      for (let i = 0; i < n; i++) {
        usage.push({ user_id: userId, task: 'art', created_at: day, attempt: 1, ok: 1 });
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
              if (q.startsWith('SELECT * FROM scenes WHERE project_id = ? AND scene_number = ?')) {
                return (
                  [...scenes.values()].find(
                    (x) => x.project_id === params[0] && x.scene_number === params[1],
                  ) ?? null
                );
              }
              return null;
            },
            all: async () => ({ results: [] }),
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
              } else if (q.startsWith('DELETE FROM panels WHERE project_id')) {
                for (let i = panels.length - 1; i >= 0; i--) {
                  if (panels[i].project_id === params[0] && panels[i].scene_number === params[1]) {
                    panels.splice(i, 1);
                  }
                }
              } else if (q.startsWith('INSERT INTO panels')) {
                const [id, project_id, scene_number, image_key, mask_key, created_at] = params as unknown[];
                panels.push({ id, project_id, scene_number, image_key, mask_key, created_at });
              } else if (q.startsWith('INSERT INTO ai_usage')) {
                const [project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at] =
                  params as unknown[];
                usage.push({ project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at });
              } else if (q.startsWith('INSERT INTO jobs')) {
                const [id, user_id, project_id, payload, status, created_at, updated_at] = params as string[];
                jobs.set(id, { id, user_id, project_id, kind: 'scene', payload, status, created_at, updated_at });
              } else if (q.startsWith('UPDATE projects SET cast_json')) {
                const [cast_json, pid2] = params as [string, string];
                const row = projects.get(pid2);
                if (row) row.cast_json = cast_json;
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

function makeBucket() {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { bytes: value, contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream' });
    },
    async get(key: string) {
      const row = store.get(key);
      if (!row) return null;
      // Mirrors R2ObjectBody: the route reads via arrayBuffer(), not .body.
      return {
        body: new Blob([row.bytes]),
        httpMetadata: { contentType: row.contentType },
        arrayBuffer: async () => row.bytes,
      };
    },
  };
}

const ENV = (db: Db, opts?: { key?: boolean; bucket?: boolean }) => {
  const withKey = opts?.key ?? true;
  const withBucket = opts?.bucket ?? true;
  return {
    DB: db as unknown as D1Database,
    DEV_LINKS: 'true',
    AI_API_URL: 'https://model.test/v1',
    ...(withKey ? { MODEL_API_KEY: 'test-key' } : {}),
    ...(withBucket ? { ART: makeBucket() as unknown as R2Bucket } : {}),
  };
};

type Env = ReturnType<typeof ENV>;

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

const realFetch = globalThis.fetch;
const b64 = (s: string) => btoa(s);

function stubFetch(handler: (body: unknown) => unknown) {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse((init?.body ?? '{}') as string) as unknown;
    const payload = handler(body);
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function artReply(body: unknown): unknown {
  const b = body as { prompt?: unknown; input?: { prompts?: unknown } };
  if (typeof b.prompt === 'string') {
    if (!b.prompt.includes('[STYLE GUIDE]')) throw new Error('art prompt missing style guide');
    if (!b.prompt.includes('Noy walks to the rice field.')) throw new Error('art prompt missing scene');
    return { data: [{ b64_json: b64('PNGDATA') }], usage: { prompt_tokens: 5, completion_tokens: 0 } };
  }
  if (b.input && Array.isArray(b.input.prompts)) {
    return { mask_b64: b64('MASKDATA'), usage: { prompt_tokens: 5, completion_tokens: 0 } };
  }
  throw new Error('unexpected model call');
}

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function seedBook(db: Db, creatorId: string) {
  const pid = crypto.randomUUID();
  db.seedProject({
    id: pid,
    creator_id: creatorId,
    title: 'T',
    description: '',
    level: 'A1',
    purpose: 'learning',
    status: 'draft',
    cast_json: JSON.stringify({
      characters: [{ name: 'Noy', description: '8-year-old with short black hair' }],
      places: [{ name: 'field', description: 'a rice field' }],
    }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.seedScene(pid, 1, {
    narration: 'Noy walks to the rice field.',
    bubbles: [{ speaker: 'Noy', text: "Let's go!" }],
  });
  return pid;
}

async function userIdOf(cookie: string, env: Env): Promise<string> {
  const me = (await (
    await app.request('/api/auth/me', { headers: { cookie } }, env)
  ).json()) as { user: { id: string } };
  return me.user.id;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Scene art endpoints', () => {
  it('draws a panel, isolates the character, stores both, completes the job', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubFetch(artReply);

    const res = await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }, cookie), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { id: string; status: string };
      panels: { scene_number: number; image_url: string; mask_url: string }[];
    };
    expect(body.job.status).toBe('complete');
    expect(body.panels).toEqual([
      { scene_number: 1, image_url: `/api/ai/art/${pid}-1.png`, mask_url: `/api/ai/art/${pid}-1-mask.png` },
    ]);

    const bucket = env.ART as unknown as { store: Map<string, { bytes: ArrayBuffer }> };
    expect(bucket.store.has(`${pid}-1.png`)).toBe(true);
    expect(bucket.store.has(`${pid}-1-mask.png`)).toBe(true);
    expect(db.panels).toHaveLength(1);

    const job = db.jobs.get(body.job.id);
    expect(job?.status).toBe('complete');

    const tasks = db.usage.map((u) => ({ task: u.task, kind: u.kind, ok: u.ok }));
    expect(tasks).toContainEqual({ task: 'art', kind: 'image', ok: 1 });
    expect(tasks).toContainEqual({ task: 'isolate', kind: 'segment', ok: 1 });
    const opIds = new Set(db.usage.map((u) => u.op_id));
    expect(opIds.size).toBe(2);

    const img = await app.request(body.panels[0].image_url, { headers: { cookie } }, env);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(await img.text()).toBe('PNGDATA');
    const mask = await app.request(body.panels[0].mask_url, { headers: { cookie } }, env);
    expect(mask.status).toBe(200);
    expect(await mask.text()).toBe('MASKDATA');
  });

  it('rejects bad input, anon users, missing key, missing bucket, spent quota', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(artReply);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);

    const bad = { projectId: pid, sceneNumber: 0 };
    expect((await app.request('/api/ai/art', json('POST', bad, cookie), env)).status).toBe(400);
    expect((await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }), env)).status).toBe(
      401,
    );
    expect(
      (await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }, cookie), ENV(db, { key: false }))).status,
    ).toBe(503);
    expect(
      (await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }, cookie), ENV(db, { bucket: false }))).status,
    ).toBe(503);
    expect(
      (await app.request('/api/ai/art', json('POST', { projectId: 'missing', sceneNumber: 1 }, cookie), env)).status,
    ).toBe(404);
    db.seedUsage(uid, 50);
    expect(
      (await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }, cookie), env)).status,
    ).toBe(429);
  });

  it('serving returns 404 for unknown and malformed keys', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const missing = `/api/ai/art/${crypto.randomUUID()}-9.png`;
    expect((await app.request(missing, { headers: { cookie } }, env)).status).toBe(404);
    expect((await app.request('/api/ai/art/nope.png', { headers: { cookie } }, env)).status).toBe(404);
  });

  it('draws a cast portrait, stores it, and persists image_url into cast_json', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubFetch((body) => {
      const b = body as { prompt?: unknown };
      if (typeof b.prompt === 'string' && b.prompt.includes('[STYLE GUIDE]')) {
        if (!b.prompt.includes('Noy')) throw new Error('portrait prompt missing name');
        if (!b.prompt.includes('short black hair')) throw new Error('portrait prompt missing look');
        return { data: [{ b64_json: b64('PORTRAIT') }], usage: { prompt_tokens: 5, completion_tokens: 0 } };
      }
      return artReply(body);
    });

    const res = await app.request(
      '/api/ai/art/portrait',
      json('POST', { projectId: pid, kind: 'characters', index: 0 }, cookie),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { image_url: string; cast: { characters: { name: string; image_url?: string }[] } };
    const key = `${pid}-cast-characters-0.png`;
    expect(body.image_url).toBe(`/api/ai/art/${key}`);
    expect(body.cast.characters[0].image_url).toBe(`/api/ai/art/${key}`);

    const bucket = env.ART as unknown as { store: Map<string, { bytes: ArrayBuffer }> };
    expect(bucket.store.has(key)).toBe(true);

    const tasks = db.usage.map((u) => ({ task: u.task, kind: u.kind, ok: u.ok }));
    expect(tasks).toContainEqual({ task: 'portrait', kind: 'image', ok: 1 });

    const img = await app.request(body.image_url, { headers: { cookie } }, env);
    expect(img.status).toBe(200);
    expect(await img.text()).toBe('PORTRAIT');
  });

  it('portrait rejects bad kind/index, anon users, missing key/bucket, strangers, spent quota', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    stubFetch(artReply);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    const good = { projectId: pid, kind: 'characters', index: 0 };

    expect((await app.request('/api/ai/art/portrait', json('POST', { ...good, kind: 'pets' }, cookie), env)).status).toBe(400);
    expect((await app.request('/api/ai/art/portrait', json('POST', { ...good, index: 5 }, cookie), env)).status).toBe(400);
    expect((await app.request('/api/ai/art/portrait', json('POST', { ...good, index: -1 }, cookie), env)).status).toBe(400);
    expect((await app.request('/api/ai/art/portrait', json('POST', good), env)).status).toBe(401);
    expect(
      (await app.request('/api/ai/art/portrait', json('POST', good, cookie), ENV(db, { key: false }))).status,
    ).toBe(503);
    expect(
      (await app.request('/api/ai/art/portrait', json('POST', good, cookie), ENV(db, { bucket: false }))).status,
    ).toBe(503);
    expect(
      (await app.request('/api/ai/art/portrait', json('POST', { ...good, projectId: 'missing' }, cookie), env)).status,
    ).toBe(404);
    db.seedUsage(uid, 50);
    expect((await app.request('/api/ai/art/portrait', json('POST', good, cookie), env)).status).toBe(429);
  });

  it('portrait draws places too and keeps other cast entries untouched', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubFetch((body) => {
      const b = body as { prompt?: unknown };
      if (typeof b.prompt === 'string' && b.prompt.includes('[STYLE GUIDE]')) {
        if (!b.prompt.includes('no people')) throw new Error('place portrait should exclude people');
        return { data: [{ b64_json: b64('PLACE') }], usage: { prompt_tokens: 5, completion_tokens: 0 } };
      }
      return artReply(body);
    });

    const res = await app.request(
      '/api/ai/art/portrait',
      json('POST', { projectId: pid, kind: 'places', index: 0 }, cookie),
      env,
    );
    expect(res.status).toBe(200);
    const cast = ((await res.json()) as { cast: { characters: { image_url?: string }[]; places: { name: string; image_url?: string }[] } }).cast;
    expect(cast.places[0].image_url).toBe(`/api/ai/art/${pid}-cast-places-0.png`);
    expect(cast.characters[0].image_url).toBeUndefined();
  });

  it('failed isolate marks the job failed with 502', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubFetch((body) => {
      const b = body as { input?: { prompts?: unknown } };
      if (b.input && Array.isArray(b.input.prompts)) {
        return new Response('bad', { status: 500 });
      }
      return artReply(body);
    });

    const res = await app.request('/api/ai/art', json('POST', { projectId: pid, sceneNumber: 1 }, cookie), env);
    expect(res.status).toBe(502);
    expect(db.panels).toHaveLength(0);
    const failed = [...db.jobs.values()].find((j) => j.status === 'failed');
    expect(failed?.error).toBe('ai failed');
    const isolateRows = db.usage.filter((u) => u.task === 'isolate');
    expect(isolateRows).toHaveLength(2);
    expect(isolateRows.every((u) => u.ok === 0)).toBe(true);
  });
});
