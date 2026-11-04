import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aiMeanings, apiUrl, clearMiss, listFlashImages, listLevels, listMisses, listMyClasses, putFlashProgress, voiceLang } from '../lib/api';
import { collectClassWords, planPrefetch } from '../lib/flashcards';
import { ALPHABET, DIGRAPHS, letterListenText, splitSyllables, wordsByLevel } from '../lib/phonics';
import { Button } from '../components/ui';
import { flashFallback } from '../lib/fallback-art';
import { PageNav, PageShell } from '../components/PageShell';
import { Words } from '../components/Words';
import { ListenPanel } from '../components/ListenPanel';
import { BuddyCorner } from '../components/BuddyVoice';

interface Card {
  word: string;
  meaning: string;
  // My Words deck only: each card keeps its own miss level so meanings
  // and art ride the word's level, not the deck's.
  level?: string;
  // What the card shows big: the letter or digraph. The read target stays
  // a real example word (isolated phonemes transcribe too poorly to score).
  display: string[];
  listenText: string;
  wordMap: number[];
  readText: string;
  order: string[];
  // Word decks only: picture cue served from the shared library bucket.
  // Absent until generated — the card shows its hash-picked fallback
  // background instead, same slot so no layout shift. Letters/sounds/teams
  // never carry images (phonics stays distraction-free).
  image?: string;
}

// Deterministic image key per (level, word): shared 3e-library bucket,
// served through the art route's KEY_RE flash branch. Non-alpha words
// get no image (the route couldn't serve them anyway).
function flashImage(level: string, word: string, known: Set<string> | null): string | undefined {
  if (!/^[a-z]+$/.test(word)) return undefined;
  // Indexed: only ask for images that exist (no 404 noise for abstract or
  // not-yet-generated words). Unknown index: ask anyway, card falls back.
  if (known && !known.has(`${level}:${word}`)) return undefined;
  return apiUrl(`/api/ai/art/flash-${level}-${word}.png`);
}

function nameCard(letter: string, example: string, meaning: string): Card {
  // The alphabet itself: big capital, device says the name ("ay", "bee").
  // The read target is the letter; recognition is advisory, Next always works.
  const lower = letter.toLowerCase();
  return {
    word: lower,
    meaning: meaning !== '' ? `Letter ${letter} — ${meaning}` : `Letter ${letter}, as in ${example}`,
    display: [letter],
    listenText: letter,
    wordMap: [0],
    readText: lower,
    order: [lower],
  };
}

function soundCard(sound: string, example: string, meaning: string): Card {
  // Never the bare letter: TTS reads lone letters by name ("eff").
  const listenText = letterListenText(sound, example);
  return {
    word: example,
    meaning: meaning !== '' ? `as in ${example} — ${meaning}` : `as in ${example}`,
    display: [sound],
    listenText,
    wordMap: listenText.split(/\s+/).map(() => 0),
    readText: example,
    order: [example],
  };
}

