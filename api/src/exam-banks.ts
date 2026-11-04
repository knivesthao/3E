import { A1, A2, B1, B2, easierLevels, stem, tokenize } from './levels';
import type { Level } from './levels';

// Exam banks, one per CEFR level. Every exam form is generated from these
// banks (rotating subsets), so there is exactly one exam per level and no
// separate exam entities to manage. A1 ids are frozen: saved attempts
// reference them for review.
export type ExamLevel = Extract<Level, 'A1' | 'A2' | 'B1' | 'B2'>;
export const EXAM_LEVELS: ExamLevel[] = ['A1', 'A2', 'B1', 'B2'];

export interface BankItem {
  id: string;
  part: 1 | 2 | 3 | 4;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  passage?: string;
}

type RawItem = [
  id: string,
  prompt: string,
  options: string[],
  answer: number,
  explanation: string,
  passage?: string,
];

function assemble(part: BankItem['part'], items: RawItem[]): BankItem[] {
  return items.map(([id, prompt, options, answer, explanation, passage]) => ({
    id,
    part,
    prompt,
    options,
    answer,
    explanation,
    ...(passage ? { passage } : {}),
  }));
}

// ---------- A1 (Cambridge A1 Movers task families) ----------
const A1_PART1: RawItem[] = [
  ['p1a', 'It says meow.', ['A cat', 'A dog', 'A bird', 'A fish'], 0, 'A cat says meow.'],
  ['p1b', 'You read it.', ['A house', 'A school', 'Water', 'A book'], 3, 'You read a book.'],
  ['p1c', 'It is hot and you see it in the day.', ['Rain', 'Water', 'A bird', 'The sun'], 3, 'The sun is hot and in the day sky.'],
  ['p1d', 'You drink it. It is in a glass.', ['Food', 'Water', 'A school', 'Rain'], 1, 'You drink water.'],
  ['p1e', 'It says woof. It runs.', ['A cat', 'A bird', 'A dog', 'A fish'], 2, 'A dog says woof.'],
  ['p1f', 'You live in it.', ['A school', 'A book', 'Water', 'A house'], 3, 'You live in a house.'],
];

const A1_STORY =
  'Anna has a small red cat. The cat is happy. In the morning, Anna and the cat run in the sun. ' +
  'The cat drinks water. At night, the cat is in the house. Anna is happy.';

const A1_PART2: RawItem[] = [
  ['p2a', 'The cat is big.', ['Yes', 'No'], 1, 'The story says: a small red cat.', A1_STORY],
  ['p2b', 'Anna and the cat run in the morning.', ['Yes', 'No'], 0, 'The story says: in the morning they run in the sun.', A1_STORY],
  ['p2c', 'The cat drinks milk.', ['Yes', 'No'], 1, 'The story says: the cat drinks water.', A1_STORY],
  ['p2d', 'At night, the cat is in the house.', ['Yes', 'No'], 0, 'The story says: at night the cat is in the house.', A1_STORY],
  ['p2e', 'Anna is sad.', ['Yes', 'No'], 1, 'The story says: Anna is happy.', A1_STORY],
  ['p2f', 'The cat is red.', ['Yes', 'No'], 0, 'The story says: a small red cat.', A1_STORY],
];

const A1_PART3: RawItem[] = [
  ['p3a', 'Hello! What is your name? ___', ['My name is Ana', 'It is blue', 'I am ten'], 0, '"My name is Ana" is good.'],
  ['p3b', 'Is this your book? No, ___.', ['it is not', 'I am ten', 'it is blue'], 0, '"No, it is not" is good.'],
  ['p3c', 'Where is the cat? ___.', ['It is in the house', 'It is blue', 'I am happy'], 0, '"It is in the house" is good.'],
  ['p3d', 'Do you like rain? No, ___.', ['I do not', 'it is hot', 'I am a boy'], 0, '"No, I do not" is good.'],
  ['p3e', 'How are you? ___.', ['I am happy', 'It is a dog', 'You are Sam'], 0, '"I am happy" is good.'],
  ['p3f', 'What color is the sun? ___.', ['It is yellow', 'It is a dog', 'I am ten'], 0, '"It is yellow" is good.'],
];

