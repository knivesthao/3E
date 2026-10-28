#!/usr/bin/env node
// QA book seeder — deterministic, $0 per run by default.
// Signs in via the dev magic link, creates one A1 project with three
// hand-written scenes (inside the level gate by construction: <=40 words,
// A1-list vocabulary only), and prints the pages to review.
// No AI is called unless --publish is passed (exactly one safety call).
//
// Usage:
//   node qa/seed.mjs [--api http://localhost:8787] [--email qa@example.com]
//                     [--title "Red Cat"] [--publish] [--clean]
//   npm run qa:seed -- --publish
//
// Requires the dev stack: ./run.sh dev  (API on :8787, frontend on :5173)

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.API ?? 'http://localhost:8787')).replace(/\/$/, '');
const EMAIL = opt('--email', process.env.EMAIL ?? 'qa@example.com');
const TITLE = opt('--title', 'Red Cat');
const FRONTEND = API.replace(':8787', ':5173');

// Hand-written A1 scenes. Every word is on the api/src/levels.ts A1 list
// (checked against the stemmer: no -ing doublings), each scene <= 25 words
// against the 40-word A1 cap, so the gate passes by construction.
const SCENES = [
  {
    narration: 'The sun is up. It is a hot day. A small red cat is by the house.',
    bubbles: [
      { speaker: 'boy', text: 'Hello, cat!' },
      { speaker: 'girl', text: 'Come and play with us!' },
    ],
  },
  {
    narration: 'The boy gives water to the cat. The cat drinks. Now the cat is happy.',
    bubbles: [
      { speaker: 'girl', text: 'Good cat!' },
      { speaker: 'boy', text: 'We like you!' },
    ],
  },
  {
    narration: 'It is night. The big dog runs to the house. The girl and the boy run home.',
    bubbles: [
      { speaker: 'boy', text: 'Do not run!' },
      { speaker: 'girl', text: 'We go home!' },
    ],
  },
];

let cookie = '';
async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...(cookie ? { headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers ?? {}) } } : {}),
  }).catch(() => null);
  if (!res) {
    console.error(`\nCannot reach the API at ${API}. Start the dev stack first: ./run.sh dev`);
    process.exit(1);
  }
  if (res.status === 401) {
    console.error('\nAuth failed (401). Is DEV_LINKS=true in api/wrangler.toml?');
    process.exit(1);
  }
  if (res.status === 429) {
    console.error('\nDaily AI limit reached (429). Try again tomorrow or with a fresh user.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\n${init.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  return res;
}

const health = await call('/api/health');
console.log('api:', JSON.stringify(await health.json()));

// Dev magic-link sign-in: no email sender needed locally.
const linkRes = await call('/api/auth/request-link', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL }),
});
const { devLink } = await linkRes.json();
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
console.log(`signed in as ${EMAIL}`);

const created = await (
  await call('/api/projects', { method: 'POST', body: JSON.stringify({ title: TITLE, level: 'A1' }) })
).json();
const project = created.project;
console.log(`project: ${project.id} (${project.title}, ${project.level})`);

for (const s of SCENES) {
  const r = await call(`/api/projects/${project.id}/scenes`, {
    method: 'POST',
    body: JSON.stringify({ data_json: s }),
  });
  const { scene } = await r.json();
  console.log(`scene ${scene.scene_number}: ok`);
}

const full = await (await call(`/api/projects/${project.id}`)).json();
console.log(`scenes on project: ${full.scenes.length}`);

let book = null;
if (flag('--publish')) {
  console.log('\n--publish: spending exactly one AI safety call…');
  const pub = await call(`/api/projects/${project.id}/publish`, { method: 'POST' });
  const data = await pub.json();
  book = data.book;
  console.log(`published book: ${book.id}`);
}

if (flag('--clean')) {
  await call(`/api/projects/${project.id}`, { method: 'DELETE' });
  console.log('\ncleaned up: project deleted.');
} else {
  console.log('\n--- review ---');
  console.log(`editor:  ${FRONTEND}/editor/${project.id}`);
  console.log(`library: ${FRONTEND}/library`);
  console.log(`costs:   ${FRONTEND}/costs?projectId=${project.id}`);
  if (book) {
    console.log(`reader:  ${FRONTEND}/reader/${project.id}`);
    console.log(`share:   ${API}/api/share/${book.id}  (append position routes in the reader)`);
  } else {
    console.log('(re-run with --publish to review reader + share; costs 1 AI call)');
  }
  console.log(`cleanup: node qa/seed.mjs --clean  (or DELETE /api/projects/${project.id})`);
  console.log('checklist: scenes read at A1, bubbles render, level badges look right, costs show $0 AI spend.');
}
