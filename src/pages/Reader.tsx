import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { aiMeanings, getBook, getSharedBook } from '../lib/api';
import { getCachedBook, putBook } from '../lib/db';
import type { Book } from '../lib/api';

const CHUNK = 2;

const clean = (w: string) => w.toLowerCase().replace(/[^a-z'-]/g, '');

function Words({
  text,
  onTap,
  tapped,
}: {
  text: string;
  onTap: (word: string) => void;
  tapped: string | null;
}) {
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        /^\s+$/.test(part) || part === '' ? (
          <span key={i}>{part}</span>
        ) : (
          <button
            key={i}
            onClick={() => void onTap(part)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              textDecoration: clean(part) === tapped ? 'underline' : 'none',
            }}
          >
            {part}
          </button>
        ),
      )}
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
  const [lookingUp, setLookingUp] = useState(false);
  const [visible, setVisible] = useState(CHUNK);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const key = shareMode ? `s:${bookId}` : `p:${id}`;
    const load = shareMode ? getSharedBook(bookId) : getBook(id);
    load
      .then((res) => {
        setBook(res.book);
        setVisible(CHUNK);
        setActive(null);
        setOffline(false);
        setError(null);
        putBook(key, res.book).catch(() => {});
      })
      .catch(() =>
        getCachedBook(key).then((cached) => {
          if (cached) {
            setBook(cached);
            setVisible(CHUNK);
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

  useEffect(() => {
    if (!book || visible >= book.manifest.scenes.length) return;
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + CHUNK, book.manifest.scenes.length));
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [book, visible]);

  async function tap(raw: string) {
    if (!book || lookingUp) return;
    const word = clean(raw);
    if (!word) return;
    if (shareMode) {
      setActive({ word, meaning: 'Sign in to look up words.' });
      return;
    }
    if (meanings[word]) {
      setActive({ word, meaning: meanings[word] });
      return;
    }
    setLookingUp(true);
    try {
      const res = await aiMeanings([word], book.level);
      const meaning = res.meanings[0]?.meaning ?? 'No meaning found.';
      setMeanings((m) => ({ ...m, [word]: meaning }));
      setActive({ word, meaning });
    } catch {
      setActive({ word, meaning: 'Could not look up this word.' });
    } finally {
      setLookingUp(false);
    }
  }

  if (error) return <main><p>{error}</p></main>;
  if (!book) return <main><p>Loading…</p></main>;

  return (
    <main style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>{book.manifest.title}</h1>
      <p>
        Level {book.level} · {book.reading_level}
        {offline && ' · Offline copy'}
      </p>
      {book.manifest.scenes.slice(0, visible).map((s) => (
        <section key={s.scene_number} style={{ marginBottom: 32 }}>
          <h3>Scene {s.scene_number}</h3>
          {s.image_url && (
            <img
              src={s.image_url}
              alt={`Scene ${s.scene_number} art`}
              loading="lazy"
              style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'cover' }}
            />
          )}
          <p>
            <Words text={s.narration} onTap={(w) => void tap(w)} tapped={active?.word ?? null} />
          </p>
          {s.bubbles.map((b, bi) => (
            <p key={bi}>
              <strong>{b.speaker}: </strong>
              <Words text={b.text} onTap={(w) => void tap(w)} tapped={active?.word ?? null} />
            </p>
          ))}
        </section>
      ))}
      {visible < book.manifest.scenes.length && <div ref={moreRef}><p>Loading more…</p></div>}
      <div>
        {lookingUp ? (
          <p>Looking up…</p>
        ) : (
          active && (
            <p>
              <strong>{active.word}:</strong> {active.meaning}
            </p>
          )
        )}
      </div>
      <p>Tap any word to see its meaning.</p>
    </main>
  );
}
