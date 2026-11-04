import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Bindings, Variables } from './types';
import {
  MAGIC_LINK_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashToken,
  isValidEmail,
  newToken,
} from './auth';
import { sendMagicLink } from './email';
import { isRole } from './roles';
import { invites, redeemInviteForSignup } from './invites';
import { classes } from './classes';
import { student } from './student';
import { projects } from './projects';
import { admin } from './admin';
import { exam } from './exam';
import { misses } from './misses';
import { progress } from './progress';
import { finishedBooks } from './shelf';
import { ai } from './ai/routes';
import { share } from './share';
import { costs } from './costs';
import { A1, A2, B1, B2, C1, C2, FOCUS_TAGS } from './levels';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Native-shell origins (Capacitor WebViews). Same-origin web traffic sends
// no Origin header and never touches this path.
const NATIVE_ORIGINS = ['capacitor://localhost', 'http://localhost'];
const isNative = (c: { req: { header(n: string): string | undefined } }) =>
  NATIVE_ORIGINS.includes(c.req.header('Origin') ?? '');

// Native-shell CORS: the deployed API answers the bundled app cross-origin
// (cookies included). Preflights end here; everything else falls through to
// the session gate below unchanged.
app.use('/api/*', async (c, next) => {
  if (isNative(c)) {
    const origin = c.req.header('Origin') as string;
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Credentials', 'true');
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      return c.text('', 200);
    }
  }
  await next();
});

// Session gate: everything under /api/* requires a valid session except
// the health probe and the two magic-link endpoints.
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path === '/api/health' || path === '/api/auth/request-link' || path === '/api/auth/verify') {
    return next();
  }
  // Step 5a public share: anyone with the link can read a published book.
  if (path.startsWith('/api/share/')) return next();
  // Panel images must load for anonymous share readers (generation stays gated).
  if (c.req.method === 'GET' && path.startsWith('/api/ai/art/')) return next();
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    'SELECT users.id, users.email, users.role, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id_hash = ?',
  )
    .bind(await hashToken(raw))
    .first<{ id: string; email: string; role: unknown; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', row.id);
  c.set('userEmail', row.email);
  // Fail closed: only a known role is trusted; legacy/unknown values read as student.
  c.set('userRole', isRole(row.role) ? row.role : 'student');
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/request-link', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  const email =
    typeof (body as { email?: unknown } | null)?.email === 'string'
      ? (body as { email: string }).email.trim().toLowerCase()
      : '';
  if (!isValidEmail(email)) return c.json({ error: 'invalid request' }, 400);
  const inviteCode =
    typeof (body as { inviteCode?: unknown } | null)?.inviteCode === 'string'
      ? (body as { inviteCode: string }).inviteCode
      : '';
  if (inviteCode !== '') {
    // Invited signup consumes the code before any session is minted. All
    // invite failures share one generic error so codes cannot be probed.
    const redeemed = await redeemInviteForSignup(c.env.DB, inviteCode, email, Date.now());
    if (!redeemed.ok) return c.json({ error: 'invalid request' }, 400);
  }

  const now = Date.now();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(userId, email, '', 'student', new Date(now).toISOString())
      .run();
  }
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?')
    .bind(userId, now)
    .run();
  const token = newToken();
  await c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await hashToken(token), userId, now + MAGIC_LINK_TTL_MS)
    .run();

  // Dev: hand the link back so sign-in works without an email sender.
  // Prod (DEV_LINKS=false): email it via Resend and never return the token.
  // Either way the token is never logged.
  const link = `${new URL(c.req.url).origin}/api/auth/verify?token=${token}`;
  const res: { ok: true; devLink?: string; emailed?: boolean } = { ok: true };
  if (c.env.DEV_LINKS === 'true') {
    res.devLink = link;
  } else {
    res.emailed = await sendMagicLink(c.env, email, link);
  }
  return c.json(res);
});

app.get('/api/auth/verify', async (c) => {
  const token = c.req.query('token') ?? '';
  if (!token) return c.json({ error: 'invalid request' }, 400);
  const tokenHash = await hashToken(token);
  const row = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: 'invalid request' }, 401);

  // Single-use: burn the magic link, then mint the real session.
  await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(tokenHash).run();
  const session = newToken();
  await c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await hashToken(session), row.user_id, Date.now() + SESSION_TTL_MS)
    .run();
  // Native shells fetch cross-origin, where Lax cookies are never sent.
  // Only for those origins: SameSite=None (Secure required, and the
  // deployed API is always HTTPS). Web logins keep Lax exactly as before.
  const native = isNative(c);
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: native ? true : new URL(c.req.url).protocol === 'https:',
    sameSite: native ? 'None' : 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect('/');
});

app.get('/api/auth/me', (c) =>
  c.json({ user: { id: c.get('userId'), email: c.get('userEmail'), role: c.get('userRole') } }),
);

// Word lists for level flashcard decks. Same arrays the level gate
// enforces, served as data so the client never imports server code
// (Vite would route that import through the /api proxy and 404).
app.get('/api/levels', (c) =>
  c.json({ A1, A2, B1, B2, C1, C2, focusTags: [...FOCUS_TAGS] }, 200, {
    'Cache-Control': 'public, max-age=86400',
  }),
);

// Self activity (shelf + streaks): distinct active days from exam attempts
// plus page turns the user made, and books whose shared position the user
// left on the final page. Derived from existing tables — zero extra writes.
// Streak counts back from today, so reading today already extends it.
app.get('/api/me/activity', async (c) => {
  const uid = c.get('userId');
  const db = c.env.DB;
  const [examRows, readRows] = await Promise.all([
    db
      .prepare('SELECT DISTINCT substr(created_at, 1, 10) AS day FROM exam_attempts WHERE user_id = ?')
      .bind(uid)
      .all<{ day: string }>(),
    db
      .prepare('SELECT DISTINCT substr(updated_at, 1, 10) AS day FROM reading_sync WHERE updated_by = ?')
      .bind(uid)
      .all<{ day: string }>(),
  ]);
  const daySet = new Set(
    [...(examRows.results ?? []), ...(readRows.results ?? [])].map((r) => r.day),
  );
  const days = [...daySet].sort();
  let streak = 0;
  const cursor = new Date();
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  // Finished books via the shared shelf helper (same fetch-then-match
  // across the app/library DB boundary the summary endpoint uses).
  const { finished } = await finishedBooks(db, c.env.LIBRARY_DB, uid);
  return c.json({ days, streak, totalDays: days.length, finished });
});

app.post('/api/auth/logout', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (raw) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?')
      .bind(await hashToken(raw))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.route('/api/projects', projects);
app.route('/api/classes', classes);
app.route('/api/me', student);
app.route('/api/admin', admin);
app.route('/api/admin/invites', invites);
app.route('/api/exam', exam);
app.route('/api/misses', misses);
app.route('/api/progress', progress);
app.route('/api/ai', ai);
app.route('/api/share', share);
app.route('/api/admin/costs', costs);

// SPA fallback: deep links, bookmarks, share links, and PWA launches must
// land in the app shell. The assets layer serves exact files only; misses
// reach the worker, so the worker serves index.html itself. API routes keep
// their JSON 404s; a missing ASSETS binding degrades to the JSON 404.
app.get('*', async (c) => {
  if (!c.req.path.startsWith('/api/')) {
    try {
      const assets = c.env.ASSETS;
      if (assets) {
        const res = await assets.fetch(new URL('/index.html', c.req.url));
        if (res.ok) return c.html(await res.text());
      }
    } catch {
      // Asset fetch failed: fall through to the JSON 404 below.
    }
  }
  return c.notFound();
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default app;
