import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './ui';

// One flush shell for covers, pages, and flashcards: a fill media frame,
// overlay slot (buddy, bubble), and a bottom nav. Cover and pages share
// the same frame so the art cannot shift between turns — no gutters,
// no aspect letterboxing, the image fills whatever the nav leaves.
export function PageShell({
  label,
  backHref,
  backLabel,
  media,
  mediaClassName = 'relative min-h-0 w-full flex-1 overflow-hidden bg-stone-200',
  overlay,
  nav,
  sectionRef,
}: {
  label: string;
  backHref?: string;
  backLabel?: string;
  media: ReactNode;
  // Frame around the media. Fills the shell; art uses object-cover so
  // every page shares the exact same box.
  mediaClassName?: string;
  overlay?: ReactNode;
  nav: ReactNode;
  sectionRef?: Ref<HTMLElement>;
}) {
  return (
    <section ref={sectionRef} aria-label={label} className="flex h-[calc(100dvh-69px)] flex-col overflow-hidden">
      {backHref && (
        <p className="px-3 pt-2">
          <Link to={backHref} className="underline underline-offset-4">‹ {backLabel ?? 'Back'}</Link>
        </p>
      )}
      <div className="relative flex min-h-0 w-full flex-1 flex-col">
        <div className={mediaClassName}>
          <div className="h-full w-full">{media}</div>
        </div>
        {overlay}
      </div>
      {nav}
    </section>
  );
}

// Bottom bar shared by covers, pages, and flashcards: flush under the art,
// no extra vertical padding so the frame above never moves.
export function PageNav({
  label,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  status,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  status?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex w-full items-center justify-between gap-2 border-t border-stone-200 bg-white px-3 py-1.5"
    >
      <Button onClick={onPrev} disabled={prevDisabled} aria-label="Previous">
        ← Prev
      </Button>
      {status && (
        <p className="text-sm font-medium text-stone-700" aria-live="polite">
          {status}
        </p>
      )}
      <Button onClick={onNext} disabled={nextDisabled} variant="primary" aria-label="Next">
        Next →
      </Button>
    </nav>
  );
}
