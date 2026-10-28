import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LEVELS, createProject, deleteProject, listProjects } from '../lib/api';
import type { Project } from '../lib/api';
import { Alert, Badge, Button, Field, Page, inputClass } from '../components/ui';
import { useConfirm } from '../components/Dialog';

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('A1');
  const [error, setError] = useState<string | null>(null);
  const { requestConfirm, dialog } = useConfirm();

  async function refresh() {
    try {
      setProjects((await listProjects()).projects);
    } catch {
      setError('Could not load projects.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProject(title, level);
      setTitle('');
      await refresh();
    } catch {
      setError('Could not create the comic.');
    }
  }

  async function remove(id: string, title: string) {
    const ok = await requestConfirm({
      title: 'Delete comic',
      message: `Delete "${title}" and all of its scenes? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteProject(id);
      await refresh();
    } catch {
      setError('Could not delete the comic.');
    }
  }

  return (
    <Page title="Studio">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Comic title">
            <input
              required
              maxLength={200}
              placeholder="Comic title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Level">
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary">New comic</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {dialog}
      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 px-3 py-2"
          >
            <Link to={`/studio/${p.id}`} className="font-medium underline underline-offset-2">
              {p.title}
            </Link>
            <span className="text-sm text-stone-900">
              {p.level} <Badge status={p.status} />
            </span>
            <span className="ms-auto">
              <Button variant="danger" onClick={() => void remove(p.id, p.title)}>Delete</Button>
            </span>
          </li>
        ))}
      </ul>
    </Page>
  );
}
