import { describe, expect, it } from 'vitest';
import { isContentWord } from './words';

describe('isContentWord', () => {
  it('keeps nouns, verbs, adjectives, and interjections look-up-able', () => {
    for (const w of ['girl', 'house', 'run', 'happy', 'hello', 'what', 'where', 'because', 'like']) {
      expect(isContentWord(w)).toBe(true);
    }
  });

  it('hides articles, pronouns, prepositions, and conjunctions', () => {
    for (const w of ['a', 'an', 'the', 'i', 'you', 'he', 'it', 'in', 'on', 'to', 'of', 'and', 'but', 'or']) {
      expect(isContentWord(w)).toBe(false);
    }
  });

  it('hides auxiliaries and their contractions', () => {
    for (const w of ['am', 'is', 'are', 'was', 'be', 'have', 'do', "don't", "isn't", "'s"]) {
      expect(isContentWord(w)).toBe(false);
    }
  });

  it('treats empty and grammar glue as non-content', () => {
    for (const w of ['', 'not', 'there', 'here']) {
      expect(isContentWord(w)).toBe(false);
    }
  });
});
