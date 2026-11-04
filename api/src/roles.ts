import type { Context } from 'hono';
import type { Bindings, Variables } from './types';

// Canonical role model. Public signup creates students; teachers and
// creators arrive only through admin-issued invites. Admin is bootstrapped
// manually; there is no self-promotion endpoint.
export const ROLES = ['student', 'teacher', 'creator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

type RoleContext = Pick<Context<{ Bindings: Bindings; Variables: Variables }>, 'get' | 'json'>;

// Route guard helper. Unknown or missing roles fail closed as forbidden.
export function requireRole(c: RoleContext, allowed: readonly Role[]) {
  const role = c.get('userRole');
  if (isRole(role) && allowed.includes(role)) return null;
  return c.json({ error: 'forbidden' }, 403);
}
