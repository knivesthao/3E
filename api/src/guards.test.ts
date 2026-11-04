import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// Route-gate coverage: projects are creator/admin-only, admin routes are
// admin-only, and per-book costs stay owner-scoped behind creator/admin.
function makeDb() {
  const users = new Map<string, { id: string; email: string; role: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  return {
    seedUser(id: string, email: string, role: string) {
      users.set(id, { id, email, role });
    },
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM users WHERE email')) {
          const found = [...users.values()].find((u) => u.email === params[0]);
          return found ? { id: found.id } : null;
        }
        if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
          return sessions.get(params[0] as string) ?? null;
        }
        if (q.startsWith('SELECT users.id, users.email, users.role')) {
          const session = sessions.get(params[0] as string);
          const user = session ? users.get(session.user_id) : undefined;
          return user
            ? { id: user.id, email: user.email, role: user.role, expires_at: session!.expires_at }
            : null;
        }
        return null;
      };
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT INTO users')) {
          const [id, email, , role] = params as [string, string, string, string, string];
          users.set(id, { id, email, role });
        } else if (q.startsWith('INSERT INTO sessions')) {
          const [idHash, userId, expiresAt] = params as [string, string, number];
          sessions.set(idHash, { user_id: userId, expires_at: expiresAt });
        } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
          for (const [key, value] of sessions) {
            if (value.user_id === params[0] && value.expires_at < (params[1] as number)) sessions.delete(key);
          }
        } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
          sessions.delete(params[0] as string);
        }
        return { success: true };
      };
      const all = async () => ({ results: [] });
      return {
        bind: (...params: unknown[]) => ({ first: () => first(params), run: () => run(params), all: () => all() }),
        first: () => first([]),
        all: () => all(),
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true' });

async function signIn(db: Db, email: string, role: string): Promise<string> {
  db.seedUser(`user-${role}`, email, role);
  const env = ENV(db);
  const requested = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) },
    env,
  );
  const { devLink } = (await requested.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const verified = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (verified.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('role gates', () => {
  it('denies students on studio, admin, and cost-overview routes', async () => {
    const db = makeDb();
    const student = await signIn(db, 'learner@example.com', 'student');
    const env = ENV(db);
    expect((await app.request('/api/projects', { headers: { cookie: student } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/specs', { headers: { cookie: student } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/costs/overview', { headers: { cookie: student } }, env)).status).toBe(403);
  });

  it('lets creators draft but not read admin overviews', async () => {
    const db = makeDb();
    const creator = await signIn(db, 'maker@example.com', 'creator');
    const env = ENV(db);
    expect((await app.request('/api/projects', { headers: { cookie: creator } }, env)).status).toBe(200);
    expect((await app.request('/api/admin/specs', { headers: { cookie: creator } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/costs/overview', { headers: { cookie: creator } }, env)).status).toBe(403);
  });

  it('lets admins everywhere students and creators are denied', async () => {
    const db = makeDb();
    const admin = await signIn(db, 'admin@example.com', 'admin');
    const env = ENV(db);
    expect((await app.request('/api/admin/specs', { headers: { cookie: admin } }, env)).status).toBe(200);
    expect((await app.request('/api/admin/costs/overview', { headers: { cookie: admin } }, env)).status).toBe(200);
  });
});