const A1_PART4: RawItem[] = [
  ['p4a', 'A ___ says meow.', ['dog', 'rain', 'sun', 'cat'], 3, 'A cat says meow.'],
  ['p4b', 'She ___ water every day.', ['eat', 'run', 'drinks', 'walk'], 2, 'With she: she drinks.'],
  ['p4c', 'They drink ___ every day.', ['rain', 'run', 'blue', 'water'], 3, 'They drink water.'],
  ['p4d', 'Hello! My name ___ Ana.', ['am', 'are', 'be', 'is'], 3, 'My name is Ana.'],
  ['p4e', 'I see ___ dogs. One and one.', ['three', 'blue', 'run', 'two'], 3, 'One and one is two.'],
  ['p4f', 'We ___ to school in the morning.', ['goes', 'went', 'is', 'go'], 3, 'With we: we go.'],
];

const A1_WORDS: Record<string, string[]> = {
  p1a: ['cat'], p1b: ['book'], p1c: ['sun'], p1d: ['water'], p1e: ['dog'], p1f: ['house'],
  p2a: ['big', 'small'], p2b: ['run', 'morning'], p2c: ['drink', 'water'],
  p2d: ['night', 'house'], p2e: ['sad', 'happy'], p2f: ['red'],
  p3a: ['name'], p3b: ['book'], p3c: ['house'], p3d: ['like'],
  p3e: ['happy'], p3f: ['yellow'],
  p4a: ['cat'], p4b: ['drink'], p4c: ['water'], p4d: ['name'],
  p4e: ['two', 'three'], p4f: ['go'],
};

// ---------- A2 (Cambridge KET task families: past time, going out, daily life) ----------
const A2_PART1: RawItem[] = [
  ['a2-p1a', 'You buy food here.', ['A market', 'A school', 'Water', 'A book'], 0, 'You buy food at a market.'],
  ['a2-p1b', 'It is cold, white, and falls in winter.', ['Rain', 'Snow', 'Sun', 'Wind'], 1, 'Snow is cold, white, and falls in winter.'],
  ['a2-p1c', 'You use it to open a door.', ['A key', 'A book', 'Water', 'A cat'], 0, 'You open a door with a key.'],
  ['a2-p1d', 'It can fly and it has wings.', ['A fish', 'A bird', 'A dog', 'A house'], 1, 'A bird can fly and has wings.'],
  ['a2-p1e', 'You wear it on your foot.', ['A shoe', 'A book', 'Water', 'A cat'], 0, 'You wear a shoe on your foot.'],
  ['a2-p1f', 'She works here. Sick people come here.', ['A school', 'A hospital', 'A shop', 'A park'], 1, 'Sick people go to a hospital.'],
];

const A2_STORY =
  'Tom lost his red kite on Saturday. He looked in the park and in the garden. ' +
  'His friend Lucy saw the kite in a tall tree. Tom was happy. They played with the kite all afternoon.';

const A2_PART2: RawItem[] = [
  ['a2-p2a', 'Tom lost his blue kite.', ['Yes', 'No'], 1, 'The story says: his red kite.', A2_STORY],
  ['a2-p2b', 'Tom looked in the park.', ['Yes', 'No'], 0, 'The story says: he looked in the park.', A2_STORY],
  ['a2-p2c', 'Lucy saw the kite in the garden.', ['Yes', 'No'], 1, 'The story says: Lucy saw it in a tall tree.', A2_STORY],
  ['a2-p2d', 'Tom was sad.', ['Yes', 'No'], 1, 'The story says: Tom was happy.', A2_STORY],
  ['a2-p2e', 'They played in the morning.', ['Yes', 'No'], 1, 'The story says: they played all afternoon.', A2_STORY],
  ['a2-p2f', 'The kite was in a tall tree.', ['Yes', 'No'], 0, 'The story says: the kite was in a tall tree.', A2_STORY],
];

const A2_PART3: RawItem[] = [
  ['a2-p3a', 'What did you do yesterday? ___.', ['I played football', 'It is blue', 'I am ten'], 0, '"I played football" is good.'],
  ['a2-p3b', 'Can you swim? Yes, ___.', ['I can', 'it is blue', 'I am ten'], 0, '"Yes, I can" is good.'],
  ['a2-p3c', 'Where were you? ___.', ['I was at home', 'It is hot', 'I like rain'], 0, '"I was at home" is good.'],
  ['a2-p3d', 'Would you like some tea? No, ___.', ['thank you', 'it is blue', 'I am ten'], 0, '"No, thank you" is good.'],
  ['a2-p3e', 'How was the film? ___.', ['It was great', 'It is a dog', 'I am happy'], 0, '"It was great" is good.'],
  ['a2-p3f', 'Whose bag is this? ___.', ['It is my bag', 'It is blue', 'I am ten'], 0, '"It is my bag" is good.'],
];

