import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Tour from '../components/Tour';
import type { TourTrack } from '../components/Tour';
import { Badge, Button } from '../components/ui';
import { apiUrl, getExamBest, getMyActivity, getRecommendations, listBooks, listLevels, listMisses } from '../lib/api';
import type { CatalogBook, FocusTag, MyActivity, RecommendedBook } from '../lib/api';
import { BELT_LABEL, beltFor } from '../lib/belts';

const TOUR_KEY = 'e3-tour-library';
const CATALOG_KEY = 'e3-catalog';
const CATALOG_TTL = 24 * 3600 * 1000;

// Stale-while-revalidate: paint the last catalog instantly, refresh behind it.
function cachedCatalog(): CatalogBook[] | null {
  try {
    const raw = window.localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; books: CatalogBook[] };
    if (!Array.isArray(parsed.books) || Date.now() - parsed.at > CATALOG_TTL) return null;
    return parsed.books;
  } catch {
    return null;
  }
}

// First-visit tour, tracked per page: the Library offers the reader tour
// once, the Studio offers the creator tour once. A legacy global mark
// means the reader already toured, so it migrates without re-prompting.
function tourSeen(key: string): boolean {
  try {
    if (window.localStorage.getItem(key)) return true;
    if (key === TOUR_KEY && window.localStorage.getItem('e3-tour')) {
      window.localStorage.setItem(key, 'read');
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function markTourSeen(key: string, track: TourTrack): void {
  try {
    window.localStorage.setItem(key, track);
  } catch {
    /* private mode: tour simply shows again next visit */
  }
}

export default function Library() {
  // First visit to the Library: offer the reader tour once.
  const [tour, setTour] = useState<TourTrack | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [passMark, setPassMark] = useState(0);
  const [books, setBooks] = useState<CatalogBook[] | null>(() => cachedCatalog());
  const [focusOptions, setFocusOptions] = useState<FocusTag[]>([]);
  const [focusFilter, setFocusFilter] = useState<'all' | FocusTag>('all');
  const [activity, setActivity] = useState<MyActivity | null>(null);
  // Missed-word loop: how many stumbles await practice, and which books
  // drill them. Signed out: both 401 and stay hidden.
  const [missCount, setMissCount] = useState<number | null>(null);
  const [recs, setRecs] = useState<RecommendedBook[] | null>(null);
  const [params] = useSearchParams();
  const startTab = params.get('tab');
  const [tab, setTab] = useState<'books' | 'flashcards' | 'exams'>(
    startTab === 'flashcards' || startTab === 'exams' ? startTab : 'books',
  );
  const belt = beltFor(best, passMark, total);
  useEffect(() => {
    if (!tourSeen(TOUR_KEY)) setTour('read');
    getExamBest()
      .then((res) => {
        setBest(res.best);
        setTotal(res.total);
        setPassMark(res.passMark);
      })
      .catch(() => {});
    // Anonymous visitors get a 401 here: shelf simply stays hidden.
    getMyActivity()
      .then(setActivity)
      .catch(() => {});
    listMisses()
      .then((res) => setMissCount(res.misses.length))
      .catch(() => setMissCount(null));
    getRecommendations()
      .then((res) => setRecs(res.books))
      .catch(() => setRecs([]));
    listBooks()
      .then((res) => {
        setBooks(res.books);
        try {
          window.localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), books: res.books }));
        } catch {
          /* private mode: fresh fetch every visit */
        }
      })
      .catch(() => setBooks((b) => b ?? []));
    listLevels()
      .then((lists) => setFocusOptions(lists.focusTags))
      .catch(() => setFocusOptions([]));
  }, []);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-4 sm:px-6 sm:pb-6">
      <h1 className="sr-only">Library</h1>
      {activity && (activity.streak > 0 || activity.finished.length > 0) ? (
        <section aria-label="My shelf" className="rounded-md border border-accent-900 bg-accent-50 p-3">
          <h2 className="font-display text-xl font-bold">My shelf</h2>
          <p className="text-base" aria-live="polite">
            {activity.streak > 0 ? (
              <>🔥 {activity.streak}-day streak · {activity.totalDays} days reading</>
            ) : (
              <>Read today to start a streak · {activity.totalDays} days reading</>
            )}
          </p>
          {activity.finished.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {activity.finished.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/s/${b.id}`}
                    className="flex items-center gap-2 rounded-md border border-stone-200 bg-white p-1 pr-3"
                    aria-label={`Re-read ${b.title}`}
                  >
                    {b.cover_url ? (
                      <img
                        src={apiUrl(b.cover_url)}
                        alt=""
                        className="h-12 w-10 rounded object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="max-w-32 truncate text-sm font-bold">{b.title}</span>
                    <span aria-hidden="true" title="Finished">✓</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <div role="tablist" aria-label="Library sections" className="sticky top-[69px] z-30 -mx-4 mb-3 flex gap-2 bg-white px-4 py-2 sm:-mx-6 sm:px-6">
        {(['books', 'flashcards', 'exams'] as const).map((t) => (
          <Button
            key={t}
            onClick={() => setTab(t)}
            variant={tab === t ? 'primary' : undefined}
            aria-selected={tab === t}
            role="tab"
          >
            {t === 'books' ? 'Books' : t === 'flashcards' ? 'Flashcards' : 'Exams'}
          </Button>
        ))}
      </div>
      {tab === 'books' && (
      <section aria-label="Published books" role="tabpanel">
        {recs !== null && recs.length > 0 ? (
          <div className="mb-3 rounded-md border border-accent-900 bg-accent-50 p-3">
            <h2 className="font-display text-xl font-bold">Recommended for you</h2>
            <p className="text-sm text-stone-600">These books practice your trickiest words.</p>
            <ul className="mt-2 flex flex-col gap-2">
              {recs.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2">
                  {b.cover_url ? (
                    <img
                      src={apiUrl(b.cover_url)}
                      alt={`Cover of ${b.title}`}
                      className="h-20 w-16 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-base font-bold">{b.title}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge status={b.level} />
                      <span className="rounded border border-stone-200 px-1 text-sm text-stone-600">
                        practices: {b.matched.slice(0, 4).join(', ')}
                      </span>
                    </span>
                  </div>
                  <Link
                    to={`/s/${b.id}`}
                    className="shrink-0 rounded-md border border-stone-900 bg-white px-4 py-2 text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                  >
                    Read
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mb-2">
          <h2 className="font-display text-xl font-bold">Published books</h2>
        </div>
        {focusOptions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by focus">
            {(['all', ...focusOptions] as const).map((f) => (
              <Button
                key={f}
                onClick={() => setFocusFilter(f)}
                variant={focusFilter === f ? 'primary' : undefined}
                aria-pressed={focusFilter === f}
              >
                {f === 'all' ? 'All' : f}
              </Button>
            ))}
          </div>
        )}
        {books === null ? (
          <p>Loading books…</p>
        ) : books.length === 0 ? (
          <p className="text-stone-600">No published books yet — make one in the Studio.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {books
              .filter((b) => focusFilter === 'all' || (b.tags ?? []).includes(focusFilter))
              .map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2"
              >
                {b.cover_url ? (
                  <img
                    src={apiUrl(b.cover_url)}
                    alt={`Cover of ${b.title}`}
                    className="h-20 w-16 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base font-bold">{b.title}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge status={b.level} />
                    {(b.tags ?? []).map((t) => (
                      <span key={t} className="rounded border border-stone-200 px-1 text-sm text-stone-600">
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
                <Link
                  to={`/s/${b.id}`}
                  className="shrink-0 rounded-md border border-stone-900 bg-white px-4 py-2 text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                >
                  Read
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
      {tab === 'flashcards' && (
      <section aria-label="Flashcard decks" role="tabpanel">
        <h2 className="font-display text-xl font-bold">Flashcard decks</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {missCount !== null && missCount > 0 ? (
            <li className="rounded-md border border-accent-900 bg-accent-50 p-3">
              <p className="text-base font-bold">My words · {missCount} to practice</p>
              <p className="text-sm text-stone-600">Words you tapped in books or missed in tests. Say “Got it” to clear each one.</p>
              <p className="mt-1">
                <Link to="/practice/alphabet?deck=mine" className="underline underline-offset-4">Practice my words</Link>
              </p>
            </li>
          ) : null}
          <li className="rounded-md border border-stone-200 bg-white p-3">
            <p className="text-base font-bold">Phonics</p>
            <p className="text-sm text-stone-600">All 26 letter sounds. Hear each sound, say an example word.</p>
            <p className="mt-1">
              <Link to="/practice/alphabet?deck=letters" className="underline underline-offset-4">Practice phonics</Link>
            </p>
          </li>
          <li className="rounded-md border border-stone-200 bg-white p-3">
            <p className="text-base font-bold">Alphabet names</p>
            <p className="text-sm text-stone-600">A to Z by name. Hear “ay, bee, cee”, say each letter back.</p>
            <p className="mt-1">
              <Link to="/practice/alphabet?deck=names" className="underline underline-offset-4">Practice names</Link>
            </p>
          </li>
          <li className="rounded-md border border-stone-200 bg-white p-3">
            <p className="text-base font-bold">Letter teams</p>
            <p className="text-sm text-stone-600">sh, ch, th, ph, wh, ck, ng and more. Two letters, one sound.</p>
            <p className="mt-1">
              <Link to="/practice/alphabet?deck=teams" className="underline underline-offset-4">Practice teams</Link>
            </p>
          </li>
          {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((lvl) => (
            <li key={lvl} className="rounded-md border border-stone-200 bg-white p-3">
              <p className="text-base font-bold">{lvl} words</p>
              <p className="text-sm text-stone-600">Everyday words at {lvl} level, split into sounded parts.</p>
              <p className="mt-1">
                <Link to={`/practice/alphabet?deck=${lvl}`} className="underline underline-offset-4">Practice {lvl}</Link>
              </p>
            </li>
          ))}
        </ul>
      </section>
      )}
      {tab === 'exams' && (
      <section aria-label="Practice test" role="tabpanel" className="rounded-md border border-stone-300 bg-white p-3">
        <h2 className="font-display text-xl font-bold">Practice test: A1</h2>
        <p className="text-sm text-stone-600">
          {total > 0 ? `${total} questions` : 'Sample questions at A1 level'}
          {best !== null ? ` · your best: ${best}/${total}` : ' · not taken yet'}
          {belt !== 'none' ? ` · 🥋 ${BELT_LABEL[belt]}` : ''}
        </p>
        <p>
          <Link to="/exam" className="underline underline-offset-4">
            {best !== null ? 'Take it again' : 'Take the practice test'}
          </Link>
        </p>
      </section>
      )}
      <p className="mt-4 text-sm text-stone-600">
        <button
          type="button"
          onClick={() => setTour('read')}
          className="underline underline-offset-4"
        >
          Take the library tour
        </button>
      </p>
      {tour && (
        <Tour
          track={tour}
          onClose={() => {
            markTourSeen(TOUR_KEY, tour);
            setTour(null);
          }}
        />
      )}
    </main>
  );
}
