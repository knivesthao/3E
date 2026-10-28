// Task -> model routing and per-model prices. Swapping a model = change this
// file + (for a new vendor) one adapter. Model IDs live ONLY here (never in
// app code) per the service-decoupling rules.

// Default prices are 0 until confirmed from Meta's pricing page (models.md).
// Costs log as $0 until then — the ledger shape is what matters now.
export const PRICES: Record<string, { in: number; out: number }> = {
  'muse-spark-1.3': { in: 0, out: 0 },
  'muse-wonder-1.0': { in: 0, out: 0 },
  'muse-image-1.0': { in: 0, out: 0 },
  'sam-3.1': { in: 0, out: 0 },
  // Self-hosted Glimmer via Baseten (own credits) — fill when known.
  'meta-models/Muse-Glimmer-30B': { in: 0, out: 0 },
};

export const TEXT_MODEL = 'muse-spark-1.3';
export const HARD_MODEL = 'muse-wonder-1.0';
export const IMAGE_MODEL = 'muse-image-1.0';
export const SEGMENT_MODEL = 'sam-3.1';
// Open-weight text model served on Baseten (slug verified against
// baseten.co/library/muse-glimmer-30b). Override without a code change via
// BASETEN_MODEL if the deployment uses another name.
export const GLIMMER_MODEL = 'meta-models/Muse-Glimmer-30B';

// Text tasks served by Glimmer when Baseten is configured (PLAN
// §Self-hosting). Art/segment stay on the Meta Model API.
export const BASETEN_TASKS: AiTask[] = ['draft', 'check', 'idea', 'meanings', 'simplify', 'safety'];

export interface BasetenConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

// Null when Baseten is not configured — callers fall back to Meta API.
export function basetenConfig(env: {
  BASETEN_API_URL?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
}): BasetenConfig | null {
  if (!env.BASETEN_API_URL || !env.BASETEN_API_KEY) return null;
  return { apiUrl: env.BASETEN_API_URL, apiKey: env.BASETEN_API_KEY, model: env.BASETEN_MODEL ?? GLIMMER_MODEL };
}

export interface ModalConfig {
  apiUrl: string;
  proxyToken: string;
}

// Null when Modal is not configured — callers fall back to Meta API.
// Off by default: enable only when per-cutout Modal spend beats Meta.
export function modalConfig(env: {
  MODAL_API_URL?: string;
  MODAL_PROXY_TOKEN?: string;
}): ModalConfig | null {
  if (!env.MODAL_API_URL || !env.MODAL_PROXY_TOKEN) return null;
  return { apiUrl: env.MODAL_API_URL, proxyToken: env.MODAL_PROXY_TOKEN };
}

export type AiTask = 'draft' | 'check' | 'idea' | 'meanings' | 'simplify' | 'safety' | 'art' | 'isolate';

export const TASK_MODEL: Record<AiTask, string> = {
  draft: TEXT_MODEL,
  check: TEXT_MODEL,
  idea: TEXT_MODEL,
  meanings: TEXT_MODEL,
  simplify: TEXT_MODEL,
  safety: TEXT_MODEL,
  art: IMAGE_MODEL,
  isolate: SEGMENT_MODEL,
};

// Per-user daily cap across AI endpoints (Step 3 + secure-coding rules).
export const DAILY_AI_LIMIT = 50;

export function textCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? { in: 0, out: 0 };
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
