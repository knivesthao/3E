import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { ownProject } from './projects';
import { requireRole } from './roles';

// Admin cost ledger (Step 5a) — the §Cost & usage tracking queries over
// ai_usage. Session-gated by index.ts like every other /api/* route;
// the per-book summary is additionally owner-only.
export const costs = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const NOT_FOUND = { error: 'not found' } as const;
const INVALID = { error: 'invalid request' } as const;

costs.get('/book', async (c) => {
  const denied = requireRole(c, ['creator', 'admin']);
  if (denied) return denied;
  const projectId = c.req.query('projectId') ?? '';
  if (projectId === '' || projectId.length > 100) return c.json(INVALID, 400);
  const project = await ownProject(c.env.DB, projectId, c.get('userId'));
  if (!project) return c.json(NOT_FOUND, 404);
  const db = c.env.DB;

  const totals = await db
    .prepare(
      `SELECT SUM(cost_usd) AS total,
              SUM(CASE WHEN attempt = 1 THEN cost_usd END) AS first_try_cost,
              SUM(CASE WHEN attempt > 1 THEN cost_usd END) AS retry_overhead
       FROM ai_usage WHERE project_id = ?`,
    )
    .bind(project.id)
    .first<{ total: number | null; first_try_cost: number | null; retry_overhead: number | null }>();

  const byTask = await db
    .prepare(
      `SELECT task, SUM(cost_usd) AS cost, COUNT(*) AS calls,
              SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out,
              AVG(ms) AS avg_ms, MAX(ms) AS max_ms
       FROM ai_usage WHERE project_id = ? GROUP BY task ORDER BY cost DESC`,
    )
    .bind(project.id)
    .all();

  const byModel = await db
    .prepare(
      `SELECT model, SUM(cost_usd) AS cost, COUNT(*) AS calls,
              SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out,
              AVG(ms) AS avg_ms, MAX(ms) AS max_ms
       FROM ai_usage WHERE project_id = ? GROUP BY model ORDER BY cost DESC`,
    )
    .bind(project.id)
    .all();

  const retries = await db
    .prepare(
      `SELECT model, task, COUNT(*) AS retries, MAX(attempt) AS max_attempt
       FROM ai_usage WHERE project_id = ? AND attempt > 1 GROUP BY model, task ORDER BY retries DESC`,
    )
    .bind(project.id)
    .all();

  const attempts = await db
    .prepare(
      `SELECT op_id, attempt, task, provider, model, input_tokens, output_tokens,
              cost_usd, ms, ok, error, created_at
       FROM ai_usage WHERE project_id = ? ORDER BY created_at`,
    )
    .bind(project.id)
    .all();

  return c.json({
    totals: {
      total: totals?.total ?? 0,
      first_try_cost: totals?.first_try_cost ?? 0,
      retry_overhead: totals?.retry_overhead ?? 0,
    },
    by_task: byTask.results,
    by_model: byModel.results,
    retries: retries.results,
    attempts: attempts.results,
  });
});

costs.get('/overview', async (c) => {
  const denied = requireRole(c, ['admin']);
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT user_id, strftime('%Y-%m', created_at) AS month, SUM(cost_usd) AS cost
     FROM ai_usage GROUP BY user_id, month ORDER BY month DESC`,
  ).all();
  // Book-attributable spend by CEFR level (joins the draft's project).
  // Project-less calls (dictionary lookups without a book) stay only in
  // the per-user totals — the graph filters book spend.
  const levels = await c.env.DB.prepare(
    `SELECT p.level AS level, strftime('%Y-%m', u.created_at) AS month, SUM(u.cost_usd) AS cost
     FROM ai_usage u JOIN projects p ON p.id = u.project_id
     WHERE u.project_id IS NOT NULL AND u.project_id != ''
     GROUP BY p.level, month ORDER BY month DESC`,
  ).all();
  // Same series at day grain for the line graphs.
  const days = await c.env.DB.prepare(
    `SELECT p.level AS level, strftime('%Y-%m-%d', u.created_at) AS day, SUM(u.cost_usd) AS cost
     FROM ai_usage u JOIN projects p ON p.id = u.project_id
     WHERE u.project_id IS NOT NULL AND u.project_id != ''
     GROUP BY p.level, day ORDER BY day DESC`,
  ).all();
  return c.json({ by_user_month: rows.results, by_level_month: levels.results, by_level_day: days.results });
});
