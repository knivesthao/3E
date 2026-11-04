#!/usr/bin/env node
// QA book factory — makes REAL books through the live pipeline:
// create -> cast -> AI finish (draft + level gate) -> AI art per scene
// -> publish. Measures cost per book via /api/admin/costs/book.
//
// Provider guard: refuses to run if Baseten or Modal dev wiring is present,
// so every call below stays on the Meta Model API. One distinct user per
// book keeps each book under the daily per-user AI cap.
//
// Usage: node qa/make-books.mjs [--api URL] [--dry] [--limit N] [--offset N]
//   [--tags a,b] [--allow-wired] [--resume] [--shard i/n] [--ledger PATH]
//   --dry prints the plan (providers + books) without spending anything.
//   --resume continues ledgered partials/failed books on the SAME project
//   (no duplicate drafts); published books are skipped. Books that burn
//   their full 12-draft budget park as 'stalled' (also skipped) until
//   --retry-stalled requeues them with a fresh budget.
//   --shard i/n runs a disjoint slice for parallel jobs (e.g. three
//   terminals: --shard 0/3, 1/3, 2/3). Each shard writes its own ledger
//   file unless --ledger overrides it; qa/ledger.mjs merges them.
//   BOOK_LEDGER env also overrides the ledger path.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.API ?? 'http://localhost:8787')).replace(/\/$/, '');
const FRONTEND = API.replace(':8787', ':5173');
const DRY = flag('--dry');
const LIMIT = Number(opt('--limit', '0')) || 0;
const OFFSET = Number(opt('--offset', '0')) || 0;
const TAGS = opt('--tags', '').split(',').map((s) => s.trim()).filter(Boolean);
// Explicit opt-in to measure with wired providers (Baseten text, Modal
// images with Meta fallback). Without it the script stays Meta-only.
const ALLOW_WIRED = flag('--allow-wired');

