import { useEffect, useState } from 'react';
import { getBookCosts, getCostsOverview, listProjects } from '../lib/api';
import type { BookCosts, Project } from '../lib/api';
import { Alert, Field, Page, inputClass } from '../components/ui';

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
    <Page title="Costs">
      {error && <Alert>{error}</Alert>}
      <Field label="Comic">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className={inputClass}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </Field>
      {costs && (
        <>
          <p className="rounded-md bg-stone-100 px-3 py-2">
            Total ${costs.totals.total.toFixed(4)} · first try $
            {costs.totals.first_try_cost.toFixed(4)} · retries $
            {costs.totals.retry_overhead.toFixed(4)}
          </p>
          <section aria-label="Costs by task">
            <h2 className="mb-1 text-xl font-bold">By task</h2>
            <ul className="flex flex-col gap-1">
              {costs.by_task.map((t) => (
                <li key={t.task} className="rounded-md border border-stone-200 px-3 py-2">
                  {t.task}: ${t.cost.toFixed(4)} ({t.calls} calls)
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Costs by model">
            <h2 className="mb-1 text-xl font-bold">By model</h2>
            <ul className="flex flex-col gap-1">
              {costs.by_model.map((m) => (
                <li key={m.model} className="rounded-md border border-stone-200 px-3 py-2">
                  {m.model}: ${m.cost.toFixed(4)} ({m.calls} calls)
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Retries">
            <h2 className="mb-1 text-xl font-bold">Retries</h2>
            <ul className="flex flex-col gap-1">
              {costs.retries.map((r) => (
                <li key={`${r.model}|${r.task}`} className="rounded-md border border-stone-200 px-3 py-2">
                  {r.model} {r.task}: {r.retries} retries, max attempt {r.max_attempt}
                </li>
              ))}
            </ul>
          </section>
          <p>{costs.attempts.length} attempts logged.</p>
        </>
      )}
      <section aria-label="Cost per user per month">
        <h2 className="mb-1 text-xl font-bold">Cost per user per month</h2>
        <ul className="flex flex-col gap-1">
          {overview.map((o) => (
            <li key={`${o.user_id}|${o.month}`} className="rounded-md border border-stone-200 px-3 py-2">
              {o.month} · ${o.cost.toFixed(4)}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
