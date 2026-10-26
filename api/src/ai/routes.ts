import { Hono } from 'hono';
import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from '../types';
import { DAILY_AI_LIMIT } from './config';
import { AiError } from './meta';
import { generate, parseJson } from './client';
import { checkPrompt, draftPrompt, ideaPrompt, meaningsPrompt, simplifyPrompt } from './prompts';
import { checkLevel } from '../levels';
import type { Level } from '../levels';
import { ownProject } from '../projects';
import type { ProjectRow } from '../projects';
import { isRecord, validateSceneData } from '../validate';

// Session gate (index.ts) applies. Every endpoint: validate input -> key ->
// rate limit -> generate. Model failures surface as generic 502s.
export const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const INVALID = { error: 'invalid request' } as const;
const FAILED = { error: 'ai failed' } as const;

async function readJson(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

function key(c: { env: Bindings }): string | null {
  return c.env.MODEL_API_KEY ?? null;
}

async function overLimit(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND date(created_at) = date('now')")
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= DAILY_AI_LIMIT;
}

function castNames(castJson: string): string[] {
  try {
    const v = JSON.parse(castJson) as unknown;
    if (!isRecord(v)) return [];
    const out: string[] = [];
    for (const kind of ['characters', 'places']) {
      const list = v[kind];
      if (Array.isArray(list)) {
        for (const e of list) {
          if (isRecord(e) && typeof e.name === 'string') out.push(e.name);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

const isLevel = (v: unknown): v is Level =>
  v === 'A1' || v === 'A2' || v === 'B1' || v === 'B2';

ai.post('/idea', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.idea !== 'string' || body.idea.trim() === '' || body.idea.length > 500) {
    return c.json(INVALID, 400);
  }
  const apiKey = key(c);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);
  try {
    const { text } = await generate(c.env.DB, {
      apiKey,
      userId: c.get('userId'),
      projectId: null,
      opId: crypto.randomUUID(),
      task: 'idea',
      prompt: ideaPrompt(body.idea.trim()),
      json: true,
      apiUrl: c.env.AI_API_URL,
      validate: (t) => {
        const v = parseJson(t, isRecord);
        return !!v && typeof v.description === 'string' && isLevel(v.level);
      },
    });
    const v = parseJson(text, isRecord) as { description: string; level: Level };
    return c.json({ description: v.description, level: v.level });
  } catch (e) {
    if (e instanceof AiError) return c.json(FAILED, 502);
    throw e;
  }
});

ai.post('/meanings', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || !Array.isArray(body.words) || body.words.length === 0 || body.words.length > 20) {
    return c.json(INVALID, 400);
  }
  if (!body.words.every((w) => typeof w === 'string' && w.length > 0 && w.length <= 50)) {
    return c.json(INVALID, 400);
  }
  const level = body.level === undefined ? 'A1' : body.level;
  if (!isLevel(level)) return c.json(INVALID, 400);
  const words = body.words as string[];
  const apiKey = key(c);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);
  const wordsList = words.map((w, i) => `${i + 1}. ${w}`).join('\n');
  try {
    const { text } = await generate(c.env.DB, {
      apiKey,
      userId: c.get('userId'),
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      opId: crypto.randomUUID(),
      task: 'meanings',
      prompt: meaningsPrompt(level, wordsList),
      json: true,
      apiUrl: c.env.AI_API_URL,
      validate: (t) => {
        const v = parseJson(t, isRecord);
        if (!v || !Array.isArray(v.meanings) || v.meanings.length !== words.length) return false;
        return (v.meanings as unknown[]).every(
          (m, i) => isRecord(m) && m.word === words[i] && typeof m.meaning === 'string',
        );
      },
    });
    const v = parseJson(text, isRecord) as { meanings: { word: string; meaning: string }[] };
    return c.json({ meanings: v.meanings });
  } catch (e) {
    if (e instanceof AiError) return c.json(FAILED, 502);
    throw e;
  }
});

ai.post('/simplify', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.text !== 'string' || body.text === '' || body.text.length > 2000) {
    return c.json(INVALID, 400);
  }
  if (!isLevel(body.level)) return c.json(INVALID, 400);
  const apiKey = key(c);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);
  try {
    const { text } = await generate(c.env.DB, {
      apiKey,
      userId: c.get('userId'),
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      opId: crypto.randomUUID(),
      task: 'simplify',
      prompt: simplifyPrompt(body.level, body.text),
      json: true,
      apiUrl: c.env.AI_API_URL,
      validate: (t) => {
        const v = parseJson(t, isRecord);
        return !!v && typeof v.rewritten === 'string' && v.rewritten.length > 0;
      },
    });
    const v = parseJson(text, isRecord) as { rewritten: string };
    const check = checkLevel(v.rewritten, body.level as Level);
    return c.json({
      rewritten: v.rewritten,
      check: { passed: check.passed, coverage: check.coverage, unknown: check.unknown, words: check.words },
    });
  } catch (e) {
    if (e instanceof AiError) return c.json(FAILED, 502);
    throw e;
  }
});

interface DraftScene {
  scene_number: number;
  narration: string;
  bubbles: { speaker: string; text: string }[];
}

const isDraftScene = (v: unknown): v is DraftScene => {
  if (!isRecord(v)) return false;
  if (typeof v.scene_number !== 'number' || !Number.isInteger(v.scene_number) || v.scene_number < 1) return false;
  const data = validateSceneData({ narration: v.narration, bubbles: v.bubbles });
  return data.ok;
};

