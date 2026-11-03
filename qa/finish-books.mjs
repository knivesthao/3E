#!/usr/bin/env node
// Completes the 5-book factory run: fresh full run for Red Cat under a new
// user (old project fragmented across the 50/day cap), top-up rounds for
// Lake (2 scenes) and City (1 scene). Meta only; no Modal/Baseten.
const API = (process.env.API ?? 'http://localhost:8787').replace(/\/$/, '');

async function signIn(email) {
  const { devLink } = await (
    await fetch(`${API}/api/auth/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  ).json();
  const v = await fetch(devLink, { redirect: 'manual' });
  return (v.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c && !c.endsWith('='));
}

async function call(path, init = {}, cookie = '') {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function artAll(pid, cookie, numbers) {
  for (const n of numbers) {
    const a = await call('/api/ai/art', { method: 'POST', body: JSON.stringify({ projectId: pid, sceneNumber: n }) }, cookie).catch(async (e) => {
      console.log(`  art ${n} failed once, retrying…`);
      return call('/api/ai/art', { method: 'POST', body: JSON.stringify({ projectId: pid, sceneNumber: n }) }, cookie);
    });
    console.log(`  art ${n} ok${a.panels[0].mask_url === null ? ' (no mask)' : ''}`);
  }
}

async function finishLoop(pid, cookie, tries = 4) {
  let saved = [];
  for (let i = 1; i <= tries; i++) {
    const f = await call('/api/ai/finish', { method: 'POST', body: JSON.stringify({ projectId: pid }) }, cookie);
    saved = [...new Set([...saved, ...f.saved])].sort((a, b) => a - b);
    console.log(`  finish try ${i}: saved [${saved}] failed ${JSON.stringify(f.failed.map((x) => x.scene_number))}`);
    if (saved.length >= 6) break;
  }
  return saved;
}

// --- Red Cat, fresh user, full run ---
console.log('=== A1 Red Cat (fresh) ===');
{
  const cookie = await signIn('qa+redcat2@example.com');
  const { project } = await call('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Red Cat', level: 'A1' }) }, cookie);
  console.log('project', project.id);
  await call(`/api/projects/${project.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      cast_json: {
        characters: [
          { name: 'girl', description: 'a happy little girl' },
          { name: 'cat', description: 'a small red cat' },
        ],
        places: [{ name: 'house', description: 'a small house in the sun' }],
      },
    }),
  }, cookie);
  const saved = await finishLoop(project.id, cookie);
  await artAll(project.id, cookie, saved);
  const pub = await call(`/api/projects/${project.id}/publish`, { method: 'POST' }, cookie);
  console.log('published', pub.book.id, `reader: ${API.replace(':8787', ':5173')}/read/${project.id}`);
}

// --- top-ups ---
for (const [email, pid] of [
  ['qa+lake@example.com', '1bba65da-c5e5-44d4-ae17-2934f1c8cf22'],
  ['qa+city@example.com', '2b28beba-09cb-4786-982c-403399515548'],
]) {
  console.log(`=== top-up ${email} ===`);
  const cookie = await signIn(email);
  const full = await call(`/api/projects/${pid}`, {}, cookie);
  const have = new Set(full.scenes.map((s) => s.scene_number));
  const missing = [1, 2, 3, 4, 5, 6].filter((n) => !have.has(n));
  console.log('  have:', [...have].join(','), 'missing:', missing.join(','));
  const saved = await finishLoop(pid, cookie, 2);
  await artAll(pid, cookie, saved);
  const pub = await call(`/api/projects/${pid}/publish`, { method: 'POST' }, cookie);
  console.log('  republished', pub.book.id);
}
console.log('done');
