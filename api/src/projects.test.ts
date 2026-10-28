import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// Minimal in-memory D1 for route tests (subset of the API the routes use).
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, Record<string, unknown>>();
  const scenes = new Map<string, Record<string, unknown>>();

  // Mirrors the real UNIQUE(project_id, scene_number) constraint: throws
  // like D1/SQLite on collision, so sequential renumbering fails here too.
  const checkUniqueScenes = () => {
    const seen = new Set<string>();
    for (const s of scenes.values()) {
      const key = `${s.project_id}|${s.scene_number}`;
      if (seen.has(key)) throw new Error('UNIQUE constraint failed: scenes.project_id, scenes.scene_number');
      seen.add(key);
    }
  };

  const runQuery = (q: string, p: unknown[]) => {
    if (q.startsWith('INSERT INTO users')) {
      const [id, email] = p as string[];
      users.set(id, { id, email });
    } else if (q.startsWith('INSERT INTO sessions')) {
      const [h, uid, exp] = p as [string, string, number];
      sessions.set(h, { user_id: uid, expires_at: exp });
    } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
      for (const [k, v] of sessions) {
        if (v.user_id === p[0] && (v.expires_at as number) < (p[1] as number)) sessions.delete(k);
      }
    } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
      sessions.delete(p[0] as string);
    } else if (q.startsWith('INSERT INTO projects')) {
      const [id, creator_id, title, description, level, purpose, status, cast_json, created_at, updated_at] =
        p as string[];
      projects.set(id, { id, creator_id, title, description, level, purpose, status, cast_json, created_at, updated_at });
    } else if (q.startsWith('UPDATE projects SET updated_at')) {
      const row = projects.get(p[1] as string);
      if (row) row.updated_at = p[0];
    } else if (q.startsWith('UPDATE projects SET title')) {
      const [title, description, level, purpose, cast_json, updated_at, id] = p as string[];
      const row = projects.get(id);
      if (row) Object.assign(row, { title, description, level, purpose, cast_json, updated_at });
    } else if (q.startsWith('DELETE FROM projects')) {
      projects.delete(p[0] as string);
    } else if (q.startsWith('INSERT INTO scenes')) {
      const [id, project_id, scene_number, data_json, updated_at] = p as [string, string, number, string, string];
      scenes.set(id, { id, project_id, scene_number, data_json, updated_at });
    } else if (q.startsWith('UPDATE scenes SET scene_number = ?, data_json')) {
      const [n, d, u, id] = p as [number, string, string, string];
      const row = scenes.get(id);
      if (row) Object.assign(row, { scene_number: n, data_json: d, updated_at: u });
      checkUniqueScenes();
    } else if (q.startsWith('UPDATE scenes SET scene_number = -scene_number')) {
      const [u, projectId] = p as [string, string];
      for (const row of scenes.values()) {
        if (row.project_id === projectId) Object.assign(row, { scene_number: -(row.scene_number as number), updated_at: u });
      }
      checkUniqueScenes();
    } else if (q.startsWith('UPDATE scenes SET scene_number')) {
      const [n, u, id] = p as [number, string, string];
      const row = scenes.get(id);
      if (row) Object.assign(row, { scene_number: n, updated_at: u });
      checkUniqueScenes();
    } else if (q.startsWith('DELETE FROM scenes WHERE project_id')) {
      for (const [k, v] of scenes) if (v.project_id === p[0]) scenes.delete(k);
    } else if (q.startsWith('DELETE FROM scenes WHERE id')) {
      scenes.delete(p[0] as string);
    }
    return { success: true };
  };

  const firstQuery = (q: string, p: unknown[]) => {
    if (q.startsWith('SELECT id FROM users WHERE email')) {
      const u = [...users.values()].find((x) => x.email === p[0]);
      return u ? { id: u.id } : null;
    }
    if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
      return sessions.get(p[0] as string) ?? null;
    }
    if (q.startsWith('SELECT users.id, users.email')) {
      const s = sessions.get(p[0] as string);
      if (!s) return null;
      const u = users.get(s.user_id);
      return u ? { id: u.id, email: u.email, expires_at: s.expires_at } : null;
    }
    if (q.startsWith('SELECT * FROM projects WHERE id = ? AND creator_id')) {
      const r = projects.get(p[0] as string);
      return r && r.creator_id === p[1] ? r : null;
    }
    if (q.startsWith('SELECT id FROM scenes WHERE project_id = ? AND scene_number = ? AND id != ?')) {
      const r = [...scenes.values()].find(
        (x) => x.project_id === p[0] && x.scene_number === p[1] && x.id !== p[2],
      );
      return r ? { id: r.id } : null;
    }
    if (q.startsWith('SELECT id FROM scenes WHERE project_id = ? AND scene_number')) {
      const r = [...scenes.values()].find((x) => x.project_id === p[0] && x.scene_number === p[1]);
      return r ? { id: r.id } : null;
    }
    if (q.startsWith('SELECT * FROM scenes WHERE id = ? AND project_id')) {
      const r = scenes.get(p[0] as string);
      return r && r.project_id === p[1] ? r : null;
    }
    if (q.startsWith('SELECT id FROM scenes WHERE id = ? AND project_id')) {
      const r = scenes.get(p[0] as string);
      return r && r.project_id === p[1] ? { id: r.id } : null;
    }
    if (q.startsWith('SELECT MAX(scene_number)')) {
      const nums = [...scenes.values()].filter((x) => x.project_id === p[0]).map((x) => x.scene_number as number);
      return { m: nums.length ? Math.max(...nums) : null };
    }
    return null;
  };

  const allQuery = (q: string, p: unknown[]) => {
    if (q.startsWith('SELECT id, title, level, purpose, status, updated_at FROM projects')) {
      return [...projects.values()]
        .filter((x) => x.creator_id === p[0])
        .map(({ id, title, level, purpose, status, updated_at }) => ({ id, title, level, purpose, status, updated_at }));
    }
    if (q.startsWith('SELECT * FROM scenes WHERE project_id = ? ORDER BY')) {
      return [...scenes.values()]
        .filter((x) => x.project_id === p[0])
        .sort((a, b) => (a.scene_number as number) - (b.scene_number as number));
    }
    if (q.startsWith('SELECT id FROM scenes WHERE project_id')) {
      return [...scenes.values()].filter((x) => x.project_id === p[0]).map((x) => ({ id: x.id }));
    }
    return [];
  };

  const stmt = (sql: string) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...params: unknown[]) {
        return {
          first: async () => firstQuery(q, params),
          all: async () => ({ results: allQuery(q, params) }),
          run: async () => runQuery(q, params),
        };
      },
    };
  };

  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      for (const s of stmts) await s.run();
      return [];
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true' });