const isDraftReply = (v: unknown): v is { scenes: DraftScene[] } =>
  isRecord(v) && Array.isArray(v.scenes) && v.scenes.every(isDraftScene);

const isCheckReply = (v: unknown): v is { passed: boolean; reason: string } => {
  if (!isRecord(v) || typeof v.passed !== 'boolean') return false;
  return typeof v.reason === 'string' || v.reason === undefined;
};

async function draftMissing(
  db: D1Database,
  ctx: { apiKey: string; userId: string; projectId: string; opId: string; apiUrl?: string },
  project: ProjectRow,
  scenesSoFar: { scene_number: number; narration: string; bubbles: unknown[] }[],
  targetCount: number,
): Promise<DraftScene[]> {
  const { text } = await generate(db, {
    ...ctx,
    task: 'draft',
    prompt: draftPrompt({
      title: project.title,
      level: project.level,
      targetSceneCount: targetCount,
      castJson: project.cast_json,
      scenesJson: JSON.stringify(scenesSoFar),
      newWordsJson: '[]',
    }),
    json: true,
    validate: (t) => parseJson(t, isDraftReply) !== null,
  });
  return (parseJson(text, isDraftReply) as { scenes: DraftScene[] }).scenes;
}

ai.post('/finish', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.projectId !== 'string') return c.json(INVALID, 400);
  const project = await ownProject(c.env.DB, body.projectId, c.get('userId'));
  if (!project) return c.json({ error: 'not found' }, 404);
  if (!isLevel(project.level)) return c.json(INVALID, 400);
  const apiKey = key(c);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);

  const db = c.env.DB;
  const userId = c.get('userId');
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const opId = crypto.randomUUID();
  const ctx = { apiKey, userId, projectId: project.id, opId, apiUrl: c.env.AI_API_URL };
  await db
    .prepare(
      "INSERT INTO jobs (id, user_id, project_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, 'finish', ?, 'running', ?, ?)",
    )
    .bind(jobId, userId, project.id, JSON.stringify({ projectId: project.id }), now, now)
    .run();

  const finishJob = async (status: string, result: unknown, error: string | null) => {
    const stamp = new Date().toISOString();
    await db
      .prepare('UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind(status, result === null ? null : JSON.stringify(result), error, stamp, jobId)
      .run();
  };

  try {
    const { results: existing } = await db
      .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC')
      .bind(project.id)
      .all<{ id: string; project_id: string; scene_number: number; data_json: string; updated_at: string }>();
    const have = new Set(existing.map((s) => s.scene_number));
    const targetCount = Math.max(6, ...existing.map((s) => s.scene_number), 0);
    const missing = Array.from({ length: targetCount }, (_, i) => i + 1).filter((n) => !have.has(n));
    if (missing.length === 0) {
      const result = { saved: [], failed: [] };
      await finishJob('complete', result, null);
      return c.json({ job: { id: jobId, status: 'complete' }, ...result });
    }

    const scenesSoFar = existing.map((s) => {
      const data = validateSceneData(JSON.parse(s.data_json) as unknown);
      return {
        scene_number: s.scene_number,
        narration: data.ok ? data.value.narration : '',
        bubbles: data.ok ? data.value.bubbles : [],
      };
    });
    const extra = castNames(project.cast_json);
    const level = project.level as Level;

    let drafted = await draftMissing(db, ctx, project, scenesSoFar, targetCount);
    const saved: number[] = [];
    const failed: { scene_number: number; reason: string }[] = [];

    for (const n of missing) {
      let scene = drafted.find((d) => d.scene_number === n);
      // One redraft for scenes the first pass skipped.
      if (!scene) {
        drafted = await draftMissing(db, ctx, project, scenesSoFar, targetCount);
        scene = drafted.find((d) => d.scene_number === n);
        if (!scene) {
          failed.push({ scene_number: n, reason: 'not drafted' });
          continue;
        }
      }
      const story = `${scene.narration}\n${scene.bubbles.map((b) => `${b.speaker}: ${b.text}`).join('\n')}`;
      let check: { passed: boolean; reason: string };
      try {
        const out = await generate(db, {
          ...ctx,
          task: 'check',
          prompt: checkPrompt(level, story),
          json: true,
          validate: (t) => parseJson(t, isCheckReply) !== null,
        });
        check = parseJson(out.text, isCheckReply) as { passed: boolean; reason: string };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        failed.push({ scene_number: n, reason: 'check failed' });
        continue;
      }
      const gate = checkLevel(story, level, extra);
      if (!check.passed || !gate.passed) {
        const reason = !check.passed ? check.reason || 'qa rejected' : `out of level: ${gate.unknown.join(', ')}`;
        failed.push({ scene_number: n, reason });
        continue;
      }
      const stamp = new Date().toISOString();
      await db
        .prepare('INSERT INTO scenes (id, project_id, scene_number, data_json, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(
          crypto.randomUUID(),
          project.id,
          n,
          JSON.stringify({
            narration: scene.narration,
            bubbles: scene.bubbles,
            level,
            check: { coverage: gate.coverage, unknown: gate.unknown },
          }),
          stamp,
        )
        .run();
      saved.push(n);
    }

    const result = { saved, failed };
    await finishJob('complete', result, null);
    return c.json({ job: { id: jobId, status: 'complete' }, ...result });
  } catch (e) {
    if (e instanceof AiError) {
      await finishJob('failed', null, 'ai failed');
      return c.json(FAILED, 502);
    }
    throw e;
  }
});
