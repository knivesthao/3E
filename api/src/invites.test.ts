import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';
import { hashToken } from './auth';

function makeDb() {
  const users = new Map<string, { id: string; email: string; role: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const invites = new Map<string, Record<string, unknown>>();
  const redemptions = new Set<string>();
  const db = {
    users,
    invites,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM users WHERE email')) {
          const found = [...users.values()].find((user) => user.email === params[0]);
          return found ? { id: found.id } : null;
        }
        if (q.startsWith('SELECT id, role FROM users WHERE email')) {
          const found = [...users.values()].find((user) => user.email === params[0]);
          return found ? { id: found.id, role: found.role } : null;
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
        if (q.startsWith('SELECT id, code_hash, email, role, expires_at, used_at FROM invites')) {
          return [...invites.values()].find((invite) => invite.code_hash === params[0]) ?? null;
        }
        return null;
      };
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT INTO users')) {
          const [id, email, , role] = params as [string, string, string, string, string];
          if ([...users.values()].some((user) => user.email === email)) throw new Error('UNIQUE constraint failed: users.email');
          users.set(id, { id, email, role });
        } else if (q.startsWith('UPDATE users SET role')) {
          const user = users.get(params[1] as string);
          if (user) user.role = params[0] as string;
        } else if (q.startsWith('INSERT INTO sessions')) {
          const [idHash, userId, expiresAt] = params as [string, string, number];
          sessions.set(idHash, { user_id: userId, expires_at: expiresAt });
        } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
          for (const [key, value] of sessions) {
            if (value.user_id === params[0] && value.expires_at < (params[1] as number)) sessions.delete(key);
          }
        } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
          sessions.delete(params[0] as string);
        } else if (q.startsWith('INSERT INTO invites')) {
          const [id, codeHash, email, role, createdBy, expiresAt, , createdAt] = params as [
            string, string, string | null, string, string, number, unknown, string,
          ];
          invites.set(id, { id, code_hash: codeHash, email, role, created_by: createdBy, expires_at: expiresAt, used_at: null, created_at: createdAt });
        } else if (q.startsWith('UPDATE invites SET used_at')) {
          const invite = invites.get(params[1] as string);
          if (invite) invite.used_at = params[0];
        } else if (q.startsWith('INSERT INTO invite_redemptions')) {
          if (redemptions.has(params[0] as string)) throw new Error('UNIQUE constraint failed: invite_redemptions.code_hash');
          redemptions.add(params[0] as string);
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

async function signIn(db: Db, email: string, inviteCode?: string): Promise<string> {
  const env = ENV(db);
  const requested = await app.request(
    '/api/auth/request-link',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inviteCode ? { email, inviteCode } : { email }),
    },
    env,
  );
  if (requested.status !== 200) throw new Error(`request-link failed: ${requested.status}`);
  const { devLink } = (await requested.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const verified = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (verified.headers.get('set-cookie') ?? '').split(';')[0];
}

const postInvite = (db: Db, cookie: string | null, body: unknown) =>
  app.request(
    '/api/admin/invites',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    },
    ENV(db),
  );

async function seedAdmin(db: Db): Promise<string> {
  db.users.set('admin-1', { id: 'admin-1', email: 'admin@example.com', role: 'admin' });
  return signIn(db, 'admin@example.com');
}

