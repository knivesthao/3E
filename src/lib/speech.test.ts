import { describe, expect, it } from 'vitest';
import {
  READ_ALOUD_PASS,
  cleanWord,
  scoreReading,
  speak,
  speechRecognitionSupported,
  speechSynthesisSupported,
  stopSpeaking,
} from './speech';

describe('cleanWord', () => {
  it('normalizes like the reader lookup', () => {
    expect(cleanWord('Cat!')).toBe('cat');
    expect(cleanWord("don't")).toBe("don't");
    expect(cleanWord('123')).toBe('');
  });
});

describe('scoreReading', () => {
  it('scores a perfect reading at 100 with no misses', () => {
    const s = scoreReading('The cat is happy', 'the cat is happy');
    expect(s).toMatchObject({ pct: 100, matched: 4, total: 4, missed: [] });
  });

  it('is order-free and dedupes missed words', () => {
    const s = scoreReading('the cat sat on the mat', 'cat mat dog');
    expect(s.matched).toBe(2);
    expect(s.total).toBe(6);
    expect(s.missed).toEqual(['the', 'sat', 'on']);
  });

  it('ignores punctuation and case', () => {
    const s = scoreReading('Hello, Ana!', 'hello ana');
    expect(s.pct).toBe(100);
  });

  it('scores empty scenes at 0', () => {
    expect(scoreReading('', 'hello').pct).toBe(0);
  });

  it('pass mark is reachable but not free', () => {
    expect(READ_ALOUD_PASS).toBeGreaterThan(50);
    const s = scoreReading('a b c d e f g h i j', 'a b');
    expect(s.pct).toBeLessThan(READ_ALOUD_PASS);
  });
});

describe('device speech availability (node has neither)', () => {
  it('reports unsupported without throwing', () => {
    expect(speechRecognitionSupported()).toBe(false);
    expect(speechSynthesisSupported()).toBe(false);
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('speak rejects when unsupported', async () => {
    await expect(speak('hello')).rejects.toThrow('unsupported');
  });
});
