import { useState } from 'react';
import { Page } from '../components/ui';
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
    <Page title="About 3E">
      <div role="tablist" aria-label="About sections" className="mb-3 flex gap-2">
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
      <section aria-label="Child safeguarding" className="mt-3">
        <h2 className="font-display text-xl font-bold">Keeping young readers safe</h2>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><strong>No strangers.</strong> There is no chat, no comments, and no way for learners to contact each other — or anyone — inside 3E.</li>
          <li><strong>Voice never leaves the device.</strong> Listen mode and read-aloud practice run entirely in the browser. We never receive, store, or send your child's voice anywhere.</li>
          <li><strong>Minimal accounts.</strong> Sign-in needs only an email address (magic link, no passwords to steal). No profiles, photos, or real names.</li>
          <li><strong>Guardian visibility.</strong> A guardian reviews the learner's progress — pages read, words practiced, test scores — in Admin → Guardian, and can ask us to export or delete everything tied to an email address: contact@example.com.</li>
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
    </Page>
  );
}
