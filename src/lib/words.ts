// Closed-class English words with little standalone meaning: articles,
// pronouns, prepositions, conjunctions, auxiliaries/modals (and their
// contractions), plus not/there. Everything else (nouns, verbs,
// adjectives, adverbs, interjections, question words) counts as a content
// word worth looking up. Static list, $0, offline-friendly.
const FUNCTION_WORDS = new Set([
  // Articles.
  'a', 'an', 'the',
  // Pronouns.
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his',
  'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours',
  'they', 'them', 'their', 'theirs',
  // Prepositions.
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from', 'up', 'down',
  'out', 'off', 'over', 'under', 'into', 'onto', 'after', 'before',
  'between', 'through', 'during', 'without', 'within', 'along', 'across',
  'behind', 'below', 'beside', 'near', 'past', 'since', 'toward',
  'towards', 'upon', 'except', 'among', 'about', 'around',
  // Conjunctions.
  'and', 'but', 'or', 'nor', 'so', 'yet', 'as', 'if', 'then', 'than',
  'although', 'though', 'unless', 'until', 'while', 'whereas', 'whether',
  // Auxiliaries and modals (am/is/are carry no independent meaning here).
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'ought',
  // Common contractions of the above.
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "can't", "couldn't", "won't", "wouldn't", "shouldn't",
  "haven't", "hasn't", "hadn't",
  "'s", "'re", "'m", "'ll", "'ve", "'d",
  // Other grammar glue.
  'not', 'there', 'here',
]);

/** True for words worth looking up. Takes an already-cleaned word. */
export function isContentWord(cleaned: string): boolean {
  return cleaned !== '' && !FUNCTION_WORDS.has(cleaned);
}
