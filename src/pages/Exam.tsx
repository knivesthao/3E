import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExam, getExamAttempt, getExamBest, getExamHistory, submitExam } from '../lib/api';
import type { ExamAttempt, ExamAttemptDetail, ExamLevel, ExamQuestion, ExamResult } from '../lib/api';
import { BELT_LABEL, BELT_STYLE, beltFor } from '../lib/belts';
import type { Belt } from '../lib/belts';
import { EXAM_LEVELS, formatAttemptDate, levelBlurb } from '../lib/exams';
import { Alert, Button, Page } from '../components/ui';

function BeltChip({ belt }: { belt: Exclude<Belt, 'none'> }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-sm font-bold ${BELT_STYLE[belt]}`}>
      🥋 {BELT_LABEL[belt]}
    </span>
  );
}

const SECTION_LABEL: Record<ExamQuestion['section'], string> = {
  words: 'Words',
  grammar: 'Grammar',
  reading: 'Reading',
};

function ReviewList({
  items,
  getPrompt,
  getOptions,
}: {
  items: { id: string; correct: boolean; answer: number; explanation: string; choice?: number | null }[];
  getPrompt: (id: string) => string;
  getOptions: (id: string) => string[];
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => {
        const prompt = getPrompt(r.id);
        if (!prompt) return null;
        const options = getOptions(r.id);
        return (
          <li
            key={r.id}
            className={`rounded-md border px-3 py-2 ${r.correct ? 'border-stone-200' : 'border-accent-900'}`}
          >
            <p className="font-medium">
              {r.correct ? 'Correct' : 'Missed'} — {prompt}
            </p>
            {!r.correct && (
              <p className="text-sm">
                {r.choice !== undefined && r.choice !== null && options[r.choice] !== undefined && (
                  <>You chose: <strong>{options[r.choice]}</strong>. </>
                )}
                Right answer: <strong>{options[r.answer]}</strong>. {r.explanation}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function Exam() {
  const [level, setLevel] = useState<ExamLevel>('A1');
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null);
  const [passMark, setPassMark] = useState(0);
  const [total, setTotal] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [reviewing, setReviewing] = useState<ExamAttemptDetail | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestions(null);
    setResult(null);
    setReviewing(null);
    setChoices({});
    setIndex(0);
    setError(null);
    getExam(level)
      .then((res) => {
        setQuestions(res.questions);
        setPassMark(res.passMark);
        setTotal(res.total);
      })
      .catch(() => setError('Could not load the practice test.'));
    getExamBest(level)
      .then((res) => setBest(res.best))
      .catch(() => {});
    getExamHistory()
      .then((res) => setAttempts(res.attempts))
      .catch(() => {});
  }, [level]);

  async function submit() {
    if (!questions) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions
        .filter((q) => choices[q.id] !== undefined)
        .map((q) => ({ id: q.id, choice: choices[q.id] as number }));
      setResult(await submitExam(level, questions.map((q) => q.id), answers));
      const [b, h] = await Promise.all([getExamBest(level).catch(() => null), getExamHistory().catch(() => null)]);
      if (b) setBest(b.best);
      if (h) setAttempts(h.attempts);
      window.scrollTo(0, 0);
    } catch {
      setError('Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function openReview(id: string) {
    setError(null);
    setLoadingReview(true);
    try {
      setReviewing(await getExamAttempt(id));
      window.scrollTo(0, 0);
    } catch {
      setError('Could not open that attempt.');
    } finally {
      setLoadingReview(false);
    }
  }

  if (error && !questions) {
    return (
      <Page title="Practice tests">
        <Alert>{error}</Alert>
      </Page>
    );
  }
  if (!questions) {
    return (
      <Page title="Practice tests">
        <p>Loading…</p>
      </Page>
    );
  }

  const levelPicker = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Exam level">
      {EXAM_LEVELS.map((l) => (
        <Button key={l} variant={l === level ? 'primary' : 'secondary'} onClick={() => setLevel(l)}>
          {l}
        </Button>
      ))}
    </div>
  );

  const history = (
    <section aria-label="Past attempts">
      <h2 className="mb-1 font-display text-xl font-bold">Past attempts</h2>
      {attempts.length === 0 ? (
        <p className="text-sm text-stone-600">No attempts yet. Your history will appear here after you finish a test.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attempts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 px-3 py-2">
              <strong>{a.level}</strong>
              <span>
                {a.score} / {a.total} · {a.passed ? 'Passed' : 'Not passed'}
              </span>
              <span className="text-sm text-stone-600">{formatAttemptDate(a.created_at)}</span>
              <Button variant="secondary" onClick={() => void openReview(a.id)} disabled={loadingReview}>
                Review
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (reviewing) {
    const byId = new Map(reviewing.items.map((q) => [q.id, q]));
    return (
      <Page title={`Review: ${reviewing.level} · ${reviewing.score} / ${reviewing.total}`}>
        {levelPicker}
        <p className="text-sm text-stone-600">
          Taken {formatAttemptDate(reviewing.created_at)} · {reviewing.passed ? 'Passed' : 'Not passed'}
        </p>
        <section aria-label="Attempt review">
          <ReviewList
            items={reviewing.items}
            getPrompt={(id) => byId.get(id)?.prompt ?? ''}
            getOptions={(id) => byId.get(id)?.options ?? []}
          />
        </section>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setReviewing(null)}>Back to test</Button>
          <Link to="/" className="contents">
            <Button>Back to Library</Button>
          </Link>
        </div>
      </Page>
    );
  }

  if (result) {
    const byId = new Map(questions.map((q) => [q.id, q]));
    const earned = beltFor(result.score, passMark, result.total);
    return (
      <Page title={result.passed ? 'You passed!' : 'Keep practicing'}>
        {levelPicker}
        <p className="rounded-md bg-stone-100 px-3 py-2 text-lg">
          Score: <strong>{result.score} / {result.total}</strong>
          {best !== null && best >= result.score && result.score < result.total && (
            <> · your best: {best}</>
          )}
        </p>
        {earned !== 'none' ? (
          <p aria-live="polite">
            <BeltChip belt={earned} />
          </p>
        ) : null}
        <p>{result.message}</p>
        {result.missedWords.length > 0 && (
          <p className="rounded-md border border-accent-900 bg-accent-50 px-3 py-2">
            📝 Practice these {result.missedWords.length === 1 ? 'word' : 'words'}:{' '}
            <strong>{result.missedWords.join(', ')}</strong>{' — '}
            <Link to="/practice/alphabet?deck=mine" className="underline underline-offset-4">
              drill them in My Words
            </Link>
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <section aria-label="Answer review">
          <h2 className="mb-1 font-display text-xl font-bold">Review</h2>
          <ReviewList
            items={result.review.map((r) => ({ ...r, choice: choices[r.id] ?? null }))}
            getPrompt={(id) => byId.get(id)?.prompt ?? ''}
            getOptions={(id) => byId.get(id)?.options ?? []}
          />
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
        {history}
      </Page>
    );
  }

  const q = questions[index];
  const answered = questions.filter((x) => choices[x.id] !== undefined).length;
  const current = beltFor(best, passMark, total);
  return (
    <Page title={`Practice test: ${level}`}>
      {levelPicker}
      <p className="text-sm text-stone-600">{levelBlurb(level)}</p>
      <p className="text-sm text-stone-600">
        Question {index + 1} of {questions.length} · pass mark {passMark}
        {best !== null && <> · your best: {best}</>}
      </p>
      {current !== 'none' ? (
        <p>
          <BeltChip belt={current} />
        </p>
      ) : null}
      <div className="max-h-[46dvh] overflow-y-auto rounded-md">
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
      </div>
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
      {history}
    </Page>
  );
}
