import { useState } from 'react';

const STEPS = [
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
];

export default function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  return (
    <div
      role="dialog"
      aria-label="App tour"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ background: '#fff', maxWidth: 360, padding: 20 }}>
        <h2>{STEPS[i].title}</h2>
        <p>{STEPS[i].body}</p>
        <p>
          Step {i + 1} of {STEPS.length}
        </p>
        <div>
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}{' '}
          {!last ? (
            <button onClick={() => setI(i + 1)}>Next</button>
          ) : (
            <button onClick={onClose}>Done</button>
          )}{' '}
          <button onClick={onClose}>Skip</button>
        </div>
      </div>
    </div>
  );
}
