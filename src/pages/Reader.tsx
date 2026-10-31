import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { aiMeanings, getBook, getPosition, getSharedBook, setPosition } from '../lib/api';
import { getCachedBook, putBook } from '../lib/db';
import type { Book } from '../lib/api';
import { cleanWord, stopSpeaking } from '../lib/speech';
import { isContentWord } from '../lib/words';
import { Button } from '../components/ui';
import { ReadAloudPanel } from '../components/ReadAloud';
import { ListenPanel } from '../components/ListenPanel';
import { QuizPanel } from '../components/Quiz';
import { BuddyPanel } from '../components/Buddy';

const clean = cleanWord;

function Words({
  text,
  onTap,
  tapped,
  base = 0,
  heardCount = 0,
  spoken,
  current = null,
}: {
  text: string;
  onTap: (word: string) => void;
  tapped: string | null;
  // Position of this segment's first word in page order; words before
  // base + heardCount were read (in order) and highlight.
  base?: number;
  heardCount?: number;
  // Listen mode trail: spoken display indices glow yellow, the word being
  // spoken right now glows brighter.
  spoken?: Set<number>;
  current?: number | null;
}) {
  // Ordinal of the next real word in this segment. Punctuation-only
  // tokens consume no index, matching the order array (empties filtered).
  let at = 0;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        if (/^\s+$/.test(part) || part === '') return <span key={i}>{part}</span>;
        const w = clean(part);
        if (w === '') return <span key={i}>{part}</span>;
        const idx = base + at++;
        const isCur = current !== null && idx === current;
        const isRead = idx < heardCount || spoken?.has(idx);
        const hl = isCur ? ' bg-amber-400' : isRead ? ' bg-yellow-300' : '';
        // Only content words invite a lookup; glue words render plainly
        // (but still highlight when read).
        if (!isContentWord(w)) {
          return (
            <span key={i} className={`rounded-sm px-1 py-0.5${hl}`}>
              {part}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => void onTap(part)}
            aria-label={`Look up ${w}`}
            aria-current={isCur || undefined}
            className={`min-h-0 cursor-pointer rounded-sm px-1 py-0.5 text-left underline-offset-4 ${
              w === tapped ? 'underline decoration-2' : 'underline decoration-dotted decoration-stone-500'
            }${hl}`}
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

export default function Reader() {
  const { id = '', bookId = '' } = useParams();
  const shareMode = bookId !== '';
  const [book, setBook] = useState<Book | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meanings, setMeanings] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ word: string; meaning: string } | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [current, setCurrent] = useState(0);
  // How many page words (in reading order) the mic has heard so far.
  const [liveCount, setLiveCount] = useState(0);
  // Listen mode trail: words the speaker has already read, plus the one
  // being spoken right now (null when idle). Display word indices.
  const [listenSet, setListenSet] = useState<Set<number>>(new Set());
  const [listenCur, setListenCur] = useState<number | null>(null);
  // Set when a lookup gets a 401: the visitor is signed out, so later taps
  // and prefetches skip the call and show the sign-in prompt directly.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const prefetching = useRef(false);
  const lastMoveRef = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [buddy, setBuddy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const buddyRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [, setPassed] = useState<Set<number>>(new Set());

  useEffect(() => stopSpeaking, []);

  // Felt-speed: warm the next page's art while reading this one, so page
  // turns never wait on the image. scenes[current] is the page after the
  // current 1-based page (cover 0 warms page 1); past the end there is none.
  useEffect(() => {
    const next = book?.manifest.scenes[current];
    const url = next?.image_url;
    if (typeof url !== 'string' || url === '') return;
    const img = new Image();
    img.src = url;
  }, [book, current]);

  // Tap anywhere outside the open word bubble — another word, the buddy
  // icon, the Listen/Read buttons, artwork — to dismiss it. A listener (not
  // an overlay) so the tapped control still receives its own tap.
  useEffect(() => {
    if (!active) return;
    function onDown(e: PointerEvent) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) setActive(null);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [active]);

  // Warm the meaning cache for the whole book on open: unique content
  // words across all pages, chunked to the server's 20-word cap, so every
  // tap resolves instantly — even on fast page turns. A 6-page book is
  // typically 2 calls total, fewer than one call per page turn.
  useEffect(() => {
    if (!book || needsSignIn || offline || prefetching.current) return;
    const fresh = [
      ...new Set(
        book.manifest.scenes
          .flatMap((sc) => [sc.narration, ...sc.bubbles.map((b) => b.text)])
          .flatMap((t) => t.split(/\s+/).map((w) => clean(w)))
          .filter((w) => w !== '' && isContentWord(w) && !meanings[w]),
      ),
    ];
    if (fresh.length === 0) return;
    prefetching.current = true;
    const chunks: string[][] = [];
    for (let i = 0; i < fresh.length; i += 20) chunks.push(fresh.slice(i, i + 20));
    Promise.all(chunks.map((c) => aiMeanings(c, book.level)))
      .then((all) => {
        setMeanings((m) => {
          const next = { ...m };
          for (const res of all) {
            for (const e of res.meanings) {
              if (e?.word && e.meaning && !(e.word in next)) next[e.word] = e.meaning;
            }
          }
          return next;
        });
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.message === 'unauthorized') setNeedsSignIn(true);
      })
      .finally(() => {
        prefetching.current = false;
      });
  }, [book, meanings, needsSignIn, offline]);

  useEffect(() => {
    const key = shareMode ? `s:${bookId}` : `p:${id}`;
    const load = shareMode ? getSharedBook(bookId) : getBook(id);
    load
      .then((res) => {
        setBook(res.book);
        setCurrent(0);
        setActive(null);
        setMeanings({});
        setNeedsSignIn(false);
        setPassed(new Set());
        setOffline(false);
        setError(null);
        lastMoveRef.current = 0;
        putBook(key, res.book).catch(() => {});
      })
      .catch(() =>
        getCachedBook(key).then((cached) => {
          if (cached) {
            setBook(cached);
            setCurrent(0);
            setOffline(true);
          } else {
            setError(
              shareMode
                ? 'This link is invalid or the book was removed.'
                : 'This book is not published yet.',
            );
          }
        }),
      );
  }, [id, bookId, shareMode]);

  // Live sync: follow someone else reading along; 15s grace after a local move.
  useEffect(() => {
    if (!book) return;
    const t = setInterval(() => {
      getPosition(book.id)
        .then((p) => {
          // Never yank the reader off the cover; follow only between scenes.
          if (current > 0 && p.scene_number !== current && Date.now() - lastMoveRef.current > 15000) {
            go(p.scene_number);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [book, current]);

  function go(n: number) {
    if (!book) return;
    const clamped = Math.min(Math.max(0, n), book.manifest.scenes.length);
    stopSpeaking();
    setActive(null);
    setLiveCount(0);
    setListenSet(new Set());
    setListenCur(null);
    // Collapse the buddy menu: each page starts with Pip closed, so the
    // learner re-taps the buddy icon to show that page's icons.
    setVoiceOpen(false);
    setCurrent(clamped);
    lastMoveRef.current = Date.now();
    panelRef.current?.scrollIntoView({ block: 'start' });
    if (!offline) setPosition(book.id, clamped).catch(() => {});
  }

  // The meaning bubble always drops from Pip (the buddy button), like Pip
  // is telling the learner the word — never from the bottom of the screen.
  function placeFromBuddy() {
    const btn = buddyRef.current;
    if (!btn) {
      setAnchor(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    const w = 240;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    setAnchor({ left, top: r.bottom + 8 + window.scrollY });
  }

  async function tap(raw: string) {
    if (!book || lookingUp) return;
    const word = clean(raw);
    if (!word) return;
    // A word tap owns the buddy corner: tuck the voice menu away so the
    // bubble never overlaps the Listen/Read buttons.
    setVoiceOpen(false);
    placeFromBuddy();
    if (active?.word === word) {
      setActive(null);
      return;
    }
    if (meanings[word]) {
      setActive({ word, meaning: meanings[word] });
      return;
    }
    // Prefetch already learned the visitor is signed out: skip the call.
    if (needsSignIn) {
      setActive({ word, meaning: 'Sign in to 3E to look up words.' });
      return;
    }
    // No blanket share-link block: signed-in visitors (session cookie) get
    // real lookups; only a 401 from the server shows the sign-in prompt.
    setLookingUp(true);
    try {
      const res = await aiMeanings([word], book.level);
      const meaning = res.meanings[0]?.meaning ?? 'No meaning found.';
      setMeanings((m) => ({ ...m, [word]: meaning }));
      setActive({ word, meaning });
    } catch (e) {
      setActive({
        word,
        meaning:
          e instanceof Error && e.message === 'unauthorized'
            ? 'Sign in to 3E to look up words.'
            : 'Could not look up this word.',
      });
    } finally {
      setLookingUp(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <p role="alert" className="rounded-md border border-stone-900 bg-stone-100 px-3 py-2">
          <strong>Error: </strong>
          {error}
        </p>
      </main>
    );
  }
  if (!book) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <p>Loading…</p>
      </main>
    );
  }

  const scene = book.manifest.scenes[current - 1];
  const total = book.manifest.scenes.length;
  // Page words in reading order (narration, then speaker + text per bubble),
  // cleaned the same way as speech transcripts for sequential matching.
  const order: string[] = [];
  if (scene) {
    for (const w of scene.narration.split(/\s+/)) {
      const c = clean(w);
      if (c !== '') order.push(c);
    }
    for (const b of scene.bubbles) {
      for (const w of `${b.speaker} ${b.text}`.split(/\s+/)) {
        const c = clean(w);
        if (c !== '') order.push(c);
      }
    }
  }
  // Exact string the speaker reads (speakers included), plus a map from
  // each raw spoken token to its display word index. Punctuation-only
  // tokens map to the following word's index; both sides count raw tokens
  // identically so boundary ordinals land on the right word.
  const listenText = scene
    ? [scene.narration, ...scene.bubbles.map((b) => `${b.speaker}: ${b.text}`)].join(' ')
    : '';
  const wordMap: number[] = [];
  if (scene) {
    let display = 0;
    for (const tok of listenText.split(/\s+/)) {
      if (tok === '') continue;
      wordMap.push(display);
      if (clean(tok) !== '') display++;
    }
  }
  const countWords = (t: string) => t.split(/\s+/).map((w) => clean(w)).filter((w) => w !== '').length;
  const narrationCount = scene ? countWords(scene.narration) : 0;
  const bubbleBase: number[] = [];
  {
    let base = narrationCount;
    for (const b of scene?.bubbles ?? []) {
      bubbleBase.push(base);
      base += countWords(`${b.speaker} ${b.text}`);
    }
  }

  return (
    <main className="relative mx-auto w-full max-w-xl px-3 pb-1 pt-2">
      {current === 0 ? (
        <section aria-label={`Cover: ${book.manifest.title}`} className="mb-0">
          {book.manifest.cover ? (
            <div className="relative">
              <img
                src={book.manifest.cover}
                alt={`Cover of ${book.manifest.title}`}
                loading="lazy"
                className="max-h-[calc(100dvh-80px)] w-full rounded-md object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 rounded-b-md p-4 font-semibold text-black [-webkit-text-stroke:4px_white] [paint-order:stroke_fill]">
                <h1 className="font-display text-3xl font-bold">{book.manifest.title}</h1>
                <p className="text-base">
                  Level {book.level} · {book.reading_level}
                  {offline && ' · Offline copy'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h1 className="font-display text-3xl font-bold">{book.manifest.title}</h1>
              <p className="mb-2 text-base">
                Level {book.level} · {book.reading_level}
                {offline && ' · Offline copy'}
              </p>
            </>
          )}
        </section>
      ) : scene ? (
        <section ref={panelRef} aria-label={`Page ${scene.scene_number} of ${total}`} className="mb-1 scroll-mt-4">
          <div className="relative overflow-hidden rounded-md bg-stone-200">
            <button
              ref={buddyRef}
              type="button"
              onClick={() => {
                // Opening Pip's menu dismisses any open word bubble, and the
                // bubble's own tap-outside handler re-hides it on later taps.
                setActive(null);
                setVoiceOpen((v) => !v);
              }}
              aria-expanded={voiceOpen}
              aria-label={voiceOpen ? 'Hide listen and read aloud options' : 'Show listen and read aloud options'}
              title="Listen or read aloud"
              className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-accent-900 text-white shadow-lg"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 5h16v11H9l-5 4V5z"
                  fill="currentColor"
                  opacity="0.9"
                />
                <circle cx="9" cy="10" r="1.2" fill="#0c4a4a" />
                <circle cx="13" cy="10" r="1.2" fill="#0c4a4a" />
                <path d="M9.5 13.5c1.5 1 3.5 1 5 0" stroke="#0c4a4a" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            {voiceOpen && (
              <div className="absolute right-2 top-14 z-20 flex max-w-[calc(100%-1rem)] flex-col items-end gap-1 bg-transparent text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] [&>div]:w-fit [&>div]:max-w-full">
                <ListenPanel
                  sceneNumber={scene.scene_number}
                  text={listenText}
                  wordMap={wordMap}
                  onSpeakStart={() => {
                    setListenSet(new Set());
                    setListenCur(null);
                    setLiveCount(0);
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
                  sceneNumber={scene.scene_number}
                  text={[scene.narration, ...scene.bubbles.map((b) => b.text)].join(' ')}
                  order={order}
                  onPass={(n) => setPassed((p) => new Set(p).add(n))}
                  onLookup={(w) => void tap(w)}
                  onProgress={setLiveCount}
                  onStart={() => {
                    setListenSet(new Set());
                    setListenCur(null);
                  }}
                />
              </div>
            )}
            {scene.image_url && (
              <img
                src={scene.image_url}
                alt={`Page ${scene.scene_number} art`}
                loading="lazy"
                className="w-full"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 p-3 font-semibold text-black [-webkit-text-stroke:4px_white] [paint-order:stroke_fill]">
              <p className="mb-1 text-lg leading-snug">
                <Words text={scene.narration} onTap={(w) => void tap(w)} tapped={active?.word ?? null} base={0} heardCount={liveCount} spoken={listenSet} current={listenCur} />
              </p>
              {scene.bubbles.map((b, bi) => (
                <p key={bi} className="text-lg leading-snug">
                  <strong>{b.speaker}: </strong>
                  <Words text={b.text} onTap={(w) => void tap(w)} tapped={active?.word ?? null} base={(bubbleBase[bi] ?? 0) + countWords(b.speaker)} heardCount={liveCount} spoken={listenSet} current={listenCur} />
                </p>
              ))}
            </div>
          </div>
          {null}
        </section>
      ) : null}
      {!shareMode && current > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => setQuiz((q) => !q)} aria-pressed={quiz} pressed={quiz}>
            {quiz ? 'Hide quiz' : 'Quiz me on this book'}
          </Button>
          <Button onClick={() => setBuddy((b) => !b)} aria-pressed={buddy} pressed={buddy}>
            {buddy ? 'Hide Pip' : 'Ask Pip'}
          </Button>
        </div>
      )}
      {!shareMode && quiz && current > 0 && (
        <div className="mb-4">
          <QuizPanel projectId={id} />
        </div>
      )}
      {!shareMode && buddy && current > 0 && (
        <div className="mb-4">
          <BuddyPanel projectId={id} />
        </div>
      )}
      <nav
        aria-label="Page navigation"
        className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-stone-200 bg-white py-2"
      >
        <Button onClick={() => go(current - 1)} disabled={current <= 0} aria-label="Previous page">
          ← Prev
        </Button>
        <p className="text-sm font-medium text-stone-700" aria-live="polite">
          {current === 0 ? 'Cover' : `Page ${current} of ${total}`}
        </p>
        <Button
          onClick={() => go(current + 1)}
          disabled={current >= total}
          variant="primary"
          aria-label="Next page"
        >
          Next →
        </Button>
      </nav>
      {active && (
        <div
          ref={bubbleRef}
          role="status"
          aria-live="polite"
          className="absolute z-50 w-60 max-w-[calc(100vw-1rem)] rounded-lg bg-stone-900 p-3 text-white shadow-lg"
          style={
            anchor
              ? { left: anchor.left, top: anchor.top }
              : { left: '50%', top: 64, transform: 'translateX(-50%)' }
          }
        >
          <div aria-hidden="true" className="absolute -top-1 right-8 h-4 w-4 rotate-45 bg-stone-900" />
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-stone-300">Pip says</p>
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close meaning"
              className="min-h-[44px] min-w-[44px] rounded text-xl leading-none"
            >
              ×
            </button>
          </div>
          <p className="text-lg">
            <strong>{active.word}</strong>
          </p>
          <p className="text-base">{lookingUp ? 'Looking up…' : active.meaning}</p>
        </div>
      )}
    </main>
  );
}
