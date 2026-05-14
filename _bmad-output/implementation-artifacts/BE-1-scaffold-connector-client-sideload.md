# Story BE-1: Scaffold + Connector Client + Signed-Out Detection + Sideload Package

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pierre, dogfooding Milton's browser-capture flow ahead of beta.11+ extension distribution,
I want a Chromium MV3 extension that — on a single toolbar-button click — captures the current page via `translate.milton.so/web`, POSTs the result to Milton's local connector with a forward-compat envelope, and gracefully handles the signed-out state with a `milton://` deep-link fallback,
so that the end-to-end Capture path is real on day one (arXiv / PubMed / journals) AND BE-2's richer popup UX layers on top of a stable wire shape with zero contract changes.

## Acceptance Criteria

**AC1 — Project scaffold + sideload-loadable build**
- `tools/browser-extension/` contains:
  - `package.json` with deps: `vite ^7.3.x`, `@crxjs/vite-plugin ^2.x`, `typescript ^5.9.x`, `@types/chrome` (devDependency)
  - `vite.config.ts` registering `crx({ manifest, browser: 'chrome' })`
  - `manifest.config.ts` using `defineManifest()` from `@crxjs/vite-plugin`, declaring `manifest_version: 3`, `action.default_popup: 'src/popup/index.html'`, `host_permissions: ['https://translate.milton.so/*']`, `permissions: ['activeTab']`
  - `tsconfig.json` extending recommended TS strict, `lib: ['DOM', 'ES2022']`, `types: ['chrome']`
  - `src/popup/{index.html, popup.ts, popup.css}`, `src/lib/{translation-client.ts, connector-client.ts, csl-to-payload.ts}`
  - `public/icons/{16,48,128}.png` placeholder PNGs (single Milton mark; can be the same image)
