import { useState } from 'react';
import { Button } from '../components/ui';
import { PrivacyBody } from './Privacy';
import { TermsBody } from './Terms';

// About 3E with tabbed Privacy and Terms at the top: mission and the
// child-safeguarding commitment first, legal detail one tap away, no
// footer needed. BEFORE LAUNCH: replace contact@example.com with a real
// inbox, and have a human review every claim on this page.
export default function About() {
  const [tab, setTab] = useState<'about' | 'privacy' | 'terms'>('about');
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-4 sm:px-6 sm:pb-6">
      <h1 className="sr-only">About 3E</h1>
      <div role="tablist" aria-label="About sections" className="sticky top-[69px] z-30 -mx-4 mb-3 flex gap-2 bg-white px-4 py-2 sm:-mx-6 sm:px-6">
        {(['about', 'privacy', 'terms'] as const).map((t) => (
          <Button
            key={t}
            onClick={() => setTab(t)}
            variant={tab === t ? 'primary' : undefined}
            aria-selected={tab === t}
            role="tab"
          >
            {t === 'about' ? 'About' : t === 'privacy' ? 'Privacy' : 'Terms'}
          </Button>
        ))}
      </div>
      {tab === 'about' && (
      <div role="tabpanel">
      <p className="text-sm text-stone-600">Leveled webcomics for English learners, from one scene idea to a whole book — in minutes, for about six cents a book.</p>
      <section aria-label="What 3E does" className="mt-3">
        <h2 className="font-display text-xl font-bold">What 3E does</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><strong>Create.</strong> Start a comic in the Studio, pick A1–B2, write one scene — 3E Finish writes the rest, checked word by word against the level.</li>
          <li><strong>Read.</strong> One page at a time on any phone. Pip the buddy reads aloud with word highlighting; tap any hard word for its meaning.</li>
          <li><strong>Practice.</strong> Flashcards for letter sounds, the alphabet, and digraphs, plus belt exams.</li>
        </ul>
      </section>
      <section aria-label="Mobile first" className="mt-3">
        <h2 className="font-display text-xl font-bold">Mobile first</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><strong>Install it like an app.</strong> On Android: browser menu → Add to Home Screen. On iPhone: Share → Add to Home Screen. It opens full-screen with its own icon — no app store needed.</li>
          <li><strong>Reads offline.</strong> Books you open are cached on the phone, so a lesson survives bad wifi and airplane mode.</li>
          <li><strong>Built for phones, usable on desktop.</strong> Every page — reader, flashcards, exams — is designed thumb-first for small screens.</li>
          <li><strong>Store builds next.</strong> Play Store and App Store packages (same app, wrapped with Capacitor) ship as soon as funding lands — no rewrite required.</li>
        </ul>
      </section>
      <section aria-label="Child safeguarding" className="mt-3">
        <h2 className="font-display text-xl font-bold">Keeping young readers safe</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><strong>No strangers.</strong> There is no chat, no comments, and no way for learners to contact each other — or anyone — inside 3E.</li>
          <li><strong>Voice never leaves the device.</strong> Listen mode and read-aloud practice run entirely in the browser. We never receive, store, or send your child's voice anywhere.</li>
          <li><strong>Minimal accounts.</strong> Sign-in needs only an email address (magic link, no passwords to steal). No profiles, photos, or real names.</li>
          <li><strong>Teacher visibility.</strong> A teacher reviews each student's progress — pages read, words practiced, test scores — in Classes, and can ask us to export or delete everything tied to an email address: contact@example.com.</li>
          <li><strong>No ads, no selling data.</strong> Nothing is sold, shared with advertisers, or used to profile children. AI providers receive only the text being generated.</li>
        </ul>
      </section>
      </div>
      )}
      {tab === 'privacy' && (
      <div role="tabpanel">
        <PrivacyBody />
      </div>
      )}
      {tab === 'terms' && (
      <div role="tabpanel">
        <TermsBody />
      </div>
      )}
    </main>
  );
}
