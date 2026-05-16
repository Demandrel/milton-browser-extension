# Story BE-8.4: Translator Runtime Lift

Status: in-progress
Origin: Charter v2 Story Map row BE-8-4 (`_bmad-output/planning-artifacts/charter-v2.md` line 118). The architectural lift that BE-v2 hinges on — without it BE-8-5 (curated bundle), BE-8-6 (Class 3 capture), and BE-8-7 (Class 2 capture) have no engine to plug into. Charter Risks table line 149: lift carries a known "Zotero-desktop-specific assumptions don't lift cleanly to browser-content-script context" risk; mitigation is the integration-spike sub-task (one publisher end-to-end before scaling — recommend arXiv).
Depends on: BE-8-3 (done — extension extracted to public AGPL repo; submodule import requires the unambiguously-AGPL repo boundary established 2026-05-16). BE-8-1 (done — translator-mirror CDN at `translators.milton.so/repo/` provides the translator bytes the spike fetches).
Unblocks: BE-8-5 (curated translator bundle — depends on runtime), BE-8-6 (Class 3 capture flow — runs runtime in page context via `chrome.scripting.executeScript`), BE-8-7 (Class 2 capture — uses the same runtime surface for metadata before bytes upload).
Theme: Capture parity (charter v2 Themes table).
Risk: Medium-high (charter v2 Story Map column — highest risk in the sprint apart from BE-8-7/8).

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pierre / Milton dogfooder,
I want `zotero/translate` imported as an AGPL git submodule into `milton-browser-extension`, wired into an MV3 sandbox page with the minimum-viable Zotero host adapters (`Zotero.Translators` / `Zotero.HTTP` / `Zotero.Translate.ItemSaver` / `Zotero.Schema`), and proven end-to-end against the BE-8-1 translator-mirror CDN on one real publisher (arXiv) via a dev-internal spike trigger,
so that the v2 architectural pivot (charter v2 Decision 1 — "AGPLv3 extension + closed-source Milton-desktop over IPC") moves from "decided on paper" to "engine running in browser", BE-8-5 has a runtime to plug a curated translator bundle into, BE-8-6 can extend the same runtime to `chrome.scripting.executeScript` for Class 3 capture, and the BE-v2 north star ("Pierre uninstalls Zotero Connector after a week of BE-v2 dogfood") starts gaining capture parity in code rather than just in scope.

## Acceptance Criteria

### AC1 — `zotero/translate` landed as a pinned git submodule with AGPL boundary respected

- `.gitmodules` at repo root declares one submodule entry:
  - `path = vendor/zotero-translate`
  - `url = https://github.com/zotero/translate.git`
  - (Optional but recommended) `branch = master` for documentation; the actual checked-out state is pinned by SHA via `git submodule status`.
- The submodule is **pinned to a specific commit SHA** (latest stable at story-execution time; dev-agent picks via `git ls-remote` or web; records the SHA in the Change Log). `.gitmodules` MUST NOT pin to a moving ref like `main`/`master` in a way that lets CI drift.
- `vendor/zotero-translate/` contains upstream's source verbatim — including their `COPYING` (AGPLv3), their per-file headers, their `src/`, their `package.json`. Upstream's files are **never modified** by this story (modifying them would create license-attribution risk and break upstream-pull-update later).
- `scripts/add-spdx-headers.sh` skips `vendor/**` — verify by running the script post-submodule-add; vendor files MUST NOT receive Milton's SPDX header (it would overwrite upstream's). If the script currently traverses `vendor/`, add an explicit `--exclude vendor/` (or equivalent) in this story and document the change in the Change Log.
- **Atypical — submodule URL access:** `https://github.com/zotero/translate.git` is a public HTTPS clone; no SSH key required. Verify by `git ls-remote https://github.com/zotero/translate.git HEAD` before the submodule add (catches network/firewall issues early).
- **Atypical — `github.com/zotero/translate` doesn't exist or returns 404 at story-execution time:** The Zotero org publishes the translate engine in several variants (`zotero/translate` is the canonical embeddable framework; `zotero/translators` is the *translator scripts* repo which BE-8-1 mirrors via the CDN; `zotero/zotero-connectors` is the browser-extension reference implementation embedding the framework). The framework's API surface, file layout, and license posture across these variants is NOT identical (despite the engines being conceptually the same — the Connector embeds a build-time-flattened variant with different module boundaries). **DO NOT silently swap upstream sources.** If `github.com/zotero/translate` 404s, **HALT** and surface to Pierre with: (a) what was attempted, (b) the 404 evidence (curl output), (c) a one-paragraph proposal for which alternative to use (likely vendoring from `zotero/zotero-connectors/src/zotero/` but with re-scoped ACs). Pierre decides whether to extend BE-8-4's scope or split into a separate spike story. This protects against the dev grinding for days reverse-engineering an unexpected upstream variant.
- AC fail modes: submodule unpinned (no SHA in `.gitmodules` AND no SHA recorded by `git submodule status`) → fail; any file under `vendor/zotero-translate/**` modified vs upstream → fail; `vendor/` left out of SPDX-script exclusion → fail.

### AC2 — CI checks out submodules recursively; first run on the BE-8-4 branch green

- `.github/workflows/ci.yml` step 1 (`actions/checkout@v4`) changes from no args to `with: { submodules: recursive, fetch-depth: 1 }`. Existing `paths-ignore` block (`**/*.md`, `**/*.mdx`, `_bmad-output/**`, `.gitignore`, `COPYING`) UNCHANGED.
- The first CI run on the BE-8-4 feature branch completes green (all steps pass: checkout-with-submodule + pnpm install + typecheck + test + build).
- Submodule checkout adds ≤ 10s to CI runtime (verified in run logs); total CI stays under 2 minutes including build (current baseline from BE-8-3 bootstrap PR: ~21s; new baseline: target ≤ 35s).
- **Atypical — submodule init in CI fails (network / GitHub outage):** standard checkout-action retry behavior should cover transient; if persistent, the failure is fatal to the build (no fallback). Document in the Change Log if encountered.
- **Atypical — pnpm tries to install the submodule's `package.json`:** `vendor/zotero-translate/` is NOT in `pnpm-workspace.yaml` (this repo has no workspace config; root is the only package). If `pnpm install` from repo root tries to descend into `vendor/`, add `vendor/**` to the relevant ignore (likely `.npmrc` already excludes via `node-linker=hoisted` defaults; verify).

### AC3 — MV3 sandbox page registered in manifest + emitted by Vite build

- `manifest.config.ts` adds a new top-level `sandbox` declaration:
  ```ts
  sandbox: {
    pages: ['src/translator-runtime/sandbox.html'],
  }
  ```
- `manifest.config.ts` extends `host_permissions` to include:
  - `https://translators.milton.so/*` — BE-8-1 CDN; sandbox fetches translator bytes from here.
  - `https://arxiv.org/*` — spike target (arXiv abs pages); also lets the runtime fetch arXiv HTML for translator execution.
  - `https://export.arxiv.org/*` — arXiv translator may issue follow-up API calls here for canonical metadata.
- `permissions` UNCHANGED (still `['activeTab']` from BE-1). DO NOT add `scripting` here — `chrome.scripting.executeScript` for Class 3 is BE-8-6's concern.
- `pnpm build` emits the sandbox page bundle at the CRXJS-resolved path under `dist/` (verify by inspecting `dist/manifest.json` after build — `sandbox.pages` array points at a hashed-emit HTML file).
- Sideloading the built `dist/` in Chrome: extension installs without errors; `chrome://extensions` → Details → "Service worker" + "Inspect views" shows the sandbox page as an inspectable surface; permission warning on first install/update lists the 3 new host origins (acceptable per charter v2 Decision 10 "All-at-once at install — Zotero-Connector parity").
- **Atypical — CRXJS doesn't natively know about `manifest.sandbox.pages`:** Verify the plugin version (`@crxjs/vite-plugin@2.4.0` per current `package.json`) handles sandbox-page emission. If it doesn't, two fallbacks: (a) treat sandbox.html as a Vite multi-page input via `rollupOptions.input` AND keep the manifest declaration — CRXJS handles assets it knows about, sandbox page becomes a "plain" Vite page entry; (b) emit the sandbox page via a Vite plugin shim (write it ourselves; ~15 LOC). Document the chosen path in dev notes.

### AC4 — Zotero host-adapter layer implemented under `src/translator-runtime/`

New first-party files under `src/translator-runtime/` (all carry SPDX `AGPL-3.0-or-later` headers via `scripts/add-spdx-headers.sh`):

- **`zotero-translators.ts`** — implements `Zotero.Translators`:
  - `Zotero.Translators.get(translatorID)` → translator object (metadata + parsed JS body) or `null`
  - `Zotero.Translators.getWebTranslators(url, rootUrl?)` → array of translators whose `target` regex matches the URL, ordered by `priority`
  - Backing store: in-memory `Map<string, Translator>` populated by `translator-fetcher.ts`
- **`zotero-http.ts`** — implements `Zotero.HTTP.request(method, url, opts)`:
  - Returns a Promise resolving to `{status, responseText, responseHeaders, responseURL}` (the shape translators inspect)
  - Wraps `fetch()`; explicit error envelope on network failure (no swallowed throws)
  - Honors `opts.responseType` (`'text'` default; `'document'` parses via `DOMParser`; `'json'` parses; unsupported types throw with a descriptive error)
  - Honors `opts.headers` and `opts.body` for POST translators (some publisher translators POST forms)
