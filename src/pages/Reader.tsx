import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { aiMeanings, getBook } from '../lib/api';
import type { Book } from '../lib/api';

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
  const { id = '' } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meanings, setMeanings] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ word: string; meaning: string } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    getBook(id)
      .then((res) => setBook(res.book))
      .catch(() => setError('This book is not published yet.'));
  }, [id]);

  async function tap(raw: string) {
    if (!book || lookingUp) return;
    const word = clean(raw);
    if (!word) return;
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
      </p>
      {book.manifest.scenes.map((s) => (
        <section key={s.scene_number} style={{ marginBottom: 32 }}>
          <h3>Scene {s.scene_number}</h3>
          {s.image_url && (
            <img
              src={s.image_url}
              alt={`Scene ${s.scene_number} art`}
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
