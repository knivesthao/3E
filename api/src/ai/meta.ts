// Meta Model API adapter — the ONLY module that knows the vendor's URL,
// auth scheme, and request/response shapes. Everything else talks to the
// TextModel interface. Model IDs arrive as arguments (owned by config).

export interface TextOut {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// Retryable (network/timeout/5xx/429) vs fatal (4xx, bad shape). App-level
// retry keys off this — never vendor status codes.
export class AiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const BASE_URL = 'https://api.meta.ai/v1';
// Endpoint path/shape are OpenAI-style defaults — UNCONFIRMED against the
// Model API docs (models.md). Override the whole URL via AI_API_URL.
const DEFAULT_PATH = '/chat/completions';
const TIMEOUT_MS = 30_000;

export async function metaText(
  apiKey: string,
  model: string,
  prompt: string,
  opts: { json?: boolean; apiUrl?: string },
): Promise<TextOut> {
  const url = opts.apiUrl ?? `${BASE_URL}${DEFAULT_PATH}`;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