- **`zotero-translate.ts`** — implements `Zotero.Translate.Web` + `Zotero.Translate.ItemSaver`:
  - `Translation` class wraps the translator-execution lifecycle: `setTranslator()` → `setDocument()`/`setString()` → `translate()` → resolves with extracted items
  - `ItemSaver` collects items via `saveItems(items)` callback; exposes them back via `getSavedItems()`
  - **Execution timeout:** `translate()` MUST accept an optional `timeoutMs` parameter (default `10000`); if the underlying translator hasn't resolved by deadline, abort + reject with `TranslatorTimeoutError(translatorId, elapsedMs)`. Protects against malformed translators that infinite-loop in the sandbox.
  - **Note:** this is a Milton-specific shim around what `zotero/translate` itself provides. The actual Translation lifecycle code lives in the submodule; our shim wires the host hooks (`Zotero.HTTP`, item persistence, debug logging, timeout) into our environment.
- **`schema.ts`** — Zotero item-type schema:
  - Vendor a snapshot of `https://api.zotero.org/schema` as a JSON file committed at `src/translator-runtime/zotero-schema.json` (fetched once, pinned at build; document refresh procedure in dev notes)
  - Export typed helpers: `getItemTypes()`, `getFieldsForType(typeId)`, `getCreatorTypesForType(typeId)`
  - Some translators introspect schema to validate fields; without it, calls return `undefined` and items can fail to save
- **`translator-fetcher.ts`** — fetches translator bytes from BE-8-1 CDN:
  - `fetchById(translatorID)` → `GET https://translators.milton.so/repo/<id>` → parses the translator metadata header (first `{...}` JSON-ish block in the JS source) + retains the JS body
  - In-memory cache: same ID asked twice = one network call
  - Error envelope: network error / 404 / malformed metadata header → typed errors with actionable messages
- **`host-bridge.ts`** — postMessage protocol between sandbox iframe and popup/SW caller:
  - Request: `{type: 'translate-request', requestId, url, translatorId}`
  - Response: `{type: 'translate-response', requestId, items?, error?}`
  - Versioned protocol header (`protocolVersion: 1`) for forward-compat with BE-8-6's `chrome.scripting.executeScript` variant
- **`sandbox.html`** — minimal HTML host for the sandbox page (just `<script type="module" src="./sandbox.ts">`)
- **`sandbox.ts`** — sandbox bootstrap:
  - Imports adapters; constructs the `Zotero` global object on `window`
  - Imports/initializes the `zotero/translate` framework from `vendor/zotero-translate/` (path/import shape depends on what the upstream submodule exposes — TypeScript declaration shim under `src/translator-runtime/zotero-translate.d.ts` documents the surface)
  - Listens for `translate-request` postMessage; runs the requested translation; replies with `translate-response`

Production-code rules (per Pre-Review Self-Check):
- No `as any` / `as unknown as T` casts (test mocks excepted).
- All `await`-chained async code has try/catch or `.catch()` (no unhandled rejections).
- All postMessage receivers validate `event.origin` (sandbox-origin check is non-trivial in MV3 — document the chosen check pattern in dev notes).
- Type declarations for upstream `zotero/translate` framework go in `src/translator-runtime/zotero-translate.d.ts` (Milton-side ambient typings, not in vendor/).

### AC5 — Translator load from BE-8-1 CDN works for any pinned translator ID