const A2_PART4: RawItem[] = [
  ['a2-p4a', 'Yesterday we ___ to the beach.', ['go', 'goes', 'went', 'going'], 2, 'Yesterday is past: we went.'],
  ['a2-p4b', 'She is ___ than her brother.', ['tall', 'taller', 'more tall', 'high'], 1, 'With than: she is taller.'],
  ['a2-p4c', 'They ___ TV now.', ['watch', 'watches', 'are watching', 'watched'], 2, 'Now needs watching: they are watching.'],
  ['a2-p4d', 'I have been here ___ 2019.', ['for', 'since', 'from', 'at'], 1, 'Use since with a year: since 2019.'],
  ['a2-p4e', 'There is ___ milk in the fridge.', ['many', 'a few', 'a little', 'few'], 2, 'Use a little with milk: a little milk.'],
  ['a2-p4f', 'He ___ his homework every evening.', ['do', 'does', 'doing', 'done'], 1, 'With he, the word is does.'],
];

const A2_WORDS: Record<string, string[]> = {
  'a2-p1a': ['market'], 'a2-p1b': ['snow', 'winter'], 'a2-p1c': ['key'],
  'a2-p1d': ['fly', 'wing'], 'a2-p1e': ['shoe', 'foot'], 'a2-p1f': ['hospital', 'sick'],
  'a2-p2a': ['lose', 'blue'], 'a2-p2b': ['look', 'park'], 'a2-p2c': ['see', 'garden'],
  'a2-p2d': ['sad'], 'a2-p2e': ['play', 'morning', 'afternoon'], 'a2-p2f': ['tall', 'tree'],
  'a2-p3a': ['play', 'football', 'yesterday'], 'a2-p3b': ['swim'], 'a2-p3c': ['home'],
  'a2-p3d': ['tea', 'thank'], 'a2-p3e': ['film', 'great'], 'a2-p3f': ['bag'],
  'a2-p4a': ['go', 'beach', 'yesterday'], 'a2-p4b': ['tall', 'brother'], 'a2-p4c': ['watch', 'now'],
  'a2-p4d': ['been', 'since'], 'a2-p4e': ['milk', 'fridge', 'little'], 'a2-p4f': ['homework', 'evening'],
};

// ---------- B1 (Cambridge PET task families: synonyms, longer texts, everyday talk) ----------
const B1_PART1: RawItem[] = [
  ['b1-p1a', 'It means almost the same as "happy".', ['Glad', 'Sad', 'Angry', 'Tired'], 0, 'Glad means almost the same as happy.'],
  ['b1-p1b', 'You do this when you want to know something.', ['Answer', 'Ask', 'Tell', 'Call'], 1, 'You ask when you want to know something.'],
  ['b1-p1c', 'It is the opposite of "easy".', ['Difficult', 'Soft', 'Slow', 'Late'], 0, 'Difficult is the opposite of easy.'],
  ['b1-p1d', 'A short trip for fun.', ['A holiday', 'A test', 'A meal', 'A job'], 0, 'A holiday is a short trip for fun.'],
  ['b1-p1e', 'To get better after being sick.', ['To hurt', 'To recover', 'To rest', 'To wait'], 1, 'To recover means to get better after being sick.'],
  ['b1-p1f', 'It tells you what time it is.', ['A clock', 'A book', 'A key', 'A map'], 0, 'A clock tells you what time it is.'],
];

const B1_STORY =
  'Lucy wants to be a nurse. Last year she started a course at the city college. ' +
  'The lessons are difficult, but her teachers help her a lot. In the evenings she reads her books and studies. ' +
  'Next summer she will work at the hospital for two months. She is excited about helping real patients.';

const B1_PART2: RawItem[] = [
  ['b1-p2a', 'Lucy wants to be a teacher.', ['Yes', 'No'], 1, 'The story says: Lucy wants to be a nurse.', B1_STORY],
  ['b1-p2b', 'Her lessons are easy.', ['Yes', 'No'], 1, 'The story says: the lessons are difficult.', B1_STORY],
  ['b1-p2c', 'She studies in the evenings.', ['Yes', 'No'], 0, 'The story says: in the evenings she reads her books.', B1_STORY],
  ['b1-p2d', 'Next summer she will work at a school.', ['Yes', 'No'], 1, 'The story says: she will work at the hospital.', B1_STORY],
  ['b1-p2e', 'Her teachers help her.', ['Yes', 'No'], 0, 'The story says: her teachers help her a lot.', B1_STORY],
  ['b1-p2f', 'She is excited.', ['Yes', 'No'], 0, 'The story says: she is excited about helping real patients.', B1_STORY],
];

