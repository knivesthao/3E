import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  LEVELS,
  createClass,
  enrollStudent,
  getClass,
  getClassActivity,
  listBooks,
  listClasses,
  removeStudent,
  renameClass,
  replaceClassBooks,
  replaceClassWords,
} from '../lib/api';
import type { CatalogBook, ClassActivityEntry, ClassDetail, TeacherClass } from '../lib/api';
import { moveItem } from '../lib/catalog';
import { Alert, Badge, Button, Field, Page, inputClass } from '../components/ui';

export default function Classes() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [activity, setActivity] = useState<ClassActivityEntry[] | null>(null);
  const [levelBooks, setLevelBooks] = useState<CatalogBook[] | null>(null);
  const [newName, setNewName] = useState('');
  const [newLevel, setNewLevel] = useState('A1');
  const [editName, setEditName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addBookId, setAddBookId] = useState('');
  const [wordsInput, setWordsInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshList(): Promise<TeacherClass[]> {
    const res = await listClasses();
    setClasses(res.classes);
    return res.classes;
  }

  async function refreshDetail(id: string) {
    const res = await getClass(id);
    setDetail(res);
    setEditName(res.cls.name);
    setActivity(null);
    const books = await listBooks();
    setLevelBooks(books.books.filter((b) => b.level === res.cls.level));
    try {
      const act = await getClassActivity(id);
      setActivity(act.activity);
    } catch {
      setActivity([]);
    }
  }

  useEffect(() => {
    refreshList().catch(() => setError('Could not load classes.'));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setLevelBooks(null);
      setActivity(null);
      return;
    }
    refreshDetail(selectedId).catch(() => setError('Could not load the class.'));
  }, [selectedId]);

  async function run(fn: () => Promise<unknown>, after?: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      if (after) await after();
    } catch {
      setError('That did not work. Check the values and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    await run(
      async () => {
        const created = await createClass(newName, newLevel);
        setNewName('');
        setSelectedId(created.cls.id);
      },
      async () => {
        await refreshList();
      },
    );
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const id = detail.cls.id;
    await run(
      async () => renameClass(id, editName),
      async () => {
        await refreshDetail(id);
        await refreshList();
      },
    );
  }

  async function submitEnroll(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const id = detail.cls.id;
    await run(
      async () => enrollStudent(id, addEmail),
      async () => {
        setAddEmail('');
        await refreshDetail(id);
      },
    );
  }

  async function reorder(from: number, to: number) {
    if (!detail) return;
    const ids = moveItem(detail.books.map((b) => b.book_id), from, to);
    if (ids.join() === detail.books.map((b) => b.book_id).join()) return;
    const id = detail.cls.id;
    await run(
      async () => replaceClassBooks(id, ids),
      async () => refreshDetail(id),
    );
  }

  async function removeBook(bookId: string) {
    if (!detail) return;
    const ids = detail.books.map((b) => b.book_id).filter((id) => id !== bookId);
    if (ids.length === 0) {
      setError('A class needs at least one book — add a replacement first.');
      return;
    }
    const id = detail.cls.id;
    await run(
      async () => replaceClassBooks(id, ids),
      async () => refreshDetail(id),
    );
  }

  async function addBook(e: FormEvent) {
    e.preventDefault();
    if (!detail || !addBookId) return;
    const ids = [...detail.books.map((b) => b.book_id), addBookId];
    const id = detail.cls.id;
    await run(
      async () => replaceClassBooks(id, ids),
      async () => {
        setAddBookId('');
        await refreshDetail(id);
      },
    );
  }

  async function submitWords(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const id = detail.cls.id;
    const words = wordsInput.split(/[\s,]+/).filter((w) => w !== '');
    await run(
      async () => replaceClassWords(id, words),
      async () => {
        setWordsInput('');
        await refreshDetail(id);
      },
    );
  }

  if (selectedId && detail) {
    const inCurriculum = new Set(detail.books.map((b) => b.book_id));
    const candidates = (levelBooks ?? []).filter((b) => !inCurriculum.has(b.id));
    return (
      <Page title={detail.cls.name}>
        {error && <Alert>{error}</Alert>}
        <p>
          <button type="button" onClick={() => setSelectedId(null)} className="underline underline-offset-4">
            ‹ All classes
          </button>
        </p>
        <section aria-label="Class details" className="rounded-md border border-stone-200 bg-white p-3">
          <form onSubmit={submitRename} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Class name">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required maxLength={200} className={inputClass} />
              </Field>
            </div>
            <div className="flex items-end gap-2">
              <span className="pb-3"><Badge status={detail.cls.level} /></span>
              <Button type="submit" variant="primary" disabled={busy}>Rename</Button>
            </div>
          </form>
        </section>
        <section aria-label="Students" className="rounded-md border border-stone-200 bg-white p-3">
          <h2 className="font-display text-xl font-bold">Students ({detail.students.length})</h2>
          <form onSubmit={submitEnroll} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Student email">
                <input type="email" required placeholder="learner@example.com" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={busy}>Add student</Button>
          </form>
          {detail.students.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">No students yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {detail.students.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-stone-100 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-base">{s.email}</span>
                  <Button size="sm" disabled={busy} onClick={() => void run(async () => removeStudent(detail.cls.id, s.id), async () => refreshDetail(detail.cls.id))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Student activity" className="rounded-md border border-stone-200 bg-white p-3">
          <h2 className="font-display text-xl font-bold">Student activity</h2>
          {activity === null ? (
            <p className="mt-1 text-sm text-stone-600">Loading activity…</p>
          ) : activity.length === 0 ? (
            <p className="mt-1 text-sm text-stone-600">No activity data yet — it appears once students start reading.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {(() => {
                const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
                return activity.map((a) => {
                  const quiet = a.last_active === null || a.last_active < cutoff;
                  return (
                    <li key={a.user_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-stone-100 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-base">{a.email}</span>
                      <span className="text-sm text-stone-600">
                        {a.streak > 0 ? `${a.streak}-day streak · ` : ''}
                        {a.days_active}d active · {a.finished} finished
                        {a.last_active ? ` · last ${a.last_active.slice(5)}` : ' · never active'}
                      </span>
                      {quiet && (
                        <span className="rounded-full border border-accent-900 px-2 py-0.5 text-xs font-medium text-accent-900">
                          needs attention
                        </span>
                      )}
                    </li>
                  );
                });
              })()}
            </ul>
          )}
        </section>
        <section aria-label="Curriculum" className="rounded-md border border-stone-200 bg-white p-3">
          <h2 className="font-display text-xl font-bold">Curriculum ({detail.books.length})</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {detail.books.map((b, i) => (
              <li key={b.book_id} className="flex items-center gap-2 rounded-md border border-stone-200 px-2 py-1">
                <span className="w-6 shrink-0 text-center text-sm text-stone-600">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-base font-bold">{b.title}</span>
                <Button size="sm" disabled={busy || i === 0} onClick={() => void reorder(i, i - 1)} aria-label={`Move ${b.title} up`}>↑</Button>
                <Button size="sm" disabled={busy || i === detail.books.length - 1} onClick={() => void reorder(i, i + 1)} aria-label={`Move ${b.title} down`}>↓</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeBook(b.book_id)}>Remove</Button>
              </li>
            ))}
          </ul>
          <form onSubmit={addBook} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label={`Add a ${detail.cls.level} book`}>
                <select value={addBookId} onChange={(e) => setAddBookId(e.target.value)} className={inputClass}>
                  <option value="">Choose a book…</option>
                  {candidates.map((b) => (
                    <option key={b.id} value={b.id}>{b.title}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit" disabled={busy || !addBookId}>Add book</Button>
          </form>
        </section>
        <section aria-label="Word list" className="rounded-md border border-stone-200 bg-white p-3">
          <h2 className="font-display text-xl font-bold">Word list ({detail.words.length})</h2>
          {detail.words.length === 0 ? (
            <p className="mt-1 text-sm text-stone-600">No words yet — save a list below to start drills.</p>
          ) : (
            <p className="mt-1 text-base leading-relaxed">{detail.words.join(' · ')}</p>
          )}
          <form onSubmit={submitWords} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Replace word list (separate with commas or spaces)">
                <input
                  value={wordsInput}
                  onChange={(e) => setWordsInput(e.target.value)}
                  required
                  maxLength={1200}
                  placeholder="cat dog run"
                  className={inputClass}
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={busy}>Save words</Button>
          </form>
        </section>
      </Page>
    );
  }

  return (
    <Page title="Classes">
      {error && <Alert>{error}</Alert>}
      <form onSubmit={submitCreate} className="flex flex-col gap-2 rounded-md border border-stone-200 bg-white p-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="New class name">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required maxLength={200} placeholder="Grade 2 English" className={inputClass} />
          </Field>
        </div>
        <Field label="Level">
          <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)} className={inputClass}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>Create class</Button>
      </form>
      {classes === null ? (
        <p>Loading classes…</p>
      ) : classes.length === 0 ? (
        <p className="text-stone-600">No classes yet — create the first one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {classes.map((c) => (
            <li key={c.id} className="rounded-md border border-stone-200 bg-white px-3 py-2">
              <button type="button" onClick={() => setSelectedId(c.id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                <strong className="font-display text-xl font-bold underline decoration-stone-300 underline-offset-4">{c.name}</strong>
                <Badge status={c.level} />
                <span className="text-sm text-stone-600">
                  {c.student_count} student{c.student_count === 1 ? '' : 's'} · {c.book_count} book{c.book_count === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-stone-600">
        New classes start with the newest published books at their level. <Link to="/" className="underline underline-offset-2">Back to the library</Link>
      </p>
    </Page>
  );
}
