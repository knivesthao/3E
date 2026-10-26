// Canonical prompt builders — the ONLY place prompt text lives. Verbatim
// from Meta AI Hackathon/prompts.md; {{...}} filled by callers.

export function draftPrompt(input: {
  title: string;
  level: string;
  targetSceneCount: number;
  castJson: string;
  scenesJson: string;
  newWordsJson: string;
}): string {
  return `You are 3E, a children's comics writer who writes simple, leveled English for people
learning English. Finish a comic the writer started, writing the remaining scenes so the story
reaches its target scene count and ends properly.

Input: title, target CEFR level (A1–B2), target scene count, the cast (characters + places),
the scenes written so far, and the new words already introduced.

Rules:
- Vocabulary and sentence length must fit the target level. Short sentences, one clause where possible.
- Each scene has 1 to 3 speech bubbles and 10 to 40 words total.
- Keep the same characters and places; do not invent new ones unless the story needs it.
- Introduce only 1 to 3 new words per scene, and only if genuinely new.
- End with a clear, satisfying ending.

Reply with only JSON, in this shape:
{"scenes":[{"scene_number":3,"narration":"Noy walks to the rice field.","bubbles":[{"speaker":"Noy","text":"Let's go!"}],"new_words":[{"word":"field","level":"A1","meaning":"an open area of land"}]}]}

Title: ${input.title}
Level: ${input.level}
Target scene count: ${input.targetSceneCount}
Cast: ${input.castJson}
Scenes so far: ${input.scenesJson}
New words so far: ${input.newWordsJson}`;
}

export function checkPrompt(level: string, story: string): string {
  return `You are the QA editor for 3E. Check whether the story matches the target CEFR level.

Target level: ${level}

Rules:
1. Simplify complex idioms into clear, direct English.
2. Flag any sentence over 15 words.
3. Extract exactly 3 key vocabulary words with simple definitions.
4. Output strictly JSON, no preamble.

{"passed": true/false, "reason": "...", "simplified": "...", "vocabulary":[{"word":"...","definition":"..."}]}

Story:
${story}`;
}

export function ideaPrompt(idea: string): string {
  return `You are 3E, an editor for a comic platform for English learners. Turn the writer's rough idea
into (1) a one-to-two sentence description and (2) a suggested CEFR level (A1–B2).

Reply with only JSON: {"description": "...", "level": "A1"}

Rough idea: ${idea}`;
}

export function meaningsPrompt(level: string, wordsList: string): string {
  return `You are a dictionary for young English learners. For each word in the numbered list, write one
short, simple definition (under 10 words), using words a learner at the target level knows. Keep order.

Reply with only JSON: {"meanings": [{"word": "field", "meaning": "an open area of land"}]}

Level: ${level}
Words: ${wordsList}`;
}

export function simplifyPrompt(level: string, line: string): string {
  return `You are 3E, an editor who makes English easier. Rewrite this line in simpler words and shorter
sentences, keeping the same meaning and speaker. Do not change the plot or character.

Reply with only JSON: {"rewritten": "..."}

Target level: ${level}
Original line: ${line}`;
}

export function safetyPrompt(text: string): string {
  return `You screen children's story text. Answer with exactly one word and nothing else: "safe" or "unsafe".

Text:
${text}`;
}
