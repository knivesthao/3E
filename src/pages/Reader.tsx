import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aiMeanings, apiUrl, getBook, getPosition, getSharedBook, recordMiss, setPosition, voiceLang } from '../lib/api';
import { getCachedBook, putBook } from '../lib/db';
import type { Book } from '../lib/api';
import { cleanWord, stopSpeaking } from '../lib/speech';
import { isContentWord } from '../lib/words';
import { Button } from '../components/ui';
import { ReadAloudPanel } from '../components/ReadAloud';
import { ListenPanel } from '../components/ListenPanel';
import { QuizPanel } from '../components/Quiz';
import { BuddyPanel } from '../components/Buddy';
import { BuddyCorner } from '../components/BuddyVoice';
import { ShareClipPanel } from '../components/ShareClip';
import { Words } from '../components/Words';
import { PageNav, PageShell } from '../components/PageShell';

const clean = cleanWord;

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
  // Karaoke guards: which page the take started on, and where the reader
  // is now. A natural finish only turns the page when both still agree.
  const listenSceneRef = useRef(0);
  const currentRef = useRef(current);
  currentRef.current = current;
  // Set when a lookup gets a 401: the visitor is signed out, so later taps
  // and prefetches skip the call and show the sign-in prompt directly.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const prefetching = useRef(false);
  // Missed-word loop: one record per tapped word per book-open (taps are
  // the "I don't know this" signal; the gloss prefetch is not). Anonymous
  // taps 401 and are ignored — no sign-in prompt from a background write.
  const missLogged = useRef(new Set<string>());
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
        missLogged.current = new Set();
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

  // A tap with a real gloss means the reader stumbled: record one miss
  // per word per book-open. Failures and sign-in prompts never record.
  function noteMiss(word: string) {
    if (shareMode || missLogged.current.has(word)) return;
    missLogged.current.add(word);
    if (book) void recordMiss(word, book.level, 'reader').catch(() => {});
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
      noteMiss(word);
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
      if (meaning !== 'No meaning found.') {
        setMeanings((m) => ({ ...m, [word]: meaning }));
        noteMiss(word);
      }
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
    <main className="relative mx-auto w-full max-w-xl">
      {current === 0 ? (
        <PageShell
          label={`Cover: ${book.manifest.title}`}
          media={
            book.manifest.cover ? (
              <>
                <img
                  src={apiUrl(book.manifest.cover)}
                  alt={`Cover of ${book.manifest.title}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 p-4 font-semibold text-black [-webkit-text-stroke:4px_white] [paint-order:stroke_fill]">
                  <h1 className="font-display text-3xl font-bold">{book.manifest.title}</h1>
                  <p className="text-base">
                    Level {book.level} · {book.reading_level}
                    {offline && ' · Offline copy'}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-stone-200 p-6 text-center">
                <h1 className="font-display text-3xl font-bold">{book.manifest.title}</h1>
                <p className="mb-2 text-base">
                  Level {book.level} · {book.reading_level}
                  {offline && ' · Offline copy'}{' '}
                  <Link to="/practice/alphabet">Alphabet</Link>
                </p>
              </div>
            )
          }
          nav={
            <PageNav
              label="Page navigation"
              onPrev={() => go(current - 1)}
              onNext={() => go(current + 1)}
              prevDisabled
              nextDisabled={current >= total}
              status="Cover"
            />
          }
        />
      ) : scene ? (
        <PageShell
          label={`Page ${scene.scene_number} of ${total}`}
          sectionRef={panelRef}
          media={
            <>
            {scene.image_url && (
              <img
                src={apiUrl(scene.image_url)}
                alt={`Page ${scene.scene_number} art`}
                loading="lazy"
                className="h-full w-full object-cover"
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
            </>
          }
          overlay={
            <>
            <BuddyCorner
              open={voiceOpen}
              buttonRef={buddyRef}
              toggleLabel={voiceOpen ? 'Hide listen and read aloud options' : 'Show listen and read aloud options'}
              onToggle={() => {
                // Opening Pip's menu dismisses any open word bubble, and the
                // bubble's own tap-outside handler re-hides it on later taps.
                setActive(null);
                setVoiceOpen((v) => !v);
              }}
            >
                <ListenPanel
                  sceneNumber={scene.scene_number}
                  text={listenText}
                  wordMap={wordMap}
                  speechLang={voiceLang(book.lang)}
                  onSpeakStart={(scene) => {
                    listenSceneRef.current = scene;
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
                  onEnded={(scene) => {
                    // Turn the page only if the reader never left it: manual
                    // turns and live-sync follows move current first, and the
                    // panel unmounts with the menu, so a stale finish dies here.
                    if (scene === currentRef.current && listenSceneRef.current === currentRef.current && scene < total) {
                      go(scene + 1);
                    }
                  }}
                />
                <ReadAloudPanel
                  sceneNumber={scene.scene_number}
                  text={[scene.narration, ...scene.bubbles.map((b) => b.text)].join(' ')}
                  order={order}
                  onPass={(n) => setPassed((p) => new Set(p).add(n))}
                  recognitionLang={voiceLang(book.lang)}
                  onLookup={(w) => void tap(w)}
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
              label="Page navigation"
              onPrev={() => go(current - 1)}
              onNext={() => go(current + 1)}
              prevDisabled={current <= 0}
              nextDisabled={current >= total}
              status={current === 0 ? 'Cover' : `Page ${current} of ${total}`}
            />
          }
        />
      ) : null}
      {!shareMode && current > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => setQuiz((q) => !q)} aria-pressed={quiz} pressed={quiz}>
            {quiz ? 'Hide quiz' : 'Quiz me on this book'}
          </Button>
          <Button onClick={() => setBuddy((b) => !b)} aria-pressed={buddy} pressed={buddy}>
            {buddy ? 'Hide Pip' : 'Ask Pip'}
          </Button>
          {scene?.image_url ? (
            <ShareClipPanel
              imageUrl={apiUrl(scene.image_url)}
              title={book.manifest.title}
              pageLabel={`page-${scene.scene_number}`}
            />
          ) : null}
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
