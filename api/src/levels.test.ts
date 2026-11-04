import { describe, expect, it } from 'vitest';
import { A1, A2, B1, B2, C1, C2, checkFocus, checkLevel, easierLevels, FOCUS_MIN_SEEDS, FOCUS_SEEDS, FOCUS_TAGS, stem, tokenize } from './levels';

describe('easierLevels', () => {
  it('chains exact-first down to A1', () => {
    expect(easierLevels('A1')).toEqual(['A1']);
    expect(easierLevels('B1')).toEqual(['B1', 'A2', 'A1']);
    expect(easierLevels('B2')).toEqual(['B2', 'B1', 'A2', 'A1']);
    expect(easierLevels('C2')).toEqual(['C2', 'C1', 'B2', 'B1', 'A2', 'A1']);
  });
});

describe('advanced lists', () => {
  it('ships non-empty lowercase-alpha C1/C2 cores', () => {
    for (const list of [C1, C2]) {
      expect(list.length).toBeGreaterThan(100);
      for (const w of list) expect(w).toMatch(/^[a-z]+$/);
    }
  });

  it('keeps advanced words out of easier lists', () => {
    // Overlap would duplicate flashcard decks and blur the gate: each word
    // lives in exactly one list, allowed cumulatively through easierLevels.
    const easier = new Set([...A1, ...A2, ...B1, ...B2]);
    for (const w of [...C1, ...C2]) expect(easier.has(w)).toBe(false);
    for (const w of C2) expect(C1.includes(w)).toBe(false);
  });
});

describe('tokenize', () => {
  it('lowercases and keeps words only', () => {
    expect(tokenize('Mia, run! Go.')).toEqual(['mia', 'run', 'go']);
  });
});

describe('stem', () => {
  it('reduces everyday conjugations', () => {
    expect(stem('runs')).toBe('run');
    expect(stem('sees')).toBe('see');
    expect(stem('walked')).toBe('walk');
    expect(stem('played')).toBe('play');
    expect(stem('flies')).toBe('fly');
    expect(stem('going')).toBe('go');
    expect(stem('run')).toBe('run');
  });
});

describe('checkLevel', () => {
  it('passes simple A1 text with a cast name extra', () => {
    const r = checkLevel('Mia and a boy see a red bird', 'A1', ['Mia']);
    expect(r.passed).toBe(true);
    expect(r.unknown).toEqual([]);
  });

  it('passes conjugated verbs via stemming', () => {
    const r = checkLevel('Mia runs to the red house', 'A1', ['Mia']);
    expect(r.passed).toBe(true);
  });

  it('fails hard vocabulary and reports it', () => {
    const r = checkLevel('Mia contemplates the epistemology of birds', 'A1', ['Mia']);
    expect(r.passed).toBe(false);
    expect(r.unknown).toContain('contemplates');
    expect(r.coverage).toBeLessThan(0.9);
  });

  it('fails scenes over the length cap', () => {
    const words = new Array(41).fill('good');
    const r = checkLevel(words.join(' '), 'A1');
    expect(r.words).toBe(41);
    expect(r.passed).toBe(false);
  });

  it('higher levels admit harder words', () => {
    expect(checkLevel('Mia runs', 'A1', ['Mia']).passed).toBe(true);
    expect(checkLevel('They visit the market', 'A2').passed).toBe(true);
    expect(checkLevel('They celebrate the festival', 'B1').passed).toBe(true);
  });

  it('admits everyday words real drafts use (factory gap-fill)', () => {
    expect(checkLevel('The boy and his son eat bread and soup', 'A1').passed).toBe(true);
    expect(checkLevel('Milk and rice and a red ball', 'A1').passed).toBe(true);
    expect(checkLevel('The kite can fly high', 'A2').passed).toBe(true);
    expect(checkLevel('Cut the apple and stir the soup', 'A2').passed).toBe(true);
    expect(checkLevel('He opens the toolbox', 'B1').passed).toBe(true);
    expect(checkLevel('It is restored and real', 'B1').passed).toBe(true);
  });

  it('gates C2 words to C levels', () => {
    const text = C2.slice(0, 40).join(' ');
    expect(checkLevel(text, 'C2').passed).toBe(true);
    const atB2 = checkLevel(text, 'B2');
    expect(atB2.passed).toBe(false);
    expect(atB2.unknown.length).toBeGreaterThan(0);
  });
});

describe('checkFocus', () => {
  it('draws every seed from the A1 list so all levels admit them', () => {
    const a1 = new Set(A1);
    for (const tag of FOCUS_TAGS) {
      expect(FOCUS_SEEDS[tag].length).toBeGreaterThan(10);
      for (const seed of FOCUS_SEEDS[tag]) expect(a1.has(seed), `${tag}:${seed}`).toBe(true);
    }
  });

  it('passes drill-dense scenes and fails thin ones per tag', () => {
    expect(checkFocus('The boy runs and eats bread, then drinks milk and reads', 'A1', 'verbs').passed).toBe(true);
    expect(checkFocus('He goes up and down', 'A1', 'verbs').passed).toBe(false);
    expect(checkFocus('A white cat drinks cold water and milk in the house', 'A1', 'nouns').passed).toBe(true);
    expect(checkFocus('He goes up and down', 'A1', 'nouns').passed).toBe(false);
    expect(checkFocus('A big red happy hot new old cat', 'A1', 'adjectives').passed).toBe(true);
    expect(checkFocus('He goes up and down', 'A1', 'adjectives').passed).toBe(false);
  });

  it('counts inflected forms through the gate stemmer', () => {
    const r = checkFocus('Boys run and girls eat and walk and play and look', 'A1', 'verbs');
    expect(r.found).toBeGreaterThanOrEqual(FOCUS_MIN_SEEDS);
    expect(r.passed).toBe(true);
  });

  it('reports found against need for the retry reason', () => {
    const r = checkFocus('He goes up and down', 'A1', 'nouns');
    expect(r).toMatchObject({ passed: false, need: FOCUS_MIN_SEEDS });
    expect(r.found).toBeLessThan(FOCUS_MIN_SEEDS);
  });

  it('holds at higher levels too', () => {
    const dense = 'The boy runs and eats bread, then drinks milk and reads';
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const) {
      expect(checkFocus(dense, level, 'verbs').passed, level).toBe(true);
    }
  });
});
