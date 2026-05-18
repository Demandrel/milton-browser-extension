# Story BE-8.9: Background auto-refresh of bundled translators

Status: ready-for-dev

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

- [ ] **Task 1 — Add service worker scaffolding** (AC: #1)
  - [ ] 1.1 Create `src/sw/sw.ts` with SPDX header + an `export {}` so it parses as a module. Initial body: `console.log('[milton-sw] booted')` (verify scaffolding before logic).
  - [ ] 1.2 Update `manifest.config.ts`:
    - Add `'alarms'` to the `permissions` array (alphabetize within the existing list; comment the addition with `// BE-8-9 — chrome.alarms for periodic translator refresh`).
    - Add `background: { service_worker: 'src/sw/sw.ts', type: 'module' }` per CRXJS MV3 convention.
  - [ ] 1.3 Run `pnpm build`; verify `dist/service-worker-loader.js` appears + the SW chunk; sideload `dist/` in `chrome://extensions`; click `Service worker` link; verify console shows `[milton-sw] booted`. If CRXJS wraps the SW under a different filename, document the actual path in Completion Notes (don't fight the framework).

- [ ] **Task 2 — Implement refresh module** (AC: #3, #4, #6, #7)
  - [ ] 2.1 Create `src/translator-runtime/translator-refresh.ts` with SPDX header.
  - [ ] 2.2 Import `listBundledTranslators`, `fetchManifest`, `fetchTranslatorFromCdn`, `MIRROR_BASE_URL`, plus the existing `TranslatorFetcherError` type.
  - [ ] 2.3 Define + export `RefreshResult` type: `{ lastRefreshAt: number, lastRefreshResult: 'success' | 'manifest-fetch-failed' | 'signature-invalid' | 'partial', updatedCount: number, perUuidErrors?: Record<string, string>, durationMs: number }`.
  - [ ] 2.4 Implement `async function refreshBundledTranslators(): Promise<RefreshResult>` per AC3/4/7 logic:
    - Start timer.
    - Try `fetchManifest(force=true)`; on `SIGNATURE_INVALID` → return `'signature-invalid'` result + log at `error`. On other failures → return `'manifest-fetch-failed'` result + log at `warn`.
    - Iterate `listBundledTranslators()`; per-translator compare SHA; collect updates + per-UUID errors.
    - Compute `updatedCount`; if `perUuidErrors` non-empty → `'partial'`, else `'success'`.
    - Persist the result to `chrome.storage.local['translator-refresh-state']` atomically.
    - Return the result.
  - [ ] 2.5 Add structured logging using a `[milton-refresh]` prefix on every log line so SW-console searches are clean.

- [ ] **Task 3 — Wire SW install + startup + alarm hooks** (AC: #2)
  - [ ] 3.1 In `src/sw/sw.ts`, import `refreshBundledTranslators` from `../translator-runtime/translator-refresh`.
  - [ ] 3.2 Implement an `ensureAlarm()` helper: `const existing = await chrome.alarms.get('milton-translator-refresh'); if (!existing) await chrome.alarms.create('milton-translator-refresh', { periodInMinutes: 360 })`. Idempotent.
  - [ ] 3.3 Register `chrome.runtime.onInstalled.addListener` → `await ensureAlarm(); await refreshBundledTranslators()`.
  - [ ] 3.4 Register `chrome.runtime.onStartup.addListener` → `await ensureAlarm()`; then read `chrome.storage.local['translator-refresh-state'].lastRefreshAt`; if older than 6h (or undefined) → `await refreshBundledTranslators()`.
  - [ ] 3.5 Register `chrome.alarms.onAlarm.addListener` → on alarm name `'milton-translator-refresh'` → `await refreshBundledTranslators()`.
  - [ ] 3.6 Wrap each handler in a top-level try/catch that logs + swallows — uncaught SW errors get the SW marked as "errored" by Chrome, which kills the alarm dispatch.

- [ ] **Task 4 — Implement cached-fresher resolver** (AC: #5, #6, #9)
  - [ ] 4.1 Decide whether to extend `translator-bundle.ts` or add `translator-resolver.ts`. Default recommendation: extend `translator-bundle.ts` (keeps the resolver near the bundled-translator API; one fewer file to navigate). Document the choice in Completion Notes either way.
  - [ ] 4.2 Add the `BundleHashes` type import from `translator-bundle-pin.json` (already imported there).
  - [ ] 4.3 Implement `export async function getResolvedTranslator(translatorID: string, currentManifest: Manifest | null): Promise<BundledTranslator | null>` per AC5 resolution order.
  - [ ] 4.4 The cached-entry-to-`BundledTranslator` adapter: the cache shape `{metadata, body, sha256, fetchedAt}` (from `translator-fetcher.ts:92-97`) maps to `BundledTranslator: {metadata, source}` (use `body` as `source`). Same shape consumers already expect.
  - [ ] 4.5 Migrate call sites: grep `src/` for `getBundledTranslator(` (excluding tests). Each non-test call site migrates to `getResolvedTranslator(uuid, manifest)`. The popup/SW already has access to `fetchManifest()` results; pass them through. Sandbox `runTranslation` should pass `currentManifest: null` because the sandbox itself never calls `fetchManifest` (CSP) — the cached-fresher check happens in the popup/SW message handler before delegating to the sandbox.

- [ ] **Task 5 — Tests** (AC: #10)
  - [ ] 5.1 Add `translator-refresh.test.ts` with the four cases enumerated in AC10. Mock `fetchManifest` + `fetchTranslatorFromCdn` + `chrome.storage.local`. Use the existing test-storage shim pattern from `translator-fetcher.test.ts`.
  - [ ] 5.2 Extend `translator-bundle.test.ts` with the five `getResolvedTranslator` cases enumerated in AC10. Use `_setVerifiedSet` + `_resetForTests` seams already in `translator-bundle.ts:270,278`.
  - [ ] 5.3 SW test: best-effort `sw.test.ts` mocking `chrome.alarms.{get,create,onAlarm}` + `chrome.runtime.{onInstalled,onStartup}`. If the mock surface is too lossy to give confidence, document in Completion Notes that SW behavior is smoke-only-verified (S1/S2 in AC11) and skip the unit test.
  - [ ] 5.4 Run `pnpm test`; verify all existing tests still pass + new tests pass. Document the new total test count in Completion Notes.

- [ ] **Task 6 — Manual smoke** (AC: #11)
  - [ ] 6.1 Execute S1 (install-time refresh) per AC11; paste the observed SW console log + the `translator-refresh-state` value into Completion Notes.
  - [ ] 6.2 Execute S2 (alarm fires) per AC11; paste the `chrome.alarms.getAll` output + the override-and-revert sequence + the observed log into Completion Notes. **CRITICAL: confirm the alarm is reset to `periodInMinutes: 360` before closing the SW console.**
  - [ ] 6.3 Execute S3 (cached-fresher resolver wins) per AC11; paste the injected `translator-fetched:*` entry + the sandbox console log proving the cached body executed + the cleanup `chrome.storage.local.remove` confirmation into Completion Notes.

- [ ] **Task 7 — Final verification + cleanup** (AC: #1, #12, #14, #15)
  - [ ] 7.1 `pnpm typecheck && pnpm test && pnpm build` all clean.
  - [ ] 7.2 IPC-boundary grep per AC14 — paste the (empty) output into Completion Notes.
  - [ ] 7.3 Verify AC12 byte-identical translators in `dist/`: pre-build a snapshot of `dist/assets/translator-*.js` (or whatever the CRXJS-generated filenames are; document); post-build, `diff` confirms no changes to translator bytes. SW chunk + resolver call sites are the only diffs.
  - [ ] 7.4 Pre-Review Self-Check (AC15 items + the template's standard items).
  - [ ] 7.5 Update `package.json` if any new devDependency was added (none expected — alarms is a chrome.* API, no library needed).

- [ ] **Task 8 — Story closeout** (Pierre-customized flow)
  - [ ] 8.1 PR opens as non-draft (per CLAUDE.md Rule 3); body includes the AC checklist + smoke evidence from Task 6.
  - [ ] 8.2 Background-watch CI per CLAUDE.md Rule 7 (`gh run watch <id> --exit-status` in background bash, NOT polled).
  - [ ] 8.3 `/bmad_bmm_code-review` on the OPEN PR (per memory `feedback-code-review-required-before-done`); fix HIGH findings; re-watch CI.
  - [ ] 8.4 After PR-side green + code-review green, merge; background-watch post-merge main CI (CLAUDE.md Rule 7 / memory `feedback-monitor-post-merge-ci-on-main`).
  - [ ] 8.5 Post-merge: `chore(BE-8-9): mark done` on `main` (the established pattern; see `git log --oneline | grep 'mark done'`).

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

- [ ] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke) — **N/A this story; no UI changes**
- [ ] File list in story matches actual files changed
- [ ] No raw hex color values — all colors use PandaCSS tokens — **N/A; no CSS changes**
- [ ] `$effect` dependencies checked against async boundaries (no split reactive state across `await`) — **N/A; vanilla TS, no Svelte**
- [ ] Superforms tests use real adapter (not mocked) — **N/A; no Superforms**
- [ ] Barrel imports only — no direct imports from `features/*/utils/` — **N/A; no `features/` dir convention here**
- [ ] No type casts (`as any`, `as unknown as T`) in new production code — test mocks excepted per team agreement
- [ ] Error paths handled — all async operations have try/catch or .catch()
- [ ] IPC command results checked for error states before use — **N/A; no IPC commands added**
- [ ] Loading states span full async lifecycle (set before await, cleared in finally) — **N/A; no UI loading states (observability is SW-console only)**
- [ ] **Story-specific:** `pnpm build` warning-free; SW chunk size noted in Completion Notes (expect <50 KB)
- [ ] **Story-specific:** `dist/` translator bytes byte-identical to pre-story build (verifies AC12 — Charter Decision 6 preservation)
- [ ] **Story-specific:** SW DevTools console (after sideload) shows no uncaught errors during a typical capture session

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Author | Note |
|---|---|---|
| 2026-05-18 | Claude (Opus 4.7 1M, BMad SM workflow create-story, Pierre-customized flow) | Initial draft. Story scope: closes the Zotero-pattern auto-refresh gap left by BE-8-5; adds the extension's first service worker (chrome.alarms requires SW); preserves Charter v2 Decisions 6 + 9; ~15-20 new tests; 3 smoke scenarios. Method-17 hardening applied automatically (per Pierre customized flow): 9 attacks identified / 9 hardening edits applied. Key hardening edits: (a) AC2 idempotent-alarm + browser-restart catch-up (would have missed alarm-dropped scenarios); (b) AC5 explicit fall-through cases enumerated + `currentManifest=null` graceful path (would have ambiguous-state bugged on degraded mode); (c) AC6 explicit "no new trust surface" framing + cache re-verification at resolution time (would have trusted stale cache silently); (d) AC7 signature-invalid CRITICAL with explicit "abort + do not overwrite cache" + reference to existing `fetchManifest` code path; (e) AC11 S3 critical-warning about SHA-must-match-manifest-not-fabricated (would have produced silently-failing smoke); (f) AC12 byte-identical dist/ verification + `pnpm refresh:translators` untouchable (would have allowed Charter Decision 6 drift); (g) Out-of-scope section adding seven explicit non-goals (would have left scope-creep ammunition for reviewer); (h) Dev Notes "Signature-invalid is the trap" + double-check of existing `fetchManifest` code path for verify-before-cache-write ordering; (i) Tasks 7.3 byte-identical dist/ verification step with snapshot+diff procedure. Story status set to `ready-for-dev` pending Pierre's step-7 validation. |
