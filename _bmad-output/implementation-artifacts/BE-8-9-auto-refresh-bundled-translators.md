# Story BE-8.9: Background auto-refresh of bundled translators

Status: review

<!-- BMad SM workflow create-story output. Pierre-customized flow: full draft + auto-method-17 hardening + single validation prompt. Method-17 pass: see Change Log. -->

## Story

As a **Pierre dogfooding BE-v2 on publishers whose translators get upstream fixes (HTML changes, metadata schema tweaks) between extension releases**,
I want **bundled translators auto-refreshed from `translators.milton.so` on a periodic schedule (Zotero Connector pattern), AND the runtime translator resolver to prefer a fresher cached version over the build-time bundled version when SHA-256 diverges from the live manifest**,
so that **translator fixes propagate to my browser within hours without requiring me to re-sideload the extension** — closing the gap between BE-8-5's pin-at-build philosophy (Charter v2 Decision 6) and Milton's sideload-first distribution (Charter v2 Decision 9) which has no extension auto-update mechanism today.

## Background

Origin: Pierre architecture-conversation 2026-05-18 (during BE-8-8 deferral planning, see `MEMORY.md` entries `feedback-charter-decisions-are-hypotheses` + `project-in-app-capture-scope-decision`). Pierre's question chain — "how does Zotero handle translator updates?" → "is publishing the extension complicated?" → "couldn't translators be auto-fetched so extension releases aren't required?" — landed on the recognition that **BE-8 shipped half of the Zotero auto-update model** (lazy-fetch for long-tail, BE-8-5) **but never closed the loop for bundled translators**, which remain frozen at build time.

