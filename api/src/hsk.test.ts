import { describe, expect, it } from 'vitest';
import { checkHsk, easierHsk, isContentWordZh, segmentZh } from './hsk';

describe('segmentZh', () => {
  it('segments longest-match over Han runs', () => {
    // 电脑 (computer, HSK1) beats 脑 alone; 北京 is one word.
    expect(segmentZh('我在北京用电脑学习。')).toEqual(['我', '在', '北京', '用', '电脑', '学习']);
  });

  it('splits unknown compositions into known chars', () => {
    // 你好 is not an HSK word: 你 + 好 (both HSK1).
    expect(segmentZh('你好')).toEqual(['你', '好']);
  });

  it('falls back to single chars for unknown Han, skips the rest', () => {
    expect(segmentZh('a鿿b 1')).toEqual(['鿿']);
  });
});

describe('checkHsk', () => {
  it('passes in-level text with a cast-name extra', () => {
    expect(checkHsk('小明在北京学习', 'HSK1', ['小明']).passed).toBe(true);
  });

  it('fails harder vocabulary and reports it', () => {
    const r = checkHsk('世界很大', 'HSK1');
    expect(r.passed).toBe(false);
    expect(r.unknown).toContain('世界');
  });

  it('admits harder words at their own level', () => {
    expect(checkHsk('世界很大', 'HSK3').passed).toBe(true);
  });

  it('fails scenes over the length cap', () => {
    const r = checkHsk('爱'.repeat(41), 'HSK1');
    expect(r.words).toBe(41);
    expect(r.passed).toBe(false);
  });
});

describe('isContentWordZh', () => {
  it('treats particles as glue', () => {
    expect(isContentWordZh('的')).toBe(false);
    expect(isContentWordZh('吗')).toBe(false);
    expect(isContentWordZh('学习')).toBe(true);
  });
});

describe('easierHsk', () => {
  it('chains exact-first down to HSK1', () => {
    expect(easierHsk('HSK1')).toEqual(['HSK1']);
    expect(easierHsk('HSK3')).toEqual(['HSK3', 'HSK2', 'HSK1']);
  });
});
