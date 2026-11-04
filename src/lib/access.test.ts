import { describe, expect, it } from 'vitest';
import { canAccess } from './access';
import type { UserRole } from './api';

const ROLES: UserRole[] = ['student', 'teacher', 'creator', 'admin'];

describe('canAccess', () => {
  it('opens the library to every signed-in role and nobody signed out', () => {
    for (const role of ROLES) expect(canAccess('library', role)).toBe(true);
    expect(canAccess('library', null)).toBe(false);
  });

  it('opens classes to teachers and admins only', () => {
    expect(canAccess('classes', 'teacher')).toBe(true);
    expect(canAccess('classes', 'admin')).toBe(true);
    expect(canAccess('classes', 'student')).toBe(false);
    expect(canAccess('classes', 'creator')).toBe(false);
  });

  it('opens the studio to creators and admins only', () => {
    expect(canAccess('studio', 'creator')).toBe(true);
    expect(canAccess('studio', 'admin')).toBe(true);
    expect(canAccess('studio', 'student')).toBe(false);
    expect(canAccess('studio', 'teacher')).toBe(false);
  });

  it('opens admin to admins only', () => {
    expect(canAccess('admin', 'admin')).toBe(true);
    for (const role of ['student', 'teacher', 'creator'] as const) {
      expect(canAccess('admin', role)).toBe(false);
    }
  });
});
