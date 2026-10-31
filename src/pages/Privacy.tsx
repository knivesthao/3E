import { Page } from '../components/ui';

// Plain-language privacy for a children's reading app. Claims below match
// the implementation: magic-link email, progress stored in our database,
// voice 100% on-device, AI text/art via metered providers. BEFORE LAUNCH:
// replace contact@example.com with a real monitored inbox.
export default function Privacy() {
  return (
    <Page title="Privacy policy">
      <p className="text-sm text-stone-600">Last updated: the day we launch. Short version: we collect as little as possible, never sell anything, and your child's voice never leaves your device.</p>
      <section aria-label="What we collect" className="mt-3">
        <h2 className="font-display text-xl font-bold">What we collect</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><strong>Account email</strong> — to sign you in with a magic link. Nothing else is required to read.</li>
          <li><strong>Books you create</strong> — titles, scenes, and characters you write in the Studio.</li>
          <li><strong>Learning progress</strong> — pages read, words looked up from our dictionary, practice-test attempts and scores, reading streaks.</li>
          <li><strong>Technical metering</strong> — counts of AI calls per account so one classroom can't spend the whole budget. No keystrokes, no browsing history.</li>
        </ul>
      </section>
      <section aria-label="Voice" className="mt-3">
        <h2 className="font-display text-xl font-bold">Voice stays on your device</h2>
        <p>Listen mode and read-aloud practice run entirely in the browser using your device's own speech tools. Audio is never uploaded to our servers, never sent to AI providers, and never stored.</p>
      </section>
      <section aria-label="AI providers" className="mt-3">
        <h2 className="font-display text-xl font-bold">AI helpers</h2>
        <p>Story text, word meanings, and illustrations are generated with metered AI providers (currently Meta's Model API, with select tasks on Baseten). They receive the text being generated — never your email, voice, or reading history.</p>
      </section>
      <section aria-label="What we never do" className="mt-3">
        <h2 className="font-display text-xl font-bold">What we never do</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>No ads, no trackers, no data sale — ever.</li>
          <li>No public profiles, comments, or messaging between users.</li>
          <li>No voice cloning and no voice storage.</li>
        </ul>
      </section>
      <section aria-label="Parents" className="mt-3">
        <h2 className="font-display text-xl font-bold">Parents and guardians</h2>
        <p>Review your learner's progress in Admin → Guardian. To export or delete everything tied to an email address, write to contact@example.com and we will do it.</p>
      </section>
    </Page>
  );
}
