import { Hono } from 'hono';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Bindings, Variables } from '../types';
import { AiError } from './meta';
import { generateArt, generateMask } from './client';
import { FAILED, INVALID, finishJob, modelKey, limitCheck, readJson } from './http';
import { modalConfig } from './config';
import { castPortraitPrompt, isolateText, sceneArtPrompt } from './prompts';
import { ownProject } from '../projects';
import { isRecord, validateSceneData } from '../validate';
import { cachedJson } from '../cache';

// Scene art (Step 4a). Mounted at /api/ai/art with relative paths:
// POST / draws + isolates one scene panel into R2, GET /:key serves it.
// Inherits the session gate from index.ts, like every /api/* route.
export const art = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const panelKey = (projectId: string, sceneNumber: number): string => `${projectId}-${sceneNumber}.png`;
const maskKey = (projectId: string, sceneNumber: number): string => `${projectId}-${sceneNumber}-mask.png`;

// Flat keys only (uuid or slug project id + scene/cast suffix, or
// flashcard image keys): no slashes, no traversal. Slugs matter because
// seeded demo projects use readable ids (demo-proj-red-cat) and their
// panels must serve exactly like uuid-project art. Flash levels are
// uppercase (A1..C2).
const KEY_RE =
  /^([A-Za-z0-9][A-Za-z0-9-]*-(\d{1,3}(-mask)?|cast-(characters|places)-\d{1,2})|flash-[A-Za-z0-9-]+)\.png$/;

// Flashcard image key: flash-<LEVEL>-<word>.png. Single parser for the
// index endpoint; KEY_RE above stays the serving gate.
const FLASH_RE = /^flash-([A-Za-z0-9]+)-([a-z0-9-]+)\.png$/;

// Every art object a published book needs: panel + mask keys plus any
// cast portrait referenced from cast_json. KEY_RE filters so a corrupt
// cast_json can never turn the copy into a traversal.
export function collectPublishKeys(
  panels: { image_key: string; mask_key: string | null }[],
  castJson: string,
): string[] {
  const out = new Set<string>();
  for (const p of panels) {
    if (KEY_RE.test(p.image_key)) out.add(p.image_key);
    if (p.mask_key && KEY_RE.test(p.mask_key)) out.add(p.mask_key);
  }
  for (const m of castJson.matchAll(/\/api\/ai\/art\/([A-Za-z0-9_.-]+)/g)) {
    if (KEY_RE.test(m[1])) out.add(m[1]);
  }
  return [...out];
}

// Best-effort ART -> LIBRARY_ART copy on publish. Missing stores (local
// dev) skip silently; single-key failures don't fail the publish — reads
// fall back to ART, so a missed copy degrades to two lookups, never 404.
export async function copyArtToLibrary(
  from: R2Bucket | undefined,
  to: R2Bucket | undefined,
  keys: string[],
): Promise<void> {
  if (!from || !to || keys.length === 0) return;
  for (const k of keys) {
    try {
      const obj = await from.get(k);
      if (!obj) continue;
      await to.put(k, await obj.arrayBuffer(), {
        httpMetadata: { contentType: obj.httpMetadata?.contentType ?? 'image/png' },
      });
    } catch {
      // Fallback reads cover the miss; publish must not fail on storage.
    }
  }
}

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

