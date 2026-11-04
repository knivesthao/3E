import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import {
  BASETEN_TASKS,
  DAILY_AI_LIMIT,
  GLIMMER_MODEL,
  HARD_MODEL,
  IMAGE_MODEL,
  SEGMENT_MODEL,
  TEXT_MODEL,
} from './ai/config';
import type { Level } from './levels';
import { isHskLevel } from './hsk';
import type { HskLevel } from './hsk';
import { isRecord } from './validate';
import { requireRole } from './roles';

// Local narrow guard (routes.ts and validate.ts each carry their own).
const isLevel = (v: unknown): v is Level =>
  v === 'A1' || v === 'A2' || v === 'B1' || v === 'B2' || v === 'C1' || v === 'C2';

// Admin overview (Specs + Content tabs). Session-gated by index.ts like
// every other /api/* route. Aggregate counts only — no PII, and never
// any secret material: Baseten wiring is reported as a boolean. Every route
// below is additionally admin-only (per-route, so the separately mounted
// /api/admin/costs router keeps its own creator/admin rules). The UserMenu
// link is hidden for other roles, but the gate that matters lives here.
export const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const ADMIN_ONLY: readonly ['admin'] = ['admin'];

admin.get('/specs', (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  return c.json({
    models: {
      text: TEXT_MODEL,
      hard: HARD_MODEL,
      image: IMAGE_MODEL,
      segment: SEGMENT_MODEL,
      glimmer: GLIMMER_MODEL,
    },
    basetenTasks: BASETEN_TASKS,
    basetenConfigured: !!c.env.BASETEN_API_URL && !!c.env.BASETEN_API_KEY,
    dailyAiLimit: DAILY_AI_LIMIT,
  });
});

// Per-item exam stats: attempts + correct per question id, parsed from
// stored answer JSON (supports both the legacy answers-only shape and
// the current form+answers shape). Drives bank rotation decisions.
admin.get('/exam-items', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  const { results } = await c.env.DB.prepare('SELECT answers_json FROM exam_attempts').all<{
    answers_json: string;
  }>();
  const seen = new Map<string, { attempts: number; correct: number }>();
  const mark = (id: string, correct: boolean) => {
    const cur = seen.get(id) ?? { attempts: 0, correct: 0 };
    cur.attempts += 1;
    if (correct) cur.correct += 1;
    seen.set(id, cur);
  };
  for (const row of results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.answers_json) as unknown;
    } catch {
      continue;
    }
    // Current shape stores the graded review; legacy rows stored raw
    // answers only (counted as exposure, correctness unknown).
    const stored = (Array.isArray(parsed) ? {} : parsed) as {
      review?: { id?: unknown; correct?: unknown }[];
      answers?: unknown;
    };
    if (Array.isArray(stored.review)) {
      for (const r of stored.review) {
        if (typeof r.id === 'string') mark(r.id, r.correct === true);
      }
      continue;
    }
    const answers = (Array.isArray(parsed) ? parsed : stored.answers) as unknown;
    if (!Array.isArray(answers)) continue;
    for (const a of answers) {
      if (typeof a === 'object' && a !== null && typeof (a as { id?: unknown }).id === 'string') {
        const cur = seen.get((a as { id: string }).id) ?? { attempts: 0, correct: 0 };
        cur.attempts += 1;
        seen.set((a as { id: string }).id, cur);
      }
    }
  }
  return c.json({
    items: [...seen.entries()].map(([id, s]) => ({
      id,
      attempts: s.attempts,
      correct: s.correct,
      pct: s.attempts === 0 ? null : Math.round((s.correct / s.attempts) * 100),
    })),
  });
});

admin.get('/stats', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  const db = c.env.DB;
  const counts: Record<string, number> = {};
  for (const table of ['users', 'projects', 'scenes', 'panels', 'jobs', 'ai_usage'] as const) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .first<{ n: number }>();
    counts[table] = row?.n ?? 0;
  }
  // Books live in the library store, counted separately.
  const brow = await c.env.LIBRARY_DB.prepare('SELECT COUNT(*) AS n FROM books').first<{ n: number }>();
  counts.books = brow?.n ?? 0;
  return c.json({ counts });
});