const BOOKS = [
  {
    title: 'Red Cat', level: 'A1', email: 'qa+redcat@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'girl', description: 'a happy little girl' },
        { name: 'cat', description: 'a small red cat' },
      ],
      places: [{ name: 'house', description: 'a small house in the sun' }],
    },
  },
  {
    title: 'Night Market', level: 'A1', email: 'qa+market@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'boy', description: 'a happy little boy' },
        { name: 'mother', description: 'a kind mother' },
      ],
      places: [{ name: 'market', description: 'a busy night market with lights' }],
    },
  },
  {
    title: 'A Trip to the Lake', level: 'A2', email: 'qa+lake@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'father', description: 'a strong and funny father' },
        { name: 'girl', description: 'a brave little girl' },
      ],
      places: [{ name: 'lake', description: 'a wide blue lake with a small boat' }],
    },
  },
  {
    title: 'The New School', level: 'B1', email: 'qa+school@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'teacher', description: 'a friendly young teacher' },
        { name: 'boy', description: 'a shy new student' },
      ],
      places: [{ name: 'school', description: 'a large school with a red bicycle outside' }],
    },
  },
  {
    title: 'Letters from the City', level: 'B2', email: 'qa+city@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'sister', description: 'an older sister who writes letters' },
        { name: 'brother', description: 'a younger brother who waits for the train' },
      ],
      places: [{ name: 'city', description: 'a busy city station in the rain' }],
    },
  },
  {
    title: 'Sunny Park', level: 'A1', email: 'qa+park@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a happy little girl with a red ball' },
        { name: 'dog', description: 'a small brown dog' },
      ],
      places: [{ name: 'park', description: 'a sunny green park with big trees' }],
    },
  },
  {
    title: 'Rain Day', level: 'A1', email: 'qa+rain@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a little boy in yellow boots' },
        { name: 'grandmother', description: 'a kind grandmother with tea' },
      ],
      places: [{ name: 'house', description: 'a warm little house in the rain' }],
    },
  },
  {
    title: 'The Red Bus', level: 'A1', email: 'qa+bus@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'driver', description: 'a friendly bus driver' },
        { name: 'boy', description: 'a happy little boy with a school bag' },
      ],
      places: [{ name: 'bus', description: 'a big red bus on a sunny road' }],
    },
  },
  {
    title: 'The Lost Kite', level: 'A2', email: 'qa+kite@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a brave girl who loves the wind' },
        { name: 'brother', description: 'her small brother who holds the string' },
      ],
      places: [{ name: 'hill', description: 'a grassy hill under white clouds' }],
    },
  },
  {
    title: "Grandma's Soup", level: 'A2', email: 'qa+soup@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'grandmother', description: 'a grandmother who cooks slowly' },
        { name: 'girl', description: 'a hungry girl who helps cut bread' },
      ],
      places: [{ name: 'kitchen', description: 'a warm kitchen with a big pot' }],
    },
  },
  {
    title: 'A Snowy Day', level: 'A2', email: 'qa+snow@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy in a blue coat' },
        { name: 'father', description: 'a father who pulls a red sled' },
      ],
      places: [{ name: 'village', description: 'a quiet snowy village at morning' }],
    },
  },
  {
    title: 'The River Boat', level: 'A2', email: 'qa+boat@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'fisherman', description: 'an old fisherman with a wide hat' },
        { name: 'boy', description: 'a boy who wants to learn the river' },
      ],
      places: [{ name: 'river', description: 'a slow green river between hills' }],
    },
  },
  {
    title: 'The Old Lighthouse', level: 'B1', email: 'qa+lighthouse@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'keeper', description: 'a lonely lighthouse keeper' },
        { name: 'girl', description: 'a curious girl from the village' },
      ],
      places: [{ name: 'lighthouse', description: 'a tall white lighthouse on grey rocks' }],
    },
  },
  {
    title: 'Saturday Market', level: 'B1', email: 'qa+saturday@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'seller', description: 'a loud cheerful fruit seller' },
        { name: 'mother', description: 'a mother counting coins' },
      ],
      places: [{ name: 'market', description: 'a crowded Saturday market with colors' }],
    },
  },
  {
    title: 'The Broken Bicycle', level: 'B1', email: 'qa+bicycle@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a determined boy with a toolbox' },
        { name: 'neighbor', description: 'a retired mechanic next door' },
      ],
      places: [{ name: 'street', description: 'a quiet street with repair shop' }],
    },
  },
  {
    title: 'A Letter for Sam', level: 'B1', email: 'qa+letter@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'postman', description: 'a young postman on a bicycle' },
        { name: 'sam', description: 'an old man waiting by the window' },
      ],
      places: [{ name: 'town', description: 'a small town with one post office' }],
    },
  },
  {
    title: 'The Night Train', level: 'B2', email: 'qa+train@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'traveler', description: 'a tired traveler with a suitcase' },
        { name: 'conductor', description: 'a conductor who knows every station' },
      ],
      places: [{ name: 'train', description: 'a night train crossing dark fields' }],
    },
  },
  {
    title: 'Climbing the Hill', level: 'B2', email: 'qa+climb@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'climber', description: 'an experienced mountain climber' },
        { name: 'student', description: 'a nervous young student' },
      ],
      places: [{ name: 'mountain', description: 'a steep mountain above the clouds' }],
    },
  },
  {
    title: 'The Empty House', level: 'B2', email: 'qa+empty@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'woman', description: 'a woman returning after years away' },
        { name: 'neighbor', description: 'a neighbor who kept the garden' },
      ],
      places: [{ name: 'house', description: 'a dusty empty house full of memories' }],
    },
  },
  {
    title: 'Voices on the Radio', level: 'B2', email: 'qa+radio@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'host', description: 'a late-night radio host' },
        { name: 'caller', description: 'a caller who never gives a name' },
      ],
      places: [{ name: 'studio', description: 'a small radio studio at midnight' }],
    },
  },
  {
    title: 'The Cartographer', level: 'C1', email: 'qa+cartographer@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cartographer', description: 'an aging mapmaker losing his sight' },
        { name: 'apprentice', description: 'his impatient young apprentice' },
      ],
      places: [{ name: 'atelier', description: 'a map atelier smelling of ink' }],
    },
  },
  {
    title: 'Salt and Stone', level: 'C1', email: 'qa+salt@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'miner', description: 'a third-generation salt miner' },
        { name: 'engineer', description: 'an engineer sent to close the mine' },
      ],
      places: [{ name: 'mine', description: 'a white salt mine under the hills' }],
    },
  },
  {
    title: 'The Winter Archive', level: 'C1', email: 'qa+archive@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'archivist', description: 'a meticulous archivist of letters' },
        { name: 'historian', description: 'a historian chasing one missing file' },
      ],
      places: [{ name: 'archive', description: 'a cold archive of wooden drawers' }],
    },
  },
  {
    title: 'Crossing at Dawn', level: 'C1', email: 'qa+dawn@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'ferryman', description: 'a ferryman who has crossed for decades' },
        { name: 'passenger', description: 'a passenger carrying an empty case' },
      ],
      places: [{ name: 'harbor', description: 'a grey harbor before sunrise' }],
    },
  },
  {
    title: 'The Glass Garden', level: 'C1', email: 'qa+garden@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'botanist', description: 'a botanist growing impossible flowers' },
        { name: 'visitor', description: 'a skeptical visitor from the city' },
      ],
      places: [{ name: 'greenhouse', description: 'a glass greenhouse in winter' }],
    },
  },
  {
    title: 'An Atlas of Small Hours', level: 'C2', email: 'qa+atlas@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'insomniac', description: 'an insomniac writer mapping the night' },
        { name: 'baker', description: 'a baker who works before dawn' },
      ],
      places: [{ name: 'city', description: 'a sleeping city at three in the morning' }],
    },
  },
  {
    title: 'The Weight of Light', level: 'C2', email: 'qa+light@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'physicist', description: 'a retired physicist with doubts' },
        { name: 'daughter', description: 'her estranged daughter, a painter' },
      ],
      places: [{ name: 'observatory', description: 'a hilltop observatory at dusk' }],
    },
  },
  {
    title: 'Harbor of Echoes', level: 'C2', email: 'qa+echoes@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'captain', description: 'a captain who never went to sea' },
        { name: 'singer', description: 'a singer who performs for ships' },
      ],
      places: [{ name: 'harbor', description: 'a fogbound harbor of empty ships' }],
    },
  },
  {
    title: 'A Field Guide to Forgetting', level: 'C2', email: 'qa+forgetting@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'naturalist', description: 'a naturalist cataloguing disappearance' },
        { name: 'child', description: 'a child who remembers everything' },
      ],
      places: [{ name: 'wetland', description: 'a draining wetland at low water' }],
    },
  },
  {
    title: 'The Last Observatory', level: 'C2', email: 'qa+observatory@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'astronomer', description: 'the last astronomer on the mountain' },
        { name: 'technician', description: 'a technician sent to decommission it' },
      ],
      places: [{ name: 'peak', description: 'a mountain peak above light pollution' }],
    },
  },
  {
    title: 'The Big Dog', level: 'A1', email: 'qa+bigdog@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'boy', description: 'a small boy with a ball' },
        { name: 'dog', description: 'a very big friendly dog' },
      ],
      places: [{ name: 'yard', description: 'a sunny yard with a fence' }],
    },
  },
  {
    title: 'My Cat', level: 'A1', email: 'qa+mycat@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'girl', description: 'a little girl in red shoes' },
        { name: 'cat', description: 'a small white cat' },
      ],
      places: [{ name: 'home', description: 'a small warm home' }],
    },
  },
  {
    title: 'The Red Hen', level: 'A1', email: 'qa+redhen@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'hen', description: 'a red hen with soft feathers' },
        { name: 'farmer', description: 'a kind old farmer' },
      ],
      places: [{ name: 'farm', description: 'a small farm with a red barn' }],
    },
  },
  {
    title: 'A Fish Bowl', level: 'A1', email: 'qa+fishbowl@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'fish', description: 'a tiny orange fish' },
        { name: 'girl', description: 'a girl who loves fish' },
      ],
      places: [{ name: 'room', description: 'a clean room with a table' }],
    },
  },
  {
    title: 'The Duck Pond', level: 'A1', email: 'qa+duckpond@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'duck', description: 'a yellow duck with six babies' },
        { name: 'boy', description: 'a boy with bread for ducks' },
      ],
      places: [{ name: 'pond', description: 'a round pond with green plants' }],
    },
  },
  {
    title: 'An Apple Tree', level: 'A1', email: 'qa+appletree@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'tree', description: 'a tall tree full of red apples' },
        { name: 'girl', description: 'a hungry little girl' },
      ],
      places: [{ name: 'garden', description: 'a green garden in the sun' }],
    },
  },
  {
    title: 'Rice Soup', level: 'A1', email: 'qa+ricesoup@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'mother', description: 'a mother who cooks well' },
        { name: 'boy', description: 'a sick boy in bed' },
      ],
      places: [{ name: 'kitchen', description: 'a small kitchen with a big pot' }],
    },
  },
  {
    title: 'The Bread Shop', level: 'A1', email: 'qa+breadshop@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'baker', description: 'a happy baker with flour on his hands' },
        { name: 'girl', description: 'a girl buying morning bread' },
      ],
      places: [{ name: 'shop', description: 'a bread shop smelling of fresh bread' }],
    },
  },
  {
    title: 'Bananas', level: 'A1', email: 'qa+bananas@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'monkey', description: 'a funny monkey who loves bananas' },
        { name: 'boy', description: 'a boy sharing his lunch' },
      ],
      places: [{ name: 'school', description: 'a school yard at lunch time' }],
    },
  },
  {
    title: 'A Mango Tree', level: 'A1', email: 'qa+mangotree@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'grandpa', description: 'an old grandpa with a long stick' },
        { name: 'child', description: 'a small child reaching up high' },
      ],
      places: [{ name: 'village', description: 'a quiet village with mango trees' }],
    },
  },
  {
    title: 'My Family', level: 'A1', email: 'qa+myfamily@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'father', description: 'a tall father with a kind smile' },
        { name: 'mother', description: 'a busy mother with a baby' },
      ],
      places: [{ name: 'house', description: 'a blue house by the road' }],
    },
  },
  {
    title: 'The School Bag', level: 'A1', email: 'qa+schoolbag@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'boy', description: 'a new student on his first day' },
        { name: 'teacher', description: 'a smiling teacher at the door' },
      ],
      places: [{ name: 'classroom', description: 'a bright classroom with small desks' }],
    },
  },
  {
    title: 'My Shoes', level: 'A1', email: 'qa+myshoes@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'girl', description: 'a fast girl who loves to run' },
        { name: 'shopkeeper', description: 'a shopkeeper with many shoe boxes' },
      ],
      places: [{ name: 'market', description: 'a morning market full of colors' }],
    },
  },
  {
    title: 'The Blue Cup', level: 'A1', email: 'qa+bluecup@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'baby', description: 'a thirsty baby in a high chair' },
        { name: 'sister', description: 'a big sister with a blue cup' },
      ],
      places: [{ name: 'table', description: 'a round table with breakfast on it' }],
    },
  },
  {
    title: 'The Hat', level: 'A1', email: 'qa+thehat@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy with no hat in hot sun' },
        { name: 'grandma', description: 'a grandma who makes hats' },
      ],
      places: [{ name: 'porch', description: 'a cool porch out of the sun' }],
    },
  },
  {
    title: 'The Window', level: 'A1', email: 'qa+thewindow@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cat', description: 'a curious cat on the sill' },
        { name: 'bird', description: 'a small bird outside the glass' },
      ],
      places: [{ name: 'window', description: 'a big open window with rain outside' }],
    },
  },
  {
    title: 'The Farm', level: 'A1', email: 'qa+thefarm@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cow', description: 'a slow black-and-white cow' },
        { name: 'pig', description: 'a pink pig in the mud' },
      ],
      places: [{ name: 'field', description: 'a wide green field with one tree' }],
    },
  },
  {
    title: 'Chicken Eggs', level: 'A1', email: 'qa+eggs@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'hen', description: 'a white hen in a straw nest' },
        { name: 'boy', description: 'a boy counting eggs every morning' },
      ],
      places: [{ name: 'coop', description: 'a small chicken coop by the fence' }],
    },
  },
  {
    title: 'The Moon', level: 'A1', email: 'qa+themoon@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'father', description: 'a father pointing at the sky' },
        { name: 'child', description: 'a sleepy child in pajamas' },
      ],
      places: [{ name: 'roof', description: 'a flat roof under a round moon' }],
    },
  },
  {
    title: 'The Flower', level: 'A1', email: 'qa+theflower@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl watering plants every day' },
        { name: 'bee', description: 'a busy bee over the flowers' },
      ],
      places: [{ name: 'balcony', description: 'a small balcony full of pots' }],
    },
  },
  {
    title: 'The Baby', level: 'A1', email: 'qa+thebaby@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'baby', description: 'a laughing baby with two teeth' },
        { name: 'brother', description: 'a proud big brother' },
      ],
      places: [{ name: 'bedroom', description: 'a warm bedroom with a small bed' }],
    },
  },
  {
    title: 'The Old Grandpa', level: 'A1', email: 'qa+grandpa@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'grandpa', description: 'an old grandpa with stories' },
        { name: 'girl', description: 'a girl who asks many questions' },
      ],
      places: [{ name: 'chair', description: 'a wooden chair under the mango tree' }],
    },
  },
  {
    title: 'Run!', level: 'A1', email: 'qa+run@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'the fastest boy in the village' },
        { name: 'dog', description: 'a small dog that runs even faster' },
      ],
      places: [{ name: 'track', description: 'a dirt track around the rice field' }],
    },
  },
  {
    title: 'Jump High', level: 'A1', email: 'qa+jump@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'frog', description: 'a green frog by the water' },
        { name: 'girl', description: 'a girl learning to jump rope' },
      ],
      places: [{ name: 'pond', description: 'a still pond with lily pads' }],
    },
  },
  {
    title: 'I Can Swim', level: 'A1', email: 'qa+swim@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy afraid of deep water' },
        { name: 'teacher', description: 'a patient swimming teacher' },
      ],
      places: [{ name: 'pool', description: 'a shallow pool with blue water' }],
    },
  },
  {
    title: 'Sing a Song', level: 'A1', email: 'qa+sing@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a shy girl with a loud voice' },
        { name: 'mother', description: 'a mother clapping along' },
      ],
      places: [{ name: 'stage', description: 'a small stage with bright lights' }],
    },
  },
  {
    title: 'Eat Up', level: 'A1', email: 'qa+eatup@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a picky boy who hates greens' },
        { name: 'grandma', description: 'a grandma with a secret recipe' },
      ],
      places: [{ name: 'dining', description: 'a dining room with a steaming bowl' }],
    },
  },
  {
    title: 'Wash Your Hands', level: 'A1', email: 'qa+wash@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'nurse', description: 'a nurse showing clean hands' },
        { name: 'child', description: 'a muddy child after playing' },
      ],
      places: [{ name: 'sink', description: 'a white sink with soap bubbles' }],
    },
  },
  {
    title: 'Go to School', level: 'A1', email: 'qa+goschool@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a sleepy girl with a heavy bag' },
        { name: 'friend', description: 'her best friend waiting outside' },
      ],
      places: [{ name: 'road', description: 'a dusty road to school' }],
    },
  },
  {
    title: 'Come Home', level: 'A1', email: 'qa+comehome@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'father', description: 'a father late from work' },
        { name: 'dog', description: 'a dog waiting at the gate' },
      ],
      places: [{ name: 'gate', description: 'a front gate at sunset' }],
    },
  },
  {
    title: 'Sit Down', level: 'A1', email: 'qa+sitdown@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'teacher', description: 'a teacher starting the lesson' },
        { name: 'class', description: 'a noisy class of small children' },
      ],
      places: [{ name: 'classroom', description: 'a classroom with a big blackboard' }],
    },
  },
  {
    title: 'Look Here', level: 'A1', email: 'qa+lookhere@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'photographer', description: 'a photographer with a big camera' },
        { name: 'family', description: 'a family squeezing together' },
      ],
      places: [{ name: 'park', description: 'a park with a fountain behind' }],
    },
  },
  {
    title: 'Say Hello', level: 'A1', email: 'qa+hello2@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a new boy too shy to speak' },
        { name: 'girl', description: 'a friendly girl next door' },
      ],
      places: [{ name: 'fence', description: 'a low fence between two houses' }],
    },
  },
  {
    title: 'I Can Read', level: 'A1', email: 'qa+icanread@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl with her first book' },
        { name: 'teacher', description: 'a teacher pointing at words' },
      ],
      places: [{ name: 'library', description: 'a tiny library with picture books' }],
    },
  },
  {
    title: 'Count to Ten', level: 'A1', email: 'qa+count@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy counting on his fingers' },
        { name: 'sister', description: 'his sister hiding for hide-and-seek' },
      ],
      places: [{ name: 'tree', description: 'a big tree for counting against' }],
    },
  },
  {
    title: 'Help Me', level: 'A1', email: 'qa+helpme@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'oldman', description: 'an old man with heavy bags' },
        { name: 'boy', description: 'a strong boy running to help' },
      ],
      places: [{ name: 'stairs', description: 'long stairs up to the temple' }],
    },
  },
  {
    title: 'Big and Small', level: 'A1', email: 'qa+bigsmall@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'elephant', description: 'a huge grey elephant' },
        { name: 'mouse', description: 'a tiny brown mouse' },
      ],
      places: [{ name: 'savanna', description: 'a wide grassy plain' }],
    },
  },
  {
    title: 'The Tall Tree', level: 'A1', email: 'qa+talltree@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'giraffe', description: 'a tall giraffe with a long neck' },
        { name: 'boy', description: 'a short boy looking way up' },
      ],
      places: [{ name: 'acacia', description: 'a tall lonely acacia tree' }],
    },
  },
  {
    title: 'A Happy Day', level: 'A1', email: 'qa+happyday@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a smiling girl with balloons' },
        { name: 'father', description: 'a father carrying a cake' },
      ],
      places: [{ name: 'party', description: 'a birthday party with music' }],
    },
  },
  {
    title: 'The Sad Puppy', level: 'A1', email: 'qa+sadpuppy@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'puppy', description: 'a lost puppy in the rain' },
        { name: 'boy', description: 'a boy with an umbrella' },
      ],
      places: [{ name: 'street', description: 'a wet street with puddles' }],
    },
  },
  {
    title: 'The Fast Car', level: 'A1', email: 'qa+fastcar@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'driver', description: 'a racing driver in a red car' },
        { name: 'child', description: 'a child cheering at the fence' },
      ],
      places: [{ name: 'racetrack', description: 'a round track with flags' }],
    },
  },
  {
    title: 'The Slow Turtle', level: 'A1', email: 'qa+slowturtle@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'turtle', description: 'a slow old turtle' },
        { name: 'rabbit', description: 'a fast rabbit who naps' },
      ],
      places: [{ name: 'meadow', description: 'a green meadow with a finish line' }],
    },
  },
  {
    title: 'Hot Soup', level: 'A1', email: 'qa+hotsoup@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'cook', description: 'a cook blowing on a spoon' },
        { name: 'girl', description: 'a hungry girl waiting to eat' },
      ],
      places: [{ name: 'stall', description: 'a street stall with steam rising' }],
    },
  },
  {
    title: 'Cold Water', level: 'A1', email: 'qa+coldwater@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'a hot boy after football' },
        { name: 'vendor', description: 'a vendor with a cooler of bottles' },
      ],
      places: [{ name: 'field', description: 'a dusty football field at noon' }],
    },
  },
  {
    title: 'The Red Balloon', level: 'A1', email: 'qa+redballoon@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a small girl holding a string' },
        { name: 'wind', description: 'a playful wind tugging the balloon' },
      ],
      places: [{ name: 'fair', description: 'a fair with tents and music' }],
    },
  },
  {
    title: 'The Green Frog', level: 'A1', email: 'qa+greenfrog@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'frog', description: 'a bright green frog' },
        { name: 'boy', description: 'a quiet boy watching closely' },
      ],
      places: [{ name: 'ricefield', description: 'a flooded rice field at dusk' }],
    },
  },
  {
    title: 'A New Friend', level: 'A1', email: 'qa+newfriend@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'a lonely new boy in town' },
        { name: 'dog', description: 'a stray dog following him home' },
      ],
      places: [{ name: 'bridge', description: 'an old bridge over the river' }],
    },
  },
  {
    title: 'The Long Road', level: 'A1', email: 'qa+longroad@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'traveler', description: 'a tired traveler with a backpack' },
        { name: 'girl', description: 'a girl selling water by the road' },
      ],
      places: [{ name: 'road', description: 'a long straight road through fields' }],
    },
  },
  {
    title: 'The Round Moon', level: 'A1', email: 'qa+roundmoon@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'owl', description: 'a round-eyed owl in a tree' },
        { name: 'child', description: 'a child awake past bedtime' },
      ],
      places: [{ name: 'night', description: 'a dark night with a full moon' }],
    },
  },
  {
    title: 'The Old Bike', level: 'A1', email: 'qa+oldbike@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy fixing a rusty bike' },
        { name: 'father', description: 'his father holding the tools' },
      ],
      places: [{ name: 'yard', description: 'a yard scattered with spare parts' }],
    },
  },
  {
    title: 'Dance Now', level: 'A1', email: 'qa+dance@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl dancing in the rain' },
        { name: 'brother', description: 'her brother laughing and joining' },
      ],
      places: [{ name: 'courtyard', description: 'a wet courtyard with music playing' }],
    },
  },
  {
    title: 'Brush Your Teeth', level: 'A1', email: 'qa+brush@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a sleepy boy with a toothbrush' },
        { name: 'mother', description: 'a mother counting to one hundred' },
      ],
      places: [{ name: 'bathroom', description: 'a small bathroom with a mirror' }],
    },
  },
  {
    title: 'Wave Goodbye', level: 'A1', email: 'qa+wave@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl moving to a new town' },
        { name: 'friend', description: 'her best friend running beside the bus' },
      ],
      places: [{ name: 'station', description: 'a small bus station in the morning' }],
    },
  },
  {
    title: 'Open the Box', level: 'A1', email: 'qa+openbox@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a birthday boy shaking a big box' },
        { name: 'sister', description: 'his sister peeking through the tape' },
      ],
      places: [{ name: 'livingroom', description: 'a living room full of family' }],
    },
  },
  {
    title: 'The Blue Bird', level: 'A1', email: 'qa+bluebird@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'bird', description: 'a bright blue bird with a loud song' },
        { name: 'girl', description: 'a girl feeding it rice every day' },
      ],
      places: [{ name: 'garden', description: 'a garden with one tall papaya tree' }],
    },
  },
  {
    title: 'The Lost Kite Festival', level: 'A2', email: 'qa+kitefest@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy with a homemade kite' },
        { name: 'maker', description: 'an old kite maker with dyed paper' },
      ],
      places: [{ name: 'field', description: 'a windy field full of kites' }],
    },
  },
  {
    title: 'The Noodle Stall', level: 'A2', email: 'qa+noodles@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cook', description: 'a fast cook pulling noodles' },
        { name: 'girl', description: 'a hungry student with little money' },
      ],
      places: [{ name: 'street', description: 'a busy street of food stalls' }],
    },
  },
  {
    title: 'A Bag of Rice', level: 'A2', email: 'qa+ricebag@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'porter', description: 'a strong porter with a heavy sack' },
        { name: 'merchant', description: 'a merchant counting her stock' },
      ],
      places: [{ name: 'warehouse', description: 'a warehouse stacked with rice sacks' }],
    },
  },
  {
    title: 'The Tailor Shop', level: 'A2', email: 'qa+tailor@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'tailor', description: 'a careful tailor with chalk and tape' },
        { name: 'bride', description: 'a nervous bride choosing cloth' },
      ],
      places: [{ name: 'shop', description: 'a small shop of folded fabrics' }],
    },
  },
  {
    title: 'The Broken Bridge', level: 'A2', email: 'qa+bridge2@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'engineer', description: 'a young engineer with plans' },
        { name: 'village', description: 'villagers carrying planks together' },
      ],
      places: [{ name: 'river', description: 'a wide river after the rains' }],
    },
  },
  {
    title: 'The Mango Harvest', level: 'A2', email: 'qa+harvest@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'pickers', description: 'a team of fruit pickers at dawn' },
        { name: 'owner', description: 'the orchard owner with baskets' },
      ],
      places: [{ name: 'orchard', description: 'an orchard heavy with ripe mangoes' }],
    },
  },
  {
    title: 'Catching Fish', level: 'A2', email: 'qa+fishing@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'fisher', description: 'an old fisher mending his net' },
        { name: 'grandson', description: 'his grandson learning the knots' },
      ],
      places: [{ name: 'boat', description: 'a wooden boat rocking at sunrise' }],
    },
  },
  {
    title: 'Planting Rice', level: 'A2', email: 'qa+planting@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'farmers', description: 'farmers bent over green shoots' },
        { name: 'buffalo', description: 'a muddy buffalo pulling the plow' },
      ],
      places: [{ name: 'paddy', description: 'a flooded paddy under grey sky' }],
    },
  },
  {
    title: 'The Bus Ride', level: 'A2', email: 'qa+busride@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'driver', description: 'a sleepy driver on the night shift' },
        { name: 'student', description: 'a student traveling home for exams' },
      ],
      places: [{ name: 'bus', description: 'a crowded night bus over the hills' }],
    },
  },
  {
    title: 'Learning to Cook', level: 'A2', email: 'qa+learcook@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'aunt', description: 'an aunt who never measures anything' },
        { name: 'niece', description: 'her niece writing it all down' },
      ],
      places: [{ name: 'kitchen', description: 'a smoky kitchen full of pots' }],
    },
  },
  {
    title: 'The Football Match', level: 'A2', email: 'qa+football@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'captain', description: 'a nervous team captain' },
        { name: 'crowd', description: 'a roaring crowd of villagers' },
      ],
      places: [{ name: 'stadium', description: 'a muddy field with bamboo goals' }],
    },
  },
  {
    title: 'A Brave Night', level: 'A2', email: 'qa+brave@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl walking home in the dark' },
        { name: 'moon', description: 'a pale moon behind thin clouds' },
      ],
      places: [{ name: 'path', description: 'a dark path between rice fields' }],
    },
  },
  {
    title: 'The Heavy Rain', level: 'A2', email: 'qa+heavyrain@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'farmer', description: 'a worried farmer watching the sky' },
        { name: 'child', description: 'a child sailing paper boats' },
      ],
      places: [{ name: 'village', description: 'a village street turning to river' }],
    },
  },
  {
    title: 'A Cloudy Morning', level: 'A2', email: 'qa+cloudy@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'seller', description: 'a coffee seller opening late' },
        { name: 'monk', description: 'a young monk on alms round' },
      ],
      places: [{ name: 'temple', description: 'a temple gate in grey mist' }],
    },
  },
  {
    title: 'The New Teacher', level: 'A2', email: 'qa+newteacher@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'teacher', description: 'a new teacher from the city' },
        { name: 'class', description: 'a curious class of thirty kids' },
      ],
      places: [{ name: 'school', description: 'a wooden school on stilts' }],
    },
  },
  {
    title: 'The Medicine Box', level: 'A2', email: 'qa+medicine@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'nurse', description: 'a traveling nurse with a cold box' },
        { name: 'elder', description: 'an elder waiting for vaccines' },
      ],
      places: [{ name: 'clinic', description: 'a one-room clinic up the hill' }],
    },
  },
  {
    title: 'The Night Market Lights', level: 'A2', email: 'qa+lights@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'vendor', description: 'a lantern vendor lighting up' },
        { name: 'tourist', description: 'a lost tourist with a map' },
      ],
      places: [{ name: 'alley', description: 'a narrow alley of glowing stalls' }],
    },
  },
  {
    title: 'A Letter Home', level: 'A2', email: 'qa+letterhome@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'worker', description: 'a factory worker writing slowly' },
        { name: 'mother', description: 'her mother waiting for news' },
      ],
      places: [{ name: 'dorm', description: 'a crowded dorm room at night' }],
    },
  },
  {
    title: 'Fixing the Roof', level: 'A2', email: 'qa+roof@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'father', description: 'a father patching leaks' },
        { name: 'son', description: 'his son passing up the thatch' },
      ],
      places: [{ name: 'roof', description: 'a leaking roof in storm season' }],
    },
  },
  {
    title: 'Crossing the River', level: 'A2', email: 'qa+crossing@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'ferryman', description: 'a ferryman who knows every current' },
        { name: 'trader', description: 'a trader with a bicycle of goods' },
      ],
      places: [{ name: 'ferry', description: 'a small ferry at the muddy bank' }],
    },
  },
  {
    title: 'The Wedding Day', level: 'A2', email: 'qa+wedding@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'bride', description: 'a glowing bride in silk' },
        { name: 'groom', description: 'a nervous groom with flowers' },
      ],
      places: [{ name: 'hall', description: 'a decorated hall full of guests' }],
    },
  },
  {
    title: 'A Quiet Library', level: 'A2', email: 'qa+quietlib@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'librarian', description: 'a strict librarian who whispers' },
        { name: 'boy', description: 'a loud boy learning to whisper' },
      ],
      places: [{ name: 'library', description: 'a dusty library with tall shelves' }],
    },
  },
  {
    title: 'The Old Photograph', level: 'A2', email: 'qa+photo@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'grandma', description: 'a grandma with a fading photo' },
        { name: 'girl', description: 'her granddaughter asking who is who' },
      ],
      places: [{ name: 'album', description: 'a worn album on a lap' }],
    },
  },
  {
    title: 'The Broken Fan', level: 'A2', email: 'qa+fan@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'repairman', description: 'a repairman with a toolbox' },
        { name: 'family', description: 'a sweating family fanning themselves' },
      ],
      places: [{ name: 'shop', description: 'a repair shop smelling of oil' }],
    },
  },
  {
    title: 'The Power Cut', level: 'A2', email: 'qa+powercut@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'family', description: 'a family with candles lit' },
        { name: 'neighbor', description: 'a neighbor sharing his generator' },
      ],
      places: [{ name: 'street', description: 'a dark street with one lit house' }],
    },
  },
  {
    title: 'The New Baby Goat', level: 'A2', email: 'qa+goat@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'goat', description: 'a wobbly newborn goat' },
        { name: 'girl', description: 'a girl feeding it warm milk' },
      ],
      places: [{ name: 'pen', description: 'a straw pen behind the house' }],
    },
  },
  {
    title: 'The Long Tailor Queue', level: 'A2', email: 'qa+queue@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'customers', description: 'impatient customers checking watches' },
        { name: 'tailor', description: 'a tailor sewing as fast as she can' },
      ],
      places: [{ name: 'waiting', description: 'a crowded waiting bench' }],
    },
  },
  {
    title: 'Saving the Puppies', level: 'A2', email: 'qa+puppies@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'rescuers', description: 'two kids with a cardboard box' },
        { name: 'pups', description: 'three shivering puppies in the rain' },
      ],
      places: [{ name: 'ditch', description: 'a muddy ditch by the road' }],
    },
  },
  {
    title: 'The Honest Taxi', level: 'A2', email: 'qa+taxi@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'driver', description: 'an honest driver returning a wallet' },
        { name: 'passenger', description: 'a shocked passenger counting her cash' },
      ],
      places: [{ name: 'taxi', description: 'a yellow taxi stuck in traffic' }],
    },
  },
  {
    title: 'A Lucky Day', level: 'A2', email: 'qa+lucky@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'an unlucky boy until today' },
        { name: 'friend', description: 'his friend who believes in luck' },
      ],
      places: [{ name: 'lottery', description: 'a lottery stall with golden tickets' }],
    },
  },
  {
    title: 'The Tired Elephant', level: 'A2', email: 'qa+elephant@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'elephant', description: 'an exhausted logging elephant' },
        { name: 'vet', description: 'a young vet with a big syringe' },
      ],
      places: [{ name: 'clearing', description: 'a forest clearing at midday' }],
    },
  },
  {
    title: 'The Coconut Seller', level: 'A2', email: 'qa+coconut@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'seller', description: 'a strong seller climbing palms' },
        { name: 'tourist', description: 'a thirsty tourist with no cash' },
      ],
      places: [{ name: 'beach', description: 'a hot beach lined with palms' }],
    },
  },
  {
    title: 'The School Play', level: 'A2', email: 'qa+schoolplay@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'director', description: 'a bossy student director' },
        { name: 'cast', description: 'a nervous cast forgetting lines' },
      ],
      places: [{ name: 'hall', description: 'a school hall with a crooked curtain' }],
    },
  },
  {
    title: 'The Flood Drill', level: 'A2', email: 'qa+drill@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'chief', description: 'a village chief with a loudspeaker' },
        { name: 'families', description: 'families carrying bags uphill' },
      ],
      places: [{ name: 'hill', description: 'a safe hill above the water' }],
    },
  },
  {
    title: 'A Generous Stranger', level: 'A2', email: 'qa+generous@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'stranger', description: 'a quiet stranger paying for all' },
        { name: 'owner', description: 'a noodle shop owner in tears' },
      ],
      places: [{ name: 'shop', description: 'a tiny shop on a rainy night' }],
    },
  },
  {
    title: 'The Papaya Salad Contest', level: 'A2', email: 'qa+papaya@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cooks', description: 'two rival cooks pounding mortars' },
        { name: 'judge', description: 'a sweating judge tasting carefully' },
      ],
      places: [{ name: 'fair', description: 'a food fair at noon' }],
    },
  },
  {
    title: 'The Broken Umbrella', level: 'A2', email: 'qa+umbrella@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl with an inside-out umbrella' },
        { name: 'vendor', description: 'a vendor selling plastic ponchos' },
      ],
      places: [{ name: 'station', description: 'a bus station in a downpour' }],
    },
  },
  {
    title: 'The New Puppy School', level: 'A2', email: 'qa+puppyschool@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'trainer', description: 'a strict trainer with treats' },
        { name: 'puppy', description: 'a naughty puppy learning to sit' },
      ],
      places: [{ name: 'yard', description: 'a fenced yard with hoops' }],
    },
  },
  {
    title: 'Grandma Visits', level: 'A2', email: 'qa+grandmavisits@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'grandma', description: 'a grandma arriving with gifts' },
        { name: 'kids', description: 'excited kids running to the gate' },
      ],
      places: [{ name: 'home', description: 'a house decorated for the visit' }],
    },
  },
  {
    title: 'The Tall Sunflowers', level: 'A2', email: 'qa+sunflowers@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'gardener', description: 'a proud gardener measuring stems' },
        { name: 'bees', description: 'drunk bees wobbling between heads' },
      ],
      places: [{ name: 'garden', description: 'a garden of giant sunflowers' }],
    },
  },
  {
    title: 'The Short Cut', level: 'A2', email: 'qa+shortcut@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy late for school again' },
        { name: 'dog', description: 'his dog who knows every shortcut' },
      ],
      places: [{ name: 'alley', description: 'a maze of back alleys' }],
    },
  },
  {
    title: 'The Sticky Rice Basket', level: 'A2', email: 'qa+stickyRice@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'vendor', description: 'a vendor wrapping bamboo baskets' },
        { name: 'monks', description: 'monks collecting morning alms' },
      ],
      places: [{ name: 'dawn', description: 'a street at dawn with mist' }],
    },
  },
  {
    title: 'The Loud Rooster', level: 'A2', email: 'qa+rooster@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'rooster', description: 'a rooster crowing at 4am' },
        { name: 'family', description: 'an exhausted family covering ears' },
      ],
      places: [{ name: 'coop', description: 'a coop next to the bedroom wall' }],
    },
  },
  {
    title: 'Washing the Truck', level: 'A2', email: 'qa+truck@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'brothers', description: 'two brothers with buckets' },
        { name: 'owner', description: 'the truck owner paying in noodles' },
      ],
      places: [{ name: 'riverbank', description: 'a riverbank with a hose' }],
    },
  },
  {
    title: 'A Polite Refusal', level: 'A2', email: 'qa+refusal@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'guest', description: 'a full guest facing a third helping' },
        { name: 'host', description: 'a host who will not take no' },
      ],
      places: [{ name: 'table', description: 'a table groaning with dishes' }],
    },
  },
  {
    title: 'The Exam Week', level: 'B1', email: 'qa+examweek@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'student', description: 'a student who studied all year' },
        { name: 'friend', description: 'her friend who studied one night' },
      ],
      places: [{ name: 'hall', description: 'a silent exam hall with clocks' }],
    },
  },
  {
    title: 'The Part-Time Job', level: 'B1', email: 'qa+parttime@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'teen', description: 'a teen saving for a phone' },
        { name: 'boss', description: 'a strict cafe boss with rules' },
      ],
      places: [{ name: 'cafe', description: 'a busy cafe near the school' }],
    },
  },
  {
    title: 'The Lost Wallet Return', level: 'B1', email: 'qa+wallet@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'finder', description: 'a poor finder holding a fat wallet' },
        { name: 'owner', description: 'a rich owner offering a reward' },
      ],
      places: [{ name: 'park', description: 'a park bench where it was lost' }],
    },
  },
  {
    title: 'Teaching Grandma to Text', level: 'B1', email: 'qa+texting@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'grandson', description: 'a patient grandson with a phone' },
        { name: 'grandma', description: 'a grandma afraid of breaking it' },
      ],
      places: [{ name: 'porch', description: 'a porch with afternoon light' }],
    },
  },
  {
    title: 'The Borrowed Motorbike', level: 'B1', email: 'qa+motorbike@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a boy borrowing without asking' },
        { name: 'brother', description: 'his furious older brother' },
      ],
      places: [{ name: 'garage', description: 'an empty garage with an oil stain' }],
    },
  },
  {
    title: 'A Difficult Choice', level: 'B1', email: 'qa+choice@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a girl choosing between two schools' },
        { name: 'parents', description: 'parents disagreeing quietly' },
      ],
      places: [{ name: 'kitchen', description: 'a kitchen table covered in brochures' }],
    },
  },
  {
    title: 'The Noisy Neighbor', level: 'B1', email: 'qa+neighbor@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'student', description: 'a student failing from no sleep' },
        { name: 'neighbor', description: 'a drummer who practices at midnight' },
      ],
      places: [{ name: 'apartments', description: 'thin-walled apartments' }],
    },
  },
  {
    title: 'The Village Vote', level: 'B1', email: 'qa+vote@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'chief', description: 'an aging chief facing a challenge' },
        { name: 'young', description: 'a young candidate with new ideas' },
      ],
      places: [{ name: 'meeting', description: 'a meeting hall packed with villagers' }],
    },
  },
  {
    title: 'The Broken Promise', level: 'B1', email: 'qa+promise@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'friends', description: 'two friends and one broken promise' },
        { name: 'sister', description: 'a little sister caught in between' },
      ],
      places: [{ name: 'playground', description: 'an empty playground after rain' }],
    },
  },
  {
    title: 'The Talented Cook-Off', level: 'B1', email: 'qa+cookoff@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'contestants', description: 'rival street cooks with secret spices' },
        { name: 'host', description: 'a loud host with a microphone' },
      ],
      places: [{ name: 'square', description: 'a town square full of smoke' }],
    },
  },
  {
    title: 'An Expensive Lesson', level: 'B1', email: 'qa+expensive@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'buyer', description: 'a buyer of a too-cheap phone' },
        { name: 'seller', description: 'a seller already gone' },
      ],
      places: [{ name: 'market', description: 'a market of flashing gadgets' }],
    },
  },
  {
    title: 'The Helpful Stranger Network', level: 'B1', email: 'qa+network@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'organizer', description: 'a student organizing free tutoring' },
        { name: 'volunteers', description: 'volunteers with motorbikes and books' },
      ],
      places: [{ name: 'center', description: 'a borrowed community center' }],
    },
  },
  {
    title: 'The River Cleanup', level: 'B1', email: 'qa+cleanup@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'activist', description: 'a teen activist with gloves and bags' },
        { name: 'fishers', description: 'fishers tired of plastic nets' },
      ],
      places: [{ name: 'riverbank', description: 'a riverbank choked with bottles' }],
    },
  },
  {
    title: 'The Scholarship Letter', level: 'B1', email: 'qa+scholarship@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'applicant', description: 'a first-generation applicant' },
        { name: 'mentor', description: 'a teacher writing the reference' },
      ],
      places: [{ name: 'office', description: 'a school office with a slow printer' }],
    },
  },
  {
    title: 'The Night Shift', level: 'B1', email: 'qa+nightshift@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'guard', description: 'a lonely night guard with a radio' },
        { name: 'cat', description: 'a stray cat keeping him company' },
      ],
      places: [{ name: 'warehouse', description: 'a humming warehouse at 3am' }],
    },
  },
  {
    title: 'The Family Recipe Book', level: 'B1', email: 'qa+recipebook@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'daughter', description: 'a daughter recording fading recipes' },
        { name: 'grandma', description: 'a grandma who cooks by memory' },
      ],
      places: [{ name: 'kitchen', description: 'a kitchen smelling of lemongrass' }],
    },
  },
  {
    title: 'The Football Trial', level: 'B1', email: 'qa+trial@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'boy', description: 'a village boy at a city trial' },
        { name: 'scout', description: 'a scout with a clipboard' },
      ],
      places: [{ name: 'academy', description: 'a academy pitch with real grass' }],
    },
  },
  {
    title: 'The Honest Review', level: 'B1', email: 'qa+review@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'vlogger', description: 'a small vlogger offered cash for praise' },
        { name: 'owner', description: 'a restaurant owner awaiting the video' },
      ],
      places: [{ name: 'studio', description: 'a bedroom studio with ring light' }],
    },
  },
  {
    title: 'The English Club', level: 'B1', email: 'qa+engclub@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'founder', description: 'a shy founder with a big idea' },
        { name: 'members', description: 'five members meeting weekly' },
      ],
      places: [{ name: 'teashop', description: 'a corner teashop after class' }],
    },
  },
  {
    title: 'The Lost Luggage', level: 'B1', email: 'qa+luggage@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'traveler', description: 'a traveler with only a backpack' },
        { name: 'agent', description: 'an airport agent tracing the bag' },
      ],
      places: [{ name: 'airport', description: 'a small airport at midnight' }],
    },
  },
  {
    title: 'The Courageous Protest', level: 'B1', email: 'qa+protest@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'students', description: 'students marching for a library' },
        { name: 'principal', description: 'a principal watching from windows' },
      ],
      places: [{ name: 'gates', description: 'school gates lined with signs' }],
    },
  },
  {
    title: 'The Fixer Upper', level: 'B1', email: 'qa+fixer@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'couple', description: 'a young couple with a cheap house' },
        { name: 'uncle', description: 'an uncle who knows wiring' },
      ],
      places: [{ name: 'house', description: 'a sagging house full of plans' }],
    },
  },
  {
    title: 'The Generous Tip', level: 'B1', email: 'qa+tip@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'waitress', description: 'a waitress working double shifts' },
        { name: 'regular', description: 'a quiet regular leaving envelopes' },
      ],
      places: [{ name: 'diner', description: 'a late-night diner by the highway' }],
    },
  },
  {
    title: 'The Rainy Market Day', level: 'B1', email: 'qa+rainmarket@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'sellers', description: 'sellers covering stalls with tarps' },
        { name: 'shoppers', description: 'shoppers splashing between aisles' },
      ],
      places: [{ name: 'market', description: 'an open market in a storm' }],
    },
  },
  {
    title: 'The Library Volunteers', level: 'B1', email: 'qa+volunteers@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'retiree', description: 'a retiree shelving books daily' },
        { name: 'kids', description: 'kids earning reading badges' },
      ],
      places: [{ name: 'library', description: 'a village library in a stilt house' }],
    },
  },
  {
    title: 'The Tailor Apprentice', level: 'B1', email: 'qa+apprentice@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'apprentice', description: 'a clumsy apprentice with big dreams' },
        { name: 'master', description: 'a master tailor with no patience' },
      ],
      places: [{ name: 'workshop', description: 'a workshop of scissors and chalk' }],
    },
  },
  {
    title: 'The Honest Mechanic', level: 'B1', email: 'qa+mechanic@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'mechanic', description: 'a mechanic who shows every old part' },
        { name: 'driver', description: 'a driver expecting a huge bill' },
      ],
      places: [{ name: 'garage', description: 'an open garage full of engines' }],
    },
  },
  {
    title: 'The School Garden War', level: 'B1', email: 'qa+gardenwar@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'classes', description: 'two classes competing for best plot' },
        { name: 'judge', description: 'a judge with a measuring tape' },
      ],
      places: [{ name: 'garden', description: 'a school garden divided in two' }],
    },
  },
  {
    title: 'The Quiet Achiever', level: 'B1', email: 'qa+achiever@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'girl', description: 'a silent girl topping every exam' },
        { name: 'bullies', description: 'bullies who mock her silence' },
      ],
      places: [{ name: 'school', description: 'a competitive city school' }],
    },
  },
  {
    title: 'The Flooded Classroom', level: 'B1', email: 'qa+floodclass@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'students', description: 'students lifting desks onto tables' },
        { name: 'principal', description: 'a principal wading in with boots' },
      ],
      places: [{ name: 'classroom', description: 'a ground-floor classroom ankle-deep' }],
    },
  },
  {
    title: 'The Marathon Dream', level: 'B1', email: 'qa+marathon@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'runner', description: 'an old runner with bad knees' },
        { name: 'coach', description: 'his daughter coaching from a bike' },
      ],
      places: [{ name: 'route', description: 'a dawn route around the lake' }],
    },
  },
  {
    title: 'The Honest Scale', level: 'B1', email: 'qa+scale@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'vendor', description: 'a vendor famous for full kilos' },
        { name: 'rival', description: 'a rival with a rigged scale' },
      ],
      places: [{ name: 'market', description: 'a produce market at dawn' }],
    },
  },
  {
    title: 'The Pen Pal Project', level: 'B1', email: 'qa+penpal@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'students', description: 'students writing their first English letters' },
        { name: 'partners', description: 'partner students across the sea' },
      ],
      places: [{ name: 'postbox', description: 'a red postbox by the school gate' }],
    },
  },
  {
    title: 'The Courtyard Concert', level: 'B1', email: 'qa+concert@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'band', description: 'a teenage band with borrowed drums' },
        { name: 'neighbors', description: 'neighbors deciding to stay or complain' },
      ],
      places: [{ name: 'courtyard', description: 'an echoing apartment courtyard' }],
    },
  },
  {
    title: 'The Wise Bargain', level: 'B1', email: 'qa+bargain@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'buyer', description: 'a calm buyer who never rushes' },
        { name: 'sellers', description: 'sellers testing every opening price' },
      ],
      places: [{ name: 'bazaar', description: 'a sprawling weekend bazaar' }],
    },
  },
  {
    title: 'The River Detective', level: 'B2', email: 'qa+detective@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'inspector', description: 'a retired inspector with a notebook' },
        { name: 'smuggler', description: 'a charming smuggler of rare birds' },
      ],
      places: [{ name: 'delta', description: 'a misty delta of hidden channels' }],
    },
  },
  {
    title: 'The Scholarship Interview', level: 'B2', email: 'qa+interview@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'candidate', description: 'a candidate who freezes under pressure' },
        { name: 'panel', description: 'a panel of stern professors' },
      ],
      places: [{ name: 'boardroom', description: 'a silent boardroom with one clock' }],
    },
  },
  {
    title: 'The Crumbling Dam', level: 'B2', email: 'qa+dam@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'engineer', description: 'an engineer warning of cracks' },
        { name: 'mayor', description: 'a mayor fearing panic and costs' },
      ],
      places: [{ name: 'reservoir', description: 'an aging reservoir above the town' }],
    },
  },
  {
    title: 'The Translator Dilemma', level: 'B2', email: 'qa+translator@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'translator', description: 'a translator hearing an inconvenient truth' },
        { name: 'diplomat', description: 'a diplomat needing smooth words' },
      ],
      places: [{ name: 'summit', description: 'a tense summit in a glass hall' }],
    },
  },
  {
    title: 'The Vanishing Bees', level: 'B2', email: 'qa+bees@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'keeper', description: 'a beekeeper finding empty hives' },
        { name: 'scientist', description: 'a scientist tracing the pesticide' },
      ],
      places: [{ name: 'valley', description: 'a valley of silent orchards' }],
    },
  },
  {
    title: 'The Startup Gamble', level: 'B2', email: 'qa+startup@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'founders', description: 'two founders down to their last month' },
        { name: 'investor', description: 'an investor demanding impossible growth' },
      ],
      places: [{ name: 'garage', description: 'a rented garage full of prototypes' }],
    },
  },
  {
    title: 'The Monsoon Wedding', level: 'B2', email: 'qa+monsoon@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'couple', description: 'a couple marrying as the storm lands' },
        { name: 'planner', description: 'a planner salvaging the ceremony' },
      ],
      places: [{ name: 'resort', description: 'a beach resort under black clouds' }],
    },
  },
  {
    title: 'The Forged Painting', level: 'B2', email: 'qa+forgery@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'curator', description: 'a curator doubting her prize piece' },
        { name: 'forger', description: 'an aging forger seeking forgiveness' },
      ],
      places: [{ name: 'gallery', description: 'a quiet gallery before opening' }],
    },
  },
  {
    title: 'The Night Bus Confession', level: 'B2', email: 'qa+confession@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'strangers', description: 'two strangers sharing a long ride' },
        { name: 'driver', description: 'a driver pretending not to listen' },
      ],
      places: [{ name: 'highway', description: 'a dark highway between cities' }],
    },
  },
  {
    title: 'The Resilient Reef', level: 'B2', email: 'qa+reef@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'diver', description: 'a diver documenting bleached coral' },
        { name: 'fisher', description: 'a fisher adapting to new zones' },
      ],
      places: [{ name: 'reef', description: 'a fading reef with stubborn color' }],
    },
  },
  {
    title: 'The Last Ferryman Strike', level: 'B2', email: 'qa+strike@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'union', description: 'ferry workers voting at dawn' },
        { name: 'commuters', description: 'stranded commuters sharing boats' },
      ],
      places: [{ name: 'pier', description: 'an empty pier with tied boats' }],
    },
  },
  {
    title: 'The Seed Vault', level: 'B2', email: 'qa+seedvault@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'botanist', description: 'a botanist racing the drought' },
        { name: 'elder', description: 'an elder guarding heirloom seeds' },
      ],
      places: [{ name: 'vault', description: 'a cool vault under the mountain' }],
    },
  },
  {
    title: 'The Reluctant Heir', level: 'B2', email: 'qa+heir@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'heir', description: 'an heir who wants to be a teacher' },
        { name: 'family', description: 'a family empire needing a successor' },
      ],
      places: [{ name: 'estate', description: 'a sprawling estate with rules' }],
    },
  },
  {
    title: 'The Floating Clinic', level: 'B2', email: 'qa+clinic@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'doctor', description: 'a doctor sailing village to village' },
        { name: 'assistant', description: 'her assistant learning fast' },
      ],
      places: [{ name: 'riverboat', description: 'a converted riverboat clinic' }],
    },
  },
  {
    title: 'The Rival Noodle Kings', level: 'B2', email: 'qa+noodlekings@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'kings', description: 'two rival broth masters' },
        { name: 'critic', description: 'a feared critic with one review' },
      ],
      places: [{ name: 'alley', description: 'a legendary noodle alley' }],
    },
  },
  {
    title: 'The Evacuation Order', level: 'B2', email: 'qa+evacuation@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'officer', description: 'an officer ordering calm evacuation' },
        { name: 'grandma', description: 'a grandma refusing to leave her home' },
      ],
      places: [{ name: 'town', description: 'a coastal town under warning' }],
    },
  },
  {
    title: 'The Copycat Brand', level: 'B2', email: 'qa+copycat@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'artisan', description: 'an artisan finding fakes of her work' },
        { name: 'lawyer', description: 'a young lawyer taking the case free' },
      ],
      places: [{ name: 'bazaar', description: 'a bazaar flooded with copies' }],
    },
  },
  {
    title: 'The Midnight Census', level: 'B2', email: 'qa+census@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'counters', description: 'census workers knocking at midnight' },
        { name: 'residents', description: 'residents hiding unregistered kin' },
      ],
      places: [{ name: 'district', description: 'a dense district of narrow lanes' }],
    },
  },
  {
    title: 'The Drought Lottery', level: 'B2', email: 'qa+drought@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'farmers', description: 'farmers drawing water rations' },
        { name: 'official', description: 'an official with an impossible list' },
      ],
      places: [{ name: 'reservoir', description: 'a cracked reservoir bed' }],
    },
  },
  {
    title: 'The Apprentice Chef Betrayal', level: 'B2', email: 'qa+chefbetrayal@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'apprentice', description: 'an apprentice stealing the secret sauce' },
        { name: 'master', description: 'a master who taught him everything' },
      ],
      places: [{ name: 'kitchen', description: 'a famous kitchen before dawn' }],
    },
  },
  {
    title: 'The Hydropower Bargain', level: 'C1', email: 'qa+hydropower@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'minister', description: 'a minister trading rivers for roads' },
        { name: 'activist', description: 'an activist counting displaced villages' },
      ],
      places: [{ name: 'gorge', description: 'a gorge slated for concrete' }],
    },
  },
  {
    title: 'The Linguist Vanishing Point', level: 'C1', email: 'qa+linguist@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'linguist', description: 'a linguist recording the last speaker' },
        { name: 'elder', description: 'an elder who sings but will not translate' },
      ],
      places: [{ name: 'longhouse', description: 'a longhouse of forty doors' }],
    },
  },
  {
    title: 'The Microloan Domino', level: 'C1', email: 'qa+microloan@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'borrowers', description: 'a lending circle under pressure' },
        { name: 'officer', description: 'a loan officer with impossible targets' },
      ],
      places: [{ name: 'branch', description: 'a rural branch office' }],
    },
  },
  {
    title: 'The Mekong Data Cable', level: 'C1', email: 'qa+datacable@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'engineers', description: 'engineers laying fiber along the river' },
        { name: 'fishers', description: 'fishers fearing for their nets' },
      ],
      places: [{ name: 'river', description: 'a working river of boats and buoys' }],
    },
  },
  {
    title: 'The Examination Factory', level: 'C1', email: 'qa+examfactory@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'crammers', description: 'students drilled twelve hours a day' },
        { name: 'reformer', description: 'a reformer principal banning the drills' },
      ],
      places: [{ name: 'academy', description: 'a cram academy with barred windows' }],
    },
  },
  {
    title: 'The Heritage Listing Fight', level: 'C1', email: 'qa+heritage@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'preservationist', description: 'a preservationist fighting developers' },
        { name: 'developer', description: 'a developer promising jobs and malls' },
      ],
      places: [{ name: 'quarter', description: 'a crumbling colonial quarter' }],
    },
  },
  {
    title: 'The Remittance Economy', level: 'C1', email: 'qa+remittance@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'migrants', description: 'migrants wiring wages home monthly' },
        { name: 'families', description: 'families building houses with the money' },
      ],
      places: [{ name: 'counter', description: 'a transfer counter on payday' }],
    },
  },
  {
    title: 'The Algorithmic Hiring Gate', level: 'C1', email: 'qa+hiring@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'graduate', description: 'a graduate rejected by software' },
        { name: 'designer', description: 'the designer who built the filter' },
      ],
      places: [{ name: 'server', description: 'a server room humming at night' }],
    },
  },
  {
    title: 'The Slow Journalism Bet', level: 'C1', email: 'qa+slownews@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'editor', description: 'an editor refusing the outrage cycle' },
        { name: 'reader', description: 'a reader paying for depth' },
      ],
      places: [{ name: 'newsroom', description: 'a tiny newsroom above a noodle shop' }],
    },
  },
  {
    title: 'The Commons Pasture Pact', level: 'C1', email: 'qa+pasture@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'herders', description: 'herders negotiating grazing turns' },
        { name: 'mediator', description: 'a mediator with maps and patience' },
      ],
      places: [{ name: 'highlands', description: 'disputed highland pastures' }],
    },
  },
  {
    title: 'The Cartography of Silence', level: 'C2', email: 'qa+silence@example.com', tags: ['nouns'],
    cast: {
      characters: [
        { name: 'cartographer', description: 'a mapmaker charting unspoken borders' },
        { name: 'historian', description: 'a historian of erased villages' },
      ],
      places: [{ name: 'archive', description: 'a basement archive of contested maps' }],
    },
  },
  {
    title: 'The Philology Heist', level: 'C2', email: 'qa+philology@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'scholar', description: 'a scholar stealing back a manuscript' },
        { name: 'curator', description: 'a curator who bought it in good faith' },
      ],
      places: [{ name: 'vault', description: 'a private vault in a freeport' }],
    },
  },
  {
    title: 'The Decadent Dam Inquiry', level: 'C2', email: 'qa+inquiry@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'judge', description: 'a judge with subpoena power and doubts' },
        { name: 'witness', description: 'an engineer witness under protection' },
      ],
      places: [{ name: 'hearing', description: 'a hearing room of marble and microphones' }],
    },
  },
  {
    title: 'The Lexicon of Going Under', level: 'C2', email: 'qa+lexicon@example.com', tags: ['verbs'],
    cast: {
      characters: [
        { name: 'poet', description: 'a poet documenting a drowning dialect' },
        { name: 'developer', description: 'a developer draining the delta' },
      ],
      places: [{ name: 'estuary', description: 'a sinking estuary at equinox' }],
    },
  },
  {
    title: 'The Palimpsest City', level: 'C2', email: 'qa+palimpsest@example.com', tags: ['adjectives'],
    cast: {
      characters: [
        { name: 'planner', description: 'a planner peeling centuries of streets' },
        { name: 'resident', description: 'the last resident of the old quarter' },
      ],
      places: [{ name: 'quarter', description: 'a quarter slated for erasure' }],
    },
  },
];

