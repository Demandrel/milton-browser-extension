# Story BE-4: Auth Migration — Shared MILTON_KEY → Connector-Issued JWT

Status: ready-for-dev
Origin: TS-6 + 18-15 introduce per-user JWT auth; BE-4 migrates the extension off the shared key
Depends on: 18-15 (connector exposes `/auth/issue-token`) AND TS-6 (server expects EdDSA JWT bearer)

## Story

As Pierre dogfooding the Milton browser extension and preparing for public Chrome Web Store distribution,
I want the extension to fetch a short-lived per-device JWT from Milton's local connector for every translation request and present it as a bearer token to `translate.milton.so`,
so that the extension no longer ships a shared `MILTON_KEY` (which becomes effectively public on distribution) and is instead authenticated as the currently signed-in Milton user with their plan tier.

## Background

BE-1 ships with `VITE_MILTON_KEY` baked into the .crx bundle, sent as the `X-Milton-Key` header to `translate.milton.so/web`. After TS-6 deploys, the server stops accepting `X-Milton-Key` entirely (hard cutover). The extension must instead:

1. Verify Milton is running + signed in (existing `/health` probe)
2. Fetch a JWT from `POST /auth/issue-token` on the local connector
3. Send `Authorization: Bearer <jwt>` to `https://translate.milton.so/web`
4. Handle the new error contract (401 `device_not_registered`, 402 `quota_exceeded`, 402 `tier_required`, 503 `key_lookup_unavailable`)
5. Renew tokens transparently — JWTs have a 30-second TTL, so each save action fetches a fresh one

This story is the **extension side** of the four-story coordinated change (see 18-15 for the cross-story map).

## Acceptance Criteria

**AC1 — `MILTON_KEY` removed from the extension build**
- `VITE_MILTON_KEY` removed from `tools/browser-extension/.env.local.example`
- All references to `MILTON_KEY` / `X-Milton-Key` removed from `src/lib/translation-client.ts` (or wherever the header is currently set)
- Build with no `.env.local`: succeeds (no env-var reference fails the build)
- Built `dist/` bundle, when grepped for `MILTON_KEY`: zero matches

**AC2 — Token fetched from Milton connector before each translation call**
- New module `tools/browser-extension/src/lib/auth-client.ts`:
  ```ts
  export async function fetchTranslationToken(): Promise<string> {
    const res = await fetch('http://127.0.0.1:7521/auth/issue-token', {
      method: 'POST',
      // No body needed; connector reads its active_user state
    });
    if (!res.ok) throw new TokenFetchError(res.status, await res.text());
    const { token } = await res.json();
    return token;
  }
  ```
