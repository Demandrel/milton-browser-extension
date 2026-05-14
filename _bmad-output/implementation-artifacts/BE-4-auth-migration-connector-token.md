# Story BE-4: Auth Migration — Shared MILTON_KEY → Connector-Issued JWT

Status: done
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

- [x] Task 1 — Remove `VITE_MILTON_KEY` from `.env.local.example` + all source references (AC1). Grep on `dist/` after build confirms zero matches.
- [x] Task 2 — Implement `auth-client.ts` with `fetchTranslationToken()` + `TokenFetchResult` discriminated union (200 → ok+token, 401 → signed-out, 403 → origin-rejected, 429 → rate-limited with Retry-After, network → network-error, other → unexpected). Reads no body in request (connector derives user from its active_user state). (AC2)
- [x] Task 3 — Rewrite `translation-client.ts`: fetch fresh token via auth-client, POST `/metadata` (NOT `/web` — TS-14 retired it), send `Authorization: Bearer <jwt>` + `Content-Type: text/plain`, parse `MetadataResponse` envelope, retry-once on 401 `expired` only. (AC3 + expanded scope)
- [x] Task 4 — Build full error-handler dispatch for the new server contract: 401×5 reasons (token_invalid/expired/wrong_audience/device_not_registered/device_owner_mismatch), 402×3 reasons (quota_exceeded/tier_required/tier_revoked) with structured body parsing, 404/405/413/429/502/503 dispatch keyed on body `error` string. (AC4 + expanded scope)
- [x] Task 5 — Extend popup state machine for the new errors: added 5 new states (`error-auth-failed`, `error-rate-limited`, `error-quota-exceeded`, `error-tier-required`, `error-service-unavailable`). Reused existing `signed-out`, `milton-not-running`, `error-no-metadata`, `error-too-large`, `error-network` for overlapping flows. Added humanizeSeconds helper for retry-after / next_reset_seconds display. (AC5)
- [x] Task 6 — Unit tests: 39/39 pass. `auth-client.test.ts` 9 tests (success / signed-out / origin-rejected / rate-limited with+without Retry-After / network-error / unexpected status / malformed JSON / missing token field). `translation-client.test.ts` 18 tests (success envelope / Bearer header / `/metadata` endpoint not `/web` / `source_tier:"empty"` → no-metadata / primary:null defensive / token-mint failures pass-through / 401 expired retries once / 401 expired twice does NOT triple-retry / 401 token_invalid no retry / 401 device_not_registered distinct kind / 402 quota_exceeded body parsing / 402 tier_required required_tiers array / 503 key_lookup_unavailable / 503 service_unavailable / 404 not_found / 429 with Retry-After / network-error). `metadata-to-payload.test.ts` 12 tests (author shape with empty last / empty-both filtered / year=0 omitted / doi/abstract empty omitted / no type emitted / url from caller / AC7 envelope / full arXiv snapshot). (AC7 unit-test portion)
- [x] Task 7 — Update README + `.env.local.example`: README now has full "Auth flow" section with pipeline diagram + popup state matrix table + origin allowlist deployment checklist; `.env.local.example` no longer references `VITE_MILTON_KEY`. (AC6)
- [x] Task 8 — Manual smoke validated by Pierre 2026-05-14: arxiv save → reference created in Milton library, end-to-end flow works. Pierre observation: "*it is a bit long but it works*" — total save time runs into a few seconds dominated by translate.milton.so/metadata translator processing. Filing a tech-debt entry for a perf-observation pass once we have more data (translator-server timings, GROBID hit-rate). (AC7 manual portion)

### Expanded-scope tasks (added 2026-05-14 per Change Log)

- [x] Task 9 — Rewrite mapper: `csl-to-payload.ts` (deleted) → `metadata-to-payload.ts`. Adapts the new `MetadataPrimary` envelope (`authors[{first, last}]`, integer `year`, empty-string-when-absent strings) to the same `ConnectorReferencePayload`. `itemType` is no longer carried by the envelope, so the mapper emits no `type` field (connector falls back to `article` server-side).
- [x] Task 10 — Update types.ts with the new wire shapes: `IssueTokenResponse`, `TokenFetchResult`, `MetadataSourceTier`, `MetadataExtractedFrom`, `MetadataAuthor`, `MetadataPrimary`, `MetadataResponse`, `TranslateError` (discriminated union of every documented error). Deleted `ZoteroCslItem` and `ZoteroCreator` (no longer used).

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

