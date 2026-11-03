#!/usr/bin/env node
// QA book factory — makes REAL books through the live pipeline:
// create -> cast -> AI finish (draft + level gate) -> AI art per scene
// -> publish. Measures cost per book via /api/admin/costs/book.
//
// Provider guard: refuses to run if Baseten or Modal dev wiring is present,
// so every call below stays on the Meta Model API. One distinct user per
// book keeps each book under the daily per-user AI cap.
//
// Usage: node qa/make-books.mjs [--api URL] [--dry] [--limit N] [--offset N]
//   [--tags a,b] [--allow-wired] [--resume] [--shard i/n] [--ledger PATH]
//   --dry prints the plan (providers + books) without spending anything.
//   --resume continues ledgered partials/failed books on the SAME project
//   (no duplicate drafts); published books are skipped.
//   --shard i/n runs a disjoint slice for parallel jobs (e.g. three
//   terminals: --shard 0/3, 1/3, 2/3). Each shard writes its own ledger
//   file unless --ledger overrides it; qa/ledger.mjs merges them.
//   BOOK_LEDGER env also overrides the ledger path.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.API ?? 'http://localhost:8787')).replace(/\/$/, '');
const FRONTEND = API.replace(':8787', ':5173');
const DRY = flag('--dry');
const LIMIT = Number(opt('--limit', '0')) || 0;
const OFFSET = Number(opt('--offset', '0')) || 0;
const TAGS = opt('--tags', '').split(',').map((s) => s.trim()).filter(Boolean);
// Explicit opt-in to measure with wired providers (Baseten text, Modal
// images with Meta fallback). Without it the script stays Meta-only.
const ALLOW_WIRED = flag('--allow-wired');

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
  {
    title: 'Sunny Park', level: 'A1', email: 'qa+park@example.com',
    cast: {
      characters: [
        { name: 'girl', description: 'a happy little girl with a red ball' },
        { name: 'dog', description: 'a small brown dog' },
      ],
      places: [{ name: 'park', description: 'a sunny green park with big trees' }],
    },
  },
  {
    title: 'Rain Day', level: 'A1', email: 'qa+rain@example.com',
    cast: {
      characters: [
        { name: 'boy', description: 'a little boy in yellow boots' },
        { name: 'grandmother', description: 'a kind grandmother with tea' },
      ],
      places: [{ name: 'house', description: 'a warm little house in the rain' }],
    },
  },
  {
    title: 'The Red Bus', level: 'A1', email: 'qa+bus@example.com',
    cast: {
      characters: [
        { name: 'driver', description: 'a friendly bus driver' },
        { name: 'boy', description: 'a happy little boy with a school bag' },
      ],
      places: [{ name: 'bus', description: 'a big red bus on a sunny road' }],
    },
  },
  {
    title: 'The Lost Kite', level: 'A2', email: 'qa+kite@example.com',
    cast: {
      characters: [
        { name: 'girl', description: 'a brave girl who loves the wind' },
        { name: 'brother', description: 'her small brother who holds the string' },
      ],
      places: [{ name: 'hill', description: 'a grassy hill under white clouds' }],
    },
  },
  {
    title: "Grandma's Soup", level: 'A2', email: 'qa+soup@example.com',
    cast: {
      characters: [
        { name: 'grandmother', description: 'a grandmother who cooks slowly' },
        { name: 'girl', description: 'a hungry girl who helps cut bread' },
      ],
      places: [{ name: 'kitchen', description: 'a warm kitchen with a big pot' }],
    },
  },
  {
    title: 'A Snowy Day', level: 'A2', email: 'qa+snow@example.com',
    cast: {
      characters: [
        { name: 'boy', description: 'a boy in a blue coat' },
        { name: 'father', description: 'a father who pulls a red sled' },
      ],
      places: [{ name: 'village', description: 'a quiet snowy village at morning' }],
    },
  },
  {
    title: 'The River Boat', level: 'A2', email: 'qa+boat@example.com',
    cast: {
      characters: [
        { name: 'fisherman', description: 'an old fisherman with a wide hat' },
        { name: 'boy', description: 'a boy who wants to learn the river' },
      ],
      places: [{ name: 'river', description: 'a slow green river between hills' }],
    },
  },
  {
    title: 'The Old Lighthouse', level: 'B1', email: 'qa+lighthouse@example.com',
    cast: {
      characters: [
        { name: 'keeper', description: 'a lonely lighthouse keeper' },
        { name: 'girl', description: 'a curious girl from the village' },
      ],
      places: [{ name: 'lighthouse', description: 'a tall white lighthouse on grey rocks' }],
    },
  },
  {
    title: 'Saturday Market', level: 'B1', email: 'qa+saturday@example.com',
    cast: {
      characters: [
        { name: 'seller', description: 'a loud cheerful fruit seller' },
        { name: 'mother', description: 'a mother counting coins' },
      ],
      places: [{ name: 'market', description: 'a crowded Saturday market with colors' }],
    },
  },
  {
    title: 'The Broken Bicycle', level: 'B1', email: 'qa+bicycle@example.com',
    cast: {
      characters: [
        { name: 'boy', description: 'a determined boy with a toolbox' },
        { name: 'neighbor', description: 'a retired mechanic next door' },
      ],
      places: [{ name: 'street', description: 'a quiet street with repair shop' }],
    },
  },
  {
    title: 'A Letter for Sam', level: 'B1', email: 'qa+letter@example.com',
    cast: {
      characters: [
        { name: 'postman', description: 'a young postman on a bicycle' },
        { name: 'sam', description: 'an old man waiting by the window' },
      ],
      places: [{ name: 'town', description: 'a small town with one post office' }],
    },
  },
  {
    title: 'The Night Train', level: 'B2', email: 'qa+train@example.com',
    cast: {
      characters: [
        { name: 'traveler', description: 'a tired traveler with a suitcase' },
        { name: 'conductor', description: 'a conductor who knows every station' },
      ],
      places: [{ name: 'train', description: 'a night train crossing dark fields' }],
    },
  },
  {
    title: 'Climbing the Hill', level: 'B2', email: 'qa+climb@example.com',
    cast: {
      characters: [
        { name: 'climber', description: 'an experienced mountain climber' },
        { name: 'student', description: 'a nervous young student' },
      ],
      places: [{ name: 'mountain', description: 'a steep mountain above the clouds' }],
    },
  },
  {
    title: 'The Empty House', level: 'B2', email: 'qa+empty@example.com',
    cast: {
      characters: [
        { name: 'woman', description: 'a woman returning after years away' },
        { name: 'neighbor', description: 'a neighbor who kept the garden' },
      ],
      places: [{ name: 'house', description: 'a dusty empty house full of memories' }],
    },
  },
  {
    title: 'Voices on the Radio', level: 'B2', email: 'qa+radio@example.com',
    cast: {
      characters: [
        { name: 'host', description: 'a late-night radio host' },
        { name: 'caller', description: 'a caller who never gives a name' },
      ],
      places: [{ name: 'studio', description: 'a small radio studio at midnight' }],
    },
  },
  {
    title: 'The Cartographer', level: 'C1', email: 'qa+cartographer@example.com',
    cast: {
      characters: [
        { name: 'cartographer', description: 'an aging mapmaker losing his sight' },
        { name: 'apprentice', description: 'his impatient young apprentice' },
      ],
      places: [{ name: 'atelier', description: 'a map atelier smelling of ink' }],
    },
  },
  {
    title: 'Salt and Stone', level: 'C1', email: 'qa+salt@example.com',
    cast: {
      characters: [
        { name: 'miner', description: 'a third-generation salt miner' },
        { name: 'engineer', description: 'an engineer sent to close the mine' },
      ],
      places: [{ name: 'mine', description: 'a white salt mine under the hills' }],
    },
  },
  {
    title: 'The Winter Archive', level: 'C1', email: 'qa+archive@example.com',
    cast: {
      characters: [
        { name: 'archivist', description: 'a meticulous archivist of letters' },
        { name: 'historian', description: 'a historian chasing one missing file' },
      ],
      places: [{ name: 'archive', description: 'a cold archive of wooden drawers' }],
    },
  },
  {
    title: 'Crossing at Dawn', level: 'C1', email: 'qa+dawn@example.com',
    cast: {
      characters: [
        { name: 'ferryman', description: 'a ferryman who has crossed for decades' },
        { name: 'passenger', description: 'a passenger carrying an empty case' },
      ],
      places: [{ name: 'harbor', description: 'a grey harbor before sunrise' }],
    },
  },
  {
    title: 'The Glass Garden', level: 'C1', email: 'qa+garden@example.com',
    cast: {
      characters: [
        { name: 'botanist', description: 'a botanist growing impossible flowers' },
        { name: 'visitor', description: 'a skeptical visitor from the city' },
      ],
      places: [{ name: 'greenhouse', description: 'a glass greenhouse in winter' }],
    },
  },
  {
    title: 'An Atlas of Small Hours', level: 'C2', email: 'qa+atlas@example.com',
    cast: {
      characters: [
        { name: 'insomniac', description: 'an insomniac writer mapping the night' },
        { name: 'baker', description: 'a baker who works before dawn' },
      ],
      places: [{ name: 'city', description: 'a sleeping city at three in the morning' }],
    },
  },
  {
    title: 'The Weight of Light', level: 'C2', email: 'qa+light@example.com',
    cast: {
      characters: [
        { name: 'physicist', description: 'a retired physicist with doubts' },
        { name: 'daughter', description: 'her estranged daughter, a painter' },
      ],
      places: [{ name: 'observatory', description: 'a hilltop observatory at dusk' }],
    },
  },
  {
    title: 'Harbor of Echoes', level: 'C2', email: 'qa+echoes@example.com',
    cast: {
      characters: [
        { name: 'captain', description: 'a captain who never went to sea' },
        { name: 'singer', description: 'a singer who performs for ships' },
      ],
      places: [{ name: 'harbor', description: 'a fogbound harbor of empty ships' }],
    },
  },
  {
    title: 'A Field Guide to Forgetting', level: 'C2', email: 'qa+forgetting@example.com',
    cast: {
      characters: [
        { name: 'naturalist', description: 'a naturalist cataloguing disappearance' },
        { name: 'child', description: 'a child who remembers everything' },
      ],
      places: [{ name: 'wetland', description: 'a draining wetland at low water' }],
    },
  },
  {
    title: 'The Last Observatory', level: 'C2', email: 'qa+observatory@example.com',
    cast: {
      characters: [
        { name: 'astronomer', description: 'the last astronomer on the mountain' },
        { name: 'technician', description: 'a technician sent to decommission it' },
      ],
      places: [{ name: 'peak', description: 'a mountain peak above light pollution' }],
    },
  },
];

