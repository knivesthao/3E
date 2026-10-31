import { useState } from 'react';
import { Button } from './ui';

export type TourTrack = 'read' | 'create';

const TRACKS: Record<TourTrack, { title: string; body: string }[]> = {
  read: [
    {
      title: 'Open your first book',
      body: 'The Library lists every published book with its level. New to English? Start with A1 and tap Read.',
    },
    {
      title: 'Pip reads with you',
      body: 'Tap the buddy icon on any page: Listen plays the story, Read listens to YOU. Pip lights up each word as it sounds.',
    },
    {
      title: 'Tap words, earn belts',
      body: 'Tap any hard word for its meaning, quiz yourself after the book, and earn belts in the practice test.',
    },
  ],
  create: [
    {
      title: 'Make a comic',
      body: 'Open Studio, start a New comic, pick a reading level from A1 to B2.',
    },
    {
      title: 'Let AI write with you',
      body: 'Write one scene, then 3E Finish writes the rest. Simplify fixes any hard words.',
    },
    {
      title: 'Draw and publish',
      body: 'Generate art for each scene — the same character throughout — then Publish.',
    },
    {
      title: 'Read anywhere',
      body: 'Read swipeably on a phone, tap any word for its meaning, share the link. Saved books read offline.',
    },
  ],
};

export default function Tour({ track, onClose }: { track: TourTrack; onClose: () => void }) {
  const steps = TRACKS[track];
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App tour"
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-md border border-stone-300 bg-white p-5">
        <h2 className="mb-2 font-display text-2xl font-bold">{steps[i].title}</h2>
        <p className="mb-2">{steps[i].body}</p>
        <p className="mb-4 text-sm">
          Step {i + 1} of {steps.length}
        </p>
        <div className="flex flex-wrap gap-2">
          {i > 0 && <Button onClick={() => setI(i - 1)}>Back</Button>}{' '}
          {!last ? (
            <Button onClick={() => setI(i + 1)} variant="primary">Next</Button>
          ) : (
            <Button onClick={onClose} variant="primary">Done</Button>
          )}{' '}
          <Button onClick={onClose}>Skip</Button>
        </div>
      </div>
    </div>
  );
}
