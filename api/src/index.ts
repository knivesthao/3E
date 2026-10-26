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
import { projects } from './projects';
import { ai } from './ai/routes';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Session gate: everything under /api/* requires a valid session except
// the health probe and the two magic-link endpoints.
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path === '/api/health' || path === '/api/auth/request-link' || path === '/api/auth/verify') {
    return next();
  }
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

  // Dev only: no email sender yet, so hand the link back to the requester.
  // Never logged (tokens stay out of logs). Disabled via DEV_LINKS=false.
  const res: { ok: true; devLink?: string } = { ok: true };
  if (c.env.DEV_LINKS === 'true') {
    res.devLink = `${new URL(c.req.url).origin}/api/auth/verify?token=${token}`;
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
app.route('/api/ai', ai);

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default app;
