import { describe, expect, it } from 'vitest';
import { collectClassWords, planPrefetch } from './flashcards';

const card = (word: string, meaning = '', level?: string) => ({ word, meaning, ...(level ? { level } : {}) });

describe('planPrefetch', () => {
  it('batches the first words up to the card and batch caps', () => {
    const cards = Array.from({ length: 55 }, (_, i) =>
      card(`w${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`));
    const batches = planPrefetch(cards, 'A1');
    expect(batches).toHaveLength(3);
    expect(batches[0]?.words).toHaveLength(20);
    expect(batches[1]?.words).toHaveLength(20);
    expect(batches[2]?.words).toHaveLength(10);
    expect(batches.every((b) => b.level === 'A1')).toBe(true);
  });

  it('skips cards that already have meanings, non-words, and repeats', () => {
    const batches = planPrefetch(
      [card('apple', 'a fruit'), card('run!'), card('run'), card('run'), card('jump')],
      'A2',
    );
    expect(batches).toEqual([{ level: 'A2', words: ['run', 'jump'] }]);
  });

  it('groups My Words by their own miss levels', () => {
    const batches = planPrefetch(
      [card('apple', '', 'A1'), card('run', '', 'A2'), card('jump', '', 'A1')],
      'A1',
    );
    expect(batches).toEqual([
      { level: 'A1', words: ['apple', 'jump'] },
      { level: 'A2', words: ['run'] },
    ]);
  });
});

describe('collectClassWords', () => {
  it('merges class lists, first class winning duplicates', () => {
    const words = collectClassWords([
      { level: 'A1', words: ['cat', 'dog'] },
      { level: 'B1', words: ['dog', 'run'] },
    ]);
    expect(words).toEqual([
      { word: 'cat', level: 'A1' },
      { word: 'dog', level: 'A1' },
      { word: 'run', level: 'B1' },
    ]);
  });
});
