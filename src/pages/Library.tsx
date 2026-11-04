import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Tour, { TOURS_ENABLED } from '../components/Tour';
import type { TourTrack } from '../components/Tour';
import { Badge, Button, Field, inputClass } from '../components/ui';
import {
  apiUrl,
  getExamBest,
  getMyActivity,
  getProgressSummary,
  getRecommendations,
  listBooks,
  listLevels,
  listMisses,
  listMyClasses,
  listShelf,
  removeShelfBook,
  saveShelfBook,
} from '../lib/api';
import { assignedBooks, filterCatalog, levelsInCatalog } from '../lib/catalog';
import { collectClassWords } from '../lib/flashcards';
import type { CatalogBook, EnrolledClass, FocusTag, MyActivity, ProgressSummary, RecommendedBook, ShelfBook } from '../lib/api';
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
  const [levelFilter, setLevelFilter] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState<MyActivity | null>(null);
  // My progress card: counters only (books, flashes, exams). Signed out:
  // the summary 401s and the card stays hidden — never a sign-in nudge.
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  // Missed-word loop: how many stumbles await practice, and which books
  // drill them. Signed out: both 401 and stay hidden.
  const [missCount, setMissCount] = useState<number | null>(null);
  const [recs, setRecs] = useState<RecommendedBook[] | null>(null);
  const [myClasses, setMyClasses] = useState<EnrolledClass[] | null>(null);
  const [shelf, setShelf] = useState<ShelfBook[] | null>(null);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const startTab = params.get('tab');
  const [tab, setTab] = useState<'classes' | 'shelf' | 'books' | 'flashcards' | 'exams'>(
    startTab === 'shelf' || startTab === 'books' || startTab === 'flashcards' || startTab === 'exams'
      ? startTab
      : 'classes',
  );
  const belt = beltFor(best, passMark, total);
  const shelfLevels = books ? levelsInCatalog(books) : [];
  const visibleBooks = books ? filterCatalog(books, { query, level: levelFilter, tag: focusFilter }) : null;
  const filtersActive = query.trim() !== '' || levelFilter !== 'all' || focusFilter !== 'all';
  const clearFilters = () => {
    setQuery('');
    setLevelFilter('all');
    setFocusFilter('all');
  };
  const savedIds = new Set((shelf ?? []).map((b) => b.id));
  const assigned = assignedBooks(myClasses ?? []);
  const classWords = myClasses ? collectClassWords(myClasses) : [];
  async function toggleShelf(bookId: string) {
    setShelfError(null);
    try {
      if (savedIds.has(bookId)) {
        await removeShelfBook(bookId);
      } else {
        await saveShelfBook(bookId);
      }
      setShelf((await listShelf()).books);
    } catch {
      setShelfError('Could not update your shelf. Try again.');
    }
  }
  useEffect(() => {
    if (TOURS_ENABLED && !tourSeen(TOUR_KEY)) setTour('read');
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
    getProgressSummary()
      .then(setSummary)
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
    listMyClasses()
      .then((res) => setMyClasses(res.classes))
      .catch(() => setMyClasses([]));
    listShelf()
      .then((res) => setShelf(res.books))
      .catch(() => setShelf([]));
  }, []);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-4 sm:px-6 sm:pb-6">
      <h1 className="sr-only">Library</h1>
      {activity && (activity.streak > 0 || activity.finished.length > 0) ? (
        <section aria-label="Reading streak" className="rounded-md border border-accent-900 bg-accent-50 p-3">
          <p className="text-base" aria-live="polite">
            {activity.streak > 0 ? (
              <>🔥 {activity.streak}-day streak · {activity.totalDays} days reading</>
            ) : (
              <>Read today to start a streak · {activity.totalDays} days reading</>
            )}
          </p>
        </section>
      ) : null}
      {summary && (
        <section aria-label="My progress" className="mt-3 rounded-md border border-accent-900 bg-accent-50 p-3">
          <h2 className="font-display text-xl font-bold">My progress</h2>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-base">
            <li>📚 {summary.booksStarted} {summary.booksStarted === 1 ? 'book' : 'books'} started · {summary.booksFinished} finished</li>
            <li>🃏 {summary.flashSeen} cards practiced · {summary.flashKnown} words learned</li>
            <li>🥋 {summary.examAttempts} {summary.examAttempts === 1 ? 'test' : 'tests'} taken{summary.examBest !== null ? ` · best ${summary.examBest}` : ''}</li>
          </ul>
        </section>
      )}
      <div role="tablist" aria-label="Library sections" className="sticky top-[69px] z-30 -mx-4 mb-3 flex gap-2 bg-white px-4 py-2 sm:-mx-6 sm:px-6">
        {(['classes', 'shelf', 'books', 'flashcards', 'exams'] as const).map((t) => (
          <Button
            key={t}
            onClick={() => setTab(t)}
            variant={tab === t ? 'primary' : undefined}
            aria-selected={tab === t}
            role="tab"
          >
            {t === 'classes' ? 'Classes' : t === 'shelf' ? 'Shelf' : t === 'books' ? 'Books' : t === 'flashcards' ? 'Flashcards' : 'Exams'}
          </Button>
        ))}
      </div>
      {tab === 'classes' && (
      <section aria-label="My classes" role="tabpanel">
        {myClasses === null ? (
          <p>Loading classes…</p>
        ) : myClasses.length === 0 ? (
          <p className="text-stone-600">No classes yet — your teacher will add you to a class.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {myClasses.map((cls) => (
              <li key={cls.id} className="rounded-md border border-stone-200 bg-white p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <strong className="font-display text-xl font-bold">{cls.name}</strong>
                  <Badge status={cls.level} />
                </p>
                {cls.books.length === 0 ? (
                  <p className="mt-1 text-sm text-stone-600">No books assigned yet.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {cls.books.map((b) => (
                      <li key={b.book_id} className="flex items-center gap-3 rounded-md border border-stone-100 bg-white p-1">
                        {b.cover_url ? (
                          <img
                            src={apiUrl(b.cover_url)}
                            alt=""
                            className="h-12 w-10 shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-base font-bold">{b.title}</span>
                        <Link
                          to={`/s/${b.book_id}`}
                          className="shrink-0 rounded-md border border-stone-900 bg-white px-3 py-1 text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                        >
                          Read
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {cls.words.length > 0 && (
                  <p className="mt-2 text-sm text-stone-600">
                    <span className="font-bold text-stone-900">Words to practice:</span> {cls.words.join(' · ')}{' '}
                    <Link to="/practice/alphabet?deck=class" className="underline underline-offset-4">Practice</Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
      {tab === 'shelf' && (
      <section aria-label="My shelf" role="tabpanel">
        <h2 className="font-display text-xl font-bold">Assigned by my classes</h2>
        {myClasses === null ? (
          <p>Loading assigned books…</p>
        ) : assigned.length === 0 ? (
          <p className="mt-1 text-stone-600">Nothing assigned yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {assigned.map((b) => (
              <li key={b.book_id} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2">
                {b.cover_url ? (
                  <img
                    src={apiUrl(b.cover_url)}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base font-bold">{b.title}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge status={b.level} />
                    <span className="text-sm text-stone-600">from {b.classes.join(', ')}</span>
                  </span>
                </div>
                <Link
                  to={`/s/${b.book_id}`}
                  className="shrink-0 rounded-md border border-stone-900 bg-white px-4 py-2 text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                >
                  Read
                </Link>
              </li>
            ))}
          </ul>
        )}
        {classWords.length > 0 && (
          <>
            <h2 className="mt-4 font-display text-xl font-bold">Words to practice</h2>
            <p className="mt-1 text-sm text-stone-600">
              {classWords.map((w) => w.word).join(' · ')}{' '}
              <Link to="/practice/alphabet?deck=class" className="underline underline-offset-4">Practice</Link>
            </p>
          </>
        )}
        <h2 className="mt-4 font-display text-xl font-bold">Saved for later</h2>
        {shelfError && <p role="alert" className="mt-1 text-sm text-red-900">{shelfError}</p>}
        {shelf === null ? (
          <p>Loading saved books…</p>
        ) : shelf.length === 0 ? (
          <p className="mt-1 text-stone-600">Nothing saved yet — tap Save on any book in the Books tab.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {shelf.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2">
                {b.cover_url ? (
                  <img
                    src={apiUrl(b.cover_url)}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base font-bold">{b.title}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge status={b.level} />
                  </span>
                </div>
                <Link
                  to={`/s/${b.id}`}
                  className="shrink-0 rounded-md border border-stone-900 bg-white px-3 py-1 text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                >
                  Read
                </Link>
                <Button size="sm" onClick={() => void toggleShelf(b.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <h2 className="mt-4 font-display text-xl font-bold">Finished</h2>
        {activity && activity.finished.length > 0 ? (
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
        ) : (
          <p className="mt-1 text-stone-600">No finished books yet — finish a book to shelve it here.</p>
        )}
      </section>
      )}
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
        <div className="mb-2 flex items-end justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Published books</h2>
          {books && books.length > 0 && visibleBooks ? (
            <p className="text-sm text-stone-600" aria-live="polite">
              {visibleBooks.length} of {books.length} books
            </p>
          ) : null}
        </div>
        <div className="mb-2">
          <Field label="Search titles">
            <input
              type="search"
              className={inputClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type part of a title"
              autoComplete="off"
            />
          </Field>
        </div>
        {shelfLevels.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by level">
            {(['all', ...shelfLevels] as const).map((level) => (
              <Button
                key={level}
                onClick={() => setLevelFilter(level)}
                variant={levelFilter === level ? 'primary' : undefined}
                aria-pressed={levelFilter === level}
              >
                {level === 'all' ? 'All levels' : level}
              </Button>
            ))}
          </div>
        )}
        {focusOptions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by focus">
            {(['all', ...focusOptions] as const).map((f) => (
              <Button
                key={f}
                onClick={() => setFocusFilter(f)}
                variant={focusFilter === f ? 'primary' : undefined}
                aria-pressed={focusFilter === f}
              >
                {f === 'all' ? 'All focus' : f}
              </Button>
            ))}
          </div>
        )}
        {filtersActive && (
          <div className="mb-2">
            <Button onClick={clearFilters} size="sm">
              Clear search and filters
            </Button>
          </div>
        )}
        {books === null ? (
          <p>Loading books…</p>
        ) : books.length === 0 ? (
          <p className="text-stone-600">No published books yet — make one in the Studio.</p>
        ) : visibleBooks !== null && visibleBooks.length === 0 ? (
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <p className="text-base font-bold">No books match these filters.</p>
            <p className="text-sm text-stone-600">Try a different title, level, or focus.</p>
            <p className="mt-2">
              <Button onClick={clearFilters} size="sm">
                Clear search and filters
              </Button>
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(visibleBooks ?? []).map((b) => (
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
                <div className="flex shrink-0 flex-col gap-1">
                  <Link
                    to={`/s/${b.id}`}
                    className="rounded-md border border-stone-900 bg-white px-4 py-2 text-center text-base font-medium text-stone-900 underline decoration-stone-300 underline-offset-4"
                  >
                    Read
                  </Link>
                  <Button size="sm" onClick={() => void toggleShelf(b.id)} aria-pressed={savedIds.has(b.id)}>
                    {savedIds.has(b.id) ? 'Saved ✓' : 'Save'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {shelfError && <p role="alert" className="mt-2 text-sm text-red-900">{shelfError}</p>}
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
          {classWords.length > 0 && (
            <li className="rounded-md border border-stone-200 bg-white p-3">
              <p className="text-base font-bold">Class words · {classWords.length} to practice</p>
              <p className="text-sm text-stone-600">Words from your classes, at your class level.</p>
              <p className="mt-1">
                <Link to="/practice/alphabet?deck=class" className="underline underline-offset-4">Practice class words</Link>
              </p>
            </li>
          )}
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
