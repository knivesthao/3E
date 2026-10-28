import { describe, expect, it } from 'vitest';
import { BASETEN_TASKS, GLIMMER_MODEL, basetenConfig } from './config';

// Dev-only Baseten wiring: the link script writes a development URL into
// api/.dev.vars; the app must pass it through untouched and fall back to
// the Meta Model API when either half is missing.
describe('basetenConfig (dev wiring)', () => {
  const DEV_URL =
    'https://model-abc1d2ef.api.baseten.co/environments/development/sync/v1/chat/completions';

  it('passes a development endpoint through with the default model', () => {
    expect(basetenConfig({ BASETEN_API_URL: DEV_URL, BASETEN_API_KEY: 'k' })).toEqual({
      apiUrl: DEV_URL,
      apiKey: 'k',
      model: GLIMMER_MODEL,
    });
  });

  it('honors BASETEN_MODEL without a code change', () => {
    const cfg = basetenConfig({ BASETEN_API_URL: DEV_URL, BASETEN_API_KEY: 'k', BASETEN_MODEL: 'custom' });
    expect(cfg?.model).toBe('custom');
    expect(cfg?.apiUrl).toBe(DEV_URL);
  });

  it('returns null when the URL or key is missing (Meta API fallback)', () => {
    expect(basetenConfig({})).toBeNull();
    expect(basetenConfig({ BASETEN_API_KEY: 'k' })).toBeNull();
    expect(basetenConfig({ BASETEN_API_URL: DEV_URL })).toBeNull();
  });

  it('routes only text tasks to Baseten, never art/isolate', () => {
    expect(BASETEN_TASKS).toContain('draft');
    expect(BASETEN_TASKS).not.toContain('art');
    expect(BASETEN_TASKS).not.toContain('isolate');
  });
});
