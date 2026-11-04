// Prefetch planning for flashcard meanings: batch the first N cards of
// the active deck into server-sized (<=20 words) dictionary-first calls.
// Pure so the batching rule is unit-tested; the page does the fetching.
export interface PrefetchCard {
  word: string;
  meaning: string;
  level?: string;
}

export interface PrefetchBatch {
  level: string;
  words: string[];
}

// Class words merged across a learner's enrollments: first class wins on
// duplicates so each card rides one level for meanings and art.
export function collectClassWords(classes: { level: string; words: string[] }[]): { word: string; level: string }[] {
  const seen = new Set<string>();
  const out: { word: string; level: string }[] = [];
  for (const cls of classes) {
    for (const word of cls.words ?? []) {
      if (seen.has(word)) continue;
      seen.add(word);
      out.push({ word, level: cls.level });
    }
  }
  return out;
}

const WORD_RE = /^[a-z]+$/;

export function planPrefetch(
  cards: PrefetchCard[],
  deckLevel: string,
  limit = 50,
  batch = 20,
): PrefetchBatch[] {
  const seen = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const card of cards.slice(0, limit)) {
    if (card.meaning !== '' || !WORD_RE.test(card.word) || seen.has(card.word)) continue;
    seen.add(card.word);
    const level = card.level ?? deckLevel;
    const group = groups.get(level) ?? [];
    group.push(card.word);
    groups.set(level, group);
  }
  const out: PrefetchBatch[] = [];
  for (const [level, words] of groups) {
    for (let i = 0; i < words.length; i += batch) {
      out.push({ level, words: words.slice(i, i + batch) });
    }
  }
  return out;
}
