import { Page } from '../components/ui';

// Plain-language terms for a children's learning app. BEFORE LAUNCH: have a
// human review these and replace contact@example.com with a real inbox.
export default function Terms() {
  return (
    <Page title="Terms of use">
      <p className="text-sm text-stone-600">Short version: 3E is a practice tool for young English learners. Be kind, keep it kid-safe, and your books stay yours.</p>
      <section aria-label="What 3E is" className="mt-3">
        <h2 className="font-display text-xl font-bold">What 3E is</h2>
        <p>A reading-practice app: leveled webcomics, tap-to-define words, listen/read-aloud modes, and practice tests. The practice exam is for self-study only — it is not a certificate and no testing body endorses it.</p>
      </section>
      <section aria-label="Your books" className="mt-3">
        <h2 className="font-display text-xl font-bold">Your books</h2>
        <p>Comics you create are yours. Publishing makes a book readable to anyone with its link. Keep published books appropriate for young readers; we may remove anything unsafe.</p>
      </section>
      <section aria-label="Acceptable use" className="mt-3">
        <h2 className="font-display text-xl font-bold">Acceptable use</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>One account per person; don't share sign-in links.</li>
          <li>Don't try to break, overload, or probe the service (the daily AI cap exists so classrooms share fairly).</li>
          <li>Supervise young children, as with any reading app.</li>
        </ul>
      </section>
      <section aria-label="AI content" className="mt-3">
        <h2 className="font-display text-xl font-bold">AI content</h2>
        <p>Stories, definitions, and art are machine-generated and can be wrong. Dictionary glosses are verified against our level lists, but always trust a teacher over the app.</p>
      </section>
      <section aria-label="Availability" className="mt-3">
        <h2 className="font-display text-xl font-bold">Availability</h2>
        <p>Provided as-is while we build it. Accounts, drafts, and progress may change during the beta. Contact: contact@example.com.</p>
      </section>
    </Page>
  );
}
