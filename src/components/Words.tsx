import { cleanWord } from '../lib/speech';
import { isContentWord } from '../lib/words';

// Word-by-word display with tap-to-look-up and read/listen trails.
// Shared by the Reader (page text) and Flashcards (sounded parts).
// `spoken`/`current` light the listen trail; `heardCount` lights words
// the learner already read in order.
const CHUNK_COLORS = ['#0F766E', '#C2410C', '#1D4ED8', '#B91C1C', '#0E7490'];
export function Words({
  text,
  onTap,
  tapped,
  base = 0,
  heardCount = 0,
  spoken,
  current = null,
  plain = false,
  colorful = false,
  colorOffset = 0,
}: {
  text: string;
  onTap: (word: string) => void;
  tapped: string | null;
  // Position of this segment's first word in page order; words before
  // base + heardCount were read (in order) and highlight.
  base?: number;
  heardCount?: number;
  // Listen mode trail: spoken display indices glow yellow, the word being
  // spoken right now glows brighter.
  spoken?: Set<number>;
  current?: number | null;
  // Plain display (flashcards): no tap underline, keeps read/listen glow.
  plain?: boolean;
  // Colorful display (flashcards only): each sounded chunk gets a dark,
  // high-contrast hue cycling from colorOffset, so syllables read as
  // separate color blocks. Reader pages stay black-on-white.
  colorful?: boolean;
  colorOffset?: number;
}) {
  const clean = cleanWord;
  // Ordinal of the next real word in this segment. Punctuation-only
  // tokens consume no index, matching the order array (empties filtered).
  let at = 0;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        if (/^\s+$/.test(part) || part === '') return <span key={i}>{part}</span>;
        const w = clean(part);
        if (w === '') return <span key={i}>{part}</span>;
        const idx = base + at++;
        const isCur = current !== null && idx === current;
        const isRead = idx < heardCount || spoken?.has(idx);
        const hl = isCur ? ' bg-amber-400' : isRead ? ' bg-yellow-300' : '';
        // Only content words invite a lookup; glue words render plainly
        // (but still highlight when read). Plain mode renders everything as
        // text with the same highlights.
        if (plain || !isContentWord(w)) {
          const style =
            colorful && plain
              ? { color: CHUNK_COLORS[(colorOffset + idx) % CHUNK_COLORS.length] }
              : undefined;
          return (
            <span key={i} className={`rounded-sm px-1 py-0.5${hl}`} style={style}>
              {part}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => void onTap(part)}
            aria-label={`Look up ${w}`}
            aria-current={isCur || undefined}
            className={`min-h-0 cursor-pointer rounded-sm px-1 py-0.5 text-left underline-offset-4 ${
              w === tapped ? 'underline decoration-2' : 'underline decoration-dotted decoration-stone-500'
            }${hl}`}
          >
            {part}
          </button>
        );
      })}
    </>
  );
}