// ---- provider guard: Baseten and Modal must stay out of this run ----
const devVars = existsSync('api/.dev.vars') ? readFileSync('api/.dev.vars', 'utf8') : '';
const has = (re) => re.test(devVars);
const basetenWired = has(/^BASETEN_API_URL=https?:\/\//m) && has(/^BASETEN_API_KEY=.+/m);
const modalWired = has(/^MODAL_IMAGE_API_URL=https?:\/\//m) && has(/^MODAL_PROXY_TOKEN=.+/m);
console.log(`providers: baseten=${basetenWired ? 'WIRED' : 'off'} modal=${modalWired ? 'WIRED' : 'off'} meta=on`);
if ((basetenWired || modalWired) && !ALLOW_WIRED) {
  console.error('\nRefusing: Baseten/Modal dev wiring is present. Remove it for a Meta-only cost run, or pass --allow-wired to measure with wired providers.');
  process.exit(1);
}
const QA_DIR = dirname(fileURLToPath(import.meta.url));
// Publish ledger: one entry per spec title. A partial (incomplete draft,
// failed publish, crashed run) stays in the ledger so the next run with
// --resume retries only what is not yet published.
function saveLedger(ledger) {
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}
const RESUME = flag('--resume');
// Sharding: split the 30-book run across parallel jobs. --shard i/n takes
// every book whose BOOKS index is congruent to i mod n, so shards are
// disjoint and together cover everything. OFFSET/LIMIT apply within the
// shard. Each shard gets its own ledger file by default (parallel jobs
// must not share one JSON file); qa/ledger.mjs merges them for status.
function parseShard(s) {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? '');
  if (!m) return null;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!(n >= 1 && i >= 0 && i < n)) throw new Error(`bad --shard ${s}: want i/n with 0 <= i < n`);
  return { i, n };
}
const SHARD = parseShard(opt('--shard', ''));
const LEDGER_DEFAULT = SHARD
  ? join(QA_DIR, `book-ledger-shard${SHARD.i}of${SHARD.n}.json`)
  : join(QA_DIR, 'book-ledger.json');
