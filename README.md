# Milton Browser Extension

**Status:** BE-1 scaffold + BE-4 auth migration + BE-2 rich popup UX (incl. Figma redesign pass) + BE-7 auto-attach PDF on PDF pages shipped. Functional end-to-end against current prod. BE-3 backlog.

## What this does

Chromium MV3 extension that captures academic-page metadata and creates references in Milton:

1. User clicks the toolbar button on any page
2. Extension fetches a per-save EdDSA JWT from Milton's local connector
3. Extension POSTs the URL + Bearer token to `translate.milton.so/metadata` (unified orchestrator)
4. Receives a metadata envelope (`{source_tier, primary:{authors, year, doi, …}, candidates}`)
5. Popup shows editable metadata preview (title / authors / date / abstract) + tag chip autosuggest, plus an "Add to..." tab for collections / projects (BE-2)
6. User clicks Save → POST extended payload to `127.0.0.1:7521/references`
7. Milton creates the reference atomically + shows a toast

While the metadata fetch is in flight (the slow step), the connector's `GET /tags` + `GET /projects` + `GET /collections` run in parallel so the tag selector ("Main info" tab) and the collections / projects picker ("Add to..." tab) are ready by the time the user looks at them.

## Prerequisites — ALL MET

- Translation server live at `translate.milton.so` with per-user JWT auth (TS-2 / TS-3 / TS-5 / TS-6 / TS-14)
- Milton local connector at `127.0.0.1:7521` with `/auth/issue-token` endpoint (Story 17-5 + 18-15)
- Connector extended payload (tags / projects / collections atomic transaction) + `GET /tags` + `GET /projects` + `GET /collections` (Story 18-1)

## Auth flow

The extension carries **no shared API key**. Every save runs the following pipeline:

```
[ popup save click ]
        ↓
1. POST 127.0.0.1:7521/auth/issue-token         (local Milton connector)
        ↓
   200 { token, expires_in: 30 }                  ← EdDSA-signed JWT, 30s TTL
        ↓
2. POST translate.milton.so/metadata             (Authorization: Bearer <token>)
   body = URL text/plain
        ↓
   200 { source_tier, primary: {…}, candidates }  ← metadata envelope
        ↓
3. POST 127.0.0.1:7521/references                (local Milton connector)
   body = mapped ConnectorReferencePayload
        ↓
   201 → "Saved to Milton ✓"
```

Why no token caching: 30-second TTL means caching saves nothing real (a single browsing session will already invalidate it), localhost round-trip is sub-millisecond, and always-fresh tokens close the multi-account-switch race window cleanly.

### Popup state matrix

| Connector probe / token mint / translate call / save | UI state |
|---|---|
| Milton not running / connector refused | "Milton isn't running" + Open Milton deep-link + "Don't have Milton? Get it here" |
| Connector returns 401 (signed out) / any selector GET returns 503 | "Sign in to Milton" + Open Milton deep-link |
| Health OK → entering preview (metadata + selectors loading) | "Main info" tab: Preview header with skeleton "Extracting metadata…" + "Loading…" placeholder in the Tags section |
| Metadata loaded; tags loaded | "Main info" tab: editable preview rows + tag chips + Save button. "Add to..." tab: collections / projects picker (sub-toggle + search + checkbox list) |
| Tags fetch returned non-503 error | "Tags unavailable" inline note; Save still works with empty arrays |
| Token mint succeeds | "Save to Milton" enabled (gated by non-empty title) |
| Token mint 403 (origin not on allowlist) | "Authentication failed" — dev/Web-Store-ID mismatch |
| Token mint 429 (rate limit) | "Too many requests, try again in Ns" |
| Translate server 401 expired | Silent retry once with fresh token |
| Translate server 401 device_not_registered | "Sign out and back in to Milton to re-register this device" |
| Translate server 402 quota_exceeded | "Free quota reached. Next slot in N…, or upgrade for unlimited" + Upgrade Milton CTA |
| Translate server 402 tier_required | "This feature requires the {tier} plan or higher" + Upgrade Milton CTA |
| Translate server 503 service_unavailable | "Translation service unavailable, try again in Ns" |
| Translate server source_tier:"empty" | "Couldn't extract metadata" + Try-again button |
| Connector 400 (Invalid tag/project/collection ID — concurrent delete) | "Couldn't save" + offending id in monospace |
| Connector 503 on POST /references (signed out) | "Sign in to Milton" + Open Milton deep-link |
| Connector 409 (duplicate) | "Already in your library" + existing reference id. **Org metadata is NOT applied retroactively** per protocol "dedup is a no-op" rule |

