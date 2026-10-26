# Milestones (post-MVP, optional)

Things to do after the 10-day hackathon MVP ships. **Optional — only pursue if we get approved
credits.** Two self-hosting providers, two jobs — used **separately**:

| Provider | Job | Model |
|---|---|---|
| **Baseten** | LLM serving (text) | Muse Glimmer (open-weight, Apache 2.0) |
| **Modal** | GPU vision + batch | SAM 3.1 (open-weight) + image processing |

---

## Baseten — serve Muse Glimmer (text)

- **Why:** cut per-call text cost and stretch the $150 as we scale.
- **Model:** Muse Glimmer (open-weight, Apache 2.0).
- **Workload:** story drafting + CEFR reading-level checks (low-latency text inference).
- **Integration:** Cloudflare Worker → HTTP → Baseten endpoint → result back.

### Baseten application copy

**What are you building:**

> 3E is an AI webcomic creator for English learners — AI writes, illustrates, and
> automatically levels a story to the reader's exact CEFR reading level.

**How you'll use Baseten:**

> We use Baseten to serve Meta's open-weight text models as low-latency inference endpoints, so our
> story-generation cost doesn't scale with every comic we produce. As we scale, we self-host
> **Muse Glimmer** (open-weight, Apache 2.0) on Baseten for fast, cheap text generation — story
> drafting and CEFR reading-level checks — called over HTTP from our Cloudflare Worker. Baseten is our
> dedicated LLM-serving layer; vision and batch work runs on a separate GPU provider (Modal).

---

## Modal — SAM 3.1 + batch (vision)

- **Why:** run vision segmentation and batch image work on on-demand GPU instead of paying per-call.
- **Workload 1:** SAM 3.1 (open-weight) — segment/isolate the main character from each panel → transparent cutout reused across scenes.
- **Workload 2:** batch Python jobs — WebP compression + comic packaging.
- **Integration:** Cloudflare Worker → HTTP → Modal Python endpoint → result back.

### Modal application copy

**What are you building:**

> 3E is an AI webcomic creator for English learners — AI writes, illustrates, and
> automatically levels a story to the reader's exact CEFR reading level.

**How you'll use Modal:**

> We use Modal's serverless GPU to run Meta's open-weight vision models and batch image jobs. Two
> concrete workloads: (1) self-hosting **SAM 3.1** (open-weight) to segment and isolate the main
> character from each comic panel into a transparent cutout, reused across every scene for character
> consistency; and (2) batch Python jobs for WebP compression and comic packaging. Modal is our
> GPU/vision + batch layer; text generation runs on a separate LLM-serving provider (Baseten).
