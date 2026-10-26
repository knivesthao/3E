---
name: secure-coding
description: Secure-coding guardrails for the 3E app (React + Vite + TS, Hono on Cloudflare Workers, D1, R2, Meta Model API). Apply on every change that touches auth, API routes, DB queries, user input, secrets, or AI calls. Guards against the OWASP Top 10.
---

# Secure coding — 3E guardrails

Applies to every change involving auth, API routes, DB, user input, secrets, or AI calls.
Fix a violation in the same change — never leave a known hole for later.

## Rules

1. **Injection (A03):** D1 only via parameterized queries or placeholders. Never interpolate
   user input into SQL. Validate + type-check every input at the Worker boundary.
2. **AuthN / session (A07):** magic-link tokens stored as hashes only, single-use, short expiry.
   Session cookies are HttpOnly, Secure, SameSite=Lax. Gate **all** routes behind a valid session.
3. **Access control (A01):** owner-only writes; publish is explicit + gated. Check
   `session.user_id` === resource owner on every mutating endpoint. No client-supplied user IDs.
4. **XSS (A03):** React default escaping only — no `dangerouslySetInnerHTML`, no raw HTML strings
   from users or models. Sanitize anything rendered from AI output.
5. **Secrets (A02):** `MODEL_API_KEY` lives as a Worker secret only. No keys, tokens, or session
   IDs in code, logs, error messages, or client bundles. No PII in logs.
6. **Rate limiting (A04/A07):** per-user daily cap on every AI endpoint; return 429 over cap.
   AI calls go through the Worker only — the frontend never calls the model API directly.
7. **SSRF / file handling (A01/A10):** fetch only allow-listed hosts (model API, R2). Validate
   image/URL inputs; store uploads in R2, never on the Worker filesystem. Serve with safe
   content types; no user-controlled redirects.
8. **AI output (injection via model):** validate every AI JSON response against its schema before
   use; retry once, then surface the error. Images from the fixed template only, never model or
   user free-text. Treat model text as untrusted input (rules 1 + 4 apply).
9. **Dependencies (A06):** MIT/Apache-2.0/BSD/CC0/CC-BY only. Pin versions; `npm audit` clean on
   Step 1 and before submit. No new network-facing dependency without a reason.
10. **Errors / availability (A04/A09):** generic error messages to clients; details server-side
    only. Bounded retries (max 2), timeouts on every outbound fetch, chunked scene loading.

## Quick self-check before finishing a change

- [ ] Inputs validated server-side; no string-built SQL.
- [ ] Auth checked; owner checked on mutations.
- [ ] No secrets/PII in code, logs, or client output.
- [ ] AI JSON schema-validated; AI text escaped on render.