### Origin allowlist (deployment checklist)

Milton's local connector validates the extension's chrome-extension origin against `MILTON_EXTENSION_IDS` (comma-separated allowlist).

- **Debug builds**: any `chrome-extension://*` origin is accepted automatically (CRXJS generates a fresh ID per dev install).
- **Release builds**: `MILTON_EXTENSION_IDS` must be set; if unset, all extension origins are denied (fail-closed).
- **After Chrome Web Store publication**: the prod extension ID is fixed but different from the dev ID. It must be added to `MILTON_EXTENSION_IDS` in the Milton release config before the published extension can talk to Milton.

## Sideload (developer mode)

Step-by-step to install the extension in Chrome / Edge / Brave:

1. **Install dependencies**
   ```bash
   cd tools/browser-extension
   pnpm install --ignore-workspace
   ```
   The `--ignore-workspace` flag keeps this self-contained — without it, pnpm 10 falls through to Milton's parent workspace. (The `.npmrc:ignore-workspace=true` setting in this directory is silently ignored by pnpm 10.28.2; only the CLI flag is honored. Tracked as tech-debt.)

2. **(Optional) Set the translate base** — `cp .env.local.example .env.local`. Production URL is the default; only edit if you want to point at a local docker-compose stack.

3. **Build the extension**
   ```bash
   pnpm build
   ```
   Outputs to `dist/`. Rebuild after any source change OR any `.env.local` change.

4. **Sideload into Chromium**
   - Open `chrome://extensions/` (or `edge://extensions/` / `brave://extensions/`)
   - Toggle **Developer mode** ON (top-right)
   - Click **Load unpacked**
   - Select the `dist/` folder
   - The Milton toolbar icon appears

5. **Use it**
   - Open any academic page (arXiv, PubMed, journal, etc.)
   - Click the Milton toolbar icon
   - Click **Save** in the popup
   - The reference appears in Milton with a "Reference added from browser" toast

## Smoke test (BE-4 + BE-2 + BE-7 gate)

