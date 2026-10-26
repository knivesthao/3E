import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from './types';
import {
  validateProjectCreate,
  validateProjectPatch,
  validateSceneData,
  validateSceneOrder,
} from './validate';
import { generate } from './ai/client';
import { finishJob, modelKey, overLimit } from './ai/http';
import { AiError } from './ai/meta';
import { safetyPrompt, sceneActionText } from './ai/prompts';

// All routes inherit the session gate from index.ts (owner = session user).
// Missing-or-foreign resources all return 404 so ids can't be probed.
export const projects = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

export interface ProjectRow {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  level: string;
  purpose: string;
  status: string;
  cast_json: string;
  created_at: string;
  updated_at: string;
}

interface SceneRow {
  id: string;
  project_id: string;
  scene_number: number;
  data_json: string;
  updated_at: string;
}

const NOT_FOUND = { error: 'not found' } as const;
const INVALID = { error: 'invalid request' } as const;

export async function ownProject(
  db: D1Database,
  id: string,
  userId: string,
): Promise<ProjectRow | null> {
  return await db
    .prepare('SELECT * FROM projects WHERE id = ? AND creator_id = ?')
    .bind(id, userId)
    .first<ProjectRow>();
}

async function touch(db: D1Database, projectId: string, now: string): Promise<void> {
  await db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId).run();
}

projects.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, level, purpose, status, updated_at FROM projects WHERE creator_id = ? ORDER BY updated_at DESC',
  )
    .bind(c.get('userId'))
    .all<{ id: string; title: string; level: string; purpose: string; status: string; updated_at: string }>();
  return c.json({ projects: results });
});

projects.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  const parsed = validateProjectCreate(body);
  if (!parsed.ok) return c.json(INVALID, 400);
  const now = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    creator_id: c.get('userId'),
    title: parsed.value.title,
    description: parsed.value.description,
    level: parsed.value.level,
    purpose: parsed.value.purpose,
    status: 'draft',
    cast_json: '{"characters":[],"places":[]}',
    created_at: now,
    updated_at: now,
  };
  await c.env.DB.prepare(
    'INSERT INTO projects (id, creator_id, title, description, level, purpose, status, cast_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      project.id,
      project.creator_id,
      project.title,
      project.description,
      project.level,
      project.purpose,
      project.status,
      project.cast_json,
      project.created_at,
      project.updated_at,
    )
    .run();
  return c.json({ project }, 201);
});

projects.get('/:id', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC',
  )
    .bind(project.id)
    .all<SceneRow>();
  return c.json({ project, scenes: results });
});

projects.patch('/:id', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  const parsed = validateProjectPatch(body);
  if (!parsed.ok) return c.json(INVALID, 400);
  const next: ProjectRow = {
    ...project,
    title: parsed.value.title ?? project.title,
    description: parsed.value.description ?? project.description,
    level: parsed.value.level ?? project.level,
    purpose: parsed.value.purpose ?? project.purpose,
    cast_json: parsed.value.cast_json ?? project.cast_json,
    updated_at: new Date().toISOString(),
  };
  await c.env.DB.prepare(
    'UPDATE projects SET title = ?, description = ?, level = ?, purpose = ?, cast_json = ?, updated_at = ? WHERE id = ?',
  )
    .bind(next.title, next.description, next.level, next.purpose, next.cast_json, next.updated_at, next.id)
    .run();
  return c.json({ project: next });
});

projects.delete('/:id', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM scenes WHERE project_id = ?').bind(project.id),
    c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id),
  ]);
  return c.json({ ok: true });
});

const readingLevel = (level: string): 'beginner' | 'intermediate' | 'advanced' =>
  level === 'B2' ? 'advanced' : level === 'B1' ? 'intermediate' : 'beginner';

