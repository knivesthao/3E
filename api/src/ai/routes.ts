import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from '../types';
import { AiError } from './meta';
import { basetenConfig } from './config';
import type { BasetenConfig } from './config';
import { FAILED, INVALID, finishJob, modelKey, overLimit, readJson } from './http';
import { generate, parseJson } from './client';
import { buddyPrompt, checkPrompt, draftPrompt, ideaPrompt, meaningsPrompt, quizPrompt, sceneActionText, simplifyPrompt } from './prompts';
import { easierLevels } from '../levels';
import { art } from './art';
import { checkLevel } from '../levels';
import type { Level } from '../levels';
import { ownProject } from '../projects';
import type { ProjectRow } from '../projects';
import { isRecord, validateSceneData } from '../validate';

// Session gate (index.ts) applies. Every endpoint: validate input -> key ->
// rate limit -> generate. Model failures surface as generic 502s.
export const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Scene art (4a): POST /api/ai/art + GET /api/ai/art/:key, same session gate.
ai.route('/art', art);

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
  const apiKey = modelKey(c.env);
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
      baseten: basetenConfig(c.env),
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
  const lang = 'en'; // Phase 5 adds per-book language; the table is ready.
  const chain = easierLevels(level);
  // 1. Dictionary first: exact level preferred, then easier levels.
  const inWords = words.map(() => '?').join(',');
  const inLevels = chain.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT word, level, gloss FROM definitions WHERE lang = ? AND word IN (${inWords}) AND level IN (${inLevels})`,
  )
    .bind(lang, ...words.map((w) => w.toLowerCase()), ...chain)
    .all<{ word: string; level: string; gloss: string }>();
  const rank = new Map(chain.map((l, i) => [l, i]));
  const cached = new Map<string, string>();
  for (const w of words) {
    const key = w.toLowerCase();
    let best: { level: string; gloss: string } | null = null;
    for (const r of rows.results ?? []) {
      if (r.word !== key) continue;
      if (best === null || (rank.get(r.level) ?? 99) < (rank.get(best.level) ?? 99)) best = r;
    }
    if (best) cached.set(w, best.gloss);
  }
  // 2. AI only for misses; quota and key checks apply to generation alone,
  // so fully cached reads cost no quota and need no model key.
  const missing = words.filter((w) => !cached.has(w));
  const fresh = new Map<string, string>();
  if (missing.length > 0) {
    const apiKey = modelKey(c.env);
    if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
    if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);
    const wordsList = missing.map((w, i) => `${i + 1}. ${w}`).join('\n');
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
        baseten: basetenConfig(c.env),
        validate: (t) => {
          const v = parseJson(t, isRecord);
          if (!v || !Array.isArray(v.meanings) || v.meanings.length !== missing.length) return false;
          return (v.meanings as unknown[]).every(
            (m, i) => isRecord(m) && m.word === missing[i] && typeof m.meaning === 'string',
          );
        },
      });
      const v = parseJson(text, isRecord) as { meanings: { word: string; meaning: string }[] };
      const now = new Date().toISOString();
      for (const m of v.meanings) {
        fresh.set(m.word, m.meaning);
        // Cache the fallback back into the dictionary. Verified on the
        // spot with the level gate (the word itself is allowed input), so
        // good fallback glosses graduate to verified immediately.
        const verified = checkLevel(m.meaning, level, [m.word]).passed ? 1 : 0;
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO definitions (word, level, lang, gloss, source, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .bind(m.word.toLowerCase(), level, lang, m.meaning, 'ai-fallback', verified, now)
          .run();
      }
    } catch (e) {
      if (e instanceof AiError) return c.json(FAILED, 502);
      throw e;
    }
  }
  return c.json({ meanings: words.map((w) => ({ word: w, meaning: cached.get(w) ?? fresh.get(w) ?? '' })) });

ai.post('/simplify', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.text !== 'string' || body.text === '' || body.text.length > 2000) {
    return c.json(INVALID, 400);
  }
  if (!isLevel(body.level)) return c.json(INVALID, 400);
  const apiKey = modelKey(c.env);
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
      baseten: basetenConfig(c.env),
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

// Quiz grounded in the book just read (Step 7): one cheap text call turns
// the project's scenes into 6 Movers-style questions at the book's level.
// Answers ship with the questions; scoring happens in the Reader.
ai.post('/quiz', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.projectId !== 'string' || body.projectId === '') {
    return c.json(INVALID, 400);
  }
  let wanted: number[] | null = null;
  if (body.sceneNumbers !== undefined) {
    if (
      !Array.isArray(body.sceneNumbers) ||
      body.sceneNumbers.length === 0 ||
      body.sceneNumbers.length > 6 ||
      !body.sceneNumbers.every(
        (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100,
      )
    ) {
      return c.json(INVALID, 400);
    }
    wanted = body.sceneNumbers as number[];
  }
  const project = await ownProject(c.env.DB, body.projectId, c.get('userId'));
  if (!project) return c.json({ error: 'not found' }, 404);
  if (!isLevel(project.level)) return c.json(INVALID, 400);
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);

  const db = c.env.DB;
  const { results: rows } = await db
    .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC')
    .bind(project.id)
    .all<{ scene_number: number; data_json: string }>();
  const scenes = rows
    .filter((r) => wanted === null || wanted.includes(r.scene_number))
    .slice(0, 6);
  if (scenes.length === 0) return c.json(INVALID, 400);
  const story = scenes
    .map((r) => {
      try {
        const parsed = validateSceneData(JSON.parse(r.data_json) as unknown);
        if (!parsed.ok) return '';
        return sceneActionText(parsed.value.narration, parsed.value.bubbles);
      } catch {
        return '';
      }
    })
    .filter((s) => s !== '')
    .join('\n\n')
    .slice(0, 3000);
  if (story === '') return c.json(INVALID, 400);

  try {
    const { text } = await generate(db, {
      apiKey,
      userId: c.get('userId'),
      projectId: project.id,
      opId: crypto.randomUUID(),
      task: 'quiz',
      prompt: quizPrompt(project.level as Level, story),
      json: true,
      apiUrl: c.env.AI_API_URL,
      validate: (t) => {
        const v = parseJson(t, isRecord);
        if (!v || !Array.isArray(v.questions)) return false;
        const qs = v.questions as unknown[];
        if (qs.length < 4 || qs.length > 8) return false;
        return qs.every((q) => {
          if (!isRecord(q)) return false;
          if (typeof q.prompt !== 'string' || q.prompt === '' || q.prompt.length > 300) return false;
          if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return false;
          if (!q.options.every((o: unknown) => typeof o === 'string' && o !== '' && o.length <= 100)) return false;
          if (typeof q.answer !== 'number' || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
            return false;
          }
          return typeof q.explanation === 'string' && q.explanation !== '' && q.explanation.length <= 300;
        });
      },
    });
    const v = parseJson(text, isRecord) as {
      questions: { prompt: string; options: string[]; answer: number; explanation: string }[];
    };
    return c.json({ questions: v.questions });
  } catch (e) {
    if (e instanceof AiError) return c.json(FAILED, 502);
    throw e;
  }
});

// Reading buddy (Step 7): Pip answers one learner question about the story.
// History rides along from the client (capped), the story comes from the DB,
// and the reply is sliced short so a chatty model cannot flood a child.
ai.post('/buddy', async (c) => {
  const body = await readJson(c);
  if (!isRecord(body) || typeof body.projectId !== 'string' || body.projectId === '') {
    return c.json(INVALID, 400);
  }
  const sceneNumber = body.sceneNumber ?? null;
  if (sceneNumber !== null && (typeof sceneNumber !== 'number' || !Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 100)) {
    return c.json(INVALID, 400);
  }
  if (typeof body.message !== 'string' || body.message.trim() === '' || body.message.length > 500) {
    return c.json(INVALID, 400);
  }
  const history = body.history ?? [];
  if (
    !Array.isArray(history) ||
    history.length > 10 ||
    !history.every(
      (t: unknown) =>
        isRecord(t) &&
        (t.role === 'learner' || t.role === 'pip') &&
        typeof t.text === 'string' &&
        t.text !== '' &&
        t.text.length <= 500,
    )
  ) {
    return c.json(INVALID, 400);
  }
  const project = await ownProject(c.env.DB, body.projectId, c.get('userId'));
  if (!project) return c.json({ error: 'not found' }, 404);
  if (!isLevel(project.level)) return c.json(INVALID, 400);
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);

  const db = c.env.DB;
  const { results: rows } = await db
    .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC')
    .bind(project.id)
    .all<{ scene_number: number; data_json: string }>();
  const scenes = rows.filter((r) => sceneNumber === null || r.scene_number === sceneNumber).slice(0, 6);
  if (scenes.length === 0) return c.json(INVALID, 400);
  const story = scenes
    .map((r) => {
      try {
        const parsed = validateSceneData(JSON.parse(r.data_json) as unknown);
        if (!parsed.ok) return '';
        return `Scene ${r.scene_number}: ${sceneActionText(parsed.value.narration, parsed.value.bubbles)}`;
      } catch {
        return '';
      }
    })
    .filter((s) => s !== '')
    .join('\n\n')
    .slice(0, 3000);
  if (story === '') return c.json(INVALID, 400);
  const historyText =
    (history as { role: string; text: string }[])
      .map((t) => `${t.role === 'pip' ? 'Pip' : 'Learner'}: ${t.text}`)
      .join('\n') || '(nothing yet)';

  try {
    const { text } = await generate(db, {
      apiKey,
      userId: c.get('userId'),
      projectId: project.id,
      opId: crypto.randomUUID(),
      task: 'buddy',
      prompt: buddyPrompt(project.level as Level, story, historyText, body.message.trim()),
      json: false,
      apiUrl: c.env.AI_API_URL,
    });
    return c.json({ reply: text.slice(0, 500) });
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
  ctx: { apiKey: string; userId: string; projectId: string; opId: string; apiUrl?: string; baseten?: BasetenConfig | null },
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
  const apiKey = modelKey(c.env);
  if (!apiKey) return c.json({ error: 'ai unavailable' }, 503);
  if (await overLimit(c.env.DB, c.get('userId'))) return c.json({ error: 'daily limit reached' }, 429);

  const db = c.env.DB;
  const userId = c.get('userId');
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const opId = crypto.randomUUID();
  const ctx = { apiKey, userId, projectId: project.id, opId, apiUrl: c.env.AI_API_URL, baseten: basetenConfig(c.env) };
  await db
    .prepare(
      "INSERT INTO jobs (id, user_id, project_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, 'finish', ?, 'running', ?, ?)",
    )
    .bind(jobId, userId, project.id, JSON.stringify({ projectId: project.id }), now, now)
    .run();

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
      await finishJob(db, jobId, 'complete', result, null);
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
      const story = sceneActionText(scene.narration, scene.bubbles);
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
    await finishJob(db, jobId, 'complete', result, null);
    return c.json({ job: { id: jobId, status: 'complete' }, ...result });
  } catch (e) {
    if (e instanceof AiError) {
      await finishJob(db, jobId, 'failed', null, 'ai failed');
      return c.json(FAILED, 502);
    }
    throw e;
  }
});
