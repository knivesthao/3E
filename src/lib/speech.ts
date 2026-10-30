// Browser speech helpers for read-aloud practice. $0: uses the device
// speech recognition where available, scores locally, nothing is sent to
// our servers. Unsupported browsers get a clear message, not silence.

export function cleanWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z'-]/g, '');
}

interface SRAlternative {
  transcript: string;
}

interface SRResult {
  [index: number]: SRAlternative;
  isFinal: boolean;
}

interface SRResultList {
  [index: number]: SRResult;
  length: number;
}

interface SREvent extends Event {
  results: SRResultList;
}

interface SRInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SRInstance;
    webkitSpeechRecognition?: new () => SRInstance;
  }
}

export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.SpeechRecognition || !!window.webkitSpeechRecognition;
}

/** Listen once; resolves with the final transcript. Rejects on no speech. */
export function listenOnce(lang = 'en-US', timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      reject(new Error('unsupported'));
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
        reject(new Error('timeout'));
      }
    }, timeoutMs);
    rec.onresult = (e: SREvent) => {
      const text = e.results[0]?.[0]?.transcript ?? '';
      if (!done && text.trim()) {
        done = true;
        window.clearTimeout(timer);
        resolve(text);
      }
    };
    rec.onerror = () => {
      if (!done) {
        done = true;
        window.clearTimeout(timer);
        reject(new Error('recognition-error'));
      }
    };
    rec.onend = () => {
      if (!done) {
        done = true;
        window.clearTimeout(timer);
        reject(new Error('no-speech'));
      }
    };
    try {
      rec.start();
    } catch {
      done = true;
      window.clearTimeout(timer);
      reject(new Error('start-failed'));
    }
  });
}

export interface Listener {
  /** End listening; `done` settles with everything heard so far (or rejects if nothing). */
  stop: () => void;
  done: Promise<string>;
}

// One voice mode at a time: starting Listen cuts Read (so the mic never
// scores the speaker), and starting Read cuts Listen. The side that gets
// cut settles as 'interrupted' — callers treat that as a silent stop, never
// a score. Module-level so the two panels coordinate without knowing each
// other.
let activeAbort: (() => void) | null = null;

function abortListening(): void {
  const abort = activeAbort;
  activeAbort = null;
  abort?.();
}

/** Stop recognition now; an in-flight listen settles as 'interrupted'. */
export function stopListening(): void {
  abortListening();
}

/**
 * User-paced listening: continuous recognition accumulates final transcripts
 * across pauses until `stop()` is called. Single-utterance mode cut slow
 * readers off after the first pause; this leaves the pacing to the learner.
 * Interim results stream through `onUpdate` for a live transcript.
 */
export function listenUntilStopped(
  lang = 'en-US',
  onUpdate?: (text: string) => void,
  timeoutMs = 120000,
): Listener {
  const Ctor =
    typeof window === 'undefined' ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);
  if (!Ctor) {
    return { stop: () => {}, done: Promise.reject(new Error('unsupported')) };
  }
  let settle!: (text: string | null, err: string) => void;
  const done = new Promise<string>((resolve, reject) => {
    settle = (text, err) => {
      if (text !== null && text.trim() !== '') resolve(text);
      else reject(new Error(err));
    };
  });
  let settled = false;
  let aborted = false;
  const finals: string[] = [];
  let timer = 0;
  const finish = (text: string | null, err: string) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    activeAbort = null;
    settle(text, err);
  };
  const current = (interim: string) => [...finals, interim].join(' ').replace(/\s+/g, ' ').trim();

  // Claim the mic: cut any TTS and any earlier recognition first.
  stopSpeaking();
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  activeAbort = () => {
    aborted = true;
    try {
      rec.stop();
    } catch {
      /* onend settles */
    }
  };
  rec.onresult = (e: SREvent) => {
    const from = (e as { resultIndex?: number }).resultIndex ?? 0;
    let interim = '';
    for (let i = from; i < e.results.length; i++) {
      const text = e.results[i]?.[0]?.transcript ?? '';
      if (e.results[i]?.isFinal) {
        if (text.trim() !== '') finals.push(text.trim());
      } else {
        interim = text;
      }
    }
    onUpdate?.(current(interim));
  };
  rec.onerror = () => {
    if (aborted) {
      finish(null, 'interrupted');
      return;
    }
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    finish(finals.join(' ') || null, 'recognition-error');
  };
  rec.onend = () => {
    if (aborted) {
      finish(null, 'interrupted');
      return;
    }
    finish(finals.join(' ') || null, 'no-speech');
  };
  timer = window.setTimeout(() => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    finish(finals.join(' ') || null, 'timeout');
  }, timeoutMs);
  const stop = () => {
    try {
      rec.stop();
    } catch {
      /* onend settles */
    }
  };
  try {
    rec.start();
  } catch {
    finish(null, 'start-failed');
  }
  return { stop, done };
}

export interface ReadingScore {
  pct: number;
  matched: number;
  total: number;
  missed: string[];
}

/** Order-free word recall: what fraction of the scene's words did we hear? */
export function scoreReading(expected: string, heard: string): ReadingScore {
  const expectedWords = expected
    .split(/\s+/)
    .map(cleanWord)
    .filter((w) => w.length > 0);
  const heardSet = new Set(
    heard
      .split(/\s+/)
      .map(cleanWord)
      .filter((w) => w.length > 0),
  );
  const seen = new Set<string>();
  let matched = 0;
  const missed: string[] = [];
  for (const w of expectedWords) {
    if (heardSet.has(w)) {
      matched += 1;
    } else if (!seen.has(w)) {
      seen.add(w);
      missed.push(w);
    }
  }
  const total = expectedWords.length;
  return { pct: total === 0 ? 0 : Math.round((matched / total) * 100), matched, total, missed };
}

export const READ_ALOUD_PASS = 70;

// --- Listen mode (text to speech, also $0 and on-device) ---

export function speechSynthesisSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (en.length === 0) return voices[0] ?? null;
  return (
    en.find((v) => v.lang.toLowerCase() === 'en-us' && v.localService) ??
    en.find((v) => v.lang.toLowerCase() === 'en-us') ??
    en.find((v) => v.localService) ??
    en[0]
  );
}

function withVoices(fn: (voices: SpeechSynthesisVoice[]) => void): void {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (voices.length > 0) {
    fn(voices);
    return;
  }
  const onChange = () => {
    synth.removeEventListener('voiceschanged', onChange);
    fn(synth.getVoices());
  };
  synth.addEventListener('voiceschanged', onChange);
  // Fallback in case the event never fires: proceed voiceless.
  window.setTimeout(() => {
    synth.removeEventListener('voiceschanged', onChange);
    fn(synth.getVoices());
  }, 1000);
}

/**
 * Speak text; resolves when finished, rejects on error/cancel.
 * onBoundary fires per spoken word (char offset) where the voice supports
 * it — some device voices never emit boundaries, so callers must treat it
 * as a progressive enhancement, never the completion signal.
 */
export function speak(text: string, rate = 1, onBoundary?: (charIndex: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!speechSynthesisSupported()) {
      reject(new Error('unsupported'));
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    abortListening();
    withVoices((voices) => {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice(voices);
      if (voice) utter.voice = voice;
      utter.lang = voice?.lang ?? 'en-US';
      utter.rate = Math.min(2, Math.max(0.1, rate));
      utter.onend = () => resolve();
      utter.onerror = () => reject(new Error('speak-error'));
      if (onBoundary) utter.onboundary = (e) => onBoundary(e.charIndex);
      synth.speak(utter);
    });
  });
}

export function stopSpeaking(): void {
  abortListening();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
