import { useState } from 'react';
import { aiQuiz } from '../lib/api';
import type { QuizQuestion } from '../lib/api';
import { Button } from './ui';

// Quiz on the book just read: one AI call builds Movers-style questions from
// the project's scenes, answers ship along, scoring happens here.
export function QuizPanel({ projectId }: { projectId: string }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [picked, setPicked] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const res = await aiQuiz(projectId);
      setQuestions(res.questions);
      setPicked(res.questions.map(() => null));
    } catch {
      setError('Could not make the quiz. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  function answer(i: number, option: number) {
    setPicked((p) => (p[i] === null ? p.map((v, k) => (k === i ? option : v)) : p));
  }

  const answered = picked.filter((p) => p !== null).length;
  const correct = questions
    ? questions.filter((q, i) => picked[i] === q.answer).length
    : 0;

  return (
    <div className="rounded-md border border-accent-900 bg-accent-50 p-3">
      {questions === null ? (
        <>
          <p className="mb-2">
            <strong>Quiz me on this book.</strong> Six questions written from these very scenes.
          </p>
          <Button onClick={() => void start()} variant="primary" disabled={busy}>
            {busy ? 'Writing quiz…' : 'Start quiz'}
          </Button>
        </>
      ) : (
        <>
          <p aria-live="polite" className="mb-2">
            <strong>
              Score: {correct}/{questions.length}
            </strong>{' '}
            · answered {answered}/{questions.length}
          </p>
          <ol className="flex flex-col gap-3">
            {questions.map((q, i) => (
              <li key={i} className="rounded-md bg-white p-2">
                <p className="mb-1 font-medium">
                  {i + 1}. {q.prompt}
                </p>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt, o) => {
                    const chosen = picked[i] === o;
                    const reveal = picked[i] !== null;
                    const right = o === q.answer;
                    return (
                      <button
                        key={o}
                        type="button"
                        disabled={picked[i] !== null}
                        onClick={() => answer(i, o)}
                        className={`min-h-[44px] rounded-md border px-3 text-base ${
                          reveal && right
                            ? 'border-green-800 bg-green-50 font-bold'
                            : reveal && chosen
                              ? 'border-red-800 bg-red-50'
                              : 'border-stone-300 bg-white underline decoration-stone-300 underline-offset-4'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {picked[i] !== null ? (
                  <p className="mt-1 text-sm text-stone-700">{q.explanation}</p>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="mt-2">
            <Button onClick={() => void start()} disabled={busy}>
              {busy ? 'Writing quiz…' : 'New quiz'}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
    </div>
  );
}
