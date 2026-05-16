# Milton Browser Extension — Charter v2

> **CANONICAL.** This charter replaces v1 (`charter.md`, SUPERSEDED banner) per
> the Browser Extension v2 product brief
> (`_bmad-output/planning-artifacts/product-brief-browser-extension-v2-2026-05-15.md`,
> merged to `main` 2026-05-15 as commit `15c6aac1` via PR #32). **Read the
> brief first** for full rationale; this charter translates the brief's 10
> locked decisions into sprint-shaped scope.

**Status (v2):** charter, ready for `/bmad_bmm_sprint-planning`.
**Drafted:** 2026-05-15 by Claude (BMad Master pattern) with Pierre.
**Sprint:** `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml`

## Predecessors

| Capability | Source |
|---|---|
| Connector at `127.0.0.1:7521` with `/health`, `/references`, `/tags`, `/projects`, `/collections` | Story 17-5 + 18-1 |
| `translate.milton.so` deployed | Stories TS-2 / TS-3 / TS-5 |
| Extension scaffold + sideload `.crx` build + auth deep-link | Story BE-1 |
| Popup with rich UX (metadata preview + tag / project / collection pickers) | Story BE-2 |
| PDF auto-attach on extension save + SSRF-defensive direct-fetcher + magic-byte content gate + race-condition fix + OA-spawn asymmetry close | Story BE-7 (PR #30) |
| BE-v2 product brief (10 locked decisions, north star) | PR #32, commit `15c6aac1` |

## Goal

Close the Class 2/3 capture gap by pivoting Milton's browser extension from
"URL forwarder → server-side translation" to "browser-side translator runtime
+ Milton-client" — the model Zotero's Connector uses. Repurpose the server
(LLM-extraction backend key broker + Class 1 + Crossref) and aggressively
downsize it. Position LLM-fallback as Milton's genuine differentiation beyond
capture parity.

**North star:** Pierre uninstalls Zotero Connector after a week of BE-v2
dogfood.

## Locked Decisions

10 brief-locked + 1 charter-locked. Full rationale + trade-offs are in the
brief; this table is the lookup index.

| # | Decision | Lock |
|---|---|---|
| 1 | Architectural path | **#3** — AGPLv3 extension + closed-source Milton-desktop over IPC (fallback to #1 if an enforcement complaint surfaces) |
| 2 | Translator distribution | Hybrid (curated bundle + CDN long-tail) |
| 3 | LLM-extraction location | Milton-desktop (Rust → Anthropic via Milton-server key broker) |
| 4 | Server fate | Downsize post-MVP; GROBID retires with LLM-fallback |
| 5 | IPC bytes wire shape | Two-step (`POST /references` then `POST /references/{id}/pdf-bytes`) |
| 6 | Translator update cadence | Bundled subset pinned at build |
| 7 | In-app URL-paste failure UX | Explicit error + install/launch extension CTA |
| 8 | BE-7 backwards compatibility | Coexist (`pdfUrl` survives; bytes-upload added on top) |
| 9 | Distribution channel | Sideload-first (.crx) |
| 10 | Manifest permissions | All-at-once at install (Zotero-Connector parity) |
| **A** | **Extension repo structure** | **A1** — extension extracted to separate public repo [`Demandrel/milton-browser-extension`](https://github.com/Demandrel/milton-browser-extension) 2026-05-16 via BE-8-3 (force-pushed filter-repo'd history `d42e037` → `ad60d7e`). Unambiguous AGPL boundary; Milton-saas (parent) is private as of 2026-05-16 (the original charter wording "already public" was incorrect — drift caught + corrected during BE-8-3 execution). |

### Repo Extraction (BE-8-3 outcome, 2026-05-16)

- **New public repo:** `Demandrel/milton-browser-extension` — visibility `public`, license `agpl-3.0` (auto-applied by `gh repo create`, replaced by `COPYING` AGPL-3.0-or-later in bootstrap PR), default branch `main`, 6 topics (`agpl`, `browser-extension`, `manifest-v3`, `milton`, `references`, `zotero`).
- **History extraction:** 537 → 13 commits via `git filter-repo --subdirectory-filter tools/browser-extension` (0.47s rewrite + 1.14s repack in throwaway clone at `/tmp/milton-saas-be8-3-extraction`). Full BE-1 → BE-8-2 lineage preserved with original commit messages, author, dates, and co-author trailers.
- **Force-pushed initialization:** `gh repo create --license agpl-3.0` autoinit commit `d42e037` (with AGPL-3.0 `LICENSE` file) replaced by filter-repo'd HEAD `ad60d7e` (BE-8-2). The `LICENSE` file is no longer on `main`; the bootstrap PR adds `COPYING` as the canonical license file.
- **CI:** Extension-only pipeline at `.github/workflows/ci.yml` (~50 lines: pnpm install + typecheck + test + build + artifact upload; NO Tauri/Rust/SvelteKit toolchain, NO apt cache, `timeout-minutes: 10`).
- **AGPL signaling:** 3-layer — `COPYING` at root (full GNU AGPL v3 text, 661 lines, SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`), `package.json` `"license": "AGPL-3.0-or-later"`, SPDX short-form headers on all 17 first-party source files under `src/**` (via idempotent `scripts/add-spdx-headers.sh`).
- **Deprecated stub in Milton-saas:** delivered via the Milton-saas-side `chore(BE-8-3): ...` PR — `tools/browser-extension/` reduced to a ≤30-line `README.md` pointing at the new repo + cutover SHAs + AGPL note. `tools/translator-mirror/` UNTOUCHED in Milton-saas (operational sync + signing key stays at the source).
- **IPC boundary verified:** `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src/` returned zero hits in the new repo at bootstrap time. The boundary remains HTTP-only (extension → Milton-desktop via `127.0.0.1:7521`; extension → Milton-server via `translate.milton.so`).

## Themes

| Theme | Stories | Purpose |
|---|---|---|
| **Capture parity (Class 2/3)** | BE-8-1, 2, 4, 5, 6, 7 | The bar BE-v2 must clear; closes the Clara-test gap |
| **LLM-fallback differentiation** | BE-8-8 | The genuine differentiation beyond parity (Marc's anchor user) |
| **License execution + server downsize** | BE-8-3, 9 | Operational house-cleaning bracketing the sprint |

## Architecture

(Canonical reference is the brief Solution section; reproduced here for
sprint-planning convenience.)

```
─── Class 2 (cookie/session-gated PDF) ───
Browser tab (user's challenge-solved cookies + session)
  └─▶ Extension fetches PDF bytes client-side
        ├─▶ POST 127.0.0.1:7521/references     (metadata first)
        └─▶ POST 127.0.0.1:7521/references/{id}/pdf-bytes  (multipart binary)
              └─▶ Milton-desktop attaches PDF
              └─▶ (optional) LLM-extraction if metadata sparse

─── Class 3 (JS-rendered article page) ───
Browser tab (user's rendered DOM + cookies)
  └─▶ Extension runs translator in page context (chrome.scripting.executeScript)
        └─▶ POST 127.0.0.1:7521/references     (structured item JSON, NOT URL)
              └─▶ Milton-desktop stores reference

─── Class 1 (kept working) ───
User pastes URL in Milton-desktop
  └─▶ Milton → translate.milton.so/web         (current path; no change)
        └─▶ Server-side translator (arXiv-class sites)
        └─▶ On Cloudflare/Anubis failure → "Install extension" CTA in Milton-desktop

─── LLM fallback (sparse metadata or PDF-only) ───
Milton-desktop (Rust)
  └─▶ Milton-server (/api/llm/extract — key broker, relay only)
        └─▶ Anthropic API
              └─▶ Merge response with whatever translator produced
```

## Story Map

Risk-staircase order (greenfield → bug-fix → bisection-heavy → architectural)
per standing rule. Dependencies traced so sprint planning can parallelize
where safe.

| ID | Title | Scope summary | Theme | Risk | Depends on |
|---|---|---|---|---|---|
| **BE-8-1** | Translator-mirror CDN setup | Cloudflare CDN + static origin (R2 or KV); mirrors `zotero/translators` subset; metadata endpoint (versioning + translator-id → bytes); pinned-at-build pull mechanism for the bundled subset | Capture | Low | — |
| **BE-8-2** | Connector bytes endpoint | Add `POST /references/{id}/pdf-bytes` (multipart binary) to Milton's connector; raise body cap (~50 MiB); SSRF + size limits; tests | Capture | Low | — |
| **BE-8-3** | Extension extracted to public AGPL repo | New public repo (slug TBD: `Demandrel/milton-browser-extension` or similar); AGPL-3.0-or-later `COPYING` + per-file headers; CI replicated; BE-1/2/7 code moved with history preserved (`git filter-repo`); `tools/browser-extension/` in Milton-saas becomes deprecated stub pointing to new repo | License | Low-medium | — (parallelizable with BE-8-1, 2) |
| **BE-8-4** | Translator runtime lift | Import `zotero/translate` as AGPL submodule into extracted extension repo; implement required `Zotero.Translators`, `Zotero.HTTP`, `Zotero.Translate.ItemSaver`; schema init; sandbox-page integration for MV3 CSP. Includes integration-spike sub-task (one publisher end-to-end before scaling) | Capture | Medium-high | BE-8-3 |
| **BE-8-5** | Curated translator bundle + lazy CDN-fetch | Build pipeline bundles ~50-100 publishers (Elsevier suite, Wiley suite, Springer Nature, arXiv, PubMed, SSRN, RePEc, econstor, JSTOR, IEEE, ACM, Sage, Taylor & Francis, Nature, Cell Press, bioRxiv, medRxiv, ...) into .crx; runtime CDN-fetch fallback for long-tail; translator registry tracks bundled-vs-fetched state and gracefully falls back | Capture | Medium | BE-8-1, BE-8-4 |
| **BE-8-6** | Class 3 capture flow | Extension runs translator in page context via `chrome.scripting.executeScript`; POSTs structured item JSON to `POST /references`; popup state-machine extended with translator-running / translator-done / translator-fallback states | Capture | Medium-high | BE-8-4, BE-8-5 |
| **BE-8-7** | Class 2 capture + paste-failure UX | Extension fetches PDF bytes client-side using the user's session (same-origin fetch within tab context — no `chrome.cookies` access needed); two-step IPC (BE-8-2 endpoint); popup progress UI for upload. **Plus:** Milton-desktop surfaces "Install Milton browser extension" error + deep-link CTA when `translate.milton.so` returns a "site requires browser context" failure | Capture | High | BE-8-2, BE-8-6 |
| **BE-8-8** | LLM-fallback in Milton-desktop | Rust calls Anthropic API via Milton-server key broker (`/api/llm/extract` relay endpoint — desktop never sees the API key); trigger thresholds (PDF-only with no embedded metadata; translator returns <N fields; user-flagged "this looks incomplete"); consent prompt (one-time, opt-in); Pro-tier gate; per-call cost ceiling + per-user monthly cap; PostHog `ai_extraction_used` event | LLM-fallback | High | BE-8-7 (needs Class 2 PDF surface for end-to-end testing) |
| **BE-8-9** | Server downscale + GROBID retire | Migrate `translate.milton.so` to smaller hosting (specific destination — small VPS / Fly free / Cloudflare Worker — is an operational call at execution); remove GROBID; verify Class 1 + DOI/Crossref + LLM-key-broker still work; cost-tracking dashboard | Server downsize | Low-medium | BE-8-8 |

## Out of Scope (for BE-8 epic)

Inherited from brief MVP Scope section. Highlights:

- Chrome Web Store distribution (sideload-first per Decision 9; separate epic post-stabilization)
- Firefox / Safari builds (separate epic per browser)
- Auto-update for bundled translators (bundled is pinned at build per Decision 6; post-MVP enhancement)
- BE-3 page-detection content script (deferred per BE-1 charter)
- Auto-detect extension + deep-link from Milton-desktop URL-paste (post-MVP refinement on Decision 7; BE-8-7 ships the explicit-CTA version)
- Bulk capture / batch import; PDF area selection; "save selection" partial-page capture
- Cross-device extension sync; mobile capture (iOS / Android)
- Pro-tier billing UI / payment flow (LLM-fallback ships Pro-gated; billing UI is a separate epic)
- Server-side anti-bot stack (explicit non-goal per Problem Statement)
- Bidirectional Zotero sync (out of scope; Milton's import is one-way)
- Tag color picker (memory rule: tags have no user-supplied color)
- BE-2 popup UX refinements beyond what BE-2 shipped (polish is post-MVP)

## Risks & Mitigations (sprint-execution level)

Distinct from brief-level risks (which were architectural / strategic). These
are sprint-execution risks specific to BE-8 stories.

| Risk | Mitigation |
|---|---|
| `zotero/translate` runtime has Zotero-desktop-specific assumptions that don't lift cleanly to a browser-content-script context | BE-8-4 includes an integration-spike sub-task: get the runtime working end-to-end on ONE publisher (recommend arXiv) before scaling. If lift fails, fallback is custom scrapers per publisher (significantly higher cost; would also force a brief revisit) |
| MV3 service-worker lifetime kills translator execution mid-run on slow pages | BE-8-6 uses `chrome.scripting.executeScript` (page-context, not service-worker-context); content-script lifetime is bound to tab, not service worker |
| Class 2 cookie/session sharing varies between Chromium variants (Chrome / Edge / Brave) | Smoke matrix in BE-8-7 ACs covers all three Chromium variants; per-variant failures route to tech-debt or follow-on story |
| Bytes endpoint body cap violated by very large PDFs (e.g. 100 MB+ books) | BE-8-2 sets a generous-but-bounded cap (50 MiB); larger files return a clean error; user-facing error message implemented in BE-8-7 |
| LLM-fallback trigger threshold tuning generates unexpected cost spike | BE-8-8 includes per-user monthly cap (hard ceiling, fail-closed) + PostHog dashboard for invocation rate. Cap > Pro-tier expected usage; spike triggers alert before bill |
| Migration of `tools/browser-extension/` to new public repo loses git history | BE-8-3 uses `git filter-repo` (or equivalent) to preserve subdirectory history; PR descriptions in the new repo reference old commit hashes; deprecated stub in Milton-saas points to new repo |
| Path #3's "extension never imports Milton-desktop code" mitigation discipline drifts over time | Story-level AC on every BE-8-* story that touches both repos: "Does this PR violate the IPC boundary (i.e., does Milton-desktop import extension code or vice versa)?" — explicit Yes/No check |
| Translator-mirror CDN serves stale translator versions long after Zotero updates them upstream | BE-8-1 includes a periodic pull mechanism from `repo.zotero.org` (cron / webhook); staleness window documented; bundled translators are still pinned at build per Decision 6 (CDN affects long-tail only) |
| Milton-server key broker (BE-8-8) becomes a single point of failure for LLM-fallback | Brief commits to Milton-desktop-direct as the architecture; key broker is the *minimum* server-side function; if broker fails, LLM-fallback degrades to "unavailable" (graceful) rather than "broken capture" |

## Success Criteria

From brief MVP Success Criteria — **4 gates** (lawyer gate removed per
post-merge scope change):

1. **Coverage gate (per-class).** Class 1: 100% (no regression vs BE-7). Class 2 + 3: every site named in the brief's problem-class table captures successfully on Pierre's actual reading surface.
2. **Regression gate.** Zero BE-7 sites that worked then fail in BE-v2.
3. **Cost gate.** Total monthly run-rate (hosting + API) tracked; material drift without Pro-tier monetization triggers LLM-trigger-discipline review.
4. **LLM-fallback gate.** Marc's long-tail test — at least one working-paper PDF from a personal academic website (no translator exists) yields successful metadata extraction.

When all four gates are met, BE-v2 is **ship-ready**. When the north star is
hit (Pierre uninstalls Zotero Connector after a week of dogfood), BE-v2 has
**shipped success**.

## Tech Stack

Inherited from BE-1 unless noted:

| Component | Choice |
|---|---|
| Build tool | Vite + CRXJS + TypeScript (BE-1) |
| Manifest version | V3 (Chromium-only) |
| Popup styling | Independent minimal CSS (BE-1 charter Q9; carries forward) |
| **New: Translator runtime** | `zotero/translate` (AGPLv3) as git submodule of the new extension repo |
| **New: Translator registry** | Custom, mirroring Zotero's `repo.zotero.org` pattern |
| **New: Translator-mirror CDN** | Cloudflare CDN + static origin (R2 or KV) — destination decided in BE-8-1 |
| **New: Extension license** | AGPL-3.0-or-later (`COPYING` at repo root + per-file headers on translator runtime) |
| **Milton-desktop side** | Rust (existing) + Anthropic SDK via Milton-server relay endpoint |
| **Milton-server side** | Existing `translate.milton.so` + new `/api/llm/extract` relay endpoint |
| **PostHog events** | `ai_extraction_used { source_type, fields_extracted, model }` (BE-8-8) |

## Charter Sign-Off Checklist

- [x] Goal aligned with brief north star
- [x] All 10 brief-locked decisions reflected
- [x] Charter-level Decision A (repo structure) locked at A1
- [x] 3 themes defined
- [x] 9 stories mapped, risk-staircase ordered, dependencies traced
- [x] Out of scope inherited from brief
- [x] Sprint-execution risks distinct from brief-level risks
- [x] Success criteria = brief's 4 gates + north star
- [x] Tech stack updated for AGPL translator runtime + LLM fallback

**Ready for `/bmad_bmm_sprint-planning`** to generate the formal `sprint-status.yaml` entries for BE-8-1 through BE-8-9.