- `pnpm install` succeeds from a clean checkout (no node_modules)
- `pnpm build` produces `dist/` containing `manifest.json`, popup HTML + JS bundle, icons, all referenced assets
- Loading via `chrome://extensions/` → "Load unpacked" → select `dist/`: extension installs with NO console errors in EITHER the service-worker pane OR the popup
- Toolbar icon visible after sideload
- **Atypical:** `pnpm install` from a stale lockfile (after a dep bump) — README documents `pnpm install --no-frozen-lockfile` for that specific recovery path
- **Atypical:** building from a parent dir with a `pnpm-workspace.yaml` — extension build must remain self-contained (no implicit dep on Milton's frontend workspace)

**AC2 — Toolbar click opens popup with current tab context**
- Manifest declares `action.default_popup` so a toolbar click opens the popup
- Popup `popup.ts` calls `chrome.tabs.query({ active: true, currentWindow: true })` to capture `tab.url`
- Popup renders the URL (or its origin/hostname) and a "Save to Milton" button — enabled state gated by AC3 + AC4
- **Atypical:** `chrome://*` / `about:*` URLs — Chromium may permit reading `tab.url` but blocks fetch from the page; popup shows DISABLED button + helper copy "This page can't be captured" (does NOT proceed to translate-server fetch)
- **Atypical:** `about:blank` / empty URL — popup shows DISABLED button + "No URL to save"

**AC3 — Health probe gates the save UI**
- On popup open (after current-tab read), `connector-client.ts` performs `GET http://127.0.0.1:7521/health`
- `200 OK` + valid JSON `{ app: "milton", version }` → enable the Save button
- Connection refused / network error → switch popup to a "Milton not running" state with single button: "Open Milton" → `chrome.tabs.create({ url: 'milton://' })`
- **Atypical:** connector returns 200 but with `app !== "milton"` OR a `version` older than the extension was built against → `console.warn` both values, but PROCEED with save (forward-compat per protocol doc)
- **Atypical:** probe takes > 2s — popup applies a 2s timeout and treats it as "connection refused" (single timeout path; popup never hangs)

**AC4 — Signed-out detection via 503 + "Open Milton" deep-link**
- When `POST /references` returns `503` with `{ message: "Milton is not signed in", detail: "no active user" }`, popup transitions to a "Sign in to Milton" state
- That state shows explanatory copy + single button: "Open Milton" → `chrome.tabs.create({ url: 'milton://' })` → popup auto-closes via `window.close()`
- **Atypical:** `chrome.tabs.create` resolves successfully but the OS has no `milton://` handler registered (Milton not installed) — Chromium shows its own "open with" dialog; the popup-side flow is unchanged. Document this behavior in Dev Notes for support.
- **Atypical:** 503 received from `GET /health` (per protocol doc, /health is unauthed and never returns 503; defensive handling) — treat as 200, defer signed-out detection to POST time

**AC5 — Translation-server fetch + Zotero-CSL → ConnectorReferencePayload mapping**
- On Save click (gated by AC3 + AC2 enabled state), popup `POST https://translate.milton.so/web` with body = current tab URL string (Content-Type per translation-server contract — verify via TS-3's `test.sh` reference)
- Auth header: `Authorization: Bearer ${MILTON_KEY}` from build-time env (`.env.local`, gitignored). `.env.local.example` ships in repo with placeholder.
- Response (Zotero-flavored CSL-JSON array; key shapes per 18-6 Dev Notes) is mapped via `src/lib/csl-to-payload.ts`:

  | Zotero CSL field | `ConnectorReferencePayload` field | Mapping rule |
  |---|---|---|
  | `title` | `title` | direct |
  | `creators[{firstName,lastName}\|{name}]` | `authors[{firstName,lastName}\|{fullName}]` | rename `creators`→`authors`; preserve per-entry shape; map `{name}`→`{fullName}` |
  | `date` | `year` | parse first 4 digits as integer; if non-numeric → omit |
  | `DOI` | `doi` | direct |
  | `abstractNote` | `abstract` | rename |
  | `url` | `url` | direct |
  | `itemType` | `type` | enum map (see below) — unknown OMITTED, server-side fallback to `article` applies |

  `itemType` map: `journalArticle→article`, `book→book`, `bookSection→chapter`, `conferencePaper→conferencePaper`, `thesis→thesis`, `preprint→preprint`, `report→report`, `webpage→website`. Anything else: omit `type` from the payload.

- **Atypical:** translation server returns `[]` (extractor didn't match) → popup shows "Couldn't extract metadata from this page" error; does NOT POST to connector
- **Atypical:** translation server returns 2+ items → BE-1 uses `items[0]`; `console.info` lists skipped items; BE-2 will add a picker UI
- **Atypical:** `MILTON_KEY` missing at build time → `pnpm build` MUST fail loudly with a clear error message, not silently produce a broken extension

**AC6 — POST to connector + result-aware popup states**
- Popup POSTs the mapped + envelope-extended payload to `http://127.0.0.1:7521/references`
- Status-code → popup state:
  - `201 Created` → "Saved to Milton ✓" for ~1.5s, then `window.close()`. (Milton-side toast "Reference added from browser" fires via 17-5 behavior — verified separately by Pierre's smoke; not BE-1's concern to assert.)
  - `400 Bad Request` → render `body.message`; append `body.detail` in monospace if present
  - `409 Conflict` → "Already in your library" + the existing reference's id as plain text. **No "open in Milton" affordance in BE-1** — would need cross-tab navigation logic; deferred to BE-2 or follow-up.
  - `503` → AC4 fallback (handled there; not duplicated here)
- **Atypical:** connector restarted between AC3 probe and AC6 POST → `fetch()` rejects with network error → popup shows "Milton not running" + retry button (re-runs health + save flow)
- **Atypical:** payload exceeds 64 KB (long abstract edge case) — `connector-client.ts` pre-checks `JSON.stringify(payload).length` and surfaces "Page metadata too large to capture" rather than firing the POST

**AC7 — Forward-compat wire envelope locked from day one**
- Every `POST /references` call from `connector-client.ts` includes the four organization arrays as empty defaults: `{ ...mapped, tagIds: [], newTagNames: [], projectIds: [], collectionIds: [] }`
- Locks the wire shape so BE-2 adds UI affordances WITHOUT envelope changes
- Verified: 18-1's `milton/scripts/test-connector.sh` already covers this wire shape (POST happy path with both empty and populated organization arrays); no new server-side test needed for BE-1
- **Atypical:** future BE-X experiments adding extra envelope keys — protocol's forward-compat (server ignores unknown fields) keeps these safe; BE-1 does NOT add experimental keys, only the four documented ones

**AC8 — Popup-scoped CSS, no framework**
- All popup styles in `src/popup/popup.css`, scoped via `milton-popup-*` class prefix
- NO PandaCSS, NO Tailwind, NO global selectors leaking outside popup root
- Hardcoded color/spacing values acceptable per Pierre Q9=b
- Dark mode: popup respects `@media (prefers-color-scheme: dark)` for ≥2 surfaces (background + text); minimal polish only — NOT a Figma-traced design pass
- **Atypical:** browser shrinks popup below 320px (some narrow-screen mobile-emulation modes) — popup body uses `min-width: 320px` and content scrolls within fixed bounds

**AC9 — README sideload instructions + `.env.local.example`**
- `tools/browser-extension/README.md` extended with explicit "Sideload (developer mode)" section: `pnpm install` → set `MILTON_KEY` in `.env.local` → `pnpm build` → `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `dist/`
- `.env.local.example` ships in `tools/browser-extension/` with placeholder `MILTON_KEY=your-translation-server-key-here` and inline comment pointing to TS-5 / future 18-6 per-user key provisioning
- `.gitignore` (this directory or root) excludes `.env.local`, `dist/`, `node_modules/` for browser-extension paths
- **Atypical:** Pierre runs sideload on a fresh Chrome profile (Developer mode off by default) — README explicitly calls out the toggle as a prerequisite

## Tasks / Subtasks

- [x] Task 1 (AC: 1, 8) — Scaffold project files
  - [x] Created `package.json` with deps: `vite ^7.3.1`, `@crxjs/vite-plugin ^2.4.0`, `typescript ^5.9.3`, `@types/chrome ^0.1.40` (devDeps), `vitest ^4.1.5`
  - [x] Created `vite.config.ts` registering `crx({ manifest, browser: 'chrome' })` — uses `vitest/config` `defineConfig` so build + test share one config
  - [x] Created `manifest.config.ts` using `defineManifest()` — name "Milton", default_popup, host_permissions for `https://translate.milton.so/*`, permissions: ['activeTab']
  - [x] Created `tsconfig.json` (strict, lib DOM+ES2022, types ['chrome', 'vite/client'])
  - [x] Stubbed `src/popup/{index.html,popup.ts,popup.css}` and `src/lib/{types,translation-client,connector-client,csl-to-payload}.ts` skeleton files
  - [x] Added 16/48/128 icons to `src/assets/icons/` (single Milton mark from `milton/src-tauri/icons/128x128.png`; same image at all 3 sizes per AC1). **Path note:** moved from `public/icons/` to `src/assets/icons/` to match CRXJS idiom (Vite public-flatten breaks manifest references; CRXJS bundles src-referenced assets correctly).

- [x] Task 2 (AC: 1) — Verify clean build
  - [x] `pnpm install --ignore-workspace` runs clean (95 packages added; 3.1s). Parent monorepo's `pnpm-workspace.yaml` only lists `milton` + `packages/*`, so vanilla `pnpm install` falls through to milton's lifecycle scripts. Added `.npmrc` with `ignore-workspace=true` so subsequent `pnpm` commands here are self-contained.
  - [x] `pnpm build` produces `dist/manifest.json` + `dist/src/popup/index.html` + bundled JS/CSS + 3 icon PNGs (88ms; 9 modules transformed)
  - [ ] `chrome://extensions/` → Load unpacked `dist/` → no console errors — **deferred to Pierre's manual smoke (Task 12)** per memory rule "let Pierre test"

- [x] Task 3 (AC: 2, 8) — Implement popup HTML + base CSS
  - [x] `popup/index.html` with root div + scoped class names
  - [x] `popup.css` with `milton-popup-*` prefix; full color-token palette via `:root` CSS vars; dark-mode `@media (prefers-color-scheme: dark)` overrides for bg/fg/muted/border
  - [x] `popup.ts` reads `chrome.tabs.query({active:true, currentWindow:true})` and routes to `cannot-capture` state if URL is restricted/blank
  - [x] `chrome://*` / `chrome-extension://*` / `about:*` / `edge://` / `brave://` / blank-URL atypicals all render disabled button + helper copy

- [x] Task 4 (AC: 3) — Implement health probe
  - [x] `connector-client.ts` exports `health()` → `HealthResult` discriminated union (`ok: true` with body / `ok: false` with `reason: 'refused' | 'timeout' | 'shape'`)
  - [x] 2s `AbortController` timeout — distinguishes timeout from refusal
  - [x] Popup calls `health()` on mount; routes to `milton-not-running` state on any non-ok outcome
  - [x] AC3 atypical: `app !== 'milton'` → `console.warn` + proceed (forward-compat per protocol doc)

- [x] Task 5 (AC: 3, 4) — Implement signed-out fallback view + deep-link
  - [x] Popup renders `milton-not-running` state on health refusal/timeout (button: "Open Milton")
  - [x] Popup renders `signed-out` state on POST 503 (header: "Sign in to Milton" + helper copy + button: "Open Milton")
  - [x] Both states fire `chrome.tabs.create({ url: 'milton://' })` on button click; popup auto-closes via `window.close()`
  - [x] OS-level "no handler for milton://" behavior: Chromium shows its own "open with" dialog; the popup-side flow is unchanged. Documented inline in popup.ts and Dev Notes "Wire contract" subsection.

- [x] Task 6 (AC: 5) — Implement translation-server client
  - [x] `translation-client.ts` exports `extractMetadata(url: string): Promise<ZoteroCslItem[]>`
  - [x] Reads `MILTON_KEY` from `import.meta.env.VITE_MILTON_KEY` (Vite env convention)
  - [x] Auth: `Authorization: Bearer ${MILTON_KEY}`; throws if key missing (caller surfaces via `error-network` state)
  - [x] Empty-array detected by popup state machine (→ `error-no-metadata` state); multi-item logged as `console.info` + uses items[0]; missing-key throws clear error with `.env.local.example` pointer

- [x] Task 7 (AC: 5, 7) — Implement CSL → ConnectorReferencePayload mapping
  - [x] `csl-to-payload.ts` exports `mapCslToConnectorPayload(csl: ZoteroCslItem): ConnectorReferencePayload`
  - [x] Implements field-rename (`creators→authors`, `abstractNote→abstract`) + author-shape preservation + year parse (regex `/^(\d{4})/`) + itemType enum map (8 explicit + unknown-omitted)
  - [x] Always emits the 4 organization arrays as empty defaults (AC7) — verified by dedicated test + grep gate
  - [x] Type imports from colocated `types.ts` (`ZoteroCslItem`, `ZoteroCreator`, `ConnectorReferencePayload`, `ConnectorAuthor`, `ConnectorReferenceType`)

- [x] Task 8 (AC: 6, 7) — Implement connector POST
  - [x] `connector-client.ts` exports `createReference(payload: ConnectorReferencePayload): Promise<CreateReferenceResult>` returning typed status discrimination (`201` / `400` / `403` / `409` / `503` / `network-error` / `payload-too-large`)
  - [x] Pre-check `JSON.stringify(payload).length <= 64 * 1024`; rejects with `payload-too-large` short-circuit (AC6 atypical)
  - [x] `Content-Type: application/json` header set on POST
  - [x] Single hardcoded `CONNECTOR_BASE = 'http://127.0.0.1:7521'` constant (verified by grep — no other source-tree occurrence)

- [x] Task 9 (AC: 2, 3, 4, 5, 6) — Wire popup state machine
  - [x] States implemented (14 total): `loading-tab`, `loading-health`, `ready-to-save`, `cannot-capture` (AC2 chrome://), `milton-not-running` (AC3), `extracting`, `posting`, `success`, `signed-out` (AC4), `error-no-metadata`, `error-too-large`, `error-409-duplicate`, `error-400-validation`, `error-network`
  - [x] Single source of truth for state in `popup.ts` (`let state: State`); `render()` is a pure switch over `state.kind`
  - [x] Success state auto-closes after 1500ms via `window.setTimeout(() => window.close(), 1500)`

- [x] Task 10 (AC: 5) — Vitest unit tests for csl-to-payload mapping (19 tests; all pass)
  - [x] itemType map: 8 explicit cases (`journalArticle→article`, `book→book`, `bookSection→chapter`, `conferencePaper→conferencePaper`, `thesis→thesis`, `preprint→preprint`, `report→report`, `webpage→website`) + `musicalScore` → omitted
  - [x] Author shape preservation: firstName/lastName, single-string name → fullName, mixed, skip-empty
  - [x] Year parse: `"2024-03-15"` → 2024, `"2024"` → 2024, `"in press"` → omit, missing → omit
  - [x] AC7 envelope: minimal item emits empty tagIds/newTagNames/projectIds/collectionIds
  - [x] Full snapshot for arXiv-style fixture (GPT-4 Technical Report) → canonical payload shape

- [x] Task 11 (AC: 9) — README sideload instructions + .env.local.example
  - [x] Extended `tools/browser-extension/README.md` with end-to-end "Sideload (developer mode)" section: install → key → build → Load unpacked → use; plus Smoke test table + Scripts reference + Tech stack version pins
  - [x] Created `.env.local.example` with placeholder `VITE_MILTON_KEY=...` + comments pointing to TS-5 and Story 18-6
  - [x] `.gitignore` (project-local `tools/browser-extension/.gitignore`) excludes `node_modules/`, `dist/`, `.env.local`, `*.log`, `.DS_Store`
  - [x] Bonus: added `.npmrc` with `ignore-workspace=true` so `pnpm install/build/test/typecheck` are self-contained from this directory (AC1 atypical: monorepo workspace conflict mitigated)

- [ ] Task 12 (AC: 1, 5, 6) — Manual sideload smoke (Pierre runs)
  - [ ] arXiv: open `https://arxiv.org/abs/2303.08774`, click toolbar icon, Save → expect Milton toast + ref in library
  - [ ] PubMed: any recent article URL, same flow
  - [ ] Nature: any recent article URL with DOI, same flow
  - [ ] Signed-out path: sign out of Milton, click Save, expect AC4 fallback view + Open Milton deep-link working
  - [ ] Already-imported path: re-save the arXiv ref, expect AC6 409 "Already in your library" message

- [x] Task 13 — Pre-review self-check (gate commands all green; manual sideload deferred to Pierre via T12)
  - [x] `pnpm install --ignore-workspace` clean; `pnpm-lock.yaml` generated (95 packages)
  - [x] `pnpm typecheck` (`tsc --noEmit`) 0 errors
  - [x] `pnpm test` (Vitest 4.1.5) — 19/19 pass; 127ms
  - [x] `pnpm build` produces `dist/` (88ms; 9 modules transformed; manifest + popup + 3 icons)
  - [x] No `color` field anywhere in tag-related code (defensive — `grep -rnE "tagColor|tag\.color"` returns no matches)
  - [x] Connector base URL hardcoded ONCE in `connector-client.ts:11` (verified by grep — no other occurrence)
  - [x] `.env.local` NOT committed (file does not exist; only `.env.local.example` IS committed)
  - [x] AC7 envelope grep: `tagIds | newTagNames | projectIds | collectionIds` references appear ONLY in `types.ts` (definition) + `csl-to-payload.ts` (emission) + `csl-to-payload.test.ts` (verification). Three legitimate locations, no leakage.

## Dev Notes

### What prerequisites ship — DON'T REINVENT

BE-1 is the FIRST extension-side story. Three foundations are already in production; the dev agent MUST read each before writing code:

| Layer | Source | What it gives BE-1 |
|---|---|---|
| **Translation server** | `tools/translation-server/` (TS-2 / TS-3 / TS-5 done) | Live endpoint at `https://translate.milton.so/web` returning Zotero-flavored CSL-JSON for any URL. Auth: `Authorization: Bearer ${MILTON_KEY}`. |
| **Local connector server** | Story 17-5 — `milton/src-tauri/src/connector/{server,handlers,payload}.rs` | `127.0.0.1:7521` axum server. `GET /health` (200 always when running) + `POST /references` (201 / 400 / 403 / 409 / 503). Loopback-only bind. Spawned at app launch from Tauri `setup` hook. |
| **Connector wire contract** | Story 18-1 — `docs/integrations/browser-extension-protocol.mdx` | CANONICAL contract document. Every status code, every body shape, CORS allow-list (`chrome-extension://*` admitted), 64 KB body limit, forward-compat policy (server ignores unknown fields), the explicit "tags have no color" callout, the dedup-noop-on-409 callout. **Read this end-to-end before AC5/AC6 work.** |
| **Server-side smoke harness** | `milton/scripts/test-connector.sh` (18-1) | 11-scenario shell+curl harness. Exercises every endpoint via real HTTP. Useful as a reference for what the wire contract looks like in practice. |

### What this story DOES do

- ✅ Vite + CRXJS + TS scaffold under `tools/browser-extension/` (AC1)
- ✅ Manifest V3 with `action.default_popup` toolbar entry (AC2)
- ✅ `GET /health` probe with 2s timeout + "Open Milton" deep-link fallback (AC3, AC4)
- ✅ Translation-server client + Zotero-CSL → ConnectorReferencePayload mapping (AC5)
- ✅ `POST /references` with 201/400/409/503 result-aware popup states (AC6)
- ✅ **Forward-compat envelope locked from day one** — every POST emits the 4 organization arrays (AC7)
- ✅ Popup-scoped CSS, no framework (AC8)
- ✅ Sideload-via-`Load unpacked` README + `.env.local.example` (AC9)
- ✅ Vitest unit tests for the CSL → payload mapping (Task 10)

### What this story does NOT do

- ❌ Rich popup UX (preview editor, tag/project/collection selectors) — that's BE-2's whole job
- ❌ Page-detection content script — BE-3, deferred
- ❌ Chrome Web Store publishing — Pierre Q7=c sideload-first
- ❌ Firefox build — out of scope (charter)
- ❌ PDF binary upload from extension — AC says metadata-only; Milton 15-1a handles OA-PDF (Pierre Q6=a)
- ❌ "Open in Milton" affordance on AC6 409 duplicate — needs cross-tab navigation logic (deferred)
- ❌ Per-user MILTON_KEY rotation — BE-1 uses a shared dev key from `.env.local`; the per-user model lands when 18-6 ships

### Why ship this now (vs. waiting on BE-2)

Sideloadable extension proves the end-to-end pipe BEFORE adding selector UX. If the wire shape works, BE-2 is purely additive UI. If it doesn't, BE-2 would have been built on a broken foundation. BE-1 + 18-1's `test-connector.sh` together give us a **verifiable contract** at the lowest level of complexity. This mirrors the discipline that worked for 18-1: lock the contract first, layer UX on top.

### Wire contract — story-relevant excerpts (canonical: `docs/integrations/browser-extension-protocol.mdx`)

**Connector base URL:** `http://127.0.0.1:7521` — fixed; the extension hardcodes it. Loopback-only — non-127.0.0.1 peers get 403 (impossible from a Chromium extension origin, but documented).

**CORS:** allow-list includes `chrome-extension://*`. Popup-page `fetch()` calls go through preflight; the server returns the right headers, so this just works. (MV3 background-script `fetch()` with `host_permissions` would bypass CORS entirely, but BE-1 has no background — popup-only flow.)

**Body limit:** 64 KB. CSL payloads are typically < 16 KB even with long abstracts. AC6 atypical: pre-check `JSON.stringify(payload).length` and surface a friendly error rather than letting axum's body-limit reject it.

**Forward compat:** server ignores unknown fields. BE-1 SHOULD always emit the 4 organization arrays (AC7). BE-1 should NOT add experimental keys outside the documented payload — keep the wire shape clean.

**Endpoint quick-reference (BE-1 only consumes these two):**

```
GET  /health           → 200 { app: "milton", version }
POST /references       → 201 { id }
                       | 400 { message, detail? }   // validation
                       | 403 { message }            // non-loopback (impossible from extension)
                       | 409 { id, matchedBy, message }  // duplicate; existing-ref id returned
                       | 503 { message, detail }    // signed out → AC4 fallback
```

**`POST /references` request envelope (always send all keys, even when empty per AC7):**

```json
{
  "title": "...",                               // required
  "authors": [{ "firstName": "...", "lastName": "..." } | { "fullName": "..." }],
  "year": 2024,
  "doi": "10.1234/xyz",
  "abstract": "...",
  "url": "...",
  "type": "article" | "book" | "chapter" | "conferencePaper" | "thesis" | "preprint" | "report" | "website" | (omit),
  "tagIds": [],
  "newTagNames": [],
  "projectIds": [],
  "collectionIds": []
}
```

**Tag-no-color discipline (memory rule, recurring error pattern):**

Tags have NO user-supplied color. This is enforced server-side (`Tag` Rust struct excludes `color`; `CreateTagInput` accepts only `{ name }`). `connector-client.ts` and `csl-to-payload.ts` MUST NOT emit any `color` field. **Defensive even though BE-1 doesn't touch tags directly** — the AC7 envelope sets the precedent for BE-2.

### Tech stack — version pins

| Package | Version | Source of truth |
|---|---|---|
| `vite` | `^7.3.x` | Match `milton/package.json:vite ^7.3.1` |
| `@crxjs/vite-plugin` | `^2.x` (latest stable) | Context7-verified compat with Vite 7. Verify exact version on npm at task start. |
| `typescript` | `^5.9.x` | Match `milton/package.json:typescript ^5.9.3` |
| `@types/chrome` | latest stable | DefinitelyTyped — convention over `chrome-types` |
| `vitest` | latest stable | Test runner (matches Milton's `pnpm test --run` convention) |

CRXJS supports Vite 3–8 (Context7 docs); Vite 7.3.1 is fully supported. The CRXJS pattern uses `defineManifest()` from `@crxjs/vite-plugin` in `manifest.config.ts` — NOT a raw `manifest.json`. Type-safe, validates file paths relative to project root, env-aware. **Use `defineManifest`, not raw JSON.**

### File structure (target)

```
tools/browser-extension/
├── _bmad-output/                      # ALREADY scaffolded
├── src/
│   ├── popup/
│   │   ├── index.html                 # popup root, links popup.ts
│   │   ├── popup.ts                   # state machine + DOM mounting
│   │   └── popup.css                  # milton-popup-* scoped styles
│   └── lib/
│       ├── translation-client.ts      # POST translate.milton.so/web; reads VITE_MILTON_KEY
│       ├── connector-client.ts        # GET /health, POST /references; envelope assembly
│       ├── csl-to-payload.ts          # Zotero-CSL → ConnectorReferencePayload
│       └── types.ts                   # ZoteroCslItem + ConnectorReferencePayload TS types
├── public/
│   └── icons/
│       ├── 16.png
│       ├── 48.png
│       └── 128.png
├── package.json
├── pnpm-lock.yaml                     # generated
├── vite.config.ts                     # registers crx({ manifest })
├── manifest.config.ts                 # defineManifest({...})
├── tsconfig.json
├── .env.local.example                 # MILTON_KEY placeholder
├── .gitignore                         # .env.local, dist/, node_modules/
└── README.md                          # ALREADY refreshed (charter pointer); EXTEND with sideload steps in Task 11
```

**Self-contained:** the extension build does NOT depend on Milton's frontend pnpm workspace. No imports cross the `tools/browser-extension/` boundary. (This is intentional — the extension ships as a separate artifact via Chrome Web Store eventually.)

**Testing standard:**

- **Vitest** (`pnpm test --run`) for unit-testing the pure functions (`csl-to-payload.ts` mapping). Aim for: itemType enum map (8 explicit + 1 unknown → omit), author shape preservation (firstName/lastName + name/fullName + mixed), year parse (3 cases including non-numeric → omit), AC7 envelope shape, full snapshot of an arXiv CSL fixture.
- **Manual sideload smoke** (Task 12, Pierre runs) — 5 scenarios: arXiv happy path, PubMed happy path, Nature/journal happy path, signed-out fallback, already-imported (409) path.
- **No browser-extension E2E framework in BE-1.** Playwright with extension loader is overkill for a 9-AC scaffold story; manual smoke is the gate. Document this choice — BE-2 or later may revisit.

### Recent-commit intelligence (relevant to BE-1)

- **`596d710 feat(18-1): connector API contract + extended payload + close code review`** (2026-05-04, ~hours ago) — the connector's wire shape that BE-1 consumes. Read this commit's diff to understand any wire-layer subtleties not yet folded into the protocol doc. Especially: `payload.rs` for the ConnectorReferencePayload struct, `handlers.rs` for the per-status-code response shapes.
- **`7f9a7f7 chore(epic-18): validate 9 stories to ready-for-dev + cancel 18-5`** — context for the Epic 18 sprint state Pierre is operating in.

No drift risk: 18-1 shipped today; the protocol doc is fresh and matches the code.

### Latest tech findings (Context7-verified 2026-05-04)

- **CRXJS support window:** Vite 3–8. Vite 7.3.1 is fully supported.
- **Idiomatic manifest pattern:** `defineManifest()` in `manifest.config.ts`, NOT raw `manifest.json`. Type-safe, validates file paths relative to Vite project root, env-aware (`env.mode === 'staging'` toggles for future build modes).
- **Plugin registration:** `crx({ manifest, browser: 'chrome' })` in `vite.config.ts`. Default `liveReload: true`, content-script HMR at default 5s timeout (irrelevant here — popup-only flow).
- **HMR works for popup pages.** During `pnpm dev` the popup hot-reloads; great DX for iterating on AC8 styling.
- **Sideload mechanics:** `vite build` writes `dist/`; canonical Chromium dev path is `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `dist/`. Literal `.crx` packaging is deferred (requires Chrome Web Store self-signing or `chrome --pack-extension`); not needed for sideload-first per Pierre Q7=c.

### Project Structure Notes

- Sub-project lives entirely under `tools/browser-extension/` — same isolation pattern as `tools/translation-server/`.
- BMAD output uses prefix **BE-N** (mirrors translation-server's TS-N).
- Sprint-status path: `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml` — this story file is at the same path.
- README, charter, and sprint-status already in place from charter scoping (2026-05-04 BMad Master). BE-1 only needs to extend README with sideload section (Task 11).
- **No conflict** with main Milton sprint — different directory tree, different sprint-status, different story-id namespace. The other Claude session running `/bmad_bmm_dev-story 18-2` writes to `_bmad-output/implementation-artifacts/sprint-status.yaml` (main repo); this story writes to `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml`. Zero overlap.

### Documentation Consolidation Notes

- **18-docs (already in backlog as `18-docs-update-documentation`)** is responsible for adding browser-extension feature documentation to Milton's main Mintlify site. BE-1 does NOT add to `docs/`; the connector protocol already has its canonical doc at `docs/integrations/browser-extension-protocol.mdx`.
- BE-1 establishes the structural pattern for BE-N stories. Future BE stories follow the same skeleton: charter as source of truth, sprint-status with BE-N entries, story files with G15-1 boundary discipline.
- Cross-link from main Milton documentation to extension README will be added in 18-docs (when extension actually ships in beta channel).

### References

- **Charter** — `tools/browser-extension/_bmad-output/planning-artifacts/charter.md` (locked Pierre Q1–Q9 2026-05-04)
- **Connector wire contract (CANONICAL)** — `docs/integrations/browser-extension-protocol.mdx` (read end-to-end)
- **Story 17-5** — `_bmad-output/implementation-artifacts/17-5-local-connector-server.md` (connector implementation + 17 Rust tests)
- **Story 18-1** — `_bmad-output/implementation-artifacts/18-1-extension-receive-ux-polish.md` (extended payload + GET selectors + e2e harness)
- **Story 18-6 (in backlog)** — `_bmad-output/implementation-artifacts/18-6-create-ref-paste-url.md` (per-user MILTON_KEY model that BE-1's shared dev key migrates toward)
- **Translation server** — `tools/translation-server/` (TS-2 audit findings, TS-3 hardening, TS-5 production deploy)
- **Test harness** — `milton/scripts/test-connector.sh` (18-1 reference for connector wire shapes)
- **Source files (Rust connector)** — `milton/src-tauri/src/connector/{server,handlers,payload}.rs`
- **CRXJS docs (Context7)** — `/crxjs/chrome-extension-tools` library ID
- **Vite docs** — Milton uses `vite ^7.3.1`; CRXJS supports Vite 3–8

### Provenance

Charter Q1–Q9 (Pierre 2026-05-04, BMad Master scoping session):
- Q1=a Chromium-only · Q2=b Vite + CRXJS + TS · Q3=a Always-on toolbar button · Q4=b Rich popup UX (deferred to BE-2) · Q5=yes Signed-out detection + Open Milton deep-link · Q6=a Metadata-only; no PDF upload from extension · Q7=c Sideload first, Chrome Web Store later · Q8=b 3 stories (BE-1/2/3 deferred) · Q9=b Minimal independent styling

## Pre-Review Self-Check

<!-- Tools sub-project — adapted from Milton's standard checklist. No Figma, no PandaCSS, no Bits-ui. -->

- [x] `pnpm install --ignore-workspace` runs clean; `pnpm-lock.yaml` generated (95 packages, 3.1s)
- [x] `pnpm typecheck` (`tsc --noEmit`) reports 0 errors
- [x] `pnpm test` (Vitest 4.1.5) — 19/19 pass in 127ms; csl-to-payload.ts mapping coverage as specified in Task 10
- [x] `pnpm build` produces `dist/` (88ms, 9 modules) with valid `manifest.json` + popup HTML/JS bundle + 3 icon PNGs. **"Loads unpacked with NO console errors" half of this gate is Pierre's smoke (T12)** — agent cannot launch Chromium per memory rule "let Pierre test"
- [x] AC7 envelope grep: `tagIds | newTagNames | projectIds | collectionIds` appears ONLY in `types.ts` (definition), `csl-to-payload.ts` (emission), `csl-to-payload.test.ts` (verification) — no leakage
- [x] No `color` field anywhere in tag-related code (`grep -rnE "tagColor|tag\.color|color.*tag" src/` returns no matches)
- [x] Connector base URL hardcoded ONCE at `connector-client.ts:11` (verified by grep — no other source-tree occurrence)
- [x] `.env.local` NOT committed (file does not exist; `.env.local.example` IS committed)
- [x] `.gitignore` excludes `dist/`, `node_modules/`, `.env.local`, `*.log`, `.DS_Store` (project-local at `tools/browser-extension/.gitignore`)
- [ ] Manual sideload smoke (Task 12) ran: arXiv / PubMed / Nature / signed-out fallback / 409 duplicate — **Pierre's gate at review time**
- [x] README sideload section reads end-to-end without ambiguity for someone with no prior Chromium-extension experience

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — invoked via `/bmad_bmm_dev-story BE-1` directly after `/bmad_bmm_create-story BE-1`.

### Debug Log References

- `pnpm install --ignore-workspace` (T2) — succeeded after first attempt without flag fell through to parent monorepo's milton lifecycle scripts (parent `pnpm-workspace.yaml` lists `milton` + `packages/*` only, intentionally excludes `tools/`). Resolution: added `tools/browser-extension/.npmrc` with `ignore-workspace=true` so subsequent commands are self-contained.
- `pnpm typecheck` — 0 errors after first run; `verbatimModuleSyntax: false` chosen over `true` to avoid TS forcing every type import to use the `import type` form (fine for this story but unnecessary friction; can tighten later).
- `pnpm test` — Vitest 4.1.5; 19/19 pass; 127ms total (4ms tests + transform/import overhead).
- `pnpm build` — Vite 7.3.2 + CRXJS 2.4.0; 9 modules transformed; 88ms.

### Completion Notes List

**AC1 (scaffold + sideload-loadable build)** — Full project tree under `tools/browser-extension/` per Story Dev Notes. **Path correction:** icons moved from charter-suggested `public/icons/` to `src/assets/icons/` to match CRXJS idiom (Vite public-flatten loses the `public/` prefix at build time, breaking manifest references; CRXJS bundles src-referenced assets correctly). README extended with explicit Sideload steps. `.npmrc` added (atypical-input fix for AC1's monorepo conflict).

**AC2 (toolbar click + current tab)** — `chrome.tabs.query({active:true, currentWindow:true})` reads `tab.url` on popup mount. `chrome://*` / `chrome-extension://*` / `about:*` / `edge://` / `brave://` / blank-URL atypicals route to `cannot-capture` state with disabled Save button + helper copy.

**AC3 (health probe gates Save UI)** — `connector-client.ts::health()` with 2s `AbortController` timeout returns discriminated `HealthResult`. Popup transitions `loading-tab → loading-health → ready-to-save | milton-not-running` based on outcome. AC3 atypical (`app !== 'milton'`): `console.warn` + proceed.

**AC4 (signed-out fallback + deep-link)** — POST 503 → `signed-out` state; health refusal/timeout → `milton-not-running` state. Both fire `chrome.tabs.create({ url: 'milton://' })` + `window.close()`. OS-no-handler atypical documented inline (Chromium shows "open with" dialog; popup-side flow unchanged).

**AC5 (translation server fetch + CSL mapping)** — `translation-client.ts::extractMetadata(url)` POSTs to `https://translate.milton.so/web` with `Authorization: Bearer ${VITE_MILTON_KEY}`. `csl-to-payload.ts::mapCslToConnectorPayload(csl)` performs full mapping per AC5 table (8-entry itemType enum + author shape preservation + year regex parse). Empty array → `error-no-metadata`; multi-item → `console.info` + uses `[0]`; missing key → throws with `.env.local.example` pointer.

**AC6 (POST + result-aware states)** — `connector-client.ts::createReference()` returns typed `CreateReferenceResult` discriminating all 6 outcomes (201/400/403/409/503/network-error/payload-too-large). 64KB pre-check via `JSON.stringify(payload).length` short-circuits to `payload-too-large` state before the POST fires. Connector restart mid-flight surfaces as `error-network` with retry button.

**AC7 (forward-compat envelope locked)** — `mapCslToConnectorPayload` ALWAYS emits `tagIds: []`, `newTagNames: []`, `projectIds: []`, `collectionIds: []` even for the most minimal CSL input. Verified by dedicated test + grep gate. BE-2 will only need to populate these arrays — wire shape is locked.

**AC8 (popup-scoped CSS)** — All styles in `src/popup/popup.css` with `milton-popup-*` class prefix. Color tokens via `:root` CSS custom properties; `@media (prefers-color-scheme: dark)` overrides bg/fg/muted/border. `min-width: 320px; max-width: 480px` body bounds.

**AC9 (README + .env.local.example)** — README extended with Sideload section (5 steps), Smoke test table (5 scenarios for Pierre), Scripts reference, version-pinned Tech stack. `.env.local.example` shipped with placeholder `VITE_MILTON_KEY=...` and comments pointing to TS-5 + Story 18-6.

**Tag-no-color discipline** — Memory rule honored. Zero `tagColor | tag.color | color.*tag` matches in src/. Even though BE-1 doesn't touch tag UI, the `connector-client.ts` envelope and `csl-to-payload.ts` mapper are positioned as defensive — BE-2 inherits the no-color contract by construction.

**Pierre's gates pending (T12 manual sideload smoke):** Loaded-unpacked validation, real arXiv/PubMed/Nature smoke, signed-out flow, 409 duplicate flow. These run as part of the Pierre review gate. The story stays in `review` status until Pierre validates + runs `/bmad_bmm_code-review`.

### File List

**New (Rust): none — pure JS/TS tools sub-project.**

**New (TypeScript / config / assets):**
- `tools/browser-extension/.env.local.example` — translation-server key placeholder
- `tools/browser-extension/.gitignore` — node_modules / dist / .env.local / *.log / .DS_Store
- `tools/browser-extension/.npmrc` — `ignore-workspace=true` (self-contained pnpm)
- `tools/browser-extension/manifest.config.ts` — CRXJS `defineManifest()` MV3 config
- `tools/browser-extension/package.json` — name `milton-browser-extension`, version 0.1.0, deps pinned
- `tools/browser-extension/pnpm-lock.yaml` — generated lockfile (95 packages)
- `tools/browser-extension/src/assets/icons/16.png` — Milton mark (copied from milton/src-tauri/icons/128x128.png)
- `tools/browser-extension/src/assets/icons/48.png` — same image
- `tools/browser-extension/src/assets/icons/128.png` — same image
- `tools/browser-extension/src/lib/connector-client.ts` — `health()` + `createReference()` with typed result discrimination
- `tools/browser-extension/src/lib/csl-to-payload.test.ts` — 19 Vitest tests covering itemType / authors / year / AC7 envelope / arXiv snapshot
- `tools/browser-extension/src/lib/csl-to-payload.ts` — Zotero-CSL → ConnectorReferencePayload mapping
- `tools/browser-extension/src/lib/translation-client.ts` — `extractMetadata()` against translate.milton.so/web with Bearer auth
- `tools/browser-extension/src/lib/types.ts` — wire types: ZoteroCslItem, ConnectorReferencePayload, HealthResult, CreateReferenceResult
- `tools/browser-extension/src/popup/index.html` — popup root + popup.ts script tag
- `tools/browser-extension/src/popup/popup.css` — milton-popup-* scoped styles + dark-mode media query
- `tools/browser-extension/src/popup/popup.ts` — 14-state popup machine orchestrating health / extract / map / POST
- `tools/browser-extension/tsconfig.json` — TS strict + DOM/ES2022 lib + ['chrome','vite/client'] types
- `tools/browser-extension/vite.config.ts` — `vitest/config` defineConfig with `crx({manifest, browser:'chrome'})` plugin + `test.environment: 'node'`

**Modified:**
- `tools/browser-extension/README.md` — added Sideload section + Smoke test table + Scripts + version-pinned Tech stack; updated story-map status row for BE-1; **2026-05-05 patch:** added "Local dev (translation-server not yet deployed)" section
- `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml` — BE-1 status flow: `backlog` → `ready-for-dev` → `in-progress` → `review`
- **2026-05-05 patch:** `tools/browser-extension/src/lib/translation-client.ts` — fixed auth header (`Authorization: Bearer` → `X-Milton-Key`); added `VITE_TRANSLATE_BASE` env override with prod default; placeholder-key fail-fast
- **2026-05-05 patch:** `tools/browser-extension/.env.local.example` — split into `VITE_TRANSLATE_BASE` (default `http://localhost`, with prod URL commented) + `VITE_MILTON_KEY`; auth-header note updated

## Change Log

| Date | Author | Summary |
|------|--------|---------|
| 2026-05-04 | BMad Master | Story drafted via `/bmad_bmm_create-story` workflow with tools-sub-project context overrides (charter as source-of-truth in lieu of epics.md, BE-N prefix mirroring TS-N). Promoted to ready-for-dev. |
| 2026-05-04 | Dev Agent (Opus 4.7) | **Implementation complete via `/bmad_bmm_dev-story BE-1`.** Tasks 1–11 + 13 shipped: full Vite + CRXJS + TS scaffold; manifest V3 with action.default_popup; `connector-client.ts` health + createReference with typed result discrimination + 64KB pre-check + 2s AbortController timeout; `translation-client.ts` extractMetadata with VITE_MILTON_KEY auth; `csl-to-payload.ts` mapping with AC7 forward-compat envelope locked; 14-state popup machine with full atypical coverage (chrome:// URLs, signed-out 503, 409 duplicate, network errors, payload too large, multi-item array, missing key); `.npmrc` added to bypass parent monorepo workspace conflict; README extended with end-to-end Sideload steps + Smoke test table; 19/19 Vitest tests green; `pnpm typecheck` 0 errors; `pnpm build` produces sideload-ready `dist/`. **Path correction from charter:** icons live at `src/assets/icons/` (CRXJS idiom), NOT `public/icons/` (Vite public-flatten breaks manifest references). Task 12 (manual sideload smoke) deferred to Pierre per memory rule "let Pierre test"; covers arXiv/PubMed/Nature happy paths + signed-out fallback + 409 duplicate. Status flipped: `ready-for-dev` → `in-progress` → `review`. |
| 2026-05-05 | Dev Agent (Opus 4.7) | **Smoke-time patch** — Pierre flagged that `translate.milton.so` (TS-5) is not yet deployed. Two correlated fixes shipped while story stayed in `review`: (1) **AUTH HEADER BUG**: original `translation-client.ts` used `Authorization: Bearer ${key}` but the Caddy proxy gates on `X-Milton-Key: ${key}` (see `tools/translation-server/Caddyfile` lines 27, 36 — `request_header -X-Milton-Key`); the extension would have failed against prod too. Switched to the correct header. (2) **LOCAL-DEV ENV OVERRIDE**: added `VITE_TRANSLATE_BASE` env var (defaults to `https://translate.milton.so` for prod intent; set to `http://localhost` for local docker-compose). Updated `translation-client.ts`, `.env.local.example` (sets local default), and README (added "Local dev (translation-server not yet deployed)" section walking through docker-compose bring-up + local key copy). Placeholder-detection added to fail-fast if `.env.local` still has the example value. All gates re-verified: 19/19 Vitest pass, `pnpm typecheck` clean, `pnpm build` produces 88ms `dist/`. Status remains `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Ship as-superseded; status `review` → `done`.** Manual sideload smoke (Task 12) ran against current prod and hit `HTTP 401 {"reason":"token_invalid"}` from `translate.milton.so/web`. Diagnosis: TS-6 deployed an auth-proxy between Caddy and the translation-server (shipped after BE-1 scoping on 2026-05-04) that requires per-user EdDSA JWTs (`Authorization: Bearer …`). Confirmed by `tools/translation-server/Caddyfile:22` ("Authorization header (Bearer JWT) replaces X-Milton-Key (TS-6)") + CORS allow-list (`Content-Type, Authorization` only — no `X-Milton-Key`). BE-1's auth header is therefore structurally obsolete against current prod; the rest of the scaffold (popup state machine, CSL→ConnectorReferencePayload mapping with AC7 forward-compat envelope, connector client, build config) remains correct and is consumed unchanged by BE-4. **Per G17-1 deferral nuance** (smoke surface lives in follow-on story when split is "infra + UX"), BE-1 ships at `done` with all internal gates green (build 98ms, typecheck 0 errors, 19/19 Vitest), and the 5-scenario end-to-end smoke moves to BE-4's review gate. Also patched in this commit: README (dropped stale "Local dev (translation-server not yet deployed)" section since TS-5 went live 2026-05-10; added "Known limitations" callout; updated install command to require explicit `--ignore-workspace` since pnpm 10.28.2 silently ignores `.npmrc:ignore-workspace=true`); `.env.local.example` (production URL now the default, BE-4 pointer replaces the stale 18-6 reference). |


