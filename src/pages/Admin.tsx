import { useEffect, useState } from 'react';
import {
  getAdminSpecs,
  getAdminStats,
  getBookCosts,
  getCostsOverview,
  getExamItems,
  listProjects,
} from '../lib/api';
import type { AdminSpecs, AdminStats, BookCosts, ExamItemStat, Project } from '../lib/api';
import { Alert, Button, Field, Page, inputClass } from '../components/ui';
import { DetailsDeck } from './Details';
import { DesignSection } from './Design';

type Tab = 'costs' | 'specs' | 'content' | 'exam' | 'details' | 'design';

function CostsSection() {
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
    <>
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
            <h3 className="mb-1 text-lg font-bold">By task</h3>
            <ul className="flex flex-col gap-1">
              {costs.by_task.map((t) => (
                <li key={t.task} className="rounded-md border border-stone-200 px-3 py-2">
                  {t.task}: ${t.cost.toFixed(4)} ({t.calls} calls)
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Costs by model">
            <h3 className="mb-1 text-lg font-bold">By model</h3>
            <ul className="flex flex-col gap-1">
              {costs.by_model.map((m) => (
                <li key={m.model} className="rounded-md border border-stone-200 px-3 py-2">
                  {m.model}: ${m.cost.toFixed(4)} ({m.calls} calls)
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Retries">
            <h3 className="mb-1 text-lg font-bold">Retries</h3>
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
        <h3 className="mb-1 text-lg font-bold">Cost per user per month</h3>
        <ul className="flex flex-col gap-1">
          {overview.map((o) => (
            <li key={`${o.user_id}|${o.month}`} className="rounded-md border border-stone-200 px-3 py-2">
              {o.month} · ${o.cost.toFixed(4)}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SpecsSection() {
  const [specs, setSpecs] = useState<AdminSpecs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminSpecs()
      .then(setSpecs)
      .catch(() => setError('Could not load specs.'));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!specs) return <p>Loading…</p>;
  return (
    <>
      <section aria-label="Models">
        <h3 className="mb-1 text-lg font-bold">Models</h3>
        <ul className="flex flex-col gap-1">
          {Object.entries(specs.models).map(([job, model]) => (
            <li key={job} className="rounded-md border border-stone-200 px-3 py-2">
              {job}: <span className="font-mono text-sm">{model}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Baseten routing">
        <h3 className="mb-1 text-lg font-bold">Self-hosted text</h3>
        <p className="rounded-md bg-stone-100 px-3 py-2">
          Baseten routing: {specs.basetenConfigured ? 'on' : 'off'}
          {' · '}tasks: {specs.basetenTasks.join(', ') || 'none'}
        </p>
      </section>
      <p>Daily AI cap per user: {specs.dailyAiLimit} calls.</p>
    </>
  );
}

function ContentSection() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => setError('Could not load content stats.'));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!stats) return <p>Loading…</p>;
  const labels: Record<string, string> = {
    users: 'Signed-up users',
    projects: 'Comics',
    scenes: 'Scenes',
    books: 'Published books',
    panels: 'Art panels',
    jobs: 'Jobs',
    ai_usage: 'AI attempts logged',
  };
  return (
    <ul className="flex flex-col gap-1">
      {Object.entries(stats.counts).map(([table, n]) => (
        <li key={table} className="rounded-md border border-stone-200 px-3 py-2">
          {labels[table] ?? table}: <strong>{n}</strong>
        </li>
      ))}
    </ul>
  );
}

function ExamItemsSection() {
  const [items, setItems] = useState<ExamItemStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExamItems()
      .then((res) => setItems(res.items))
      .catch(() => setError('Could not load exam items.'));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!items) return <p>Loading…</p>;
  if (items.length === 0) return <p>No attempts yet — stats appear after the first test.</p>;
  const sorted = [...items].sort((a, b) => (a.pct ?? 100) - (b.pct ?? 100));
  return (
    <ul className="flex flex-col gap-1">
      {sorted.map((item) => (
        <li key={item.id} className="rounded-md border border-stone-200 px-3 py-2">
          <strong>{item.id}</strong> · {item.attempts} attempts ·{' '}
          {item.pct === null ? 'no graded answers yet' : `${item.pct}% correct`}
          {item.pct !== null && item.pct < 50 && item.attempts >= 3 && ' · hard — consider rewording'}
        </li>
      ))}
    </ul>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  costs: 'Costs',
  specs: 'Tech specs',
  content: 'Content',
  exam: 'Exam items',
  details: 'Details',
  design: 'Design',
};

export default function Admin() {
  const [tab, setTab] = useState<Tab>('costs');
  return (
    <Page title="Admin">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Admin sections">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <Button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} pressed={tab === t}>
            {TAB_LABEL[t]}
          </Button>
        ))}
      </div>
      {tab === 'costs' ? (
        <CostsSection />
      ) : tab === 'specs' ? (
        <SpecsSection />
      ) : tab === 'content' ? (
        <ContentSection />
      ) : tab === 'exam' ? (
        <ExamItemsSection />
      ) : tab === 'details' ? (
        <DetailsDeck />
      ) : (
        <DesignSection />
      )}
    </Page>
  );
}
