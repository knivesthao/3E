import { describe, expect, it } from 'vitest';
import app from './index';

describe('GET /api/health', () => {
  it('returns { ok: true } with no session', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('session gate', () => {
  it('rejects /api/auth/me without a cookie', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects unknown /api routes without a cookie (gate runs first)', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(401);
  });

  it('rejects /api/levels without a cookie', async () => {
    const res = await app.request('/api/levels');
    expect(res.status).toBe(401);
  });
});

describe('native-shell CORS', () => {
  it('answers preflights from the Capacitor origin, not the open web', async () => {
    const pre = await app.request('/api/share/books', {
      method: 'OPTIONS',
      headers: { Origin: 'capacitor://localhost' },
    });
    expect(pre.status).toBe(200);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    const other = await app.request('/api/share/books', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('leaves same-origin traffic header-free', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
