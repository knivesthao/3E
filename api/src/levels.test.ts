import { describe, expect, it } from 'vitest';
import { checkLevel, stem, tokenize } from './levels';

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
});
