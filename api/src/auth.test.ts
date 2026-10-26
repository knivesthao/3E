import { describe, expect, it } from 'vitest';
import { hashToken, isValidEmail, newToken } from './auth';

describe('newToken', () => {
  it('returns 64 hex chars and is unique per call', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(a);
  });
});

describe('hashToken', () => {
  it('is deterministic, 64 hex chars, and never contains the token', async () => {
    const token = newToken();
    const first = await hashToken(token);
    expect(first).toBe(await hashToken(token));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(token);
  });
});

describe('isValidEmail', () => {
  it('accepts plain addresses and rejects junk', () => {
    expect(isValidEmail('teacher@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});
