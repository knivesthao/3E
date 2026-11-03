import { useState } from 'react';
import type { FormEvent } from 'react';
import { aiBuddy } from '../lib/api';
import type { BuddyTurn } from '../lib/api';
import { Button, Field, inputClass } from './ui';

// Pip, the reading buddy: one question per AI call, grounded in the book's
// scenes, history capped client-side. Kid-safe by prompt, short by server cut.
export function BuddyPanel({ projectId }: { projectId: string }) {
  const [turns, setTurns] = useState<BuddyTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (message === '' || busy) return;
    setError(null);
    setBusy(true);
    setDraft('');
    const mine: BuddyTurn[] = [...turns.slice(-9), { role: 'learner', text: message.slice(0, 500) }];
    setTurns(mine);
    try {
      const res = await aiBuddy(projectId, null, mine[mine.length - 1].text, mine.slice(0, -1));
      setTurns([...mine, { role: 'pip', text: res.reply }]);
    } catch {
      setError('Pip did not answer. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-accent-900 bg-accent-50 p-3">
      <p className="mb-2">
        <strong>Ask Pip</strong> about this book. Pip only talks about the story.
      </p>
      {turns.length > 0 ? (
        <ul aria-live="polite" className="mb-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {turns.map((t, i) => (
            <li
              key={i}
              className={`max-w-[90%] rounded-md px-2 py-1 text-base ${
                t.role === 'pip' ? 'self-start bg-white' : 'self-end bg-accent-900 text-white'
              }`}
            >
              {t.role === 'pip' ? <strong>Pip: </strong> : null}
              {t.text}
            </li>
          ))}
          {busy ? <li className="self-start text-sm text-stone-600">Pip is thinking…</li> : null}
        </ul>
      ) : null}
      <form onSubmit={(e) => void send(e)} className="flex gap-2">
        <div className="flex-1">
          <Field label="Your question">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Why is the cat happy?"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={busy || draft.trim() === ''}>
            Ask
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          <strong>Error: </strong>
          {error}
        </p>
      )}
    </div>
  );
}