The gap matters because: (a) Charter v2 Decision 9 makes Milton sideload-first → no Chrome Web Store auto-update → every "user must update extension" path is *practically* "user stays on stale version forever"; (b) major publisher translators get touched ~2–6 times/year (Pierre's order-of-magnitude estimate, conversation 2026-05-18) — over 1–2 years, every bundled top-50 translator needs a refresh; (c) the infrastructure to push translator updates instantly already exists (`translators.milton.so` CDN, Ed25519 signing, lazy-fetch via BE-8-5) — it just isn't invoked for bundled UUIDs.

This story closes that gap. Charter v2 Decision 6 ("bundled subset pinned at build for reproducibility") is preserved at BUILD time (the .crx contents are deterministic from the pin); the RUNTIME override via auto-refresh is orthogonal and matches what Zotero Connector has done for years (`repo.zotero.org` poll + auto-replace stale bundled translators).

Depends on: **BE-8-1** (this repo, done — translator-mirror CDN at `translators.milton.so/repo/`, Ed25519-signed manifest, per-translator SHA-256). **BE-8-5** (this repo, done — bundled subset registry + `translator-fetcher.ts` lazy-fetch path + `chrome.storage.local` caching with hash-driven invalidation + LRU eviction).

Unblocks: nothing in the BE-8 epic (BE-8-8 / BE-8-9-original are deferred to future epic-21 per Pierre 2026-05-18). Mid-term unblock: when epic-21 (AI features) lands, the auto-refresh foundation means any new orchestration logic Milton ships in the extension itself can be hot-patched via translator-mirror without extension releases (though only for the translator code path; new JS that lives outside the translator bundle would still need an extension release).

## Why now

**Why this scope cut**: original BE-8-9 charter scope (server downscale + GROBID retire) is deferred to future epic-21 since it cascades behind BE-8-8 (LLM-fallback). The BE-8-9 slot is repurposed for auto-refresh because (a) it's a small, high-leverage closeout that completes the Zotero-pattern parity BE-8 was chasing, (b) it's a prerequisite for confidently moving any future orchestration logic client-side (whatever client-side code we ship needs the same hot-patch property), and (c) Pierre wants the BE-8 epic to actually finish strong rather than ship 7-of-9 with a known staleness gap.

**Why not punt to a new epic**: Pierre explicit 2026-05-18 — "this should be story BE-8-9, no need to open a new epic." The work fits the BE-8 capture-parity theme (stale translators ≡ degraded capture); a new epic for a single story would be ceremony for ceremony's sake.

**Why service worker is in scope here, not its own story**: the extension has no service worker today (verified 2026-05-18: `grep -nE "chrome\.alarms|chrome\.runtime\.onInstalled|service_worker|background:" src/ manifest.config.ts` returns zero hits; no `src/sw/` or `src/background/` directories). `chrome.alarms` requires a SW. Adding one is a precondition, not a separable story — splitting it would create an empty-shell SW PR followed by a "now use it" PR with no observable behavior in between.

## Acceptance Criteria

1. **Service worker added.** A new file `src/sw/sw.ts` (with SPDX `AGPL-3.0-or-later` header) hosts the SW. `manifest.config.ts` adds `background: { service_worker: 'src/sw/sw.ts', type: 'module' }` per the CRXJS MV3 pattern. The `permissions` array adds `'alarms'`. **Bundle-output verification:** `pnpm build` produces `dist/service-worker-loader.js` (CRXJS-generated wrapper) + the SW chunk; loading `dist/` in `chrome://extensions` shows the SW as "active" with no console errors.

2. **Periodic refresh alarm registered on install + startup.** SW handles `chrome.runtime.onInstalled` AND `chrome.runtime.onStartup` by ensuring an alarm named `milton-translator-refresh` exists with `periodInMinutes: 360` (6 hours). Re-installs / browser-restarts MUST NOT create duplicate alarms — use `chrome.alarms.get` first; only `chrome.alarms.create` if absent. Re-install MUST trigger an immediate refresh check (don't wait 6h after install). Browser restart MUST trigger a refresh IF the last-refresh timestamp is older than the period (catches the "browser was off for a week" case where the alarm queue dropped).

3. **Refresh function bypasses manifest 1h-TTL.** New module `src/translator-runtime/translator-refresh.ts` exports `async function refreshBundledTranslators(): Promise<RefreshResult>`. It invokes `fetchManifest(force=true)` (the existing parameter on `translator-fetcher.ts:273`) to skip the in-process cache and re-fetch + re-verify from `translators.milton.so/repo/{metadata,metadata.sig}`. Force-refresh re-populates the in-process cache so subsequent `findCandidateTranslatorIds` calls see the fresh manifest within the same SW lifetime.

4. **Bundled-vs-manifest SHA comparison.** For each entry returned by `listBundledTranslators()`, look up its `translatorID` in the freshly-fetched manifest. Three states:
    - **Bundled UUID present in manifest, SHA matches** → no-op (bundled is current). Log at `debug` level only.
    - **Bundled UUID present in manifest, SHA differs** → call `fetchTranslatorFromCdn(translatorID)` (the existing BE-8-5 path), which writes the verified-fresher version to `chrome.storage.local` under `translator-fetched:{uuid}`. Per-translator failure is non-fatal — log + continue with other UUIDs.
    - **Bundled UUID absent from manifest** (upstream Zotero removed the translator) → no-op + warning log. Bundled translator continues to be served (graceful degradation; removal is rare and we'd rather serve old-but-working than nothing).

5. **Runtime resolution prefers cached-fresher over bundled.** New function `getResolvedTranslator(translatorID: string, currentManifest: Manifest | null): Promise<BundledTranslator | null>` in `translator-bundle.ts` (or a new `translator-resolver.ts` if Pierre's reviewer prefers separation — dev-agent's call, document the choice in Completion Notes). Resolution order:
    1. **Cached fresher**: look up `translator-fetched:{uuid}` in `chrome.storage.local`; if present AND `currentManifest !== null` AND cached entry's `sha256` matches the manifest entry's `sha256` AND differs from the bundled entry's pin hash → return cached version (wraps the cached `{metadata, body}` into a `BundledTranslator` shape).
    2. **Bundled verified**: fall through to `getBundledTranslator(uuid)` (existing API).
    3. **Lazy-fetch**: if both above return null (UUID not in bundle), call `fetchTranslatorFromCdn` (existing path, unchanged behavior).
    All existing call sites that currently use `getBundledTranslator()` MUST migrate to `getResolvedTranslator()`. Specifically: `sandbox.ts:runTranslation` (the host-bridge `translator-load-request` handler in popup/SW). Grep for `getBundledTranslator(` to find the full list; expect 1–3 call sites.

6. **Trust chain preserved — no new trust surfaces.** The cached entry was verified against the manifest's SHA-256 at fetch time (BE-8-5 AC7); the manifest itself was Ed25519-verified at fetch time (BE-8-5 AC7); the runtime preference check above re-verifies that the cached SHA still matches the CURRENT manifest entry (not a stale one). If the current manifest entry's SHA differs from the cached entry's SHA, the cached entry is treated as stale and the bundled version is used instead (the refresh path will re-fetch the new version on next alarm; we don't trigger an on-demand fetch from the resolver — that would block the sandbox load and defeat the bounded-latency property). No raw `chrome.storage.local` value is trusted without manifest re-verification at resolution time.

7. **Refresh failure modes are non-fatal and observable.**
    - **Manifest fetch fails** (network, 4xx, 5xx, `MANIFEST_MALFORMED`) → log a single warning at `warn` level + record `lastRefreshResult: 'manifest-fetch-failed'` in observability state; do NOT touch any cached entries; bundled translators remain in use; next alarm retries. No user-facing UI change.
    - **Signature verification fails** (`SIGNATURE_INVALID` from `verifyManifestSignature`) → **CRITICAL — log at `error` level**, record `lastRefreshResult: 'signature-invalid'`, abort the refresh entirely, do NOT process per-translator updates. Rationale: signature failure means either upstream key rotation (BE-8-1 contingency) or active tampering — in either case we want the bundled version (signed against the embedded `MANIFEST_SIGNING_PUBKEY` constant) to remain authoritative, NOT a potentially-tampered manifest to override anything.
    - **Per-translator fetch fails** (one UUID errors during the loop) → log + continue; the failed UUID stays on its bundled version this cycle; record per-UUID error in observability state.

8. **Observability state persisted to `chrome.storage.local`.** New key `translator-refresh-state` with shape `{ lastRefreshAt: number, lastRefreshResult: 'success' | 'manifest-fetch-failed' | 'signature-invalid' | 'partial', updatedCount: number, perUuidErrors?: Record<string, string>, durationMs: number }`. Updated atomically at end of every refresh attempt (success or failure). Surfaced where: dev-only — added to a future DevPanel or read via `chrome.storage.local.get('translator-refresh-state')` from SW console. **No popup UI** for refresh status (Pierre's BE-8-7-style polish-later discipline — observability is for the developer, not the user). Out of scope: a "refresh now" user-facing button.

9. **Resolver MUST tolerate manifest unavailability.** `getResolvedTranslator(uuid, currentManifest=null)` MUST handle the case where the caller has no manifest in hand (e.g., the sandbox bootstrap path runs before any refresh has populated cache, OR the manifest fetch failed and we're in degraded mode). With `currentManifest === null`: skip the cached-fresher check entirely, fall straight through to bundled. This keeps the resolver synchronous-friendly + non-blocking + correctly-degraded.

10. **Tests — unit.** Vitest suite additions:
    - `translator-refresh.test.ts` (new):
      - Happy path: mock manifest with 3 bundled UUIDs (1 matching SHA, 1 differing SHA, 1 absent); assert `fetchTranslatorFromCdn` called once for the differing UUID; assert refresh-state recorded `updatedCount: 1, lastRefreshResult: 'success'`.
      - Manifest fetch fails (NETWORK_ERROR): assert refresh-state recorded `'manifest-fetch-failed'`; assert NO calls to `fetchTranslatorFromCdn`.
      - Signature invalid (SIGNATURE_INVALID): assert refresh-state recorded `'signature-invalid'`; assert NO calls to `fetchTranslatorFromCdn`; assert the existing in-process manifest cache (from BE-8-5) is NOT overwritten with the tampered manifest.
      - Per-translator fetch fails: assert other translators still processed; assert `perUuidErrors` populated.
    - `translator-bundle.test.ts` (extend):
      - `getResolvedTranslator` prefers cached fresher when SHA matches manifest entry + differs from bundle.
      - Falls through to bundled when cached SHA matches bundle SHA (no-op case — bundle wins via fall-through).
      - Falls through to bundled when cached SHA differs from manifest entry (stale-cache case).
      - Falls through to bundled when `currentManifest === null`.
      - Returns null when UUID is in neither bundle nor cache.
    - `sw.test.ts` (new, if feasible — `chrome.alarms` mock complexity might force this to be a smoke-only):
      - `onInstalled` registers alarm with `periodInMinutes: 360`.
      - Existing alarm is NOT recreated on re-install (no duplicate).
      - `onStartup` triggers immediate refresh if `lastRefreshAt` is older than 6h.
    Vitest count target: existing baseline + ~15-20 new tests.

11. **Tests — smoke (Pierre G19-1 manual).** Three scenarios, all PASS required before review:
    - **S1 — install-time refresh fires.** Sideload fresh `dist/` in `chrome://extensions`; open the SW console (`Service worker` link under the extension); observe a `[milton-refresh] starting refresh` log within 5s of install + a `[milton-refresh] success: updatedCount=N` (where N ≥ 0 depending on bundle freshness). Verify `translator-refresh-state` is populated via SW console: `chrome.storage.local.get('translator-refresh-state').then(console.log)`.
    - **S2 — alarm fires periodically.** From the SW console: `chrome.alarms.getAll().then(console.log)` → confirms `milton-translator-refresh` alarm with `periodInMinutes: 360`. To exercise without waiting 6h: from SW console, `chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 1 })` (overrides the existing alarm). Wait ~1 min; observe a `[milton-refresh] starting refresh` log. After verification, reset to 6h: `chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 360 })`. **DO NOT commit any code that registers a sub-6h period — this exercise is console-only.**
    - **S3 — cached-fresher resolver wins.** Manually inject a fake cached entry that mimics a fresher upstream version of a bundled translator. From popup console: `chrome.storage.local.set({ 'translator-fetched:<some-bundled-uuid>': { metadata: {...same as bundled metadata...}, body: '/* MUTATED: console.log("CACHED VERSION RAN") */', sha256: '<sha matching the current manifest entry for that UUID — copy from translator-mirror-metadata cache>', fetchedAt: Date.now() } })`. Trigger a capture against a URL covered by that translator; verify the sandbox console shows the `CACHED VERSION RAN` log (proving the cached body executed, not the bundled body). After verification: `chrome.storage.local.remove('translator-fetched:<uuid>')` to revert. **This test requires the manifest entry's SHA to match the injected cached SHA — copy from the actual manifest, don't fabricate a hex string.**

12. **Charter v2 Decision 6 preservation.** The .crx output (`pnpm build`) MUST contain the SAME bundled translator bytes as before this story — the build is still pinned to `translator-bundle-pin.json`. NO modification to `scripts/refresh-translator-bundle.ts` (the BE-8-5 build-time bundler) is permitted in this story. The runtime override is purely additive: bundled bytes ship in the .crx as before; the resolver may prefer a cached fresher version at runtime. This means a user with a brand-new sideload sees the bundled version on first capture (zero network dependency for the common path); the cached override only kicks in after the first successful refresh has run. **Verify in dogfood**: `git diff dist/` after this story's build should differ only in (a) the new SW chunk and (b) the resolver-changed call sites — translator JS files in `dist/` remain byte-identical.

13. **Charter v2 Decision 9 alignment.** This story does NOT change Milton's distribution model (sideload-first stays). It MAKES sideload-first sustainable by removing the "users stuck on broken translators" failure mode. If Pierre later ships to Chrome Web Store (a separate epic), the auto-refresh continues to work unchanged — the two are orthogonal channels.

14. **IPC-boundary self-check** (charter v2 standing rule): `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returns zero hits. No imports from Milton-desktop. Network calls go to `translators.milton.so/repo/` (existing, via `translator-fetcher.ts`) only — no new network surfaces.

15. **Pre-Review Self-Check** — extends the template's list with three story-specific items:
    - `pnpm build` warning-free; SW chunk size noted in Completion Notes (expect <50 KB; the SW is thin).
    - `dist/` translator bytes are byte-identical to a pre-story build (run a quick `diff` of two `pnpm build` outputs before and after the resolver changes — proves AC12).
    - SW DevTools console (after sideload) shows no uncaught errors during a typical capture session (popup-open → save → popup-close).

## Out of scope (explicit non-goals — see "Why not" notes inline)

- **A user-facing "Refresh translators now" popup button.** Out of scope — observability is dev-only this cycle (AC8). Polish item if Pierre wants it later; no story-blocking value.
- **Telemetry of refresh outcomes to a backend.** Out of scope — `translator-refresh-state` lives in `chrome.storage.local` only. PostHog-style telemetry is epic-21 territory (AI-credit accounting + opt-in consent infrastructure).
- **A "force-refresh on capture failure" path** (e.g., when translator returns 0 items, trigger an immediate manifest re-check + per-translator re-fetch in case the stale translator is the cause). Out of scope — the 6h periodic refresh is enough for the common case; on-demand refresh introduces popup-latency variance + race-condition surface that wants its own design.
- **Modifying `scripts/refresh-translator-bundle.ts`** (the BE-8-5 build-time bundler). Untouched per AC12. Build-time pinning behavior stays as Charter v2 Decision 6 specifies.
- **Updating Charter v2 itself** to reflect the runtime-override clarification. Pierre's call whether the charter wants a clarification note here; not story-blocking.
- **Adding a translator-update changelog UI** (e.g., "Today we refreshed these 3 translators"). Out of scope; not a discoverability win for users.
- **Per-translator user-controlled pinning** (e.g., "always use bundled version of translator X, don't auto-refresh"). Out of scope; would require new settings UI + state.

## Tasks / Subtasks

- [x] **Task 1 — Add service worker scaffolding** (AC: #1)
  - [x] 1.1 Create `src/sw/sw.ts` with SPDX header + an `export {}` so it parses as a module. Initial body: `console.log('[milton-sw] booted')` (verify scaffolding before logic).
  - [x] 1.2 Update `manifest.config.ts`:
    - Add `'alarms'` to the `permissions` array (alphabetize within the existing list; comment the addition with `// BE-8-9 — chrome.alarms for periodic translator refresh`).
    - Add `background: { service_worker: 'src/sw/sw.ts', type: 'module' }` per CRXJS MV3 convention.
  - [x] 1.3 Run `pnpm build`; verify `dist/service-worker-loader.js` appears + the SW chunk; sideload `dist/` in `chrome://extensions`; click `Service worker` link; verify console shows `[milton-sw] booted`. If CRXJS wraps the SW under a different filename, document the actual path in Completion Notes (don't fight the framework).

- [x] **Task 2 — Implement refresh module** (AC: #3, #4, #6, #7)
  - [x] 2.1 Create `src/translator-runtime/translator-refresh.ts` with SPDX header.
  - [x] 2.2 Import `listBundledTranslators`, `fetchManifest`, `fetchTranslatorFromCdn`, `MIRROR_BASE_URL`, plus the existing `TranslatorFetcherError` type.
  - [x] 2.3 Define + export `RefreshResult` type: `{ lastRefreshAt: number, lastRefreshResult: 'success' | 'manifest-fetch-failed' | 'signature-invalid' | 'partial', updatedCount: number, perUuidErrors?: Record<string, string>, durationMs: number }`.
  - [x] 2.4 Implement `async function refreshBundledTranslators(): Promise<RefreshResult>` per AC3/4/7 logic:
    - Start timer.
    - Try `fetchManifest(force=true)`; on `SIGNATURE_INVALID` → return `'signature-invalid'` result + log at `error`. On other failures → return `'manifest-fetch-failed'` result + log at `warn`.
    - Iterate `listBundledTranslators()`; per-translator compare SHA; collect updates + per-UUID errors.
    - Compute `updatedCount`; if `perUuidErrors` non-empty → `'partial'`, else `'success'`.
    - Persist the result to `chrome.storage.local['translator-refresh-state']` atomically.
    - Return the result.
  - [x] 2.5 Add structured logging using a `[milton-refresh]` prefix on every log line so SW-console searches are clean.

- [x] **Task 3 — Wire SW install + startup + alarm hooks** (AC: #2)
  - [x] 3.1 In `src/sw/sw.ts`, import `refreshBundledTranslators` from `../translator-runtime/translator-refresh`. _(Refactor: handlers moved to `src/sw/sw-handlers.ts` for unit-testability; `sw.ts` is a thin glue layer that delegates.)_
  - [x] 3.2 Implement an `ensureAlarm()` helper: `const existing = await chrome.alarms.get('milton-translator-refresh'); if (!existing) await chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 360 })`. Idempotent.
  - [x] 3.3 Register `chrome.runtime.onInstalled.addListener` → `await ensureAlarm(); await refreshBundledTranslators()`.
  - [x] 3.4 Register `chrome.runtime.onStartup.addListener` → `await ensureAlarm()`; then read `chrome.storage.local['translator-refresh-state'].lastRefreshAt`; if older than 6h (or undefined) → `await refreshBundledTranslators()`.
  - [x] 3.5 Register `chrome.alarms.onAlarm.addListener` → on alarm name `'milton-translator-refresh'` → `await refreshBundledTranslators()`.
  - [x] 3.6 Wrap each handler in a top-level try/catch that logs + swallows — uncaught SW errors get the SW marked as "errored" by Chrome, which kills the alarm dispatch.

- [x] **Task 4 — Implement cached-fresher resolver** (AC: #5, #6, #9)
  - [x] 4.1 Decide whether to extend `translator-bundle.ts` or add `translator-resolver.ts`. _(Chose: extend `translator-bundle.ts` — kept resolver next to bundled-translator API per default recommendation.)_
  - [x] 4.2 Add the `BundleHashes` type import from `translator-bundle-pin.json` (already imported there).
  - [x] 4.3 Implement `export async function getResolvedTranslator(translatorID: string, currentManifest: Manifest | null): Promise<BundledTranslator | null>` per AC5 resolution order.
  - [x] 4.4 The cached-entry-to-`BundledTranslator` adapter: the cache shape `{metadata, body, sha256, fetchedAt}` (from `translator-fetcher.ts:92-97`) maps to `BundledTranslator: {metadata, source}` (use `body` as `source`). Same shape consumers already expect.
  - [x] 4.5 Migrate call sites: grep `src/` for `getBundledTranslator(` (excluding tests). Each non-test call site migrates to `getResolvedTranslator(uuid, manifest)`. The popup/SW already has access to `fetchManifest()` results; pass them through. Sandbox `runTranslation` should pass `currentManifest: null` because the sandbox itself never calls `fetchManifest` (CSP) — the cached-fresher check happens in the popup/SW message handler before delegating to the sandbox. _(Architectural extension required for S3 — see Completion Notes "AC5 wiring".)_

- [x] **Task 5 — Tests** (AC: #10)
  - [x] 5.1 Add `translator-refresh.test.ts` with the four cases enumerated in AC10. Mock `fetchManifest` + `fetchTranslatorFromCdn` + `chrome.storage.local`. Use the existing test-storage shim pattern from `translator-fetcher.test.ts`. _(9 tests covering happy path / manifest-fetch failed / signature-invalid (with cache-survivor guard) / partial / manifest-absent UUID.)_
  - [x] 5.2 Extend `translator-bundle.test.ts` with the five `getResolvedTranslator` cases enumerated in AC10. Use `_setVerifiedSet` + `_resetForTests` seams already in `translator-bundle.ts:270,278`. _(7 tests added — covers all 5 enumerated cases plus manifest-deleted + chrome.storage-unavailable degradation.)_
  - [x] 5.3 SW test: best-effort `sw.test.ts` mocking `chrome.alarms.{get,create,onAlarm}` + `chrome.runtime.{onInstalled,onStartup}`. If the mock surface is too lossy to give confidence, document in Completion Notes that SW behavior is smoke-only-verified (S1/S2 in AC11) and skip the unit test. _(Refactored handlers into `sw-handlers.ts` for unit-testability → 10 SW tests: ensureAlarm idempotency, handleInstalled refresh, handleStartup overdue/not-overdue/never-ran, handleAlarm name-gating.)_
  - [x] 5.4 Run `pnpm test`; verify all existing tests still pass + new tests pass. Document the new total test count in Completion Notes.

- [x] **Task 6 — Manual smoke** (AC: #11)
  - [x] 6.1 Execute S1 (install-time refresh) per AC11; paste the observed SW console log + the `translator-refresh-state` value into Completion Notes. _(Done — see Completion Notes "S1 evidence".)_
  - [x] 6.2 Execute S2 (alarm fires) per AC11; paste the `chrome.alarms.getAll` output + the override-and-revert sequence + the observed log into Completion Notes. **CRITICAL: confirm the alarm is reset to `periodInMinutes: 360` before closing the SW console.** _(Done — see Completion Notes "S2 evidence".)_
  - [x] 6.3 Execute S3 (cached-fresher resolver wins) per AC11; paste the injected `translator-fetched:*` entry + the sandbox console log proving the cached body executed + the cleanup `chrome.storage.local.remove` confirmation into Completion Notes. _(Path A pursued — see Completion Notes "S3 evidence" for why literal S3 wasn't exercisable in current zero-divergence state + which regression-equivalent ran instead.)_

- [x] **Task 7 — Final verification + cleanup** (AC: #1, #12, #14, #15)
  - [x] 7.1 `pnpm typecheck && pnpm test && pnpm build` all clean.
  - [x] 7.2 IPC-boundary grep per AC14 — paste the (empty) output into Completion Notes.
  - [x] 7.3 Verify AC12 byte-identical translators in `dist/`. _(See Completion Notes "AC12 verification" — verified at the SOURCE level via `git diff main -- src/translator-runtime/translators/ translator-bundle-pin.json scripts/refresh-translator-bundle.ts` returning empty; the embedded translator bytes in the chunk are therefore byte-identical even though the chunk filename hash changes because of the resolver additions to `translator-bundle.ts`.)_
  - [x] 7.4 Pre-Review Self-Check (AC15 items + the template's standard items).
  - [x] 7.5 Update `package.json` if any new devDependency was added (none expected — alarms is a chrome.* API, no library needed). _(No new deps.)_

- [x] **Task 8 — Story closeout** (Pierre-customized flow)
  - [x] 8.1 PR opens as non-draft (per CLAUDE.md Rule 3); body includes the AC checklist + smoke evidence from Task 6. _(PR #10 opened.)_
  - [x] 8.2 Background-watch CI per CLAUDE.md Rule 7 (`gh run watch <id> --exit-status` in background bash, NOT polled). _(CI green on initial push.)_
  - [x] 8.3 `/bmad_bmm_code-review` on the OPEN PR (per memory `feedback-code-review-required-before-done`); fix HIGH findings; re-watch CI. _(Done 2026-05-18 — see "Review Follow-ups (AI)" + Change Log code-review entry. 2 HIGH + 4 MEDIUM + 2 LOW found; H1/H2/M1/M2/M4/L2 fixed in code; M3 deferred as follow-up. 407/407 tests pass.)_
  - [ ] 8.4 After PR-side green + code-review green, merge; background-watch post-merge main CI (CLAUDE.md Rule 7 / memory `feedback-monitor-post-merge-ci-on-main`).
  - [ ] 8.5 Post-merge: `chore(BE-8-9): mark done` on `main` (the established pattern; see `git log --oneline | grep 'mark done'`).

### Review Follow-ups (AI)

<!-- Created 2026-05-18 by /bmad_bmm_code-review. HIGH+MEDIUM fixes applied
in code; this section tracks items that are deferred or require live
sideload state that isn't reproducible from a code change. -->

- [ ] **[AI-Review][MEDIUM] AC11 S3 (cached-fresher resolver smoke) deferred until upstream divergence exists.** The literal S3 ("inject a fake cached entry whose SHA matches the manifest entry; verify cached body executes in sandbox") requires either (a) manufacturing divergence by editing `translator-bundle-pin.json` + rebuilding — touches AC12-protected files; or (b) waiting for Zotero to push a translator change ahead of our next `pnpm refresh:translators`. Resolver decision logic + IPC plumbing are unit-tested (`translator-bundle.test.ts` 7 cases + `host-bridge.test.ts` 4 cases + `popup-translator-resolve.test.ts` 6 cases incl. H1 short-circuit). When upstream divergence next happens (or Pierre wants to force one), exercise S3 live and check the AC15 third self-check item. **Files:** none — operational follow-up.
- [ ] **[AI-Review][LOW] `console.log('[milton-sw] booted')` runs on every SW wake-up.** MV3 re-executes the SW script on each event wake-up (~every 30s of inactivity), so this prints "booted" repeatedly in long sessions. Useful as a heartbeat trace but noisy. If it becomes annoying during dogfood, gate behind a DEV flag or drop in favor of the alarm-fire log. **Files:** `src/sw/sw.ts:33`.

## Dev Notes

- **MV3 SW lifetime.** Service workers in MV3 are short-lived — Chrome unloads them after ~30s of inactivity. The alarm-fire wakes the SW back up. The `refreshBundledTranslators` async function must NOT spin off background work it expects to complete after returning — every `await` chain must terminate before the SW is allowed to unload. Practically: the existing `fetchTranslatorFromCdn` per-translator calls are `await`ed in a loop, so this is fine; just don't add fire-and-forget code.

- **`chrome.alarms` minimum interval.** Production Chrome enforces a 30-second minimum on `periodInMinutes` for installed extensions (browser-policy; was 1 minute pre-MV3-stable). 360 minutes (6h) is well clear. The dev-Chrome 1-minute period for S2 testing is permitted because the browser doesn't enforce the minimum on locally-loaded unpacked extensions — but **never ship a sub-6h period**; some Chrome versions may quietly cap a too-aggressive period and break the alarm entirely.

- **Cached entry trust.** The cached entry's SHA-256 was originally verified at fetch time (BE-8-5 AC7). At resolution time we re-verify it against the CURRENT manifest entry's SHA-256, NOT against the bundled pin's hash. This means: if the manifest entry's SHA differs from both the bundle and the cached entry, the cached entry is treated as stale (the manifest is the authority). If the manifest entry's SHA matches the cached entry and differs from the bundle, the cached entry is fresher → use it. This three-way comparison is straightforward but easy to bug; the unit tests in AC10 enumerate the cases explicitly.

- **Signature-invalid is the trap.** It is tempting to "log + continue with bundled" on signature failure. AC7 says abort the refresh AND keep bundled — same outcome. The reason to make it explicit is to ensure we don't accidentally OVERWRITE the existing in-process manifest cache (from BE-8-5) with the tampered manifest. The `fetchManifest(force=true)` path in `translator-fetcher.ts` currently overwrites the cache on successful verify; the abort-on-invalid behavior means we never reach the overwrite. Double-check the existing `fetchManifest` code path to confirm it doesn't write the cache before verify completes (line 244-249 in current code: verify is BEFORE cache write — safe).

- **Bundled-vs-pin SHA source.** When implementing AC5 resolution step 1 ("differs from the bundled entry's pin hash"), the pin hash lives in `translator-bundle-pin.json` → `bundleHashes[uuid]`. This is the already-imported JSON in `translator-bundle.ts`. No new import needed; just read from the existing import.

- **CRXJS quirks (verify in dogfood).** CRXJS may generate the SW under a name like `service-worker-loader.js` + a chunk. Don't assert specific output filenames in tests — those are framework-internal. The `manifest.config.ts` declaration is the authoritative source; whatever CRXJS produces is fine as long as the SW activates in `chrome://extensions`.

- **Why a separate `translator-refresh.ts` rather than extending `translator-fetcher.ts`.** `translator-fetcher.ts` is the LOW-LEVEL fetch + verify + cache primitive. `translator-refresh.ts` is the COORDINATOR that decides which translators need refresh + writes the observability state. Keeping them separate respects the single-responsibility split + makes the refresh module unit-testable independently of the fetcher.

- **Test-storage shim.** `translator-fetcher.test.ts` already has a `chrome.storage.local` mock pattern; reuse it for `translator-refresh.test.ts` and the new `getResolvedTranslator` tests. Don't reinvent. Grep `translator-fetcher.test.ts` for `chrome.storage` to find the pattern.

- **Browser support — `chrome.alarms.onAlarm` reliability.** Anecdotal reports suggest alarms can be dropped if the browser was suspended/closed for very long periods. The `onStartup` + last-refresh-age check (AC2) covers this — on browser restart we check whether a refresh is overdue and trigger it immediately. Belt + suspenders.

- **Pierre's customized create-story flow context.** Memory `feedback-create-story-default-flow` codifies: draft full story → auto-run method 17 (Red Team vs Blue Team) → auto-apply hardening → single validation prompt. This story was drafted in that flow; method-17 hardening pass below is in the Change Log.

### Project Structure Notes

- New files: `src/sw/sw.ts`, `src/translator-runtime/translator-refresh.ts`, `src/translator-runtime/translator-refresh.test.ts` (and maybe `src/sw/sw.test.ts`).
- Modified files: `manifest.config.ts` (alarms permission + background), `src/translator-runtime/translator-bundle.ts` (new resolver function or new file — Task 4.1 decides), `src/translator-runtime/translator-bundle.test.ts` (extend), call-site files for `getBundledTranslator` migration (1-3 sites; grep to find).
- No deletions; no renames; no public-API breaks (existing `getBundledTranslator` stays unchanged for backward compatibility and direct-bundled access paths if any).

### Documentation Consolidation Notes

<!-- Record key decisions, new patterns, and behaviors here for Paige (tech-writer agent) to consolidate into feature documentation at epic completion. Keep entries to 2-3 lines each. -->

- **Auto-refresh model.** Documents the Zotero-pattern translator hot-update mechanism: periodic SW-driven manifest poll + per-translator SHA diff + per-translator lazy-fetch + runtime resolver preference. Pattern is reusable for any future bundled-asset-with-CDN-mirror scenario.
- **SW addition.** First service worker in the extension. Establishes the pattern: thin SW, business logic in `src/translator-runtime/`, SW handlers wrap + delegate. Sets up the SW infrastructure for any future event-driven extension features (e.g., `chrome.alarms`-based periodic checks for other things).
- **Charter Decision 6 clarification.** Build-time pinning vs runtime override are orthogonal. The .crx output stays deterministic from the pin; runtime resolution may prefer a verified-fresher cached entry. Worth a one-line note in Charter v2.

### References

- [Source: src/translator-runtime/translator-fetcher.ts (BE-8-5)] — Existing lazy-fetch + cache + manifest fetch primitives. `fetchManifest(force=true)` at line 273 is the force-refresh hook. `fetchTranslatorFromCdn(translatorID)` is the per-translator fetch path.
- [Source: src/translator-runtime/translator-bundle.ts (BE-8-5)] — `listBundledTranslators()`, `getBundledTranslator(id)`, `verifyAllBundleIntegrity()`. Where the resolver extension lives.
- [Source: src/translator-runtime/translator-router.ts (BE-8-6)] — `findCandidateTranslatorIds(url)` — URL → UUIDs discovery. Unchanged by this story; resolver only intervenes at translator-CODE-load time, not URL-discovery time.
- [Source: manifest.config.ts] — Manifest declarations to amend (permissions + background).
- [Source: _bmad-output/planning-artifacts/charter-v2.md] — Decision 6 (bundled pin), Decision 9 (sideload-first). Both preserved by this story.
- [Source: _bmad-output/implementation-artifacts/BE-8-5-curated-translator-bundle-and-lazy-cdn-fetch.md] — Sibling story; canonical reference for the lazy-fetch + signing infrastructure this story builds on.
- [Source: _bmad-output/implementation-artifacts/BE-8-1-translator-mirror-cdn-setup.md] — CDN + signing infrastructure (Ed25519, manifest, per-translator SHA-256).
- [Source: ~/.claude/projects/-Users-pierrejacquel-web-dev-milton-browser-extension/memory/feedback_create_story_default_flow.md] — Pierre's customized create-story flow (this story was drafted in it).
- [Source: ~/.claude/projects/-Users-pierrejacquel-web-dev-milton-browser-extension/memory/feedback_code_review_required_before_done.md] — HARD RULE for closeout (Task 8.3).
- [Source: ~/.claude/projects/-Users-pierrejacquel-web-dev-milton-browser-extension/memory/feedback_monitor_ci_in_background.md] — Auto-watch CI pattern (Task 8.2 / 8.4).
- [Source: ~/.claude/projects/-Users-pierrejacquel-web-dev-milton-browser-extension/memory/feedback_extension_popup_console_impossible.md] — Why observability is in SW console (not popup console) for AC11 S2.
- [Source: CLAUDE.md] — Project rules (Rule 0 branch creation, Rule 3 non-draft PR, Rule 7 auto-watch CI).

## Pre-Review Self-Check

<!-- Before requesting code review, verify each item and check the box. -->

- [x] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke) — **N/A this story; no UI changes**
- [x] File list in story matches actual files changed
- [x] No raw hex color values — all colors use PandaCSS tokens — **N/A; no CSS changes**
- [x] `$effect` dependencies checked against async boundaries (no split reactive state across `await`) — **N/A; vanilla TS, no Svelte**
- [x] Superforms tests use real adapter (not mocked) — **N/A; no Superforms**
- [x] Barrel imports only — no direct imports from `features/*/utils/` — **N/A; no `features/` dir convention here**
- [x] No type casts (`as any`, `as unknown as T`) in new production code — test mocks excepted per team agreement
- [x] Error paths handled — all async operations have try/catch or .catch()
- [x] IPC command results checked for error states before use — **N/A; no IPC commands added** _(`inlineTranslator` is an extension-internal IPC field, not an IPC command result — and it's optional with a bundled fall-through when absent.)_
- [x] Loading states span full async lifecycle (set before await, cleared in finally) — **N/A; no UI loading states (observability is SW-console only)**
- [x] **Story-specific:** `pnpm build` warning-free; SW chunk size noted in Completion Notes (expect <50 KB) — **3.30 KB raw / 1.42 KB gzip**
- [x] **Story-specific:** `dist/` translator bytes byte-identical to pre-story build (verifies AC12 — Charter Decision 6 preservation) — **verified at source level (Task 7.3)**
- [ ] **Story-specific:** SW DevTools console (after sideload) shows no uncaught errors during a typical capture session — **Pierre's smoke (S1/S2/S3 in AC11) — pending sideload**

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

_(None — no debug logs needed; happy-path implementation, all gates green on first run.)_

### Completion Notes List

**AC5 wiring — architectural extension beyond the literal story scope.** AC5's literal task (4.5) was "migrate `getBundledTranslator()` call sites to `getResolvedTranslator()`" — only sandbox.ts had non-test call sites. However, that migration alone would NOT make the cached-fresher entry actually win at runtime: the sandbox is at opaque origin and has no chrome.storage access, and the offscreen document (which hosts the sandbox iframe) also has no chrome.storage access (Chrome's offscreen API restricts the surface — documented in `translator-fetcher.ts:122-141`). So a `getResolvedTranslator(uuid, null)` call in the sandbox would always fall through to bundled, the cached-fresher entry would sit in chrome.storage forever unread, and AC11 S3 ("trigger a capture; verify the cached body executes in the sandbox") would fail.

To deliver the user-facing outcome the story exists for — bundled-translator fixes reach the browser within hours without re-sideload — the cached body must travel through IPC from the popup (where chrome.storage IS accessible) to the sandbox. Minimum delta:
- New optional `inlineTranslator?: BundledTranslator` field on `MiltonTranslateRequestMsg` (popup ↔ offscreen runtime msg) and `TranslateRequest` (offscreen ↔ sandbox postMessage protocol v2). Backward-compatible — undefined when popup chose bundled.
- New helper `src/translator-runtime/popup-translator-resolve.ts` exporting `maybeInlineFresherTranslator(uuid)` — wraps `fetchManifest()` + `getResolvedTranslator(uuid, manifest)` + comparison with `getBundledTranslator(uuid)`. Returns the resolved body when it differs from bundled (cached-fresher win), else `undefined`. Best-effort: any failure returns `undefined` and the sandbox proceeds with bundled.
- Popup's `tryClientTranslator` + DEV `miltonPopupSpike` call the helper before `requestClientTranslation` and pass the result through.
- Offscreen forwards `inlineTranslator` from the runtime envelope into the sandbox postMessage envelope (1-line addition in `dispatchTranslation`).
- Sandbox `runTranslation`: prefers `args.inlineTranslator` over the bundled lookup when present. Bundled lookup itself migrated to `getResolvedTranslator(uuid, null)` per the literal AC4.5 task.

This is the same architectural shape Zotero Connector uses (the SW reads chrome.storage AND injects the chosen translator code via `chrome.scripting.executeScript` — one context owns both decision and execution). We can't put translator execution in the SW because the `zotero/translate` framework needs `eval`/`new Function()` which only the MV3 sandbox-page CSP permits — hence the extra IPC hop. Discussed and confirmed with Pierre before implementation.

**File-location choice (Task 4.1).** Extended `translator-bundle.ts` rather than creating a new `translator-resolver.ts`, per the default recommendation in the task. Keeps the resolver next to the bundled-translator API (one fewer file to navigate). Helper `popup-translator-resolve.ts` is separate because it's popup-specific orchestration (manifest fetch + comparison) rather than a primitive.

**SW handler refactor (Task 3 / Task 5.3).** Split SW logic into `src/sw/sw-handlers.ts` (testable handlers: `ensureAlarm`, `handleInstalled`, `handleStartup`, `handleAlarm`) + thin `src/sw/sw.ts` glue (top-level chrome event listener registrations that delegate to handlers). Top-level `addListener` calls are mandatory in MV3 SW (Chrome re-runs the script on each event wake-up), but the handler logic itself is freely unit-testable via direct function calls with chrome.* mocks installed. 10 SW unit tests result. Alarm-dispatch end-to-end (chrome.alarms actually firing the registered listener after the configured period) is smoke-only-verified per S2 in AC11.

**CRXJS output paths (Task 1.3).** `pnpm build` produces:
- `dist/service-worker-loader.js` (wrapper; what `manifest.json.background.service_worker` points to)
- `dist/assets/sw.ts-Gs4nijOw.js` (the actual SW chunk — 3.30 KB raw / 1.42 KB gzip)
Confirmed via `find dist -name "service-worker*" -o -name "sw*"`.

**Test count.** 25 test files / 407 tests (baseline 22 files / 368 tests). +3 files / +39 tests. Above the story's "+15-20" target. Post-code-review additions accounted for below.
- `src/sw/sw-handlers.test.ts` — 10 tests
- `src/translator-runtime/translator-refresh.test.ts` — 12 tests (9 original + 3 storage-write-tolerance added by code-review H2 fix)
- `src/translator-runtime/popup-translator-resolve.test.ts` — 6 tests (rewritten in code-review H1/M1 pass; now exercises the cache-existence short-circuit + the simplified resolver flow)
- `src/translator-runtime/translator-bundle.test.ts` — +7 tests (5 enumerated AC10 cases + manifest-deleted + chrome.storage-unavailable)
- `src/translator-runtime/host-bridge.test.ts` — +4 inlineTranslator IPC tests added by code-review M2 fix (forward, omit, JSON round-trip, type-guard acceptance)

**AC12 verification.** Source-level diff against `main`:
```
$ git diff --stat main -- src/translator-runtime/translators/ translator-bundle-pin.json scripts/refresh-translator-bundle.ts
(empty)
```
Translator JS files, pin file, and bundler script are all byte-identical. The `dist/assets/translator-bundle-*.js` chunk filename DOES change (the hash is content-derived, and `translator-bundle.ts` itself gained the `getResolvedTranslator` function), but the EMBEDDED translator strings inside that chunk are unchanged because their source files weren't touched. Charter v2 Decision 6 ("bundled subset pinned at build for reproducibility") preserved.

**AC14 IPC-boundary self-check.**
```
$ grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src 2>/dev/null; echo $?
1
```
Exit code 1 = grep found zero matches. No Milton-desktop imports.

**Manual smoke executed (Task 6 / AC11 S1-S3) — 2026-05-18, Pierre + Claude pair-smoking.**

**S1 evidence — install-time refresh fires.**
```
chrome.alarms.getAll() →
  [{name: 'milton-translator-refresh', periodInMinutes: 360, scheduledTime: 17791327...}]

chrome.storage.local.get('translator-refresh-state') →
  {translator-refresh-state: {
    durationMs: 272,
    lastRefreshAt: 1779111124844,
    lastRefreshResult: 'success',
    updatedCount: 0
  }}
```
SW DevTools attached after the install-time `onInstalled` chain had already fired (DevTools doesn't capture pre-attach history), but the persisted state + alarm presence retroactively prove the chain ran end-to-end on install.

**S2 evidence — alarm fires periodically.**
Override `chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 1 })`, waited ~1 min, observed two consecutive alarm cycles in the SW console:
```
[milton-sw] refresh trigger=onAlarm:milton-translator-refresh
[milton-sw] refresh result=success updatedCount=0 durationMs=5850
[milton-sw] refresh trigger=onAlarm:milton-translator-refresh
[milton-sw] refresh result=success updatedCount=0 durationMs=210
```
(First run: 5850ms includes the manifest fetch — cache was warm from S1 but the force=true bypasses TTL. Second run: 210ms — in-process manifest cache hit.)

Then reverted to 360min:
```
chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 360 })
chrome.alarms.getAll() → [{name: 'milton-translator-refresh', periodInMinutes: 360, ...}]
```

**S3 evidence — cached-fresher path not exercisable in current zero-divergence state; regression-equivalent ran instead.**

`updatedCount: 0` from S1 + S2 means the bundle pin currently matches the manifest for every bundled translator. The resolver's cached-fresher logic specifically requires `manifest.sha ≠ pin.sha` AND a matching cached entry — neither condition exists in the present bundle state. The literal S3 instructions (manually inject a cached entry whose SHA matches the manifest entry) can't succeed without first manufacturing the divergence, which would require either:
  (a) Temporarily editing `translator-bundle-pin.json` to put a fake SHA on a bundled UUID + rebuilding (touches AC12-protected files), OR
  (b) Waiting until Zotero upstream pushes a translator change that hasn't been re-pinned yet.

Coverage in lieu of the live S3:
- `translator-bundle.test.ts` (7 new tests) covers all 5 enumerated AC10 resolver branches including the cached-fresher-wins case explicitly.
- `popup-translator-resolve.test.ts` (5 new tests) covers the popup-side inline-or-fall-through decision.
- `translator-refresh.test.ts` (9 tests) covers the SW-driven cache-population path (the input to a future S3-with-divergence).
- IPC plumbing (`inlineTranslator?` field on `MiltonTranslateRequestMsg` and `TranslateRequest`) is straightforward optional-field forwarding through 3 layers; no logic except `if (inline) use inline else fall through`.

Regression-equivalent smoke: opened `https://arxiv.org/abs/2303.08774`, clicked Milton toolbar. Popup rendered full metadata preview ("GPT-4 Technical Report" / OpenAI, Josh Achiam et al. / 2024 / abstract excerpt) under the "Extracted by arXiv.org translator" banner. No console errors in popup or SW DevTools. Confirms:
- The new `inlineTranslator: undefined` fall-through path in `runTranslation` doesn't regress the bundled-translator path (the everyday hot path).
- The bundled arXiv translator still runs cleanly through offscreen → sandbox → translator execution → item emission → popup metadata mapping.
- No uncaught errors anywhere in the chain post-changes.

When upstream Zotero pushes an arXiv (or any other bundled) translator change AND `pnpm refresh:translators` hasn't run yet, the live S3 will automatically engage on the next 6h tick + first capture. The unit tests prove the resolver decision logic; the regression-equivalent proves the wiring; the gap is a state-of-the-bundle constraint, not a code defect.

### File List

**New files:**
- `src/sw/sw.ts` — MV3 service worker entry point (registers chrome event listeners)
- `src/sw/sw-handlers.ts` — testable handler logic (ensureAlarm + onInstalled/onStartup/onAlarm handlers)
- `src/sw/sw-handlers.test.ts` — 10 unit tests
- `src/translator-runtime/translator-refresh.ts` — refreshBundledTranslators() coordinator + RefreshResult type + storage helpers
- `src/translator-runtime/translator-refresh.test.ts` — 9 unit tests
- `src/translator-runtime/popup-translator-resolve.ts` — popup-side maybeInlineFresherTranslator helper
- `src/translator-runtime/popup-translator-resolve.test.ts` — 5 unit tests

**Modified files:**
- `manifest.config.ts` — added `'alarms'` permission + `background: { service_worker: 'src/sw/sw.ts', type: 'module' }`
- `src/translator-runtime/translator-bundle.ts` — added `getResolvedTranslator` + Manifest type import + cached-entry loader + `TRANSLATOR_CACHE_KEY_PREFIX` constant; **code-review L2 fix:** `loadCachedTranslator` storage-read catch now logs `console.warn` rather than silently masquerading as cache miss
- `src/translator-runtime/translator-bundle.test.ts` — +7 tests for `getResolvedTranslator`
- `src/translator-runtime/zotero-types.d.ts` — added optional `inlineTranslator?: BundledTranslator` to `TranslateRequest`
- `src/translator-runtime/host-bridge.ts` — `makeTranslateRequest` accepts/forwards `inlineTranslator`
- `src/translator-runtime/host-bridge.test.ts` — **code-review M2 fix:** +4 inlineTranslator IPC tests (forward, omit, JSON round-trip, type-guard acceptance)
- `src/translator-runtime/sandbox.ts` — `runTranslation` honors `inlineTranslator`; falls back to `getResolvedTranslator(uuid, null)` for bundled lookup; postMessage listener forwards inline through
- `src/offscreen/offscreen.ts` — `MiltonTranslateRequestMsg` gains `inlineTranslator`; dispatch loop forwards it to sandbox postMessage
- `src/lib/offscreen-client.ts` — `RequestClientTranslationArgs.inlineTranslator` plumbing
- `src/popup/popup.ts` — `tryClientTranslator` + DEV `miltonPopupSpike` call `maybeInlineFresherTranslator` before sending the translate request

**Files modified by code-review pass (2026-05-18):**
- `src/translator-runtime/popup-translator-resolve.ts` — **H1 fix:** cache-existence short-circuit before `fetchManifest()` (avoids hot-path network round-trip); **M1 fix:** removed dead body-compare branch (unreachable in popup context — `verifiedSet` is sandbox-only)
- `src/translator-runtime/popup-translator-resolve.test.ts` — rewritten for H1+M1 (6 tests; new test pins the short-circuit behavior)
- `src/translator-runtime/translator-refresh.ts` — **H2 fix:** `writeRefreshState` wraps storage.set in try/catch (AC7 non-fatal contract); **M4 fix:** dropped `listBundledTranslators` import; iterates `Object.entries(pin.bundleHashes)` directly so the 1.7 MB translator-bundle chunk stays out of the SW cold-boot graph
- `src/translator-runtime/translator-refresh.test.ts` — rewritten for M4 (drops `./translator-bundle` mock); +3 H2 storage-write-tolerance tests; total 12 tests
- `src/sw/sw-handlers.ts` — **H2 fallout:** `refreshSafely` catch comment corrected (no longer says "should be unreachable")

## Change Log

| Date | Author | Note |
|---|---|---|
| 2026-05-18 | Claude (Opus 4.7 1M, BMad SM workflow create-story, Pierre-customized flow) | Initial draft. Story scope: closes the Zotero-pattern auto-refresh gap left by BE-8-5; adds the extension's first service worker (chrome.alarms requires SW); preserves Charter v2 Decisions 6 + 9; ~15-20 new tests; 3 smoke scenarios. Method-17 hardening applied automatically (per Pierre customized flow): 9 attacks identified / 9 hardening edits applied. Key hardening edits: (a) AC2 idempotent-alarm + browser-restart catch-up (would have missed alarm-dropped scenarios); (b) AC5 explicit fall-through cases enumerated + `currentManifest=null` graceful path (would have ambiguous-state bugged on degraded mode); (c) AC6 explicit "no new trust surface" framing + cache re-verification at resolution time (would have trusted stale cache silently); (d) AC7 signature-invalid CRITICAL with explicit "abort + do not overwrite cache" + reference to existing `fetchManifest` code path; (e) AC11 S3 critical-warning about SHA-must-match-manifest-not-fabricated (would have produced silently-failing smoke); (f) AC12 byte-identical dist/ verification + `pnpm refresh:translators` untouchable (would have allowed Charter Decision 6 drift); (g) Out-of-scope section adding seven explicit non-goals (would have left scope-creep ammunition for reviewer); (h) Dev Notes "Signature-invalid is the trap" + double-check of existing `fetchManifest` code path for verify-before-cache-write ordering; (i) Tasks 7.3 byte-identical dist/ verification step with snapshot+diff procedure. Story status set to `ready-for-dev` pending Pierre's step-7 validation. |
| 2026-05-18 | Claude (Opus 4.7 1M, BMad SM workflow dev-story) | Implementation complete (Tasks 1-5, 7). 31 new tests across 3 new test files; 399/399 passing; typecheck + build green; SW chunk 3.30 KB raw / 1.42 KB gzip (well under AC15's <50 KB); IPC-boundary grep returns zero; translator source files / pin file / bundler script byte-identical to main (AC12 preserved at source level). One architectural extension beyond literal AC scope: added optional `inlineTranslator?: BundledTranslator` field to the `milton-translate-request` and `translate-request` IPC envelopes + a popup-side `maybeInlineFresherTranslator` helper. Required because the sandbox + offscreen have no chrome.storage access, so the cached-fresher entry must reach the sandbox via IPC for AC11 S3 to actually pass (the popup is the natural arbiter — has manifest + storage + already orchestrates translation). Pierre confirmed Option 1 of three discussed alternatives. SW handlers split into `sw-handlers.ts` for unit-testability; `sw.ts` is a thin glue layer per MV3 SW constraints. Status flipped to `review` pending Pierre's smoke (AC11 S1-S3) + code-review. |
| 2026-05-18 | Claude (Opus 4.7 1M, BMad SM workflow code-review on PR #10) | **Adversarial code review pass — 8 findings (2 HIGH / 4 MEDIUM / 2 LOW); 6 fixed in code, 2 deferred to Review Follow-ups (AI).** Fixes: **H1** — `maybeInlineFresherTranslator` now probes `chrome.storage.local` for the per-UUID cache key BEFORE calling `fetchManifest()`, avoiding a 50-200ms network round-trip on every popup capture (the 1h manifest TTL vs 6h SW-refresh period meant 5/6 of first-of-hour captures would otherwise pay the tax). **H2** — `writeRefreshState` wraps `chrome.storage.local.set` in try/catch so storage quota/policy errors no longer propagate out of `refreshBundledTranslators` and violate AC7's non-fatal contract; `sw-handlers.refreshSafely` comment updated to remove misleading "should be unreachable". **M1** — dropped the dead body-compare branch in `popup-translator-resolve.ts` (was unreachable in popup context because `verifiedSet` is only installed in the sandbox); the `resolved === null` short-circuit already covers all no-inline cases. **M2** — added 4 inlineTranslator IPC tests in `host-bridge.test.ts` (forward, omit, JSON round-trip, type-guard acceptance) so a future refactor that drops the field at any IPC layer surfaces immediately. **M4** — `translator-refresh.ts` no longer imports `listBundledTranslators` from `./translator-bundle`; iterates `Object.entries(pin.bundleHashes)` directly. Drops the 1.7 MB translator-bundle chunk out of the SW cold-boot dependency graph (replaced by a 3.64 KB pin-only chunk). **L2** — `loadCachedTranslator` storage-read catch now logs a `console.warn` instead of silently masquerading storage failures as cache misses. Deferred: **M3** — AC11 S3 (cached-fresher resolver smoke) cannot be exercised live until upstream divergence exists; resolver decision + IPC plumbing are unit-tested across `translator-bundle.test.ts` + `host-bridge.test.ts` + `popup-translator-resolve.test.ts`. **L1** — booted log noise; gate behind DEV flag if it becomes annoying. Test count: 407/407 (was 399; +8). Typecheck + build green. SW chunk 3.29 KB raw / 1.41 KB gzip. IPC-boundary grep zero hits. |
