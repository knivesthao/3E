import { describe, expect, it } from 'vitest';
import { FLASH_FALLBACKS } from './flash-fallbacks';
import { flashFallback } from './fallback-art';

describe('flashcard fallback art', () => {
  it('ships 100 distinct renderable backgrounds', () => {
    expect(FLASH_FALLBACKS).toHaveLength(100);
    expect(new Set(FLASH_FALLBACKS).size).toBe(100);
    for (const uri of FLASH_FALLBACKS) {
      expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(uri.replace('data:image/svg+xml,', ''));
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 640 360"');
    }
  });

  it('picks stably per word across the full set', () => {
    expect(flashFallback('apple')).toBe(flashFallback('apple'));
    const picks = new Set(['apple', 'run', 'happy', 'garden', 'because', 'through', 'elephant', 'quietly'].map(flashFallback));
    expect(picks.size).toBeGreaterThan(1);
    for (const uri of picks) expect(FLASH_FALLBACKS).toContain(uri);
  });
});
