import { useEffect, useState } from 'react';
import { getBookCosts, getCostsOverview, listProjects } from '../lib/api';
import type { BookCosts, Project } from '../lib/api';

export default function Costs() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('');
  const [costs, setCosts] = useState<BookCosts | null>(null);
  const [overview, setOverview] = useState<{ user_id: string; month: string; cost: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then((res) => {
        setProjects(res.projects);
        const first = res.projects[0];
        if (first) setSelected(first.id);
      })
      .catch(() => setError('Could not load projects.'));
    getCostsOverview().then((res) => setOverview(res.by_user_month)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    getBookCosts(selected)
      .then(setCosts)
      .catch(() => setError('Could not load costs.'));
  }, [selected]);

  return (
    <main>
      <h1>Costs</h1>
      {error && <p>{error}</p>}
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>
      {costs && (
        <>
          <p>
            Total ${costs.totals.total.toFixed(4)} · first try ${costs.totals.first_try_cost.toFixed(4)} ·
            retries ${costs.totals.retry_overhead.toFixed(4)}
          </p>
          <h3>By task</h3>
          <ul>
            {costs.by_task.map((t) => (
              <li key={t.task}>{t.task}: ${t.cost.toFixed(4)} ({t.calls} calls)</li>
            ))}
          </ul>
          <h3>By model</h3>
          <ul>
            {costs.by_model.map((m) => (
              <li key={m.model}>{m.model}: ${m.cost.toFixed(4)} ({m.calls} calls)</li>
            ))}
          </ul>
          <h3>Retries</h3>
          <ul>
            {costs.retries.map((r) => (
              <li key={`${r.model}|${r.task}`}>
                {r.model} {r.task}: {r.retries} retries, max attempt {r.max_attempt}
              </li>
            ))}
          </ul>
          <p>{costs.attempts.length} attempts logged.</p>
        </>
      )}
      <h3>Cost per user per month</h3>
      <ul>
        {overview.map((o) => (
          <li key={`${o.user_id}|${o.month}`}>{o.month} · ${o.cost.toFixed(4)}</li>
        ))}
      </ul>
    </main>
  );
}
