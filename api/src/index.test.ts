import { describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import app from './index';

// Static-asset stub: the worker serves index.html itself for deep links
// (the assets layer only serves exact files; misses reach the worker).
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
const withAssets = {
  DB: {} as D1Database,
  LIBRARY_DB: {} as D1Database,
  ART: {} as R2Bucket,
  LIBRARY_ART: {} as R2Bucket,
  ASSETS: { fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html' } }) },
};

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

describe('SPA fallback', () => {
  it('serves the app shell for deep links', async () => {
    const res = await app.request('/exam', {}, withAssets);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('id="root"');
  });

  it('serves the app shell for share links', async () => {
    const res = await app.request('/s/abc123', {}, withAssets);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('degrades to JSON 404 when the asset binding is missing', async () => {
    const res = await app.request('/exam');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});
