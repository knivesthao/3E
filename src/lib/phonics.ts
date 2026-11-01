// Phonics helpers for flashcards: approximate English syllable splits so
// learners who guess at whole words (see docs/testimonials/kia.md) can see
// and hear words broken into sounded parts. Heuristic, not a dictionary —
// splits follow sounded vowel groups, so silent letters stay attached to
// the syllable they are spelled in. $0, offline, no model calls.

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
// Consonant pairs sounded as one onset: never split between them.
const ONSETS = new Set([
  'th', 'sh', 'ch', 'ph', 'wh', 'ck', 'ng', 'nk', 'qu',
  'bl', 'cl', 'fl', 'gl', 'pl', 'br', 'cr', 'dr', 'fr', 'gr', 'pr', 'tr',
  'sm', 'sn', 'st', 'sw', 'sp', 'sk', 'str', 'spr', 'spl',
]);

const isVowel = (word: string, i: number): boolean => {
  const ch = word[i];
  if (VOWELS.has(ch)) return true;
  // y is a vowel unless it starts the word.
  return ch === 'y' && i > 0;
};

export interface SoundCard {
  // What the learner sees big, and what the listen mode stretches.
  sound: string;
  // Familiar word carrying the sound in context; also the read-aloud target.
  example: string;
}

// Continuants stretch in TTS ("ssss"); stops take a schwa ("buh") and
// short vowels take short forms ("ah", "eh") — a bare single letter would
// make TTS say the letter's NAME ("eff"), so soundText never returns one.
const STRETCH = new Set(['s', 'f', 'm', 'n', 'l', 'r', 'v', 'z', 'h', 'w', 'y', 'th', 'sh']);

// Speakable approximations TTS reads as sounds, not names.
const SAYABLE: Record<string, string> = {
  a: 'ah', e: 'eh', i: 'ih', o: 'oh', u: 'uh',
  x: 'ks', ai: 'ay', oa: 'oh', ee: 'ee', oo: 'oo',
};

/** TTS-friendly sounding of a letter or digraph. */
export function soundText(sound: string): string {
  const s = sound.toLowerCase();
  if (STRETCH.has(s)) return s.repeat(4);
  return SAYABLE[s] ?? `${s}uh`;
}

/** Listen-mode line for the letters deck: sound first, anchored to the
 * example word (which always carries the true sound), then the word alone
 * as a clean model. Never contains a bare letter. */
export function letterListenText(sound: string, example: string): string {
  return `${soundText(sound)} as in ${example}. ${example}.`;
}

// CEFR word lists are the single source of truth in api/src/levels.ts (the
// same lists the level gate enforces). They arrive over GET /api/levels —
// the client never imports server code (Vite routes such an import through
// the /api proxy and it 404s).
import { isContentWord } from './words';

export interface LevelLists {
  A1: string[];
  A2: string[];
  B1: string[];
  B2: string[];
}

/** Content words per level for the level decks (glue filtered out). */
export function wordsByLevel(lists: LevelLists): Record<keyof LevelLists, string[]> {
  return {
    A1: lists.A1.filter(isContentWord),
    A2: lists.A2.filter(isContentWord),
    B1: lists.B1.filter(isContentWord),
    B2: lists.B2.filter(isContentWord),
  };
}

/** The 26 letters, each with a beginner example word. */
export const ALPHABET: SoundCard[] = [
  { sound: 'a', example: 'apple' },
  { sound: 'b', example: 'bat' },
  { sound: 'c', example: 'cat' },
  { sound: 'd', example: 'dog' },
  { sound: 'e', example: 'egg' },
  { sound: 'f', example: 'fish' },
  { sound: 'g', example: 'girl' },
  { sound: 'h', example: 'house' },
  { sound: 'i', example: 'ice' },
  { sound: 'j', example: 'jump' },
  { sound: 'k', example: 'kite' },
  { sound: 'l', example: 'lion' },
  { sound: 'm', example: 'mother' },
  { sound: 'n', example: 'night' },
  { sound: 'o', example: 'orange' },
  { sound: 'p', example: 'pen' },
  { sound: 'q', example: 'queen' },
  { sound: 'r', example: 'rice' },
  { sound: 's', example: 'sun' },
  { sound: 't', example: 'tiger' },
  { sound: 'u', example: 'umbrella' },
  { sound: 'v', example: 'voice' },
  { sound: 'w', example: 'water' },
  { sound: 'x', example: 'box' },
  { sound: 'y', example: 'yellow' },
  { sound: 'z', example: 'zoo' },
];