**New:**
- `tools/browser-extension/src/lib/auth-client.ts` — `fetchTranslationToken()` against `POST 127.0.0.1:7521/auth/issue-token`
- `tools/browser-extension/src/lib/auth-client.test.ts` — 9 Vitest scenarios
- `tools/browser-extension/src/lib/metadata-to-payload.ts` — `mapMetadataToPayload()` for the `/metadata` envelope
- `tools/browser-extension/src/lib/metadata-to-payload.test.ts` — 12 Vitest scenarios (replaces csl-to-payload.test.ts)
- `tools/browser-extension/src/lib/translation-client.test.ts` — 18 Vitest scenarios (new file — BE-1 had none)

**Modified:**
- `tools/browser-extension/src/lib/translation-client.ts` — full rewrite: `/web` → `/metadata`, `X-Milton-Key` → `Bearer`, retry-once on 401 expired, structured error dispatch over 401×5 / 402×3 / 404 / 405 / 413 / 429 / 502 / 503×2 wire shapes
- `tools/browser-extension/src/lib/types.ts` — added `IssueTokenResponse`, `TokenFetchResult`, `MetadataResponse` (+ `MetadataPrimary` / `MetadataAuthor` / `MetadataSourceTier` / `MetadataExtractedFrom`), `TranslateError` discriminated union; removed `ZoteroCslItem` + `ZoteroCreator`
- `tools/browser-extension/src/popup/popup.ts` — 5 new states (`error-auth-failed`, `error-rate-limited`, `error-quota-exceeded`, `error-tier-required`, `error-service-unavailable`), token-mint + translate-server error dispatch helpers, `humanizeSeconds()` helper
- `tools/browser-extension/.env.local.example` — removed `VITE_MILTON_KEY`; production URL is now default; comment block explains the per-user JWT pipeline
- `tools/browser-extension/README.md` — added "Auth flow" pipeline diagram + popup state matrix table + origin allowlist deployment checklist; updated story map (BE-4 → shipped)

**Deleted:**
- `tools/browser-extension/src/lib/csl-to-payload.ts` — superseded by metadata-to-payload.ts
- `tools/browser-extension/src/lib/csl-to-payload.test.ts` — superseded by metadata-to-payload.test.ts

## Dev Agent Record

### Agent Model Used
claude-opus-4-7 (1M context) — invoked via `/bmad_bmm_dev-story BE-4` directly after BE-1's PR landed (`538ac562`).

### Completion Notes

**AC1 (MILTON_KEY removed from build)** — `.env.local.example` no longer references `VITE_MILTON_KEY`; `translation-client.ts` no longer reads it; post-build `grep -r MILTON_KEY dist/` returns empty.

