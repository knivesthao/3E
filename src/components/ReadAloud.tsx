import { useRef, useState } from 'react';
import { Button } from './ui';
import { READ_ALOUD_PASS, listenUntilStopped, scoreReading, speechRecognitionSupported } from '../lib/speech';
import type { Listener, ReadingScore } from '../lib/speech';

// Per-scene read-aloud practice: the learner reads the scene text aloud,
// the device transcribes, and we score word recall locally. Missed words
// become tap-to-look-up guidance via the existing Reader meanings.
export function ReadAloudPanel({
  sceneNumber,
  text,
  onPass,
  onLookup,
}: {
  sceneNumber: number;
  text: string;
  onPass: (sceneNumber: number) => void;
  onLookup: (word: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'listening' | 'done'>('idle');
  const [score, setScore] = useState<ReadingScore | null>(null);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listener = useRef<Listener | null>(null);
  const supported = speechRecognitionSupported();

  function start() {
    setError(null);
    setScore(null);
    setHeard('');
    setState('listening');
    try {
      const l = listenUntilStopped('en-US', (t) => setHeard(t));
      listener.current = l;
      l.done.then(
        (heard) => {
          const s = scoreReading(text, heard);
          setScore(s);
          setState('done');
          if (s.pct >= READ_ALOUD_PASS) onPass(sceneNumber);
        },
        (e: unknown) => {
          setState('idle');
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
    listener.current?.stop();
  }

  if (!supported) {
    return (
      <p className="text-sm text-stone-600">
        Read-aloud practice needs a browser with speech recognition (Chrome or Edge).
      </p>
    );
  }

  return (
    <div className="rounded-md border border-accent-900 bg-accent-50 p-3">
      {state === 'listening' ? (
        <>
          <p aria-live="polite">
            <strong>Listening…</strong> read at your own pace, then press Stop.
          </p>
          {heard !== '' ? (
            <p aria-live="polite" className="mt-2 rounded bg-white px-2 py-1 text-sm">
              Heard so far: {heard}
            </p>
          ) : null}
          <div className="mt-2">
            <Button onClick={stop} variant="primary">
              Stop & score
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={start} variant={score ? 'secondary' : 'primary'}>
          {score ? 'Try again' : `Read scene ${sceneNumber} aloud`}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
      {score && state === 'done' && (
        <div aria-live="polite" className="mt-2">
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
      <p className="mt-2 text-xs text-stone-600">
        Transcription is done by your browser; audio is not sent to our servers.
      </p>
    </div>
  );
}
