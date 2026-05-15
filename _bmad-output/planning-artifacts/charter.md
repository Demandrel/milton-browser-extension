# Milton Browser Extension — Charter

> ⚠️ **SUPERSEDED 2026-05-15 — pending Charter v2.** BE-2 and BE-7 dogfood empirically invalidated this charter's core architecture assumption (URL-only extension forwarding to server-side `translate.milton.so`). Cloudflare bot-management (Elsevier / ScienceDirect / Wiley / Springer) and Anubis (econstor) gate non-browser HTTP clients at the network layer — Milton's server cannot fetch metadata or PDFs from these sites regardless of translator quality. Zotero's Connector solves this by running translators in the user's browser context. **Charter v2 will pivot to the Zotero-Connector model** (AGPL extension + closed-source Milton-desktop over IPC, per `_bmad-output/research/zotero-architecture-research-2026-05-15.md`). DO NOT use this v1 charter as canonical scope for BE-8+. Read `_bmad-output/planning-artifacts/be-8-pivot-handoff.md` first.

**Status (v1):** charter, CONFIRMED via Pierre Q1–Q9 (2026-05-04). **Superseded 2026-05-15.**
**Drafted:** 2026-05-04 by BMad Master
**Sprint:** `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml`

## Predecessors (all green)

| Prerequisite | Status | Source |
|---|---|---|
| Milton local connector server `127.0.0.1:7521` (`/health`, `POST /references`) | ✅ done | Story 17-5 |
| Connector extended payload (atomic transaction with `tagIds[]` + `newTagNames[]` + `projectIds[]` + `collectionIds[]`) + `GET /tags`, `GET /projects`, `GET /collections` | ✅ done | Story 18-1 (commit `596d710`) |
| Translation server validated + deployed at `translate.milton.so` | ✅ done | TS-2 / TS-3 / TS-5 |

## Goal

Ship the missing piece of Epic 18's **Capture** theme: a Chromium MV3 browser extension that lets Pierre click a toolbar button on any academic page and have the reference appear in Milton — optionally tagged + filed into a project / collection — without leaving the browser.

## Architecture

```
Browser tab (any URL)
  │
  └─▶ User clicks toolbar button (always-on)
        │
        └─▶ Extension popup opens
              │
              ├─▶ GET 127.0.0.1:7521/health  (connector reachable + signed in?)
              │     └─ if signed-out: show "Open Milton" → milton:// deep-link
              │
              ├─▶ POST translate.milton.so/web  { url: <current tab URL> }
              │     └─ returns Zotero-flavored CSL-JSON
              │
              ├─▶ Render preview: title / authors / year / journal (editable inline)
              │
              ├─▶ GET 127.0.0.1:7521/tags        (autosuggest source)
              ├─▶ GET 127.0.0.1:7521/projects    (multi-select source)
              ├─▶ GET 127.0.0.1:7521/collections (multi-select source)
              │
              └─▶ User clicks Save
                    │
                    └─▶ POST 127.0.0.1:7521/references  (extended 18-1 payload)
                          └─ atomic txn: ref + tags + projects + collections
                          └─ Milton toast + popup confirms success
```

## Themes (1)

**Capture** — extension companion to 17-5 (connector) + 18-1 (extended payload) + TS-5 (translation server). Closes the "browser extension polish" line item from Epic 18 charter.

## Story map

| ID | Title | One-line scope | Depends on |
|---|---|---|---|
| **BE-1** | Scaffold + connector client + signed-out detection + sideload package | Vite + CRXJS + TS scaffold; manifest V3; toolbar button → minimal popup → POST URL to `translate.milton.so/web` → POST CSL-JSON to connector → toast in Milton; `GET /health` probe on popup open with "Open Milton" deep-link fallback when signed out; `pnpm build` produces sideload-ready `.crx`. | 17-5, 18-1, TS-5 |
| **BE-2** | Rich popup UX (metadata preview + tag / project / collection selectors) | Editable preview of fetched CSL-JSON; tag autosuggest input (chips colored via `getTagColor` hash, NO color picker); project + collection multi-select; submission uses 18-1 extended payload with `tagIds[] + newTagNames[] + projectIds[] + collectionIds[]`. | BE-1 |
| **BE-3** | Page-detection content script (DEFERRED) | Content script scans DOM (DOI in metadata, OG type=`article`, known journal hosts) and surfaces a badge when academic page detected. Promoted only after BE-2 dogfood validates the always-on flow. | BE-2 |

## Out of scope (v1)

