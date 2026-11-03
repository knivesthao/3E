import { afterEach, describe, expect, it } from 'vitest';
import {
  READ_ALOUD_PASS,
  cleanWord,
  listenUntilStopped,
  scoreReading,
  speak,
  speechRecognitionSupported,
  speechSynthesisSupported,
  stopListening,
  stopSpeaking,
} from './speech';

describe('cleanWord', () => {
  it('normalizes like the reader lookup', () => {
    expect(cleanWord('Cat!')).toBe('cat');
    expect(cleanWord("don't")).toBe("don't");
    expect(cleanWord('123')).toBe('');
  });
});

describe('scoreReading', () => {
  it('scores a perfect reading at 100 with no misses', () => {
    const s = scoreReading('The cat is happy', 'the cat is happy');
    expect(s).toMatchObject({ pct: 100, matched: 4, total: 4, missed: [] });
  });

  it('is order-free and dedupes missed words', () => {
    const s = scoreReading('the cat sat on the mat', 'cat mat dog');
    expect(s.matched).toBe(2);
    expect(s.total).toBe(6);
    expect(s.missed).toEqual(['the', 'sat', 'on']);
  });

  it('ignores punctuation and case', () => {
    const s = scoreReading('Hello, Ana!', 'hello ana');
    expect(s.pct).toBe(100);
  });

  it('scores empty scenes at 0', () => {
    expect(scoreReading('', 'hello').pct).toBe(0);
  });

  it('pass mark is reachable but not free', () => {
    expect(READ_ALOUD_PASS).toBeGreaterThan(50);
    const s = scoreReading('a b c d e f g h i j', 'a b');
    expect(s.pct).toBeLessThan(READ_ALOUD_PASS);
  });
});

describe('device speech availability (node has neither)', () => {
  it('reports unsupported without throwing', () => {
    expect(speechRecognitionSupported()).toBe(false);
    expect(speechSynthesisSupported()).toBe(false);
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('speak rejects when unsupported', async () => {
    await expect(speak('hello')).rejects.toThrow('unsupported');
  });
});

// User-paced listening: continuous recognition accumulates finals across
// pauses until the learner presses Stop — single-utterance mode cut slow
// readers off after the first pause.
describe('listenUntilStopped', () => {
  type Handler = ((e: unknown) => void) | null;
  class FakeRec {
    static last: FakeRec | null = null;
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: Handler = null;
    onerror: Handler = null;
    onend: Handler = null;
    started = false;
    constructor() {
      FakeRec.last = this;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.({});
    }
    emitResult(transcripts: { text: string; final: boolean }[]) {
      this.onresult?.({
        resultIndex: 0,
        results: transcripts.map((t) => {
          const alt = { transcript: t.text };
          return { 0: alt, isFinal: t.final, length: 1 };
        }),
      });
    }
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    FakeRec.last = null;
  });

  function install() {
    (globalThis as Record<string, unknown>).window = {
      SpeechRecognition: FakeRec,
      setTimeout: () => 0 as unknown,
      clearTimeout: () => {},
    };
  }

  it('rejects when unsupported', async () => {
    await expect(listenUntilStopped().done).rejects.toThrow('unsupported');
  });

  it('accumulates finals across pauses until stop', async () => {
    install();
    const seen: string[] = [];
    const listener = listenUntilStopped('en-US', (t) => seen.push(t));
    const rec = FakeRec.last;
    expect(rec?.started).toBe(true);
    expect(rec?.continuous).toBe(true);
    rec?.emitResult([{ text: 'the sun is', final: false }]);
    rec?.emitResult([{ text: 'the sun is up', final: true }]);
    rec?.emitResult([{ text: 'it is a hot', final: true }]);
    listener.stop();
    await expect(listener.done).resolves.toBe('the sun is up it is a hot');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toContain('hot');
  });

  it('rejects when stopped with nothing heard', async () => {
    install();
    const listener = listenUntilStopped();
    FakeRec.last?.stop();
    await expect(listener.done).rejects.toThrow('no-speech');
  });

  it('stopSpeaking interrupts listening without scoring partial speech', async () => {
    install();
    const listener = listenUntilStopped();
    listener.done.catch(() => {});
    FakeRec.last?.emitResult([{ text: 'the sun is up', final: true }]);
    stopSpeaking();
    await expect(listener.done).rejects.toThrow('interrupted');
  });

  it('starting a second listener interrupts the first', async () => {
    install();
    const first = listenUntilStopped();
    first.done.catch(() => {});
    const second = listenUntilStopped();
    second.done.catch(() => {});
    await expect(first.done).rejects.toThrow('interrupted');
    FakeRec.last?.stop();
    await expect(second.done).rejects.toThrow('no-speech');
  });

  it('stopListening ends recognition without touching speech synthesis', async () => {
    install();
    const listener = listenUntilStopped();
    stopListening();
    await expect(listener.done).rejects.toThrow('interrupted');
  });
});