- `translator-fetcher.fetchById(translatorID)` issues `GET https://translators.milton.so/repo/<translatorID>` and:
  - On 200: returns `{metadata: TranslatorMetadata, body: string}` where metadata includes `translatorID`, `label`, `target`, `priority`, `type`, `lastUpdated` (parsed from the JS source's leading metadata block)
  - On 404: throws `TranslatorNotFoundError(translatorID)` (typed, actionable)
  - On network error: throws `TranslatorFetchError(translatorID, cause)` (typed, with the underlying error preserved)
  - On malformed metadata header (e.g., the leading JSON-ish block fails to parse): throws `TranslatorMalformedError(translatorID)`
- Unit tests under `src/translator-runtime/translator-fetcher.test.ts`:
  - Successful fetch → returns parsed metadata + body
  - 404 → throws `TranslatorNotFoundError`
  - Network error (simulated via fetch rejection) → throws `TranslatorFetchError`
  - Malformed header → throws `TranslatorMalformedError`
  - In-memory cache hit on second call → no second fetch (assert via mock spy)
- Tests use Vitest mocks for `fetch`; DO NOT hit live `translators.milton.so` from CI (would couple CI green-ness to CDN availability and a moving translator-set).

### AC6 — arXiv integration spike: end-to-end via the new runtime (the load-bearing AC)

This AC is what proves the lift works. Given an arXiv abs page URL and the arXiv translator's ID:

1. Caller (devtools console / hidden trigger / test page — see "Spike trigger surface" below) issues a `translate-request` to the sandbox via postMessage.
2. Sandbox's `host-bridge` receives the request.
3. `translator-fetcher.fetchById(arxivTranslatorId)` fetches the arXiv translator from the BE-8-1 CDN (`GET https://translators.milton.so/repo/<id>`).
4. `Zotero.Translators` registers the fetched translator.
5. `Zotero.Translate.Web` is constructed; `setTranslator(arxivTranslator)`; `setString(<arxiv-page-html>)` (or `setDocument()` after `Zotero.HTTP.request(url)` fetches the page).
6. Translator's `detectWeb(doc, url)` returns a Zotero item type (expected: `'journalArticle'` or `'preprint'`).
7. Translator's `doWeb(doc, url)` runs; produces 1+ Zotero items containing `{itemType, title, creators, date, DOI?, arXivID?, abstractNote, ...}`.
8. `Zotero.Translate.ItemSaver.saveItems(items)` collects them.
9. Sandbox replies with `translate-response` containing the items.
10. Caller converts Zotero items → connector payload shape (reuse `metadata-to-payload.ts` if compatible; extend if not).
11. Caller POSTs to `127.0.0.1:7521/references` via existing `connector-client.ts` — **no new client code, no IPC contract changes, no Milton-desktop changes.**
12. Milton-desktop shows a toast confirming the new reference; library entry has correct metadata (title matches abs page, authors list matches, year matches, arXiv ID populated).

**Spike trigger surface — HARD-DEFAULT to option (a) console command. NOT a dev decision.** Per memory `[[feedback-capture-correctness-over-ui-polish]]`, Pierre doesn't value popup UI polish; spike trigger surface is dev-internal proof-of-life only, so the lowest-blast-radius option is correct. Option (a) is the implementation; (b)/(c) listed only as rejected alternatives:

| Option | Description | Verdict |
|---|---|---|
| (a) | Devtools console command `window.miltonRuntimeSpike(url)` exposed in the sandbox page | **CHOSEN** — lowest blast radius; no popup change; doesn't couple to BE-8-6's popup state-machine rewrite |
| (b) | Hidden test page `chrome-extension://<id>/src/translator-runtime/spike-page.html` with a "Run spike" button | Rejected — more code, no real upside for dev-internal smoke |
| (c) | Hidden popup dev-only button | Rejected — couples to popup state machine; risks accidentally shipping the dev button |

**Out of scope for BE-8-4:** wiring the runtime into the user-facing popup capture flow. That's BE-8-6 (Class 3 capture flow extends the popup state machine with translator-running / translator-done / translator-fallback states). The existing popup's BE-7 capture path (via `translate.milton.so/web`) MUST remain unchanged and untouched in this story.

### AC7 — Vitest unit tests cover the new adapter layer

- New tests under `src/translator-runtime/*.test.ts`:
  - `zotero-http.test.ts` — request success, 404, network error, headers normalization, `responseType: 'document'` parsing, `responseType: 'json'` parsing, unsupported responseType throws
  - `zotero-translators.test.ts` — `get(id)` hit, `get(id)` miss returns null, `getWebTranslators(url)` matches single translator by `target` regex, matches multiple translators ordered by priority, returns empty array on no match
  - `zotero-translate.test.ts` — ItemSaver single-item path, multi-item path, empty path, Translation lifecycle wiring (mocked translator)
  - `translator-fetcher.test.ts` — per AC5
  - `host-bridge.test.ts` — request/response round-trip via mocked postMessage, origin validation rejects unknown senders, malformed request returns error response
  - `schema.test.ts` — `getItemTypes()` returns known types, `getFieldsForType('journalArticle')` returns expected fields
- All tests pass `pnpm test`. Test environment: current `vitest.config.ts` uses `environment: 'node'`; some sandbox-adjacent tests may need `environment: 'jsdom'` (per-file override via `// @vitest-environment jsdom` directive — DO NOT switch the whole repo to jsdom).
- Test floor (per module): every new adapter module under `src/translator-runtime/` has at minimum 3 tests covering **success path + error path + edge case**. NO total-count target — counting tests is the wrong metric (induces tautological tests to hit a number). Current baseline is 111 tests across the existing suite; the new BE-8-4 tests are additive.
- `pnpm typecheck` clean (no `noUnusedLocals` / `noUnusedParameters` violations from the new code — those are enabled in `tsconfig.json` per BE-8-3).

### AC8 — Sandbox page runs translator JS without CSP violations

- Opening `chrome-extension://<extension-id>/src/translator-runtime/sandbox.html` directly in Chrome shows no CSP errors in devtools console.
- The runtime's translator-execution path (`new Function(translatorBody)` or `eval(translatorBody)`) MUST work — sandbox pages have Chrome's default `script-src 'self' 'unsafe-eval'; object-src 'self'` which permits eval. Verified by triggering the arXiv spike and observing successful translator execution.
- If CSP errors DO appear despite sandbox-page usage: investigate manifest's `sandbox.content_security_policy` override; do NOT relax CSP on regular extension pages.
- **Verification posture:** AC8 has NO automated test in this environment — JSDOM/Vitest do NOT enforce Chrome's CSP. AC8 is validated **transitively** via AC10 scenarios 3-5: if the arXiv spike completes successfully end-to-end, the sandbox executed translator JS, which means CSP didn't block it, which means AC8 passes. Document this in PR body so reviewers don't expect a CSP-specific test.
- **Atypical — translator code uses `XPath` or other DOM APIs:** sandbox pages have full DOM; `Document.evaluate()` etc. all available. No special handling needed.
- **Atypical — translator code uses `Zotero.Promise` (Bluebird):** upstream `zotero/translate` may polyfill or import Bluebird. If the polyfill is missing in our environment, vendor it OR adapt the framework to use native Promises (one-line patch in our `sandbox.ts` adapter, NOT in `vendor/`).

### AC9 — IPC boundary self-check (charter v2 standing rule)

- BE-8-4 PR body includes verbatim: **"Does this PR violate the IPC boundary (i.e., does Milton-desktop import extension code or vice versa)? — No. This PR only adds files under `src/translator-runtime/`, updates `manifest.config.ts`, updates `.github/workflows/ci.yml`, and adds `vendor/zotero-translate/` as a submodule. The extension still talks to Milton ONLY via `127.0.0.1:7521` (HTTP) and to `translate.milton.so` / `translators.milton.so` (HTTPS). No code-level imports of `milton/src-tauri/**`, `milton/src/**`, or `@milton-saas/*`."**
- Verify via `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returning ZERO hits — paste evidence in PR body.
- Submodule import note in the same PR body: **"`vendor/zotero-translate/` is a git submodule pointing at the public `zotero/translate` AGPLv3 repo, pinned to commit `<SHA>`. The submodule is third-party AGPL code; the AGPLv3 boundary established by BE-8-3 (`COPYING` + per-file SPDX on `src/**`) absorbs it cleanly. No copyleft contagion to Milton-desktop because no code in this repo is imported by Milton-desktop."**

### AC10 — Pierre G17-1 HARD gate: end-to-end smoke matrix

Pierre-owned smoke (JSDOM-blind — real Chrome + real Milton-desktop required). Scenarios 0 + 1 may also be exercised by the dev for pre-push validation; 2-7 are Pierre's:

| # | Owner | Scenario | Expected outcome |
|---|---|---|---|
| 0 | [P] | **Baseline (BEFORE merging BE-8-4):** on `main` branch (NOT the BE-8-4 branch), sideload current `dist/`; run scenarios 6 + 7 (BE-7 econstor + arXiv abs via existing popup flow) | Both pass — establishes known-good baseline. If they fail, fix is OUT of BE-8-4 scope (escalate as a BE-7 regression bug). This prevents misattributing pre-existing breakage to BE-8-4. |
| 1 | [D] then [P] | Fresh clone: `git clone https://github.com/Demandrel/milton-browser-extension && cd milton-browser-extension && git submodule update --init --recursive && pnpm install && pnpm build`. Dev runs in `/tmp/be-8-4-fresh-clone-smoke/` as part of pre-push; Pierre re-runs as part of his sideload smoke. | All steps succeed; `dist/` exists with manifest, popup, sandbox page, vendor framework bundled |
| 2 | Sideload `dist/` in Chrome via Load unpacked → reload existing extension OR install fresh | Toolbar icon appears; permission warning for 3 new host origins shown on install/update (Pierre clicks Accept); extension page lists the sandbox page as an inspectable view |
| 3 | Open `https://arxiv.org/abs/2303.08774` → trigger the spike (via whichever surface dev chose in AC6) | Reference appears in Milton library; metadata = correct title ("GPT-4 Technical Report"), authors list, year (2023), abstractNote populated, arXiv ID = `2303.08774` |
| 4 | Trigger the spike a SECOND time on `https://arxiv.org/abs/1706.03762` ("Attention Is All You Need") | Reference appears with correct metadata; runtime not crashed; in-memory translator cache hit (no second CDN fetch — verify via devtools network tab on the sandbox page) |
| 5 | Trigger the spike on an arXiv URL with NO matching translator scenario: `https://arxiv.org/list/cs.AI/recent` (a list page, not an abs page) | Spike fails gracefully — error message in caller surface; no crash; no Milton-side reference created |
| 6 | BE-7 regression: open `https://www.econstor.eu/bitstream/10419/32581/1/623739976.pdf` → click popup → click Save (existing flow, NOT the spike) | Reference + PDF attached within ~30s (same as pre-BE-8-4 — the existing translate.milton.so server path is UNTOUCHED) |
| 7 | BE-7 regression: open `https://arxiv.org/abs/2303.08774` → click popup → click Save (existing flow, NOT the spike) | Reference + PDF auto-attached via OA discovery (same as pre-BE-8-4) |

All 7 must pass before story flips `review → done`. Scenarios 3-5 are the spike proof (positive + cache + graceful failure). Scenarios 6-7 are the no-regression proof. Scenarios 1-2 are the install proof.

### AC11 — Documentation + decisions captured

- `README.md` (at repo root) updated:
  - Add a "Cloning + submodule init" section (or extend the existing dev-setup section) with the `git submodule update --init --recursive` instruction. Make clear: a clone WITHOUT submodule init will fail at typecheck/build with confusing errors.
  - In the Architecture section, add a one-sentence pointer: "BE-8-4 onward, the extension imports `zotero/translate` (AGPLv3) as a submodule under `vendor/zotero-translate/` and runs it inside a sandbox page; charter v2 BE-8-4 row for rationale."
  - DO NOT bloat the README with implementation details — point at this story file for the deep dive.
- This story's Change Log records (final entries at story close):
  - Pinned submodule SHA (from Task 1.1)
  - Upstream source actually used (`zotero/translate` HEAD or `zotero/zotero-connectors/src/zotero/` fallback per AC1 atypical)
  - arXiv translator ID used in the spike (from Task 6.1)
  - Spike trigger surface chosen (a/b/c from AC6) + Pierre's confirmation
  - Vendored Zotero schema snapshot date + refresh procedure
  - Any deviations from this story file (called out explicitly)
- "Documentation Consolidation Notes" section in this story file populated for Paige (tech-writer agent) at epic close: submodule pattern, sandbox-page-for-CSP pattern, host-bridge postMessage protocol, schema vendoring strategy, error-envelope conventions.

## Tasks / Subtasks

Convention: `[D]` = dev-agent owned (code / git / pnpm). `[P]` = Pierre-owned (sideload smoke, decision confirmations). Subtasks numbered `N.M`. Status checkboxes flipped during execution.

- [x] **Task 0 — Cut feature branch BEFORE first edit** (CLAUDE.md Rule 0) — completed 2026-05-16
  - [x] 0.1 [D] `git branch --show-current` returned `main` at story start (clean post-create-story; 2 commits ahead of origin/main from planning-artifact commits)
  - [x] 0.2 [D] `git checkout -b feat/BE-8-4-translator-runtime-lift` from `main@ab63a3c` — clean cut
  - [x] 0.3 [D] First commit on branch: flip sprint-status `BE-8-4-translator-runtime-lift: ready-for-dev → in-progress` + story file Status field flipped + Change Log entry added

- [x] **Task 1 — Pre-flight: pin upstream + verify network access** (AC: #1) — completed 2026-05-16
  - [x] 1.1 [D] `git ls-remote https://github.com/zotero/translate.git HEAD` → `d08300c2c01a4d6ef325f05cbefc6c138a99f811` on `refs/heads/master` (upstream uses `master` not `main`). Upstream reachable; NO 404 fallback needed.
  - [x] 1.2 [D] Commit-health sanity-check via GitHub API: `curl https://api.github.com/repos/zotero/translate/commits/d08300c2c01a4d6ef325f05cbefc6c138a99f811` returned: author = Abe Jellinek (active Zotero maintainer), date = 2026-04-23 (~3 weeks ago — not stale, not WIP), message = "Add support for clearing challenge in browser (#45)" — real feature work, not a draft/revert/force-push artifact. Pin APPROVED at HEAD.
  - [x] 1.3 [D] Pinned SHA recorded in Change Log entry above.
  - [x] 1.4 [D] **Pin-stability check** deferred to Task 2.1 (`git submodule add` will resolve the SHA at submodule-add time; if the SHA disappears between now and then, the `git submodule add` will fail with a clear error and we re-pick HEAD).

- [ ] **Task 2 — Land the submodule** (AC: #1, #2)
  - [ ] 2.1 [D] `git submodule add https://github.com/zotero/translate.git vendor/zotero-translate`
  - [ ] 2.2 [D] `cd vendor/zotero-translate && git checkout <SHA from Task 1.1> && cd ../..`
  - [ ] 2.3 [D] `git add .gitmodules vendor/zotero-translate` (the latter records the SHA as the submodule pointer)
  - [ ] 2.4 [D] `git submodule status` — verify single line showing `<SHA> vendor/zotero-translate (heads/master @ <SHA short>)` or similar
  - [ ] 2.5 [D] Verify `scripts/add-spdx-headers.sh` skips `vendor/**`. Run the script; verify zero files modified under `vendor/`. If it tries to header vendor files, add explicit `--exclude vendor/` (or equivalent for the script's invocation) in this commit.
  - [ ] 2.6 [D] Commit: `feat(BE-8-4): add zotero/translate AGPL submodule pinned at <SHA>`

- [ ] **Task 3 — CI: submodule-aware checkout** (AC: #2)
  - [ ] 3.1 [D] Edit `.github/workflows/ci.yml`: change `actions/checkout@v4` to use `with: { submodules: recursive, fetch-depth: 1 }`. Existing `paths-ignore` block UNCHANGED.
  - [ ] 3.2 [D] Commit: `ci(BE-8-4): checkout submodules recursively for zotero/translate`
  - [ ] 3.3 [D] DO NOT push yet — per CLAUDE.md Rule 1, accumulate commits locally until story is done

- [ ] **Task 4 — Sandbox page scaffolding + manifest wiring** (AC: #3, #8)
  - [ ] 4.1 [D] Create `src/translator-runtime/sandbox.html` — minimal HTML: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script type="module" src="./sandbox.ts"></script></body></html>` (SPDX header in HTML comment form)
  - [ ] 4.2 [D] Create `src/translator-runtime/sandbox.ts` (placeholder bootstrap — `console.log('milton sandbox ready')`; Zotero global wiring is Task 5)
  - [ ] 4.3 [D] Edit `manifest.config.ts`: add `sandbox: { pages: [...] }` and extend `host_permissions` per AC3. Verify `pnpm typecheck` clean.
  - [ ] 4.4 [D] `pnpm build`; inspect `dist/manifest.json` → `sandbox.pages` array points at an emitted HTML file. If CRXJS doesn't emit it, apply the AC3 atypical-path fallback and document in dev notes.
  - [ ] 4.5 [D] Local sideload + open `chrome-extension://<id>/<sandbox-path>` directly → confirm "milton sandbox ready" in devtools console; no CSP errors.
  - [ ] 4.6 [D] Commit: `feat(BE-8-4): scaffold sandbox page + extend manifest sandbox + host_permissions`

- [ ] **Task 5 — Implement Zotero host adapters** (AC: #4, #7)
  - [ ] 5.0 [D] **Submodule runtime-dependency audit BEFORE writing adapter code.** Run `cat vendor/zotero-translate/package.json` + `ls vendor/zotero-translate/` to inventory: (a) runtime dependencies the framework expects (`dependencies` field in upstream's package.json — e.g., bluebird, RDF parsers, jquery); (b) build-system files present (rollup, webpack, etc.); (c) whether upstream ships pre-built artifacts or only source. For each runtime dep: decide one of — (i) already vendored under `vendor/zotero-translate/node_modules` (rare; check); (ii) compatible with our existing extension deps (none currently — verify); (iii) needs to be vendored under `vendor/` separately as a sub-submodule or copied JSON; (iv) needs to be added to our `package.json` (last resort — surface to Pierre as a scope-extension question, do NOT silently add). Document the decision matrix in dev notes before proceeding to Task 5.1.
  - [ ] 5.1 [D] **`zotero-http.ts` + tests** — implement `Zotero.HTTP.request()` per AC4 surface; cover success / 404 / network error / responseType variants in tests; align return shape with what translators expect (cross-check against any `Zotero.HTTP.request` callsites in `vendor/zotero-translate/` AND in upstream `zotero/zotero-connectors` for reference).
  - [ ] 5.2 [D] **`zotero-translators.ts` + tests** — implement registry per AC4; in-memory `Map` backing store; URL matching via `target` regex with `priority` ordering for `getWebTranslators()`.
  - [ ] 5.3 [D] **`zotero-translate.ts` + tests** — implement Translation lifecycle wrapper + ItemSaver per AC4. This wires upstream's `Translation` class (from `vendor/zotero-translate/`) into our host hooks (HTTP, ItemSaver, debug).
  - [ ] 5.4 [D] **`schema.ts` + `zotero-schema.json` + tests** — fetch ONCE during dev-story execution: `curl https://api.zotero.org/schema -o src/translator-runtime/zotero-schema.json` (run from repo root). Commit the JSON file as part of this story. Helpers `getItemTypes()`, `getFieldsForType(typeId)`, `getCreatorTypesForType(typeId)` read from the bundled JSON. **Refresh procedure** (documented in dev notes for future stories): re-run the same `curl` one-liner; commit the diff. NO build-time fetch automation in BE-8-4 — keep it explicit + manual to avoid surprise schema drift between CI runs.
  - [ ] 5.5 [D] **`translator-fetcher.ts` + tests** — per AC5; use Vitest mocks for fetch in tests (DO NOT hit live CDN).
  - [ ] 5.6 [D] **`host-bridge.ts` + tests** — postMessage protocol per AC4; versioned `protocolVersion: 1`; origin validation.
  - [ ] 5.7 [D] **`sandbox.ts` (real implementation)** — imports adapters; constructs `Zotero` global; loads upstream framework from `vendor/zotero-translate/`; listens for `translate-request`; routes to translation.
  - [ ] 5.8 [D] **Type declaration shim** — `src/translator-runtime/zotero-translate.d.ts` declares the ambient types for upstream's framework (Translation class, Translator object shape, Item shape). This is Milton-side; upstream's framework ships no TypeScript types of its own.
  - [ ] 5.9 [D] Run `scripts/add-spdx-headers.sh` — verify all new files get headers + verify `vendor/` is skipped.
  - [ ] 5.10 [D] `pnpm typecheck` clean; `pnpm test` green (target ≥ 130 tests). Commit per-module if PRs would be too large for review; otherwise one big commit `feat(BE-8-4): implement Zotero host adapters (Translators, HTTP, Translate, Schema, fetcher, bridge)` is acceptable.

- [ ] **Task 6 — Pin arXiv translator + spike fetch** (AC: #5, #6)
  - [ ] 6.1 [D] Discover arXiv translator ID: browse `https://github.com/zotero/translators` for `arXiv.org.js`; the file's first line contains the metadata header including `"translatorID": "<UUID>"`. Record the ID.
  - [ ] 6.2 [D] Verify the translator is mirrored on BE-8-1 CDN: `curl -I https://translators.milton.so/repo/<arxiv-translator-id>` → 200. If 404, BE-8-1's mirror didn't pull this translator — fix in a parallel BE-8-1 follow-up (out of BE-8-4 scope; surface to Pierre).
  - [ ] 6.3 [D] Record arXiv translator ID + its `lastUpdated` field in dev notes (so BE-8-5 + BE-8-6 reference the same translator version).

- [ ] **Task 7 — arXiv integration spike end-to-end** (AC: #6, #10 scenarios 3-5)
  - [ ] 7.1 [D] Decide spike trigger surface (per AC6 table). DEFAULT to (a) `window.miltonRuntimeSpike(url)` console command. Surface decision to Pierre before committing the implementation.
  - [ ] 7.2 [D] Implement the trigger: caller → sandbox via postMessage → runtime → returns items.
  - [ ] 7.3 [D] Convert returned Zotero items → connector payload shape. Inspect `metadata-to-payload.ts`: it currently converts from `translate.milton.so/web`'s CSL-JSON output, which may differ from Zotero items (Zotero uses its own item-type/field naming; CSL-JSON is a translation OF Zotero items). Decide: extend `metadata-to-payload.ts` to also handle Zotero items, OR write `zotero-item-to-payload.ts` alongside. Pick based on diff size; both are acceptable.
  - [ ] 7.4 [D] POST to `127.0.0.1:7521/references` via existing `connector-client.ts` (no new client code).
  - [ ] 7.5 [D] Local manual smoke on `https://arxiv.org/abs/2303.08774`. Iterate until success. Capture devtools console output for the Debug Log References section.
  - [ ] 7.6 [D] Commit: `feat(BE-8-4): arXiv integration spike via new translator runtime`
  - [ ] 7.7 [D] **Story-level timebox** (charter v2 Risks-table fallback path): if Task 7.5 manual smoke fails for >2 hours of debugging (cumulative across attempts), HALT and surface to Pierre with: (a) failing step in the 1-12 pipeline from AC6, (b) devtools log + error message, (c) suspected root cause, (d) one-paragraph recommendation: "retry with patched runtime / switch to upstream `zotero/zotero-connectors` fallback / escalate to custom-scrapers-per-publisher path (charter v2 risk fallback)". DO NOT silently grind past the 2-hour mark — escalation is cheap, sunk-cost is expensive.

- [ ] **Task 8 — Push branch + CI green + Pierre G17-1 smoke** (AC: #10, CLAUDE.md Rule 1)
  - [ ] 8.1 [D] Local pre-push validation: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build` ALL green. (No pre-push hook in this repo per CLAUDE.md Rule 2 status; this is the manual equivalent.)
  - [ ] 8.2 [D] Push the branch; open PR `feat(BE-8-4): translator runtime lift via zotero/translate AGPL submodule + sandbox page + arXiv spike` per CLAUDE.md Rule 3 (non-draft from start)
  - [ ] 8.3 [D] PR body MUST include the AC9 IPC self-check verbatim + the submodule-import note. Background-watch CI per [[feedback-monitor-ci-in-background]].
  - [ ] 8.4 [D] On CI green: download `dist/` artifact for Pierre's smoke.
  - [ ] 8.5 [P] Pierre runs all 7 AC10 scenarios. Record results in this story file.
  - [ ] 8.6 [D] If any red: fix in follow-up commit + re-push (acceptable second CI run per CLAUDE.md Rule 2)

- [ ] **Task 9 — Documentation + decision capture** (AC: #11)
  - [ ] 9.1 [D] Update `README.md` per AC11 (Cloning + submodule init section; one-sentence architecture pointer)
  - [ ] 9.2 [D] Populate this story's "Documentation Consolidation Notes" section with epic-close pointers for Paige
  - [ ] 9.3 [D] Update Change Log with: pinned submodule SHA + upstream source used + arXiv translator ID + spike trigger surface chosen + Pierre's smoke result + any deviations
  - [ ] 9.4 [D] Commit: `docs(BE-8-4): README submodule-init + story closeout notes`

- [ ] **Task 10 — Story closeout**
  - [ ] 10.1 [D] All gates green confirmed per [[feedback-never-mark-done-before-everything-green]]: pre-merge CI ✅, Pierre 7/7 smoke ✅, post-merge main CI ✅ (after merge). NO exceptions.
  - [ ] 10.2 [D] Surface merge call to Pierre per [[feedback-claude-owns-merge-call-at-story-close]]: "BE-8-4 PR #N — gates green · recommend merge."
  - [ ] 10.3 [D] Pierre says "go" → `gh pr merge --squash --delete-branch`; background-watch post-merge main CI.
  - [ ] 10.4 [D] Post-merge `chore(BE-8-4): mark done` commit on `main` flips sprint-status `in-progress → done` (paths-ignored — no CI).
  - [ ] 10.5 [D] Surface unblocked stories: BE-8-5 (curated translator bundle) is the natural next; BE-8-6 + BE-8-7 also become buildable on top of the runtime.

## Dev Notes

### Architectural posture (the WHY behind this story)

BE-v2's entire pivot rests on this story. Charter v2 Decision 1 chose "Path #3 — AGPLv3 extension + closed-source Milton-desktop over IPC" precisely so the extension could lift Zotero's translator runtime into the browser (the architectural move that lets Class 2/3 publishers — Cloudflare-gated / Anubis-gated — be captured at all). BE-8-1 set up the translator CDN. BE-8-2 set up the bytes-upload endpoint. BE-8-3 extracted the extension into its own AGPL repo. BE-8-4 is where the translator engine actually starts running in the browser. Nothing downstream — BE-8-5/6/7 — is buildable without it.

The spike-first approach (one publisher end-to-end before scaling) is the charter v2 Risks-table mitigation (line 149) for the highest-cost-of-failure risk in the sprint: "zotero/translate runtime has Zotero-desktop-specific assumptions that don't lift cleanly to a browser-content-script context." If the spike fails (translator can't run, sandbox CSP blocks something irrecoverable, host adapters need APIs we can't provide), the charter explicitly names the fallback: "custom scrapers per publisher (significantly higher cost; would also force a brief revisit)." Surface this immediately if encountered — don't grind on it for days.

North-star alignment: this story doesn't directly move the "Pierre uninstalls Zotero Connector after a week of dogfood" needle (BE-8-6 is when the runtime starts handling actual user captures). But every BE-8-* story from BE-8-5 onward depends on this lift working cleanly, so the smoothness of BE-8-4's landing sets the pace for the rest of the sprint.

### Source tree (what BE-8-4 touches)

**New files (first-party, under repo root):**

- `.gitmodules` — declares `vendor/zotero-translate` submodule
- `vendor/zotero-translate/` — git submodule (third-party, AGPLv3, pinned by SHA; contents NOT counted as new files since they live in the submodule's history)
- `src/translator-runtime/sandbox.html` — sandbox page entry
- `src/translator-runtime/sandbox.ts` — sandbox bootstrap; constructs `Zotero` global; postMessage listener
- `src/translator-runtime/zotero-translators.ts` — `Zotero.Translators` adapter
- `src/translator-runtime/zotero-http.ts` — `Zotero.HTTP` adapter
- `src/translator-runtime/zotero-translate.ts` — `Zotero.Translate.*` adapter
- `src/translator-runtime/schema.ts` + `src/translator-runtime/zotero-schema.json` — schema bundle + helpers
- `src/translator-runtime/translator-fetcher.ts` — CDN fetcher
- `src/translator-runtime/host-bridge.ts` — postMessage protocol
- `src/translator-runtime/zotero-translate.d.ts` — ambient typings for upstream framework
- `src/translator-runtime/*.test.ts` — Vitest tests for each adapter (~6 test files)
- (Optional, dev's call) `src/translator-runtime/spike-page.html` + `spike-page.ts` if AC6 option (b) is chosen

**Modified files (first-party):**

- `manifest.config.ts` — add `sandbox.pages` + extend `host_permissions`
- `.github/workflows/ci.yml` — `submodules: recursive` on checkout step
- `README.md` — add Cloning + submodule init section + architecture pointer
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — flip BE-8-4 status (Task 0.3 + Task 10.4)
- `scripts/add-spdx-headers.sh` — verify/add `vendor/` exclusion (only if not already)

**Untouched (explicitly named so dev doesn't drift):**

- `src/popup/**` — popup UI; BE-8-4 does NOT change the user-facing capture flow
- `src/lib/auth-client.ts`, `src/lib/connector-client.ts`, `src/lib/tag-colors.ts`, `src/lib/types.ts` — existing libs; the spike POSTs via existing `connector-client.ts`, no new code there
- `src/lib/translation-client.ts` — existing client for `translate.milton.so/web`; STAYS, used by BE-7 flow; BE-8-4 adds a parallel path, doesn't replace this
- `src/lib/metadata-to-payload.ts` — MAY be extended (per Task 7.3 decision) to also handle Zotero items, but the existing CSL-JSON path remains for BE-7 backwards compat
- `package.json` — no new dependencies (upstream framework comes via submodule, not npm)
- `pnpm-lock.yaml` — unchanged if `package.json` unchanged

### Submodule mechanics (the bits the dev MUST get right)

- **Pin discipline:** `.gitmodules` defines path + URL; the SHA pin is recorded by `git submodule status` (Git tracks the submodule's checked-out commit as a "gitlink" in the parent repo's tree). To update the pin later (in a future story), `cd vendor/zotero-translate && git fetch && git checkout <new-SHA> && cd ../.. && git add vendor/zotero-translate && git commit -m "chore(BE-8-X): bump zotero-translate submodule to <new-SHA>"`. Do NOT do this in BE-8-4 unless the originally-picked SHA has a critical issue surfaced during the spike.
- **CI submodule init:** `actions/checkout@v4` with `submodules: recursive` is the canonical pattern. `recursive` handles nested submodules (zotero/translate may have its own — verify with `git submodule status` recursively after clone).
- **Fresh-clone init:** new contributors MUST run `git submodule update --init --recursive` after cloning. Without it, `vendor/zotero-translate/` is an empty directory and typecheck/build fails with confusing errors. README must document this.
- **`vendor/**` exclusion from SPDX script:** upstream files have their own AGPL headers; running `add-spdx-headers.sh` over them would prepend Milton's header, which is wrong (license attribution) AND would mark vendor/ as locally-modified vs the submodule pointer, breaking `git submodule status --recursive` cleanliness. Verify the script honors a `vendor/` exclusion before running it after Task 2.
- **`vendor/zotero-translate/` is read-only to us:** never edit a file under `vendor/zotero-translate/` directly. If upstream needs a patch, three options in order of preference: (1) work around it in our adapter layer (`src/translator-runtime/`); (2) upstream the fix to `zotero/translate` and bump the pin; (3) maintain a patched fork (last resort — creates ongoing merge burden).
- **`.gitignore` and the submodule:** the submodule pointer (the gitlink) IS tracked; the submodule's working-tree contents AREN'T — Git records the SHA, the checkout repopulates the directory. Don't add `vendor/` to `.gitignore` (it would mask local changes silently).

### MV3 sandbox page: why we need it + how it works

- **MV3 CSP constraint:** extension pages and the service worker run under Chrome's MV3 default CSP `script-src 'self'; object-src 'self'` which **forbids** `eval`, `new Function(source)`, and similar dynamic-code-execution APIs. Translator JS bodies are downloaded as text and MUST be executed — there's no way around this. Hence the sandbox.
- **What "sandbox page" means in MV3:** a manifest-declared HTML page (`manifest.sandbox.pages`) that Chrome serves with `script-src 'self' 'unsafe-eval'; object-src 'self'` CSP (eval allowed), AND with a **different origin** than the rest of the extension. The sandbox page runs in an opaque origin — its `window` doesn't share state with popup or SW, and it CAN'T call `chrome.*` APIs directly. Communication is via `window.postMessage` (and `MessageChannel`).
- **What this means for the architecture:** the sandbox page is the translator-execution surface. The popup/SW caller sends a `translate-request` postMessage in; the sandbox runs the translator and sends a `translate-response` back out. Any browser API the translator needs (fetch, DOMParser, document.evaluate XPath, etc.) IS available in the sandbox — only `chrome.*` APIs are not. Fetching translator bytes from BE-8-1 CDN happens **inside** the sandbox (which has fetch + host_permissions thanks to the extension's permission grants, even though the sandbox runs at opaque origin — Chrome honors the parent extension's host_permissions for fetches from sandbox pages).
- **Origin validation in postMessage receivers:** `event.origin` for a sandbox page is `"null"` (literally the string). Validation must compare `event.source === <expected window>` rather than (or in addition to) origin checks. Document the chosen pattern in `host-bridge.ts`.
- **Reference docs (verify currency at story-execution time — Chrome's MV3 docs evolve):**
  - https://developer.chrome.com/docs/extensions/reference/manifest/sandbox
  - https://developer.chrome.com/docs/extensions/develop/concepts/sandboxing-eval

### Zotero host-adapter design — per-module responsibility

`zotero/translate` is designed to be embedded in different host environments (Zotero desktop, Zotero Connector browser extensions, Zotero translation-server). The framework expects the host to provide a set of `Zotero.*` namespaces with specific APIs. Our adapter layer provides Milton-shaped implementations of each:

- **`Zotero.Translators`** — translator registry. In Zotero desktop, backed by a SQLite store + local translator files; in Connector, backed by IndexedDB; in our case, in-memory `Map<string, Translator>` populated on demand from the BE-8-1 CDN. Translators are looked up by ID (`get(id)`) or by URL via `target` regex matching (`getWebTranslators(url)`).
- **`Zotero.HTTP`** — HTTP layer. Translators call `Zotero.HTTP.request(method, url, opts)` to fetch metadata APIs, follow redirects, post forms. Our adapter wraps `fetch()` and reshapes to the `{status, responseText, responseHeaders, responseURL}` envelope translators inspect.
- **`Zotero.Translate.Web`** — the Translation orchestrator. Driven by upstream framework code (in `vendor/zotero-translate/`); our adapter wires it to our `ItemSaver` (which collects items) and to `Zotero.HTTP` (already wired).
- **`Zotero.Translate.ItemSaver`** — item persistence. In Zotero desktop, writes to the user's library database; in our case, **collects** items in memory and exposes them to the caller (the caller then POSTs to `127.0.0.1:7521/references` via existing `connector-client.ts`). This is the cleanest persistence boundary — keeps the runtime stateless and lets the caller decide what to do with extracted items.
- **`Zotero.Schema`** — Zotero item-type schema (which fields are valid for `journalArticle` vs `book` vs `preprint`, etc.). Some translators introspect this for validation. We vendor a snapshot of `https://api.zotero.org/schema` at build time. Refresh procedure: `curl https://api.zotero.org/schema > src/translator-runtime/zotero-schema.json && git diff`; bump when upstream schema adds item types we want to support.
- **`Zotero.debug`** — debug logging. Map to `console.log` (or no-op in production builds). Translators call this liberally; without it, calls throw.
- **`Zotero.Date`** — date parsing utilities. Upstream framework provides this; surface via the framework import.
- **`Zotero.Utilities`** — item normalization (cleaning whitespace, parsing names, etc.). Upstream framework provides this.
- **`Zotero.RDF`, `Zotero.BibTeX`, `Zotero.RIS`, etc.** — format-specific utilities. Upstream framework provides these. Our `sandbox.ts` ensures they're surfaced under the `Zotero` global so translators that need them work.

Reference for the host-adapter surface: `zotero/zotero-connectors/src/zotero/` contains the Connector's implementation of the same adapters; it's the closest precedent for a browser-extension context and should be the first place to look when an API question arises. Don't copy verbatim (different scope, different license boundary), but use it as a sanity-check against API drift.

### arXiv as integration spike target — why it's the right pick

- **Class 1 (publicly accessible):** arXiv abs pages don't require cookies, sessions, or bot-protection bypass. The sandbox can fetch them via plain `Zotero.HTTP.request(url)`. This isolates the spike to "does the runtime work?" without mixing in "does the cookie-sharing model work?" (which is BE-8-7's problem).
- **Simple translator:** the arXiv translator (`arXiv.org.js` in `zotero/translators`) is ~150 LOC, well-maintained, and outputs a single `journalArticle`/`preprint` item per call. No multi-item disambiguation; no JS-rendered content; no follow-up requests required for basic metadata.
- **Well-known URL pattern:** `https://arxiv.org/abs/<arxiv-id>` is unambiguous; translator `target` regex is simple; matching is deterministic.
- **Doubles as BE-7 regression target:** the same arXiv URL (`https://arxiv.org/abs/2303.08774`) is in BE-7's smoke matrix; if the new runtime extracts the SAME metadata BE-7's path extracts, that's reassuring evidence the runtime works correctly (not just "doesn't crash").
- **High dogfood value:** arXiv is a major capture surface for Pierre's reading; getting it working end-to-end on the new runtime is a real-world signal, not a synthetic test.

If the spike succeeds on arXiv: green-light for BE-8-5 (curated bundle) which scales the runtime to ~100 publishers. If the spike fails: surface the failure mode to Pierre immediately + escalate per charter v2 risk fallback.

### Previous story intelligence

**From BE-8-3 (done 2026-05-16) — extension extracted to public AGPL repo:**

- The AGPL boundary is established at the repo level (`COPYING` + per-file SPDX on `src/**`). BE-8-4's submodule import lands inside that boundary cleanly; vendor/ AGPL code is already-AGPL and stays so.
- SPDX-header script (`scripts/add-spdx-headers.sh`) is idempotent; verify `vendor/` exclusion before running post-submodule-add (Task 2.5).
- CI baseline post-extraction: 21s for the bootstrap PR (install + typecheck + test + build). BE-8-4's submodule init adds ≤ 10s; target end-state CI runtime ≤ 35s.
- PR title convention: `feat(BE-N): ...` for code PRs (BE-8-4 = code). PR opens as non-draft from the start (CLAUDE.md Rule 3).
- IPC self-check verbatim text in PR body — see BE-8-3 PR #42 for the exact phrasing pattern (charter v2 standing rule).
- Pierre G17-1 smoke is the HARD gate for runtime changes; JSDOM cannot smoke browser-extension UI/runtime work. BE-8-4 has runtime changes (sandbox page; postMessage bridge; translator execution) — smoke is non-negotiable.
- The 22-line deprecated stub at Milton-saas `tools/browser-extension/README.md` points HERE. Any developer who lands at the stub is one click away from this repo.

**From BE-8-2 (done 2026-05-16) — connector bytes endpoint:**

- The Milton-desktop side is UNTOUCHED by BE-8-4. BE-8-2 added `POST /references/{id}/pdf-bytes`; BE-8-4 doesn't use that endpoint (PDF bytes upload is BE-8-7's territory). BE-8-4 only POSTs to `POST /references` (the existing endpoint from story 17-5 / 18-1).
- BE-8-2 set the IPC-self-check precedent for Milton-saas-side stories ("ZERO touches under `tools/browser-extension/`"). BE-8-4 inverts this: extension-only ("ZERO touches under `milton/`"). Mirror discipline.

**From BE-8-1 (done 2026-05-16) — translator-mirror CDN:**

- BE-8-1 deployed the CDN at `https://translators.milton.so/repo/` mirroring `zotero/translators`. BE-8-4 fetches translator bytes from THIS endpoint (per AC5).
- BE-8-1's metadata-index endpoint (if one exists) is the source-of-truth for translator IDs and `lastUpdated` values. Task 6.1 looks up the arXiv translator ID via this OR via the upstream `zotero/translators` repo directly.
- BE-8-1 set the "sub-project standalone, no pnpm-workspace coupling" precedent — relevant because BE-8-4 introduces `vendor/zotero-translate/` which has its own `package.json` but MUST NOT be added to a workspace (would pull its devDeps into our install).

**From BE-7 (done 2026-05-15) — auto-attach PDF on extension save:**

- BE-7's BE-7-side code paths (`translation-client.ts` calling `translate.milton.so/web`, popup capture flow, PDF-attach logic) are STAYING. BE-8-4 adds a PARALLEL runtime path; doesn't replace BE-7's path. The user-facing popup flow continues to use BE-7's path for the duration of BE-8-4.
- AC10 scenarios 6-7 are the BE-7 regression checks — same URLs BE-7 used in its smoke matrix, same expected outcomes. If those break in BE-8-4, BE-8-4 is broken (we shouldn't be touching the BE-7 path at all).

### Git intelligence summary

Recent commits relevant to BE-8-4 (from this repo's `git log --oneline`):

| SHA | Subject | Relevance to BE-8-4 |
|---|---|---|
| `aef24ca` | chore(bmad): add .claude/commands/ slash shims + commit CLAUDE.md (#3) | Most recent main commit; sets up the dev surface this story runs in |
| `ac4fe75` | chore(bmad): add BMAD framework + paths-ignore _bmad/ in CI (#2) | `_bmad/` and `_bmad-output/` infra; story files live under the latter |
| `f293ee7` | chore(BE-8-3): mark done — story complete, all gates green | The "done" marker for the story BE-8-4 depends on |
| `3c4789e` | chore(bmad): sync BE-8-3 story file with latest progress narrative | BE-8-3 closeout; sets the precedent for story-file fidelity |
| `eb2daf2` | chore(bootstrap): AGPL license + CI + BMAD post-extraction sweep (#1) | The bootstrap PR that established this repo's AGPL boundary + CI surface BE-8-4 uses |

What git history confirms is NOT shipped yet:
- No `vendor/` directory in this repo (verify with `ls vendor/ 2>/dev/null` returning nothing)
- No `.gitmodules` file (verify with `cat .gitmodules 2>/dev/null` returning nothing)
- No sandbox page in `dist/manifest.json` (verify after `pnpm build` on `main`)
- No `src/translator-runtime/` directory

### Latest tech information

- **`zotero/translate` upstream state:** verify at story-execution time. Check `https://github.com/zotero/translate` (or fall back to `zotero/zotero-connectors/src/zotero/` per AC1 atypical) for the latest stable commit. If upstream has been quiet for months, prefer pinning to the last commit before that quiet period (lower risk than HEAD if HEAD is a WIP). Pin to a specific SHA; do NOT pin to a moving ref.
- **`zotero/translators` upstream state:** the *translator scripts* repo (separate from `zotero/translate` engine). BE-8-1 mirrors this. arXiv translator lives at `zotero/translators/arXiv.org.js`. The translator's `translatorID` field is the load-bearing identifier for `Zotero.Translators.get()`.
- **MV3 manifest sandbox docs:** Chrome's official docs at `https://developer.chrome.com/docs/extensions/reference/manifest/sandbox` document the sandbox-page mechanism. Verify these docs are current at story-execution time (Chrome's extension platform churns; the sandbox semantics could change with a Chrome version bump).
- **Zotero schema source-of-truth:** `https://api.zotero.org/schema` returns the canonical JSON schema. Bundle a snapshot; refresh periodically as item types are added upstream.
- **CRXJS plugin version:** `@crxjs/vite-plugin@2.4.0` per current `package.json`. If sandbox-page emission turns out to be unsupported in this version (per AC3 atypical), check the plugin's GitHub issues or upgrade.

### Testing standards

- Vitest 4 with `environment: 'node'` per current `vitest.config.ts`. New adapter tests follow this; per-file `// @vitest-environment jsdom` directive if DOM is needed (e.g., `zotero-http.test.ts` for `responseType: 'document'` tests, `host-bridge.test.ts` for postMessage mocking).
- Test names follow current convention: `describe('moduleName', () => { it('behavior under condition', ...) })`. See existing `popup-helpers.test.ts` and `auth-client.test.ts` for tone.
- Coverage is INFORMAL (no enforced threshold in this repo). Target: every adapter module has tests covering success path + at least one error path + at least one edge case. Floor = 3 tests per adapter module.
- DO NOT test by hitting live `translators.milton.so` or `arxiv.org` from CI. Mock `fetch` via Vitest's `vi.spyOn(globalThis, 'fetch')`. Spike testing on live URLs is Pierre's manual smoke (G17-1).
- Sandbox-page behavior is JSDOM-blind in important ways (sandboxing is a Chrome feature, not JSDOM); end-to-end sandbox tests are smoke-only (AC10).

### Verify third-party library APIs against `node_modules` types before implementing

`zotero/translate` has no published TypeScript types. Our `src/translator-runtime/zotero-translate.d.ts` is the ambient type surface; it's LOAD-BEARING (anything wrong here is wrong everywhere). Verify shape against:
- Actual usage in `vendor/zotero-translate/src/translate.js` (read the source — it IS the spec)
- Cross-reference `zotero/zotero-connectors/src/zotero/` for how the Connector consumes the same framework
- Cross-reference Zotero's official translator docs: `https://www.zotero.org/support/dev/translators` (last verified URL — confirm at story execution)

Do NOT trust this story file's API descriptions as canonical — they're a starting sketch. The dev MUST read upstream source for ground truth before committing the `.d.ts`.

### References

- [Source: `_bmad-output/planning-artifacts/charter-v2.md`#Story Map (line 118)] — BE-8-4 row scope verbatim
- [Source: `_bmad-output/planning-artifacts/charter-v2.md`#Risks & Mitigations (line 149)] — integration-spike sub-task mitigation
- [Source: `_bmad-output/planning-artifacts/charter-v2.md`#Architecture (lines 76-105)] — IPC boundary diagram; Class 1/2/3 flow distinctions
- [Source: `_bmad-output/planning-artifacts/charter-v2.md`#Locked Decisions table — Decision 10] — "Manifest permissions: all-at-once at install"; sets expectation for BE-8-4's host_permissions additions
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` line 151] — `BE-8-4-translator-runtime-lift: backlog`; charter-tied scope summary
- [Source: `_bmad-output/implementation-artifacts/BE-8-3-extension-extracted-to-public-agpl-repo.md`#Dev Notes] — AGPL boundary mechanics; SPDX-header script behavior
- [Source: `CLAUDE.md`#ABSOLUTE RULES Rule 0] — Cut feature branch BEFORE first edit in `/bmad_bmm_dev-story`; Task 0 here is the literal application of this rule
- [Source: `CLAUDE.md`#Git Workflow Rule 1] — Don't push until story is done locally; Task 8.2 is the single push event
- [Source: `CLAUDE.md`#Git Workflow Rule 3] — PR opens as non-draft from start; Task 8.2 honors this
- [Source: `manifest.config.ts` (current state)] — existing `permissions: ['activeTab']` + `host_permissions: ['https://translate.milton.so/*']`; AC3 extends the latter
- [Source: `.github/workflows/ci.yml` (current state)] — `actions/checkout@v4` without args; AC2 adds `submodules: recursive`
- [Source: `package.json` (current state)] — `@crxjs/vite-plugin@2.4.0`; check sandbox-page emission support
- [Source: External — `https://github.com/zotero/translate`] — primary upstream submodule source
- [Source: External — `https://github.com/zotero/zotero-connectors`] — reference implementation for browser-extension host adapters (read-only; don't copy)
- [Source: External — `https://github.com/zotero/translators`] — translator scripts source; BE-8-1 CDN mirrors this; arXiv translator's metadata lookup target
- [Source: External — `https://developer.chrome.com/docs/extensions/reference/manifest/sandbox`] — MV3 sandbox page mechanism (verify currency at execution time)
- [Source: External — `https://api.zotero.org/schema`] — canonical Zotero item-type schema; vendor snapshot at build time
- [Source: External — `https://www.zotero.org/support/dev/translators`] — Zotero translator framework documentation
- [Source: Memory — [[feedback-capture-correctness-over-ui-polish]]] — Pierre prioritizes capture correctness over per-type icon variation; the spike's success criterion is "ref appears correctly", not "ref appears AND popup gets a fancy badge"
- [Source: Memory — [[feedback-monitor-ci-in-background]]] — Background-watch CI runs; surface result rather than poll
- [Source: Memory — [[feedback-never-mark-done-before-everything-green]]] — Story does NOT flip review → done until: pre-merge CI green + post-merge main CI green + Pierre G17-1 smoke 7/7
- [Source: Memory — [[feedback-claude-owns-merge-call-at-story-close]]] — Dev-agent surfaces "recommend merge" with evidence; Pierre says "go" → dev-agent merges

### Project Structure Notes

- **New top-level convention: `vendor/`** — first time this repo has a `vendor/` directory. Convention: third-party submodules + vendored code goes here, NEVER under `src/`. `src/` stays first-party Milton code only. If BE-8-5 or later vendors additional code (translator bundle as static JSON, schema snapshots, etc.), follow the same pattern.
- **`src/translator-runtime/` as a new top-level src subtree:** parallel to `src/popup/` and `src/lib/`. Rationale: the runtime is a self-contained subsystem with a clear external interface (postMessage protocol) — keeping it under its own subtree makes BE-8-6's port to `chrome.scripting.executeScript` (which will share most of the adapter code) easier to reason about.
- **No conflicts with the existing unified project structure** — `src/popup/`, `src/lib/`, `src/assets/` all untouched; `vendor/` is additive.
- **Detected variance:** the new sandbox.html sits at `src/translator-runtime/sandbox.html` (not under `src/popup/` or at repo root). This is intentional — sandbox pages and popup pages are different MV3 page types and shouldn't be co-located. Rationale: makes the manifest's `sandbox.pages` array unambiguous in code review.

### Documentation Consolidation Notes

<!-- Record key decisions, new patterns, and behaviors here for Paige (tech-writer agent) to consolidate into feature documentation at epic completion. Keep entries to 2-3 lines each. -->

- **Submodule import pattern:** First use of `git submodule` in milton-browser-extension; pinned-by-SHA discipline; CI `submodules: recursive`; fresh-clone init instruction in README. Reusable template for future third-party-AGPL imports.
- **MV3 sandbox-page pattern for CSP-restricted code execution:** Sandbox page declared in manifest; opaque origin; postMessage bridge to popup/SW; eval-permitted CSP allows translator JS execution. Reusable for any future need to run dynamic JS (LLM prompt templates, user scripts, etc.).
- **Host-adapter shape for `zotero/translate`:** Milton's implementation of `Zotero.Translators` / `Zotero.HTTP` / `Zotero.Translate.ItemSaver` / `Zotero.Schema` lives in `src/translator-runtime/`. Reusable surface — BE-8-6 will reuse most of it for the `chrome.scripting.executeScript` page-context variant.
- **Zotero schema vendoring strategy:** snapshot at build time from `https://api.zotero.org/schema`; refresh procedure documented in dev notes. Reusable for any other Zotero artifact that needs versioned snapshotting.
- **Error envelope convention for runtime errors:** Typed errors (`TranslatorNotFoundError`, `TranslatorFetchError`, `TranslatorMalformedError`) at module boundaries; no swallowed throws; postMessage responses include `error?: {code, message, cause?}` shape. Adopt for future runtime modules.
- **Integration-spike-first pattern for high-risk lifts:** charter v2 mandate; BE-8-4 proves with arXiv before BE-8-5 scales. Adopt for any future high-risk runtime adoption.

## Pre-Review Self-Check

<!-- Before requesting code review, verify each item and check the box. -->

Standard project-wide checklist (mix of applies / N/A — BE-8-4 introduces new production TypeScript so MORE items apply than for BE-8-3):

- [ ] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke) — **N/A**, no UI changes (sandbox page is dev-only HTML stub; existing icons unchanged).
- [ ] File list in story matches actual files changed — verify Dev Agent Record File List mirrors `git diff --name-status main` on the BE-8-4 branch.
- [ ] No raw hex color values — all colors use PandaCSS tokens — **N/A**, no CSS changes (PandaCSS is Milton-desktop's tokenization; not relevant here).
- [ ] `$effect` dependencies checked against async boundaries (no split reactive state across `await`) — **N/A**, no Svelte runes (extension is vanilla TS).
- [ ] Superforms tests use real adapter (not mocked) — **N/A**, no Superforms.
- [ ] Barrel imports only — no direct imports from `features/*/utils/` — **N/A**, no `features/` directory.
- [ ] No type casts (`as any`, `as unknown as T`) in new production code — test mocks excepted — **APPLIES** (adapter code is the temptation zone; if a cast feels necessary, surface in PR description with rationale).
- [ ] Error paths handled — all async operations have try/catch or .catch() — **APPLIES strongly** (new async surface: fetch, postMessage, translator execution; every await needs an explicit error path).
- [ ] IPC command results checked for error states before use — **APPLIES** (postMessage bridge has error responses; callers MUST check `response.error` before using `response.items`).
- [ ] Loading states span full async lifecycle (set before await, cleared in finally) — **N/A**, no UI loading states (the spike is dev-internal; no popup UI lifecycle).

Story-specific subsection (BE-8-4 runtime-lift gates):

- [ ] Submodule pinned by SHA in `.gitmodules` (not by moving ref); SHA recorded in Change Log
- [ ] `vendor/zotero-translate/**` files UNMODIFIED vs upstream (verify `git diff vendor/` returns empty)
- [ ] `scripts/add-spdx-headers.sh` skipped `vendor/` (verify by running script post-Task-5; assert zero changes under `vendor/`)
- [ ] `actions/checkout@v4` uses `submodules: recursive` in CI
- [ ] First CI run on BE-8-4 feature branch GREEN; runtime ≤ 35s
- [ ] `manifest.config.ts` `sandbox.pages` entry built into `dist/manifest.json` (verify post-build)
- [ ] `host_permissions` extended with 3 new origins; permission warning visible on extension install/update
- [ ] All new files under `src/translator-runtime/**` carry SPDX `AGPL-3.0-or-later` header
- [ ] `pnpm typecheck` clean; `pnpm test` green; test count ≥ 130
- [ ] Translator-fetcher uses Vitest mock for fetch (NOT live CDN) in tests
- [ ] Sandbox page opens without CSP errors at `chrome-extension://<id>/<sandbox-path>`
- [ ] arXiv spike end-to-end on `https://arxiv.org/abs/2303.08774`: ref appears in Milton with correct metadata (title, authors, year, arXiv ID)
- [ ] arXiv spike on second URL (`https://arxiv.org/abs/1706.03762`): cache hit verified, ref appears correctly
- [ ] arXiv spike on unmatched URL (`https://arxiv.org/list/cs.AI/recent`): fails gracefully, no crash, no ref created
- [ ] BE-7 regression scenarios 6 + 7 PASS (existing popup flow unchanged by BE-8-4)
- [ ] IPC-boundary `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returns ZERO hits — evidence in PR body
- [ ] PR body includes verbatim AC9 IPC self-check + submodule-import note
- [ ] Spike trigger surface decision (a/b/c) recorded in Change Log + confirmed with Pierre before final commit
- [ ] arXiv translator ID + `lastUpdated` value recorded in Change Log
- [ ] Vendored Zotero schema snapshot date + refresh procedure documented in dev notes
- [ ] `README.md` "Cloning + submodule init" section added; warns about confusing-errors-on-fresh-clone-without-init
- [ ] Post-merge main CI green (URL recorded; per [[feedback-monitor-post-merge-ci-on-main]] if memory exists; else background-watch per [[feedback-monitor-ci-in-background]])
- [ ] **Red/blue-team-added items (from auto-method-17 elicitation):**
- [ ] Submodule pin-stability check (Task 1.4) passed — `git ls-remote <repo> <SHA>` resolved before Task 2 commit
- [ ] Submodule runtime-dependency audit (Task 5.0) completed BEFORE adapter coding; decision matrix in dev notes
- [ ] Translator execution timeout implemented — default 10s; `TranslatorTimeoutError` on overrun
- [ ] Schema vendored via explicit `curl` one-liner; refresh procedure documented in dev notes
- [ ] Spike timebox (Task 7.7) honored — if spike failed >2h cumulative debugging, escalation surfaced to Pierre (not silently ground)
- [ ] AC10 scenario 0 baseline verified BEFORE merging — BE-7 paths green on `main` (prevents misattributing pre-existing breakage to BE-8-4)
- [ ] AC8 CSP validation explained transitively via AC10 scenarios 3-5 in PR body (no isolated CSP test exists; reviewer expectation set)
- [ ] If `github.com/zotero/translate` 404'd, HALT-and-surface protocol followed (NOT silent swap to `zotero-connectors`) — decision documented in Change Log

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Author | Summary |
|---|---|---|
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad SM workflow) | Story drafted via `/bmad_bmm_create-story`. Charter v2 BE-8-4 scope applied; 11 ACs + 10 tasks (~45 subtasks). Pre-draft gating: Pierre confirmed BE-3 stays deferred + that creating BE-4 was a typo for BE-8-4 (BE-4 already done; story file exists). Spike trigger surface left as a Task 7.1 decision (default (a) console command — surface to Pierre before commit). Submodule upstream source defaults to `github.com/zotero/translate` with fallback to `zotero/zotero-connectors/src/zotero/` per AC1 atypical. Status: `ready-for-dev`. Sprint-status flipped `backlog → ready-for-dev`. |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | **Dev-story started.** Branch `feat/BE-8-4-translator-runtime-lift` cut from `main@ab63a3c` per CLAUDE.md Rule 0 (planning artifacts committed to main first: `cd971f1` workflow customization + `ab63a3c` story drafted). Pacing: Pierre confirmed Tasks 0-9 in one session; Task 8 G17-1 smoke is the natural Pierre-handoff. Status flipped `ready-for-dev → in-progress`. **Task 1 pre-flight pin SHA:** `git ls-remote https://github.com/zotero/translate.git HEAD` → `d08300c2c01a4d6ef325f05cbefc6c138a99f811` on `refs/heads/master` (NOT `main`; upstream uses `master`). Commit health verified via GitHub API: author Abe Jellinek (active Zotero maintainer), date 2026-04-23 (~3 weeks ago — not stale, not WIP), message "Add support for clearing challenge in browser (#45)" — real feature work. PIN APPROVED. |
| 2026-05-16 | Claude (Opus 4.7 1M, BMad SM workflow — auto-method-17) | **Red Team vs Blue Team elicitation applied automatically** per Pierre-customized default flow (codified in same session — see memory `[[feedback-create-story-default-flow]]`). 11 red-team attacks → 11 hardening edits auto-applied across AC/Task/Dev-Notes sections. Red-team attack summary: (1) AC1 fallback to zotero-connectors was hand-wavy — now HALT-and-surface instead of silent swap; (2) AC6 spike trigger surface was a dev decision — now hard-defaulted to console command per `[[feedback-capture-correctness-over-ui-polish]]`; (3) AC8 CSP testability silent — added transitive-validation note tied to AC10 scenarios 3-5; (4) AC7 test-count target `≥130` arbitrary — replaced with per-module floor (success + error + edge); (5) Submodule pin SHA could move between Task 1.1 and Task 2 — added Task 1.4 pin-stability `git ls-remote` check; (6) Translator execution had no timeout — added `timeoutMs` (default 10s) + `TranslatorTimeoutError`; (7) Task 5.4 schema vendoring "at build time" ambiguous — tightened to explicit `curl` one-liner with documented refresh procedure; (8) Task 7 spike could grind for days without escalation — added Task 7.7 2-hour timebox with surface-to-Pierre escalation; (9) AC10 missing baseline — added scenario 0 BE-7 pre-merge baseline to prevent misattribution; (10) Submodule runtime deps could surprise dev mid-Task-5 — added Task 5.0 dependency-audit step BEFORE adapter coding; (11) AC10 fresh-clone smoke owner was ambiguous — now `[D] then [P]` (dev pre-push + Pierre sideload). 8 Pre-Review Self-Check items added covering the new hardening. Story still ready-for-dev pending Pierre's final validation. |
