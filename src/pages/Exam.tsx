import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExam, getExamBest, submitExam } from '../lib/api';
import type { ExamQuestion, ExamResult } from '../lib/api';
import { Alert, Button, Page } from '../components/ui';

const SECTION_LABEL: Record<ExamQuestion['section'], string> = {
  words: 'Words',
  grammar: 'Grammar',
  reading: 'Reading',
};

export default function Exam() {
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null);
  const [passMark, setPassMark] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExam()
      .then((res) => {
        setQuestions(res.questions);
        setPassMark(res.passMark);
      })
      .catch(() => setError('Could not load the practice test.'));
    getExamBest()
      .then((res) => setBest(res.best))
      .catch(() => {});
  }, []);

  async function submit() {
    if (!questions) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions
        .filter((q) => choices[q.id] !== undefined)
        .map((q) => ({ id: q.id, choice: choices[q.id] }));
      setResult(await submitExam(questions.map((q) => q.id), answers));
      const b = await getExamBest().catch(() => null);
      if (b) setBest(b.best);
      window.scrollTo(0, 0);
    } catch {
      setError('Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !questions) {
    return (
      <Page title="Practice test">
        <Alert>{error}</Alert>
      </Page>
    );
  }
  if (!questions) {
    return (
      <Page title="Practice test">
        <p>Loading…</p>
      </Page>
    );
  }

  if (result) {
    const byId = new Map(questions.map((q) => [q.id, q]));
    return (
      <Page title={result.passed ? 'You passed!' : 'Keep practicing'}>
        <p className="rounded-md bg-stone-100 px-3 py-2 text-lg">
          Score: <strong>{result.score} / {result.total}</strong>
          {best !== null && best >= result.score && result.score < result.total && (
            <> · your best: {best}</>
          )}
        </p>
        <p>{result.message}</p>
        {error && <Alert>{error}</Alert>}
        <section aria-label="Answer review">
          <h2 className="mb-1 font-display text-xl font-bold">Review</h2>
          <ul className="flex flex-col gap-2">
            {result.review.map((r) => {
              const q = byId.get(r.id);
              if (!q) return null;
              return (
                <li
                  key={r.id}
                  className={`rounded-md border px-3 py-2 ${r.correct ? 'border-stone-200' : 'border-accent-900'}`}
                >
                  <p className="font-medium">
                    {r.correct ? 'Correct' : 'Missed'} — {q.prompt}
                  </p>
                  {!r.correct && (
                    <p className="text-sm">
                      Right answer: <strong>{q.options[r.answer]}</strong>. {r.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setResult(null);
              setChoices({});
              setIndex(0);
            }}
          >
            Try again
          </Button>
          <Link to="/" className="contents">
            <Button>Back to Library</Button>
          </Link>
        </div>
      </Page>
    );
  }

  const q = questions[index];
  const answered = questions.filter((x) => choices[x.id] !== undefined).length;
  return (
    <Page title="Practice test: A1">
      <p className="text-sm text-stone-600">
        Question {index + 1} of {questions.length} · pass mark {passMark}
        {best !== null && <> · your best: {best}</>}
      </p>
      {q.passage && (
        <p className="rounded-md bg-stone-100 px-3 py-2">Read: {q.passage}</p>
      )}
      <fieldset>
        <legend className="mb-2 text-lg font-medium">
          <span className="text-sm text-stone-600">Part {q.part} · {SECTION_LABEL[q.section]} · </span>
          {q.prompt}
        </legend>
        <div className="flex flex-col gap-2" role="radiogroup">
          {q.options.map((opt, i) => (
            <label
              key={i}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                choices[q.id] === i ? 'border-accent-900 bg-accent-50' : 'border-stone-300 bg-white'
              }`}
            >
              <input
                type="radio"
                name={q.id}
                checked={choices[q.id] === i}
                onChange={() => setChoices((c) => ({ ...c, [q.id]: i }))}
                className="h-5 w-5 shrink-0 accent-[#134e4a]"
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {index > 0 && <Button onClick={() => setIndex(index - 1)}>Back</Button>}
        {index < questions.length - 1 ? (
          <Button onClick={() => setIndex(index + 1)} variant="primary">Next</Button>
        ) : (
          <Button onClick={() => void submit()} variant="primary" disabled={submitting}>
            {submitting ? 'Checking…' : `Finish (${answered}/${questions.length} answered)`}
          </Button>
        )}
      </div>
    </Page>
  );
}
