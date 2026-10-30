import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { SpeakerIcon } from './icons';
import { speak, speechSynthesisSupported, stopSpeaking } from '../lib/speech';

// Per-scene listen mode: the device reads the scene text aloud. Free,
// on-device voices (many work offline), nothing sent anywhere.
export function ListenPanel({ sceneNumber, text }: { sceneNumber: number; text: string }) {
  const [state, setState] = useState<'idle' | 'playing'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Set when the stop comes from tapping the button: the utterance's own
  // cancel error is expected then, not a device failure.
  const stoppingRef = useRef(false);

  useEffect(() => stopSpeaking, []);

  async function play() {
    setError(null);
    stoppingRef.current = false;
    setState('playing');
    try {
      await speak(text, 1);
    } catch {
      if (!stoppingRef.current) setError('Could not play audio on this device.');
    } finally {
      setState('idle');
    }
  }

  function stop() {
    stoppingRef.current = true;
    stopSpeaking();
    setState('idle');
  }

  if (!speechSynthesisSupported()) {
    return (
      <p className="rounded bg-black/60 px-2 py-1 text-sm">
        Listen mode needs a browser with speech synthesis (Chrome, Edge, or Safari).
      </p>
    );
  }

  return (
    <div className="p-1">
      <div className="flex flex-wrap items-center gap-2" title="Played by your device; no audio is downloaded or sent anywhere.">
        {/* One button that toggles: tap again to stop. While playing it
            pulses so the state is visible without swapping the label. */}
        <Button
          onClick={() => (state === 'playing' ? stop() : void play())}
          variant="primary"
          size="sm"
          aria-pressed={state === 'playing'}
          aria-label={state === 'playing' ? `Stop listening to page ${sceneNumber}` : `Listen to page ${sceneNumber}`}
          title={state === 'playing' ? 'Stop' : 'Listen'}
          className={state === 'playing' ? 'animate-pulse' : ''}
        >
          <SpeakerIcon />
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
    </div>
  );
}
