// Modal adapter (serverless SAM isolate — the cost-efficient cutout path).
// The ONLY module that knows the Modal endpoint shape. Same ImageOut
// contract + AiError taxonomy as metaSegment, so generateMask() swaps
// cleanly. Set MODAL_API_URL to the deployed function URL and
// MODAL_PROXY_TOKEN to "<token-id>.ws-<secret>" (never logged).
//
// Contract with modal/sam.py: POST { image_b64, prompt } ->
// { mask_b64, content_type }. Tokens are 0 — Modal bills per-second GPU,
// not per token, so usage rows log $0 until PRICES covers modal.
import { AiError, b64ToBytes, bytesToB64 } from './meta';
import type { ImageOut } from './meta';
import type { ModalConfig } from './config';

const TIMEOUT_MS = 120_000;

export async function modalMask(
  cfg: ModalConfig,
  imageBytes: ArrayBuffer,
  textPrompt: string,
): Promise<ImageOut> {
  let res: Response;
  try {
    res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.proxyToken}` },
      body: JSON.stringify({ image_b64: bytesToB64(imageBytes), prompt: textPrompt }),
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
  const r = data as { mask_b64?: unknown; content_type?: unknown };
  if (typeof r.mask_b64 !== 'string') throw new AiError('model bad reply', false);
  return {
    bytes: b64ToBytes(r.mask_b64),
    contentType: typeof r.content_type === 'string' ? r.content_type : 'image/png',
    inputTokens: 0,
    outputTokens: 0,
  };
}
