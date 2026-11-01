import { Link } from 'react-router-dom';

// In-page nav between the three legal pages (About holds the safeguarding
// commitment; Privacy/Terms hold the detail). The app has no footer, so
// these pages link to each other directly.
export function LegalNav({ current }: { current: 'about' | 'privacy' | 'terms' }) {
  const link = (to: string, label: string) =>
    label.toLowerCase() === current ? (
      <span key={to} aria-current="page" className="font-semibold">{label}</span>
    ) : (
      <Link key={to} to={to} className="underline underline-offset-4">
        {label}
      </Link>
    );
  return (
    <nav aria-label="About and legal" className="mt-4 border-t border-stone-200 pt-3 text-sm">
      {link('/about', 'About')}
      {' · '}
      {link('/privacy', 'Privacy')}
      {' · '}
      {link('/terms', 'Terms')}
    </nav>
  );
}