// ---- provider guard: Baseten and Modal must stay out of this run ----
const devVars = existsSync('api/.dev.vars') ? readFileSync('api/.dev.vars', 'utf8') : '';
const has = (re) => re.test(devVars);
const basetenWired = has(/^BASETEN_API_URL=https?:\/\//m) && has(/^BASETEN_API_KEY=.+/m);
const modalWired = has(/^MODAL_IMAGE_API_URL=https?:\/\//m) && has(/^MODAL_PROXY_TOKEN=.+/m);
console.log(`providers: baseten=${basetenWired ? 'WIRED' : 'off'} modal=${modalWired ? 'WIRED' : 'off'} meta=on`);
if ((basetenWired || modalWired) && !ALLOW_WIRED) {
  console.error('\nRefusing: Baseten/Modal dev wiring is present. Remove it for a Meta-only cost run, or pass --allow-wired to measure with wired providers.');
  process.exit(1);
}
const QA_DIR = dirname(fileURLToPath(import.meta.url));
// Publish ledger: one entry per spec title. A partial (incomplete draft,
// failed publish, crashed run) stays in the ledger so the next run with
// --resume retries only what is not yet published.
function saveLedger(ledger) {
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}
const RESUME = flag('--resume');
// Sharding: split the 30-book run across parallel jobs. --shard i/n takes
// every book whose BOOKS index is congruent to i mod n, so shards are
// disjoint and together cover everything. OFFSET/LIMIT apply within the
// shard. Each shard gets its own ledger file by default (parallel jobs
// must not share one JSON file); qa/ledger.mjs merges them for status.
function parseShard(s) {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? '');
  if (!m) return null;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!(n >= 1 && i >= 0 && i < n)) throw new Error(`bad --shard ${s}: want i/n with 0 <= i < n`);
  return { i, n };
}
const SHARD = parseShard(opt('--shard', ''));
const LEDGER_DEFAULT = SHARD
  ? join(QA_DIR, `book-ledger-shard${SHARD.i}of${SHARD.n}.json`)
  : join(QA_DIR, 'book-ledger.json');
