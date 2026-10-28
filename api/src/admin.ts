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

// Admin overview (Specs + Content tabs). Session-gated by index.ts like
// every other /api/* route. Aggregate counts only — no PII, and never
// any secret material: Baseten wiring is reported as a boolean.
export const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

admin.get('/specs', (c) => {
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
  const db = c.env.DB;
  const counts: Record<string, number> = {};
  for (const table of ['users', 'projects', 'scenes', 'books', 'panels', 'jobs', 'ai_usage'] as const) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .first<{ n: number }>();
    counts[table] = row?.n ?? 0;
  }
  return c.json({ counts });
});