const B1_PART3: RawItem[] = [
  ['b1-p3a', 'I have lost my keys. ___.', ['I will help you look', 'It is blue', 'I am hungry'], 0, '"I will help you look" is right.'],
  ['b1-p3b', 'Have you finished? Not ___.', ['yet', 'now', 'here'], 0, '"Not yet" means it is not finished.'],
  ['b1-p3c', 'I have been here since 2020. ___.', ['That is a long time', 'It is blue', 'I am ten'], 0, '"That is a long time" goes with since.'],
  ['b1-p3d', 'Would you like some help? ___.', ['Yes, please', 'It is blue', 'I am ten'], 0, '"Yes, please" is right.'],
  ['b1-p3e', 'The film was boring. ___.', ['I left early', 'It is blue', 'I like it'], 0, '"I left early" is right for boring.'],
  ['b1-p3f', 'I am sorry I am late. ___.', ['That is all right', 'It is blue', 'I am ten'], 0, '"That is all right" accepts the sorry.'],
];

const B1_PART4: RawItem[] = [
  ['b1-p4a', 'She has been here ___ five years.', ['since', 'for', 'from', 'at'], 1, 'Use for with a length of time: for five years.'],
  ['b1-p4b', 'If it rains, we ___ at home.', ['stay', 'stays', 'will stay', 'stayed'], 2, 'After if with will: we will stay.'],
  ['b1-p4c', 'The room ___ every day.', ['cleans', 'is cleaned', 'cleaned', 'cleaning'], 1, 'The room can not clean: it is cleaned.'],
  ['b1-p4d', 'He is interested ___ music.', ['in', 'on', 'at', 'for'], 0, 'Use in: interested in.'],
  ['b1-p4e', 'There were ___ people at the party.', ['much', 'many', 'a little', 'less'], 1, 'Use many with people: many people.'],
  ['b1-p4f', 'She asked me where ___.', ['I worked', 'did I work', 'I work', 'do I work'], 0, 'After asked, the order stays straight.'],
];

const B1_WORDS: Record<string, string[]> = {
  'b1-p1a': ['glad', 'happy', 'almost'], 'b1-p1b': ['ask', 'answer'], 'b1-p1c': ['difficult', 'easy', 'opposite'],
  'b1-p1d': ['holiday', 'trip', 'fun'], 'b1-p1e': ['recover', 'sick', 'better'], 'b1-p1f': ['clock', 'time'],
  'b1-p2a': ['nurse', 'teacher'], 'b1-p2b': ['lesson', 'easy', 'difficult'], 'b1-p2c': ['study', 'evening', 'read'],
  'b1-p2d': ['summer', 'work', 'school', 'hospital'], 'b1-p2e': ['teacher', 'help'], 'b1-p2f': ['excite'],
  'b1-p3a': ['lose', 'key', 'help'], 'b1-p3b': ['finish', 'yet'], 'b1-p3c': ['been', 'since', 'long', 'time'],
  'b1-p3d': ['help', 'please'], 'b1-p3e': ['film', 'boring', 'leave', 'early'], 'b1-p3f': ['sorry', 'late', 'right'],
  'b1-p4a': ['been', 'year', 'since', 'for'], 'b1-p4b': ['rain', 'stay', 'home'], 'b1-p4c': ['room', 'clean', 'every', 'day'],
  'b1-p4d': ['interest', 'music'], 'b1-p4e': ['people', 'party', 'many'], 'b1-p4f': ['ask', 'work'],
};