// Resolve the page's character picks against the cast: known names expand
// to "name — look", unknown names pass through raw so the artist still
// tries them. Case-insensitive; keeps the author's pick order.
function describeCast(castJson: string, names: string[]): string[] {
  const entries = castEntries(castJson, 'characters');
  return names.map((n) => {
    const e = entries.find(
      (x) => typeof x.name === 'string' && x.name.trim().toLowerCase() === n.trim().toLowerCase(),
    );
    const name =
      (e && typeof e.name === 'string' && e.name.trim() !== '' ? e.name.trim() : null) ?? n.trim();
    const look = e && typeof e.description === 'string' && e.description.trim() !== '' ? e.description.trim() : null;
    return look ? `${name} — ${look}` : name;
  });
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
  const limited = await limitCheck(c.env.DB, c.get('userId'));
  if (limited) return c.json(limited, 429);
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
  let pageCharacters: string[] = [];
  try {
    const parsed = validateSceneData(JSON.parse(scene.data_json) as unknown);
    if (!parsed.ok) return c.json(INVALID, 400);
    narration = parsed.value.narration;
    bubbles = parsed.value.bubbles;
    pageCharacters = parsed.value.characters;
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

  const ctx = { apiKey, userId, projectId: project.id, apiUrl: c.env.AI_API_URL, modal: modalConfig(c.env) };
  const character = describeCharacter(project.cast_json);
  const resolved = describeCast(project.cast_json, pageCharacters);
  try {
    const prompt = sceneArtPrompt({
      place: describePlace(project.cast_json),
      character,
      characters: resolved.length > 0 ? resolved : undefined,
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
    // Cutouts are stored but never read by any client; a dead isolate step
    // must not discard the paid panel. The failed attempt stays in ai_usage.
    let maskUrl: string | null = null;
    let mKey: string | null = null;
    try {
      const mask = await generateMask(db, {
        ...ctx,
        opId: crypto.randomUUID(),
        imageBytes: panel.bytes,
        textPrompt: isolateText(resolved[0] ?? character),
      });
      mKey = maskKey(project.id, sceneNumber);
      await store.put(mKey, mask.bytes, { httpMetadata: { contentType: mask.contentType } });
      maskUrl = `/api/ai/art/${mKey}`;
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
    }
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
    const panels = [{ scene_number: sceneNumber, image_url: `/api/ai/art/${imageKey}`, mask_url: maskUrl }];
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

// Cast portrait (costly-lean): one flat-style card per character/place,
// persisted into cast_json so panels and future scenes reuse it.
art.post('/portrait', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.projectId !== 'string' || body.projectId === '') {
    return c.json(INVALID, 400);
  }
  const kind = body.kind;
  if (kind !== 'characters' && kind !== 'places') return c.json(INVALID, 400);
  const index = body.index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 99) {
    return c.json(INVALID, 400);
  }
  const project = await ownProject(c.env.DB, body.projectId, c.get('userId'));
  if (!project) return c.json({ error: 'not found' }, 404);
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  const limited = await limitCheck(c.env.DB, c.get('userId'));
  if (limited) return c.json(limited, 429);
  const store: R2Bucket | undefined = c.env.ART;
  if (!store) return c.json({ error: 'art unavailable' }, 503);

  const db = c.env.DB;
  const entries = castEntries(project.cast_json, kind);
  const entry = entries[index];
  const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!entry || name === '') return c.json(INVALID, 400);
  const look =
    typeof entry.description === 'string' && entry.description.trim() !== ''
      ? entry.description.trim()
      : name;
  const prompt = castPortraitPrompt({ kind, name, look });
  try {
    const card = await generateArt(db, {
      apiKey,
      userId: c.get('userId'),
      projectId: project.id,
      opId: crypto.randomUUID(),
      prompt,
      task: 'portrait',
      size: { width: 512, height: 640 },
      apiUrl: c.env.AI_API_URL,
      modal: modalConfig(c.env),
    });
    const imageKey = `${project.id}-cast-${kind}-${index}.png`;
    await store.put(imageKey, card.bytes, { httpMetadata: { contentType: card.contentType } });
    const imageUrl = `/api/ai/art/${imageKey}`;
    entry.image_url = imageUrl;
    let castJson = project.cast_json;
    try {
      const parsed = JSON.parse(project.cast_json) as unknown;
      if (isRecord(parsed)) {
        parsed[kind] = entries;
        castJson = JSON.stringify(parsed);
      }
    } catch {
      // keep original cast_json on parse surprise (entries came from it, so unreachable)
    }
    if (castJson !== project.cast_json) {
      await db
        .prepare('UPDATE projects SET cast_json = ? WHERE id = ?')
        .bind(castJson, project.id)
        .run();
    }
    return c.json({ image_url: imageUrl, cast: JSON.parse(castJson) as unknown });
  } catch (e) {
    if (e instanceof AiError) return c.json(FAILED, 502);
    throw e;
  }
});

// Flashcard image index: which flash-<LEVEL>-<word>.png keys exist in the
// shared library bucket. The client renders <img> only for indexed words,
// so abstract or not-yet-generated words never fire 404s. Anonymous (no
// session gate on GET art paths); identical for everyone, edge-cached.
// Registered before /:key so the literal path wins.
art.get('/flash-index', async (c) => {
  return cachedJson(c, 600, async () => {
    const images: string[] = [];
    const store = c.env.LIBRARY_ART;
    if (store) {
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const listed = await store.list({ prefix: 'flash-', cursor, limit: 500 });
        for (const o of listed.objects) {
          const m = FLASH_RE.exec(o.key);
          if (m) images.push(`${m[1]}:${m[2]}`);
        }
        if (listed.truncated) cursor = listed.cursor;
        else break;
      }
    }
    return { status: 200, body: { images } };
  });
});

art.get('/:key', async (c) => {
  const k = c.req.param('key');
  if (!KEY_RE.test(k)) return c.json({ error: 'not found' }, 404);
  const store: R2Bucket | undefined = c.env.ART;
  // Library-first: published books live in 3e-library; fall back to the
  // draft bucket for older books and local dev (both may be undefined).
  const obj =
    (await c.env.LIBRARY_ART?.get(k)) ?? (store ? await store.get(k) : null);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(await obj.arrayBuffer(), {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
