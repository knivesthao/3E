import { Suspense, lazy, useEffect, useState } from 'react';
import {
  getAdminSpecs,
  getAdminStats,
  listSeedJobs,
} from '../lib/api';
import type { AdminSpecs, AdminStats, SeedJob } from '../lib/api';
import { Alert, Badge, Button, Page } from '../components/ui';
import { DetailsDeck } from './Details';
import { DesignSection, FactorySection, PipelineSection } from './Design';

const CostsSection = lazy(() => import('./AdminCosts'));

type Tab = 'costs' | 'specs' | 'details' | 'design' | 'jobs';

function JobsSection() {
  const [jobs, setJobs] = useState<SeedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSeedJobs()
      .then((res) => setJobs(res.jobs))
      .catch(() => setError('Could not load seed jobs (dev worker only).'));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!jobs) return <p>Loading…</p>;
  if (jobs.length === 0) return <p className="text-stone-600">No seed runs recorded yet.</p>;
  const stalled = (j: SeedJob) =>
    j.status === 'running' && Date.now() - new Date(j.updated_at).getTime() > 6 * 3600 * 1000;
  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((j) => (
        <li key={j.scope} className="rounded-md border border-stone-200 px-3 py-2">
          <p>
            <strong>{j.scope}</strong>{' '}
            <Badge status={stalled(j) ? 'stalled' : j.status} />{' '}
            <span className="text-sm text-stone-600">
              {j.done}/{j.total} defined · {j.missed.length} missed
              {j.error ? ` · error: ${j.error}` : ''}
            </span>
          </p>
          {j.missed.length > 0 && (
            <p className="mt-1 text-sm text-stone-600">
              Missed ({j.missed.length}): {j.missed.slice(0, 12).join(', ')}
              {j.missed.length > 12 ? ` +${j.missed.length - 12} more` : ''} — rerun the same
              scope to pick these up without regenerating the rest.
            </p>
          )}
          <p className="mt-1 text-sm">
            {j.run_url ? (
              <a className="underline underline-offset-2" href={j.run_url} target="_blank" rel="noreferrer">
                Workflow run
              </a>
            ) : null}{' '}
            <span className="text-stone-500">updated {new Date(j.updated_at).toLocaleString()}</span>
          </p>
        </li>
      ))}
    </ul>
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

const TAB_LABEL: Record<Tab, string> = {
  costs: 'Costs',
  specs: 'Tech & content',
  details: 'Pitch',
  design: 'Design',
  jobs: 'Seed jobs',
};

export default function Admin() {
  const [tab, setTab] = useState<Tab>('costs');
  return (
    <Page>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Admin sections">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <Button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} pressed={tab === t}>
            {TAB_LABEL[t]}
          </Button>
        ))}
      </div>
      {tab === 'costs' ? (
        <Suspense fallback={<p>Loading costs…</p>}>
          <CostsSection />
        </Suspense>
      ) : tab === 'specs' ? (
        <>
          <SpecsSection />
          <ContentSection />
        </>
      ) : tab === 'details' ? (
        <DetailsDeck />
      ) : tab === 'design' ? (
        <>
          <DesignSection />
          <PipelineSection />
          <FactorySection />
        </>
      ) : (
        <JobsSection />
      )}
    </Page>
  );
}
