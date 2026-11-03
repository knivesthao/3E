import { describe, expect, it } from 'vitest';
import { BELT_LABEL, BELT_STYLE, beltFor } from './belts';

describe('beltFor', () => {
  it('is none before the first attempt', () => {
    expect(beltFor(null, 8, 12)).toBe('none');
    expect(beltFor(null, 8, 0)).toBe('none');
  });

  it('grades white below pass, yellow at pass, black at perfect', () => {
    expect(beltFor(5, 8, 12)).toBe('white');
    expect(beltFor(8, 8, 12)).toBe('yellow');
    expect(beltFor(11, 8, 12)).toBe('yellow');
    expect(beltFor(12, 8, 12)).toBe('black');
  });

  it('labels and styles every earned belt', () => {
    for (const belt of ['white', 'yellow', 'black'] as const) {
      expect(BELT_LABEL[belt].length).toBeGreaterThan(0);
      expect(BELT_STYLE[belt].length).toBeGreaterThan(0);
    }
  });
});
