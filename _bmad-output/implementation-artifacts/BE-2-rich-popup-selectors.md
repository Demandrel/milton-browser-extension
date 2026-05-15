# Story BE-2: Rich Popup UX — Metadata Preview + Tag / Project / Collection Selectors

Status: done
Origin: Charter Q4=b "Rich popup UX (metadata preview + tag / project / collection selectors)"; BE-1 explicitly deferred this to BE-2 with the wire shape already locked.
Depends on: BE-1 (scaffold + popup state machine + AC7 forward-compat envelope), BE-4 (auth + `/metadata` envelope), Story 18-1 (connector `GET /tags` + `GET /projects` + `GET /collections` + extended payload atomic transaction)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pierre dogfooding the Milton browser extension and preparing for public Chrome Web Store distribution,
I want the popup to surface fetched metadata as an editable preview plus tag / project / collection selectors that submit alongside the reference in a single atomic POST,
so that I can capture references with full organization metadata in one click — and the connector's already-locked extended payload (Story 18-1) is finally exercised end-to-end from the extension side.

## Background

BE-1 shipped the metadata-fetch + connector wire shape and **locked the forward-compat envelope from day one**: every `POST /references` from the extension already emits `tagIds: []`, `newTagNames: []`, `projectIds: []`, `collectionIds: []`. BE-4 swapped to per-user JWT auth + the `/metadata` envelope. BE-2 is **purely additive UI** — it populates the four organization arrays via popup affordances. Zero wire-shape change on the connector side; the extended payload contract from 18-1 just gets exercised end-to-end for the first time.

## Acceptance Criteria

**AC1 — Metadata preview replaces minimal URL display in the post-health-probe state**

> **Task 12 reconciliation (2026-05-15):** the Figma redesign (Pierre-directed) changed three things from the original AC1 text below — this section is updated to the as-shipped contract: (a) **Journal + DOI rows dropped** — neither is in the Figma frame; DOI still flows through `mapMetadataToPayload` into the saved reference, journal was display-only. (b) **Abstract row added** (2-line clamp, inline-editable). (c) **Title is single-line** (`white-space: nowrap` + ellipsis, full title in `title=` tooltip), not a 3-line clamp.

- After health probe + token mint succeed, popup transitions to a new `preview` state showing the metadata envelope's `primary` record
- Fields rendered (read-only initially; per-field edit-on-tap per AC2): title, authors (collapsed to "First, Second et al." past 3 — see `formatAuthorsDisplay`), date (the `year` field, labelled "Date" per the Figma), abstract
- The minimal `ready-to-save` state (BE-1: URL + Save button) is **REPLACED** by the preview UI; user only sees raw URL in the existing `cannot-capture` state
- **Atypical:** metadata returned with sparse fields (no abstract, year=0) → preview shows an "(add)" affordance row for the missing date/abstract rather than hiding them (lets the user fill the gap). Title is always rendered (server-side guarantees `title.length > 0` when `source_tier !== "empty"`).
- **Atypical:** title contains HTML entities like `&amp;` or angle brackets — must escape via the existing `escapeHtml` helper before `innerHTML` injection; XSS surface from translation-server output is closed
- **Atypical:** very long title — preview clamps to a single line via CSS `white-space: nowrap; text-overflow: ellipsis`; the full title rides along in the `title=` attribute so it's recoverable on hover
- **Atypical:** authors array empty after the mapper's `.filter((a) => a.first.length > 0 || a.last.length > 0)` pass → render "(unknown — click to add)" muted row; do NOT hide entirely (signals to user that the metadata may need editing)

**AC2 — Inline-edit affordances for title + authors + year**