// ---------- B2 (Cambridge FCE task families: collocations, long texts, complex grammar) ----------
const B2_PART1: RawItem[] = [
  ['b2-p1a', 'To "take part in" something means to ___.', ['watch it', 'join in', 'leave it', 'forget it'], 1, 'To take part means to join in.'],
  ['b2-p1b', 'A "deadline" is ___.', ['a boring book', 'the time to finish by', 'a loud noise', 'a long trip'], 1, 'A deadline is the time to finish by.'],
  ['b2-p1c', '"Rarely" means ___.', ['often', 'almost never', 'always', 'sometimes'], 1, 'Rarely means almost never.'],
  ['b2-p1d', 'If you "run out of" time, you ___.', ['have no time left', 'have lots of time', 'lose time', 'waste time'], 0, 'To run out of time means to have no time left.'],
  ['b2-p1e', '"Reliable" is one who ___.', ['you can trust', 'you never met', 'you dislike', 'you envy'], 0, 'Reliable is one you can trust.'],
  ['b2-p1f', 'To "look forward to" something means you ___.', ['dread it', 'feel excited about it', 'forget it', 'regret it'], 1, 'To look forward to something means to feel excited about it.'],
];

const B2_STORY =
  'Ben had always dreamed of crossing the desert by bicycle. Last spring he finally left with two friends. ' +
  'The first week was very hard: the hot sun slowed them down and the wind covered their food with sand. ' +
  'Twice they had to stop and repair a broken wheel. But every evening, as the sun went down, they were together and laughed about the day. ' +
  'Ben says it was the best month of his life.';

const B2_PART2: RawItem[] = [
  ['b2-p2a', 'Ben crossed the desert alone.', ['Yes', 'No'], 1, 'The story says: he left with two friends.', B2_STORY],
  ['b2-p2b', 'The first week was very easy.', ['Yes', 'No'], 1, 'The story says: the first week was very hard.', B2_STORY],
  ['b2-p2c', 'They had to repair a wheel twice.', ['Yes', 'No'], 0, 'The story says: twice they had to stop and repair a broken wheel.', B2_STORY],
  ['b2-p2d', 'The wind covered their food with sand.', ['Yes', 'No'], 0, 'The story says: the wind covered their food with sand.', B2_STORY],
  ['b2-p2e', 'In the evenings they were sad about the day.', ['Yes', 'No'], 1, 'The story says: they were together and laughed about the day.', B2_STORY],
  ['b2-p2f', 'Ben says it was the best month of his life.', ['Yes', 'No'], 0, 'The story says: it was the best month of his life.', B2_STORY],
];

const B2_PART3: RawItem[] = [
  ['b2-p3a', 'You look tired. ___.', ['I have been working all day', 'It is blue', 'I like tea'], 0, '"I have been working all day" explains looking tired.'],
  ['b2-p3b', 'It is hard to decide. ___.', ['Take your time', 'It is blue', 'Go away'], 0, '"Take your time" helps decide.'],
  ['b2-p3c', 'I failed the test. ___.', ['Better luck next time', 'It is blue', 'Try again'], 0, '"Better luck next time" is right.'],
  ['b2-p3d', 'I will think about it and ___.', ['let you know', 'it is blue', 'forget it'], 0, '"Let you know" finishes will think about it.'],
  ['b2-p3e', 'I have no money. ___.', ['Then I will pay', 'It is blue', 'I agree'], 0, '"Then I will pay" answers have no money.'],
  ['b2-p3f', 'She has been crying. ___.', ['What is wrong with her', 'It is blue', 'She is happy'], 0, '"What is wrong with her" answers has been crying.'],
];

const B2_PART4: RawItem[] = [
  ['b2-p4a', 'By the time we arrived, the film ___.', ['already started', 'had already started', 'has already started', 'already starts'], 1, 'Past of arrive: had already started.'],
  ['b2-p4b', 'If I ___ more time, I would learn Arabic.', ['have', 'had', 'will have', 'would have'], 1, 'Would learn with had: if I had.'],
  ['b2-p4c', 'She sings ___ than anyone in her class.', ['good', 'better', 'best', 'well'], 1, 'Use better with than: sings better.'],
  ['b2-p4d', 'He denied ___ the window.', ['to break', 'break', 'breaking', 'broke'], 2, 'Deny with breaking: denied breaking.'],
  ['b2-p4e', '___ it rained, the match went on.', ['Despite', 'Although', 'So', 'Because'], 1, 'With it rained, use although: although it rained.'],
  ['b2-p4f', 'He is used ___ hard.', ['to work', 'to working', 'for work', 'work'], 1, 'Used with to: used to working.'],
];