- Firefox build (separate sprint — MV3 differences + AMO review)
- ~~PDF binary upload from extension (Milton's 15-1a auto-fetch handles OA-PDF download server-side)~~ — **SUPERSEDED by BE-7 (2026-05-15).** BE-2 dogfood found two gaps the original assumption missed: (a) the connector's `add_reference` handler never triggered `maybe_spawn_auto_fetch` (asymmetry with the IPC `create_reference` path); (b) 15-1a's pipeline is OA discovery (Unpaywall → arXiv), not direct-URL download — working papers / repository PDFs (e.g. econstor) yield nothing. BE-7 closes both with a new `pdfUrl` field on `POST /references` + a dedicated SSRF-defensive direct-fetch path. No PDF binary in the wire — extension passes a URL hint, Milton downloads server-side.
- Auto-detect content script (BE-3 deferred)
- Chrome Web Store publishing (sideload-first; store after stability proven)
- Tag color picker (memory rule: tags have NO user-supplied color)
- Cross-device extension sync; account linking beyond connector auth state
- PDF area selection / capture-as-image
- "Save selection" partial-page capture

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| MV3 service worker lifetime kills any background polling | Health check on popup-open only; no background polling. All network calls scoped to popup lifetime. |
| `127.0.0.1:7521` unreachable from extension origin (CORS, mixed-content from HTTPS pages) | 17-5 already permits localhost origin; smoke as first BE-1 task. If blocked, fall back to `chrome.runtime` message → background fetch (MV3 service worker has fewer mixed-content restrictions). |
| `translate.milton.so` per-user `MILTON_KEY` (per 18-6 design) not yet wired | BE-1 ships with shared dev key in `.env.local`; per-user key flow follows 18-6 model when 18-6 lands. Document in BE-1 Dev Notes. |
| Tags-have-no-color slip into UI | Explicit AC in BE-2: chips MUST use `getTagColor(name)` hash function imported as utility (or replicated locally); NO color picker, NO `tagColor` field anywhere. |
| Extension version vs. Milton version drift | `GET /health` returns Milton version; popup logs warning to console if extension build > Milton (non-blocking). |
| Vite + CRXJS HMR vs. manifest V3 strictness | CRXJS handles MV3 service-worker reload natively; document `pnpm dev` workflow in README. |

## Success criteria (MV1 = BE-1 + BE-2)

1. Pierre sideloads `.crx` in Chrome; toolbar icon visible.
2. Pierre opens an arXiv / journal / PubMed page, clicks the toolbar button, sees the popup with fetched metadata.
3. Pierre adds a tag (existing or new), picks a project, clicks Save.
4. Within ~1s: Milton shows a toast confirming the import; popup shows success state.
5. Reference appears in Milton's library with correct metadata, tags linked, project membership wired.
6. Signed-out path: popup shows "Open Milton to sign in" with a `milton://` deep-link button; clicking it focuses Milton.
7. `pnpm build` reproducibly produces a `.crx` artifact in `tools/browser-extension/dist/`.

## Tech stack (locked by Pierre Q2 + Q9)

- **Vite + CRXJS + TypeScript** — TS parity with Milton bindings; HMR via `@crxjs/vite-plugin`
- **Manifest V3** — Chromium-only target (Chrome / Edge / Brave)
- **Independent minimal styling** — no PandaCSS coupling; popup-scoped CSS (`<style>` block or single `popup.css`)
- **Distribution** — sideload `.crx` for v1; Chrome Web Store after dogfood

## Pierre's answers — final (2026-05-04 charter session)

| Q | Answer |
|---|---|
| Q1 — Browser scope | **a** — Chromium-only (Chrome + Edge + Brave) |
| Q2 — Build tool | **b** — Vite + CRXJS + TypeScript |
| Q3 — Page-detection model | **a** — Always-on toolbar button (auto-detect deferred to BE-3) |
| Q4 — Popup UX richness | **b** — Rich (metadata preview + tag / project / collection selectors) |
| Q5 — Signed-out handling | **yes** — detection + "Open Milton" deep-link button |
| Q6 — PDF binary upload | **a** — Metadata-only; Milton's 15-1a handles PDF fetch |
| Q7 — Distribution | **c** — Sideload first, Chrome Web Store later |
| Q8 — Story breakdown | **b** — 3 stories (BE-1 / BE-2 / BE-3 deferred) |
| Q9 — Popup design system | **b** — Minimal independent styling (no PandaCSS coupling) |

## Charter sign-off

- [x] Goal + theme
- [x] Architecture diagram
- [x] All 9 scoping questions answered
- [x] Out-of-scope list complete
- [x] Story map = 3 stories (BE-1 / BE-2 / BE-3 deferred)

**Ready for `/bmad_bmm_create-story BE-1` to generate the first formal story file.**
