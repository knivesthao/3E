import { describe, expect, it } from 'vitest';
import { canAccess, effectiveRole } from './access';
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

describe('effectiveRole', () => {
  it('applies an admin preview lens without touching the session role', () => {
    expect(effectiveRole('admin', 'student')).toBe('student');
    expect(effectiveRole('admin', 'teacher')).toBe('teacher');
    expect(effectiveRole('admin', 'creator')).toBe('creator');
    expect(effectiveRole('admin', null)).toBe('admin');
  });

  it('ignores preview requests from non-admins and signed-out users', () => {
    expect(effectiveRole('student', 'teacher')).toBe('student');
    expect(effectiveRole('creator', 'student')).toBe('creator');
    expect(effectiveRole(null, 'student')).toBe(null);
  });

  it('drives the same surface rules as a real role', () => {
    expect(canAccess('studio', effectiveRole('admin', 'student'))).toBe(false);
    expect(canAccess('studio', effectiveRole('admin', 'creator'))).toBe(true);
    expect(canAccess('classes', effectiveRole('admin', 'teacher'))).toBe(true);
    expect(canAccess('admin', effectiveRole('admin', 'teacher'))).toBe(false);
  });
});
