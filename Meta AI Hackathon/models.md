# Models & API

> Source of truth: `rules.md`. The model map below is **verified (2026-10-26)**; the API base URL,
> JSON-mode support, and pricing still need confirming before you build.

## What the rules say

- Build with **Muse Spark, Glimmer, SAM 3** + anything on the Event page (incl. **Muse Code**,
  **Muse Image**, **Muse Voice Transcribe**, and open-weight **Muse Spark Open** / **Muse Glimmer**). (rules.md L13)
- **$150 Meta Model API credits**, 10-day window. (rules.md L15)
- Judging: **Use of Meta AI Tooling = 25%** — rewards going beyond a basic single-model call.

## Model → job map (verified 2026-10-26)

| Job | Model | Exact target string | Status |
|---|---|---|---|
| Story draft ("3E Finish") | Muse Spark | `muse-spark-1.3` (`muse-wonder-1.0` for harder) | 🟢 Verified |
| Level check / QA / meanings / simplify | Muse Spark | `muse-spark-1.3` | 🟢 Verified |
| Scene art | Muse Image | `muse-image-1.0` | 🟢 Verified |
| Character isolation / consistency | SAM 3.1 | `sam-3.1` | 🟢 Verified |
| Visual scene validation (optional) | Muse Spark (multimodal) | `muse-spark-1.3` | 🟢 Verified |
| Safety | — (no safety model on this API) | Muse Spark prompt check | ⚪ optional |
| Story draft / level check (cheap path, own Baseten credits) | Muse Glimmer (self-host) | config `GLIMMER_MODEL`, override via `BASETEN_MODEL` | 🟡 Self-host |
| Coding | Muse Code | CLI + Meta Cloud API | 🔴 Primary |

Notes:
- **Muse Spark is the text model; Muse Image is the image model.** Don't confuse the two.
- **Glimmer** and **Muse Spark Open** are open-weight (self-host) — not on Model API. Skip for MVP.
- There is **no Llama or Llama Guard on this API** — text is all `muse-spark-1.3`.
- **Muse Code** is the coding agent, powered by the same Model API (Muse Spark / Muse Wonder).

## Still to confirm (models are verified; these are not)

1. **API base URL + auth** (how the key is passed) for the Meta Model API.
2. **Structured output (JSON)** on `muse-spark-1.3` (draft/meanings need it — docs list "Structured output").
3. **Per-call pricing** (images/segmentation cost the most; text is cheap) — watch the $150.
4. **Credit Terms** PDF (rules.md L15).
5. Whether `sam-3.1` takes image URLs or base64 (pass **R2** URLs).

## Setup checklist (do now, before the 11 PM start)

- [ ] Confirm application accepted; pick **Startup** or **Indie** track.
- [ ] Claim the **$150 credits**; get the API key + base URL + docs.
- [x] Model IDs recorded (verified, table above).
- [ ] Confirm structured-output (JSON) support on `muse-spark-1.3`.

## Sources & licenses (MVP: none)

- **No external data sources.** Level checking uses a hand-written word list + `muse-spark-1.3`.
- Libraries (React/Vite/Hono) are MIT. The Meta Model API is under Meta terms ($150 credits).
- If we later add data, only allow MIT / Apache-2.0 / BSD / CC0 / CC-BY / CC-BY-SA — never "no
  license", CC-BY-NC, or proprietary lists (e.g. Oxford/Longman).

## Muse Code instructions

Paste this into each Muse Code session:

```
You are building "3E" for the Meta AI Global Hackathon (Oct 26 – Nov 4).
Read Meta AI Hackathon/PLAN.md and execute the Step I tell you, checking its items off as you go.
Do not copy source from the existing reference repo — use it as spec only.
```

## Meta Model API client spec (implement on Step 1–4)

Keep it provider-agnostic so image/segmentation can be stubbed if access is late. The app talks to AI
**only** through these — the rest of the app never calls a model directly. The `ai_usage` meter wraps
every call: each call gets an `op_id`, and a retry logs a new row with `attempt + 1` (same `op_id`) so
cost and retry overhead can be measured per book.

```ts
interface TextModel {
  generate(opts: {
    task: "draft" | "check" | "idea" | "meanings" | "simplify" | "safety";
    prompt: string;
    json?: boolean;             // structured output for draft/check/meanings
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

interface ImageModel {
  generate(opts: {
    prompt: string;
    referenceImage?: string;    // SAM 3.1 cutout for character consistency
    size?: { width: number; height: number };
  }): Promise<{ imageUrl: string }>;
}

interface SegmentModel {
  isolate(opts: { imageUrl: string; prompt: string }): Promise<{ maskUrl: string }>;
}

// visual validation (Muse Spark multimodal)
interface VisionModel {
  validate(opts: { imageUrl: string; scriptText: string }): Promise<{ passed: boolean; reason: string | null }>;
}
```

Task → model routing: `draft`/`check`/`idea`/`meanings`/`simplify`/`safety` → `muse-spark-1.3` ·
`ImageModel` → `muse-image-1.0` · `SegmentModel` → `sam-3.1` · `VisionModel` → `muse-spark-1.3` (multimodal).
