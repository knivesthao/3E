import type { ReactNode, Ref } from 'react';

// Shared Pip corner: buddy icon with Listen + Read buttons pinned directly
// under it. Books toggle the panels (tap Pip to show/hide); flashcards
// force them open. One component so both screens share measurements.
export function BuddyCorner({
  open,
  onToggle,
  toggleLabel,
  buttonRef,
  children,
}: {
  open: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={toggleLabel ?? 'Listen or read aloud options'}
        title="Pip"
        className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-accent-900 text-white shadow-lg"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4V5z" fill="currentColor" opacity="0.9" />
          <circle cx="9" cy="10" r="1.2" fill="#0c4a4a" />
          <circle cx="13" cy="10" r="1.2" fill="#0c4a4a" />
          <path d="M9.5 13.5c1.5 1 3.5 1 5 0" stroke="#0c4a4a" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-2 top-14 z-20 flex max-w-[calc(100%-1rem)] flex-col items-end gap-1 bg-transparent text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] [&>div]:w-fit [&>div]:max-w-full">
          {children}
        </div>
      )}
    </>
  );
}