// Dictionary seed writes (Phase 1): bulk upsert of generated glosses.
// DEV ONLY — the seed script runs against the local worker. On any other
// env this route does not exist (404), so a leaked session can never rewrite
// the dictionary. INSERT OR IGNORE keeps reseeds idempotent: existing rows
// (hand-fixed or already verified) always win over the incoming batch.
admin.post('/definitions', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  if (c.env.DEV_LINKS !== 'true') return c.json({ error: 'not found' }, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body) || !Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 200) {
    return c.json({ error: 'invalid request' }, 400);
  }
  const lang =
    typeof body.lang === 'string' && /^[a-z]{2,5}$/.test(body.lang) ? body.lang : 'en';
  const now = new Date().toISOString();
  let received = 0;
  for (const r of body.rows as unknown[]) {
    if (!isRecord(r) || typeof r.word !== 'string' || typeof r.gloss !== 'string') continue;
    const word = r.word.trim().toLowerCase();
    const gloss = r.gloss.trim();
    if (word === '' || word.length > 50 || gloss === '' || gloss.length > 500) continue;
    if (!isLevel(r.level) && !isHskLevel(r.level)) continue;
    const level = r.level as Level | HskLevel;
    const verified = r.verified === 1 || r.verified === true ? 1 : 0;
    const source = typeof r.source === 'string' && r.source !== '' ? r.source.slice(0, 20) : 'baseten';
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO definitions (word, level, lang, gloss, source, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(word, level, lang, gloss, source, verified, now)
      .run();
    received++;
  }
  return c.json({ ok: true, received });
});

// Seed job ledger (DEV ONLY, same guard as /definitions above): which
// dictionary scopes ran, what finished, what missed. The seeder heartbeats
// here per chunk and finalizes at the end; reruns resume from
// level-words MINUS definitions present, so nothing regenerates.
function seedScope(levels: string[], shard: string): string {
  return `${[...levels].sort().join(',')}@${shard || 'full'}`;
}

admin.post('/seed-jobs', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  if (c.env.DEV_LINKS !== 'true') return c.json({ error: 'not found' }, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body) || !Array.isArray(body.levels) || body.levels.length === 0) {
    return c.json({ error: 'invalid request' }, 400);
  }
  const levels = body.levels.filter((l): l is Level => isLevel(l));
  if (levels.length === 0) return c.json({ error: 'invalid request' }, 400);
  const shard = typeof body.shard === 'string' && /^(\d+\/\d+)?$/.test(body.shard) ? body.shard : '';
  const status =
    body.status === 'done' || body.status === 'failed' ? body.status : ('running' as const);
  const total = typeof body.total === 'number' && body.total >= 0 ? Math.floor(body.total) : 0;
  const done = typeof body.done === 'number' && body.done >= 0 ? Math.floor(body.done) : 0;
  const missed = Array.isArray(body.missed)
    ? body.missed.filter((m): m is string => typeof m === 'string').slice(0, 500)
    : [];
  const error = typeof body.error === 'string' ? body.error.slice(0, 500) : null;
  const runUrl =
    typeof body.run_url === 'string' && body.run_url.startsWith('https://') ? body.run_url.slice(0, 300) : null;
  const now = new Date().toISOString();
  const scope = seedScope(levels, shard);
  await c.env.DB.prepare(
    `INSERT INTO seed_jobs (id, scope, levels, shard, status, total, done, missed_json, error, run_url, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET status=excluded.status, total=excluded.total, done=excluded.done,
       missed_json=excluded.missed_json, error=excluded.error, run_url=excluded.run_url, updated_at=excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(), scope, levels.join(','), shard, status, total, done,
      JSON.stringify(missed), error, runUrl, now, now,
    )
    .run();
  return c.json({ ok: true, scope });
});

admin.get('/seed-jobs', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  if (c.env.DEV_LINKS !== 'true') return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT scope, levels, shard, status, total, done, missed_json, error, run_url, started_at, updated_at FROM seed_jobs ORDER BY updated_at DESC LIMIT 50',
  ).all<{
    scope: string; levels: string; shard: string; status: string; total: number; done: number;
    missed_json: string; error: string | null; run_url: string | null; started_at: string; updated_at: string;
  }>();
  return c.json({
    jobs: results.map((r) => {
      let missed: string[] = [];
      try {
        const v = JSON.parse(r.missed_json) as unknown;
        if (Array.isArray(v)) missed = v.filter((m): m is string => typeof m === 'string');
      } catch { /* corrupt ledger row reads as no misses */ }
      const { missed_json: _drop, ...rest } = r;
      return { ...rest, missed };
    }),
  });
});

// Resume source of truth: words already defined for these levels, so a rerun
// (or a lost progress file) only generates what's actually missing.
admin.get('/done-words', async (c) => {
  const denied = requireRole(c, ADMIN_ONLY);
  if (denied) return denied;
  if (c.env.DEV_LINKS !== 'true') return c.json({ error: 'not found' }, 404);
  const levels = (c.req.query('levels') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(isLevel);
  if (levels.length === 0) return c.json({ error: 'invalid request' }, 400);
  const placeholders = levels.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT word, level FROM definitions WHERE level IN (${placeholders})`,
  )
    .bind(...levels)
    .all<{ word: string; level: string }>();
  return c.json({ done: results.map((r) => `${r.level}|${r.word}`) });
});