// Two signed-in users sharing one stub DB: sign-up via request-link + verify.
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

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('projects CRUD + owner isolation', () => {
  it('creates, reads, patches, and deletes; strangers get 404; anon gets 401', async () => {
    const db = makeDb();
    const env = ENV(db);
    const alice = await signIn(db, 'alice@example.com');
    const bob = await signIn(db, 'bob@example.com');

    expect((await app.request('/api/projects', {}, env)).status).toBe(401);

    const bad = await app.request('/api/projects', json('POST', { title: '', level: 'A1' }, alice), env);
    expect(bad.status).toBe(400);

    const created = await app.request(
      '/api/projects', json('POST', { title: 'Mia Runs', level: 'A2' }, alice), env);
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: string } };

    const bobList = (await (await app.request('/api/projects', { headers: { cookie: bob } }, env)).json()) as {
      projects: unknown[];
    };
    expect(bobList.projects).toEqual([]);
    expect((await app.request(`/api/projects/${project.id}`, { headers: { cookie: bob } }, env)).status).toBe(404);

    const patched = await app.request(
      `/api/projects/${project.id}`, json('PATCH', { level: 'C9' }, alice), env);
    expect(patched.status).toBe(400);
    const ok = await app.request(
      `/api/projects/${project.id}`, json('PATCH', { title: 'Mia Runs Far' }, alice), env);
    expect(((await ok.json()) as { project: { title: string } }).project.title).toBe('Mia Runs Far');

    expect((await app.request(`/api/projects/${project.id}`, { method: 'DELETE', headers: { cookie: bob } }, env)).status).toBe(404);
    const del = await app.request(`/api/projects/${project.id}`, { method: 'DELETE', headers: { cookie: alice } }, env);
    expect(del.status).toBe(200);
    expect((await app.request(`/api/projects/${project.id}`, { headers: { cookie: alice } }, env)).status).toBe(404);
  });
});

