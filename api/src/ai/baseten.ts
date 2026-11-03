// Baseten adapter (self-hosted open-weight path, PLAN §Self-hosting) — the
// ONLY module that knows the Baseten deployment URL shape. Same TextOut
// contract + AiError taxonomy as metaText, so generate() swaps cleanly.
//
// Assumes the deployment exposes an OpenAI-compatible chat endpoint; set
// BASETEN_API_URL to that full URL. If the deployment only serves the custom
// /predict shape, adapt JUST this file — nothing else changes.
import { AiError } from './meta';
import type { TextOut } from './meta';

const TIMEOUT_MS = 30_000;

export async function basetenText(
  cfg: { apiUrl: string; apiKey: string; model: string },
  prompt: string,
  opts: { json?: boolean },
): Promise<TextOut> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: 'user', content: prompt }],
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  let res: Response;
  try {
    res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AiError('model unreachable', true);
  }
  if (res.status === 429 || res.status >= 500) throw new AiError(`model error ${res.status}`, true);
  if (!res.ok) throw new AiError(`model error ${res.status}`, false);
  let data: unknown;
  try {
    data = (await res.json()) as unknown;
  } catch {
    throw new AiError('model bad reply', false);
  }
  const text =
    typeof (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message
      ?.content === 'string'
      ? ((data as { choices: { message: { content: string } }[] }).choices[0].message.content as string)
      : null;
  if (text === null) throw new AiError('model bad reply', false);
  const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  return { text, inputTokens, outputTokens };
}
