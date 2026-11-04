import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { isRole, requireRole } from './roles';

function makeDb() {
  const users = new Map<string, { id: string; email: string; role: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const db = {
    users,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM users WHERE email')) {
          const found = [...users.values()].find((user) => user.email === params[0]);
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
      return {
        bind: (...params: unknown[]) => ({ first: () => first(params), run: () => run(params) }),
        first: () => first([]),
      };
    },
  };
  return db;
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true' });

async function signIn(db: Db, email: string): Promise<string> {
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

describe('roles', () => {
  it('recognizes only the four supported roles', () => {
    expect(isRole('student')).toBe(true);
    expect(isRole('teacher')).toBe(true);
    expect(isRole('creator')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it('allows listed roles and forbids everything else', () => {
    const context = (role: unknown) =>
      ({
        get: (key: string) => (key === 'userRole' ? role : undefined),
        json: (body: unknown, status: number) => ({ body, status }),
      }) as unknown as Parameters<typeof requireRole>[0];

    expect(requireRole(context('teacher'), ['teacher', 'admin'])).toBeNull();
    expect(requireRole(context('student'), ['teacher', 'admin'])).toEqual({
      body: { error: 'forbidden' },
      status: 403,
    });
    expect(requireRole(context('owner'), ['teacher', 'admin'])).toEqual({
      body: { error: 'forbidden' },
      status: 403,
    });
  });
});

describe('role-aware signup and session', () => {
  it('makes new public signups students and reports that role', async () => {
    const db = makeDb();
    const cookie = await signIn(db, 'new-learner@example.com');
    expect(db.users.get([...db.users.keys()][0])?.role).toBe('student');

    const me = await app.request('/api/auth/me', { headers: { cookie } }, ENV(db));
    expect(await me.json()).toEqual({
      user: { id: [...db.users.keys()][0], email: 'new-learner@example.com', role: 'student' },
    });
  });

  it('preserves an existing elevated role instead of downgrading it', async () => {
    const db = makeDb();
    db.users.set('teacher-1', { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' });
    const cookie = await signIn(db, 'teacher@example.com');

    const me = await app.request('/api/auth/me', { headers: { cookie } }, ENV(db));
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe('teacher');
  });

  it('fails closed to student when a stored role is unknown', async () => {
    const db = makeDb();
    db.users.set('legacy-1', { id: 'legacy-1', email: 'legacy@example.com', role: 'owner' });
    const cookie = await signIn(db, 'legacy@example.com');

    const me = await app.request('/api/auth/me', { headers: { cookie } }, ENV(db));
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe('student');
  });
});
