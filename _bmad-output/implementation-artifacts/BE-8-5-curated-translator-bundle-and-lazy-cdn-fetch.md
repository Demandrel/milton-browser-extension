# Story BE-8.5: Curated translator bundle + lazy CDN-fetch

Status: ready-for-dev

<!-- BMad SM workflow create-story output. Method-17 hardening pass: see Change Log. -->

## Story

As a **Pierre dogfooding BE-v2 across the publishers in Charter v2's Class 2/3 coverage table**,
I want the extension to **carry ~50–100 curated translators in the .crx and lazily fetch the long-tail from `translators.milton.so` on demand**,
so that **the first capture on any covered publisher is instant (no network round-trip) AND the long-tail of niche publishers still works (without bundling 743 files in the .crx)**.

## Acceptance Criteria

1. **Curated bundle is build-time generated, not hand-vendored.** A new script `scripts/refresh-translator-bundle.ts` (run via `pnpm refresh:translators`) takes the curated UUID list, fetches each translator from `https://translators.milton.so/repo/code/{id}`, verifies the per-translator SHA-256 against `/repo/metadata`, verifies the manifest's Ed25519 signature against the embedded public key, and writes the verified bytes (with their upstream BEGIN-LICENSE-BLOCK preserved verbatim) to `src/translator-runtime/translators/`. Committed files are the source of truth for the build; the script is a refresh tool, not a CI step.

