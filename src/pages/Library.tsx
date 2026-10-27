import { useState } from 'react';
import Tour from '../components/Tour';

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
    <main>
      <h1>Library</h1>
      <p>
        Your published books will live here. <button onClick={() => setTour(true)}>Replay tour</button>
      </p>
      {tour && (
        <Tour
          onClose={() => {
            markSeen();
            setTour(false);
          }}
        />
      )}
    </main>
  );
}
