import type { UserRole } from './api';

// Single source of truth for which surfaces each role may open. The server
// enforces the same rules; this only drives navigation and route guards.
export type Surface = 'library' | 'classes' | 'studio' | 'admin';

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