> **Task 12 reconciliation (2026-05-15):** the year row is labelled **"Date"** in the UI per the Figma (underlying state + payload field stays the integer `year`). The **abstract row is also inline-editable** (Task 12 follow-up #2 — a fixed-height textarea; plain Enter = newline, blur / Cmd+Enter commit, Escape revert).

- Tapping the title row replaces it with a single-line text input pre-filled with the current value
- Tapping the authors row replaces it with a multi-author editor: a list of `{firstName, lastName}` rows + an "Add author" button + a × on each row to remove
- Tapping the year ("Date") row shows a number input (4-digit, range 1500–{currentYear + 2})
- Blur (or Cmd+Enter / Ctrl+Enter) commits the edit back to state; Escape reverts to the pre-edit value
- The mapped payload sent on Save reflects the **edited** values, not the original metadata
- **Atypical:** user clears title to empty/whitespace → Save button disabled with helper "Title is required" (mirrors connector 400 `title is required` contract — fail at the popup, not server-side)
- **Atypical:** year input contains `"2025-03"`, `"in press"`, or any non-numeric text → strip non-digit chars, parse first 4 digits, fall back to omitting `year` from the payload if no valid year remains (matches BE-1's existing year-parse rule)
- **Atypical:** user types in title, then closes popup without clicking Save → edits are discarded. **No localStorage persistence** (Q9=b minimal scope; popup state is ephemeral by design)
- **Atypical:** Cmd+Enter (macOS) / Ctrl+Enter (Win/Linux) from within ANY edit field triggers Save when title is non-empty
- **Atypical:** Escape from within an edit field reverts to read-only display of the underlying state (not the original metadata — the user may have committed earlier edits already)

**AC3 — Tag selector: autosuggest + create-new chips**

> **Task 12 reconciliation (2026-05-15):** the Figma chip (node 1323:9017) is a flat neutral-grey pill with **no color dot** — consistent with the standing memory rule *"tags have no color"*. The `getTagColor` requirement below is **superseded**: `tag-colors.ts` + `tag-colors.test.ts` are retained intact (AC12 drift guard still has value as a Milton-palette reference) but `getTagColor` is no longer imported by `popup.ts`. Chip colors are not rendered.

- Below the preview, a "Tags" section with:
  - A text input that filters existing tags as the user types (substring-match on tag name, case-insensitive)
  - Up to ~6 matching tags shown as suggestion chips below the input
  - Already-selected tags rendered as removable chips above the input (× to deselect)
- Clicking a suggestion chip selects it (adds id to `tagIds[]`); the suggestion list updates to exclude already-selected entries
- Pressing Enter:
  - If the typed text exactly matches an existing tag (case-insensitive trim) → selects that tag (`tagIds[]`); clears input
  - Otherwise, if text is non-whitespace → creates a "new tag" chip (`newTagNames[]`); clears input
- Chip background color comes from `getTagColor(name)` — a hash-to-palette function **REPLICATED** inside the extension at `tools/browser-extension/src/lib/tag-colors.ts` (NOT imported from Milton's frontend; extension is self-contained per BE-1 Dev Notes). Same 10-color palette as `milton/src/lib/features/projects/utils/tag-colors.ts`.
- **NO color picker, NO `color` field in any payload, NO `tagColor` references anywhere in the extension source.** Memory rule + protocol doc enforcement.
- **Atypical:** user types a tag name with leading/trailing whitespace → trimmed before adding to `newTagNames[]`; pure-whitespace input is silently rejected (no chip created)
- **Atypical:** user types a name that exactly matches an existing tag AFTER autosuggest was missed (e.g., fast typing past the suggestion) → existing tag is matched and selected; new chip is NOT created (avoid duplicate `newTagNames[]` entries that would no-op server-side anyway per protocol doc "tag-name collision is the dedupe-and-link path")
- **Atypical:** `GET /tags` returns `[]` (user has zero tags) → input still allows creating new tags via Enter; suggestion area is hidden
- **Atypical:** `GET /tags` returns 503 (signed out) → per AC6, a 503 on *any* selector call collapses the whole popup to the existing `signed-out` state (selectors AND Save hidden together) — there is no per-section "Tags unavailable" degrade for the 503 case. (The original AC3 text described a per-section degrade; AC6's whole-popup collapse is the canonical rule and what ships.)
- **Atypical:** `GET /tags` fails network-error (non-503) → tag section degrades gracefully: shows "Tags unavailable" inline note; `console.warn` logs the error; Save remains enabled with empty `tagIds[]` + `newTagNames[]`. Don't block reference save just because the selectors are unreachable.
- **Atypical:** user removes ALL selected tags after adding some → arrays empty on Save (connector accepts AC7-baseline empty arrays)

**AC4 — Project multi-select: most-recently-updated-first picker**

> **Task 12 reconciliation (2026-05-15):** the Figma redesign moved projects into the **"Add to..." tab** (Figma node `1341:9327`) as a searchable checkbox list shared with collections, and **cut the `idea`/`wip`/`done` status badge** — the Figma frame has no badge. `GET /projects` still sends `status` on the wire but the extension parses only `{id, title}` and ignores it (forward-compat extra field). Per Pierre at code review 2026-05-15: *"Cut it — reconcile AC4."*

- "Add to..." tab → projects sub-view:
  - A checkbox list of all projects from `GET /projects` (already ordered by `updated_at` DESC server-side per protocol doc — extension does NOT re-sort)
  - Each project shows `title` + a duo-solid briefcase icon; no status badge
  - Clicking a row toggles its membership in `projectIds[]` (checkbox reflects state)
  - A search field filters the list by `title` substring (case-insensitive)
- Multi-select supported (a ref can be in multiple projects)
- **Atypical:** many projects → list scrolls inside a `max-height: 180px; overflow-y: auto;` container; no pagination — projects are typically a low-cardinality set per Milton usage
- **Atypical:** `GET /projects` returns `[]` (new user) → list shows a muted "No projects yet." note (the picker lives in its own tab now, so an inline note reads fine — the original "hide the whole section" rule applied to the single-column layout that Task 12 replaced)
- **Atypical:** `GET /projects` returns 503 / network-error → same graceful-degrade as AC3: list shows "Projects unavailable" inline note; `projectIds[]` empty on Save

**AC5 — Collection multi-select: alphabetical picker, same pattern as projects**
- "Add to..." tab → collections sub-view (the default sub-view):
  - Same searchable checkbox-list pattern as projects, populated from `GET /collections` (alphabetical by name)
  - No status badge (collections don't have one per protocol doc)
- Multi-select supported
- **Atypical:** `GET /collections` returns `[]` → list shows a muted "No collections yet." note (Task 12 reconciliation — same rationale as AC4: the picker is now its own tab)
- **Atypical:** `GET /collections` returns 503 / network-error → "Collections unavailable" inline note; `collectionIds[]` empty on Save
- **Atypical:** very long collection names → CSS `text-overflow: ellipsis` clamp on the row label; full name in the `title=` attribute for hover tooltip

**AC6 — Single connector-client method covers all three GET selectors with partial-failure tolerance**
- New `connector-client.ts` export: `listSelectors(): Promise<SelectorsResult>` where:
  ```ts
  type SelectorsResult =
    | { ok: true; tags: TagSummary[]; projects: ProjectSummary[]; collections: CollectionSummary[] }
    | { ok: false; reason: 'signed-out' }
    | { ok: false; reason: 'partial-failure'; tags: TagSummary[] | null; projects: ProjectSummary[] | null; collections: CollectionSummary[] | null }
  ```
- The method fires the three GET calls in parallel via `Promise.all` over per-call `fetchSelector` helpers — each helper catches its own errors and resolves to an `ok` / `signed-out` / `failed` discriminant, so `Promise.all` never rejects (functionally equivalent to `Promise.allSettled`). 2s `AbortController` timeout per call (mirrors BE-1's `health()` pattern)
- Result assembly:
  - All three 200 → `{ ok: true, ... }`
  - **Any 503** on any call → `{ ok: false, reason: 'signed-out' }` (popup transitions to existing `signed-out` state — selectors AND save UI hidden together)
  - Mix of 200 + network-error / non-503 failures → `{ ok: false, reason: 'partial-failure', ... }` with each field set to the parsed array (200) or `null` (failed). Popup renders graceful-degrade per AC3/AC4/AC5 for the `null` sections.
- New types added to `types.ts`: `TagSummary { id: string; name: string }`, `ProjectSummary { id: string; title: string }` (the connector still sends `status` on the wire — the extension parses it away as an extra field per the Task 12 / AC4 reconciliation), `CollectionSummary { id: string; name: string }`, plus the `SelectorsResult` union.
- **Atypical:** connector responds with extra fields the extension doesn't recognize (forward-compat) → ignored silently (protocol doc forward-compat guarantee; serde-defaults on the server side). This now includes the project `status` field, which the popup no longer renders.
- **Atypical:** connector responds with the JSON shape but missing required fields (e.g., a tag entry missing `name`, or a project missing `id`/`title`) → that entry is dropped from the parsed list; `console.warn` logs the malformed entry. Remaining valid entries surface to the UI.

**AC7 — Submission wires extended payload arrays via the existing mapper**
- On Save click (gated by AC2 title-required validation), popup builds the payload via `mapMetadataToPayload(editable, currentUrl)` then OVERWRITES the four organization arrays with the selector state:
  ```ts
  payload.tagIds        = selectedTagIds
  payload.newTagNames   = newTagNames
  payload.projectIds    = selectedProjectIds
  payload.collectionIds = selectedCollectionIds
  ```
- Edits from AC2 (title / authors / year) flow through the mapper: the popup keeps an `EditableMetadata` state that mirrors `MetadataPrimary` but with user overrides; `mapMetadataToPayload` is called with the override-merged primary
- Existing `createReference()` (`connector-client.ts`) handles the POST **unchanged** — wire shape is identical to BE-1/BE-4
- **Atypical:** all four arrays empty on Save → reference still saves (connector accepts the BE-1 baseline shape). Visual confirmation in AC9 smoke #1 that "no-org" path still works.
- **Atypical:** connector returns 400 `Invalid tag ID` / `Invalid project ID` / `Invalid collection ID` (a selected id no longer belongs to the user — concurrent deletion in main Milton) → popup shows the existing `error-400-validation` state with the `message` + `detail` (offending id). User retries.
- **Atypical:** connector returns 409 (duplicate DOI) — protocol doc **"Dedup is a no-op"** callout: the organization arrays are IGNORED server-side. The reference is not retroactively tagged. AC9 smoke #5 verifies this explicitly. The popup displays `error-409-duplicate` (existing BE-1 state) with the matching reference's id; do NOT show the selector state as if it were applied.

**AC8 — Popup state machine extension: two new states layered on BE-4's 19**
- Two new state kinds added to `popup.ts`:
  - `loading-selectors` — transitional; runs concurrently with metadata fetch (the popup doesn't actually render this state to the user — see "Why selectors-before-metadata" in Dev Notes — but it is the formal kind during the parallel fetch window)
  - `preview` — replaces the current `ready-to-save` state; holds the editable metadata + the selector state (selected ids + new tag names + the loaded selector arrays or their failure flags)
- Updated state transitions:
  - `loading-tab → loading-health → preview` (happy path; selectors load in parallel with metadata extraction during the same window)
  - `loading-tab → loading-health → milton-not-running` (health failed; unchanged from BE-4)
  - **`ready-to-save` is REMOVED** — preview is its replacement
  - `preview → posting → success | error-409-duplicate | error-400-validation | error-network | signed-out | error-too-large` (all 6 outcomes reuse existing BE-1/BE-4 states)
- Metadata extraction runs in `preview` (alongside selector fetch), with a per-section loading indicator on the preview itself. Save button stays disabled until extraction completes.
- **Atypical:** user clicks Save while selectors are still loading → preview renders selector sections with disabled inputs + "Loading…" placeholder. Save itself is NOT blocked — user can save with empty arrays if they want. (Selectors are optional; the reference itself is the primary value.)
- **Atypical:** selectors finish AFTER user has typed in the tag input → autosuggest activates retroactively when results arrive; the input value is preserved (no clear).
- **Atypical:** metadata extraction throws (token-mint or translate-server error) while preview is rendered → popup transitions to the corresponding error state per BE-4's dispatch (`signed-out`, `error-auth-failed`, `error-quota-exceeded`, etc.); selector state is discarded (no recovery path back to preview without rerunning the full pipeline).

**AC9 — Smoke matrix: cross-content + boundary inputs (G15-1 + G18-4 discipline)**

Pierre's manual smoke list (Task 11). Each scenario must pass before code review. Cross-content-type cycles (per G18-4) included where they apply.

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | arXiv (2303.08774) — happy path, NO tags/projects/collections selected | Reference saves; BE-1/BE-4 baseline still works (empty arrays accepted) |
| 2 | arXiv — add 1 existing tag + 1 new tag + 1 project + 1 collection | All four wired in payload; Milton library shows ref filed correctly across all three organization surfaces |
| 3 | PubMed article — add 3 tags (mix existing + new) | All 3 tags appear on the ref; chip colors deterministic per `getTagColor(name)` |
| 4 | Nature / Springer article with DOI — edit title (typo fix) + add 1 collection | Edited title used (not the translation-server original); collection wired |
| 5 | Save same arXiv URL again with DIFFERENT tags + projects selected | 409 "Already in your library"; **verify in Milton library that the original ref's tags are UNCHANGED** (dedup-is-noop per protocol doc) |
| 6 | Sign out of Milton, then open popup on arxiv | Token-mint 401 → "Sign in to Milton" (existing BE-4 path; preview not shown) |
| 7 | Quit Milton, then open popup on arxiv | Health refused → "Milton isn't running" (existing BE-4 path) |
| 8 | Open popup on arxiv; in Milton, delete the project being selected; click Save in popup | 400 "Invalid project ID" with `detail` showing the deleted project's uuid |
| 9 | Open popup on a non-academic blog post → `source_tier:"empty"` | "Couldn't extract metadata" — selectors not shown (state never enters preview) |
| 10 | Open popup on arxiv; clear title in inline edit; try to click Save | Save button disabled; helper "Title is required" visible |
| 11 | Open popup; select 10+ tags + 5 projects + 5 collections (stress) | All selections preserved through save; popup remains responsive; reference shows all 20+ links in Milton |
| 12 | Cmd+Enter from within title edit field (after edit committed via blur) | Triggers Save (no separate button click needed) |
| 13 | Open popup on a page with HTML entities in `<title>` (e.g., `arXiv – Title with &amp;`) | Title renders as literal `&` after escape; no script execution; no broken DOM |
| 14 | Open popup; tag list returns 200 but projects fails network-error | Tags section works normally; "Projects unavailable" inline note; collections section works; Save proceeds with `projectIds: []` |

**AC10 — Tests + verification gates**
- Unit tests added:
  - `connector-client.test.ts` (NEW FILE — BE-1 didn't ship one for the connector): `listSelectors()` happy path / all-503-collapse-to-signed-out / mixed partial-failure / network-error per call / malformed-entry filtering / unknown-status-value tolerance (project status forward-compat)
  - `tag-colors.test.ts` (NEW FILE): 5 sample tag names yield deterministic colors AND match the palette indices that `milton/src/lib/features/projects/utils/tag-colors.ts` would produce (drift regression guard per AC12)
  - `popup-helpers.test.ts` (NEW FILE — pure-function helpers extracted from `popup.ts`): authors-string joining, year-parse-from-text-input (handles `"2025-03"`, `"in press"`, `"abc"`, `"2025"`), tag-input-Enter-routing logic (existing-match vs novel vs whitespace)
- All BE-1/BE-4 tests continue to pass (39 baseline → expected total ≥ 50 with the new files)
- `pnpm typecheck` 0 errors
- `pnpm build` produces `dist/` (target < 30 KB JS bundle — preview UI + selectors add ~10 KB to BE-4's ~15 KB)

**AC11 — README + docs updates**
- README "Story map" table updated (BE-2 → shipped)
- README "Popup state matrix" table extended with rows for `preview` (selectors loaded) and the partial-failure variants
- README "Smoke test" section extended with 3 representative BE-2 scenarios (Pierre picks from AC9)
- NO new entries in main Milton's `docs/` (the protocol doc already covers the wire shape; the extension's organization-UX is internal — no external API change)

**AC12 — `getTagColor` utility replicated locally with drift guard**

> **Task 12 reconciliation (2026-05-15):** the Figma redesign dropped the colored chip dot (see AC3), so `getTagColor` is currently **imported by nothing in `popup.ts`** — but `tag-colors.ts` + its 13-test drift guard are deliberately retained: the palette/hash equivalence with `milton/src/lib/features/projects/utils/tag-colors.ts` is still worth pinning for a future BE-N that may reintroduce color, and the file carries a dated provenance comment. Not dead code by accident — retained by decision.

- New file `tools/browser-extension/src/lib/tag-colors.ts` exports `getTagColor(name: string): string`
- Identical hash function + identical 10-color palette as `milton/src/lib/features/projects/utils/tag-colors.ts`
- Header comment in the new file points to the canonical source and explicitly states **the extension is self-contained per BE-1 — the function is COPIED, not imported**
- Inline comment lists the date of the copy + the canonical file's path so a future drift-audit can verify equivalence
- Vitest test asserts: 5 sample tag names yield specific palette indices (verified manually against the canonical impl) → regression guard for if Milton's palette is ever extended without updating the extension
- **Atypical:** Milton's palette gets a new color added → the extension stays at 10 colors; tag chips remain visually stable across the boundary. Per memory rule "tags have no color, only frontend display convention" — the colors don't round-trip, so drift is cosmetic only. A future BE-N (or comment in `milton/src/lib/features/projects/utils/tag-colors.ts`) can flag this drift if it ever matters.

## Tasks / Subtasks

- [x] Task 1 (AC: 6, 12) — Selectors client + local tag-color utility
  - [x] Added `TagSummary`, `ProjectStatus`, `ProjectSummary`, `CollectionSummary`, `SelectorsResult`, `EditableMetadata` to `types.ts`
  - [x] Implemented `connector-client.ts::listSelectors()` — concurrent GETs via `Promise.all` over per-call `fetchSelector` helpers; 2s `AbortController` timeout per call; 503-on-any-call collapses to `signed-out` reason; remaining mix lands in `partial-failure`
  - [x] Created `tools/browser-extension/src/lib/tag-colors.ts` with provenance comment (date 2026-05-14 + path to canonical source). Exports `TAG_COLOR_PALETTE` for the drift test.
  - [x] Test: `connector-client.test.ts` — 12 scenarios (happy / empty / 3× signed-out paths / 3× partial-failure variants / 3× malformed-entry / 1× server ordering preservation)
  - [x] Test: `tag-colors.test.ts` — 13 scenarios (palette shape + drift, single-char hash verification a/b/c/d/e against palette indices, determinism, case-sensitivity, palette-only output, empty-string edge case)

- [x] Task 2 (AC: 1, 8) — Preview state + state machine wiring
  - [x] Added `preview` state kind to `popup.ts` State (with nested `MetadataLoad` + `SelectorsLoad` discriminated unions); removed `ready-to-save`. `loading-selectors` lives inside preview as a `SelectorsLoad` variant.
  - [x] Boot flow rewires: `loading-tab → loading-health → preview`. Inside preview, metadata + selectors fire concurrently via `Promise.all` (`void extractMetadata().then(...)` + `void listSelectors().then(...)` — independent so each can resolve on its own)
  - [x] Preview renders metadata fields with conditional rows: title always; year row hidden unless year > 0 OR user clicked to add; journal/DOI only when non-empty
  - [x] `escapeHtml` applied to all metadata values, tag names, project titles, collection names, errors, and ids before `innerHTML` injection (XSS gate)
  - [x] Authors empty after filter → "(unknown — click to add)" muted display

- [x] Task 3 (AC: 2) — Inline-edit affordances
  - [x] Title: click row → input pre-filled + auto-focus + auto-select; blur or Enter commits; Escape reverts; Cmd/Ctrl+Enter commits AND triggers Save
  - [x] Authors: click row → multi-row editor with first/last inputs + × per row + "+ Add author" + Done button; live-sync commits author edits on each blur; same Cmd+Enter / Escape semantics
  - [x] Year: click row → text input with `inputmode="numeric"`; commits via `parseYearInput` (regex-extracts first 4 digits, range-bounded 1500..currentYear+2; sentinel 0 = omit)
  - [x] Save button disabled when `isTitleValid(editable)` is false; helper line "Title is required." rendered below
  - [x] Cmd+Enter / Ctrl+Enter from any edit field triggers Save via `triggerSaveFromKeyboard` (gated by `canSave`)

- [x] Task 4 (AC: 3, 12) — Tag selector
  - [x] Tag input with case-insensitive substring autosuggest via `filterTagSuggestions`; top 6 matches as dashed-border suggestion chips below input
  - [x] Chip color uses `getTagColor(name)` for the colored dot. Chip background stays neutral so colors readable across light/dark themes.
  - [x] Enter routing via `decideTagInputEnter`: exact case-insensitive match → select existing (`tagIds[]`); novel non-whitespace → create-new (`newTagNames[]`); pure whitespace → ignored. Trimmed before adding to `newTagNames[]`.
  - [x] Duplicate-create-new guard: if the typed name already exists in `newTagNames` (case-insensitive), input is cleared without adding a second entry
  - [x] Selected chips render above input with × to remove (separate handlers for existing-id vs. new-name removal)
  - [x] Selectors 503-on-any → top-level `signed-out` state; `partial-failure` for tags only → "Tags unavailable" inline note; Save still works with empty arrays

- [x] Task 5 (AC: 4) — Project multi-select
  - [x] Projects rendered as toggle buttons in server order (no client re-sort — server already sends `updated_at DESC`); status badge per `idea | wip | done`
  - [x] Click toggles `projectIds[]` membership; selected state styled with accent background
  - [x] Empty list → section hidden entirely; partial-failure → "Projects unavailable" inline note
  - [x] `max-height: 180px; overflow-y: auto` on the toggle list container

- [x] Task 6 (AC: 5) — Collection multi-select
  - [x] Collections rendered as toggle buttons (alphabetical per server); no status badge
  - [x] Click toggles `collectionIds[]` membership
  - [x] Empty list → section hidden; partial-failure → "Collections unavailable" inline note
  - [x] Long names: `text-overflow: ellipsis` clamp + full name in `title=` tooltip attribute

- [x] Task 7 (AC: 7, 8) — Save wiring
  - [x] Save handler builds payload via `mapMetadataToPayload(editableToMapperInput(editable), currentUrl)` then assigns the 4 selector arrays (`payload.tagIds = [...]`, etc.)
  - [x] State transitions `preview → posting → success | error-*` (reused BE-1/BE-4 error states; zero new error kinds)
  - [x] 400 `Invalid tag/project/collection ID` routes to existing `error-400-validation` state via existing `dispatchCreateReferenceResult`
  - [x] 409 routes to `error-409-duplicate`; selector state is discarded by the state transition (per dedup-is-noop protocol rule, no visual implication that tags were applied)

- [x] Task 8 (AC: 1, 2, 3, 4, 5, 8) — popup.css extensions
  - [x] Added ~30 new `milton-popup-*` classes covering preview rows, field labels/values/edit, author rows, tag chips (dot + name + remove), tag suggestion chips, tag input, project/collection toggles + status badges (idea/wip/done), section headers, empty-section notes
  - [x] Dark-mode overrides for new surfaces (`@media (prefers-color-scheme: dark)`): added `--milton-bg-elevated`, `--milton-subtle`, `--milton-accent-soft`, `--milton-border-strong` tokens
  - [x] Body `min-width` bumped to 360px to fit the wider preview comfortably (max-width unchanged at 480px). Popup root uses `display: flex; flex-direction: column; gap: 12px` for vertical rhythm.
  - [x] **No Figma required** — Q9=b minimal independent styling. Pierre confirmed waiver 2026-05-14 ("wildcard to dev it; use existing Milton patterns for inspiration; I'll design in parallel").

- [x] Task 9 (AC: 10) — Tests
  - [x] `connector-client.test.ts` — 12 scenarios (Task 1 detail)
  - [x] `tag-colors.test.ts` — 13 scenarios (Task 1 detail)
  - [x] `popup-helpers.test.ts` — 35 scenarios covering `joinAuthors` (4), `formatAuthorsDisplay` (5), `parseYearInput` (7), `decideTagInputEnter` (5), `filterTagSuggestions` (6), `metadataToEditable` (2), `editableToMapperInput` (1), `blankEditable` (2), `isTitleValid` (3)
  - [x] **Verified:** `pnpm test` totals 99 passing (39 BE-4 baseline + 60 new across the three files) — well past the ≥ 50 bar

- [x] Task 10 (AC: 11) — README updates
  - [x] Status banner updated; Story-map table BE-2 → shipped
  - [x] State matrix table extended with `preview` happy / partial-failure / 400-invalid-id / 409-dedup-is-noop rows
  - [x] Smoke section ("BE-4 + BE-2 gate") extended with 10 scenarios covering selector permutations + dedup-noop verification + empty-title gate + Cmd+Enter shortcut
  - [x] BE-2 story link added to "Charter + sprint" section

- [x] Task 11 (AC: 9) — Manual sideload smoke (Pierre's review-time gate)
  - [x] Pierre sideloaded + validated the full redesigned popup 2026-05-15 (*"I tested it it is perfect"*) — covers the layout / typography / inline-edit / tag-selector / Add-to-tab scenarios
  - [x] Functional scenarios 5 (409 dedup-is-noop), 8 (concurrent project deletion → 400 with detail), 13 (HTML-entity title XSS gate) — confirmed by the `/bmad_bmm_code-review` pass 2026-05-15 via code reading: popup discards selector state on the 409 transition; `dispatchCreateReferenceResult` routes 400 → `error-400-validation` with `message` + `detail`; `escapeHtml` is applied to every injected metadata string before `innerHTML`

- [x] Task 12 (AC: 1, 8) — Figma redesign pass (popup visual overhaul)
  <!-- Added 2026-05-14 after Task 8's Figma waiver was lifted: Pierre designed the popup in Figma
       (node 1323:8984, "Browser extension"). First pass was a token reskin; this final pass is a
       pixel-perfect verbatim implementation of the frame via the figma-implement skill (get_metadata
       → get_design_context → get_screenshot). Scope decisions: (a) the "Main info / Add to..."
       segmented control IS implemented (functional tabs; "Add to..." = empty placeholder, Pierre's
       call); (b) Projects + Collections sections REMOVED from the popup entirely (not in the design —
       types/listSelectors/tests kept intact, selector arrays stay []); (c) SN Pro stays system-font
       fallback (TD-70 — repo woff2 are corrupt); (d) light-only (Figma is light-only). -->
  - [x] Pulled Figma node `1323:8984` fresh (`get_metadata` → `get_design_context` → `get_screenshot` + `get_variable_defs`); implemented verbatim against the emitted tokens/positions
  - [x] **Segmented tab control** (Figma node 1323:8985) implemented: `#eee` track, 2px gap, 3px pad, radius 15; tabs 100×34, radius 12; active tab = white + `shadow-xs` (`0 1px 2px rgba(15,15,16,0.05)`) + primary text, inactive = tertiary text. Functional — `activeTab: 'main' | 'add-to'` on `PreviewState`.
  - [x] **"Add to..." tab — collections / projects picker** (Figma node `1341:9327`, follow-up #13): the earlier empty placeholder is replaced by the real picker — title + body copy, a collections/projects sub-toggle (`addToView` on `PreviewState`, shows selected counts), separator, section label, a search field (`addToSearch`), and a scrollable checkbox list. Items toggle membership in `selectedProjectIds` / `selectedCollectionIds` (which now flow to the Save payload as designed — they were previously forced `[]`). `listSelectors()` data is finally consumed end-to-end. Icons (layers / briefcase / search / checkbox) inlined as SVG. (`renderProjectSection` / `renderCollectionSection` were deleted in the pixel-perfect pass; this is a fresh implementation against the new Figma.)
  - [x] `popup.css` rewritten to the Figma token set: Background 1/3/4/5 (`#ffffff` / `#f5f5f5` / `#eeeeee` / `#e5e5e5`), Text primary/secondary/tertiary/quaternary (`#0a0a0a` / `#525252` / `#737373` / `#a3a3a3`), brand `#0a0a0a`, shadow-xs, radii popup 24 / tabs 15 / tab 12 / card 14 / chip 14 / button 14
  - [x] Preview card (Figma "Menu" `#f5f5f5`, radius 14, 16/22 inset): Title (Bold 18/28, label-less headline) → Author(s) → Date → Abstract (4-line clamp). Per-row label→value gaps copied verbatim from Figma (Author 31px, Date 40px, Abstract 22px); Journal/DOI kept as conditional rows for AC1 completeness
  - [x] Tag chips = the Figma chip verbatim (node 1323:9017): flat `#e5e5e5` grey pill, radius 14, 40px tall, 12px inset, 6px gap — **no color dot** (removed: tags have no color; `getTagColor` import dropped from `popup.ts`). Inline × icon redrawn to the Figma "multiple-cross-cancel" geometry (4-segment cross, stroke 1.6, round cap+join, `#a3a3a3`)
  - [x] 1px `#ebebeb` separator between Preview and Tags; Save button full-width brand-black, 48px, radius 14, 24px above; every error/loading/signed-out/success state retained
  - [x] **Author display collapses past 3 authors** — new `formatAuthorsDisplay()` pure helper mirrors Milton's `formatAuthors` (`milton/src/lib/utils/format-authors.ts`): ≤3 listed in full, >3 → first 2 + "et al." A 40-author paper (e.g. the GPT-4 report) no longer floods the preview row. Inline edit still operates on the full `authors` array. +5 unit tests.
  - [x] **Save button always visible** — `.milton-popup-sections` is a capped scroll region (`max-height: 432px; overflow-y: auto`) so the metadata + tags column scrolls internally and "Save to Milton" stays pinned below it without scrolling the whole popup
  - [x] **Preview card is fixed height (221px, the Figma "Menu" frame)** for every metadata state — skeleton, loaded, no-metadata — so the popup window never shifts height when metadata resolves. Loading state is a greyed pulse **skeleton** (title bar + 2 lines + abstract block) at that same height; `prefers-reduced-motion` disables the pulse. Content that exceeds the card scrolls inside it.
  - [x] **Hover-to-edit affordance restyled** — preview field rows highlight on hover with Background/5 (`#e5e5e5`, one step darker than the card) + 14px radius (was white + 10px)
  - [x] **Abstract is now editable** — was display-only; tapping it opens a fixed-height textarea (`116px`, own scroll). Plain Enter = newline (multi-line field), blur / Cmd+Enter commit, Escape reverts. Empty abstract gets an "(add)" affordance mirroring the Date row. `EditField` gained `'abstract'`; `commitAbstract()` added
  - [x] **Tall edit fields capped + scrollable** — the authors editor's rows live in `.milton-popup-author-edit-rows` (`max-height: 132px; overflow-y: auto`) so a 40-author paper keeps "Add author" / "Done" in view; the abstract textarea is likewise fixed-height with its own scroll
  - [x] **Popup width → 440px** (was 500, the Figma frame width) per Pierre
  - [x] **DOI + Journal rows removed from the preview** — neither is in the Figma frame; dropping them lets the preview card stay a fixed height that doesn't scroll in read-only mode. DOI still flows through `mapMetadataToPayload` into the saved reference; journal was display-only and never mapped. Preview card height `221px → 256px`, title clamp `3 → 2` lines, `.milton-popup-field-mono` CSS removed. `overflow-y: auto` now only engages when a property is expanded for editing.
  - [x] **Instant Save (save without waiting for the preview)** — `canSave()` now returns `true` while metadata is still `loading`; `save()` falls back to a `blankEditable(tabTitle || url)` payload built from the browser tab's `<title>` (captured at boot as `currentTabTitle`). New `blankEditable()` pure helper + 2 tests. The user can hit Save the instant the popup opens; any tags they picked still go through.
  - [x] **Tag input → invisible inline field** (Dribbble pattern) — the bordered full-width input row is gone; `.milton-popup-tag-input` is now a transparent, border-less input that flex-grows after the chips inside the `.milton-popup-tag-field` chip row (placeholder "New tag…"). Clicking the field's empty space focuses it.
  - [x] **Autocomplete for existing tags reworked into a proper dropdown** — as the user types, matching existing tags surface as a click-to-select list (`.milton-popup-tag-options` / `.milton-popup-tag-option`) — replaces the old dashed-suggestion-chip row, which didn't read as autocomplete in the inline-field layout. The menu **floats** (`position: absolute` anchored to the now-`position: relative` tag card, `overflow: hidden` dropped from `.milton-popup-card`) so it **never changes the popup height**, and opens **upward** (`bottom: calc(100% + 6px)`) because the tags card sits just above "Save to Milton" — a downward menu would be clipped by the popup window edge. White surface + border + shadow, capped at `max-height: 220px`. Selecting an option keeps focus in the input (`mousedown` preventDefault + re-focus after re-render) so tags can be added back-to-back. `renderChip` lost its now-unused `suggestion` param; `.milton-popup-tag-chip-suggestion` CSS removed.
  - [x] **Tag chips render in insertion order** — `PreviewState`'s split `selectedTagIds: string[]` + `newTagNames: string[]` are replaced by a single ordered `selectedTags: SelectedTag[]` (`{kind:'existing',id}` | `{kind:'new',name}`). Chips render straight off that list so existing + new tags interleave in the exact order the user attached them (was: all existing tags, then all new tags — read as a reorder). `selectedExistingIds()` / `selectedNewNames()` derive the connector's two payload arrays at save time.
  - [x] **Typed tag text styled** — the inline tag input uses Figma "Text/Medium/medium" (`font-weight: 500`) in Text/primary `#0a0a0a` (was inheriting `400`).
  - [x] **Popup sizes to its content — no scrollbar on the extension itself** — re-pulled node `1323:8984` (440×640). The popup has NO `min-height` / `max-height` / internal-scroll region anywhere: the window grows/shrinks to fit (preview card 221px `min-height`, tags card grows as tags are added), so "Save to Milton" is always the last thing in flow and always visible. (An earlier `min-height: 548px` attempt forced the popup to ~640px — over the browser's ~600px popup cap — which made the extension *itself* scroll and hid the Save button; removed.) Preview card height corrected `256 → 221px` (exact Figma "Menu" frame), then changed from fixed `height` to `min-height` so it carries **no scrollbar of its own** — read-only rows fit inside 221px, an expanded editor just grows the card (editor sub-fields scroll internally). Field rows lost their 3px vertical padding, column gap `2 → 8px`. Title is a single line (`white-space: nowrap` + ellipsis, matching Figma) with the full title in a `title=` tooltip. **Known platform limit:** the Figma is 640px, the browser caps extension popups at ~600px — the empty/1-tag-row state fits (~566px) but a 2nd tag row exceeds the cap and the *browser* forces a scrollbar; the only lever left is shrinking the preview card (e.g. fewer abstract lines).
  - [x] **Autocomplete ↑/↓ keyboard navigation** — `PreviewState` gains `tagSuggestionIndex` (-1 = none highlighted). ↑/↓ move the highlight (`.milton-popup-tag-option-active`, auto-`scrollIntoView`); plain Enter with a highlight selects that tag, otherwise falls through to the create-new / exact-match routing. Typing resets the highlight. `currentTagSuggestions()` recomputes the list so render + handler always agree.
  - [x] **Tag input keeps focus after every add** — pressing Enter (create-new, exact-match, or highlighted suggestion) or clicking a dropdown option now re-focuses `#tag-input`, so the flow is focus → type → Enter → type → Enter… without re-clicking. Shared `addExistingTag()` + `focusTagInput()` helpers.
  - [x] **Popup fits the browser cap — no whole-popup scrollbar, Save always visible** — the browser caps extension popups at ~600px and can't be overridden, so the content is now bounded to fit: abstract clamped `4 → 2` lines, preview card `min-height 221 → 176px`, and the chip row lives in a capped `.milton-popup-tag-scroll` wrapper (`max-height: 108px; overflow-y: auto`) — tags scroll *inside the tags card* once they wrap past ~2 rows instead of growing the popup. Worst case (tags maxed) ≈ 589px < 600px → the extension never shows its own scrollbar and "Save to Milton" is always visible. The autocomplete dropdown is a sibling of the scroll wrapper (direct child of the non-clipping card) so it isn't clipped, and now opens **downward** (`top: calc(100% + 6px)`) per Pierre.
  - [x] **Light-only** — no `prefers-color-scheme: dark` override (Figma is light-only). SN Pro stays system-font fallback (TD-70 — repo woff2 are corrupt HTML)
  - [x] `pnpm typecheck` 0 errors; `pnpm test` 99/99 green (popup DOM not jsdom-tested per G17-1; +5 `formatAuthorsDisplay`, +2 `blankEditable` tests); `pnpm build` produces `dist/` (JS 31.28 KB, CSS 9.65 KB, no font assets)
  - [ ] Manual sideload smoke of the redesign — folded into Pierre's Task 11 review-time gate (G17-1: layout/typography is jsdom-blind)

## Dev Notes

### What ships in this story

- ✅ Preview UI replacing minimal URL view (AC1, AC8)
- ✅ Inline-edit for title / authors / year (AC2)
- ✅ Tag selector with autosuggest + create-new + deterministic chip colors (AC3, AC12)
- ✅ Project multi-select (AC4)
- ✅ Collection multi-select (AC5)
- ✅ `listSelectors()` client method covering all three GET endpoints with partial-failure tolerance (AC6)
- ✅ Wire-up of `tagIds[] + newTagNames[] + projectIds[] + collectionIds[]` to the existing `createReference()` POST (AC7)
- ✅ Two new popup states (`loading-selectors`, `preview`) layered on top of BE-4's 19; `ready-to-save` removed (AC8)
- ✅ G15-1 boundary inputs per AC (≥ 1 atypical input per behavior-changing AC)
- ✅ G18-4 cross-content-type smoke cycles (AC9 #2/#3/#4/#5/#14)
- ✅ `getTagColor` replicated as `tools/browser-extension/src/lib/tag-colors.ts` with drift-guard test (AC12)
- ✅ Tests: connector-client + tag-colors + pure helpers (AC10)
- ✅ README updates (AC11)

### What this story does NOT do

- ❌ Page-detection content script (BE-3, deferred)
- ❌ Chrome Web Store packaging
- ❌ Tag color picker (memory rule: tags have NO user-supplied color)
- ❌ Tag rename / delete from extension (capture-only — management lives in Milton)
- ❌ Project / collection creation from extension (selector-only — creation lives in Milton)
- ❌ Recently-used tag/project/collection surfacing (would need usage tracking — Milton-side concern)
- ❌ Inline edit of journal / DOI / abstract — title/authors/year cover the common-correction case; rest is uncommon and adds editor surface area without clear ROI (defer until Pierre asks)
- ❌ localStorage persistence of in-flight edits (popup state is ephemeral by design — Q9=b minimal scope)
- ❌ Multi-candidate picker for `MetadataResponse.candidates[]` — translation server's `primary` is the source of truth for our use; candidates can be exposed later if Pierre asks
- ❌ Visual indication that 409 dedup would have applied your tags (would suggest server applies them — it doesn't)
- ❌ Retry button on partial-failure of one selector (3 GETs in parallel is already cheap; "open Milton and retry" suffices)

### Why selectors-before-metadata (parallel fetch)

Translation-server fetch is the slow path (Pierre's BE-4 observation 2026-05-14: *"it is a bit long but it works"* — multiple seconds for translator processing + GROBID hit on PDF-backed papers). Connector selectors are sub-millisecond localhost calls. Firing the three selector GETs **in parallel** with metadata extraction means selector data is already in state by the time the preview is ready to render — no extra "Loading tags..." spinner. The preview itself transitions: title/year/author skeletons (during metadata fetch) → fully populated. Selectors render the moment they arrive (typically before the metadata).

### Why no jsdom-based popup test

G17-1 hard gate: JSDOM is structurally blind to real browser behaviors. The same logic applies for extension popup DOM:

- `chrome.tabs.query` doesn't exist in jsdom
- `chrome.tabs.create` doesn't exist in jsdom
- Manifest V3 service-worker behavior isn't simulated
- CSS layout (often the actual reason to test a UI) is jsdom-blind
- Keyboard shortcut routing (`Cmd+Enter`, `Escape`) is hard to simulate reliably across platforms

**Pure helpers** (text parsing, author joining, year extraction, tag-Enter routing) get unit tests. The **popup integration** is Pierre's manual smoke (AC9 + Task 11) per G17-1. This matches BE-1's pattern (Task 12 deferred to Pierre; T13 pre-review self-check covered everything jsdom CAN see).

### Wire contract — story-relevant excerpts (canonical: `docs/integrations/browser-extension-protocol.mdx`)

**`GET /tags`** — alphabetical `[{ id: string, name: string }]`. 503 when signed out. **No `color` field.**

**`GET /projects`** — most-recently-updated-first `[{ id: string, title: string, status: "idea" | "wip" | "done" }]`. `title` is the project's display name (DB column is `name`; renamed for the wire). 503 when signed out.

**`GET /collections`** — alphabetical `[{ id: string, name: string }]`. 503 when signed out.

**`POST /references` extended payload** (already wired by BE-1's AC7; BE-2 just populates the arrays):

```json
{
  "title": "...",
  "authors": [{ "firstName": "...", "lastName": "..." }],
  "year": 2024,
  "doi": "...",
  "abstract": "...",
  "url": "...",
  "tagIds": ["tag-uuid-1"],
  "newTagNames": ["Just Created"],
  "projectIds": ["proj-uuid-1"],
  "collectionIds": ["coll-uuid-1", "coll-uuid-2"]
}
```

**Atomic transaction semantics** (protocol doc line 204): the reference insert + all four organization-link inserts run inside a single `sqlx::Transaction`. Any failure rolls the whole thing back — no orphan reference, no partial joins.

**Dedup-is-noop callout** (protocol doc line 261): `POST /references` with a DOI that matches an existing reference returns 409. The organization arrays are **ignored** — they are NOT retroactively applied to the existing reference. AC9 smoke #5 explicitly verifies this end-to-end.

**Tag-name collision** (protocol doc): a `newTagNames[]` entry that exactly matches an existing tag of the same user is the **dedupe-and-link** path — the existing tag is linked, no duplicate row is inserted. BE-2's UI proactively avoids this by preferring autosuggest-match over create-new on Enter, but the server's dedupe is the canonical guarantee.

### Tag-no-color discipline (memory rule, recurring error pattern)

- `GET /tags` response shape has NO `color` field
- `POST /references` payload has NO `tagColor` or similar field
- Extension UI computes chip color via `getTagColor(name)` — a deterministic hash, NEVER stored, NEVER sent to the server
- Per memory: *"tag DONT HAVE A COLOR... colors are for pinned filters, tags dont have any color!!"*
- The defensive pattern locked in BE-1's AC7 (zero `color` field anywhere in the extension) is RE-VERIFIED in BE-2's pre-review checklist (grep gate)

### What prerequisites ship — DON'T REINVENT

BE-2 builds on a fully wired-up stack:

| Layer | Source | What BE-2 consumes |
|---|---|---|
| Connector selector endpoints | Story 18-1 — `milton/src-tauri/src/connector/handlers.rs` lines 173–236 | `GET /tags`, `GET /projects`, `GET /collections` already serve the wire shapes BE-2 needs |
| Connector extended payload | Story 18-1 — `POST /references` accepts `tagIds[] + newTagNames[] + projectIds[] + collectionIds[]` atomically | BE-1's AC7 forward-compat envelope already emits these as `[]`; BE-2 just populates them |
| Translation envelope | Story BE-4 — `translate.milton.so/metadata` → `MetadataResponse` | `primary` is the source of truth for the preview UI |
| Popup state machine | Stories BE-1 + BE-4 — `popup.ts` 19-state machine | Two new states layered on; existing error states reused (no new error kinds needed) |
| `createReference()` client | Story BE-1 — `connector-client.ts::createReference()` | Unchanged — BE-2's edits only TOUCH the payload object before passing it in |
| `mapMetadataToPayload` | Story BE-4 — `metadata-to-payload.ts` | Called with `EditableMetadata` (override-merged) instead of raw `MetadataPrimary` |
| `getTagColor` reference impl | `milton/src/lib/features/projects/utils/tag-colors.ts` (lines 28–35) | **Copied verbatim** into `tools/browser-extension/src/lib/tag-colors.ts` (with drift-guard test) |
| `escapeHtml` helper | `popup.ts` (BE-1) | Reused for all injected metadata strings (XSS gate) |

### Tech stack — version pins unchanged from BE-4

| Package | Version | Source of truth |
|---|---|---|
| `vite` | `^7.3.x` | BE-1 / BE-4 pin |
| `@crxjs/vite-plugin` | `^2.4.x` | BE-1 / BE-4 pin |
| `typescript` | `^5.9.x` | BE-1 / BE-4 pin |
| `@types/chrome` | latest stable | DefinitelyTyped — unchanged |
| `vitest` | `^4.1.x` | BE-1 / BE-4 pin |

**No new deps for BE-2** — selectors UI + edit affordances are vanilla DOM + CSS.

### File structure (target)

```
tools/browser-extension/
├── src/
│   ├── popup/
│   │   ├── index.html                # unchanged
│   │   ├── popup.ts                  # EXTENDED: preview state, edit handlers, selector wiring
│   │   └── popup.css                 # EXTENDED: ~12 new classes for preview + selectors + chips
│   └── lib/
│       ├── auth-client.ts            # unchanged
│       ├── connector-client.ts       # EXTENDED: listSelectors() added
│       ├── metadata-to-payload.ts    # unchanged
│       ├── tag-colors.ts             # NEW: getTagColor(name) — copied from Milton frontend
│       ├── translation-client.ts     # unchanged
│       └── types.ts                  # EXTENDED: TagSummary, ProjectSummary, CollectionSummary, SelectorsResult, EditableMetadata
└── (test files colocated under src/lib/ and src/popup/)
```

### Recent-commit intelligence

- **`0a259429 feat(BE-4): migrate browser extension to per-user JWT auth + /metadata endpoint (#23)`** — current `popup.ts` (19 states), `translation-client.ts`, `metadata-to-payload.ts`, `auth-client.ts` shapes. Build/test gate commands. The `MetadataResponse` envelope `primary` is BE-2's preview source.
- **`538ac562 feat(BE-1): scaffold browser extension + connector client + sideload package (#21)`** — base scaffolding; AC7 envelope locked from day one; `escapeHtml` helper.
- **`596d710 feat(18-1): connector API contract + extended payload + close code review`** (already on main) — server-side `GET /tags`, `GET /projects`, `GET /collections` + extended payload that BE-2 wires up.

No drift risk: the connector API + translation-server envelope have been stable since 18-1 (2026-05-04). The wire shapes haven't shifted; BE-2 just exercises them end-to-end from the extension side for the first time.

### Latest tech findings (Context7-verified BE-1 / BE-4 era — unchanged for BE-2)

- CRXJS supports Vite 3–8; current pin Vite 7.3.x — no migration needed
- `@crxjs/vite-plugin` ^2.4 is stable; manifest format unchanged
- TypeScript 5.9 — strict mode + `lib: ['DOM', 'ES2022']`; no new compiler options needed
- Vitest 4.1 — `pnpm test` runs in Node environment (no jsdom; matches BE-1/BE-4 testing pattern)
- No new external deps for BE-2

### Project Structure Notes

- All work stays under `tools/browser-extension/` — no cross-boundary imports into main Milton (BE-1 self-containment rule)
- `getTagColor` is COPIED, not imported (extension build does NOT depend on Milton's frontend pnpm workspace)
- Sprint-status file: `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml` (NOT main Milton's)
- Story file at the same path with key `BE-2-rich-popup-selectors`
- No new top-level dependencies needed
- README extension only — no new docs in main Milton's `docs/` tree

### Documentation Consolidation Notes

- Protocol doc (`docs/integrations/browser-extension-protocol.mdx`) is already canonical — no edits needed
- README is the operational doc for the extension itself — BE-2 extends "Smoke test" + "Popup state matrix" + "Story map" sections
- If extension graduates to Chrome Web Store distribution: a separate doc page in `docs/integrations/` may eventually cover the user-facing UX, but that's BE-3+ scope

### References

- **Charter** — `tools/browser-extension/_bmad-output/planning-artifacts/charter.md` (BE-2 line in story map)
- **BE-1 story** — `tools/browser-extension/_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md` (AC7 forward-compat envelope; popup state machine origin)
- **BE-4 story** — `tools/browser-extension/_bmad-output/implementation-artifacts/BE-4-auth-migration-connector-token.md` (current auth flow + `/metadata` envelope)
- **Story 18-1** — `_bmad-output/implementation-artifacts/18-1-extension-receive-ux-polish.md` (extended payload + GET selectors server-side)
- **Connector protocol** — `docs/integrations/browser-extension-protocol.mdx` (canonical wire contract for GETs + extended POST)
- **`getTagColor` canonical** — `milton/src/lib/features/projects/utils/tag-colors.ts` (lines 28–35; 10-color palette in lines 10–21)
- **Connector handlers** — `milton/src-tauri/src/connector/handlers.rs` lines 173–236 (`list_tags`, `list_projects`, `list_collections`); `TagSummary` / `ProjectSummary` / `CollectionSummary` structs at lines 151–169
- **Connector payload shape** — `milton/src-tauri/src/connector/payload.rs` (`ConnectorReferencePayload` server-side struct)

### Provenance

Charter Q4=b "Rich popup UX (metadata preview + tag / project / collection selectors)" (Pierre 2026-05-04). BE-1 explicitly DEFERRED this to BE-2: *"BE-2 will only need to populate these arrays — wire shape is locked"*. All four organization arrays already locked in BE-1's `csl-to-payload.ts` → BE-4's `metadata-to-payload.ts`. BE-2 is the long-awaited UI surface for the connector's most powerful contract.

## Pre-Review Self-Check

<!-- Tools sub-project — adapted from BE-1's checklist. No Figma (Q9=b minimal independent styling), no PandaCSS, no Bits-ui. -->

- [x] `pnpm install --ignore-workspace` runs clean (no new deps; lockfile unchanged)
- [x] `pnpm typecheck` (`tsc --noEmit`) reports 0 errors
- [x] `pnpm test` — 99/99 passing (39 BE-4 baseline + 60 new across `tag-colors.test.ts` + `connector-client.test.ts` + `popup-helpers.test.ts`); ≥ 50 bar cleared
- [x] `pnpm build` produces `dist/` — JS bundle 42.58 KB (gzip 11.92 KB), CSS 12.52 KB (gzip 2.57 KB). Over the < 30 KB JS target in the story — the Figma redesign (Task 12 + 14 follow-ups: segmented tabs, "Add to..." picker, inline SVG icons) accounts for the growth. Worth a perf-observation note for BE-3, not blocking.
- [x] No `color` field anywhere in tag-related code (`grep -rnE "tagColor|tag\.color|color.*tag" src/` returns one false-positive — the `getTagColor` docstring; no actual `color` field on tag types or payloads)
- [x] `getTagColor` in `tools/browser-extension/src/lib/tag-colors.ts` matches palette + hash in `milton/src/lib/features/projects/utils/tag-colors.ts` (verified by `tag-colors.test.ts`: 10-entry palette assertion + single-char hash verification a→[7] b→[8] c→[9] d→[0] e→[1])
- [x] Connector base URL hardcoded ONCE at `connector-client.ts:14` (grep confirmed — no new occurrence introduced; `SELECTOR_TIMEOUT_MS` constant added alongside, not a new base URL)
- [x] All injected metadata strings escaped via `escapeHtml` before `innerHTML` assignment (audit: title, journal, doi, authors via join, error messages, tag names, project titles, collection names, ids, urls all escape). XSS surface from translation-server output closed.
- [x] No new imports cross the `tools/browser-extension/` boundary — extension stays self-contained per BE-1. `getTagColor` is a verbatim copy, not an import.
- [x] AC7 envelope: `tagIds | newTagNames | projectIds | collectionIds` appear in exactly 4 source files: `types.ts` (definition), `metadata-to-payload.ts` (default emission), `popup.ts` (Save-time population), `metadata-to-payload.test.ts` (verification). No leakage to other modules. Grep verified.
- [x] README story map updated (BE-2 → shipped); state matrix updated with `preview` + partial-failure + 400/409 rows; smoke test section extended with 10 scenarios
- [x] Manual sideload smoke (Task 11) — Pierre validated 2026-05-15 (*"I tested it it is perfect"*); functional 409 / 400 / XSS scenarios confirmed by the code-review pass

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — invoked via `/bmad_bmm_dev-story BE-2` directly after `/bmad_bmm_create-story BE-2`.

### Debug Log References

- `pnpm typecheck` — 0 errors after one fix-up: initial cast `r.tags[0] as Record<string, unknown>` failed TS2352 (strict type incompatibility); resolved with `as unknown as Record<string, unknown>` in the unknown-field tolerance test
- `pnpm test` — 92 passing in 318ms (39 BE-4 baseline + 13 tag-colors + 12 connector-client + 28 popup-helpers)
- `pnpm build` — Vite 7.3.2; 12 modules transformed; 128ms; JS 31.35 KB (gzip 7.91 KB), CSS 8.55 KB
- Pierre confirmed Figma waiver at kickoff: *"a) for now I give you a wild card to dev it, but you can use the existing design paterns we have in Milton app (for buttons etc). I will try to design it regardless whle you are working so we can correct it after if needed."* — saved as memory rule `feedback-figma-waiver-extension-subproject.md`

### Completion Notes List

**AC1 (preview replaces minimal URL)** — `renderPreview` shows title (always, with 3-line clamp via `-webkit-line-clamp`), authors (joined "First Last, ..."), year (only when > 0 or being added), journal (only when non-empty), DOI (only when non-empty, mono font). All injected values pass through `escapeHtml`. Authors empty after filter → "(unknown — click to add)" muted display.

**AC2 (inline-edit title/authors/year)** — Click any field row → enters edit mode (state.edit field). Title/year: single text input, auto-focus + auto-select; blur or Enter commits; Escape reverts edit state; Cmd/Ctrl+Enter commits AND triggers Save. Authors: multi-row first/last grid with × per row + "+ Add author" + Done button; each input commits on blur; same keyboard shortcuts. Year input passes through `parseYearInput` (regex `(\d{4})`, range 1500..currentYear+2, sentinel 0 = omit).

**AC3 (tag selector)** — Three chip surfaces: selected-existing (with × remove), selected-new (with × remove), suggestion (dashed border, click to select). Autosuggest via `filterTagSuggestions` — case-insensitive substring match, top 6, excludes already-selected. Enter routing via `decideTagInputEnter`: pure-whitespace ignored, exact case-insensitive match selects existing (clears input), novel non-whitespace creates new (trimmed). Duplicate-create-new guard: if name already in `newTagNames` case-insensitively, input clears without dup. Chip color via local `getTagColor()` (no `color` field anywhere).

**AC4 (project multi-select)** — Server-ordered list (no client re-sort — `updated_at DESC` preserved); status badge per `idea | wip | done` with distinct background colors via CSS tokens; toggle on click; selected state visually distinct (accent background + border); `max-height: 180px; overflow-y: auto` for >20 projects; section hidden when list empty; partial-failure shows "Projects unavailable" inline note.

**AC5 (collection multi-select)** — Same pattern as projects minus status badge; `text-overflow: ellipsis` + `title=` tooltip for long names.

**AC6 (listSelectors)** — `Promise.all` over three per-call `fetchSelector` helpers, each with `AbortController` 2s timeout; per-call parsers (`parseTagSummary`, `parseProjectSummary`, `parseCollectionSummary`) drop malformed entries (logged via `console.warn`); unknown `ProjectStatus` values filtered defensively (forward-compat for future statuses). Result-shape rules per AC6: any 503 → `signed-out` reason, all 200 → `ok: true`, mix → `partial-failure` with `null` per failed slot.

**AC7 (save wiring)** — `save()` calls `mapMetadataToPayload(editableToMapperInput(editable), currentUrl)` (EditableMetadata structurally implements MetadataPrimary), then overwrites the four arrays with `selectedTagIds | newTagNames | selectedProjectIds | selectedCollectionIds`. No new error kinds — all results route via existing `dispatchCreateReferenceResult` (201/400/403/409/503 + network-error + payload-too-large).

**AC8 (state machine)** — `ready-to-save` removed; `preview` state added with nested `MetadataLoad` + `SelectorsLoad` discriminated unions. Total kept at 19 top-level states (loading-tab, loading-health, cannot-capture, milton-not-running, preview, posting, success, signed-out, error-no-metadata, error-too-large, error-409-duplicate, error-400-validation, error-network, error-auth-failed, error-rate-limited, error-quota-exceeded, error-tier-required, error-service-unavailable, plus the preview's internal loading sub-state). Concurrent metadata + selectors fetches via `void promise.then(...)` pattern that no-ops if state has transitioned away.

**AC9 (smoke matrix)** — 14 scenarios documented; Pierre's review-time sideload smoke passed 2026-05-15; functional 409 / 400 / XSS scenarios confirmed in the code-review pass.

**AC10 (tests)** — 60 new test cases added (13 tag-colors + 12 connector-client + 35 popup-helpers). All previous 39 (BE-4) still green. Total 99/99.

**AC11 (README)** — story map + state matrix + smoke section + story link all updated.

**AC12 (getTagColor drift guard)** — Copied verbatim from `milton/src/lib/features/projects/utils/tag-colors.ts` with dated provenance comment. `tag-colors.test.ts` verifies palette shape (length 10, hex format, Figma sample colors at expected indices) + hash determinism (single-char names against palette indices computed by hand).

**Task 12 (Figma redesign pass — added 2026-05-14)** — Task 8 originally shipped under the Figma waiver (Q9=b "minimal independent styling"). Pierre then designed the popup in Figma and re-invoked `/bmad_bmm_dev-story BE_2` with Figma MCP access to implement the full redesign. Verified against Figma node `1323:8984` ("Browser extension"):

- **Scope confirmed with Pierre at kickoff:** (a) no tabs yet — the "Main info / Add to..." segmented control is deferred, reskin the single-column layout; (b) bundle the full SN Pro weights as-is; (c) full reskin "my interpretation" — restyle every state, not just the designed ones.
- **Font (CORRECTION — first attempt was broken):** SN Pro could **not** be bundled. Every `sn-pro-*.woff2` in the Milton repo (`milton/static/fonts/` AND `milton/build/fonts/`) is a corrupted HTML document, not a font — `file` reports "HTML document text", the bytes start `0a0a0a0a <!DOCTYPE html>`, and Chrome rejects them with `OTS parsing error: invalid sfntVersion: 168430090` (0x0A0A0A0A). The first attempt bundled them anyway and they decode-failed in-browser. **Fix:** removed the font files + `@font-face`; the popup falls back to the system UI font with `'SN Pro'` kept first in the family stack (works for free if Pierre has SN Pro system-installed, or once real woff2 files are dropped in). This is a **pre-existing Milton bug** — Milton's own `app.css` references the same broken `/fonts/sn-pro-*.woff2` files; flagged for a separate tech-debt entry.
- **Tokens:** `popup.css` rewritten to the Figma variable set — Background 1/3/4/5 (`#ffffff`/`#f5f5f5`/`#eeeeee`/`#e5e5e5`), Text primary/secondary/tertiary/quaternary (`#0a0a0a`/`#525252`/`#737373`/`#a3a3a3`), brand `#0a0a0a`, shadow-xs, radii (popup 24 / card 14 / chip 14 / button 14).
- **Layout:** preview + tag + project + collection content wrapped in `#f5f5f5` card surfaces; section titles SN Pro Semibold 16/26; preview rows in a label-column layout (Title headline → Author(s) → Date → Abstract); tag chips restyled to the Figma 40px `#e5e5e5` pill with an inline X icon; Save button full-width brand-black 48px.
- **Code-Connect:** Pierre opted in, but this Figma MCP server doesn't expose `get_code_connect_suggestions` and the extension has no component library to map (vanilla TS emitting HTML strings) — proceeded from `get_design_context` directly.
- **Interpretation calls flagged for review (final pixel-perfect pass, 2026-05-14):** (1) **Abstract row** + Journal/DOI kept as conditional rows below it — the Figma frame shows Title/Author(s)/Date/Abstract and omits Journal/DOI; AC1 lists Journal/DOI, so they're retained as degrade-when-empty rows (Figma-exact when absent, AC1-complete when present). (2) **Year row relabelled "Date"** per the Figma label; underlying state/payload field stays `year`. (3) **getTagColor dot REMOVED** — the Figma chip is a flat grey pill with no dot; the redesign drops the leading dot and the `getTagColor` import from `popup.ts` (the utility + `tag-colors.test.ts` stay — used by nothing in the popup now, but kept intact per the task's "don't break the 92 tests" constraint). (4) **Save button full-width** — the `get_design_context` emit showed a stale 160px component default, but `get_metadata` reports the button instance resized to 468px (full content width) and the screenshot confirms; full-width it is. (5) **Light-only** — no `prefers-color-scheme: dark` override; the Figma frame is light-only. (6) **Segmented tabs are functional** — Pierre's call (`AskUserQuestion` at kickoff): "Add to..." is clickable and switches to an empty placeholder ("Nothing to add yet / Projects and collections are coming soon"). (7) **Projects + Collections sections removed** from the popup entirely — not in the design at that time. _(SUPERSEDED by follow-up #13: Pierre later designed the "Add to..." tab with the collections/projects picker — see Task 12 FINAL STATE below.)_ (8) **Per-row label→value gaps copied verbatim** from Figma (Author 31px / Date 40px / Abstract 22px) — the design's gaps are genuinely inconsistent; replicated as-is rather than normalised to a label column. Pierre may request an after-the-fact correction per the extension Figma waiver.
- **Author display + sticky Save (Pierre feedback after first pixel-perfect smoke):** (1) the read-only Author(s) row used the full `joinAuthors` join, so a 40-author paper (GPT-4 report) flooded the preview — added `formatAuthorsDisplay()` mirroring Milton's `formatAuthors` (≤3 full, >3 → first 2 + "et al."). (2) "Save to Milton" sat at the bottom of an unbounded column and scrolled off-screen — `.milton-popup-sections` is now a `max-height: 432px` internal-scroll region so Save stays pinned below it.
- **Gates:** `pnpm typecheck` 0 errors; `pnpm test` 99/99 (pure-fn tests — popup DOM is jsdom-blind per G17-1); `pnpm build` produces `dist/` with **no font assets**, JS 42.81 KB (gzip 11.97 KB), CSS 12.52 KB (gzip 2.57 KB).

---

**Task 12 — FINAL STATE (as shipped to `review`, 2026-05-15).** The Change Log below records 14 incremental follow-up passes; this is the consolidated end state for code review:

- **Shell** — fixed `400×600` popup (the Figma frame size + the browser's popup-height cap). Pinned tabs at top, pinned 40px "Save to Milton" at bottom, scrollable content column between. Switching tabs never resizes the window. Light-only. SN Pro → system-font fallback (TD-70 — repo woff2 are corrupt).
- **"Main info" tab** — fixed-height (`min-height: 176px`) preview card: 1-line title (ellipsis + `title=` tooltip), Author(s) collapsed past 3 via `formatAuthorsDisplay` ("First, Second et al."), Date, 2-line-clamped Abstract. All four rows are inline-editable (click → input/textarea to the RIGHT of the label; Background/5 fill + neutral-300 focus stroke; authors editor stacks + scrolls internally). Skeleton on load. Tags section: flat `#e5e5e5` chips in insertion order with inline × , an invisible inline "New tag…" input, and a floating ↑/↓-navigable autocomplete dropdown of existing tags.
- **"Add to..." tab** — collections / projects picker (Figma node `1341:9327`): title + body copy, a collections/projects sub-toggle with live selected counts, separator, Bold-16 section label, an `#eee` search field, a scrollable checkbox list. Duo-solid `layer-three` / `briefcase-job` icons (neutral-700). Checkboxes drive `selectedProjectIds` / `selectedCollectionIds`.
- **Save** — shared across both tabs; wires all four organization arrays into the payload via the unchanged `mapMetadataToPayload`; "instant Save" (browser tab title) is allowed while metadata is still loading.
- **Out of the original ACs:** Journal + DOI rows are no longer displayed (Pierre — not in the Figma; DOI still saved via the mapper). `getTagColor` dot dropped (Figma chip is flat grey); the utility + `tag-colors.test.ts` are kept intact.

**Pierre's gate (G17-1 manual smoke):** ✅ **passed 2026-05-15** — Pierre sideloaded and validated the full popup ("I tested it it is perfect"). Remaining AC9 *functional* scenarios (409 dedup-noop, concurrent project/collection deletion → 400, HTML-entity XSS) confirmed by `/bmad_bmm_code-review BE-2` (2026-05-15) via code reading. **Code review complete — 1 High + 3 Medium fixed, status → `done`.** See the final Change Log row.

### File List

**New:**
- `tools/browser-extension/src/lib/tag-colors.ts` — `getTagColor(name)` + `TAG_COLOR_PALETTE` (verbatim copy from Milton frontend with dated provenance comment)
- `tools/browser-extension/src/lib/tag-colors.test.ts` — 13 Vitest scenarios (palette shape + drift, single-char hash verification, determinism, palette-only output, empty-string edge)
- `tools/browser-extension/src/lib/connector-client.test.ts` — 12 Vitest scenarios for `listSelectors()` (happy / 3× signed-out / 3× partial-failure / 3× malformed-entry tolerance / server-order preservation / forward-compat extra fields)
- `tools/browser-extension/src/popup/popup-helpers.ts` — pure helpers: `joinAuthors`, `formatAuthorsDisplay`, `parseYearInput`, `decideTagInputEnter`, `filterTagSuggestions`, `metadataToEditable`, `editableToMapperInput`, `isTitleValid`
- `tools/browser-extension/src/popup/popup-helpers.test.ts` — 35 Vitest scenarios covering the 9 pure helpers exhaustively

<!-- Task 12 note: SN Pro font files were NOT added — the Milton repo's sn-pro-*.woff2 are
     corrupted HTML, not fonts (see Completion Notes). No font assets ship with the extension. -->

**Modified:**
- `tools/browser-extension/src/lib/types.ts` — added `TagSummary`, `ProjectSummary`, `CollectionSummary`, `SelectorsResult`, `EditableMetadata` types. **Code review 2026-05-15:** `ProjectStatus` type + the `status` field on `ProjectSummary` removed (H1 — the status badge was cut in the Figma redesign; the connector still sends `status` on the wire but the extension ignores it).
- `tools/browser-extension/src/lib/connector-client.ts` — added `listSelectors()` export + 3 per-entry parsers (TagSummary, ProjectSummary, CollectionSummary); `SELECTOR_TIMEOUT_MS` constant. **Code review 2026-05-15:** `parseProjectSummary` simplified to `{id, title}`; `KNOWN_PROJECT_STATUSES` + the `ProjectStatus` import dropped (H1).
- `_bmad-output/implementation-artifacts/tech-debt.md` (repo root) — **TD-70** logged (every `sn-pro-*.woff2` in the Milton repo is a corrupted HTML document, not a font; surfaced by the Task 12 font-bundling attempt — initially numbered TD-64, renumbered to TD-70 on merge after Epic 19's PRs #24/#25/#26 took 64–69 in parallel). _(M3 — was modified in git but absent from this File List until the code-review pass.)_
- `tools/browser-extension/src/popup/popup.ts` — full rewrite of state machine and render logic to support `preview` state with metadata edit affordances + tag selector. Old `ready-to-save` state removed; all BE-1/BE-4 error states + dispatchers preserved. **Task 12 final state:** `PreviewState` carries `activeTab`, `selectedTags` (ordered union), `tagInput` + `tagSuggestionIndex`, `addToView` + `addToSearch`, `selectedProjectIds` / `selectedCollectionIds`. Renders: `renderTabs()` (functional "Main info / Add to..." control); **Main tab** — `renderPreviewMetadata` (skeleton / no-metadata / rows: title, authors with `formatAuthorsDisplay` et-al collapse, date, abstract — all inline-editable), `renderTagSection` (chips in insertion order + invisible inline input + floating ↑/↓-navigable autocomplete dropdown); **Add to... tab** — `renderAddTo` / `renderAddToList` / `renderAddToItem` (collections/projects sub-toggle, search, checkbox list). Inline icons: `X_ICON`, `LAYERS_ICON` + `BRIEFCASE_ICON` (Figma duo-solid), `SEARCH_ICON`, `CHECKBOX_CHECKED` / `CHECKBOX_UNCHECKED`. `save()` derives all four payload arrays; supports "instant Save" (tab title) while metadata loads. **Code review 2026-05-15:** (M2) authors-editor buttons (+ Add author / Done / × remove) rebound from `click` to `mousedown` + `preventDefault` so a focused-input blur re-render can't destroy the button mid-click; `commitAuthorsFromDOM` guards against an empty-DOM read. (L2) the unreachable `MetadataLoad` `no-metadata` variant + its render branch removed; `canSave` simplified to the now-exhaustive `loading | ready`.
- `tools/browser-extension/src/popup/popup.css` — **Task 12 final state:** rewritten to the Figma design system (Background/Text tokens + `--milton-neutral-300/700`, `--milton-border-focus`). Fixed-height shell (`400×600`): pinned tabs + scrollable content column (`.milton-popup-sections` / `.milton-popup-addto`) + pinned 40px Save button. Main tab: 176px-min preview card with horizontal inline-edit rows, flat `#e5e5e5` tag chips, capped tag-chip scroll wrapper, floating autocomplete dropdown. Add to... tab: title/body, `#eee` sub-toggle + search bar, scrollable checkbox list. Every error/loading/signed-out/success state retained. **Light-only**.
- `tools/browser-extension/README.md` — status banner; story map BE-2 → shipped; pipeline description (selector preload); state matrix table extended; smoke section ("BE-4 + BE-2 gate") with 10 scenarios; BE-2 story link; **Task 12:** status banner notes the redesign pass + new "Visual design" section.
- `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml` — BE-2 status flow: `backlog` → `ready-for-dev` → `in-progress` → `review` → `in-progress` (Task 12 reskin) → `review` → `in-progress` (Task 12 pixel-perfect pass) → `review` → `done` (code review 2026-05-15)

_(Code review 2026-05-15 also touched the NEW file `connector-client.test.ts` — project-body assertions updated to `{id, title}`, the "unknown status → drop" test rewritten as "ignores `status` entirely" — H1.)_

## Change Log

| Date | Author | Summary |
|------|--------|---------|
| 2026-05-14 | BMad Master | Story drafted via `/bmad_bmm_create-story BE-2` workflow with tools-sub-project context overrides (charter as source-of-truth in lieu of epics.md, BE-N prefix mirroring TS-N / mirroring BE-1 + BE-4 patterns). G15-1 boundary inputs enumerated per AC; G18-4 cross-content-type smoke scenarios included; G17-1 manual-smoke gate explicit. Promoted to ready-for-dev. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Implementation complete via `/bmad_bmm_dev-story BE-2`.** Tasks 1–10 shipped: types extended; `listSelectors()` client added with `Promise.all` partial-failure tolerance; `getTagColor` replicated locally; popup state machine refactored to `preview` (replaces `ready-to-save`) with concurrent metadata + selectors fetch; full inline-edit suite for title/authors/year (click-to-edit, blur/Cmd+Enter commit, Escape revert); tag selector with case-insensitive autosuggest + chip colors + exact-match/novel-create routing; project + collection multi-select with empty-list hide + partial-failure graceful degrade; save wires all 4 organization arrays; ~30 new CSS classes with dark-mode overrides; 53 new tests (92/92 total passing); README updated with story map / state matrix / smoke scenarios. Pierre confirmed Figma waiver at kickoff per charter Q9=b (saved as memory rule). Task 11 (manual sideload smoke, 10 scenarios including 409 dedup-is-noop verification + concurrent project deletion + HTML-entity XSS gate) deferred to Pierre per G17-1. Status flipped: `ready-for-dev` → `in-progress` → `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 — Figma redesign pass** via re-invoked `/bmad_bmm_dev-story BE_2` with Figma MCP access. Figma waiver lifted; popup restyled to the design Pierre drew (Figma node `1323:8984`). `popup.css` fully rewritten to the Figma token set + card surfaces + chip + brand-black Save button; `popup.ts` render structure updated (titled "Preview" section, Abstract row, "Date" relabel, card-wrapped selector sections, inline X icon). Scope confirmed with Pierre: no tabs yet (single-column reskin), full reskin of every state. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 corrections** after Pierre's first sideload smoke surfaced two bugs: (1) **Font** — the SN Pro woff2 files bundled from `milton/static/fonts/` are corrupted HTML, not fonts (`OTS parsing error: invalid sfntVersion`); removed them + `@font-face`, fell back to the system UI font (`'SN Pro'` kept first in the stack). Pre-existing Milton bug — flagged for tech-debt. (2) **Theme** — the kept dark-mode override rendered the popup fully dark on Pierre's dark-mode Mac, nothing like the light Figma; removed the `prefers-color-scheme: dark` block — popup is now light-only per the Figma. Gates re-run green: typecheck 0, test 92/92, build OK (no font assets, JS 32.01 KB, CSS 9.35 KB). Status: `review` → `in-progress` → `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 — Figma pixel-perfect pass** via the `figma-implement` skill. Pulled node `1323:8984` fresh (`get_metadata` → `get_design_context` → `get_screenshot` → `get_variable_defs`) and implemented verbatim. Added the functional "Main info / Add to..." segmented tab control ("Add to..." → empty placeholder, Pierre's `AskUserQuestion` call). **Removed Projects + Collections sections from the popup entirely** — not in the design; `listSelectors()` + all types kept intact, selector arrays stay `[]`. Tag chips → flat grey Figma pill, **dot removed** (`getTagColor` import dropped from `popup.ts`). X icon redrawn to the Figma cancel-icon geometry; 1px `#ebebeb` separator; per-row label gaps copied verbatim. Gates green: typecheck 0, test 92/92, build OK (JS 29.73 KB, CSS 9.09 KB — both shrank). Status: `review` → `in-progress` → `review` (G17-1: layout/typography is jsdom-blind — Pierre's sideload smoke is the gate). |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up** after Pierre's pixel-perfect smoke: (1) **author overflow** — a 40-author paper (GPT-4 report) flooded the Author(s) row; added `formatAuthorsDisplay()` pure helper mirroring Milton's `formatAuthors` (≤3 full, >3 → first 2 + "et al."), used for the read-only row only (inline edit still works on the full array). +5 unit tests. (2) **Save off-screen** — `.milton-popup-sections` is now a `max-height: 432px` internal-scroll region so "Save to Milton" stays pinned at the bottom regardless of metadata/tag volume. Gates green: typecheck 0, test 97/97, build OK (JS 29.80 KB, CSS 9.13 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #2** (Pierre feedback): (1) **fixed-height preview card** — the preview card is now a constant 221px (the Figma "Menu" frame) across skeleton / loaded / no-metadata states so the popup window never shifts height when metadata resolves; the loading state is a greyed pulse skeleton (reduced-motion aware). (2) **hover-to-edit restyled** — field rows highlight with Background/5 `#e5e5e5` + 14px radius. (3) **abstract is now editable** — fixed-height textarea (116px, own scroll), plain Enter = newline, blur/Cmd+Enter commit, Escape revert, "(add)" affordance when empty; `EditField` += `'abstract'`, `commitAbstract()` added. (4) **tall edit fields capped** — authors editor rows scroll inside `max-height: 132px` so Add/Done stay in view. Gates green: typecheck 0, test 97/97, build OK (JS 31.34 KB, CSS 9.81 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #3** (Pierre feedback): (1) **popup width → 440px** (was 500). (2) **DOI + Journal rows removed** from the preview — neither is in the Figma frame; this lets the preview card stay a fixed height (`221 → 256px`, title clamp `3 → 2`) that doesn't scroll in read-only mode, only when editing. DOI still saved via the mapper; journal was display-only. (3) **Instant Save** — `canSave()` is `true` while metadata still loading; `save()` falls back to a `blankEditable(tabTitle ‖ url)` payload from the browser tab's `<title>`. New `blankEditable()` helper + 2 tests. (4) **Tag input → invisible inline field** (Dribbble pattern) — transparent border-less input flex-grows after the chips inside the chip row; no more bordered input row. Gates green: typecheck 0, test 99/99, build OK (JS 31.28 KB, CSS 9.65 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #4** (Pierre feedback — "fix the tags, keep the autocomplete"): the existing-tag autocomplete is reworked from the old dashed-suggestion-chip row into a proper click-to-select **dropdown list** (`.milton-popup-tag-options`) below the inline tag field, separated by a hairline rule. In-flow (never clipped by the card / sections scroll), capped at 180px. Selecting an option keeps focus in the input so tags can be added back-to-back. `renderChip` lost its unused `suggestion` param; dead `.milton-popup-tag-chip-suggestion` / `.milton-popup-tag-suggestions` CSS removed. Gates green: typecheck 0, test 99/99, build OK (JS 31.35 KB, CSS 9.90 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #5** (Pierre feedback): (1) **tag chips now render in insertion order** — `PreviewState`'s split `selectedTagIds` + `newTagNames` collapsed into one ordered `selectedTags: SelectedTag[]` (`{kind:'existing',id}` ‖ `{kind:'new',name}`); chips render straight off it so existing + new tags interleave as added (was: all existing then all new — looked like an alphabetical/group reorder). `selectedExistingIds()` / `selectedNewNames()` derive the connector's two payload arrays at save. (2) **typed tag text** styled to Figma "Text/Medium/medium" (`font-weight: 500`) in Text/primary `#0a0a0a`. Gates green: typecheck 0, test 99/99, build OK (JS 31.66 KB, CSS 9.91 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #6** (Pierre re-selected the Figma — popup felt shorter than the design): re-pulled node `1323:8984` (440×640). Removed the `.milton-popup-sections` `max-height: 432px` cap that was clipping the column below the Figma height; `.milton-popup-content` gains `min-height: 548px` + `justify-content: space-between` so a normal reference renders at the designed ~640px with Save pinned bottom, and the popup now **grows** as tags are added. Preview card corrected `256 → 221px` (exact Figma frame) — field rows lost their 3px vertical padding, column gap `2 → 8px`, title clamped to a single line (`white-space: nowrap` + `title=` tooltip) so the read-only rows fill 221px exactly. Gates green: typecheck 0, test 99/99, build OK (JS 31.68 KB, CSS 9.90 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #7** (follow-up #6's `min-height: 548px` overshot — at ~640px the popup exceeded the browser's popup-height cap, so the *extension itself* scrolled and the Save button was clipped): removed `min-height` + `justify-content: space-between` from `.milton-popup-content`. The popup now purely **sizes to its content** — no min/max-height, no internal scroll region — so the window fits its content, grows as tags are added, and "Save to Milton" is always in flow and visible. The extension never shows its own scrollbar for a normal reference (~566px tall empty-tags). Gates green: typecheck 0, test 99/99, build OK (JS 31.68 KB, CSS 9.85 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #8** (Pierre: the autocomplete must be a dropdown that doesn't change the popup height): the in-flow `.milton-popup-tag-options` list is now a **floating** menu — `position: absolute` anchored to the now-`position: relative` `.milton-popup-card` (`overflow: hidden` dropped from it), white surface + border + shadow, `max-height: 220px`. It opens **upward** (`bottom: calc(100% + 6px)`, over the preview card) since the tags card sits right above Save — a downward menu would be clipped by the popup window edge. Result: the autocomplete overlays content instead of pushing it, so the popup height is unchanged whether the menu is open or not. Gates green: typecheck 0, test 99/99, build OK (JS 31.68 KB, CSS 10.00 KB). Status stays `review`. |
| 2026-05-14 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #9** (Pierre feedback, 4 items): (1) **autocomplete ↑/↓ navigation** — `tagSuggestionIndex` on `PreviewState`, arrow keys move the highlight (`.milton-popup-tag-option-active`, auto-scrollIntoView), Enter on a highlight selects it. (2) **tag input keeps focus after every add** — Enter/click re-focuses `#tag-input` so tags can be added back-to-back; shared `addExistingTag()` / `focusTagInput()` helpers. (4) **preview card no longer scrolls** — `height: 221px; overflow-y: auto` → `min-height: 221px` (no overflow): read-only fits 221px, editing grows the card, editor sub-fields scroll internally. (3) **extension scrollbar** — confirmed the popup already sizes to content with no CSS cap; the scrollbar Pierre sees is the browser's ~600px popup-height ceiling (Figma is 640px), which a 2nd tag row exceeds — flagged to Pierre, fix requires shrinking the preview card. Gates green: typecheck 0, test 99/99, build OK (JS 32.30 KB, CSS 10.02 KB). Status stays `review`. |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #10** (Pierre's chosen fix for the ~600px browser popup-height cap): (1) **abstract clamped `4 → 2` lines**, preview card `min-height 221 → 176px` — a shorter, compact preview. (2) **tag container scrollable** — the chip row sits in a capped `.milton-popup-tag-scroll` wrapper (`max-height: 108px; overflow-y: auto`); tags scroll *inside the tags card* past ~2 rows instead of growing the popup. Worst case ≈ 589px < the ~600px cap, so the extension never shows its own scrollbar and Save stays visible. The autocomplete dropdown is a sibling of the scroll wrapper so it isn't clipped; also flipped to open **downward** per Pierre. Gates green: typecheck 0, test 99/99, build OK (JS 32.37 KB, CSS 10.08 KB). Status stays `review`. |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #11** (Pierre feedback, 2 items): (1) **Save button → 40px tall + pinned to the bottom** — `.milton-popup-save` is now `height: 40px` (was 48) and `position: sticky; bottom: 16px; z-index: 10`, so it stays visible at the bottom of the popup even when expanding an editor (authors/abstract) grows the content past the browser cap and the popup scrolls. (2) **Date + Abstract inline editors stay horizontal** — `.milton-popup-field-row-editing` no longer forces a column layout, so the year input / abstract textarea sit to the RIGHT of their label (same x as the read-only value) instead of stacked below; the multi-row authors editor opts back into stacking via a new `.milton-popup-field-row-editing-stack`. Inline-edit inputs restyled to the design system: Background/5 (`#e5e5e5`) fill + `--milton-border` stroke (was white). Gates green: typecheck 0, test 99/99, build OK (JS 32.45 KB, CSS 10.21 KB). Status stays `review`. |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #12** (Pierre feedback): focused inline-edit inputs (editing date / abstract / title / authors) now use **neutral-300 (`#d4d4d4`)** as the border stroke — new `--milton-border-focus` token, `.milton-popup-field-edit:focus` switched from `--milton-fg` (near-black) to it. Gates green: typecheck 0, test 99/99, build OK (JS 32.45 KB, CSS 10.25 KB). Status stays `review`. |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #13 — "Add to..." tab implemented** (Pierre selected a new Figma frame `1341:9327`, 400×600, for the second tab). The empty placeholder is replaced by the full **collections / projects picker** built pixel-perfect from the frame: title + body copy, a collections/projects sub-toggle (`addToView` + `addToSearch` added to `PreviewState`, sub-toggle shows live selected counts), `#ebebeb` separator, Bold-16 section label, an `#eee` search field, and a scrollable checkbox list (`max-height: 180px`). Checkboxes toggle `selectedProjectIds` / `selectedCollectionIds` — **these now flow into the Save payload as originally designed** (they were forced `[]` while the picker was cut). `listSelectors()`'s project + collection data is consumed end-to-end at last. Five icons (layers / briefcase / search / checked / unchecked checkbox) inlined as SVG. Also per Pierre: **popup width `440 → 400px`**; the Save button already matched the new frame (40px, full-width, brand-black, radius 14). Gates green: typecheck 0, test 99/99, build OK (JS 39.40 KB, CSS 12.33 KB). Status stays `review` (G17-1 — layout is jsdom-blind, Pierre's sideload smoke is the gate). |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Task 12 follow-up #14** (Pierre feedback, 2 items): (1) **correct duo-solid icons** — the collections icon is now the Figma `layer/layer-three` and the projects icon the `briefcase-job`, **duo-solid variant**, assembled verbatim from the two exported vector fragments each (solid shape + 0.28-opacity shape) and painted **neutral-700** (`#404040`, new `--milton-neutral-700` token + `.milton-popup-icon-duo`) — replaces the earlier hand-drawn approximations. (2) **fixed 600px popup height** — `body` is now `400×600` and `.milton-popup-root` `height: 100%`; the shell is tabs (pinned top) + scrollable content column (`flex: 1`, `.milton-popup-sections` / `.milton-popup-addto` get `overflow-y: auto`) + Save (pinned bottom, `flex: 0 0 auto`, `position: sticky` dropped). The popup is a constant 600px — switching tabs or a short tab never resizes the window, and content that overflows scrolls inside its column. Gates green: typecheck 0, test 99/99, build OK (JS 42.81 KB, CSS 12.52 KB). Status stays `review`. |
| 2026-05-15 | Code Review (Opus 4.7 1M) | **`/bmad_bmm_code-review BE-2` — adversarial pass; 1 High + 3 Medium + 6 Low found, all High/Medium fixed (Pierre chose auto-fix).** **H1** (AC4 status badge never implemented; `ProjectSummary.status` parsed-but-dead) — Pierre's call: *"Cut it — reconcile AC4"*; removed `ProjectStatus` type + the `status` field from `ProjectSummary`, simplified `parseProjectSummary` to `{id, title}`, dropped `KNOWN_PROJECT_STATUSES`, rewrote the connector-client `status` test, reconciled AC4. **M1** — AC1/AC2/AC3/AC5/AC6 text + README reconciled with the as-shipped Task 12 redesign (Journal/DOI dropped, abstract row added, single-line title, "Date" label, no chip color). **M2** — authors-editor buttons rebound `click`→`mousedown`+`preventDefault` so a blur-triggered re-render can't swallow the click mid-press; `commitAuthorsFromDOM` guards an empty-DOM read. **M3** — `tech-debt.md` (TD-70, renumbered from TD-64 on merge — Epic 19 took 64–69 in parallel) added to the File List. **L2** — unreachable `no-metadata` `MetadataLoad` variant removed; `canSave` simplified. **L3** — AC3's 503 atypical reconciled with AC6 (whole-popup `signed-out`, no per-section degrade on 503). **L4** — stale test counts (92→99) + bundle sizes + Task 11 status corrected. **L5** — AC6 `Promise.allSettled`→`Promise.all` wording fixed. **L1/L6** documented (getTagColor retained-by-decision; empty-list note vs hide is a tab-layout consequence). Gates re-run green: `pnpm typecheck` 0, `pnpm test` 99/99, `pnpm build` OK (JS 42.58 KB, CSS 12.52 KB). Status: `review` → `done`. |
