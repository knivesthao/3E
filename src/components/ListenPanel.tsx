import { useEffect, useState } from 'react';
import { Button } from './ui';
import { speak, speechSynthesisSupported, stopSpeaking } from '../lib/speech';

const SLOW_RATE = 0.8;

// Per-scene listen mode: the device reads the scene text aloud. Free,
// on-device voices (many work offline), nothing sent anywhere. Slow
// toggle replays at 0.8x for A1 learners.
export function ListenPanel({ sceneNumber, text }: { sceneNumber: number; text: string }) {
  const [state, setState] = useState<'idle' | 'playing'>('idle');
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => stopSpeaking, []);

  async function play(rate: number) {
    setError(null);
    setState('playing');
    try {
      await speak(text, rate);
    } catch {
      setError('Could not play audio on this device.');
    } finally {
      setState('idle');
    }
  }

  function stop() {
    stopSpeaking();
    setState('idle');
  }

  if (!speechSynthesisSupported()) {
    return (
      <p className="text-sm text-stone-600">
        Listen mode needs a browser with speech synthesis (Chrome, Edge, or Safari).
      </p>
    );
  }

  return (
    <div className="rounded-md border border-stone-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'playing' ? (
          <Button onClick={stop}>Stop</Button>
        ) : (
          <Button onClick={() => void play(slow ? SLOW_RATE : 1)} variant="primary">
            Listen to scene {sceneNumber}
          </Button>
        )}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={slow}
            onChange={(e) => setSlow(e.target.checked)}
            className="h-5 w-5 accent-[#134e4a]"
          />
          Slow
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-600">Played by your device; no audio is downloaded or sent anywhere.</p>
    </div>
  );
}