const LEDGER_PATH = process.env.BOOK_LEDGER ?? opt('--ledger', LEDGER_DEFAULT);
function loadLedger() {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return {};
  }
}
const ledger = loadLedger();
let QUEUE = SHARD ? BOOKS.filter((_, idx) => idx % SHARD.n === SHARD.i) : BOOKS.slice();
QUEUE = LIMIT > 0 ? QUEUE.slice(OFFSET, OFFSET + LIMIT) : QUEUE.slice(OFFSET);
const RETRY_STALLED = flag('--retry-stalled');
if (RESUME) {
  const before = QUEUE.length;
  QUEUE = QUEUE.filter((b) => {
    const st = ledger[b.title]?.status;
    if (st === 'published') return false;
    // Stalled books burned their full draft budget; leave them parked unless
    // explicitly requeued so a failed book never re-burns the whole run.
    if (st === 'stalled' && !RETRY_STALLED) return false;
    return true;
  });
  console.log(`--resume: skipping ${before - QUEUE.length} published/stalled books`);
}
if (SHARD) console.log(`--shard ${SHARD.i}/${SHARD.n}: ${QUEUE.length} books in this shard (ledger: ${LEDGER_PATH})`);
if (DRY) {
  console.log('\n--dry: plan only. Books that would be made:');
  for (const b of QUEUE) console.log(`  ${b.level}  ${b.title}  (${b.email}) [${ledger[b.title]?.status ?? 'new'}]`);
  process.exit(0);
}

