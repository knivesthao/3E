import { describe, expect, it } from 'vitest';
import { ALPHABET, DIGRAPHS, soundText, splitSyllables, wordsByLevel } from './phonics';

describe('splitSyllables', () => {
  it('keeps short and single-beat words whole', () => {
    for (const w of ['cat', 'dog', 'the', 'night', 'school', 'train', 'cake', 'house', 'love']) {
      expect(splitSyllables(w)).toEqual([w]);
    }
  });
  it('splits doubled consonants and clusters', () => {
    expect(splitSyllables('apple')).toEqual(['ap', 'ple']);
    expect(splitSyllables('happy')).toEqual(['hap', 'py']);
    expect(splitSyllables('market')).toEqual(['mar', 'ket']);
    expect(splitSyllables('number')).toEqual(['num', 'ber']);
    expect(splitSyllables('children')).toEqual(['chil', 'dren']);
  });
  it('moves single consonants and sounded onsets right', () => {
    expect(splitSyllables('banana')).toEqual(['ba', 'na', 'na']);
    expect(splitSyllables('mother')).toEqual(['mo', 'ther']);
    expect(splitSyllables('father')).toEqual(['fa', 'ther']);
    expect(splitSyllables('table')).toEqual(['ta', 'ble']);
    expect(splitSyllables('people')).toEqual(['peo', 'ple']);
    expect(splitSyllables('sister')).toEqual(['si', 'ster']);
    expect(splitSyllables('family')).toEqual(['fa', 'mi', 'ly']);
    expect(splitSyllables('beautiful')).toEqual(['beau', 'ti', 'ful']);
  });
  it('splits suffix beats off whole', () => {
    expect(splitSyllables('reading')).toEqual(['read', 'ing']);
    expect(splitSyllables('jumped')).toEqual(['jump', 'ed']);
    expect(splitSyllables('today')).toEqual(['to', 'day']);
    expect(splitSyllables('because')).toEqual(['be', 'cause']);
  });
  it('never invents or loses letters', () => {
    const words = ['apple', 'beautiful', 'because', 'people', 'little', 'seven', 'water', 'about'];
    for (const w of words) {
      expect(splitSyllables(w).join('')).toBe(w);
    }
  });
  it('filters glue out of level decks', () => {
    const decks = wordsByLevel({ A1: ['apple', 'the', 'run'], A2: [], B1: [], B2: [] });
    expect(decks.A1).toEqual(['apple', 'run']);
  });

  it('covers the alphabet and digraphs with single-word examples', () => {
    expect(ALPHABET).toHaveLength(26);
    const letters = new Set(ALPHABET.map((c) => c.sound));
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') expect(letters.has(ch)).toBe(true);
    for (const c of [...ALPHABET, ...DIGRAPHS]) {
      expect(c.sound).toMatch(/^[a-z]{1,2}$/);
      expect(c.example).toMatch(/^[a-z]+$/);
      expect(soundText(c.sound).length).toBeGreaterThan(0);
    }
    for (const d of ['th', 'sh', 'ch', 'ph', 'wh', 'ck', 'ng']) {
      expect(DIGRAPHS.some((c) => c.sound === d)).toBe(true);
    }
  });

  it('treats vowel-plus-le as one beat', () => {
    for (const w of ['file', 'mile', 'smile', 'whole', 'sale', 'rule']) {
      expect(splitSyllables(w)).toEqual([w]);
    }
    expect(splitSyllables('turtle')).toEqual(['tur', 'tle']);
    expect(splitSyllables('bottle')).toEqual(['bot', 'tle']);
  });
});
