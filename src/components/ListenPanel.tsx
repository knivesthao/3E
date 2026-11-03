import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { SpeakerIcon } from './icons';
import { speak, speechSynthesisSupported, stopSpeaking } from '../lib/speech';

// Per-scene listen mode: the device reads the scene text aloud. Free,
// on-device voices (many work offline), nothing sent anywhere.
// wordMap translates each spoken-word ordinal to the page's display word
// index (skipping speaker labels, which are shown but not spoken), so the
// page can light up the word being read. onSpeakStart clears the trail;
// onSpeakProgress reports the display index being spoken, null when done.
export function ListenPanel({
  sceneNumber,
  text,
  wordMap,
  speechLang = 'en-US',
  onSpeakStart,
  onSpeakProgress,
  onEnded,
}: {
  sceneNumber: number;
  text: string;
  wordMap: number[];
  // BCP-47 voice family: 'en-US' default, 'zh-CN' for Mandarin books.
  speechLang?: string;
  onSpeakStart?: (sceneNumber: number) => void;
  onSpeakProgress?: (displayIndex: number | null) => void;
  // Fired only when the utterance finishes on its own (not on stop,
  // error, or page turn): the page may auto-advance the reader.
  onEnded?: (sceneNumber: number) => void;
}) {
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
    onSpeakStart?.(sceneNumber);
    let finished = false;
    try {
      // Quarter speed for new learners; boundary events drive the
      // word-by-word highlight where the voice supports them.
      await speak(
        text,
        0.25,
        (charIndex) => {
          const ordinal = text.slice(0, charIndex).split(/\s+/).filter((w) => w !== '').length;
          const displayIndex = wordMap[ordinal];
          if (displayIndex !== undefined) onSpeakProgress?.(displayIndex);
        },
        speechLang,
      );
      finished = true;
    } catch {
      if (!stoppingRef.current) setError('Could not play audio on this device.');
    } finally {
      onSpeakProgress?.(null);
      setState('idle');
      // Natural finish only: manual stops, errors, and page-turn aborts
      // (which unmount this panel) must never advance the reader.
      if (finished && !stoppingRef.current) onEnded?.(sceneNumber);
    }
  }

  function stop() {
    stoppingRef.current = true;
    stopSpeaking();
    onSpeakProgress?.(null);
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