let cookie = '';
// Overnight-proofing: a single dropped connection (proxy blip, worker
// redeploy) must not kill a whole shard run. Retry transient network
// failures with backoff; only give up loudly after 4 attempts.
async function fetchRetry(url, init) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fetch(url, init);
    } catch {
      if (attempt < 4) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  return null;
}
async function call(path, init = {}, email = '') {
  const headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetchRetry(`${API}${path}`, { ...init, headers });
  if (!res) {
    console.error(`\nCannot reach the API at ${API}. Start the dev stack first: ./run.sh dev`);
    process.exit(1);
  }
  if (res.status === 429) {
    console.error(`\nAI paused for ${email} (429): repeated failures or daily backstop. Resume retries it; switch users if one stays stuck.`);
    process.exit(1);
  }
  if (!res.ok) {
    // HTTP errors throw so the per-book catch ledger-marks the failure and
    // the run continues. Only an unreachable API or a spent daily cap
    // aborts the whole run (nothing else can proceed).
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function signIn(email) {
  cookie = '';
  const { devLink } = await call('/api/auth/request-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!devLink) {
    console.error('\nNo devLink returned. Is DEV_LINKS=true in api/wrangler.toml?');
    process.exit(1);
  }
  const verify = await fetchRetry(devLink, { redirect: 'manual' });
  const setCookies = verify.headers.getSetCookie?.() ?? [];
  const session = setCookies.map((c) => c.split(';')[0]).find((c) => c && !c.endsWith('='));
  if (!session) {
    console.error('\nVerify did not set a session cookie.');
    process.exit(1);
  }
  cookie = session;
}

const results = [];
async function tryGetProject(projectId) {
  // Raw fetch (not call): a 404 here just means "start fresh", it must
  // never abort the run. But a NETWORK failure must never read as 404 —
  // that would duplicate the project on retry. Throw so the per-book catch
  // ledger-marks it and the next --resume run tries again.
  const res = await fetchRetry(`${API}/api/projects/${projectId}`, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (!res) throw new Error(`GET /api/projects/${projectId} -> unreachable`);
  if (!res.ok) return null;
  return res.json();
}

for (const spec of QUEUE) {
  console.log(`\n=== ${spec.level}  ${spec.title} ===`);
  // One bad book never kills the run: partials land in the ledger and the
  // next --resume run continues the SAME project (no duplicate drafts).
  // Only an unreachable API or a 429 (daily AI cap) aborts.
  try {
  await signIn(spec.email);
  let project;
  let saved = [];
  let artDone = [];
  const prior = RESUME ? ledger[spec.title] : null;
  if (prior?.projectId) {
    const existing = await tryGetProject(prior.projectId);
    if (existing?.project) {
      project = existing.project;
      saved = [...new Set([...(existing.scenes ?? []).map((s) => s.scene_number), ...(prior.saved ?? [])])].sort((a, b) => a - b);
      artDone = prior.art ?? [];
      console.log(`resuming project ${project.id}: saved [${saved.join(',')}] art [${artDone.join(',')}]`);
    }
  }
  if (!project) {
    // Focus tags ride project creation now: the draft brief and the focus
    // gate both read them, so a tagged book is written to drill, not just
    // labeled. (Resume keeps the original project's tags.)
    const tags = spec.tags && spec.tags.length > 0 ? spec.tags : TAGS;
    const created = await call('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title: spec.title, level: spec.level, tags }),
    });
    project = created.project;
    console.log(`project ${project.id}`);
    await call(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cast_json: spec.cast }),
    });
    console.log('cast saved');
  }
  ledger[spec.title] = { status: 'partial', level: spec.level, projectId: project.id, saved, art: artDone };
  saveLedger(ledger);

  // Finish drafts all missing scenes; the level gate can reject individual
  // scenes, so retry until all 6 pass or we run out of patience. A short
  // draft never publishes (the server also 400s incomplete drafts).
  // Draft budget: at most 12 finish calls per book across ALL runs. A book
  // that keeps failing parks as 'stalled' instead of re-burning drafts on
  // every resume — requeue explicitly with --retry-stalled.
  const MAX_TRIES = 12;
  let tries = prior?.status === 'stalled' && RETRY_STALLED ? 0 : (prior?.tries ?? 0);
  let failed = [];
  for (let attempt = 1; saved.length < 6 && attempt <= 4 && tries < MAX_TRIES; attempt++) {
    tries++;
    const finish = await call('/api/ai/finish', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });
    saved = [...new Set([...saved, ...finish.saved])].sort((a, b) => a - b);
    failed = finish.failed ?? [];
    console.log(`finish try ${attempt} (lifetime ${tries}/${MAX_TRIES}): saved [${saved.join(',')}] failed ${JSON.stringify(failed)}`);
    if (saved.length >= 6) break;
  }
  const stalled = saved.length < 6 && tries >= MAX_TRIES;
  ledger[spec.title] = { status: stalled ? 'stalled' : 'partial', level: spec.level, projectId: project.id, saved, art: artDone, missing: failed, tries };
  saveLedger(ledger);
  if (saved.length < 6) {
    if (stalled) console.error(`STALLED ${spec.level} ${spec.title} after ${tries} draft tries — parked, use --retry-stalled to requeue`);
    else console.error(`partial draft for ${spec.level} ${spec.title}: saved [${saved.join(',')}] missing ${JSON.stringify(failed)} — ledgered, continuing`);
    continue;
  }

  // Art is per-scene idempotent but not free: skip scenes the ledger
  // already recorded, so retries only pay for what is missing.
  for (const n of saved) {
    if (artDone.includes(n)) {
      console.log(`art scene ${n}: already done, skipping`);
      continue;
    }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await call('/api/ai/art', {
          method: 'POST',
          body: JSON.stringify({ projectId: project.id, sceneNumber: n }),
        });
        ok = true;
      } catch (e) {
        console.log(`art scene ${n} try ${attempt} failed, retrying…`);
        if (attempt === 3) throw e;
      }
    }
    artDone = [...new Set([...artDone, n])].sort((a, b) => a - b);
    ledger[spec.title] = { status: 'partial', level: spec.level, projectId: project.id, saved, art: artDone, missing: failed };
    saveLedger(ledger);
    console.log(`art scene ${n}: ok`);
  }
  const scenes = saved;

  // Per-book focus tags win; the CLI --tags flag is the fallback for runs
  // where specs don't carry their own.
  const tags = spec.tags && spec.tags.length > 0 ? spec.tags : TAGS;
  const pub = await call(`/api/projects/${project.id}/publish`, {
    method: 'POST',
    body: tags.length > 0 ? JSON.stringify({ tags }) : undefined,
  });
  console.log(`published book ${pub.book.id}`);

  const costs = await call(`/api/admin/costs/book?projectId=${encodeURIComponent(project.id)}`);
  const providers = [...new Set((costs.attempts ?? []).map((a) => `${a.provider}/${a.task}`))];
  ledger[spec.title] = {
    status: 'published',
    level: spec.level,
    projectId: project.id,
    bookId: pub.book.id,
    saved,
    art: artDone,
    total: costs.totals.total,
    providers,
  };
  saveLedger(ledger);
  results.push({
    title: spec.title,
    level: spec.level,
    scenes: scenes.length,
    total: costs.totals.total,
    firstTry: costs.totals.first_try_cost,
    retries: costs.totals.retry_overhead,
    calls: (costs.attempts ?? []).length,
    providers,
    reader: `${FRONTEND}/read/${project.id}`,
  });
  } catch (e) {
    console.error(`FAILED ${spec.level} ${spec.title}: ${e instanceof Error ? e.message : e} — ledgered, continuing`);
    ledger[spec.title] = { ...(ledger[spec.title] ?? { level: spec.level }), status: 'failed', error: e instanceof Error ? e.message : String(e) };
    saveLedger(ledger);
  }
}

