import type { D1Database } from '@cloudflare/workers-types';
import { BASETEN_TASKS, TASK_MODEL, textCost } from './config';
import type { AiTask, BasetenConfig, ModalConfig } from './config';
import { AiError, metaImage, metaSegment, metaText } from './meta';
import type { ImageOut } from './meta';
import { basetenText } from './baseten';
import { modalMask } from './modal';

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
    baseten?: BasetenConfig | null;
    validate?: (text: string) => boolean;
  },
): Promise<{ text: string; attempts: number }> {
  const model = TASK_MODEL[opts.task];
  // Self-hosted path (PLAN §Self-hosting): Glimmer on Baseten takes the text
  // tasks when configured; otherwise everything stays on the Meta Model API.
  const bt = opts.baseten && BASETEN_TASKS.includes(opts.task) ? opts.baseten : null;
  const activeModel = bt ? bt.model : model;
  const provider = bt ? 'baseten' : 'meta-model-api';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now();
    try {
      const out = bt
        ? await basetenText(bt, opts.prompt, { json: opts.json })
        : await metaText(opts.apiKey, model, opts.prompt, { json: opts.json, apiUrl: opts.apiUrl });
      const ms = Date.now() - start;
      if (opts.validate && !opts.validate(out.text)) {
        // Tokens were spent on an unusable reply: log it, retry same op_id.
        await logAttempt(db, opts, activeModel, 'text', attempt, out.inputTokens, out.outputTokens, false, 'invalid shape', ms, provider);
        if (attempt === 2) break;
        continue;
      }
      await logAttempt(db, opts, activeModel, 'text', attempt, out.inputTokens, out.outputTokens, true, null, ms, provider);
      return { text: out.text, attempts: attempt };
    } catch (e) {
      const retryable = e instanceof AiError && e.retryable;
      await logAttempt(db, opts, activeModel, 'text', attempt, 0, 0, false, e instanceof Error ? e.message : 'failed', Date.now() - start, provider);
      if (!retryable || attempt === 2) break;
    }
  }
  throw new AiError(`ai ${opts.task} failed`, false);
}

// Metered image generation (task 'art', kind 'image'). Same op_id/attempt
// ledger as text; a reply with no usable bytes retries once like bad JSON.
export async function generateArt(
  db: D1Database,
  opts: {
    apiKey: string;
    userId: string;
    projectId: string | null;
    opId: string;
    prompt: string;
    size?: { width: number; height: number };
    referenceImage?: string;
    apiUrl?: string;
  },
): Promise<{ bytes: ArrayBuffer; contentType: string; attempts: number }> {
  const model = TASK_MODEL.art;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now();
    try {
      const out = await metaImage(opts.apiKey, model, opts.prompt, {
        size: opts.size,
        referenceImage: opts.referenceImage,
        apiUrl: opts.apiUrl,
      });
      const ms = Date.now() - start;
      if (out.bytes.byteLength === 0 || !out.contentType.startsWith('image/')) {
        await logAttempt(db, { ...opts, task: 'art' }, model, 'image', attempt, out.inputTokens, out.outputTokens, false, 'invalid shape', ms);
        if (attempt === 2) break;
        continue;
      }
      await logAttempt(db, { ...opts, task: 'art' }, model, 'image', attempt, out.inputTokens, out.outputTokens, true, null, ms);
      return { bytes: out.bytes, contentType: out.contentType, attempts: attempt };
    } catch (e) {
      const retryable = e instanceof AiError && e.retryable;
      await logAttempt(db, { ...opts, task: 'art' }, model, 'image', attempt, 0, 0, false, e instanceof Error ? e.message : 'failed', Date.now() - start);
      if (!retryable || attempt === 2) break;
    }
  }
  throw new AiError('ai art failed', false);
}

// Metered character isolation (task 'isolate', kind 'segment'). Panel bytes
// go up as base64 — SAM cannot reach our localhost R2 URLs from dev.
export async function generateMask(
  db: D1Database,
  opts: {
    apiKey: string;
    userId: string;
    projectId: string | null;
    opId: string;
    imageBytes: ArrayBuffer;
    textPrompt: string;
    apiUrl?: string;
    modal?: ModalConfig | null;
  },
): Promise<{ bytes: ArrayBuffer; contentType: string; attempts: number }> {
  const model = TASK_MODEL.isolate;
  // Cost-efficient path: text-prompted SAM on Modal (per-second GPU,
  // scale-to-zero) when configured; otherwise Meta Model API.
  const useModal = !!opts.modal;
  const activeModel = useModal ? 'modal/sam-3.1' : model;
  const provider = useModal ? 'modal' : 'meta-model-api';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now();
    try {
      const out: ImageOut = useModal
        ? await modalMask(opts.modal as ModalConfig, opts.imageBytes, opts.textPrompt)
        : await metaSegment(
            opts.apiKey,
            model,
            { imageBytes: opts.imageBytes },
            opts.textPrompt,
            { apiUrl: opts.apiUrl },
          );
      const ms = Date.now() - start;
      if (out.bytes.byteLength === 0 || !out.contentType.startsWith('image/')) {
        await logAttempt(db, { ...opts, task: 'isolate' }, activeModel, 'segment', attempt, out.inputTokens, out.outputTokens, false, 'invalid shape', ms, provider);
        if (attempt === 2) break;
        continue;
      }
      await logAttempt(db, { ...opts, task: 'isolate' }, activeModel, 'segment', attempt, out.inputTokens, out.outputTokens, true, null, ms, provider);
      return { bytes: out.bytes, contentType: out.contentType, attempts: attempt };
    } catch (e) {
      const retryable = e instanceof AiError && e.retryable;
      await logAttempt(db, { ...opts, task: 'isolate' }, activeModel, 'segment', attempt, 0, 0, false, e instanceof Error ? e.message : 'failed', Date.now() - start, provider);
      if (!retryable || attempt === 2) break;
    }
  }
  throw new AiError('ai isolate failed', false);
}

async function logAttempt(
  db: D1Database,
  opts: { userId: string; projectId: string | null; opId: string; task: AiTask },
  model: string,
  kind: 'text' | 'image' | 'segment',
  attempt: number,
  inputTokens: number,
  outputTokens: number,
  ok: boolean,
  error: string | null,
  ms: number,
  provider = 'meta-model-api',
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
      provider,
      model,
      kind,
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
