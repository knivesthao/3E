import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0011_classes.sql'),
  'utf8',
);

describe('0011_classes migration', () => {
  it('creates classes owned by exactly one teacher', () => {
    expect(sql).toContain('CREATE TABLE classes');
    expect(sql).toContain('teacher_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain("level       TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2'))");
  });

  it('models many-to-many enrollment without a second teacher', () => {
    expect(sql).toContain('CREATE TABLE class_students');
    expect(sql).toContain('PRIMARY KEY (class_id, user_id)');
    expect(sql).not.toContain('substitute');
  });

  it('orders curriculum and shelves without cross-database foreign keys', () => {
    expect(sql).toContain('CREATE TABLE class_books');
    expect(sql).toContain('UNIQUE (class_id, position)');
    expect(sql).toContain('CREATE TABLE library_shelf');
    expect(sql).toContain('PRIMARY KEY (user_id, book_id)');
    expect(sql).not.toContain('REFERENCES books(');
  });
});

const levelsSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0015_project_levels.sql'),
  'utf8',
);

describe('0015_project_levels migration', () => {
  it('widens projects.level to every ProjectLevel the API validates', () => {
    expect(levelsSql).toContain(
      "CHECK (level IN ('A1','A2','B1','B2','C1','C2','HSK1','HSK2','HSK3','HSK4','HSK5','HSK6'))",
    );
  });

  it('rebuilds the table without losing columns or rows', () => {
    expect(levelsSql).toContain('CREATE TABLE projects_new');
    expect(levelsSql).toContain('tags_json   TEXT NOT NULL');
    expect(levelsSql).toContain('lang        TEXT NOT NULL');
    expect(levelsSql).toContain('INSERT INTO projects_new');
    expect(levelsSql).toContain('ALTER TABLE projects_new RENAME TO projects');
  });
});
