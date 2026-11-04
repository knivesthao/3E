import { describe, expect, it } from 'vitest';
import { assignedBooks, filterCatalog, levelsInCatalog, moveItem } from './catalog';
import type { CatalogBook, EnrolledClass } from './api';

const book = (title: string, level: string, tags?: CatalogBook['tags']): CatalogBook => ({
  id: title,
  title,
  level,
  cover_url: null,
  published_at: '',
  tags,
});

const SHELF = [
  book('Red Cat', 'A1', ['nouns']),
  book('The River Boat', 'A2', ['verbs']),
  book('Toolbox Tales', 'B1'),
];

describe('filterCatalog', () => {
  it('returns everything when the query is blank and filters are all', () => {
    expect(filterCatalog(SHELF, { query: '  ', level: 'all', tag: 'all' })).toHaveLength(3);
  });

  it('matches titles case-insensitively', () => {
    expect(filterCatalog(SHELF, { query: 'red', level: 'all', tag: 'all' }).map((b) => b.title)).toEqual([
      'Red Cat',
    ]);
    expect(filterCatalog(SHELF, { query: 'RIVER', level: 'all', tag: 'all' }).map((b) => b.title)).toEqual([
      'The River Boat',
    ]);
  });

  it('filters by level', () => {
    expect(filterCatalog(SHELF, { query: '', level: 'A1', tag: 'all' }).map((b) => b.title)).toEqual([
      'Red Cat',
    ]);
  });

  it('filters by focus tag and tolerates books published before tags', () => {
    expect(filterCatalog(SHELF, { query: '', level: 'all', tag: 'nouns' }).map((b) => b.title)).toEqual([
      'Red Cat',
    ]);
    expect(filterCatalog(SHELF, { query: '', level: 'all', tag: 'verbs' }).map((b) => b.title)).toEqual([
      'The River Boat',
    ]);
  });

  it('combines query, level, and tag', () => {
    expect(
      filterCatalog(SHELF, { query: 't', level: 'B1', tag: 'all' }).map((b) => b.title),
    ).toEqual(['Toolbox Tales']);
    expect(filterCatalog(SHELF, { query: 'red', level: 'A2', tag: 'all' })).toHaveLength(0);
  });
});

describe('levelsInCatalog', () => {
  it('lists only levels on the shelf, in CEFR order', () => {
    expect(levelsInCatalog([SHELF[2], SHELF[0]])).toEqual(['A1', 'B1']);
    expect(levelsInCatalog([])).toEqual([]);
  });
});

describe('assignedBooks', () => {
  const cls = (id: string, name: string, books: EnrolledClass['books']): EnrolledClass => ({
    id,
    name,
    level: 'A1',
    books,
  });
  const book = (book_id: string, position: number, title: string) => ({
    book_id,
    position,
    title,
    level: 'A1',
    cover_url: null,
  });

  it('dedupes books assigned by several classes and keeps class names', () => {
    const merged = assignedBooks([
      cls('c1', 'Grade 2', [book('b1', 1, 'One'), book('b2', 2, 'Two')]),
      cls('c2', 'Club', [book('b2', 1, 'Two'), book('b3', 2, 'Three')]),
    ]);
    expect(merged.map((b) => b.book_id)).toEqual(['b1', 'b2', 'b3']);
    expect(merged.find((b) => b.book_id === 'b2')?.classes).toEqual(['Grade 2', 'Club']);
  });

  it('returns an empty shelf when enrolled in nothing', () => {
    expect(assignedBooks([])).toEqual([]);
  });
});

describe('moveItem', () => {
  it('moves entries up and down, ignoring out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
