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
import { projects } from './projects';
import { admin } from './admin';
import { exam } from './exam';
import { ai } from './ai/routes';
import { share } from './share';
import { costs } from './costs';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

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
    'SELECT users.id, users.email, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id_hash = ?',
  )
    .bind(await hashToken(raw))
    .first<{ id: string; email: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', row.id);
  c.set('userEmail', row.email);
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

  const now = Date.now();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, '', 'creator', ?)",
    )
      .bind(userId, email, new Date(now).toISOString())
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
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect('/');
});

app.get('/api/auth/me', (c) => c.json({ user: { id: c.get('userId'), email: c.get('userEmail') } }));

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
  const { results: atEnd } = await db
    .prepare(
      `SELECT b.id, b.title, b.cover_url, b.manifest_json, r.scene_number FROM books b
       JOIN reading_sync r ON r.book_id = b.id WHERE r.updated_by = ?`,
    )
    .bind(uid)
    .all<{ id: string; title: string; cover_url: string | null; manifest_json: string; scene_number: number }>();
  const finished = [];
  for (const f of atEnd ?? []) {
    try {
      const m = JSON.parse(f.manifest_json) as { scenes?: unknown[] };
      if (Array.isArray(m.scenes) && f.scene_number >= m.scenes.length) {
        finished.push({ id: f.id, title: f.title, cover_url: f.cover_url });
      }
    } catch {
      // Corrupt manifest: not shelf-worthy.
    }
  }
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
app.route('/api/admin', admin);
app.route('/api/exam', exam);
app.route('/api/ai', ai);
app.route('/api/share', share);
app.route('/api/admin/costs', costs);

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default app;