describe('invite issuance', () => {
  it('requires an admin session and validates the invited role', async () => {
    const db = makeDb();
    expect((await postInvite(db, null, { role: 'teacher' })).status).toBe(401);

    const student = await signIn(db, 'learner@example.com');
    expect((await postInvite(db, student, { role: 'teacher' })).status).toBe(403);

    const admin = await seedAdmin(db);
    expect((await postInvite(db, admin, { role: 'admin' })).status).toBe(400);
    expect((await postInvite(db, admin, { role: 'student' })).status).toBe(400);
    expect((await postInvite(db, admin, { role: 'teacher', email: 'not-an-email' })).status).toBe(400);
    expect((await postInvite(db, admin, { role: 'teacher', ttlHours: 0 })).status).toBe(400);
  });

  it('issues a one-time code without storing the plaintext', async () => {
    const db = makeDb();
    const admin = await seedAdmin(db);
    const res = await postInvite(db, admin, { role: 'creator', email: 'Maker@Example.com', ttlHours: 48 });
    expect(res.status).toBe(201);
    const { code, invite } = (await res.json()) as {
      code: string;
      invite: { id: string; email: string; role: string };
    };
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.email).toBe('maker@example.com');
    const stored = db.invites.get(invite.id) as { code_hash: string; email: string; used_at: null };
    expect(stored.code_hash).toBe(await hashToken(code));
    expect(stored.code_hash).not.toContain(code.slice(0, 8));
    expect(stored.used_at).toBeNull();
  });
});

describe('invite redemption', () => {
  it('creates the invited teacher and burns the code', async () => {
    const db = makeDb();
    const admin = await seedAdmin(db);
    const issued = await postInvite(db, admin, { role: 'teacher', email: 'teacher@example.com' });
    const { code } = (await issued.json()) as { code: string };

    const cookie = await signIn(db, 'teacher@example.com', code);
    const me = (await (await app.request('/api/auth/me', { headers: { cookie } }, ENV(db))).json()) as {
      user: { role: string };
    };
    expect(me.user.role).toBe('teacher');

    const retry = await app.request(
      '/api/auth/request-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'teacher@example.com', inviteCode: code }),
      },
      ENV(db),
    );
    expect(retry.status).toBe(400);
  });

  it('upgrades an existing student, keeps admins, and rejects mismatches', async () => {
    const db = makeDb();
    const admin = await seedAdmin(db);
    await signIn(db, 'learner@example.com');
    const upgrade = await postInvite(db, admin, { role: 'creator', email: 'learner@example.com' });
    const upgradeCode = ((await upgrade.json()) as { code: string }).code;
    const learner = await signIn(db, 'learner@example.com', upgradeCode);
    const upgraded = (await (await app.request('/api/auth/me', { headers: { cookie: learner } }, ENV(db))).json()) as {
      user: { role: string };
    };
    expect(upgraded.user.role).toBe('creator');

    db.users.set('maker-1', { id: 'maker-1', email: 'maker@example.com', role: 'creator' });
    const mismatch = await postInvite(db, admin, { role: 'teacher', email: 'maker@example.com' });
    const mismatchCode = ((await mismatch.json()) as { code: string }).code;
    const bad = await app.request(
      '/api/auth/request-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'maker@example.com', inviteCode: mismatchCode }),
      },
      ENV(db),
    );
    expect(bad.status).toBe(400);
    expect(db.users.get('maker-1')?.role).toBe('creator');
  });

  it('rejects bound-email mismatches, bad codes, and expired invites', async () => {
    const db = makeDb();
    const admin = await seedAdmin(db);
    const bound = await postInvite(db, admin, { role: 'teacher', email: 'teacher@example.com' });
    const boundCode = ((await bound.json()) as { code: string }).code;
    const wrongEmail = await app.request(
      '/api/auth/request-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'other@example.com', inviteCode: boundCode }),
      },
      ENV(db),
    );
    expect(wrongEmail.status).toBe(400);

    const badCode = await app.request(
      '/api/auth/request-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'teacher@example.com', inviteCode: '0'.repeat(64) }),
      },
      ENV(db),
    );
    expect(badCode.status).toBe(400);

    const expiredCode = 'a'.repeat(64);
    db.invites.set('invite-expired', {
      id: 'invite-expired',
      code_hash: await hashToken(expiredCode),
      email: null,
      role: 'teacher',
      created_by: 'admin-1',
      expires_at: Date.now() - 1000,
      used_at: null,
    });
    const expired = await app.request(
      '/api/auth/request-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'late@example.com', inviteCode: expiredCode }),
      },
      ENV(db),
    );
    expect(expired.status).toBe(400);
    expect([...db.users.values()].some((user) => user.email === 'late@example.com')).toBe(false);
  });
});