| Scenario | Expected outcome |
|---|---|
| `https://arxiv.org/abs/2303.08774` (no selectors) | Saves reference; Milton toast; preview-only flow still works |
| arXiv + 1 existing tag + 1 new tag + 1 project + 1 collection | All four arrays wired into the payload; Milton library shows tags + project + collection on the ref |
| PubMed article URL with 3 mixed tags | All 3 tags appear; chip colors deterministic |
| Nature / Springer article URL with DOI — edit title before saving | Edited title used (not the translation-server original) |
| Same arXiv URL again with DIFFERENT tags selected | "Already in your library" 409 message. Verify in Milton library that the ORIGINAL ref's tags are unchanged (dedup-is-noop) |
| Sign out of Milton, then click toolbar | "Sign in to Milton" view + Open Milton deep-link works |
| Quit Milton, then click toolbar | "Milton isn't running" + Open Milton deep-link works |
| Delete a project in Milton, then click Save in popup with that project selected | 400 "Invalid project ID" with the deleted id in monospace |
| Empty title (clear in inline edit) | Save button disabled; "Title is required" helper shown |
| Cmd+Enter from inside any edit field | Triggers Save when title non-empty |
| **BE-7** `https://www.econstor.eu/bitstream/10419/32581/1/623739976.pdf` (Pierre's repro) | Reference created; PDF downloads + attaches within ~30s; library shows attached file. |
| **BE-7** `https://arxiv.org/pdf/2303.08774.pdf` (arXiv direct PDF) | Reference created; PDF attached via the new direct path (`source: extension_direct` in PostHog). |
| **BE-7** `https://arxiv.org/abs/2303.08774` (arXiv abs page — HTML) | Reference created; PDF attached via the EXISTING OA-discovery path (`source: arxiv`) — confirms `maybe_spawn_auto_fetch` now fires from the connector. |
| **BE-7** Page with `.pdf.html` filename | Reference created; no direct-fetch attempted (mimeType `text/html` correctly rejected). |

## Charter + sprint

- Charter: [`_bmad-output/planning-artifacts/charter.md`](_bmad-output/planning-artifacts/charter.md)
- Sprint status: [`_bmad-output/implementation-artifacts/sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml)
- BE-1 story: [`_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md`](_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md)
- BE-4 story: [`_bmad-output/implementation-artifacts/BE-4-auth-migration-connector-token.md`](_bmad-output/implementation-artifacts/BE-4-auth-migration-connector-token.md)
- BE-2 story: [`_bmad-output/implementation-artifacts/BE-2-rich-popup-selectors.md`](_bmad-output/implementation-artifacts/BE-2-rich-popup-selectors.md)

## Tech stack

- Vite ^7.3 + `@crxjs/vite-plugin` ^2.4 + TypeScript ^5.9 (Manifest V3)
- Vitest ^4.1 for unit tests (auth + translation-client dispatch + metadata-to-payload mapping)
- Chromium-only for v1 (Chrome / Edge / Brave); Firefox is a separate sprint
- Distribution: sideload `dist/` (Load unpacked) for v1; Chrome Web Store packaging is a follow-up

## Visual design

The popup is styled to Milton's Figma design system (Figma node `1323:8984`, "Browser extension"):

- Pixel-perfect to the Figma frame: Figma Background/Text token set, card surfaces (`#f5f5f5`, 14px radius) for the metadata preview and the tag section, flat `#e5e5e5` tag chips, 1px `#ebebeb` separator, brand-black (`#0a0a0a`) full-width Save button
- The "Main info / Add to..." segmented tab control is implemented and functional — "Main info" is the metadata preview + tags; "Add to..." is the collections / projects picker (collections/projects sub-toggle + search + scrollable checkbox list). "Save to Milton" is shared across both tabs
- Light-only, matching the Figma frame (no `prefers-color-scheme: dark` override)
- **Font:** the design uses Milton's **SN Pro** brand font, but every `sn-pro-*.woff2` in the Milton repo is a corrupted HTML document (not a real font — they fail `OTS` decode in-browser). Until valid woff2 files exist, the popup falls back to the system UI font; `'SN Pro'` is kept first in the family stack so a real-font drop works with zero code change. _(Pre-existing Milton bug — Milton's own `app.css` references the same broken files; logged as TD-70.)_
- Vanilla CSS, self-contained — no imports from Milton's frontend (BE-1 self-containment rule)

## Scripts

```bash
pnpm install --ignore-workspace   # install deps (workspace flag required on pnpm 10+)
pnpm dev                          # Vite dev server with HMR (popup hot-reloads)
pnpm build                        # Production build → dist/
pnpm typecheck                    # tsc --noEmit
pnpm test                         # vitest run
```

## Story map

| ID | Title | Status |
|---|---|---|
| BE-1 | Scaffold + connector client + signed-out detection + sideload package | shipped |
| BE-4 | Auth migration — connector token + JWT to translation-server | shipped |
| BE-2 | Rich popup UX (metadata preview + tag / project / collection selectors) | shipped |
| BE-3 | Page-detection content script | backlog (deferred) |
| BE-7 | Auto-attach PDF when saving from a PDF page (silent best-effort via new connector `pdfUrl` field + SSRF-defensive direct fetch) | shipped |
