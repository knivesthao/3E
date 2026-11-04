import { FLASH_FALLBACKS } from './flash-fallbacks';

// Decorative fallback art for word cards that have no dedicated image.
// Stable per word (same word, same background every visit), spread across
// all 100 by hashing — no network, no storage, no credits.
export function flashFallback(word: string): string {
  let h = 5381;
  for (let i = 0; i < word.length; i++) h = ((h << 5) + h + word.charCodeAt(i)) | 0;
  const fallbacks = FLASH_FALLBACKS.length > 0 ? FLASH_FALLBACKS : [''];
  return fallbacks[Math.abs(h) % fallbacks.length] as string;
}