function bookCard(word: string, meaning: string, image?: string, level?: string): Card {
  const display = splitSyllables(word);
  return {
    word,
    meaning,
    image,
    ...(level ? { level } : {}),
    display,
    listenText: display.join(' '),
    wordMap: display.map((_, i) => i),
    readText: display.join(' '),
    order: display,
  };
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// General basics only: letter sounds, teams, and level words
// (testimonials/kia.md). No per-book decks — foundations first, book words
// get their meanings from tap-to-define in the Reader instead.
// Meanings prefetch for the first cards of the active deck (batched,
// dictionary-first) with lazy single-word lookup as the fallback, so the
// B2 deck never fetches thousands of glosses at once.
type DeckKey = 'letters' | 'names' | 'teams' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'mine' | 'class';

// Deck-specific gloss framing, shared by lazy flip lookup and prefetch so
// a prefetched card reads exactly like a flipped one.
function formatMeaning(deck: DeckKey, display: string[], word: string, gloss: string): string {
  if (deck === 'names') return `Letter ${display[0]} — ${gloss}`;
  if (deck === 'letters' || deck === 'teams') return `as in ${word} — ${gloss}`;
  return gloss;
}
const DECK_LABEL: Record<DeckKey, string> = {
  letters: 'Phonics', names: 'Alphabet', teams: 'Letter teams', A1: 'A1 words', A2: 'A2 words', B1: 'B1 words', B2: 'B2 words', C1: 'C1 words', C2: 'C2 words', mine: 'My words', class: 'Class words',
};
// Meaning lookup rides the deck's own level so glosses match the learner.
// My Words and Class words cards carry their own level instead.
const DECK_LEVEL: Record<DeckKey, string> = {
  letters: 'A1', names: 'A1', teams: 'A1', A1: 'A1', A2: 'A2', B1: 'B1', B2: 'B2', C1: 'C1', C2: 'C2', mine: 'A1', class: 'A1',
};

// Prefetch meanings for the first cards of the active deck (batched,
// dictionary-first, up to 50 cards) plus a few screens of image warming,
// so flips feel instant. Fire-and-forget: failures leave lazy lookup to
// cover flips, and merges skip cards the learner already flipped.
async function prefetchDeck(
  key: DeckKey,
  cards: Card[],
  merge: (key: DeckKey, got: Map<string, string>) => void,
): Promise<void> {
  for (const card of cards.slice(0, 12)) {
    if (card.image) {
      const warm = new Image();
      warm.src = card.image;
    }
  }
  const batches = planPrefetch(cards, DECK_LEVEL[key]);
  await Promise.all(
    batches.map(async ({ level, words }) => {
      try {
        const res = await aiMeanings(words, level);
        const got = new Map<string, string>();
        for (const m of res.meanings) {
          if (m.meaning) got.set(m.word, m.meaning);
        }
        if (got.size > 0) merge(key, got);
      } catch {
        // Offline or capped: flips fetch on demand.
      }
    }),
  );
}
export default function Flashcards() {
  const [params] = useSearchParams();
  const initial = params.get('deck');
  const startDeck: DeckKey = initial === 'names' || initial === 'teams' || initial === 'A1' || initial === 'A2' || initial === 'B1' || initial === 'B2' || initial === 'C1' || initial === 'C2' || initial === 'mine' || initial === 'class' ? initial : 'letters';
  const [decks, setDecks] = useState<Record<DeckKey, Card[]> | null>(null);
  const [deck] = useState<DeckKey>(startDeck);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Buddy corner: Pip sits on the card, tap to open Listen (hear it).
  // Flashcards are practice, never graded — no mic, no scores, no counts.
  // Listen trail (which sound is playing), like the Reader page.
  const [listenSet, setListenSet] = useState<Set<number>>(new Set());
  const [listenCur, setListenCur] = useState<number | null>(null);

  // Decks build from the server word lists with blank meanings; each
  // meaning arrives on first flip (single-word lookup, DB-first, one
  // model call at most). The flash index tells which words have art so
  // the rest never fire image requests.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listLevels(), listFlashImages(), listMisses().catch(() => ({ misses: [] })), listMyClasses().catch(() => ({ classes: [] }))])
      .then(([lists, known, mine, enrolled]) => {
        if (cancelled) return;
        const byLevel = wordsByLevel(lists);
        const built: Record<DeckKey, Card[]> = {
          letters: shuffle(ALPHABET.map((s) => soundCard(s.sound, s.example, ''))),
          names: shuffle(ALPHABET.map((s) => nameCard(s.sound.toUpperCase(), s.example, ''))),
          teams: shuffle(DIGRAPHS.map((s) => soundCard(s.sound, s.example, ''))),
          A1: shuffle(byLevel.A1.map((w) => bookCard(w, '', flashImage('A1', w, known)))),
          A2: shuffle(byLevel.A2.map((w) => bookCard(w, '', flashImage('A2', w, known)))),
          B1: shuffle(byLevel.B1.map((w) => bookCard(w, '', flashImage('B1', w, known)))),
          B2: shuffle(byLevel.B2.map((w) => bookCard(w, '', flashImage('B2', w, known)))),
          C1: shuffle(byLevel.C1.map((w) => bookCard(w, '', flashImage('C1', w, known)))),
          C2: shuffle(byLevel.C2.map((w) => bookCard(w, '', flashImage('C2', w, known)))),
          // My Words: the reader's own stumbles, most-missed first, each
          // card riding its miss level for meanings and art. Signed out:
          // misses stay empty and the deck waits.
          mine: shuffle(mine.misses.map((m) => bookCard(m.word, '', flashImage(m.level, m.word, known), m.level))),
          // Class words: the teacher's drill list from the learner's
          // enrollments, each card riding its class level. No classes
          // (or signed out): the deck waits.
          class: shuffle(
            collectClassWords(enrolled.classes).map((w) => bookCard(w.word, '', flashImage(w.level, w.word, known), w.level)),
          ),
        };
        setDecks(built);
        if (!cancelled) {
          void prefetchDeck(deck, built[deck], (key, got) => {
            setDecks((d) => {
              if (!d) return d;
              const list = d[key].map((c) => {
                const m = got.get(c.word);
                return m && c.meaning === '' ? { ...c, meaning: formatMeaning(key, c.display, c.word, m) } : c;
              });
              return { ...d, [key]: list };
            });
          });
        }
      })
      .catch(() => {
        // Lists unreachable (offline): sound decks still work, level decks wait.
        if (!cancelled) setDecks({
          letters: shuffle(ALPHABET.map((s) => soundCard(s.sound, s.example, ''))),
          names: shuffle(ALPHABET.map((s) => nameCard(s.sound.toUpperCase(), s.example, ''))),
          teams: shuffle(DIGRAPHS.map((s) => soundCard(s.sound, s.example, ''))),
          A1: [], A2: [], B1: [], B2: [], C1: [], C2: [], mine: [], class: [],
        });
      });
    return () => { cancelled = true; };
  }, []);

  const flip = (open: boolean) => {
    setFlipped(open);
    if (open && card && card.meaning === '') {
      const at = index;
      const key = deck;
      const level = card.level ?? DECK_LEVEL[key];
      aiMeanings([card.word], level)
        .then((res) => {
          const meaning = res.meanings[0]?.meaning ?? '';
          if (!meaning) return;
          setDecks((d) => {
            if (!d) return d;
            const list = d[key].map((c, i) => (i === at ? { ...c, meaning: formatMeaning(key, c.display, c.word, meaning) } : c));
            return { ...d, [key]: list };
          });
        })
        .catch(() => {});
    }
  };

  const cards = decks?.[deck] ?? null;
  const card = cards?.[index] ?? null;
  const done = cards !== null && index >= cards.length;
  // Deck completion reports seen cards once (ref-guarded: StrictMode
  // double-fires the effect in dev). Anonymous 401s are ignored.
  const progressSent = useRef(false);

  useEffect(() => {
    if (!done || !cards || cards.length === 0 || progressSent.current) return;
    progressSent.current = true;
    void putFlashProgress(deck, cards.length, 0).catch(() => {});
  }, [done, cards, deck]);

  const resetTrails = () => {
    setFlipped(false);
    setListenSet(new Set());
    setListenCur(null);
  };

  // 'Got it' (My Words only): the learner knows this word — drop it from
  // the deck and count it known. The card unmounts; no layout shift.
  const gotIt = () => {
    if (!card || deck !== 'mine') return;
    const word = card.word;
    void clearMiss(word).catch(() => {});
    void putFlashProgress('mine', 0, 1).catch(() => {});
    setDecks((d) => {
      if (!d) return d;
      return { ...d, mine: d.mine.filter((c) => c.word !== word) };
    });
    resetTrails();
  };

  const next = () => {
    setIndex((i) => i + 1);
    resetTrails();
  };
  const pageText = card ? card.display.join(' ') : '';

  return (
    <main className="relative mx-auto w-full max-w-xl">
      {decks === null && <p>Loading cards…</p>}
      {done && (
        <section>
          <p>Deck finished — nice work.</p>
          <p>
            <Button
              onClick={() => {
                setDecks((d) => (d ? { ...d, [deck]: shuffle(d[deck]) } : d));
                setIndex(0);
                resetTrails();
              }}
            >
              Practice again
            </Button>{' '}
            <Link to="/">Back to the shelf</Link>
          </p>
        </section>
      )}
      {card && !done && (
        <PageShell
          label={`${DECK_LABEL[deck]} card`}
          media={
            <div className="flex h-full flex-col items-center justify-center bg-white p-6 text-center" role="button" tabIndex={0} onClick={() => flip(!flipped)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') flip(!flipped); }} aria-label={flipped ? 'Show sound' : 'Show meaning'}>
              {(() => {
                const isWord = deck === 'A1' || deck === 'A2' || deck === 'B1' || deck === 'B2' || deck === 'C1' || deck === 'C2' || deck === 'mine' || deck === 'class';
                if (!isWord) {
                  return (
                    <p className="w-full break-words px-2 text-center text-[clamp(9rem,32dvh,22rem)] font-bold leading-none">
                      <Words
                        text={pageText}
                        onTap={() => flip(true)}
                        tapped={null}
                        spoken={listenSet}
                        current={listenCur}
                        plain
                        colorful
                        colorOffset={index}
                      />
                    </p>
                  );
                }
                const chars = Math.max(1, pageText.replace(/\s/g, '').length);
                return (
                  <>
                    {(() => {
                      const fallback = flashFallback(card.word);
                      return (
                        <img
                          src={card.image ?? fallback}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          className="mb-2 max-h-[28dvh] w-auto max-w-full rounded-md object-contain"
                          onError={(e) => {
                            // Broken remote art degrades to the word's
                            // fallback background instead of vanishing.
                            if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                            else e.currentTarget.style.display = 'none';
                          }}
                        />
                      );
                    })()}
                    <p
                      className="w-full max-w-full whitespace-nowrap px-2 text-center font-bold leading-none"
                      style={{ fontSize: `clamp(2.5rem, calc(min(88vw, 55dvh) / ${0.62 * chars}), 7rem)` }}
                    >
                      <Words
                        text={pageText}
                        onTap={() => flip(true)}
                        tapped={null}
                        spoken={listenSet}
                        current={listenCur}
                        plain
                        colorful
                        colorOffset={index}
                      />
                    </p>
                  </>
                );
              })()}
            </div>
          }
          overlay={
            <>
              {flipped && (
                <div role="status" aria-live="polite" className="absolute left-1/2 top-4 z-50 w-60 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg bg-stone-900 p-3 text-center text-white shadow-lg" onClick={() => flip(false)}>
                  <div aria-hidden="true" className="absolute -top-1 right-8 h-4 w-4 rotate-45 bg-stone-900" />
                  <p>{card.meaning !== '' ? card.meaning : 'Looking it up…'}</p>
                </div>
              )}
              <BuddyCorner
                open
                onToggle={() => flip(true)}
                toggleLabel="About this card"
              >
<ListenPanel
                    key={`listen-${index}`}
                    sceneNumber={index}
                    text={card.listenText}
                    wordMap={card.wordMap}
                    speechLang={voiceLang(undefined)}
                    onSpeakStart={() => {
                      setListenSet(new Set());
                      setListenCur(null);
                    }}
                    onSpeakProgress={(idx) => {
                      if (idx === null) {
                        setListenCur(null);
                      } else {
                        setListenCur(idx);
                        setListenSet((prev) => new Set(prev).add(idx));
                      }
                    }}
                  />
              </BuddyCorner>
            </>
          }
          nav={
            <div className="flex flex-col gap-2">
              <PageNav
                label="Card navigation"
                onPrev={() => { setIndex((i) => Math.max(0, i - 1)); resetTrails(); }}
                onNext={() => next()}
                prevDisabled={index === 0}
              />
              {deck === 'mine' && (
                <Button onClick={gotIt} aria-label={`I know ${card?.word ?? 'this word'}, remove it`}>
                  Got it ✓ — I know this word
                </Button>
              )}
            </div>
          }
        />
      )}
    </main>
  );
}
