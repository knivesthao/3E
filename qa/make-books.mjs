#!/usr/bin/env node
// QA book factory — makes REAL books through the live pipeline:
// create -> cast -> AI finish (draft + level gate) -> AI art per scene
// -> publish. Measures cost per book via /api/admin/costs/book.
//
// Provider guard: refuses to run if Baseten or Modal dev wiring is present,
// so every call below stays on the Meta Model API. One distinct user per
// book keeps each book under the daily per-user AI cap.
//
// Usage: node qa/make-books.mjs [--api http://localhost:8787] [--dry]
//   --dry prints the plan (providers + books) without spending anything.

import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.API ?? 'http://localhost:8787')).replace(/\/$/, '');
const FRONTEND = API.replace(':8787', ':5173');
const DRY = flag('--dry');

const BOOKS = [
  {
    title: 'Red Cat', level: 'A1', email: 'qa+redcat@example.com',
    cast: {
      characters: [
        { name: 'girl', description: 'a happy little girl' },
        { name: 'cat', description: 'a small red cat' },
      ],
      places: [{ name: 'house', description: 'a small house in the sun' }],
    },
  },
  {
    title: 'Night Market', level: 'A1', email: 'qa+market@example.com',
    cast: {
      characters: [
        { name: 'boy', description: 'a happy little boy' },
        { name: 'mother', description: 'a kind mother' },
      ],
      places: [{ name: 'market', description: 'a busy night market with lights' }],
    },
  },
  {
    title: 'A Trip to the Lake', level: 'A2', email: 'qa+lake@example.com',
    cast: {
      characters: [
        { name: 'father', description: 'a strong and funny father' },
        { name: 'girl', description: 'a brave little girl' },
      ],
      places: [{ name: 'lake', description: 'a wide blue lake with a small boat' }],
    },
  },
  {
    title: 'The New School', level: 'B1', email: 'qa+school@example.com',
    cast: {
      characters: [
        { name: 'teacher', description: 'a friendly young teacher' },
        { name: 'boy', description: 'a shy new student' },
      ],
      places: [{ name: 'school', description: 'a large school with a red bicycle outside' }],
    },
  },
  {
    title: 'Letters from the City', level: 'B2', email: 'qa+city@example.com',
    cast: {
      characters: [
        { name: 'sister', description: 'an older sister who writes letters' },
        { name: 'brother', description: 'a younger brother who waits for the train' },
      ],
      places: [{ name: 'city', description: 'a busy city station in the rain' }],
    },
  },
];

// ---- provider guard: Baseten and Modal must stay out of this run ----
const devVars = existsSync('api/.dev.vars') ? readFileSync('api/.dev.vars', 'utf8') : '';
const has = (re) => re.test(devVars);
const basetenWired = has(/^BASETEN_API_URL=https?:\/\//m) && has(/^BASETEN_API_KEY=.+/m);
const modalWired = has(/^MODAL_API_URL=https?:\/\//m) && has(/^MODAL_PROXY_TOKEN=.+/m);
console.log(`providers: baseten=${basetenWired ? 'WIRED (refusing)' : 'off'} modal=${modalWired ? 'WIRED (refusing)' : 'off'} meta=on`);
if (basetenWired || modalWired) {
  console.error('\nRefusing: Baseten/Modal dev wiring is present. Remove it for a Meta-only cost run.');
  process.exit(1);
}
if (DRY) {
  console.log('\n--dry: plan only. Books that would be made:');
  for (const b of BOOKS) console.log(`  ${b.level}  ${b.title}  (${b.email})`);
  process.exit(0);
}

let cookie = '';
async function call(path, init = {}, email = '') {
  const headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, { ...init, headers }).catch(() => null);
  if (!res) {
    console.error(`\nCannot reach the API at ${API}. Start the dev stack first: ./run.sh dev`);
    process.exit(1);
  }
  if (res.status === 429) {
    console.error(`\nDaily AI limit reached for ${email} (429). Rerun tomorrow or with fresh users.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\n${init.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  return res.json();
}

async function signIn(email) {
  cookie = '';
  const { devLink } = await call('/api/auth/request-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!devLink) {
    console.error('\nNo devLink returned. Is DEV_LINKS=true in api/wrangler.toml?');
    process.exit(1);
  }
  const verify = await fetch(devLink, { redirect: 'manual' });
  const setCookies = verify.headers.getSetCookie?.() ?? [];
  const session = setCookies.map((c) => c.split(';')[0]).find((c) => c && !c.endsWith('='));
  if (!session) {
    console.error('\nVerify did not set a session cookie.');
    process.exit(1);
  }
  cookie = session;
}

const results = [];
for (const spec of BOOKS) {
  console.log(`\n=== ${spec.level}  ${spec.title} ===`);
  await signIn(spec.email);
  const { project } = await call('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: spec.title, level: spec.level }),
  });
  console.log(`project ${project.id}`);
  await call(`/api/projects/${project.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ cast_json: spec.cast }),
  });
  console.log('cast saved');

  // Finish drafts all missing scenes; the level gate can reject individual
  // scenes, so retry until all 6 pass or we run out of patience.
  let saved = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const finish = await call('/api/ai/finish', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });
    saved = [...new Set([...saved, ...finish.saved])].sort((a, b) => a - b);
    console.log(`finish try ${attempt}: saved [${saved.join(',')}] failed ${JSON.stringify(finish.failed)}`);
    if (saved.length >= 6) break;
  }

  for (const n of saved) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await call('/api/ai/art', {
          method: 'POST',
          body: JSON.stringify({ projectId: project.id, sceneNumber: n }),
        });
        ok = true;
      } catch (e) {
        console.log(`art scene ${n} try ${attempt} failed, retrying…`);
        if (attempt === 3) throw e;
      }
    }
    console.log(`art scene ${n}: ok`);
  }
  const scenes = saved;

  const pub = await call(`/api/projects/${project.id}/publish`, { method: 'POST' });
  console.log(`published book ${pub.book.id}`);

  const costs = await call(`/api/admin/costs/book?projectId=${encodeURIComponent(project.id)}`);
  const providers = [...new Set((costs.attempts ?? []).map((a) => `${a.provider}/${a.task}`))];
  results.push({
    title: spec.title,
    level: spec.level,
    scenes: scenes.length,
    total: costs.totals.total,
    firstTry: costs.totals.first_try_cost,
    retries: costs.totals.retry_overhead,
    calls: (costs.attempts ?? []).length,
    providers,
    reader: `${FRONTEND}/read/${project.id}`,
  });
}

console.log('\n=== cost summary (Meta Model API only) ===');
for (const r of results) {
  console.log(
    `${r.level}  ${r.title}: ${r.scenes} scenes, ${r.calls} calls, ` +
      `total $${r.total.toFixed(4)} (first-try $${r.firstTry.toFixed(4)}, retries $${r.retries.toFixed(4)})`,
  );
  console.log(`    providers seen: ${r.providers.join(', ') || 'none logged!'}`);
}
const grand = results.reduce((s, r) => s + r.total, 0);
console.log(`\ngrand total for ${results.length} books: $${grand.toFixed(4)}`);
console.log('\nreaders:');
for (const r of results) console.log(`  ${r.reader}`);
