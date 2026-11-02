import { afterEach, describe, expect, it } from 'vitest';
import { modalConfig } from './config';
import { modalImage, modalMask } from './modal';
import { AiError } from './meta';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, payload: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

const CFG = { apiUrl: 'https://example.modal.run/isolate', proxyToken: 'id.ws-secret' };
const PNG = new Uint8Array([1, 2, 3]).buffer;

describe('modalConfig (parked by default)', () => {
  it('returns null unless URL and token are both set', () => {
    expect(modalConfig({})).toBeNull();
    expect(modalConfig({ MODAL_API_URL: CFG.apiUrl })).toBeNull();
    expect(modalConfig({ MODAL_PROXY_TOKEN: CFG.proxyToken })).toBeNull();
  });

  it('passes the endpoint through untouched', () => {
    expect(modalConfig({ MODAL_API_URL: CFG.apiUrl, MODAL_PROXY_TOKEN: CFG.proxyToken })).toEqual({
      apiUrl: CFG.apiUrl,
      proxyToken: CFG.proxyToken,
      imageApiUrl: undefined,
    });
  });

  it('accepts image-only linkage (SAM stays on Meta)', () => {
    const cfg = modalConfig({ MODAL_IMAGE_API_URL: 'https://example.modal.run/draw', MODAL_PROXY_TOKEN: CFG.proxyToken });
    expect(cfg?.apiUrl).toBeUndefined();
    expect(cfg?.imageApiUrl).toBe('https://example.modal.run/draw');
  });
});

describe('modalMask', () => {
  it('decodes the mask contract', async () => {
    stubFetch(200, { mask_b64: 'AQID', content_type: 'image/png' });
    const out = await modalMask(CFG, CFG.apiUrl, PNG, 'a young child');
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(out.contentType).toBe('image/png');
    expect(out.inputTokens).toBe(0);
  });

  it('rejects a bad reply without retry', async () => {
    stubFetch(200, {});
    await expect(modalMask(CFG, CFG.apiUrl, PNG, 'x')).rejects.toMatchObject({ retryable: false });
  });

  it('retries server errors', async () => {
    stubFetch(500, {});
    const err = await modalMask(CFG, CFG.apiUrl, PNG, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.retryable).toBe(true);
  });
});

describe('modalImage', () => {
  const IMG = { apiUrl: CFG.apiUrl, proxyToken: CFG.proxyToken, imageApiUrl: 'https://example.modal.run/draw' };
  it('decodes the image contract with zero tokens', async () => {
    stubFetch(200, { image_b64: 'AQID', content_type: 'image/png' });
    const out = await modalImage(IMG, IMG.imageApiUrl as string, 'a red boat', { width: 640, height: 800 });
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(out.contentType).toBe('image/png');
    expect(out.inputTokens).toBe(0);
    expect(out.outputTokens).toBe(0);
  });

  it('rejects a bad reply without retry', async () => {
    stubFetch(200, {});
    await expect(modalImage(IMG, IMG.imageApiUrl as string, 'x')).rejects.toMatchObject({ retryable: false });
  });

  it('retries server errors', async () => {
    stubFetch(500, {});
    const err = await modalImage(IMG, IMG.imageApiUrl as string, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.retryable).toBe(true);
  });
});
