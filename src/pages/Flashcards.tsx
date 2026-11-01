import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aiMeanings, listLevels, voiceLang } from '../lib/api';
import { ALPHABET, DIGRAPHS, letterListenText, splitSyllables, wordsByLevel } from '../lib/phonics';
import { Button } from '../components/ui';
import { PageNav, PageShell } from '../components/PageShell';
import { Words } from '../components/Words';
import { ReadAloudPanel } from '../components/ReadAloud';
import { ListenPanel } from '../components/ListenPanel';
import { BuddyCorner } from '../components/BuddyVoice';

interface Card {
  word: string;
  meaning: string;
  // What the card shows big: the letter or digraph. The read target stays
  // a real example word (isolated phonemes transcribe too poorly to score).
  display: string[];
  listenText: string;
  wordMap: number[];
  readText: string;
  order: string[];
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

function bookCard(word: string, meaning: string): Card {
  const display = splitSyllables(word);
  return {
    word,
    meaning,
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
// Meanings load lazily on flip (one word per tap) so the B2 deck never
// prefetches thousands of glosses at once.
type DeckKey = 'letters' | 'names' | 'teams' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
const DECK_LABEL: Record<DeckKey, string> = {
  letters: 'Phonics', names: 'Alphabet', teams: 'Letter teams', A1: 'A1 words', A2: 'A2 words', B1: 'B1 words', B2: 'B2 words', C1: 'C1 words', C2: 'C2 words',
};
// Meaning lookup rides the deck's own level so glosses match the learner.
const DECK_LEVEL: Record<DeckKey, string> = {
  letters: 'A1', names: 'A1', teams: 'A1', A1: 'A1', A2: 'A2', B1: 'B1', B2: 'B2', C1: 'C1', C2: 'C2',
};
export default function Flashcards() {
  const [params] = useSearchParams();
  const initial = params.get('deck');
  const startDeck: DeckKey = initial === 'names' || initial === 'teams' || initial === 'A1' || initial === 'A2' || initial === 'B1' || initial === 'B2' || initial === 'C1' || initial === 'C2' ? initial : 'letters';
  const [decks, setDecks] = useState<Record<DeckKey, Card[]> | null>(null);
  const [deck] = useState<DeckKey>(startDeck);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Buddy corner, same as the Reader: Pip sits on the card, tap to open
  // Listen and Read. No scores, no counts — just practice.
  // Listen trail (which sound is playing) and read trail (example word
  // matched so far), like the Reader page.
  const [listenSet, setListenSet] = useState<Set<number>>(new Set());
  const [listenCur, setListenCur] = useState<number | null>(null);
  const [liveCount, setLiveCount] = useState(0);

  // Decks build from the server word lists with blank meanings; each
  // meaning arrives on first flip (single-word lookup, DB-first, one
  // model call at most).
  useEffect(() => {
    let cancelled = false;
    listLevels()
      .then((lists) => {
        if (cancelled) return;
        const byLevel = wordsByLevel(lists);
        setDecks({
          letters: shuffle(ALPHABET.map((s) => soundCard(s.sound, s.example, ''))),
          names: shuffle(ALPHABET.map((s) => nameCard(s.sound.toUpperCase(), s.example, ''))),
          teams: shuffle(DIGRAPHS.map((s) => soundCard(s.sound, s.example, ''))),
          A1: shuffle(byLevel.A1.map((w) => bookCard(w, ''))),
          A2: shuffle(byLevel.A2.map((w) => bookCard(w, ''))),
          B1: shuffle(byLevel.B1.map((w) => bookCard(w, ''))),
          B2: shuffle(byLevel.B2.map((w) => bookCard(w, ''))),
          C1: shuffle(byLevel.C1.map((w) => bookCard(w, ''))),
          C2: shuffle(byLevel.C2.map((w) => bookCard(w, ''))),
        });
      })
      .catch(() => {
        // Lists unreachable (offline): sound decks still work, level decks wait.
        if (!cancelled) setDecks({
          letters: shuffle(ALPHABET.map((s) => soundCard(s.sound, s.example, ''))),
          names: shuffle(ALPHABET.map((s) => nameCard(s.sound.toUpperCase(), s.example, ''))),
          teams: shuffle(DIGRAPHS.map((s) => soundCard(s.sound, s.example, ''))),
          A1: [], A2: [], B1: [], B2: [], C1: [], C2: [],
        });
      });
    return () => { cancelled = true; };
  }, []);

  const flip = (open: boolean) => {
    setFlipped(open);
    if (open && card && card.meaning === '') {
      const at = index;
      const key = deck;
      aiMeanings([card.word], DECK_LEVEL[key])
        .then((res) => {
          const meaning = res.meanings[0]?.meaning ?? '';
          if (!meaning) return;
          setDecks((d) => {
            if (!d) return d;
            const list = d[key].map((c, i) => (i === at ? { ...c, meaning: key === 'names' ? `Letter ${c.display[0]} — ${meaning}` : key === 'letters' || key === 'teams' ? `as in ${c.word} — ${meaning}` : meaning } : c));
            return { ...d, [key]: list };
          });
        })
        .catch(() => {});
    }
  };

  const cards = decks?.[deck] ?? null;
  const card = cards?.[index] ?? null;
  const done = cards !== null && index >= cards.length;

  const resetTrails = () => {
    setFlipped(false);
    setListenSet(new Set());
    setListenCur(null);
    setLiveCount(0);
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
                const isWord = deck === 'A1' || deck === 'A2' || deck === 'B1' || deck === 'B2' || deck === 'C1' || deck === 'C2';
                if (!isWord) {
                  return (
                    <p className="w-full break-words px-2 text-center text-[clamp(9rem,32dvh,22rem)] font-bold leading-none">
                      <Words
                        text={pageText}
                        onTap={() => flip(true)}
                        tapped={null}
                        heardCount={liveCount}
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
                  <p
                    className="w-full max-w-full whitespace-nowrap px-2 text-center font-bold leading-none"
                    style={{ fontSize: `clamp(2.5rem, calc(min(88vw, 55dvh) / ${0.62 * chars}), 7rem)` }}
                  >
                    <Words
                      text={pageText}
                      onTap={() => flip(true)}
                      tapped={null}
                      heardCount={liveCount}
                      spoken={listenSet}
                      current={listenCur}
                      plain
                      colorful
                      colorOffset={index}
                    />
                  </p>
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
                  <ReadAloudPanel
                    key={`read-${index}`}
                    sceneNumber={index}
                    text={card.readText}
                    order={card.order}
                    recognitionLang={voiceLang(undefined)}
                    onPass={() => next()}
                    onLookup={() => flip(true)}
                    onProgress={setLiveCount}
                    onStart={() => {
                      setListenSet(new Set());
                      setListenCur(null);
                    }}
                  />
              </BuddyCorner>
            </>
          }
          nav={
            <PageNav
              label="Card navigation"
              onPrev={() => { setIndex((i) => Math.max(0, i - 1)); resetTrails(); }}
              onNext={() => next()}
              prevDisabled={index === 0}
            />
          }
        />
      )}
    </main>
  );
}
