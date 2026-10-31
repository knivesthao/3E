import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Tour from '../components/Tour';
import { Badge, Button, Page } from '../components/ui';
import { getExamBest, getMyActivity, listBooks } from '../lib/api';
import type { CatalogBook, MyActivity } from '../lib/api';

const SEEN_KEY = 'e3-tour';
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

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'done';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, 'done');
  } catch {
    /* private mode: tour simply shows again next visit */
  }
}

export default function Library() {
  const [tour, setTour] = useState(() => !seen());
  const [best, setBest] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [books, setBooks] = useState<CatalogBook[] | null>(() => cachedCatalog());
  const [activity, setActivity] = useState<MyActivity | null>(null);
  useEffect(() => {
    getExamBest()
      .then((res) => {
        setBest(res.best);
        setTotal(res.total);
      })
      .catch(() => {});
    // Anonymous visitors get a 401 here: shelf simply stays hidden.
    getMyActivity()
      .then(setActivity)
      .catch(() => {});
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
  }, []);
  return (
    <Page title="Library">
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
                        src={b.cover_url}
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
      <section aria-label="Published books">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Published books</h2>
          <Button onClick={() => setTour(true)}>Replay tour</Button>
        </div>
        {books === null ? (
          <p>Loading books…</p>
        ) : books.length === 0 ? (
          <p className="text-stone-600">No published books yet — make one in the Studio.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {books.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2"
              >
                {b.cover_url ? (
                  <img
                    src={b.cover_url}
                    alt={`Cover of ${b.title}`}
                    className="h-20 w-16 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base font-bold">{b.title}</span>
                  <span>
                    <Badge status={b.level} />
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
      <section aria-label="Practice test" className="rounded-md border border-stone-300 bg-white p-3">
        <h2 className="font-display text-xl font-bold">Practice test: A1</h2>
        <p className="text-sm text-stone-600">
          {total > 0 ? `${total} questions` : 'Sample questions at A1 level'}
          {best !== null ? ` · your best: ${best}/${total}` : ' · not taken yet'}
        </p>
        <p>
          <Link to="/exam" className="underline underline-offset-4">
            {best !== null ? 'Take it again' : 'Take the practice test'}
          </Link>
        </p>
      </section>
      {tour && (
        <Tour
          onClose={() => {
            markSeen();
            setTour(false);
          }}
        />
      )}
    </Page>
  );
}