console.log('\n=== cost summary (ledger $; Baseten-side burn is on the Baseten dashboard) ===');
for (const r of results) {
  console.log(
    `${r.level}  ${r.title}: ${r.scenes} scenes, ${r.calls} calls, ` +
      `total $${r.total.toFixed(4)} (first-try $${r.firstTry.toFixed(4)}, retries $${r.retries.toFixed(4)})`,
  );
  console.log(`    providers seen: ${r.providers.join(', ') || 'none logged!'}`);
}
const partials = Object.entries(ledger).filter(([, v]) => v.status === 'partial');
const stalled = Object.entries(ledger).filter(([, v]) => v.status === 'stalled');
const failedBooks = Object.entries(ledger).filter(([, v]) => v.status === 'failed');
if (partials.length > 0) {
  console.log(`\npartial (${partials.length}) — rerun with --resume to retry:`);
  for (const [t, v] of partials) console.log(`  ${v.level}  ${t}  project ${v.projectId} saved [${(v.saved ?? []).join(',')}]`);
}
if (stalled.length > 0) {
  console.log(`\nstalled (${stalled.length}) — parked after full draft budget, requeue with --resume --retry-stalled:`);
  for (const [t, v] of stalled) console.log(`  ${v.level}  ${t}  tries ${v.tries ?? '?'} missing ${JSON.stringify(v.missing ?? [])}`);
}
if (failedBooks.length > 0) {
  console.log(`\nfailed (${failedBooks.length}) — inspect, then rerun with --resume:`);
  for (const [t, v] of failedBooks) console.log(`  ${v.level}  ${t}: ${(v.error ?? '').slice(0, 120)}`);
}
const grand = results.reduce((s, r) => s + r.total, 0);
console.log(`\ngrand total for ${results.length} books: $${grand.toFixed(4)}`);
console.log('\nreaders:');
for (const r of results) console.log(`  ${r.reader}`);