- `translation-client.ts` calls `fetchTranslationToken()` immediately before each translate request
- The fetched token is **not cached across calls** — a fresh fetch happens for each save (token TTL is 30s; cost of round-trip to localhost is negligible)
- **Atypical input:** connector returns 401 (signed out) → translation-client throws `SignedOutError`; popup catches and renders "Sign in to Milton" state
- **Atypical input:** connector returns 403 (origin rejected) → translation-client throws `OriginRejectedError`; popup logs and renders generic error (this case means the extension's chrome-extension ID isn't in Milton's allowlist — only happens during dev or after Web Store ID change)
- **Atypical input:** connector returns 429 (token-mint rate limit hit) → throws `RateLimitedError` with retry-after; popup shows "Too many requests, wait Ns"

**AC3 — Bearer token sent to `translate.milton.so`**
- `translation-client.ts` sends `Authorization: Bearer <token>` instead of `X-Milton-Key: <key>`
- `Content-Type: text/plain` and request body unchanged (URL string)
- CORS-preflight remains under TS-6's allowlist (`Authorization` header is in the new allow-list)
- **Atypical input:** server returns 401 `expired` → fetch a fresh token and retry **once**. If the retry also fails, throw to the popup (something is wrong beyond a stale token).

**AC4 — Structured error handling for new server contract**
- 401 with `error: "unauthorized"`:
  - `reason: "expired"` → silent retry once with fresh token
  - `reason: "device_not_registered"` → "Sign out and back in to Milton" prompt (device row missing in Supabase)
  - other reasons → generic "Authentication failed, try again"
- 402 with `error: "quota_exceeded"`:
  - Render: *"Free quota reached. Next slot in {next_reset_seconds humanized}, or upgrade for unlimited."*
  - Show upgrade CTA (link to `https://milton.so/upgrade`)
- 402 with `error: "tier_required"`:
  - (Only relevant once `/ai/*` exists; BE-4 builds the dispatch but no /ai routes are called yet)
  - Render: *"This feature requires the {required_tiers[0]} plan or higher."*
- 503 with `error: "service_unavailable"`:
  - Render: *"Translation service is temporarily unavailable. Try again in {Retry-After}s."*

**AC5 — Health probe unchanged + 4-state popup matrix**
- Existing `GET /health` probe pattern (BE-1) is reused — popup-open hook
- 4-state matrix for popup display (driven by health-probe + token-mint outcomes):

  | Probe result | Token mint | UI state |
  |---|---|---|
  | 200 OK + `signed_in: true` | (not yet attempted) | "Save to Milton" enabled |
  | 200 OK + `signed_in: false` (or 401 on token-mint) | n/a | "Sign in to Milton" + `milton://` deep-link |
  | Probe times out / connection refused | n/a | "Open Milton to save references" + `milton://` deep-link |
  | (Milton not installed — deep-link fails) | n/a | "Get Milton — required to save references" + milton.so link |

**AC6 — Update `.env.local.example` + README**
- `.env.local.example`: remove `VITE_MILTON_KEY` line; add explanatory comment that no env vars are required for translation auth (the connector handles it)
- `tools/browser-extension/README.md`: replace the "API key configuration" section with "Auth flow" section explaining the connector → JWT → translation-server pipeline + the 4-state matrix

**AC7 — Tests**
- Unit tests for `auth-client.ts`: success, 401, 403, 429, network error
- Unit tests for `translation-client.ts`: bearer header set correctly, 401-expired triggers single retry, 402 surfaces error to caller
- Manual smoke (Pierre): fresh extension build → load unpacked → click toolbar on arxiv.org → reference appears in Milton; sign out of Milton → click toolbar → "Sign in to Milton" state shown; close Milton → click toolbar → "Open Milton" state shown

## Tasks / Subtasks

- [ ] Task 1 — Remove `VITE_MILTON_KEY` from `.env.local.example` + all source references (AC1)
- [ ] Task 2 — Implement `auth-client.ts` with `fetchTranslationToken()` + typed errors (AC2)
- [ ] Task 3 — Update `translation-client.ts`: fetch token, send `Authorization: Bearer`, retry-once on 401-expired (AC3)
- [ ] Task 4 — Build error-handler dispatch for new server contract (401/402/503 shapes) (AC4)
- [ ] Task 5 — Update popup state machine to handle the 4 states (AC5) — extend BE-1's existing matrix with the connector-token-mint outcome
- [ ] Task 6 — Unit tests for auth-client + translation-client (AC7)
- [ ] Task 7 — Update README + `.env.local.example` (AC6)
- [ ] Task 8 — Manual smoke against running stack (AC7)

## Dev Notes

### Why fetch-token-per-save (no caching)
- 30-second TTL means a cached token is stale within a single browsing session
- Localhost round-trip is sub-millisecond — caching saves nothing real
- Always-fresh tokens close the multi-account-switch race window cleanly

### Why no refresh-token machinery
- The "refresh" is `POST /auth/issue-token` itself. Milton holds the long-lived Supabase session; the extension just asks for fresh 30s tokens on demand. No second refresh layer needed.

### Two error codes at 402 — `quota_exceeded` vs `tier_required`
- TS-6 introduces 402 `quota_exceeded` (free user past 350/7d on `/web`)
- TS-7 introduces 402 `tier_required` (free user hits a paid-only route)
- Same status code, different `error` string — BE-4 must dispatch on `error` field, not status alone

### Origin allowlist gotcha (dev workflow)
- Milton's origin allowlist (story 18-15 AC6) hardcodes the chrome-extension ID
- During dev: every `pnpm build` produces the same ID **only if** the extension `key` field is set in `manifest.config.ts` (it is, per BE-1)
- After Chrome Web Store publication: the prod ID is different — must be added to Milton's allowlist before the public extension can talk to Milton
- Document this in README + flag as a deployment checklist item

### Scope estimate
~half a day. The flow is small (one new client module, one bearer-header swap, error dispatch). Most time is the popup state-machine update + smoke testing.

## Definition of Done

- AC1–AC7 met
- Unit tests pass
- Pierre smoke: fresh build → save from arxiv → ref appears; sign-out state shows correct UI; Milton-closed state shows correct UI
- No `MILTON_KEY` references anywhere in built bundle (`grep -r MILTON_KEY dist/` returns empty)
- `sprint-status.yaml`: BE-4 → `done`

## File List

- `tools/browser-extension/src/lib/auth-client.ts` (NEW) — fetch token from connector
- `tools/browser-extension/src/lib/translation-client.ts` (MODIFIED) — send bearer instead of X-Milton-Key, handle new errors
- `tools/browser-extension/src/popup/popup.ts` (MODIFIED) — extend state machine for new error states
- `tools/browser-extension/src/lib/auth-client.test.ts` (NEW)
- `tools/browser-extension/src/lib/translation-client.test.ts` (MODIFIED)
- `tools/browser-extension/.env.local.example` (MODIFIED) — remove VITE_MILTON_KEY
- `tools/browser-extension/README.md` (MODIFIED) — auth flow section

## Dev Agent Record

### Agent Model Used
_(Filled by dev agent)_

### Completion Notes
_(Filled by dev agent)_

## Change Log
- 2026-05-07: Story drafted by BMad Master alongside TS-6, TS-7, and 18-15.