// Publish (Step 4b): owner-only safety screen (Muse Spark safe/unsafe) +
// manifest v2 packaging into books + cover. One call turns a draft into a
// books row (republish updates the same row, keeping published_at).
projects.post('/:id/publish', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);

  const db = c.env.DB;
  const userId = c.get('userId');
  const { results: sceneRows } = await db
    .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC')
    .bind(project.id)
    .all<SceneRow>();
  if (sceneRows.length === 0) return c.json(INVALID, 400);
  const scenes: { scene_number: number; narration: string; bubbles: { speaker: string; text: string }[] }[] = [];
  for (const s of sceneRows) {
    let data: unknown;
    try {
      data = JSON.parse(s.data_json) as unknown;
    } catch {
      return c.json(INVALID, 400);
    }
    const parsed = validateSceneData(data);
    if (!parsed.ok) return c.json(INVALID, 400);
    scenes.push({ scene_number: s.scene_number, narration: parsed.value.narration, bubbles: parsed.value.bubbles });
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO jobs (id, user_id, project_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, 'package', ?, 'running', ?, ?)",
    )
    .bind(jobId, userId, project.id, JSON.stringify({ projectId: project.id }), now, now)
    .run();

  try {
    const fullText = scenes.map((s) => sceneActionText(s.narration, s.bubbles)).join('\n\n');
    const { text } = await generate(db, {
      apiKey,
      userId,
      projectId: project.id,
      opId: crypto.randomUUID(),
      task: 'safety',
      prompt: safetyPrompt(fullText),
      json: false,
      apiUrl: c.env.AI_API_URL,
      validate: (t) => {
        const v = t.trim().toLowerCase();
        return v === 'safe' || v === 'unsafe';
      },
    });
    if (text.trim().toLowerCase() !== 'safe') {
      await finishJob(db, jobId, 'failed', null, 'unsafe content');
      return c.json({ error: 'unsafe content' }, 422);
    }

    const { results: panelRows } = await db
      .prepare('SELECT scene_number, image_key, mask_key FROM panels WHERE project_id = ?')
      .bind(project.id)
      .all<{ scene_number: number; image_key: string; mask_key: string | null }>();
    const art = new Map(panelRows.map((p) => [p.scene_number, p]));
    const manifestScenes = scenes.map((s) => {
      const p = art.get(s.scene_number);
      return {
        scene_number: s.scene_number,
        narration: s.narration,
        bubbles: s.bubbles,
        image_url: p ? `/api/ai/art/${p.image_key}` : null,
        mask_url: p && p.mask_key ? `/api/ai/art/${p.mask_key}` : null,
      };
    });
    const cover = manifestScenes.length > 0 ? manifestScenes[0].image_url : null;
    const manifest = {
      version: 2,
      project_id: project.id,
      title: project.title,
      description: project.description,
      level: project.level,
      reading_level: readingLevel(project.level),
      cover,
      scenes: manifestScenes,
    };
    const stamp = new Date().toISOString();
    const existing = await db
      .prepare('SELECT id, published_at FROM books WHERE project_id = ?')
      .bind(project.id)
      .first<{ id: string; published_at: string }>();
    let bookId: string;
    let publishedAt: string;
    if (existing) {
      bookId = existing.id;
      publishedAt = existing.published_at;
      await db
        .prepare(
          'UPDATE books SET title = ?, description = ?, level = ?, reading_level = ?, cover_url = ?, manifest_json = ?, updated_at = ? WHERE id = ?',
        )
        .bind(
          project.title,
          project.description,
          project.level,
          manifest.reading_level,
          cover,
          JSON.stringify(manifest),
          stamp,
          bookId,
        )
        .run();
    } else {
      bookId = crypto.randomUUID();
      publishedAt = stamp;
      await db
        .prepare(
          'INSERT INTO books (id, project_id, creator_id, title, description, level, reading_level, cover_url, manifest_json, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          bookId,
          project.id,
          userId,
          project.title,
          project.description,
          project.level,
          manifest.reading_level,
          cover,
          JSON.stringify(manifest),
          stamp,
          stamp,
        )
        .run();
    }
    await db
      .prepare("UPDATE projects SET status = 'published', updated_at = ? WHERE id = ?")
      .bind(stamp, project.id)
      .run();
    const book = {
      id: bookId,
      project_id: project.id,
      creator_id: userId,
      title: project.title,
      description: project.description,
      level: project.level,
      reading_level: manifest.reading_level,
      cover_url: cover,
      manifest_json: JSON.stringify(manifest),
      published_at: publishedAt,
      updated_at: stamp,
      manifest,
    };
    await finishJob(db, jobId, 'complete', { book: { id: bookId } }, null);
    return c.json({ job: { id: jobId, status: 'complete' }, book });
  } catch (e) {
    if (e instanceof AiError) {
      await finishJob(db, jobId, 'failed', null, 'ai failed');
      return c.json({ error: 'ai failed' }, 502);
    }
    throw e;
  }
});

