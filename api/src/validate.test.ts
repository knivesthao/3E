import { describe, expect, it } from 'vitest';
import {
  validateCast,
  validateProjectCreate,
  validateProjectPatch,
  validateSceneData,
  validateSceneOrder,
} from './validate';

describe('validateProjectCreate', () => {
  it('accepts a minimal valid body and defaults purpose/description', () => {
    expect(validateProjectCreate({ title: 'My Comic', level: 'A1' })).toEqual({
      ok: true,
      value: { title: 'My Comic', level: 'A1', purpose: 'learning', description: '' },
    });
  });

  it('rejects missing title, bad level, and bad purpose', () => {
    expect(validateProjectCreate({ level: 'A1' }).ok).toBe(false);
    expect(validateProjectCreate({ title: '  ', level: 'A1' }).ok).toBe(false);
    expect(validateProjectCreate({ title: 'T', level: 'C2' }).ok).toBe(false);
    expect(validateProjectCreate({ title: 'T', level: 'A1', purpose: 'fun' }).ok).toBe(false);
    expect(validateProjectCreate(null).ok).toBe(false);
  });
});

describe('validateProjectPatch', () => {
  it('accepts partial updates and normalizes cast_json', () => {
    const r = validateProjectPatch({ title: ' New ', cast_json: { characters: [{ name: 'Mia' }], places: [] } });
    expect(r).toEqual({
      ok: true,
      value: { title: 'New', cast_json: '{"characters":[{"name":"Mia"}],"places":[]}' },
    });
  });

  it('rejects bad level and malformed cast', () => {
    expect(validateProjectPatch({ level: 'Z9' }).ok).toBe(false);
    expect(validateProjectPatch({ cast_json: '{"characters":"x"}' }).ok).toBe(false);
    expect(validateProjectPatch([]).ok).toBe(false);
  });
});

describe('validateSceneData', () => {
  it('accepts narration plus bubbles within limits', () => {
    const r = validateSceneData({ narration: 'Mia runs.', bubbles: [{ speaker: 'Mia', text: 'Go!' }] });
    expect(r.ok).toBe(true);
  });

  it('rejects missing narration, too many bubbles, and oversized text', () => {
    expect(validateSceneData({ bubbles: [] }).ok).toBe(false);
    expect(validateSceneData({ narration: 'x', bubbles: new Array(11).fill({ speaker: 'A', text: 'B' }) }).ok).toBe(false);
    expect(validateSceneData({ narration: 'x', bubbles: [{ speaker: 'A', text: 'y'.repeat(501) }] }).ok).toBe(false);
  });
});

describe('validateCast', () => {
  it('accepts the default empty cast in both forms', () => {
    expect(validateCast('{"characters":[],"places":[]}')).toEqual({
      ok: true,
      value: '{"characters":[],"places":[]}',
    });
    expect(validateCast({ characters: [], places: [] }).ok).toBe(true);
  });

  it('rejects nameless entries and non-arrays', () => {
    expect(validateCast({ characters: [{ name: '' }], places: [] }).ok).toBe(false);
    expect(validateCast({ characters: 'Mia', places: [] }).ok).toBe(false);
  });
});

describe('validateSceneOrder', () => {
  it('accepts unique non-empty id lists, rejects dupes and empties', () => {
    expect(validateSceneOrder(['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(validateSceneOrder(['a', 'a']).ok).toBe(false);
    expect(validateSceneOrder([]).ok).toBe(false);
    expect(validateSceneOrder('ab').ok).toBe(false);
  });
});
