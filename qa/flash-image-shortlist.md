# Flashcard image shortlist (shared 3e-library, `flash-<level>-<word>.png`)

Rule: concrete picturable nouns only — no abstract words, no verbs, no
phonics/letters (those decks stay text-only by decision). A word graduates
from PILOT to FULL when its image passes the 10-card style sample.

## PILOT 50 (generate first)

A1 (25): cat, dog, bird, fish, house, home, school, book, boy, girl,
man, woman, child, baby, mother, father, friend, family, sun, rain,
water, food, day, night, morning

A2 (25): tree, river, sea, cloud, field, ground, snow, storm, winter,
summer, spring, market, shop, phone, photo, plane, train, hat, shoe,
shirt, dress, table, door, window, kitchen

## FULL shortlist (~300, curation batch 2)

All remaining picturable A1/A2 nouns + curated B1 concrete nouns
(animals, food, places, objects). Cap 300. Abstract B1+ words are
excluded by rule. Curate from `api/src/levels.ts` + `qa/grow-list.md`
(approved additions only).

## Process

1. Generate via Modal (`stabilityai/sdxl-turbo`, fixed style suffix) into
   `3e-library` under the deterministic key.
2. 10-card human sample per level for style fit.
3. Card renders image when the key exists, text-only otherwise — no
   generation ever blocks the deck.