const LEDGER_PATH = process.env.BOOK_LEDGER ?? opt('--ledger', LEDGER_DEFAULT);
function loadLedger() {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return {};
  }
}
const ledger = loadLedger();
let QUEUE = SHARD ? BOOKS.filter((_, idx) => idx % SHARD.n === SHARD.i) : BOOKS.slice();
QUEUE = LIMIT > 0 ? QUEUE.slice(OFFSET, OFFSET + LIMIT) : QUEUE.slice(OFFSET);
if (RESUME) {
  const before = QUEUE.length;
  QUEUE = QUEUE.filter((b) => ledger[b.title]?.status !== 'published');
  console.log(`--resume: skipping ${before - QUEUE.length} already-published books`);
}
if (SHARD) console.log(`--shard ${SHARD.i}/${SHARD.n}: ${QUEUE.length} books in this shard (ledger: ${LEDGER_PATH})`);
if (DRY) {
  console.log('\n--dry: plan only. Books that would be made:');
  for (const b of QUEUE) console.log(`  ${b.level}  ${b.title}  (${b.email}) [${ledger[b.title]?.status ?? 'new'}]`);
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
    // HTTP errors throw so the per-book catch ledger-marks the failure and
    // the run continues. Only an unreachable API or a spent daily cap
    // aborts the whole run (nothing else can proceed).
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
async function tryGetProject(projectId) {
  // Raw fetch (not call): a 404 here just means "start fresh", it must
  // never abort the run.
  const res = await fetch(`${API}/api/projects/${projectId}`, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

for (const spec of QUEUE) {
  console.log(`\n=== ${spec.level}  ${spec.title} ===`);
  // One bad book never kills the run: partials land in the ledger and the
  // next --resume run continues the SAME project (no duplicate drafts).
  // Only an unreachable API or a 429 (daily AI cap) aborts.
  try {
  await signIn(spec.email);
  let project;
  let saved = [];
  let artDone = [];
  const prior = RESUME ? ledger[spec.title] : null;
  if (prior?.projectId) {
    const existing = await tryGetProject(prior.projectId);
    if (existing?.project) {
      project = existing.project;
      saved = [...new Set([...(existing.scenes ?? []).map((s) => s.scene_number), ...(prior.saved ?? [])])].sort((a, b) => a - b);
      artDone = prior.art ?? [];
      console.log(`resuming project ${project.id}: saved [${saved.join(',')}] art [${artDone.join(',')}]`);
    }
  }
  if (!project) {
    const created = await call('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title: spec.title, level: spec.level }),
    });
    project = created.project;
    console.log(`project ${project.id}`);
    await call(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cast_json: spec.cast }),
    });
    console.log('cast saved');
  }
  ledger[spec.title] = { status: 'partial', level: spec.level, projectId: project.id, saved, art: artDone };
  saveLedger(ledger);

  // Finish drafts all missing scenes; the level gate can reject individual
  // scenes, so retry until all 6 pass or we run out of patience. A short
  // draft never publishes (the server also 400s incomplete drafts).
  let failed = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const finish = await call('/api/ai/finish', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });
    saved = [...new Set([...saved, ...finish.saved])].sort((a, b) => a - b);
    failed = finish.failed ?? [];
    console.log(`finish try ${attempt}: saved [${saved.join(',')}] failed ${JSON.stringify(failed)}`);
    if (saved.length >= 6) break;
  }
  ledger[spec.title] = { status: 'partial', level: spec.level, projectId: project.id, saved, art: artDone, missing: failed };
  saveLedger(ledger);
  if (saved.length < 6) {
    console.error(`partial draft for ${spec.level} ${spec.title}: saved [${saved.join(',')}] missing ${JSON.stringify(failed)} — ledgered, continuing`);
    continue;
  }

  // Art is per-scene idempotent but not free: skip scenes the ledger
  // already recorded, so retries only pay for what is missing.
  for (const n of saved) {
    if (artDone.includes(n)) {
      console.log(`art scene ${n}: already done, skipping`);
      continue;
    }
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
    artDone = [...new Set([...artDone, n])].sort((a, b) => a - b);
    ledger[spec.title] = { status: 'partial', level: spec.level, projectId: project.id, saved, art: artDone, missing: failed };
    saveLedger(ledger);
    console.log(`art scene ${n}: ok`);
  }
  const scenes = saved;

  const pub = await call(`/api/projects/${project.id}/publish`, {
    method: 'POST',
    body: TAGS.length > 0 ? JSON.stringify({ tags: TAGS }) : undefined,
  });
  console.log(`published book ${pub.book.id}`);

  const costs = await call(`/api/admin/costs/book?projectId=${encodeURIComponent(project.id)}`);
  const providers = [...new Set((costs.attempts ?? []).map((a) => `${a.provider}/${a.task}`))];
  ledger[spec.title] = {
    status: 'published',
    level: spec.level,
    projectId: project.id,
    bookId: pub.book.id,
    saved,
    art: artDone,
    total: costs.totals.total,
    providers,
  };
  saveLedger(ledger);
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
  } catch (e) {
    console.error(`FAILED ${spec.level} ${spec.title}: ${e instanceof Error ? e.message : e} — ledgered, continuing`);
    ledger[spec.title] = { ...(ledger[spec.title] ?? { level: spec.level }), status: 'failed', error: e instanceof Error ? e.message : String(e) };
    saveLedger(ledger);
  }
}

