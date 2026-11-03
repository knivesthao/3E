# UI reference guides (stored 2026-10-28)

Two guides the team pointed at for leveling up 3E's UI. Full pages were
fetched and verified reachable; key points distilled below so nobody has
to re-read the marketing wrappers.

## 1. Erik Kennedy — 7 Rules for Creating Gorgeous UI (2024 update)

[Part 1](https://www.learnui.design/blog/7-rules-for-creating-gorgeous-ui-part-1.html) ·
[Part 2](https://www.learnui.design/blog/7-rules-for-creating-gorgeous-ui-part-2.html)
— practical, developer-targeted, no color-theory fluff.

1. **Light comes from the sky.** Shadows are depth cues; light from below
   looks wrong. Top edges catch light (bright 1px top border), bottom edges
   cast shadow. Use for buttons, cards, dividers.
2. **Black and white first.** Design in grayscale before adding color, and
   mobile-first. Forces spacing/layout thinking; color becomes the last 10%.
3. **Double your whitespace.** Breathing room is what makes UI look
   designed. Start from whitespace, add elements — not the reverse.
4. **Overlaying text on images** (Part 2) — scrim/tint methods so panel art
   stays readable under labels.
5. **Make text pop — and un-pop** (Part 2) — hierarchy through weight/size,
   de-emphasize secondary text rather than graying it into oblivion.
6. **Use only good fonts** (Part 2) — one strong pairing beats five fonts.
7. **Steal like an artist** (Part 2) — copy patterns that work.

Part 2 pulled 2026-10-28: text-on-image methods (overlay/scrim — relevant
if Reader ever labels art), text pop/un-pop (page titles up-pop fully;
everything else balances up- and down-pop), good-fonts pairing, steal
patterns. Applied: solid + outline active tabs, down-popped meta text
(stone-600, never 400/500), top-light button edges, roomy select arrows.

## 2. The Skins Factory — Definitive UI/UX Design Guide

[Guide](https://www.theskinsfactory.com/definitive-ui-ux-design-guide) —
agency playbook, heavy marketing wrapper. Useful as a checklist source
(design systems, audits, dark mode, MVP scoping), not as day-to-day
craft advice. Skim for process; prefer Kennedy for screen-level decisions.

## How this maps to 3E right now

Already applied: grayscale-first palette, system serif/sans pairing,
44px targets, visible focus, aria-pressed tabs, bottom-sheet dialogs.
Still open: scrim treatment for text over panel art in Reader (rule 4),
and a pass over Editor density now that Page spacing loosened (rule 3).
