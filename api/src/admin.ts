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
