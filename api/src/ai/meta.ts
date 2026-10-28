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

export interface ImageOut {
  bytes: ArrayBuffer;
  contentType: string;
  inputTokens: number;
  outputTokens: number;
}

// Image + segmentation paths/shapes are OpenAI-style defaults — UNCONFIRMED
// against the Model API docs (models.md), same as DEFAULT_PATH above.
// Override the whole URL per call via AI_API_URL.
const IMAGE_PATH = '/images/generations';
const SEGMENT_PATH = '/segmentations';
const IMAGE_TIMEOUT_MS = 120_000;

export function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

// SSRF guard: a vendor-returned image URL is fetched only over https from the
// same host that served the API call (the model CDN), never an arbitrary host.
function sameHost(requestUrl: string, target: string): boolean {
  try {
    const a = new URL(requestUrl);
    const b = new URL(target);
    return b.protocol === 'https:' && a.host === b.host;
  } catch {
    return false;
  }
}

async function fetchImageBytes(requestUrl: string, target: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!sameHost(requestUrl, target)) throw new AiError('model bad reply', false);
  let res: Response;
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  } catch {
    throw new AiError('model unreachable', true);
  }
  if (!res.ok) throw new AiError(`model error ${res.status}`, true);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) throw new AiError('model bad reply', false);
  return { bytes: await res.arrayBuffer(), contentType };
}

function readUsage(data: unknown): { inputTokens: number; outputTokens: number } {
  const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })?.usage;
  return {
    inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
  };
}

function firstData(data: unknown): Record<string, unknown> | null {
  const list = (data as { data?: unknown })?.data;
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
}

export async function metaImage(
  apiKey: string,
  model: string,
  prompt: string,
  opts: { size?: { width: number; height: number }; referenceImage?: string; apiUrl?: string },
): Promise<ImageOut> {
  const url = opts.apiUrl ?? `${BASE_URL}${IMAGE_PATH}`;
  const body: Record<string, unknown> = { model, prompt };
  if (opts.size) body.size = `${opts.size.width}x${opts.size.height}`;
  if (opts.referenceImage) body.reference_image = opts.referenceImage;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
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
  const item = firstData(data);
  const b64 = typeof item?.b64_json === 'string' ? (item.b64_json as string) : null;
  if (b64) {
    const { inputTokens, outputTokens } = readUsage(data);
    return { bytes: b64ToBytes(b64), contentType: 'image/png', inputTokens, outputTokens };
  }
  const imageUrl = typeof item?.url === 'string' ? (item.url as string) : null;
  if (imageUrl) {
    const { inputTokens, outputTokens } = readUsage(data);
    const { bytes, contentType } = await fetchImageBytes(url, imageUrl);
    return { bytes, contentType, inputTokens, outputTokens };
  }
  throw new AiError('model bad reply', false);
}

export async function metaSegment(
  apiKey: string,
  model: string,
  input: { imageUrl?: string; imageBytes?: ArrayBuffer },
  textPrompt: string,
  opts: { apiUrl?: string },
): Promise<ImageOut> {
  const url = opts.apiUrl ?? `${BASE_URL}${SEGMENT_PATH}`;
  const modelInput: Record<string, unknown> = {
    prompts: [{ type: 'text', value: textPrompt }],
  };
  if (input.imageBytes) modelInput.image_b64 = bytesToB64(input.imageBytes);
  else if (input.imageUrl) modelInput.image_url = input.imageUrl;
  else throw new AiError('model bad reply', false);
  const body: Record<string, unknown> = {
    model,
    input: modelInput,
    output_format: 'transparent_png_mask',
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
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
  const rec = data as Record<string, unknown>;
  const maskB64 = typeof rec.mask_b64 === 'string' ? (rec.mask_b64 as string) : null;
  const { inputTokens, outputTokens } = readUsage(data);
  if (maskB64) {
    return { bytes: b64ToBytes(maskB64), contentType: 'image/png', inputTokens, outputTokens };
  }
  const item = firstData(data);
  const itemB64 = typeof item?.b64_json === 'string' ? (item.b64_json as string) : null;
  if (itemB64) {
    return { bytes: b64ToBytes(itemB64), contentType: 'image/png', inputTokens, outputTokens };
  }
  const maskUrl =
    typeof rec.mask_url === 'string'
      ? (rec.mask_url as string)
      : typeof item?.url === 'string'
        ? (item.url as string)
        : null;
  if (maskUrl) {
    const { bytes, contentType } = await fetchImageBytes(url, maskUrl);
    return { bytes, contentType, inputTokens, outputTokens };
  }
  throw new AiError('model bad reply', false);
}
