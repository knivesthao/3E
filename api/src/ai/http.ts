import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { CONSECUTIVE_FAIL_LIMIT, DAILY_AI_LIMIT } from './config';

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

export type LimitReason = 'daily' | 'paused';

// Self-healing stop: pause a caller whose recent attempts keep failing,
// instead of capping healthy volume. A single success anywhere in the
// streak resets it, so transient blips (deploy, proxy) ride through while
// a truly broken loop stops after pocket change. The daily count is only
// a disaster backstop and never binds legitimate use.
export async function overLimit(db: D1Database, userId: string): Promise<LimitReason | null> {
  const day = await db
    .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND date(created_at) = date('now')")
    .bind(userId)
    .first<{ n: number }>();
  if ((day?.n ?? 0) >= DAILY_AI_LIMIT) return 'daily';
  // CONSECUTIVE_FAIL_LIMIT is a code constant, never user input.
  const recent = await db
    .prepare(`SELECT ok FROM ai_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT ${CONSECUTIVE_FAIL_LIMIT}`)
    .bind(userId)
    .all<{ ok: number }>();
  const rows = recent.results ?? [];
  if (rows.length >= CONSECUTIVE_FAIL_LIMIT && rows.every((r) => r.ok === 0)) return 'paused';
  return null;
}

// 429 body for a stopped caller, or null when the call may proceed.
export async function limitCheck(db: D1Database, userId: string): Promise<{ error: string } | null> {
  const reason = await overLimit(db, userId);
  if (!reason) return null;
  return { error: reason === 'paused' ? 'paused after repeated failures' : 'daily limit reached' };
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