describe('scenes CRUD + reorder', () => {
  it('numbers scenes sequentially, enforces ownership, reorders exactly', async () => {
    const db = makeDb();
    const env = ENV(db);
    const alice = await signIn(db, 'alice@example.com');
    const bob = await signIn(db, 'bob@example.com');
    const pid = (
      (await (
        await app.request('/api/projects', json('POST', { title: 'T', level: 'B1' }, alice), env)
      ).json()) as { project: { id: string } }
    ).project.id;

    const mk = (narration: string, cookie: string, n?: number) =>
      app.request(
        `/api/projects/${pid}/scenes`,
        json('POST', { ...(n === undefined ? {} : { scene_number: n }), data_json: { narration, bubbles: [] } }, cookie),
        env,
      );
    const s1 = ((await (await mk('One', alice)).json()) as { scene: { id: string; scene_number: number } }).scene;
    const s2 = ((await (await mk('Two', alice)).json()) as { scene: { id: string; scene_number: number } }).scene;
    expect([s1.scene_number, s2.scene_number]).toEqual([1, 2]);

    expect((await mk('X', bob)).status).toBe(404);
    expect((await mk('X', alice, 1)).status).toBe(409);
    expect(
      (await app.request(`/api/projects/${pid}/scenes`, json('POST', { data_json: { bubbles: [] } }, alice), env)).status,
    ).toBe(400);

    const get = (await (await app.request(`/api/projects/${pid}`, { headers: { cookie: alice } }, env)).json()) as {
      scenes: { id: string }[];
    };
    expect(get.scenes.map((s) => s.id)).toEqual([s1.id, s2.id]);

    const partial = await app.request(
      `/api/projects/${pid}/scenes/reorder`, json('POST', { order: [s1.id] }, alice), env);
    expect(partial.status).toBe(400);
    const re = await app.request(
      `/api/projects/${pid}/scenes/reorder`, json('POST', { order: [s2.id, s1.id] }, alice), env);
    const after = ((await re.json()) as { scenes: { id: string; scene_number: number }[] }).scenes;
    expect(after.map((s) => [s.id, s.scene_number])).toEqual([[s2.id, 1], [s1.id, 2]]);

    // Three-way rotation: with UNIQUE(project_id, scene_number), naive
    // sequential UPDATEs collide mid-batch (the reported editor bug).
    const s3 = ((await (await mk('Three', alice)).json()) as { scene: { id: string } }).scene;
    const rot = await app.request(
      `/api/projects/${pid}/scenes/reorder`, json('POST', { order: [s2.id, s1.id, s3.id] }, alice), env);
    expect(rot.status).toBe(200);
    const rotated = ((await rot.json()) as { scenes: { id: string; scene_number: number }[] }).scenes;
    expect(rotated.map((s) => [s.id, s.scene_number])).toEqual([[s2.id, 1], [s1.id, 2], [s3.id, 3]]);

    const badOrders: unknown[] = [
      { order: [] },
      { order: 'nope' },
      {},
      { order: [s2.id, s2.id, s3.id] },
      { order: [s2.id, s1.id, 'missing-id'] },
      { order: [s2.id, s1.id] },
    ];
    for (const payload of badOrders) {
      const r = await app.request(`/api/projects/${pid}/scenes/reorder`, json('POST', payload, alice), env);
      expect(r.status).toBe(400);
    }
    expect(
      (await app.request(`/api/projects/${pid}/scenes/reorder`, json('POST', { order: [s2.id, s1.id, s3.id] }, bob), env)).status,
    ).toBe(404);

    const upd = await app.request(
      `/api/projects/${pid}/scenes/${s1.id}`,
      json('PATCH', { data_json: { narration: 'One!', bubbles: [{ speaker: 'M', text: 'Hi' }] } }, alice), env);
    expect(upd.status).toBe(200);
    const del = await app.request(`/api/projects/${pid}/scenes/${s1.id}`, { method: 'DELETE', headers: { cookie: alice } }, env);
    expect(del.status).toBe(200);
    const gone = (await (await app.request(`/api/projects/${pid}`, { headers: { cookie: alice } }, env)).json()) as {
      scenes: unknown[];
    };
    expect(gone.scenes).toHaveLength(2);
  });
});
