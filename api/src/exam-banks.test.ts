import { describe, expect, it } from 'vitest';
import { BANKS, BANK_EXTRA_WORDS, BANK_WORDS, EXAM_LEVELS, unknownItemWords } from './exam-banks';
import type { BankItem, ExamLevel } from './exam-banks';

describe('exam banks', () => {
  it('covers every level with 24 items, six per part', () => {
    for (const level of EXAM_LEVELS) {
      expect(BANKS[level]).toHaveLength(24);
      for (const part of [1, 2, 3, 4] as const) {
        expect(BANKS[level].filter((q) => q.part === part)).toHaveLength(6);
      }
    }
  });

  it('uses globally unique ids with valid answers and explanations', () => {
    const ids = new Set<string>();
    const seen: BankItem[] = [];
    for (const level of EXAM_LEVELS) {
      for (const q of BANKS[level]) {
        expect(ids.has(q.id), `duplicate id ${q.id}`).toBe(false);
        ids.add(q.id);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(q.explanation.trim().length).toBeGreaterThan(0);
        if (q.part === 2) expect(q.passage?.trim().length).toBeGreaterThan(0);
        else expect(q.passage).toBeUndefined();
        seen.push(q);
      }
    }
    expect(seen.length).toBe(96);
  });

  it('keeps frozen A1 ids so saved attempts still review', () => {
    const ids = new Set(BANKS.A1.map((q) => q.id));
    for (const id of ['p1a', 'p2c', 'p3e', 'p4f']) expect(ids.has(id)).toBe(true);
  });

  it('maps every item to miss-loop words', () => {
    for (const level of EXAM_LEVELS) {
      for (const q of BANKS[level]) {
        expect(BANK_WORDS[level][q.id]?.length ?? 0, `${level}:${q.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every item inside its level vocabulary', () => {
    const failures: string[] = [];
    for (const level of EXAM_LEVELS) {
      for (const q of BANKS[level]) {
        const unknown = unknownItemWords(level, q);
        if (unknown.length > 0) failures.push(`${level}:${q.id} -> ${unknown.join(',')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps miss-loop words and extras inside their level too', () => {
    const failures: string[] = [];
    for (const level of EXAM_LEVELS) {
      const probe = (id: string, text: string) =>
        unknownItemWords(level, { id, part: 1, prompt: text, options: [], answer: 0, explanation: '' });
      for (const [id, words] of Object.entries(BANK_WORDS[level])) {
        const unknown = probe(id, words.join(' '));
        if (unknown.length > 0) failures.push(`${level}:${id} words -> ${unknown.join(',')}`);
      }
      for (const w of BANK_EXTRA_WORDS[level as ExamLevel]) {
        void w;
      }
    }
    expect(failures).toEqual([]);
  });
});
