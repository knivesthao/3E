import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from './types';
import { hashToken, isValidEmail, newToken } from './auth';
import { requireRole } from './roles';
import type { Role } from './roles';
import { isRecord } from './validate';

// Admin-issued role invites: the only path to teacher/creator accounts.
// Plaintext codes are returned once and never stored; only sha256 hashes
// persist. Redemption is single-use through invite_redemptions.
export const INVITE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITABLE_ROLES = ['teacher', 'creator'] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

function isInvitableRole(value: unknown): value is InvitableRole {
  return value === 'teacher' || value === 'creator';
}

interface InviteRow {
  id: string;
  code_hash: string;
  email: string | null;
  role: string;
  expires_at: number;
  used_at: string | null;
}

// Validate an invite and consume it exactly once. Creates a new invited-role
// user or upgrades an existing student; admins are never downgraded and
// other role mismatches fail closed. Returns the effective role.
export async function redeemInviteForSignup(
  db: D1Database,
  code: string,
  email: string,
  now: number,
): Promise<{ ok: true; role: Role } | { ok: false }> {
  if (typeof code !== 'string' || code === '') return { ok: false };
  const invite = await db
    .prepare('SELECT id, code_hash, email, role, expires_at, used_at FROM invites WHERE code_hash = ?')
    .bind(await hashToken(code))
    .first<InviteRow>();
  if (!invite || invite.used_at !== null || invite.expires_at < now) return { ok: false };
  if (!isInvitableRole(invite.role)) return { ok: false };
  if (invite.email !== null && invite.email !== email) return { ok: false };

  const existing = await db
    .prepare('SELECT id, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; role: string }>();
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    try {
      await db
        .prepare('INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, email, '', invite.role, new Date(now).toISOString())
        .run();
    } catch {
      return { ok: false };
    }
  } else if (
    !existing ||
    (existing.role !== 'admin' && existing.role !== invite.role && existing.role !== 'student')
  ) {
    return { ok: false };
  }

  // Single-use: concurrent redemptions collide on this primary key.
  try {
    await db
      .prepare('INSERT INTO invite_redemptions (code_hash, user_id, used_at) VALUES (?, ?, ?)')
      .bind(invite.code_hash, userId, new Date(now).toISOString())
      .run();
  } catch {
    return { ok: false };
  }

  if (existing && existing.role === 'student') {
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(invite.role, userId).run();
  }
  await db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').bind(new Date(now).toISOString(), invite.id).run();
  return { ok: true, role: existing?.role === 'admin' ? 'admin' : invite.role };
}

export const invites = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Admin-only issuance. The code is shown once; re-issue if it is lost.
invites.post('/', async (c) => {
  const denied = requireRole(c, ['admin']);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body) || !isInvitableRole(body.role)) return c.json({ error: 'invalid request' }, 400);
  const email =
    body.email === undefined || body.email === null
      ? null
      : typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';
  if (email !== null && (email === '' || !isValidEmail(email))) return c.json({ error: 'invalid request' }, 400);
  const ttlHours =
    typeof body.ttlHours === 'number' && Number.isFinite(body.ttlHours) ? body.ttlHours : 168;
  if (ttlHours < 1 || ttlHours > 720) return c.json({ error: 'invalid request' }, 400);

  const now = Date.now();
  const code = newToken();
  const id = crypto.randomUUID();
  const expiresAt = now + Math.floor(ttlHours * 3600 * 1000);
  await c.env.DB.prepare(
    'INSERT INTO invites (id, code_hash, email, role, created_by, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
  )
    .bind(id, await hashToken(code), email, body.role, c.get('userId'), expiresAt, new Date(now).toISOString())
    .run();
  return c.json(
    {
      code,
      invite: { id, email, role: body.role, expires_at: new Date(expiresAt).toISOString() },
    },
    201,
  );
});
