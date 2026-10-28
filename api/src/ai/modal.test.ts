import { afterEach, describe, expect, it } from 'vitest';
import { modalConfig } from './config';
import { modalMask } from './modal';
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
    });
  });
});

describe('modalMask', () => {
  it('decodes the mask contract', async () => {
    stubFetch(200, { mask_b64: 'AQID', content_type: 'image/png' });
    const out = await modalMask(CFG, PNG, 'a young child');
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(out.contentType).toBe('image/png');
    expect(out.inputTokens).toBe(0);
  });

  it('rejects a bad reply without retry', async () => {
    stubFetch(200, {});
    await expect(modalMask(CFG, PNG, 'x')).rejects.toMatchObject({ retryable: false });
  });

  it('retries server errors', async () => {
    stubFetch(500, {});
    const err = await modalMask(CFG, PNG, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.retryable).toBe(true);
  });
});
