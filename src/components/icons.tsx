// Minimal inline voice icons (speaker, mic, stop): single-color strokes that
// inherit the button color. Hand-drawn SVGs, no icon library needed.
export function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path
        d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

// Pip, the reading buddy: one face, three feelings. Fixed warm palette so
// it reads on light and dark surfaces; the mouth carries the mood.
export function PipFace({ mood }: { mood: 'happy' | 'ok' | 'try' }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="#FDE68A" />
      <circle cx="10" cy="12" r="1.6" fill="#0c4a4a" />
      <circle cx="18" cy="12" r="1.6" fill="#0c4a4a" />
      {mood === 'happy' ? (
        <>
          <path d="M8 15.5c1.5 4 10.5 4 12 0-2 1-4 1.5-6 1.5s-4-.5-6-1.5z" fill="#0c4a4a" />
          <circle cx="7.5" cy="15" r="1.4" fill="#F59E0B" />
          <circle cx="20.5" cy="15" r="1.4" fill="#F59E0B" />
        </>
      ) : mood === 'ok' ? (
        <path d="M9 16c1.5 2.5 8.5 2.5 10 0" stroke="#0c4a4a" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.5 17c2 1.5 5 1.5 7 0" stroke="#0c4a4a" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}
