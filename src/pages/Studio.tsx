import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LEVELS, createProject, deleteProject, listProjects } from '../lib/api';
import type { Project } from '../lib/api';

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('A1');
  const [error, setError] = useState<string | null>(null);

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

  async function remove(id: string) {
    try {
      await deleteProject(id);
      await refresh();
    } catch {
      setError('Could not delete the comic.');
    }
  }

  return (
    <main>
      <h1>Studio</h1>
      <form onSubmit={submit}>
        <input required maxLength={200} placeholder="Comic title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button type="submit">New comic</button>
      </form>
      {error && <p>{error}</p>}
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/studio/${p.id}`}>{p.title}</Link> ({p.level}, {p.status})
            <button onClick={() => void remove(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
