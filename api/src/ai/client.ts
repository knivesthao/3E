import type { D1Database } from '@cloudflare/workers-types';
import { TASK_MODEL, textCost } from './config';
import type { AiTask } from './config';
import { AiError, metaText } from './meta';

// Metered generation: every attempt is a row (retry reuses op_id, attempt+1).
// Exactly one retry on retryable errors or invalid JSON, then surface.
export async function generate(
  db: D1Database,
  opts: {
    apiKey: string;
    userId: string;
    projectId: string | null;
    opId: string;
    task: AiTask;
    prompt: string;
    json: boolean;
    apiUrl?: string;
    validate?: (text: string) => boolean;
  },
): Promise<{ text: string; attempts: number }> {
  const model = TASK_MODEL[opts.task];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now();
    try {
      const out = await metaText(opts.apiKey, model, opts.prompt, { json: opts.json, apiUrl: opts.apiUrl });
      const ms = Date.now() - start;
      if (opts.validate && !opts.validate(out.text)) {
        // Tokens were spent on an unusable reply: log it, retry same op_id.
        await logAttempt(db, opts, model, attempt, out.inputTokens, out.outputTokens, false, 'invalid shape', ms);
        if (attempt === 2) break;
        continue;
      }
      await logAttempt(db, opts, model, attempt, out.inputTokens, out.outputTokens, true, null, ms);
      return { text: out.text, attempts: attempt };
    } catch (e) {
      const retryable = e instanceof AiError && e.retryable;
      await logAttempt(db, opts, model, attempt, 0, 0, false, e instanceof Error ? e.message : 'failed', Date.now() - start);
      if (!retryable || attempt === 2) break;
    }
  }
  throw new AiError(`ai ${opts.task} failed`, false);
}

async function logAttempt(
  db: D1Database,
  opts: { userId: string; projectId: string | null; opId: string; task: AiTask },
  model: string,
  attempt: number,
  inputTokens: number,
  outputTokens: number,
  ok: boolean,
  error: string | null,
  ms: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO ai_usage (project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      opts.projectId,
      opts.userId,
      opts.opId,
      attempt,
      opts.task,
      'meta-model-api',
      model,
      'text',
      inputTokens,
      outputTokens,
      textCost(model, inputTokens, outputTokens),
      ms,
      ok ? 1 : 0,
      error,
      new Date().toISOString(),
    )
    .run();
}

export function parseJson<T>(text: string, check: (v: unknown) => v is T): T | null {
  let v: unknown;
  try {
    v = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return check(v) ? v : null;
}
