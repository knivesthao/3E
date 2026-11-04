import { LEVELS } from './api';
import type { CatalogBook, EnrolledClass, EnrolledClassBook, FocusTag } from './api';

// One options object: which slice of the catalog to show.
export interface CatalogFilter {
  query: string;
  level: 'all' | string;
  tag: 'all' | FocusTag;
}

// Client-side slice of the fetched catalog: title search (case-insensitive),
// CEFR level, and focus tag. Tolerates books published before tags existed.
export function filterCatalog(books: CatalogBook[], filter: CatalogFilter): CatalogBook[] {
  const q = filter.query.trim().toLowerCase();
  return books.filter((b) => {
    if (filter.level !== 'all' && b.level !== filter.level) return false;
    if (filter.tag !== 'all' && !(b.tags ?? []).includes(filter.tag)) return false;
    if (q !== '' && !b.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Levels actually on the shelf, in CEFR order — no dead filter buttons.
export function levelsInCatalog(books: CatalogBook[]): string[] {
  const seen = new Set(books.map((b) => b.level));
  return LEVELS.filter((l) => seen.has(l));
}

// Assigned books across enrolled classes, deduplicated by book with the
// class names that assigned it. Curriculum order is preserved per class.
export interface AssignedBook extends EnrolledClassBook {
  classes: string[];
}

export function assignedBooks(classes: EnrolledClass[]): AssignedBook[] {
  const byId = new Map<string, AssignedBook>();
  for (const cls of classes) {
    for (const book of [...cls.books].sort((a, b) => a.position - b.position)) {
      const existing = byId.get(book.book_id);
      if (existing) {
        if (!existing.classes.includes(cls.name)) existing.classes.push(cls.name);
      } else {
        byId.set(book.book_id, { ...book, classes: [cls.name] });
      }
    }
  }
  return [...byId.values()];
}
