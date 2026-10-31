import { useRef, useState } from 'react';
import { Button } from './ui';
import { MicIcon, StopIcon } from './icons';
import { READ_ALOUD_PASS, cleanWord, listenUntilStopped, scoreReading, speechRecognitionSupported } from '../lib/speech';
import type { Listener, ReadingScore } from '../lib/speech';

// Per-scene read-aloud practice: the learner reads the scene text aloud,
// the device transcribes, and we score word recall locally. Missed words
// become tap-to-look-up guidance via the existing Reader meanings.
export function ReadAloudPanel({
  sceneNumber,
  text,
  order,
  onPass,
  onLookup,
  onProgress,
  onStart,
}: {
  sceneNumber: number;
  text: string;
  // Page words in reading order (cleaned), for sequential match + auto-finish.
  order: string[];
  onPass: (sceneNumber: number) => void;
  onLookup: (word: string) => void;
  onProgress?: (matched: number) => void;
  // Fired when a take begins so the page can clear the Listen trail.
  onStart?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'listening' | 'done'>('idle');
  const [score, setScore] = useState<ReadingScore | null>(null);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listener = useRef<Listener | null>(null);
  // Set when the stop comes from tapping the button with nothing said:
  // that is a deliberate cancel, not a microphone failure.
  const stoppingRef = useRef(false);
  const supported = speechRecognitionSupported();
  // Greedy in-order match: each transcript word consumes the next
  // unread page word when equal; stutters and repeats are skipped over.
  const countMatched = (transcript: string) => {
    const said = transcript.split(/\s+/).map((w) => cleanWord(w)).filter((w) => w !== '');
    let i = 0;
    for (const w of said) {
      if (i >= order.length) break;
      if (w === order[i]) i++;
    }
    return i;
  };

  function start() {
    setError(null);
    setScore(null);
    stoppingRef.current = false;
    setHeard('');
    onStart?.();
    onProgress?.(0);
    setState('listening');
    try {
      const l = listenUntilStopped('en-US', (t) => {
        setHeard(t);
        const matched = countMatched(t);
        onProgress?.(matched);
        // Whole page read in order: end the take; scoring settles at 100%.
        if (order.length > 0 && matched >= order.length) listener.current?.stop();
      });
      listener.current = l;
      l.done.then(
        (heard) => {
          // Sync highlights to the final transcript (interims can drop words
          // the finals confirm, or vice versa), so the glow and the score
          // can never disagree about what was read.
          onProgress?.(countMatched(heard));
          const s = scoreReading(text, heard);
          setScore(s);
          setState('done');
          if (s.pct >= READ_ALOUD_PASS) onPass(sceneNumber);
        },
        (e: unknown) => {
          setState('idle');
          // Cut off by Listen (or unmount): a silent stop, never an error.
          if (e instanceof Error && e.message === 'interrupted') return;
          // Tapped stop with nothing said: a deliberate cancel, never an error.
          if (stoppingRef.current) return;
          setError(
            e instanceof Error && e.message === 'unsupported'
              ? 'Speech recognition is not available in this browser. Try Chrome or Edge.'
              : 'Did not catch that — check the microphone and try again.',
          );
        },
      );
    } catch {
      setState('idle');
      setError('Did not catch that — check the microphone and try again.');
    }
  }

  function stop() {
    stoppingRef.current = true;
    listener.current?.stop();
  }

  if (!supported) {
    return (
      <p className="rounded bg-black/60 px-2 py-1 text-sm">
        Read-aloud practice needs a browser with speech recognition (Chrome or Edge).
      </p>
    );
  }

  return (
    <div className="p-1" title="Transcription is done by your browser; audio is not sent to our servers.">
      {state === 'listening' ? (
        <>
          <div className="flex justify-end">
            <Button onClick={stop} variant="primary" size="sm" aria-label="Stop and score reading" title="Stop and score">
              <StopIcon />
            </Button>
          </div>
          {/* Hint shows only until the learner starts reading, so it never
              competes with the story text once they are going. */}
          {heard === '' ? (
            <p
              aria-live="polite"
              className="mt-2 font-semibold text-black [-webkit-text-stroke:3px_white] [paint-order:stroke_fill] [text-shadow:none]"
            >
              <strong>Listening…</strong> read at your own pace, then press Stop.
            </p>
          ) : null}
        </>
      ) : (
        <div className="flex justify-end">
          <Button onClick={start} variant={score ? 'secondary' : 'primary'} size="sm" aria-label={score ? `Try reading page ${sceneNumber} aloud again` : `Read page ${sceneNumber} aloud`} title="Read aloud">
            <MicIcon />
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded bg-black/60 px-2 py-1 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
      {score && state === 'done' && (
        <div aria-live="polite" className="mt-2 rounded bg-black/60 px-2 py-1">
          <p>
            You said <strong>{score.pct}%</strong> of the words ({score.matched}/{score.total}).
            {score.pct >= READ_ALOUD_PASS ? ' Nice reading!' : ' Try once more.'}
          </p>
          {score.missed.length > 0 && (
            <p className="mt-1 text-sm">
              Missed:{' '}
              {score.missed.map((w, i) => (
                <span key={w}>
                  {i > 0 && ', '}
                  <button
                    type="button"
                    onClick={() => onLookup(w)}
                    className="min-h-0 cursor-pointer px-0.5 text-left underline decoration-accent-800 underline-offset-4"
                  >
                    {w}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