**AC2 (token-mint module)** — `auth-client.ts::fetchTranslationToken()` returns a `TokenFetchResult` discriminated union (no thrown errors — matches BE-1's `connector-client.ts` pattern). Token is NOT cached; each save fetches fresh (30s TTL + sub-ms localhost round-trip per Story 18-15 design).

**AC3 (Bearer + retry-once)** — `translation-client.ts::extractMetadata(url)` mints a token, POSTs to `translate.milton.so/metadata`, retries ONCE on 401 `expired` only (other 401 reasons won't be fixed by a fresh mint). Verified by tests `retries ONCE on 401 expired and succeeds` + `does NOT retry more than once if second attempt also returns 401 expired` + `does NOT retry on 401 token_invalid`.

**AC4 (error dispatch)** — full table of wire shapes parsed: 401×5 (token_invalid/expired/wrong_audience/device_not_registered/device_owner_mismatch), 402×3 (quota_exceeded/tier_required/tier_revoked) with structured body fields (`next_reset_seconds`, `required_tiers`, `upgrade_url`), 404 not_found, 405 method_not_allowed, 413 payload_too_large, 429 rate-limited with Retry-After, 502 bad_gateway, 503 key_lookup_unavailable (distinct retry-after default 30s) vs 503 service_unavailable (generic).

**AC5 (popup state machine)** — 5 new states added on top of BE-1's 14; total now 19. Token-mint failures (signed-out / origin-rejected / rate-limited / network-error / unexpected) dispatch to popup states. Translate-server failures (10 kinds + no-metadata + network-error) dispatch. Display includes `humanizeSeconds()` for friendly retry-after / quota-reset display ("3 minutes", "2 hours", "1 days").

**AC6 (README + .env.local.example)** — README now has Auth-flow section with sequence diagram + popup state matrix + origin allowlist deployment checklist. `.env.local.example` only carries `VITE_TRANSLATE_BASE` (production default + commented local alternative).

**AC7 (tests)** — 39/39 Vitest pass in 231ms.

**Expanded scope (Change Log 2026-05-14)** — endpoint `/web` → `/metadata` + mapper rewrite (`csl-to-payload.ts` deleted, `metadata-to-payload.ts` new) — required because TS-14 retired `/web` server-side on 2026-05-12. Pierre approved in-flight expansion (one-PR coherence vs splitting into two interdependent stories).

**Verification gates run by dev agent:**
- `pnpm typecheck` (`tsc --noEmit`) → 0 errors
- `pnpm test` → 39/39 pass, 231ms
- `pnpm build` → 144ms, dist/ produced (15.21 KB JS bundle, gzip 4.28 KB)
- `grep -r MILTON_KEY dist/` → no matches (AC1 verification)

**Pierre's gate pending (Task 8 / AC7 manual smoke):** End-to-end save against arXiv / PubMed / Nature; 409 duplicate; signed-out fallback; Milton-closed fallback. Per G17-1, story stays at `review` until Pierre validates in real Chromium.

## Change Log
- 2026-05-07: Story drafted by BMad Master alongside TS-6, TS-7, and 18-15.
- 2026-05-14 (smoke validated): **Pierre confirmed end-to-end save works** after he updated the auth-proxy's `SUPABASE_SERVICE_ROLE_KEY` on Coolify (root cause of the initial 503 `key_lookup_unavailable` smoke failure — TD-61 had rotated the canonical key to `sb_secret_*` but Coolify's env var hadn't been updated). Reference creation against `arxiv.org/abs/2303.08774` succeeds; Milton receives the reference; toast fires. Status flipped to `done`. Filing the "a bit long" observation as a future perf-observation item (no story yet — wants more data first).
- 2026-05-14 (post-smoke patch): **Wire-shape parser fix.** Pierre's first smoke surfaced a 503 with body `{error:"service_unavailable", reason:"key_lookup_unavailable"}`. The original `translation-client.ts` dispatched 401 and 503 on `body.error`, but the auth-proxy's real wire shape uses `body.error: "unauthorized"` (or `"service_unavailable"`) with the discriminator in `body.reason`. Read `tools/translation-server/auth-proxy/src/server.ts:288-307` for the canonical contract. Effect of the bug: all 401 reasons collapsed into the default "Authentication failed, try again" message — `device_not_registered`'s differentiated UX ("Sign out and back in") never triggered, and the silent retry-once on `expired` never fired. Fix: 401 + 503 now dispatch on `body.reason`; 402 unchanged (uses `body.error` per server.ts:354/422). Test fixtures updated to use real wire shape. Note: this fix does NOT address Pierre's immediate symptom — the 503 itself is server-side (auth-proxy can't reach Supabase, likely the `SUPABASE_SERVICE_ROLE_KEY` rotation from TD-61 not propagated to Coolify env). Filing as separate ops item.
- 2026-05-14: **Scope expanded in-flight by Dev Agent (Opus 4.7 1M)** — TS-14 (shipped 2026-05-12) removed `/web` from the public route matrix and replaced it with `/metadata` (unified orchestrator + envelope response). BE-4 was scoped 2026-05-07 against the `/web` world, so the auth-header swap alone wouldn't yield a functional extension. Pierre approved the in-place scope expansion. Additional changes folded into this story: (1) endpoint migration `/web` → `/metadata`; (2) response-shape rewrite — translation-client now parses `{source_tier, extracted_from, primary:{authors:[{first,last}], year:int, abstract, doi, ...}, candidates}` instead of `ZoteroCslItem[]`; (3) mapper rename `csl-to-payload.ts` → `metadata-to-payload.ts` (semantic accuracy — the input is no longer CSL flavor); (4) author-shape rewrite (`{first, last}` → `{firstName, lastName}` direct, no more `creators[{name}]` collapse path); (5) `itemType` is dropped from the new envelope, so all references default to server-side fallback (`article`); (6) richer error dispatch table covering 401×5 reasons + 402×3 reasons + 404 not_found + 502 + 503×2 reasons from `docs/integrations/translate-milton-so-api.mdx`. Rationale for one-PR vs split: the header swap is meaningless without the endpoint swap, and vice versa — smoke is the only validation gate and it requires both. Story file ACs/Tasks below now reflect the expanded scope.
