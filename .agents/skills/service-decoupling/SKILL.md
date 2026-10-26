---
name: service-decoupling
description: Service-decoupling guardrails for the 3E app so AI models and providers can be swapped without touching app code. Apply when adding, replacing, or calling any model, API, or external service.
---

# Service decoupling — 3E guardrails

The app must never know which model or vendor sits behind a feature. Swap means editing one
adapter and one config entry — not hunting call sites.

## Rules

1. **Interfaces only:** the app calls `TextModel`, `ImageModel`, `SegmentModel`, `VisionModel`
   (see `Meta AI Hackathon/models.md`) — never a vendor SDK, model string, or fetch to a model
   API directly. New capability = new method on an interface, not a new import in app code.
2. **One adapter per provider:** each vendor/model family lives in exactly one adapter module
   (e.g. `adapters/meta-model-api.ts`, later `adapters/baseten.ts`, `adapters/modal.ts`).
   Vendor SDKs, base URLs, auth headers, and request/response shapes stay inside the adapter.
3. **Config-driven routing:** task → model mapping (draft/check/idea/meanings/simplify/safety →
   text model; scene_art → image; isolate → segment; validate → vision) and per-model prices
   (`PRICES`) live in one config module. Swapping a model = one config change + one adapter.
4. **Stable contracts:** adapters return the interface shape and nothing else. Normalize vendor
   differences (token counts, units, error codes) at the boundary so `ai_usage` logging, retry
   (`op_id` + `attempt`), and cost math never change when a model changes.
5. **No leakage:** model IDs, API keys, endpoint URLs, and vendor-specific options never appear
   outside the adapter + config. Grep must show each model string in exactly those two places.
6. **Swap-safe errors:** adapters throw one shared error type (retryable vs fatal). App-level
   retry logic (retry once, then surface) keys off that type, not vendor status codes.
7. **Additive extension:** a new provider adds a new adapter implementing the existing interface.
   Never fork app code paths per vendor (`if provider === ...` in app code is a violation).

## Quick self-check before finishing a change

- [ ] No vendor SDK import, model string, or model-API fetch outside adapter + config.
- [ ] New model wired only via config routing + (if new vendor) one new adapter.
- [ ] `ai_usage` fields (task, model, tokens, cost_usd, op_id, attempt) unchanged in shape.
- [ ] Retry/error behavior identical across the old and new backing model.
