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
});
