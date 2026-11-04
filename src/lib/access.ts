import type { UserRole } from './api';

// Single source of truth for which surfaces each role may open. The server
// enforces the same rules; this only drives navigation and route guards.
export type Surface = 'library' | 'classes' | 'studio' | 'admin';

// Admin "view as" lens: preview the app through another role's surfaces
// without changing the session. Only an admin's own preview applies —
// anything else (including a tampered value) resolves to the real role.
// The server still enforces the real role on every API call, so the lens
// can only ever reveal UI shells, never other roles' data.
export function effectiveRole(real: UserRole | null, preview: UserRole | null): UserRole | null {
  if (real === 'admin' && (preview === 'student' || preview === 'teacher' || preview === 'creator')) {
    return preview;
  }
  return real;
}

export function canAccess(surface: Surface, role: UserRole | null): boolean {
  if (role === null) return false;
  switch (surface) {
    case 'library':
      return true;
    case 'classes':
      return role === 'teacher' || role === 'admin';
    case 'studio':
      return role === 'creator' || role === 'admin';
    case 'admin':
      return role === 'admin';
  }
}
