// Task -> model routing and per-model prices. Swapping a model = change this
// file + (for a new vendor) one adapter. Model IDs live ONLY here (never in
// app code) per the service-decoupling rules.

// Default prices are 0 until confirmed from Meta's pricing page (models.md).
// Costs log as $0 until then — the ledger shape is what matters now.
export const PRICES: Record<string, { in: number; out: number }> = {
  'muse-spark-1.3': { in: 0, out: 0 },
  'muse-wonder-1.0': { in: 0, out: 0 },
};

export const TEXT_MODEL = 'muse-spark-1.3';
export const HARD_MODEL = 'muse-wonder-1.0';

export type AiTask = 'draft' | 'check' | 'idea' | 'meanings' | 'simplify' | 'safety';

export const TASK_MODEL: Record<AiTask, string> = {
  draft: TEXT_MODEL,
  check: TEXT_MODEL,
  idea: TEXT_MODEL,
  meanings: TEXT_MODEL,
  simplify: TEXT_MODEL,
  safety: TEXT_MODEL,
};

// Per-user daily cap across AI endpoints (Step 3 + secure-coding rules).
export const DAILY_AI_LIMIT = 50;

export function textCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? { in: 0, out: 0 };
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