projects.post('/:id/scenes', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json(INVALID, 400);
  const { scene_number: rawNumber, data_json: rawData } = body as {
    scene_number?: unknown;
    data_json?: unknown;
  };
  const data = validateSceneData(rawData);
  if (!data.ok) return c.json(INVALID, 400);
  let number: number;
  if (rawNumber === undefined) {
    const max = await c.env.DB.prepare('SELECT MAX(scene_number) AS m FROM scenes WHERE project_id = ?')
      .bind(project.id)
      .first<{ m: number | null }>();
    number = (max?.m ?? 0) + 1;
  } else {
    if (typeof rawNumber !== 'number' || !Number.isInteger(rawNumber) || rawNumber < 1) {
      return c.json(INVALID, 400);
    }
    number = rawNumber;
  }
  const taken = await c.env.DB.prepare('SELECT id FROM scenes WHERE project_id = ? AND scene_number = ?')
    .bind(project.id, number)
    .first<{ id: string }>();
  if (taken) return c.json({ error: 'scene number taken' }, 409);
  const now = new Date().toISOString();
  const scene: SceneRow = {
    id: crypto.randomUUID(),
    project_id: project.id,
    scene_number: number,
    data_json: JSON.stringify(data.value),
    updated_at: now,
  };
  await c.env.DB.prepare('INSERT INTO scenes (id, project_id, scene_number, data_json, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(scene.id, scene.project_id, scene.scene_number, scene.data_json, scene.updated_at)
    .run();
  await touch(c.env.DB, project.id, now);
  return c.json({ scene }, 201);
});

projects.patch('/:id/scenes/:sceneId', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  const scene = await c.env.DB.prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?')
    .bind(c.req.param('sceneId'), project.id)
    .first<SceneRow>();
  if (!scene) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json(INVALID, 400);
  const { scene_number: rawNumber, data_json: rawData } = body as {
    scene_number?: unknown;
    data_json?: unknown;
  };
  if (rawNumber === undefined && rawData === undefined) return c.json(INVALID, 400);
  let number = scene.scene_number;
  if (rawNumber !== undefined) {
    if (typeof rawNumber !== 'number' || !Number.isInteger(rawNumber) || rawNumber < 1) {
      return c.json(INVALID, 400);
    }
    number = rawNumber;
  }
  let dataJson = scene.data_json;
  if (rawData !== undefined) {
    const data = validateSceneData(rawData);
    if (!data.ok) return c.json(INVALID, 400);
    dataJson = JSON.stringify(data.value);
  }
  if (number !== scene.scene_number) {
    const taken = await c.env.DB.prepare(
      'SELECT id FROM scenes WHERE project_id = ? AND scene_number = ? AND id != ?',
    )
      .bind(project.id, number, scene.id)
      .first<{ id: string }>();
    if (taken) return c.json({ error: 'scene number taken' }, 409);
  }
  const now = new Date().toISOString();
  const next: SceneRow = { ...scene, scene_number: number, data_json: dataJson, updated_at: now };
  await c.env.DB.prepare('UPDATE scenes SET scene_number = ?, data_json = ?, updated_at = ? WHERE id = ?')
    .bind(next.scene_number, next.data_json, next.updated_at, next.id)
    .run();
  await touch(c.env.DB, project.id, now);
  return c.json({ scene: next });
});

projects.delete('/:id/scenes/:sceneId', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  const scene = await c.env.DB.prepare('SELECT id FROM scenes WHERE id = ? AND project_id = ?')
    .bind(c.req.param('sceneId'), project.id)
    .first<{ id: string }>();
  if (!scene) return c.json(NOT_FOUND, 404);
  await c.env.DB.prepare('DELETE FROM scenes WHERE id = ?').bind(scene.id).run();
  await touch(c.env.DB, project.id, new Date().toISOString());
  return c.json({ ok: true });
});

projects.post('/:id/scenes/reorder', async (c) => {
  const project = await ownProject(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json(INVALID, 400);
  const order = validateSceneOrder((body as { order?: unknown }).order);
  if (!order.ok) return c.json(INVALID, 400);
  const { results } = await c.env.DB.prepare('SELECT id FROM scenes WHERE project_id = ?')
    .bind(project.id)
    .all<{ id: string }>();
  const current = new Set(results.map((r) => r.id));
  if (current.size !== order.value.length || !order.value.every((id) => current.has(id))) {
    return c.json(INVALID, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.batch(
    order.value.map((id, i) =>
      c.env.DB.prepare('UPDATE scenes SET scene_number = ?, updated_at = ? WHERE id = ?').bind(
        i + 1,
        now,
        id,
      ),
    ),
  );
  await touch(c.env.DB, project.id, now);
  const { results: scenes } = await c.env.DB.prepare(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC',
  )
    .bind(project.id)
    .all<SceneRow>();
  return c.json({ scenes });
});
