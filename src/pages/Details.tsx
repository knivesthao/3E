import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

interface Slide {
  kicker: string;
  title: string;
  points: string[];
  foot?: string;
}

const SLIDES: Slide[] = [
  {
    kicker: '3E · Meta Global AI Hackathon',
    title: 'English webcomics for every learner',
    points: [
      'Leveled English comic books that children and new learners can actually read — and love.',
      'Built for the phones families already own. No printing, no shipping, no classroom required.',
      'This deck: why the problem matters, and how 3E answers it.',
    ],
  },
  {
    kicker: 'Slide 1 · The core problem',
    title: 'Access, not ability',
    points: [
      'Children in underserved communities don’t fail to read because they can’t learn — they fail because they have nothing to read.',
      'Books are costly to print and import, hard to ship to remote areas, and every new level or language needs another print run.',
      'The cycle reinforces itself: no books → no practice → weaker literacy → less demand for books.',
    ],
  },
  {
    kicker: 'Slide 2 · The global literacy gap',
    title: 'The numbers behind the gap',
    points: [
      '70% of 10-year-olds in low- and middle-income countries cannot read and understand a simple text.',
      '739 million adults worldwide lack basic literacy — two-thirds of them are women.',
      '40% of learners are not taught in a language they understand.',
    ],
    foot: 'Sources: World Bank, UNESCO',
  },
  {
    kicker: 'Slide 3 · One example: Laos',
    title: 'A developing country that could use this',
    points: [
      '~7.5 million people, with ~2.3 million children aged 0–14.',
      'Fewer than 1 in 7 children aged 7–14 have even three books at home.',
      'About 30% of grade 2 students cannot read a single word.',
      'Roughly 1 in 5 young people are out of work, education, and training.',
      'Per-child reading materials average less than one book per year.',
    ],
    foot: 'Sources: World Bank DataBank Lao PDR, UNICEF Lao PDR, Room to Read',
  },
  {
    kicker: 'Slide 4 · Why English specifically',
    title: 'The most requested skill',
    points: [
      'English is the de facto language of the global economy, higher education, and technology.',
      'About half of all websites are in English.',
      'Proficiency is one of the strongest predictors of access to better jobs, scholarships, and remote work.',
      'For many families it is the single most requested skill — yet classes and materials are scarce and expensive.',
    ],
    foot: 'Source: W3Techs',
  },
  {
    kicker: 'Slide 5 · The infrastructure reality',
    title: 'Phones, not internet',
    points: [
      '92% of Lao households have a mobile phone — but only 1.7% have home internet.',
      'Print can’t reach remote learners, and always-online tools can’t either.',
      'The gap isn’t devices. It’s content that works on the phone people already own.',
      '3E is a mobile-first web app: nothing to install, nothing to print, readable on a small screen.',
    ],
  },
  {
    kicker: 'Slide 6 · Who is left behind',
    title: 'Who 3E serves',
    points: [
      'Children learning to read, and children and adults learning English as a second language.',
      'Teachers with too few materials and too much preparation work.',
      'Local creators — writers and illustrators — with talent but no market or tools.',
      'Rural and low-income families for whom a physical book is a luxury.',
    ],
  },
  {
    kicker: 'Slide 7 · How 3E answers it',
    title: 'Leveled comics, made for pennies',
    points: [
      'Every book is written to a CEFR level (A1–B2), enforced by level word lists and a 90% gate — not vibes.',
      'AI draws flat-style panels plus reusable characters and places, so one cast stars across many books.',
      'The Reader coaches out loud: read-aloud scoring and listen mode, all processed on-device — free and private.',
      'A practice exam in the Library tab tracks real A1-level progress, with guidance instead of a certificate.',
    ],
  },
  {
    kicker: 'Slide 8 · The real-world path',
    title: 'Built to survive contact with reality',
    points: [
      'Cost-efficient by design: cheap text models for writing, metered image calls for art, idle GPUs parked — every call logged in the Admin panel.',
      'Creators earn from content their community needs; teachers get ready-made leveled material with less prep.',
      'The model scales by adding a language or a country — new content, not a rebuild.',
      'Distribution is a link: shared books open in any browser, no app store, no print run.',
    ],
  },
  {
    kicker: 'Slide 9 · The impact case',
    title: 'What changes if this works',
    points: [
      'Every learner gets stories matched to their reading level, in a language path they can follow.',
      'English progress becomes measurable and consistent — leveled content, tracked practice.',
      'Teachers depend less on a single textbook; local creators gain paid, skilled work.',
      'Laos is one possible target — the same model fits any community where phones outnumber bookshelves.',
    ],
    foot: 'Try it: open the Library, read a book, take the practice exam.',
  },
];

export function DetailsDeck() {
  const [index, setIndex] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);
  const [presenting, setPresenting] = useState(false);
  const slideRef = useRef<HTMLElement | null>(null);
  const total = SLIDES.length;

  const go = useCallback(
    (next: number) => setIndex(((next % total) + total) % total),
    [total],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(total - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, total]);

  const slide = SLIDES[index];

  useEffect(() => {
    function onFull() {
      setPresenting(document.fullscreenElement != null);
    }
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  async function togglePresent() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (slideRef.current) {
        await slideRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen unavailable (e.g. older browser) — the deck still works inline.
    }
  }

  return (
    <>
      <section
        ref={slideRef}
        aria-roledescription="slide"
        aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}
        className={`flex min-h-[60vh] flex-col bg-white p-6 sm:p-10 ${
          presenting ? 'h-full justify-center rounded-none border-0' : 'rounded-lg border border-stone-200 shadow-sm'
        }`}
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (dx < -40) go(index + 1);
          else if (dx > 40) go(index - 1);
          setTouchX(null);
        }}
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-900">{slide.kicker}</p>
        <h2 className="font-display mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">{slide.title}</h2>
        <ul className="mt-6 flex flex-col gap-4">
          {slide.points.map((p) => (
            <li key={p} className="text-lg leading-relaxed text-stone-800">
              {p}
            </li>
          ))}
        </ul>
        {slide.foot ? <p className="mt-auto pt-6 text-sm text-stone-500">{slide.foot}</p> : null}
        {presenting ? (
          <div className="mt-auto flex items-center justify-between pt-6">
            <p className="text-sm text-stone-500">← → to move · Esc to exit</p>
            <Button onClick={togglePresent} aria-label="Exit full screen">
              Exit
            </Button>
          </div>
        ) : null}
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button onClick={() => go(index - 1)} aria-label="Previous slide">
            ← Prev
          </Button>
          <Button onClick={() => go(index + 1)} aria-label="Next slide" variant="primary">
            Next →
          </Button>
          <Button onClick={togglePresent} aria-label="Present full screen">
            ⛶ Present
          </Button>
        </div>
        <p className="text-sm text-stone-600" aria-live="polite">
          Slide {index + 1} of {total}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Slides">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            role="tab"
            aria-selected={i === index}
            aria-label={`Go to slide ${i + 1}: ${s.title}`}
            onClick={() => go(i)}
            className={
              i === index
                ? 'h-2.5 w-8 rounded-full bg-accent-900'
                : 'h-2.5 w-2.5 rounded-full bg-stone-300 hover:bg-stone-400'
            }
          />
        ))}
      </div>

      <p className="mt-6 text-sm text-stone-600">
        Want the product, not the pitch? <Link to="/">Open the Library</Link> — or{' '}
        <Link to="/exam">take the practice exam</Link>.
      </p>
    </>
  );
}