2. **Curated UUID list lives in a single source file** at `src/translator-runtime/curated-translators.txt` — one UUID per line, `#`-prefixed comment lines allowed, alphabetized by label in a comment block adjacent to each UUID. **The seed list below IS the AC pass criterion** (dev-agent ships this verbatim if Pierre's 30-min review window in Task 1.3 lapses; Pierre can edit + re-bundle post-merge). Seed list (25 entries — under the 50–100 target but covers the publishers Pierre actually reads; growth is a post-MVP follow-up, NOT BE-8-5 scope): arXiv (already vendored), DOI Content Negotiation, Embedded Metadata, COinS, unAPI, Open Graph, the Elsevier suite (ScienceDirect, ScienceDirect XHR, Mendeley), Wiley Online Library, Springer Nature (Springer Link, Nature), PubMed, PubMed Central, SSRN, JSTOR, IEEE Xplore, ACM Digital Library, Sage Journals, Taylor & Francis+NEJM, bioRxiv/medRxiv, Cell Press, Oxford Academic, Cambridge Core, ProjectMUSE, RePEc IDEAS, econstor, NBER.

3. **Manifest pin is stored in a committed file** at `translator-bundle-pin.json` (repo root) — JSON shape `{"upstreamCommit": "<40-char-hex-sha>", "fetchedAt": "<ISO-8601 UTC>", "publicKey": "<base64-encoded Ed25519 pubkey>", "bundleHashes": {"<uuid>": "<sha256-hex>"}}`. The script writes this file atomically after a successful refresh. The committed `bundleHashes` map mirrors what `translator-bundle.ts` will assert at runtime (defense-in-depth against accidental committed-file tamper).

4. **Refresh script enforces atomic success.** If ANY translator in the curated list fails signature verification, hash verification, or returns non-200, the script writes nothing and exits non-zero. Partial bundle states are forbidden. Re-running after a partial failure must produce a byte-identical output (idempotent).

5. **`translator-bundle.ts` registry is auto-generated.** The script regenerates the `REGISTRY` const literal in `src/translator-runtime/translator-bundle.ts` to include all curated UUIDs (replacing the hand-coded `{ arxiv: { source: arxivSource } }`). Vite `?raw` imports are added per translator with stable filenames matching the slugged translator label (e.g., `arxiv-org.js`, `doi-content-negotiation.js`). The generation block is delimited by `// GENERATED-START / // GENERATED-END` markers so a future contributor can re-run the script without overwriting hand-written sections of the file.

6. **Runtime sanity-check on bundle integrity — verified ONCE at sandbox bootstrap.** `translator-bundle.ts` exports `async verifyAllBundleIntegrity(): Promise<Set<string>>` — this is called by `sandbox.ts` during bootstrap (after `loadFrameworkSync()`, before any `translator-request` handler arms). It iterates every `REGISTRY` entry, computes `crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))`, hex-compares to `pin.bundleHashes[uuid]`, and returns the set of UUIDs that verified successfully. `getBundledTranslator(id)` (still sync — no API change for downstream callers) consults a module-level `verifiedSet: Set<string> | null` and returns null for any UUID not in it. On verification failure of any UUID: log to console with the failing UUID + expected-vs-actual hash. If `verifiedSet === null` (bootstrap hasn't run yet), `getBundledTranslator` returns null defensively (caller falls back to lazy-fetch). Rationale: pre-verifying at bootstrap avoids both the async-API churn in `runTranslation` AND a race condition where two concurrent first-calls both compute the digest.

7. **Lazy CDN-fetch path delivers long-tail translators.** A new module `src/translator-runtime/translator-fetcher.ts` exports `fetchTranslatorFromCdn(id: string): Promise<BundledTranslator>`. It (a) fetches `/repo/metadata` (cached in `chrome.storage.local` keyed `translator-mirror-metadata` with 1-hour TTL aligned with CDN `Cache-Control`), (b) verifies the manifest's Ed25519 signature against the embedded public key on every fetch (cached metadata is re-verified on each load — signature verify is microseconds), (c) locates the UUID in the manifest, returns `null` if not present (caller falls back), (d) fetches `/repo/code/{id}`, (e) verifies SHA-256 against the manifest entry, (f) caches the verified `{metadata, body, sha256, fetchedAt}` tuple in `chrome.storage.local` keyed `translator-fetched:{uuid}` with a 7-day TTL. **Pin scope is build-time-only** — lazy-fetched translators are verified against the CURRENT manifest's signature + sha256, NOT against `translator-bundle-pin.json`'s `upstreamCommit`. Rationale: bundled subset is pinned for reproducible builds (Charter v2 Decision 6); long-tail tracks the live mirror. **Bundled-vs-lazy is mutually exclusive** — if `verifiedSet.has(uuid)` returns true, lazy-fetch is skipped (the bundle wins). This prevents mixed-pin confusion AND saves a round-trip.

8. **Cache invalidation is hash-driven, not time-driven.** When metadata refreshes (TTL expired or first fetch), if a cached translator's UUID still exists in the new manifest but its `sha256` differs, the cached entry is evicted and re-fetched on next use. Time-based TTL is a fallback only. **Quota guard:** after every `chrome.storage.local.set`, check `chrome.runtime.lastError`; on `QUOTA_BYTES exceeded`, LRU-evict the oldest `translator-fetched:*` entries (by `fetchedAt`) until the write succeeds, capped at 50 cached entries total. Bundle of 25 + lazy cap of 50 stays well under the 10 MB default quota — no need to request `unlimitedStorage` permission.

9. **Sandbox load path falls back gracefully.** `sandbox.ts:runTranslation` is amended to try `getBundledTranslator(id)` first; on `null` result it posts a `translator-load-request` to its parent (popup/SW), awaits a `translator-load-response` carrying `{metadata, body}` (or `{error}`), and registers the returned translator via `registerTranslator()` exactly as for bundled. Sandbox itself NEVER fetches from `translators.milton.so` directly (opaque-origin CSP would block it); the popup/SW context owns the network.

10. **postMessage protocol v2 adds two message types**: `translator-load-request {requestId, translatorId}` and `translator-load-response {requestId, translator?, error?}`. `PROTOCOL_VERSION` bumps from 1 to 2. Type guards `isTranslatorLoadRequest()` + `isTranslatorLoadResponse()` are added to `host-bridge.ts` alongside the existing four. All v1 messages remain accepted (translate-request etc. carry `protocolVersion: 1 | 2`; v2 is the default for newly-emitted messages). `isFromExpectedSource()` gating applies identically to the new message types.

11. **Curated bundle size budget: ≤2 MB gzipped sandbox-page chunk.** `pnpm build` output must show the sandbox chunk under 2 MB compressed (BE-8-4 baseline was 235 kB gzipped with arXiv only; budget allows ~8× growth for ~100 translators). If exceeded, the dev-agent must reduce the curated list and surface the size delta in Completion Notes (not silently ship a bloated bundle).

12. **Manifest `host_permissions` adds `https://translators.milton.so/*`.** Required for `chrome.storage.local`-cached translator fetches from popup/SW context. The pattern is narrow (single host, no wildcards beyond path). Update `manifest.config.ts` Line 28 list.

13. **AGPL §6 compliance preserved.** Vendored translator files retain their upstream `BEGIN LICENSE BLOCK ... END LICENSE BLOCK` comments verbatim. The repo `COPYING` (AGPL-3.0-or-later) covers Milton's own additions. README is updated with a short "Bundled translators" section pointing to the upstream `zotero/translators` repo + the `translators.milton.so` mirror + the current `upstreamCommit` SHA from `translator-bundle-pin.json` (this gives a recipient of the .crx the §6 "complete corresponding source" they're entitled to).

14. **Pre-Review Self-Check items extended.** Add three items: (a) curated UUID list reviewed by Pierre, (b) `pnpm refresh:translators` is idempotent (run twice, second run produces zero file changes — verified locally), (c) sandbox-chunk gzipped size delta documented in Completion Notes vs BE-8-4 baseline (235 kB).

15. **Test coverage.** Unit tests added for: (a) `translator-fetcher.ts` happy path (mock fetch + verify signature stub + sha256 verify); (b) `translator-fetcher.ts` rejection paths (signature fail, hash mismatch, UUID missing in manifest, 404 from CDN, 5xx from CDN, network failure); (c) `translator-bundle.ts` runtime integrity-check rejection (mutated source vs pin); (d) `host-bridge.ts` new message types round-trip + isFromExpectedSource gating + type-guard rejection of v1-only messages stamped with `protocolVersion: 3`; (e) `sandbox.ts` fallback flow (bundled miss → posts translator-load-request → registers returned translator → translation proceeds). Vitest count target: ≥175 (current baseline 153).

16. **Smoke (Pierre G17-1 manual) — three scenarios, all PASS required before review:**
    - **S1 bundled-hit:** open chrome://extensions, load unpacked `dist/`; in sandbox console run `miltonRuntimeSpike('https://arxiv.org/abs/2303.08774')` — items returned without `translator-load-request` fired (verify via console log added to the lazy path).
    - **S2 lazy-fetch hit:** in sandbox console run `miltonRuntimeSpike('https://www.science.org/doi/10.1126/science.aar3247')` (or another publisher KNOWN to be in the CDN's 743 but NOT in the bundle) — items returned; verify `translator-load-request/response` round-trip in console; verify `chrome.storage.local` has a `translator-fetched:{uuid}` entry.
    - **S3 unknown URL:** run `miltonRuntimeSpike('https://example.com/some-random-page')` — `null` returned from `Zotero.Translators.getWebTranslators` (no translator matches); no lazy-fetch fired (lazy-fetch is by UUID, not URL match — UUID-by-URL discovery is BE-8-6's territory). Sandbox emits a clean error `{code: 'NO_TRANSLATOR', message: 'No translator matched URL ...'}`.

17. **Regression: BE-8-4 arXiv spike still works exactly as before.** S1 above doubles as regression confirmation. `pnpm test` shows all 153 BE-8-4 tests still pass alongside the new BE-8-5 tests.

18. **IPC-boundary self-check (charter v2 standing rule).** `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returns zero hits. No imports from Milton-desktop. Network calls go to `translate.milton.so` (existing) + `translators.milton.so` (new) + `127.0.0.1:7521` (existing connector) only.

## Tasks / Subtasks

- [ ] **Task 1 — Decide curated UUID list v1** (AC: #2)
  - [ ] 1.1 Draft `src/translator-runtime/curated-translators.txt` from the AC2 seed list (one UUID per line + `#` comment for label)
  - [ ] 1.2 Cross-check each UUID against `https://translators.milton.so/repo/metadata` to confirm presence and correct label spelling
  - [ ] 1.3 Pause and surface the draft list to Pierre via a single console message (`---DRAFT CURATED LIST---` block) — wait for explicit Pierre go-ahead before proceeding. Timebox the curation iteration to 30 minutes; if Pierre's review doesn't return, ship the seed list and flag for post-merge tweak.

- [ ] **Task 2 — Implement Ed25519 signature verification primitive** (AC: #1, #3, #7)
  - [ ] 2.1 Pin `@noble/ed25519@^1.7.3` (NOT 2.x — 1.x has built-in SHA-512; 2.x requires manual `ed.etc.sha512Sync` wire-up which is an extra trap. ~10 kB unminified, BSD-2, no native deps). Add to `package.json` `dependencies` (NOT devDependencies — runs at runtime for AC7 cache verify). Run `pnpm add @noble/ed25519@^1.7.3` to install.
  - [ ] 2.2 Implement `verifyManifestSignature(manifestBytes: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>` in a new file `src/translator-runtime/manifest-verify.ts` with SPDX header. The 1.x API: `import * as ed from '@noble/ed25519'; const ok = await ed.verify(signature, manifestBytes, publicKey)` — returns Promise<boolean>; throws only on malformed inputs (catch and return false). DO NOT use `ed.verifySync` (1.x has no sync variant — async is the only path).
  - [ ] 2.3 **Fixture generation — timebox 10 min.** Run: `curl -s https://translators.milton.so/repo/metadata > src/translator-runtime/__fixtures__/manifest.fixture.json` and `curl -s https://translators.milton.so/repo/metadata.sig > src/translator-runtime/__fixtures__/manifest.fixture.sig`. Embed the production public key (base64) as a constant `MANIFEST_FIXTURE_PUBKEY` at the top of `manifest-verify.test.ts` with a doc comment: `// FIXTURE: pinned upstreamCommit=<sha from fixture>; pubkey is mirror's production Ed25519. If signing key rotates per BE-8-1 AC9, regenerate via the curl commands above. Tests verify offline against THIS fixture — never hit live CDN in tests.` This makes the test stable against key rotation (regen is 10 lines of curl), and explicit about its scope.

- [ ] **Task 3 — Implement `scripts/refresh-translator-bundle.ts`** (AC: #1, #3, #4, #5)
  - [ ] 3.1 Add SPDX `AGPL-3.0-or-later` header (matches `add-spdx-headers.sh` pattern; the script is Milton-authored, not vendored)
  - [ ] 3.2 Read `src/translator-runtime/curated-translators.txt`; parse UUIDs; validate count is in `[5, 200]` (sanity bound)
  - [ ] 3.3 Fetch `/repo/metadata` + `/repo/metadata.sig` from `https://translators.milton.so/`; verify Ed25519 signature against embedded public key constant (hardcoded in the script + cross-checked against `translator-bundle-pin.json` if it exists, to catch key rotation)
  - [ ] 3.4 For each curated UUID: locate in manifest, fetch `/repo/code/{id}`, verify SHA-256, write to `src/translator-runtime/translators/{slug}.js` (slug derived from manifest `label` field, kebab-cased, ASCII-only). **Slug collision rule: fail-loud.** If two UUIDs slug to the same filename, the script EXITS NON-ZERO with a message naming both UUIDs + labels. No silent hash-suffix; a collision implies a curation mistake (e.g., two variants of the same publisher) — Pierre disambiguates by removing one UUID from `curated-translators.txt` or by adding a `# slug-override: <name>` comment line above the offending UUID, which the script honors as an explicit slug override.
  - [ ] 3.5 Regenerate the `REGISTRY` block in `src/translator-runtime/translator-bundle.ts` between `// GENERATED-START` and `// GENERATED-END` markers; preserve the rest of the file verbatim
  - [ ] 3.6 Write `translator-bundle-pin.json` atomically (write to `.tmp`, then `fs.rename`); ensure JSON is sorted-key + 2-space-indented for deterministic diffs
  - [ ] 3.7 On ANY verification failure: rollback any partial writes (track tmp files in a try/finally with cleanup), log the failure, exit non-zero
  - [ ] 3.8 Add `pnpm refresh:translators` script entry to `package.json`. **Runner choice:** check Node version in CI's `.github/workflows/ci.yml` `actions/setup-node` config first. If Node ≥22, use `"refresh:translators": "node --experimental-strip-types scripts/refresh-translator-bundle.ts"` (zero new deps — Node 22+ has native TS stripping). If Node <22, add tsx: `pnpm add -D tsx@^4` and use `"refresh:translators": "tsx scripts/refresh-translator-bundle.ts"`. Don't blindly add tsx if it's already a transitive dep via vitest (run `pnpm why tsx` first); blind addition risks version conflict.
  - [ ] 3.9 Run twice in a row locally; verify byte-identical output (no file changes on second run, no whitespace drift)

- [ ] **Task 4 — Wire runtime integrity check (bootstrap-time, not lazy)** (AC: #6)
  - [ ] 4.1 Import `translator-bundle-pin.json` as a typed JSON module in `translator-bundle.ts` (Vite handles JSON imports natively; add `resolveJsonModule: true` to tsconfig if not already set — `tsc --showConfig | grep resolveJsonModule` to verify)
  - [ ] 4.2 Add `export async function verifyAllBundleIntegrity(): Promise<Set<string>>` that iterates every `REGISTRY` entry, computes `crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))`, hex-compares to `pin.bundleHashes[uuid]`, returns the set of UUIDs that verified. Add a module-level `let verifiedSet: Set<string> | null = null` and a helper `_setVerifiedSetForTests(s)` test seam.
  - [ ] 4.3 Modify `getBundledTranslator(id)` to check `verifiedSet?.has(id) === true` before returning the entry. On no-verified-set OR uuid-not-in-set, return null (lazy-fetch recovery; do NOT throw). API stays sync — no caller churn.
  - [ ] 4.4 In `sandbox.ts:bootstrap()`, after `loadFrameworkSync()` and before `wirePostMessageListener()`, await `verifyAllBundleIntegrity()` and stash the result via the test seam. Log `[milton-sandbox] bundle integrity: N/M translators verified` (N = verified count, M = registry count). If N < M, log the failing UUIDs at WARN level — don't crash; the lazy path is the recovery.
  - [ ] 4.5 Unit-tests: (a) mutate a `REGISTRY[uuid].source` string, run `verifyAllBundleIntegrity()`, assert the mutated UUID is NOT in the returned set + console log fired; (b) `getBundledTranslator(uuid)` returns null for UUIDs not in `verifiedSet`; (c) `getBundledTranslator(uuid)` returns null when `verifiedSet === null` (bootstrap-not-run defense).

- [ ] **Task 5 — Implement `translator-fetcher.ts` lazy CDN-fetch** (AC: #7, #8)
  - [ ] 5.1 New file `src/translator-runtime/translator-fetcher.ts` with SPDX header
  - [ ] 5.2 Implement `fetchManifest(): Promise<Manifest>` — reads from `chrome.storage.local['translator-mirror-metadata']` if present and `Date.now() - fetchedAt < 1h`, else fetches + verifies signature + caches. **Use Promise-style storage API** (`await chrome.storage.local.get(['translator-mirror-metadata'])` and `await chrome.storage.local.set({...})`) — supported on all MV3 Chromium ≥88, which is our floor.
  - [ ] 5.3 Implement `fetchTranslatorFromCdn(id: string): Promise<BundledTranslator | null>` — uses cached manifest, returns null if UUID not in manifest, fetches `/repo/code/{id}`, verifies SHA-256, caches in `chrome.storage.local['translator-fetched:{uuid}'] = {metadata, body, sha256, fetchedAt}`
  - [ ] 5.4 **Cache invalidation + quota guard.** On `fetchManifest` refresh: walk all `translator-fetched:*` keys (via `chrome.storage.local.get(null)` to enumerate, then filter by prefix), evict any whose UUID's sha256 in the new manifest differs from cached value. After every `chrome.storage.local.set`, check the next-tick `chrome.runtime.lastError` (or catch the rejected promise) — on `QUOTA_BYTES exceeded`, LRU-evict oldest `translator-fetched:*` entries by `fetchedAt` until the write succeeds. Hard cap: 50 cached entries — on the 51st add, drop the LRU before the write.
  - [ ] 5.5 7-day TTL on `translator-fetched:*` entries (eviction on use, not eager — keep the storage walker simple)
  - [ ] 5.6 Unit tests: happy path (mock fetch), 404 (returns null), 5xx (throws with `{code:'CDN_5XX'}`), signature failure (throws `{code:'SIGNATURE_INVALID'}`), hash mismatch (throws `{code:'HASH_MISMATCH'}`), network failure (throws `{code:'NETWORK_ERROR'}`), quota-exceeded (mock `chrome.storage.local.set` to reject with `QUOTA_BYTES`; assert LRU eviction + retry).
  - [ ] 5.7 Timebox: if the cache-eviction logic balloons past 50 LOC, simplify to "evict everything on manifest pin change" (charter says "graceful fallback", not "optimal cache locality")

- [ ] **Task 6 — Extend postMessage protocol to v2** (AC: #10)
  - [ ] 6.1 In `host-bridge.ts`: bump `PROTOCOL_VERSION` to `2 as const`
  - [ ] 6.2 Define `TranslatorLoadRequest` + `TranslatorLoadResponse` types in `zotero-types.d.ts` mirroring the existing translate-request/response shapes (include `requestId`, `protocolVersion`)
  - [ ] 6.3 Add `isTranslatorLoadRequest()` + `isTranslatorLoadResponse()` type guards accepting `protocolVersion: 1 | 2` (v1 listeners stay valid)
  - [ ] 6.4 Add `makeTranslatorLoadRequest()` + `makeTranslatorLoadResponse()` constructors
  - [ ] 6.5 Update `isTranslateRequest()` etc. to accept `protocolVersion: 1 | 2` (forward-compat for v2 emitters)
  - [ ] 6.6 Unit tests: round-trip for both new types + cross-version guards (v1 message accepted by v2 listener; v3 message rejected)

- [ ] **Task 7 — Wire sandbox fallback path** (AC: #9)
  - [ ] 7.1 In `sandbox.ts:runTranslation`: after `getBundledTranslator(id)` returns null, post `translator-load-request` to `window.parent` and await response (timeout: 10 s, abort with `TranslatorLoadTimeoutError`)
  - [ ] 7.2 On `translator-load-response` with `translator`, call `registerTranslator(translator)` and continue translation flow
  - [ ] 7.3 On `translator-load-response` with `error`, throw with `{code: 'TRANSLATOR_UNAVAILABLE', message: error.message}`
  - [ ] 7.4 Apply `isFromExpectedSource(event, [window.parent])` gating on the response listener (same pattern as existing translate-request listener)
  - [ ] 7.5 Add a fetch-proxy / popup-side handler for `translator-load-request`. For BE-8-5, the handler lives in `src/translator-runtime/spike-page.ts` (the existing fetch-proxy) so the spike harness exercises the full path. **Scope cut-line:** this is SPIKE-ONLY infrastructure for AC16 S2 smoke. Mark the new handler block with `// SPIKE-ONLY: BE-8-6 supersedes (production handler moves to popup/SW context)`. BE-8-6 is free to delete the spike-page handler when its production handler lands — don't over-engineer for popup/SW reuse here.

- [ ] **Task 8 — Update manifest + README** (AC: #12, #13)
  - [ ] 8.1 Add `https://translators.milton.so/*` to `manifest.config.ts` `host_permissions` array
  - [ ] 8.2 **Check `ls README.md` first.** If README.md exists, APPEND a `## Bundled translators` section preserving all existing content (read first, then Edit to append — NEVER `Write` unconditionally). If it doesn't exist, create a minimal README with the bundled-translators section. Content cites the upstream `zotero/translators` repo, the `translators.milton.so` mirror, the current pinned `upstreamCommit` SHA, AGPL-3.0-or-later license inheritance, and the `pnpm refresh:translators` command.
  - [ ] 8.3 Add a short `docs/translator-bundling.md` (if `docs/` doesn't exist, skip and inline into README) describing the refresh workflow, manifest-pin semantics, and what to do when a translator fails verification in CI

- [ ] **Task 9 — Smoke + sideload verification** (AC: #11, #14, #16, #17, #18)
  - [ ] 9.1 `pnpm build` — capture sandbox-chunk size from Vite output; assert ≤2 MB gzipped (AC11); record delta vs BE-8-4 baseline (235 kB) in Completion Notes
  - [ ] 9.2 `pnpm test` — assert ≥175 passing tests (AC15)
  - [ ] 9.3 `pnpm typecheck` — clean
  - [ ] 9.4 `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` — zero hits (AC18)
  - [ ] 9.5 Sideload `dist/` into Chrome; run S1 + S2 + S3 from AC16; capture console output as evidence in Completion Notes
  - [ ] 9.6 Verify `chrome.storage.local` state via DevTools after S2 (Application → Storage → Extension Storage); document the cached translator key + size
  - [ ] 9.7 `pnpm refresh:translators` twice in a row — verify `git status` is clean after second run (idempotency check, AC14)

- [ ] **Task 10 — Pre-Review Self-Check + PR** (AC: #14)
  - [ ] 10.1 Walk the Pre-Review Self-Check checklist (including the 3 new BE-8-5 items); check or honestly leave unchecked with explanatory notes
  - [ ] 10.2 Populate Dev Agent Record (Agent Model + Completion Notes + File List with EVERY file touched)
  - [ ] 10.3 Flip story Status field in this file from `ready-for-dev` → `review`; flip sprint-status BE-8-5 entry to `review`
  - [ ] 10.4 `git push` + `gh pr create --base main --head feat/BE-8-5-curated-translator-bundle-and-lazy-cdn-fetch` (non-draft per CLAUDE.md Rule 3); IMMEDIATELY launch background `gh run watch <id> --exit-status` per CLAUDE.md Rule 7 + `[[feedback-monitor-ci-in-background]]`
  - [ ] 10.5 DO NOT flip to `done` — gates require code-review pass per `[[feedback-code-review-required-before-done]]`. Surface code-review-next to Pierre.

## Dev Notes

### Architecture compliance

- **Runtime is Zotero-flavored.** The translator registry is a `Map<translatorID, RegisteredTranslator>` populated via `registerTranslator(t: BundledTranslator)` (see `src/translator-runtime/zotero-translators.ts:33`). `getBundledTranslator(id)` (in `src/translator-runtime/translator-bundle.ts:132`) is the bundled-path loader; BE-8-5 extends with `fetchTranslatorFromCdn(id)` for the long-tail path. The framework adapter (`installZoteroTranslators` in `zotero-translators.ts:76`) is already wired and doesn't need to change.

- **Sandbox is the ONLY translator execution context.** Per BE-8-4 architecture, `vendor/zotero-translate` runs in the MV3 sandbox page (`src/translator-runtime/sandbox.html`). The sandbox CSP permits `eval()` / `new Function()` needed by `src/translation/translate.js`. The sandbox is at opaque origin (`null`) — it CANNOT fetch directly from `https://translators.milton.so/`. All lazy CDN fetches happen in the popup/SW (or the existing spike-page fetch-proxy at `src/translator-runtime/spike-page.ts`) and are delivered to the sandbox via the new `translator-load-request/response` protocol-v2 messages.

- **postMessage gating is mandatory.** `isFromExpectedSource(event, expected)` (host-bridge.ts:38) MUST gate every new listener. Reject events whose `event.source` doesn't match an allowed `Window` reference. Don't use `event.origin` checks — sandbox origin is `"null"` and is not a useful filter. This is the BE-8-4 code-review HIGH-severity finding (H2 from PR #5); BE-8-5 must follow the same pattern.

- **PROTOCOL_VERSION carry-forward.** Bump to 2; type guards accept `protocolVersion: 1 | 2`; new emitters use 2. BE-8-6 may bump to 3 when it adds `chrome.scripting.executeScript` variants — this story's guards must not reject v3 outright (use `>= 1`-style checks if you anticipate further bumps, OR explicitly enumerate accepted versions).

### Library/framework requirements

- **`@noble/ed25519` (production dependency).** Pure-JS Ed25519, ~5 kB minified, no native deps, BSD-2 — compatible with AGPL bundle (BSD is permissive, redistribution within AGPL bundle is fine). Verify version against latest stable before pinning (currently `2.x.x` line is correct).

- **`tsx` (devDependency).** TypeScript script runner for `pnpm refresh:translators`. Already might be present via vitest's transitive deps — check `pnpm why tsx` before adding. Alternative: compile the script to JS first via `tsc`, but `tsx` is simpler.

- **No `@noble/secp256k1` or other crypto libs.** Ed25519 only. No HMAC or signing key generation in extension code (the private signing key lives in Milton-saas operator custody per BE-8-1 AC9).

### File structure

```
src/translator-runtime/
├── curated-translators.txt          ← NEW (AC2 — curated UUID list)
├── manifest-verify.ts               ← NEW (AC2 task 2.2 — Ed25519 verify primitive)
├── manifest-verify.test.ts          ← NEW (AC2 task 2.3)
├── translator-fetcher.ts            ← NEW (AC7 — lazy CDN fetch + cache)
├── translator-fetcher.test.ts       ← NEW (AC15)
├── translator-bundle.ts             ← MODIFY (AC5, AC6 — auto-gen REGISTRY + integrity check)
├── translator-bundle.test.ts        ← MODIFY (AC15 — add integrity-check test)
├── sandbox.ts                       ← MODIFY (AC9 — lazy fallback path)
├── spike-page.ts                    ← MODIFY (Task 7.5 — translator-load-request handler)
├── host-bridge.ts                   ← MODIFY (AC10 — protocol v2)
├── host-bridge.test.ts              ← MODIFY (AC15 — new message type tests)
├── zotero-types.d.ts                ← MODIFY (AC10 — TranslatorLoadRequest/Response types)
└── translators/
    ├── arXiv.org.js                 ← EXISTING (BE-8-4)
    ├── arxiv-org.js                 ← MAYBE rename to match new slug scheme (or keep)
    ├── doi-content-negotiation.js   ← NEW (generated)
    └── ... (~50–100 .js files)      ← NEW (generated)

scripts/
└── refresh-translator-bundle.ts     ← NEW (AC1, AC3, AC4, AC5 — build-time refresh tool)

translator-bundle-pin.json           ← NEW (AC3 — committed pin file at repo root)

manifest.config.ts                   ← MODIFY (AC12 — add translators.milton.so host_permission)

package.json                         ← MODIFY (add @noble/ed25519 + tsx + refresh:translators script)
README.md                            ← MODIFY or CREATE (AC13 — Bundled translators section)
docs/translator-bundling.md          ← MAYBE NEW (Task 8.3 — refresh workflow doc)
```

**Slug convention:** kebab-case the manifest `label` field, drop non-ASCII characters, lowercase, replace runs of `.` / space / `/` / parens with `-`, trim leading/trailing `-`. E.g., `"arXiv.org"` → `arxiv-org`, `"DOI Content Negotiation"` → `doi-content-negotiation`, `"Taylor & Francis+NEJM"` → `taylor-francis-nejm`. Collisions are extremely unlikely in the curated set; if one occurs, suffix with the first 8 hex of UUID.

**Note on existing arXiv vendoring:** `src/translator-runtime/translators/arXiv.org.js` (with the dot) is BE-8-4's hand-vendored file. The BE-8-5 script should either (a) overwrite it with the verified-fresh version under the new slug `arxiv-org.js` and delete the old, or (b) keep the old filename and special-case the script to honor existing filenames during refresh. Option (a) is simpler — the refresh script becomes the single source of truth. Verify with `git status` after refresh that the old filename is deleted.

### Testing standards

- **Test framework:** Vitest 4.x with `@vitest-environment jsdom` for DOM-touching tests (mirror BE-8-4's `zotero-http.test.ts` pattern).
- **HTTP mocking:** `vi.spyOn(globalThis, 'fetch')` with `vi.fn().mockResolvedValueOnce(new Response(...))` — DO NOT add MSW or similar; the spike pattern in BE-8-4 is sufficient.
- **`chrome.storage.local` mocking:** `chrome` namespace doesn't exist in JSDOM. Stub via `globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }, runtime: { lastError: undefined } } as unknown as typeof chrome`. **Use `mockResolvedValue` — the runtime code uses the Promise-style API per Task 5.2**, not callback-style; mocking with `vi.fn()` returning undefined silently passes tests that would crash at runtime. Reset between tests with `beforeEach(() => { vi.clearAllMocks(); /* re-set the mockResolvedValue defaults */ })`.
- **Ed25519 mocking:** Don't mock the verifier — feed it real test fixtures (a small frozen manifest + matching signature generated once and committed under `src/translator-runtime/__fixtures__/`). Real verification keeps the test honest.
- **Integration test for refresh script:** SKIP (the script is dev-tooling, not production code; manual run + idempotency check via `git status` is sufficient evidence per Task 9.7).
- **Test count target:** ≥175 (current 153 + ~22 new across fetcher + bundle + host-bridge + sandbox fallback + verify primitive).

### Previous Story Intelligence (BE-8-4 — translator runtime lift)

**What BE-8-4 shipped (relevant to BE-8-5):**

- Runtime is live and verified end-to-end on arXiv. The whole `Zotero.HTTP` / `Zotero.Translators` / `Zotero.Translate.ItemSaver` / `Zotero.Schema` / `Zotero.Date` adapter stack works.
- `translator-bundle.ts` is the bundled-path loader; `REGISTRY` is hand-written with one entry. BE-8-5 must auto-generate this.
- `parseTranslatorHeader()` in `translator-bundle.ts:30` was hardened during code-review to handle `'` + backtick strings + `/* */` comments. BE-8-5 must preserve this hardening if regenerating the file — DO NOT regenerate the `parseTranslatorHeader` function, only the `REGISTRY` const between marker comments.
- `host-bridge.ts:isFromExpectedSource()` is the canonical source-validation helper. Reuse, don't reinvent.
- `ARXIV_TRANSLATOR_ID` constant is in `host-bridge.ts:28`. BE-8-5's curated list will reference it. Don't duplicate the UUID.
- Sandbox-chunk gzipped size: 235 kB (BE-8-4 baseline). BE-8-5's bundle growth is monitored against this.
- Tests pass 153/153.
- CI is GREEN on `main` (PR #4 + PR #5 merged 2026-05-17).

**Code-review findings BE-8-5 must avoid repeating:**

- **HIGH H1** — populate Dev Agent Record completely (File List must list every file changed, not be empty).
- **HIGH H2** — gate every new postMessage listener with `isFromExpectedSource`.
- **HIGH H3** — walk the Pre-Review Self-Check; check or annotate every item.
- **MED M1** — honor configurable timeouts; don't hardcode.
- **MED M3** — round-trip tests for every protocol message type.

### Git intelligence summary

Recent commits show:
- `ef6584d fix(BE-8-4): code-review pass` — postMessage source validation + 5 follow-ups landed via PR #5
- `94573a1 feat(BE-8-4): translator runtime lift` — BE-8-4 PR #4 (the main payload)
- `8282687 feat(BE-8-1): translator-mirror CDN setup (Coolify variant)` — BE-8-1's CDN deploy

Commit message style: imperative present, `feat(BE-8-N): ...` / `chore(BE-8-N): ...` / `fix(BE-8-N): ...`, Claude co-author trailer. BE-8-5 follows the same convention.

### Latest tech information

- **`@noble/ed25519@^1.7.3` (pinned at 1.x deliberately).** 1.x has built-in SHA-512 (no manual `ed.etc.sha512Sync` wire-up — that's a 2.x trap). API: `import * as ed from '@noble/ed25519'; const ok = await ed.verify(signature, message, publicKey)`. Returns `Promise<boolean>`; throws only on malformed-byte inputs (wrap in try/catch and return false on throw). Bundle impact: ~10 kB unminified, BSD-2. The 1.x-vs-2.x decision is LOCKED to 1.x by Task 2.1 — do NOT swap to 2.x mid-story; the SHA-512 wire-up + sync-mode hash detection adds complexity for no gain at our scale.
- **`translators.milton.so`** — live as of 2026-05-16; full mirror (743 translators) of `zotero/translators` master; Cache-Control `public, max-age=86400, immutable` per file; metadata signed with Ed25519. Manifest URL: `https://translators.milton.so/repo/metadata`; signature: `/repo/metadata.sig`; bytes: `/repo/code/{translatorID}`.
- **MV3 sandbox CSP** — unchanged from BE-8-4. `script-src 'self' 'unsafe-eval'` allows `eval()` for translator execution; bytes loaded as strings via Vite `?raw` imports.
- **`@noble/ed25519` AGPL compatibility** — BSD-2 license, copy `node_modules/@noble/ed25519/LICENSE` to a vendored location if needed for §6 distribution; or rely on the published-source-availability principle (npm registry).

### Project structure notes

- Repo is single-package (no workspaces); `pnpm` per CLAUDE.md.
- TypeScript `strict: true` (verify in `tsconfig.json` if writing new code with `any`).
- No linter is configured (`pnpm lint` doesn't exist); rely on `tsc --noEmit` + Vitest as quality gates.
- Pre-push hook is NOT WIRED (CLAUDE.md line 51); rely on CI as the gate. Discipline: don't push until story-done.
- Worktrees aren't currently in use; one Claude session per repo (CLAUDE.md Rule 5).

### Documentation Consolidation Notes

- BE-8-5 introduces the long-lived "translator-bundling workflow" — capture in `docs/translator-bundling.md` if created, or inline into README. The dev-agent's Completion Notes should record the final curated UUID list (or where it lives) and the upstream-commit SHA pinned at story close, so future stories know the baseline.
- Pattern established: any cryptographic primitive (Ed25519 verify, SHA-256) lives in `src/translator-runtime/` and is reused by both build-time scripts and runtime modules via tree-shakeable imports. Don't duplicate into `scripts/`.

### References

- BE-8-4 story file: `_bmad-output/implementation-artifacts/BE-8-4-translator-runtime-lift.md` (runtime architecture, file layout, code-review findings)
- BE-8-1 story file: `_bmad-output/implementation-artifacts/BE-8-1-translator-mirror-cdn-setup.md` (CDN endpoints, signature scheme, manifest shape, AGPL §6 runbook)
- Charter v2: `_bmad-output/planning-artifacts/charter-v2.md` — Decision 2 (hybrid translator distribution), Decision 6 (bundled subset pinned at build), Decision 9 (sideload-first)
- CLAUDE.md: Rule 0 (cut branch before first edit), Rule 7 (auto-watch CI), Figma rule (N/A — no UI work in this story)
- `src/translator-runtime/translator-bundle.ts:132` — `getBundledTranslator(id)` (the loader to extend)
- `src/translator-runtime/zotero-translators.ts:33` — `registerTranslator(t)` (registry API)
- `src/translator-runtime/host-bridge.ts:38` — `isFromExpectedSource(event, expected)` (source-validation helper to reuse)
- `src/translator-runtime/sandbox.ts:213` — `runTranslation(args)` (the function that grows the fallback path)
- `src/translator-runtime/spike-page.ts` — current fetch-proxy (Task 7.5 extension point)
- `manifest.config.ts:28` — `host_permissions` array (add `translators.milton.so/*`)
- Upstream translators repo: `https://github.com/zotero/translators` (AGPL-3.0-or-later)

### Open decisions for dev-agent

(Trivia / dev-discretion choices the SM doesn't pin — flag any that turn load-bearing during dev and surface to Pierre.)

1. **Existing `arXiv.org.js` filename retention** — overwrite to new slug `arxiv-org.js` (cleaner) vs preserve historic filename (less churn). Task 3.4 notes option (a) is simpler; revisit if it breaks the spike harness path.
2. **`docs/translator-bundling.md` vs README section** — short single section is fine in README; if it grows beyond ~50 lines, split to its own file.
3. **Cache key prefix collisions** — `translator-fetched:{uuid}` keys live in the same `chrome.storage.local` namespace as future BE-8-6/7 state. Namespace prefix is `translator-` — fine, but if BE-8-6/7 introduces a clashing pattern, refactor at that point (not now).
4. **`@noble/ed25519` AGPL bundling §6 obligation** — BSD-2 deps inside an AGPL bundle: cite the upstream license in `THIRD-PARTY.md` or rely on `package.json` `dependencies` + npm. Pierre's call. Defer to BE-8-9 if it grows beyond scope.

## Pre-Review Self-Check

- [ ] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke) — **N/A: no UI in this story**
- [ ] File list in story matches actual files changed
- [ ] No raw hex color values — all colors use PandaCSS tokens — **N/A: no UI/CSS**
- [ ] `$effect` dependencies checked against async boundaries (no split reactive state across `await`) — **N/A: no Svelte runes here**
- [ ] Superforms tests use real adapter (not mocked) — **N/A: no Superforms**
- [ ] Barrel imports only — no direct imports from `features/*/utils/` — **N/A: extension doesn't use the features/ layout**
- [ ] No type casts (`as any`, `as unknown as T`) in new production code — test mocks excepted per team agreement
- [ ] Error paths handled — all async operations have try/catch or .catch()
- [ ] IPC command results checked for error states before use — **adapt: postMessage results checked for `error` envelope before use**
- [ ] Loading states span full async lifecycle (set before await, cleared in finally) — **N/A: no popup loading state in BE-8-5; BE-8-6 territory**

### BE-8-5-specific Pre-Review additions (AC14)

- [ ] Curated UUID list at `src/translator-runtime/curated-translators.txt` reviewed by Pierre (Task 1.3)
- [ ] `pnpm refresh:translators` is idempotent — run twice, `git status` clean after second (Task 9.7)
- [ ] Sandbox-chunk gzipped size delta documented vs BE-8-4 baseline (235 kB) in Completion Notes (Task 9.1)
- [ ] All postMessage listeners added by BE-8-5 use `isFromExpectedSource()` gating — grep for `addEventListener('message'` in changed files; every match has the gate (BE-8-4 H2 lesson)
- [ ] `host_permissions` only adds `https://translators.milton.so/*` — no broader wildcards crept in
- [ ] `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returns zero hits (IPC boundary; AC18)
- [ ] AGPL §6 footer / README section drafted; `translator-bundle-pin.json` cites `upstreamCommit` (AC13)
- [ ] BE-8-4 arXiv spike (S1) still works after BE-8-5 changes (AC17 regression)
- [ ] CI green via background `gh run watch <id>` post-push (CLAUDE.md Rule 7)
- [ ] DO NOT flip sprint-status to `done` — code-review gate first ([[feedback-code-review-required-before-done]])

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Author | Note |
|---|---|---|
| 2026-05-17 | Claude (Opus 4.7 1M, BMad SM workflow auto-method-17) | Story drafted ready-for-dev. Red Team vs Blue Team elicitation applied automatically per Pierre-customized default flow. **11 hardening edits applied** across AC/Task/Dev-Notes sections. Red-team attack summary: (1) AC2 mixed-mode AC-vs-dev-discretion → seed list LOCKED as pass criterion; (2) `@noble/ed25519` 1.x-vs-2.x ambiguity + SHA-512 wire-up trap → PIN 1.x in Task 2.1 + Open Decision removed; (3) verify-fixture key-rotation drift → timeboxed regen procedure + offline-only fixture rule in Task 2.3; (4) AC6 async crypto.subtle vs sync getBundledTranslator API → rewrote to bootstrap-time `verifyAllBundleIntegrity` + sync getter consults verifiedSet; (5) `chrome.storage.local` mock signature ambiguity → Promise-style API mandated + mockResolvedValue pattern; (6) storage quota silent fail → LRU eviction + 50-entry cap added to AC8 + Task 5.4; (7) build-pin vs runtime-pin scope confusion → AC7 amended (build-pin is bundled-only; lazy tracks live; mutually exclusive); (8) slug collision silent overwrite → fail-loud rule + `# slug-override:` escape hatch in Task 3.4; (9) spike-page handler scope creep → `// SPIKE-ONLY: BE-8-6 supersedes` marker in Task 7.5; (10) README overwrite risk → "ls first, append, never unconditional Write" in Task 8.2; (11) tsx-vs-Node-strip-types runner ambiguity → conditional rule in Task 3.8 (Node ≥22 → no new deps, else add tsx@^4). Full diff vs original draft available via `git diff` on this file. Story still ready-for-dev pending Pierre's step 7 validation. |