const B2_WORDS: Record<string, string[]> = {
  'b2-p1a': ['join'], 'b2-p1b': ['deadline', 'finish', 'must'], 'b2-p1c': ['rarely', 'never'],
  'b2-p1d': ['run', 'time', 'left'], 'b2-p1e': ['reliable', 'trust'], 'b2-p1f': ['forward', 'excite', 'feel'],
  'b2-p2a': ['cross', 'desert', 'alone', 'friend'], 'b2-p2b': ['week', 'easy', 'hard'], 'b2-p2c': ['repair', 'wheel', 'broken', 'stop'],
  'b2-p2d': ['wind', 'cover', 'food', 'sand'], 'b2-p2e': ['evening', 'argue', 'laugh', 'day'], 'b2-p2f': ['good', 'month', 'life'],
  'b2-p3a': ['tire', 'work', 'day'], 'b2-p3b': ['decide', 'take', 'time'], 'b2-p3c': ['fail', 'test', 'luck', 'next', 'time'],
  'b2-p3d': ['think', 'let', 'know'], 'b2-p3e': ['money', 'pay'], 'b2-p3f': ['cry', 'wrong'],
  'b2-p4a': ['arrive', 'film', 'already', 'start'], 'b2-p4b': ['time', 'learn'], 'b2-p4c': ['sing', 'good', 'class'],
  'b2-p4d': ['deny', 'break', 'window'], 'b2-p4e': ['rain', 'match', 'continue', 'although'], 'b2-p4f': ['use', 'work'],
};

// ---------- assembly ----------
export const BANKS: Record<ExamLevel, BankItem[]> = {
  A1: [...assemble(1, A1_PART1), ...assemble(2, A1_PART2), ...assemble(3, A1_PART3), ...assemble(4, A1_PART4)],
  A2: [...assemble(1, A2_PART1), ...assemble(2, A2_PART2), ...assemble(3, A2_PART3), ...assemble(4, A2_PART4)],
  B1: [...assemble(1, B1_PART1), ...assemble(2, B1_PART2), ...assemble(3, B1_PART3), ...assemble(4, B1_PART4)],
  B2: [...assemble(1, B2_PART1), ...assemble(2, B2_PART2), ...assemble(3, B2_PART3), ...assemble(4, B2_PART4)],
};

export const BANK_WORDS: Record<ExamLevel, Record<string, string[]>> = {
  A1: A1_WORDS,
  A2: A2_WORDS,
  B1: B1_WORDS,
  B2: B2_WORDS,
};

// Proper nouns and borrowed words the level lists do not carry.
export const BANK_EXTRA_WORDS: Record<ExamLevel, string[]> = {
  A1: ['anna', 'ana', 'sam', 'sky', 'glass', 'live', 'story', 'color', 'every'],
  A2: ['tom', 'lucy', 'football', 'key', 'wing', 'wear', 'foot', 'hospital', 'park', 'saturday', 'garden', 'saw', 'afternoon', 'beach', 'past', 'tv', 'been', 'since', 'fridge', 'homework', 'done', 'tea', 'thank', 'bag', 'whose', 'film', 'great', 'taller', 'than', 'brother', 'lose'],
  B1: ['lucy', 'something', 'ask', 'answer', 'tell', 'call', 'same', 'as', 'soft', 'late', 'holiday', 'key', 'map', 'film', 'teacher', 'city', 'lot', 'next', 'since', 'if', 'been'],
  B2: ['ben', 'arabic', 'something', 'rarely', 'sometimes', 'if', 'out', 'lot', 'first', 'life', 'sand', 'as', 'been', 'tea', 'think', 'luck', 'next', 'than', 'past', 'deny', 'denied', 'arrive', 'arrived'],
};

// Every content token of an item: prompt, options, passage, explanation.
export function itemText(item: BankItem): string {
  return [item.prompt, ...item.options, item.passage ?? '', item.explanation].join(' ');
}

// Allowed vocabulary for a level: its list plus all easier lists,
// stemmed like the gate, plus that bank's extra words.
export function allowedVocabulary(level: ExamLevel): Set<string> {
  const lists: Record<ExamLevel, string[]> = { A1, A2, B1, B2 };
  const set = new Set<string>();
  for (const l of easierLevels(level)) {
    for (const w of lists[l as ExamLevel] ?? []) set.add(w);
  }
  for (const w of BANK_EXTRA_WORDS[level]) set.add(w);
  return set;
}

export function unknownItemWords(level: ExamLevel, item: BankItem): string[] {
  const allowed = allowedVocabulary(level);
  const unknown: string[] = [];
  for (const token of tokenize(itemText(item))) {
    if (!allowed.has(token) && !allowed.has(stem(token)) && !unknown.includes(token)) {
      unknown.push(token);
    }
  }
  return unknown;
}
