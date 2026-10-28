import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Tour from '../components/Tour';
import { Button, Page } from '../components/ui';
import { getExamBest } from '../lib/api';

const SEEN_KEY = 'e3-tour';

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
  useEffect(() => {
    getExamBest()
      .then((res) => {
        setBest(res.best);
        setTotal(res.total);
      })
      .catch(() => {});
  }, []);
  return (
    <Page title="Library">
      <p>
        Your published books will live here.{' '}
        <Button onClick={() => setTour(true)}>Replay tour</Button>
      </p>
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
