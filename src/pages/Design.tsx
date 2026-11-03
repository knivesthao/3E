import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';

function Box({
  x,
  y,
  w,
  h,
  title,
  lines,
  parked,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  parked?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={parked ? '#f5f5f4' : '#ffffff'}
        stroke={parked ? '#a8a29e' : '#0c4a4a'}
        strokeWidth={2}
        strokeDasharray={parked ? '6 4' : undefined}
      />
      <text x={x + 12} y={y + 24} fontSize={14} fontWeight="bold" fill="#1c1917">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 12} y={y + 44 + i * 18} fontSize={12} fill="#57534e">
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  parked,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  parked?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={parked ? '#a8a29e' : '#0c4a4a'}
        strokeWidth={2}
        strokeDasharray={parked ? '6 4' : undefined}
        markerEnd="url(#head)"
      />
      {label ? (
        <text
          x={mx}
          y={my - 6}
          fontSize={11}
          fill="#57534e"
          textAnchor="middle"
          fontStyle="italic"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function DiagramShell({
  title,
  ariaLabel,
  caption,
  viewBox,
  children,
}: {
  title: string;
  ariaLabel: string;
  caption: string;
  viewBox: string;
  children: React.ReactNode;
}) {
  const [presenting, setPresenting] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onFull() {
      setPresenting(document.fullscreenElement != null);
    }
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  async function togglePresent() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (wrapRef.current) {
        await wrapRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen unavailable — the diagram still works inline.
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`flex flex-col rounded-lg border border-stone-200 bg-white p-4 ${
        presenting ? 'h-full overflow-auto' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-stone-900">{title}</h3>
        <Button onClick={togglePresent} aria-label={`View ${title} full screen`}>
          {presenting ? 'Exit full screen' : '⛶ Full screen'}
        </Button>
      </div>
      <svg viewBox={viewBox} role="img" aria-label={ariaLabel} className="mt-2 w-full">
        <defs>
          <marker id="head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="none" stroke="#0c4a4a" strokeWidth={1.5} />
          </marker>
        </defs>
        {children}
      </svg>
      <p className="mt-2 text-sm text-stone-600">{caption}</p>
      {presenting ? <p className="mt-1 text-sm text-stone-500">Esc to exit full screen.</p> : null}
    </div>
  );
}

export function DesignSection() {
  return (
    <>
      <DiagramShell
        title="3E system design"
        viewBox="0 0 960 560"
        ariaLabel="System diagram: web app talks to a Hono API on Cloudflare Workers, backed by D1 and R2, calling Meta, Baseten, and Modal for AI."
        caption="All three AI providers are live: Baseten for text, Modal for images, Meta as the metered fallback. The AI factory diagram below shows how they build content."
      >
          <Box x={20} y={200} w={210} h={150} title="Web app" lines={['React + Vite + TS', 'Library · Studio · Editor', 'Reader · Exam · Admin']} />
          <Box x={310} y={200} w={230} h={150} title="Hono API (Workers)" lines={['auth · projects · scenes', 'ai · exam · admin · share', 'level gate · daily AI cap']} />
          <Box x={310} y={420} w={150} h={100} title="D1 database" lines={['users · sessions', 'projects · scenes · books', 'jobs · ai_usage · exam']} />
          <Box x={480} y={420} w={150} h={100} title="R2 bucket" lines={['scene panels', 'masks · portraits', 'immutable cache']} />
          <Box x={640} y={200} w={300} h={150} title="Meta Model API (active)" lines={['text: draft · check · exam help', 'image: panels · portraits', 'metered fallback route']} />
          <Box x={640} y={420} w={150} h={100} title="Baseten (active)" lines={['dictionary glosses', 'book text drafts', 'free-credits key']} />
          <Box x={810} y={420} w={130} h={100} title="Modal (active)" lines={['SDXL-Turbo images', 'credits first, $0 idle', 'SAM alt. parked']} />

          <Arrow x1={230} y1={275} x2={310} y2={275} label="HTTPS + session" />
          <Arrow x1={540} y1={275} x2={640} y2={275} label="metered, logged" />
          <Arrow x1={385} y1={350} x2={385} y2={420} />
          <Arrow x1={480} y1={350} x2={545} y2={420} />
          <Arrow x1={620} y1={350} x2={700} y2={420} />
          <Arrow x1={700} y1={350} x2={860} y2={420} />
      </DiagramShell>

      <section aria-label="Key flows" className="mt-4">
        <h3 className="mb-1 text-lg font-bold">Key flows</h3>
        <ul className="flex flex-col gap-1">
          <li className="rounded-md border border-stone-200 px-3 py-2">
            <strong>Author:</strong> Studio → Editor (scenes, cast, places) → AI draft → level check (90% word-list gate) → AI art → publish → Library.
          </li>
          <li className="rounded-md border border-stone-200 px-3 py-2">
            <strong>Read:</strong> shared link opens the Reader → read-aloud scoring and listen mode run on-device ($0, private) → practice exam tracks A1 progress.
          </li>
          <li className="rounded-md border border-stone-200 px-3 py-2">
            <strong>Cost control:</strong> every AI attempt is logged per user, task, and model; a daily per-user cap and the Admin costs tab keep spend visible; idle GPUs are deactivated, not left running.
          </li>
          <li className="rounded-md border border-stone-200 px-3 py-2">
            <strong>Factory:</strong> GitHub Actions seed shards run Baseten overnight → SQL dumps promote to shared D1; flash-batch.sh burns Modal credits into shared R2; Meta stays the metered fallback. Details below.
          </li>
        </ul>
      </section>
    </>
  );
}

export function FactorySection() {
  return (
    <div className="mt-6">
      <DiagramShell
        title="AI factory: how content gets built"
        viewBox="0 0 960 640"
        ariaLabel="Factory diagram: git feeds GitHub Actions and the Docker dev stack; Actions run Baseten dictionary shards and deploy to Cloudflare; Baseten and Modal generate text and images into shared D1 and R2; Meta is the fallback."
        caption="Git is the trigger for everything: pushes run CI, dispatches run the overnight dictionary shards, and the same commit deploys dev and prod."
      >
        <Box x={20} y={30} w={200} h={140} title="Git repo" lines={['main = production', 'develop = development', 'PRs · review · push']} />
        <Box x={260} y={30} w={240} h={140} title="GitHub Actions" lines={['ci: typecheck · test · deploy', 'seed: B2×2 + C1 + C2 shards', 'artifacts: SQL dumps']} />
        <Box x={540} y={30} w={200} h={140} title="Docker 3e-dev" lines={['local API + web UI', 'same D1/R2 bindings', 'QA books · art check']} />
        <Box x={780} y={30} w={160} h={140} title="Laptop scripts" lines={['qa/*.mjs seeders', 'flash-batch.sh', 'wrangler promote']} />

        <Box x={20} y={240} w={220} h={140} title="Baseten (text)" lines={['dictionary glosses', 'book drafts · exam help', 'free-credits key']} />
        <Box x={280} y={240} w={220} h={140} title="Modal (images)" lines={['SDXL-Turbo on T4', 'flash + panel art', 'credits first · $0 idle']} />
        <Box x={540} y={240} w={200} h={140} title="Meta (fallback)" lines={['text + image route', 'metered, per-call $0.01', 'used when others off']} />

        <Box x={20} y={450} w={440} h={150} title="Shared stores" lines={['D1 3e-db: definitions · users', 'D1 3e-books: published books', 'R2 3e-art · 3e-library: art']} />
        <Box x={500} y={450} w={440} h={150} title="Workers serve learners" lines={['dev + prod Hono API · cache', 'books A1–C2 · flashcards · exams', 'read-aloud · listen on-device']} />

        <Arrow x1={220} y1={100} x2={260} y2={100} label="push / dispatch" />
        <Arrow x1={740} y1={100} x2={780} y2={100} label="QA + upload" />
        <Arrow x1={380} y1={170} x2={130} y2={240} label="seed jobs" />
        <Arrow x1={420} y1={170} x2={390} y2={240} label="image jobs" />
        <Arrow x1={260} y1={170} x2={260} y2={450} label="SQL dumps" />
        <Arrow x1={860} y1={170} x2={860} y2={450} label="promote" />
        <Arrow x1={130} y1={380} x2={130} y2={450} label="glosses" />
        <Arrow x1={390} y1={380} x2={220} y2={450} label="art PNGs" />
        <Arrow x1={640} y1={380} x2={560} y2={450} label="fallback" />
        <Arrow x1={460} y1={525} x2={500} y2={525} label="reads" />
      </DiagramShell>
    </div>
  );
}

export function PipelineSection() {
  return (
    <div className="mt-6">
      <DiagramShell
        title="Publishing pipeline: from draft to library"
        viewBox="0 0 960 810"
        ariaLabel="Publishing pipeline diagram: draft, AI finish, gates, safety, and publish flow top to bottom; publish branches into keyword extraction, dictionary mapping, and backfill; the library serves readers."
        caption="Solid lines are the publish path. Word sync runs inside publish but only re-reads scenes edited since the last publish; flagged pages return to the author instead of shipping."
      >
        <Box x={20} y={30} w={240} h={100} title="Draft" lines={['Studio or self-written', 'level + cast picked', '6+ scenes']} />
        <Box x={20} y={160} w={240} h={100} title="AI finish" lines={['Baseten text draft', 'gate per batch', 'retry ≤4']} />
        <Box x={20} y={290} w={240} h={100} title="Gates" lines={['complete 1..N', 'level per scene', '400 + page flags']} />
        <Box x={20} y={420} w={240} h={100} title="Safety" lines={['Baseten screen', 'unsafe → 422', 'runs pre-spend']} />
        <Box x={20} y={550} w={240} h={100} title="Publish" lines={['manifest + tags', 'book row in library', 'art copy']} />
        <Box x={20} y={680} w={240} h={100} title="Library" lines={['shared 3e-books', 'R2 art, edge-cached', 'no partials']} />

        <Box x={300} y={550} w={180} h={100} title="Keywords" lines={['AI reads CHANGED scenes', '≤40 words each', '1 call / scene']} />
        <Box x={500} y={550} w={180} h={100} title="Map" lines={['DB-first lookup', 'defined vs missing', '$0']} />
        <Box x={700} y={550} w={240} h={100} title="Backfill + book_words" lines={['≤50 glosses / publish', 'INSERT OR IGNORE', 'scene→word rows']} />
        <Box x={300} y={680} w={240} h={100} title="Readers" lines={['leveled books', 'flashcards + exams', 'listen on-device']} />

        <Arrow x1={140} y1={130} x2={140} y2={160} />
        <Arrow x1={140} y1={260} x2={140} y2={290} />
        <Arrow x1={140} y1={390} x2={140} y2={420} />
        <Arrow x1={140} y1={520} x2={140} y2={550} />
        <Arrow x1={140} y1={650} x2={140} y2={680} />
        <Arrow x1={260} y1={600} x2={300} y2={600} label="changed scenes" />
        <Arrow x1={480} y1={600} x2={500} y2={600} />
        <Arrow x1={680} y1={600} x2={700} y2={600} />
        <Arrow x1={260} y1={730} x2={300} y2={730} label="reads" />
      </DiagramShell>
    </div>
  );
}
