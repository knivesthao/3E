import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { DAILY_AI_LIMIT } from './config';

// Shared AI-route helpers (single copies — routes.ts and art.ts both use them).
export const INVALID = { error: 'invalid request' } as const;
export const FAILED = { error: 'ai failed' } as const;

export function modelKey(env: Bindings): string | null {
  return env.MODEL_API_KEY ?? null;
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

export async function overLimit(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND date(created_at) = date('now')")
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= DAILY_AI_LIMIT;
}

export async function finishJob(
  db: D1Database,
  jobId: string,
  status: string,
  result: unknown,
  error: string | null,
): Promise<void> {
  const stamp = new Date().toISOString();
  await db
    .prepare('UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?')
    .bind(status, result === null ? null : JSON.stringify(result), error, stamp, jobId)
    .run();
}
