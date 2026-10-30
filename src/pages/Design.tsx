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

export function DesignSection() {
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
    <>
      <div
        ref={wrapRef}
        className={`flex flex-col rounded-lg border border-stone-200 bg-white p-4 ${
          presenting ? 'h-full overflow-auto' : ''
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-stone-900">3E system design</h3>
          <Button onClick={togglePresent} aria-label="View diagram full screen">
            {presenting ? 'Exit full screen' : '⛶ Full screen'}
          </Button>
        </div>
        <svg
          viewBox="0 0 960 560"
          role="img"
          aria-label="System diagram: web app talks to a Hono API on Cloudflare Workers, backed by D1 and R2, calling Meta Model API for AI, with Baseten and Modal parked."
          className="mt-2 w-full"
        >
          <defs>
            <marker id="head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="#0c4a4a" strokeWidth={1.5} />
            </marker>
          </defs>

          <Box x={20} y={200} w={210} h={150} title="Web app" lines={['React + Vite + TS', 'Library · Studio · Editor', 'Reader · Exam · Admin']} />
          <Box x={310} y={200} w={230} h={150} title="Hono API (Workers)" lines={['auth · projects · scenes', 'ai · exam · admin · share', 'level gate · daily AI cap']} />
          <Box x={310} y={420} w={150} h={100} title="D1 database" lines={['users · sessions', 'projects · scenes · books', 'jobs · ai_usage · exam']} />
          <Box x={480} y={420} w={150} h={100} title="R2 bucket" lines={['scene panels', 'masks · portraits', 'immutable cache']} />
          <Box x={640} y={200} w={300} h={150} title="Meta Model API (active)" lines={['text: draft · check · exam help', 'image: panels · portraits', 'segment: cutouts (SAM alt.)']} />
          <Box x={640} y={420} w={150} h={100} title="Baseten (parked)" lines={['Glimmer text route', 'dev IaC only', 'no idle spend']} parked />
          <Box x={810} y={420} w={130} h={100} title="Modal (parked)" lines={['SAM cutouts', 'scale-to-zero', 'needs credits']} parked />

          <Arrow x1={230} y1={275} x2={310} y2={275} label="HTTPS + session" />
          <Arrow x1={540} y1={275} x2={640} y2={275} label="metered, logged" />
          <Arrow x1={385} y1={350} x2={385} y2={420} />
          <Arrow x1={480} y1={350} x2={545} y2={420} />
          <Arrow x1={620} y1={350} x2={700} y2={420} parked />
          <Arrow x1={700} y1={350} x2={860} y2={420} parked />
        </svg>
        <p className="mt-2 text-sm text-stone-600">
          Solid lines are live traffic. Dashed lines are parked providers — wired, metered, and off until they win on cost.
        </p>
        {presenting ? <p className="mt-1 text-sm text-stone-500">Esc to exit full screen.</p> : null}
      </div>

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
        </ul>
      </section>
    </>
  );
}
