import { useState } from 'react';
import Tour from '../components/Tour';
import { Button, Page } from '../components/ui';

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
  return (
    <Page title="Library">
      <p>
        Your published books will live here.{' '}
        <Button onClick={() => setTour(true)}>Replay tour</Button>
      </p>
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
