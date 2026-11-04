import { describe, expect, it } from 'vitest';
import { EXAM_LEVELS, formatAttemptDate, isExamLevel, levelBlurb } from './exams';

describe('exam levels', () => {
  it('covers the four learner levels in order', () => {
    expect(EXAM_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('describes every level', () => {
    for (const level of EXAM_LEVELS) {
      expect(levelBlurb(level).length).toBeGreaterThan(0);
    }
  });

  it('accepts only real levels', () => {
    expect(isExamLevel('A1')).toBe(true);
    expect(isExamLevel('B2')).toBe(true);
    expect(isExamLevel('C9')).toBe(false);
    expect(isExamLevel('')).toBe(false);
    expect(isExamLevel(undefined)).toBe(false);
  });

  it('formats attempt dates and passes through garbage', () => {
    const out = formatAttemptDate('2026-11-04T15:02:00.000Z');
    expect(out).toContain('2026');
    expect(formatAttemptDate('not-a-date')).toBe('not-a-date');
  });
});
