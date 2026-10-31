import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMagicLink } from './email';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: unknown, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(url, init)) as typeof fetch;
}

const okRes = () => new Response('{"id":"x"}', { status: 200 });

describe('sendMagicLink', () => {
  it('posts to Resend with bearer auth, from/to, and the link', async () => {
    let seenUrl: unknown;
    let seenInit: RequestInit | undefined;
    stubFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return okRes();
    });
    const ok = await sendMagicLink(
      { RESEND_API_KEY: 'k', EMAIL_FROM: '3E <login@example.com>' },
      'kid@example.com',
      'https://app.example/api/auth/verify?token=abc',
    );
    expect(ok).toBe(true);
    expect(seenUrl).toBe('https://api.resend.com/emails');
    expect(seenInit?.method).toBe('POST');
    const headers = new Headers(seenInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer k');
    const body = JSON.parse(seenInit?.body as string) as Record<string, unknown>;
    expect(body.from).toBe('3E <login@example.com>');
    expect(body.to).toBe('kid@example.com');
    expect(body.subject).toBe('Sign in to 3E');
    expect(String(body.text)).toContain('https://app.example/api/auth/verify?token=abc');
  });

  it('returns false without a key, from address, or recipient', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return okRes();
    });
    expect(await sendMagicLink({ EMAIL_FROM: 'f' }, 'a@b.c', 'l')).toBe(false);
    expect(await sendMagicLink({ RESEND_API_KEY: 'k' }, 'a@b.c', 'l')).toBe(false);
    expect(await sendMagicLink({ RESEND_API_KEY: 'k', EMAIL_FROM: 'f' }, '', 'l')).toBe(false);
    expect(called).toBe(false);
  });

  it('returns false on non-ok response or fetch throw, never throwing', async () => {
    stubFetch(() => new Response('nope', { status: 401 }));
    expect(
      await sendMagicLink({ RESEND_API_KEY: 'k', EMAIL_FROM: 'f' }, 'a@b.c', 'l'),
    ).toBe(false);
    stubFetch(() => {
      throw new Error('down');
    });
    expect(
      await sendMagicLink({ RESEND_API_KEY: 'k', EMAIL_FROM: 'f' }, 'a@b.c', 'l'),
    ).toBe(false);
  });
});
