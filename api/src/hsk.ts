// Mandarin level gate (Phase 5.1): HSK 1–6 word lists + segmentation +
// coverage gate, mirroring levels.ts. Chinese has no spaces and no
// inflection, so tokenizing = longest-match segmentation over Han runs
// (unknown chars fall back to single-char tokens) and matching is exact.
import { HSK1, HSK2, HSK3, HSK4, HSK5, HSK6 } from './hsk-words';

export type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

const ORDER: HskLevel[] = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'];

const LISTS: Record<HskLevel, string[]> = { HSK1, HSK2, HSK3, HSK4, HSK5, HSK6 };

export function isHskLevel(x: unknown): x is HskLevel {
  return (
    x === 'HSK1' ||
    x === 'HSK2' ||
    x === 'HSK3' ||
    x === 'HSK4' ||
    x === 'HSK5' ||
    x === 'HSK6'
  );
}

const HAN = /[㐀-䶿一-鿿豈-﫿︰-﹏]/u;
const MAX_WORD_LEN = 6;

const LEXICON = new Set<string>();
for (const l of ORDER) {
  for (const w of LISTS[l]) LEXICON.add(w);
}

// Longest-match segmentation left to right. Non-Han (punctuation, latin,
// digits, spaces) is skipped: it is never look-upable. Unknown Han falls
// back to single characters so nothing is silently dropped. `extra`
// (cast names, story-specific terms) segments as units so the gate can
// allow them: checkHsk always forwards its extraWords here.
export function segmentZh(text: string, extra: string[] = []): string[] {
  const extraSet = extra.length > 0 ? new Set(extra) : null;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (!HAN.test(text[i])) {
      i++;
      continue;
    }
    let hit = '';
    for (let len = Math.min(MAX_WORD_LEN, text.length - i); len > 0; len--) {
      const cand = text.slice(i, i + len);
      if (LEXICON.has(cand) || extraSet?.has(cand)) {
        hit = cand;
        break;
      }
    }
    out.push(hit === '' ? text[i] : hit);
    i += hit === '' ? 1 : hit.length;
  }
  return out;
}

// Starter function-word stoplist: particles and glue never invite a lookup,
// mirroring isContentWord's a/an/the. Grow from book vocab as needed.
const GLUE = new Set(['的', '了', '是', '在', '有', '和', '吗', '呢', '吧', '啊', '个', '不', '也', '都', '这', '那']);

export function isContentWordZh(w: string): boolean {
  return w !== '' && !GLUE.has(w);
}

export const SCENE_MAX_WORDS_ZH: Record<HskLevel, number> = {
  HSK1: 40,
  HSK2: 60,
  HSK3: 80,
  HSK4: 100,
  HSK5: 120,
  HSK6: 150,
};

export interface HskResult {
  passed: boolean;
  coverage: number;
  words: number;
  maxWords: number;
  unknown: string[];
}

// Coverage gate: >=90% of segmented tokens must be level-known (cumulative
// HSK + extras like character names), within the scene length cap.
export function checkHsk(text: string, level: HskLevel, extraWords: string[] = []): HskResult {
  const allowed = new Set<string>();
  for (const l of ORDER) {
    for (const w of LISTS[l]) allowed.add(w);
    if (l === level) break;
  }
  for (const w of extraWords) allowed.add(w);
  const tokens = segmentZh(text, extraWords);
  const unknown = tokens.filter((t) => !allowed.has(t));
  const coverage = tokens.length === 0 ? 1 : 1 - unknown.length / tokens.length;
  const maxWords = SCENE_MAX_WORDS_ZH[level];
  return { passed: coverage >= 0.9 && tokens.length <= maxWords, coverage, words: tokens.length, maxWords, unknown };
}

// Dictionary fallback chain: exact level first, then easier.
export function easierHsk(level: HskLevel): HskLevel[] {
  const out: HskLevel[] = [];
  for (const l of ORDER) {
    out.push(l);
    if (l === level) break;
  }
  return out.reverse();
}