/** Digraphs and teams Kia's learners guess at: two letters, one sound. */
export const DIGRAPHS: SoundCard[] = [
  { sound: 'th', example: 'the' },
  { sound: 'sh', example: 'she' },
  { sound: 'ch', example: 'chair' },
  { sound: 'ph', example: 'phone' },
  { sound: 'wh', example: 'what' },
  { sound: 'ck', example: 'duck' },
  { sound: 'ng', example: 'sing' },
  { sound: 'qu', example: 'quick' },
  { sound: 'ee', example: 'see' },
  { sound: 'oo', example: 'moon' },
  { sound: 'ai', example: 'rain' },
  { sound: 'oa', example: 'boat' },
];

/** Split a lowercase alpha word into sounded parts. Returns [word] when unsure. */
export function splitSyllables(raw: string): string[] {
  const word = raw.toLowerCase();
  if (!/^[a-z]+$/.test(word) || word.length <= 3) return [word];

  // Silent final e belongs to the previous syllable: analyze without it,
  // then map boundaries back onto the original spelling.
  let core = word;
  let droppedE = '';
  if (core.endsWith('e') && core.length > 3 && !isVowel(core, core.length - 2)) {
    // ...but -le after a consonant is its own sounded beat (ap-ple,
    // ta-ble): only drop the e when a vowel letter stands before the
    // -le (fi-le is really one beat: file). The letter before the -le
    // sits at length-3, not length-2 (that is the l itself).
    const beforeLe = core.length >= 4 ? core[core.length - 3] : '';
    const soundedLe = core.endsWith('le') && beforeLe !== '' && !VOWELS.has(beforeLe);
    if (!soundedLe) {
      droppedE = 'e';
      core = core.slice(0, -1);
    }
  }

  // Suffix beats always split off whole: read-ing, jump-ed.
  const SUFFIXES = ['ing', 'ed', 'es'];
  let suffix = '';
  for (const s of SUFFIXES) {
    if (core.length - s.length >= 3 && core.endsWith(s)) {
      const stem = core.slice(0, -s.length);
      if ([...stem].some((_, i) => isVowel(stem, i))) {
        suffix = s;
        core = stem;
        break;
      }
    }
  }

  // Vowel-group scan: a consonant cluster between two vowel groups splits
  // after its first consonant (ap-ple, mar-ket), unless it is one sounded
  // onset, which moves right whole (mo-ther); a lone consonant also moves
  // right (o-pen, ba-na-na).
  const bounds: number[] = [];
  let i = 0;
  const n = core.length;
  while (i < n) {
    if (!isVowel(core, i)) { i++; continue; }
    let j = i;
    while (j < n && isVowel(core, j)) j++;
    // [i, j) is a vowel group; look at the consonants after it.
    let k = j;
    while (k < n && !isVowel(core, k)) k++;
    if (k < n && k > j) {
      const cluster = core.slice(j, k);
      if (cluster.length === 1 || ONSETS.has(cluster.slice(0, 2))) {
        bounds.push(j);
      } else {
        bounds.push(j + 1);
      }
    }
    i = j > i ? j : i + 1;
    // Skip ahead past the cluster we just ruled on.
    if (k > j) i = Math.max(i, k);
  }

  const parts: string[] = [];
  let prev = 0;
  for (const b of bounds) {
    if (b > prev) { parts.push(core.slice(prev, b)); prev = b; }
  }
  parts.push(core.slice(prev));
  if (suffix) parts.push(suffix);
  const last = parts.length - 1;
  parts[last] += droppedE;

  const joined = parts.join('');
  if (joined !== word || parts.some((p) => p === '')) return [word];
  return parts;
}
