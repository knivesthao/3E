import { Hono } from 'hono';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Bindings, Variables } from '../types';
import { AiError } from './meta';
import { generateArt, generateMask } from './client';
import { FAILED, INVALID, finishJob, modelKey, overLimit, readJson } from './http';
import { isolateText, sceneArtPrompt } from './prompts';
import { ownProject } from '../projects';
import { isRecord, validateSceneData } from '../validate';

// Scene art (Step 4a). Mounted at /api/ai/art with relative paths:
// POST / draws + isolates one scene panel into R2, GET /:key serves it.
// Inherits the session gate from index.ts, like every /api/* route.
export const art = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const panelKey = (projectId: string, sceneNumber: number): string => `${projectId}-${sceneNumber}.png`;
const maskKey = (projectId: string, sceneNumber: number): string => `${projectId}-${sceneNumber}-mask.png`;

// Flat keys only (uuid + scene + optional -mask): no slashes, no traversal.
const KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{1,3}(-mask)?\.png$/;

function castEntries(castJson: string, list: 'characters' | 'places'): Record<string, unknown>[] {
  try {
    const v = JSON.parse(castJson) as unknown;
    if (!isRecord(v)) return [];
    const raw = v[list];
    if (!Array.isArray(raw)) return [];
    return raw.filter((e: unknown): e is Record<string, unknown> => isRecord(e));
  } catch {
    return [];
  }
}

function describeCharacter(castJson: string): string {
  const [first] = castEntries(castJson, 'characters');
  if (!first) return 'a young child';
  const name = typeof first.name === 'string' && first.name !== '' ? first.name : 'child';
  const desc = typeof first.description === 'string' && first.description !== '' ? first.description : name;
  return desc === name ? name : `${name} — ${desc}`;
}

function describePlace(castJson: string): string {
  const [first] = castEntries(castJson, 'places');
  if (!first) return 'a simple home';
  if (typeof first.description === 'string' && first.description !== '') return first.description;
  if (typeof first.name === 'string' && first.name !== '') return first.name;
  return 'a simple home';
}

art.post('/', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.projectId !== 'string' || body.projectId === '') {
    return c.json(INVALID, 400);
  }
  const sceneNumber = body.sceneNumber;
  if (
    typeof sceneNumber !== 'number' ||
    !Number.isInteger(sceneNumber) ||
    sceneNumber < 1 ||
    sceneNumber > 100
  ) {
    return c.json(INVALID, 400);
  }
  const project = await ownProject(c.env.DB, body.projectId, c.get('userId'));
  if (!project) return c.json({ error: 'not found' }, 404);
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);
  const store: R2Bucket | undefined = c.env.ART;
  if (!store) return c.json({ error: 'art unavailable' }, 503);

  const db = c.env.DB;
  const userId = c.get('userId');
  const scene = await db
    .prepare('SELECT * FROM scenes WHERE project_id = ? AND scene_number = ?')
    .bind(project.id, sceneNumber)
    .first<{ id: string; data_json: string }>();
  if (!scene) return c.json({ error: 'not found' }, 404);
  let narration = '';
  let bubbles: { speaker: string; text: string }[] = [];
  try {
    const parsed = validateSceneData(JSON.parse(scene.data_json) as unknown);
    if (!parsed.ok) return c.json(INVALID, 400);
    narration = parsed.value.narration;
    bubbles = parsed.value.bubbles;
  } catch {
    return c.json(INVALID, 400);
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO jobs (id, user_id, project_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, 'scene', ?, 'running', ?, ?)",
    )
    .bind(jobId, userId, project.id, JSON.stringify({ projectId: project.id, sceneNumber }), now, now)
    .run();

  const ctx = { apiKey, userId, projectId: project.id, apiUrl: c.env.AI_API_URL };
  const character = describeCharacter(project.cast_json);
  try {
    const prompt = sceneArtPrompt({
      place: describePlace(project.cast_json),
      character,
      narration,
      bubbles,
    });
    const panel = await generateArt(db, {
      ...ctx,
      opId: crypto.randomUUID(),
      prompt,
      size: { width: 640, height: 800 },
    });
    const imageKey = panelKey(project.id, sceneNumber);
    await store.put(imageKey, panel.bytes, { httpMetadata: { contentType: panel.contentType } });
    const mask = await generateMask(db, {
      ...ctx,
      opId: crypto.randomUUID(),
      imageBytes: panel.bytes,
      textPrompt: isolateText(character),
    });
    const mKey = maskKey(project.id, sceneNumber);
    await store.put(mKey, mask.bytes, { httpMetadata: { contentType: mask.contentType } });
    await db
      .prepare('DELETE FROM panels WHERE project_id = ? AND scene_number = ?')
      .bind(project.id, sceneNumber)
      .run();
    await db
      .prepare(
        'INSERT INTO panels (id, project_id, scene_number, image_key, mask_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), project.id, sceneNumber, imageKey, mKey, new Date().toISOString())
      .run();
    const panels = [
      { scene_number: sceneNumber, image_url: `/api/ai/art/${imageKey}`, mask_url: `/api/ai/art/${mKey}` },
    ];
    await finishJob(db, jobId, 'complete', { panels }, null);
    return c.json({ job: { id: jobId, status: 'complete' }, panels });
  } catch (e) {
    if (e instanceof AiError) {
      await finishJob(db, jobId, 'failed', null, 'ai failed');
      return c.json(FAILED, 502);
    }
    throw e;
  }
});

art.get('/:key', async (c) => {
  const k = c.req.param('key');
  if (!KEY_RE.test(k)) return c.json({ error: 'not found' }, 404);
  const store: R2Bucket | undefined = c.env.ART;
  if (!store) return c.json({ error: 'not found' }, 404);
  const obj = await store.get(k);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
