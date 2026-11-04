// Recorded product walkthrough: drives the app with Playwright while a raw
// CDP screencast client captures frames; frames are encoded to webm with the
// cached Playwright ffmpeg build. Run: node qa/walkthrough.mjs
// Requires: system Chrome on :9333 (see DEMO-CDPCMD below).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CDP = 'http://127.0.0.1:9333';
const FRAMES = '/tmp/demo-frames/';
mkdirSync(FRAMES, { recursive: true });

// ---- screencast session (raw CDP) ----
const targets = await (await fetch(`${CDP}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.startsWith(BASE));
if (!target) throw new Error('no app page target; navigate Chrome to the app first');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Page.screencastFrame') {
    frameCount += 1;
    writeFileSync(`${FRAMES}f-${String(frameCount).padStart(5, '0')}.jpg`, Buffer.from(msg.params.data, 'base64'));
    // Throttle capture by delaying the ack: the browser waits for it.
    setTimeout(() => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Page.screencastFrameAck', params: { sessionId: msg.params.sessionId } }));
    }, 330);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
let frameCount = 0;
await send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });

// ---- driver (Playwright over the same Chrome) ----
const browser = await chromium.connectOverCDP(CDP);
const page =
  browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(BASE)) ??
  (await browser.contexts()[0].newPage());
await page.setViewportSize({ width: 1280, height: 800 });

const pause = (ms = 900) => page.waitForTimeout(ms);

// The app's buttons never settle for Playwright's stability check, so scroll
// then dispatch the click directly (React handlers still fire on bubble).
async function tap(locator) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await pause(400);
  await el.dispatchEvent('click');
}

async function signInAs(email) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel('Email').fill(email);
  await tap(page.getByRole('button', { name: 'Send magic link' }));
  await tap(page.getByRole('link', { name: 'Sign in (dev link)' }));
  // The dev link points at the API origin; the session cookie is shared
  // across localhost ports, so return to the frontend explicitly.
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/`);
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await pause();
}

async function signOut() {
  await tap(page.getByRole('button', { name: /Account:/ }));
  await tap(page.getByRole('menuitem', { name: 'Sign out' }));
  await page.waitForURL('**/signin', { timeout: 15000 });
}

// Scene 1: student library, empty classes, search + save
await signInAs('demo-student@example.com');
await tap(page.getByRole('tab', { name: 'Books' }));
await page.getByPlaceholder('Type part of a title').fill('cat');
await pause(1200);
await tap(page.getByRole('button', { name: 'Save' }));
await page.waitForTimeout(1500);
await tap(page.getByRole('tab', { name: 'Shelf' }));
await pause(1200);

// Scene 2: student reads a book
await tap(page.getByRole('tab', { name: 'Books' }));
await page.getByPlaceholder('Type part of a title').fill('cat');
await tap(page.getByRole('link', { name: 'Read' }).first());
await tap(page.getByRole('button', { name: 'Next' }));
await page.getByText('The cat is red', { exact: false }).first().waitFor({ timeout: 15000 });
await pause(1500);
await signOut();

// Scene 3: teacher creates a class and enrolls the student
await signInAs('demo-teacher@example.com');
await tap(page.getByRole('link', { name: 'Classes' }));
await page.getByLabel('New class name').fill('Grade 2');
await page.getByLabel('Level').selectOption('A1');
await tap(page.getByRole('button', { name: 'Create class' }));
await page.getByText('Grade 2', { exact: true }).first().waitFor({ timeout: 15000 });
await pause(1200);
await page.getByLabel('Student email').fill('demo-student@example.com');
await tap(page.getByRole('button', { name: 'Add student' }));
await page.getByText('demo-student@example.com').waitFor({ timeout: 15000 });
await pause(1200);
await signOut();

// Scene 4: student sees the assigned class and curriculum
await signInAs('demo-student@example.com');
await page.getByText('Grade 2', { exact: true }).first().waitFor({ timeout: 15000 });
await pause(1200);
await tap(page.getByRole('tab', { name: 'Shelf' }));
await page.getByText('from Grade 2').first().waitFor({ timeout: 15000 });
await pause(1200);
await signOut();

// Scene 5: creator studio
await signInAs('demo-creator@example.com');
await tap(page.getByRole('link', { name: 'Studio' }));
await page.getByLabel('Comic title').fill('Demo Comic');
await tap(page.getByRole('button', { name: 'New comic' }));
await page.getByText('Demo Comic').first().waitFor({ timeout: 15000 });
await pause(1200);
await signOut();

// Scene 6: admin overview
await signInAs('demo-admin@example.com');
await tap(page.getByRole('button', { name: /Account:/ }));
await tap(page.getByRole('menuitem', { name: 'Admin' }));
await page.waitForURL('**/admin', { timeout: 15000 });
await pause(1500);

await send('Page.stopScreencast');
ws.close();
await browser.close();
console.log(JSON.stringify({ frames: frameCount }));