console.log('\n=== cost summary (ledger $; Baseten-side burn is on the Baseten dashboard) ===');
for (const r of results) {
  console.log(
    `${r.level}  ${r.title}: ${r.scenes} scenes, ${r.calls} calls, ` +
      `total $${r.total.toFixed(4)} (first-try $${r.firstTry.toFixed(4)}, retries $${r.retries.toFixed(4)})`,
  );
  console.log(`    providers seen: ${r.providers.join(', ') || 'none logged!'}`);
}
const partials = Object.entries(ledger).filter(([, v]) => v.status === 'partial');
const failedBooks = Object.entries(ledger).filter(([, v]) => v.status === 'failed');
if (partials.length > 0) {
  console.log(`\npartial (${partials.length}) — rerun with --resume to retry:`);
  for (const [t, v] of partials) console.log(`  ${v.level}  ${t}  project ${v.projectId} saved [${(v.saved ?? []).join(',')}]`);
}
if (failedBooks.length > 0) {
  console.log(`\nfailed (${failedBooks.length}) — inspect, then rerun with --resume:`);
  for (const [t, v] of failedBooks) console.log(`  ${v.level}  ${t}: ${(v.error ?? '').slice(0, 120)}`);
}
const grand = results.reduce((s, r) => s + r.total, 0);
console.log(`\ngrand total for ${results.length} books: $${grand.toFixed(4)}`);
console.log('\nreaders:');
for (const r of results) console.log(`  ${r.reader}`);
