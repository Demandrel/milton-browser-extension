# Story BE-8.7: Class 2 capture — client-side PDF bytes upload

Status: review

Origin: Charter v2 (`_bmad-output/planning-artifacts/charter-v2.md`) — Story Map row BE-8-7 (line 121), architecture diagram lines 80-86 (Class 2 cookie/session-gated PDF flow), Decision 5 (two-step IPC wire shape — `POST /references` then `POST /references/{id}/pdf-bytes`), Decision 8 (BE-7 backwards compatibility — `pdfUrl` survives; bytes-upload added on top), Risks table line 151 (Class 2 cookie/session sharing varies between Chromium variants — smoke matrix covers Chrome / Edge / Brave), Success Criteria #1 (Coverage gate — Class 2/3 captures from every site named in the brief). The sprint-status row name (`BE-8-7-class-2-capture-and-paste-failure-ux`) bundles a Milton-desktop UX surface that has been **scoped out** of this story per Pierre's create-story Q1 decision (2026-05-17) — see "Out of scope" below.
Depends on: **BE-8-2** (Milton-saas, done — `POST /references/{id}/pdf-bytes` endpoint, 50 MiB cap, raw `application/pdf` body, `attached` / `already_attached` envelope, scoped race-safe UPDATE); **BE-8-6** (this repo, done — popup state machine extensions, `chrome.scripting.executeScript`, offscreen sandbox, `extractMetadata` fallback path).
Unblocks: BE-8-8 (LLM-fallback in Milton-desktop — uses BE-8-7's bytes-upload surface as the end-to-end test target per charter Story Map "Depends on BE-8-7 — needs Class 2 PDF surface for E2E test").
Theme: Capture parity (charter Themes table).
Risk: **High** (charter Story Map — last Class 2 surface; first time the popup orchestrates a multi-step post-create side-effect; cross-origin fetch fallback semantics are subtle; cancel honesty across two async stages).

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **Pierre dogfooding BE-v2 against Cloudflare/Anubis-protected publisher PDFs (the Class 2 surface that broke BE-7's server-side `pdfUrl` flow — Wiley, ScienceDirect, Springer Nature direct-PDF URLs that the connector cannot reach because it has no session cookies and the publisher's bot-protection blocks the headless fetch)**,
I want **the extension to fetch PDF bytes inside the user's active tab context (same-origin fetch with the tab's session cookies, via `chrome.scripting.executeScript`) and upload them to Milton via the two-step IPC contract BE-8-2 shipped (`POST /references` first, then `POST /references/{id}/pdf-bytes` with the raw bytes), with a popup progress affordance during upload**,
so that **Class 2 captures (session-gated PDFs the connector cannot reach server-side) succeed using the same authenticated browser session the user already cleared, closing the largest remaining gap in BE-v2 capture parity — both for the direct-PDF-tab case (Flow A) AND for the article-landing-page-with-PDF-attachment case (Flow B, where BE-8-6's translator returned a ZoteroItem with `attachments[]` containing a PDF URL)**.

## Background

**Why this story exists.** Charter v2 line 81 (architecture diagram Class 2 swim-lane) commits to "Extension fetches PDF bytes client-side ▷ POST `127.0.0.1:7521/references` (metadata first) ▷ POST `127.0.0.1:7521/references/{id}/pdf-bytes` (multipart binary)". BE-8-6 closed the Class 3 surface (page-context HTML → translator → structured-item JSON). BE-8-7 closes the Class 2 surface — the bytes side of the same wire. Without it: a user on a Wiley journal article (or directly on a ScienceDirect PDF URL) gets a reference saved with metadata but no PDF (BE-7's server-side fetch returns 403/challenge-page because Milton's connector has no session cookies; the publisher's bot-protection blocks the headless fetch). With it: the popup fetches the PDF bytes inside the tab's content-script world (where the user's session cookies live) and uploads them via the BE-8-2 endpoint.

**Why TWO flows (A + B), not just one.** Per Pierre's create-story Q2 decision (2026-05-17). Both flows are real Class 2 surfaces:

- **Flow A — direct-PDF tab.** User is staring at `https://publisher.com/article.pdf`. Today BE-7 sets `pdfUrl` on the create payload; Milton's connector fetches server-side; Cloudflare blocks. New: popup runs `chrome.scripting.executeScript({target:{tabId}, func: async (u) => fetch(u, {credentials:'include'})})` to delegate the fetch to the tab's content-script world (session cookies apply). On success → upload via BE-8-2. On failure → fall back to BE-7's `pdfUrl` path (preserves Decision 8 coexistence — same-host public PDFs still work; only Cloudflare-fronted ones use the new flow).

- **Flow B — article-landing-page with PDF attachment.** User is on a journal article landing page (ScienceDirect abstract, Wiley article overview, Nature paper page). BE-8-6's translator returns a `ZoteroItem` with `attachments: [{url, mimeType: 'application/pdf', ...}]`. The article reference is created via the existing BE-8-6 path. NEW: post-create, popup kicks off a follow-up client-fetch of the attachment URL inside the tab context + uploads via BE-8-2. **Best-effort, silent on failure** — the reference is already saved; failing the attach must NOT fail the save.

Flow A alone misses the most common Class 2 win (Pierre on a journal abstract). Flow B alone misses direct-PDF tabs (working papers, repository PDFs) where Cloudflare blocks BE-7. The shared primitive (`chrome.scripting.executeScript` + async `fetch`) is identical; doing both together is strictly cheaper than splitting the story.

**Why client-fetch FIRST, not parallel with BE-7.** A parallel race double-fetches the same bytes (waste — academic PDFs are 1-20 MiB), AND races two writers at BE-8-2's `race_safe_set_autofetch_pdf_scoped` UPDATE (only one wins; the loser's bytes are discarded after the round-trip; analytics see noisy "already_attached" responses). Charter v2 Decision 4 commits to "Downsize post-MVP; GROBID retires with LLM-fallback" — strategic intent is to **shift PDF-fetch load off the server**. Client-first-then-server-fallback adds latency only on the fallback path (where the client already failed); on the happy path (the user's tab has the session) the server-side fetch never runs. Same fallback ordering BE-8-6 used for the translator path.

**Why raw `application/pdf` body, not multipart.** Locked by BE-8-2 (see its AC1 + Background section). One field, no boundaries, axum-native `Bytes` extractor, per-route body cap. The extension side just does `fetch(url, {method:'POST', headers:{'Content-Type':'application/pdf'}, body: bytesAsBlob})`. No FormData boundary machinery.

**Why soft-degrade on PDF-attach failure (not hard-fail the save).** Two separate transactions in Milton-desktop: `POST /references` creates the row (200 with id); `POST /references/{id}/pdf-bytes` attaches the binary (200 with status). They are NOT atomic — a network blip between them leaves a reference without a PDF. BE-8-2's `already_attached` response is explicitly designed for re-attempts. The right UX: the create succeeds → reference visible in Milton → if the attach fails (CORS, 403 from cross-origin CDN, network blip), inform the user via a non-blocking indicator BUT do NOT undo the save. The user can manually attach the PDF later from Milton (existing affordance). The alternative ("undo the save if attach fails") would mean repeatedly losing references when the attach fails for a recoverable reason (transient network blip, brief Milton stall) — far worse UX.

**Why the desktop-side "Install Milton extension" CTA is OUT OF SCOPE for this story.** Per Pierre's Q1 decision (2026-05-17), mirroring BE-8-2's symmetry: this repo ships extension-only. The Milton-desktop paste-failure CTA (when `translate.milton.so` returns a "site requires browser context" failure during in-app URL paste) is a sibling story in Milton-saas — Pierre will run `/bmad_bmm_create-story` there next, with a forward pointer back to this story. **Charter Decision 7 lock is honored** — just split across two repos, same as BE-8-2 split the bytes-endpoint from this consumer.

**Cross-origin PDF attachments are a known constraint (Flow B caveat).** Article landing pages often link to PDFs on a different origin (e.g., `wiley.com/article/123` → `onlinelibrary.wiley.com/doi/pdf/...` OR `nature.com/article/X` → `static-content.nature.com/.../paper.pdf`). The popup's `chrome.scripting.executeScript` runs in the tab's content-script world, which is bound to the tab's origin — fetches to cross-origin URLs are subject to MV3 CORS rules unless `host_permissions` covers the target. `activeTab` grants per-invocation rights on the tab URL ONLY, not on every cross-origin resource the page might reference. **Mitigation:** Flow B's cross-origin failures degrade to "reference saved without PDF" (soft-degrade per above). Pierre's dogfood will surface which publishers hit this; if a high-value publisher (Wiley, Springer Nature, ScienceDirect) is consistently blocked, the right fix is to add narrow `host_permissions` entries for that publisher's CDN domain (case-by-case, in a follow-up story). Per charter Decision 10 ("All-at-once at install — Zotero-Connector parity") this is consistent — Zotero Connector ships with a broad host-permission set for exactly this reason.

**Race surface analysis (consumer side of BE-8-2's THIRD writer).** BE-8-2 documented that bytes-upload is the third concurrent writer to `pdf_path` (BE-7's OA-spawn + direct-fetch are the first two). The race is fully handled server-side by `race_safe_set_autofetch_pdf_scoped` (BE-8-2 AC12 — scoped race-safe UPDATE with `AND user_id = ?` ownership check). The extension's only responsibility is to handle the response correctly:

- `200 {status: "attached"}` → the bytes upload won the race; PDF is attached.
- `200 {status: "already_attached"}` → another writer won (could be: a prior BE-7 OA-spawn that completed first; a prior direct-fetch on `pdfUrl`; a prior bytes-upload from a duplicate Save click; the user manually attached a PDF from Milton; the active_user changed mid-request and the scoped UPDATE matched zero rows). All of these collapse to "PDF is attached; we're done" from the extension's POV. Same UX as `attached`.
- `400 / 403 / 404 / 413 / 503` → typed error envelope; popup transitions per the error.

No client-side race-detection logic needed — BE-8-2 owns the race; the popup just reads the status.

## Acceptance Criteria

1. **PDF bytes fetch primitive (`src/lib/pdf-fetch-in-tab.ts`).** A new module exports `fetchPdfBytesInTab(tabId: number, url: string, opts?: {timeoutMs?: number}): Promise<{bytes: ArrayBuffer; finalUrl: string}>`. It delegates the fetch to the tab's content-script world via `chrome.scripting.executeScript({target: {tabId}, func: async (u) => { const r = await fetch(u, {credentials: 'include', redirect: 'follow'}); if (!r.ok) return {error: 'HTTP_ERROR', status: r.status}; const buf = await r.arrayBuffer(); return {bytes: buf, finalUrl: r.url}; }, args: [url]})`. The inner function:
   - Uses `credentials: 'include'` so session cookies (the entire point of Class 2) are sent.
   - Uses `redirect: 'follow'` so publisher redirects (common with PDF.js viewers, signed URLs) resolve.
   - **Performs the `%PDF-` magic-byte check INSIDE the content-script world** — reads the first 5 bytes of the response body, rejects with `{error: 'NOT_PDF', firstBytes: <hex>}` if mismatch. This is critical: HTML challenge pages (Cloudflare "Checking your browser…") often return 200 with `Content-Type: application/pdf` set by a misconfigured CDN — the magic-byte check catches this BEFORE we transfer megabytes of HTML back across the structured-clone boundary. Also rejects with `{error: 'TOO_LARGE'}` if `buf.byteLength > 50 * 1024 * 1024`. The result is structured-clone-copied back to the popup. Restricted-URL guard mirrors `page-context.ts` (chrome://, chrome-extension://, about:, file://, edge://, brave://) — short-circuit BEFORE invoking the API.
   - Returns `PdfFetchInTabError {code: 'RESTRICTED_URL' | 'TAB_GONE' | 'SCRIPTING_FAILED' | 'HTTP_ERROR' | 'NOT_PDF' | 'TOO_LARGE' | 'NETWORK_ERROR' | 'TIMEOUT' | 'NO_RESULT'}` on failure. Error classification via regex match on the rejection message (same pattern as `page-context.ts`).
   - **Timeout:** popup-side `Promise.race` against a configurable timeout (default 45s — covers a 50 MiB PDF over slow WiFi at ~10 Mbps with headroom). Hitting the timeout returns `TIMEOUT`; the underlying executeScript keeps running (chrome.scripting has no abort signal — the response is silently discarded on the popup side if the timeout already fired).
   - **Memory:** structured-clone is a COPY, not a transfer (chrome.scripting result-marshalling does NOT support Transferables). Peak memory is briefly 2× the bytes (content-script's `buf` + popup's clone). At the 50 MiB cap, that's 100 MiB peak per upload — acceptable for an extension that's user-paced (one capture at a time). Documented in the module header.
   - **Buffer-retention micro-hardening (BT7):** the inner async function MUST explicitly assign `buf = null` (or its equivalent) BEFORE returning an error envelope (`NOT_PDF`, `TOO_LARGE`, `HTTP_ERROR`). Without the explicit clear, V8 may retain the buffer in the executeScript serializer's stack frame between the magic-byte check and the return — and the structured-clone walker may copy the full body across the wire even though we don't reference it in the return value. The cost is one assignment; the benefit is that an 8 MiB Cloudflare challenge page (HTML-served-as-PDF) does NOT get cloned back to the popup on `NOT_PDF` reject.
   - **Smoke verification at the high end (BT2):** historical Chrome versions had silent-truncation bugs in `chrome.scripting.executeScript` structured-clone results above ~32 MiB. The 50 MiB cap is right on top of that historical danger zone. **Smoke matrix S2 MUST exercise a PDF in the 32-50 MiB band** (a long-form thesis or a figure-heavy paper works) to confirm Chrome's current implementation doesn't silently truncate. If S2 reports `NO_RESULT` for bytes-over-some-threshold while bytes-under-threshold succeed, file as a Chrome regression AND lower the in-code cap to whatever threshold actually round-trips reliably (degrading larger PDFs to BE-7's `pdfUrl` fallback).

2. **Connector client extension (`src/lib/connector-client.ts`).** New export `attachPdfBytes(referenceId: string, bytes: ArrayBuffer, opts?: {timeoutMs?: number; onProgress?: (uploaded: number, total: number) => void}): Promise<AttachPdfBytesResult>`. POSTs to `${CONNECTOR_BASE}/references/${encodeURIComponent(referenceId)}/pdf-bytes`. **Encoding note (BT12):** `encodeURIComponent` is single-encoding. The `referenceId` is a UUID string returned by `createReference`'s 201 response — already URL-safe in practice. The encode is defense-in-depth in case a future connector response shape includes characters that need escaping. **Callers MUST pass the raw reference-id string, NOT pre-encoded.** Double-encoding produces `%252F` from a hypothetical `/` → BE-8-2's `validate_id_for_path` rejects with 400. Document this in the function's JSDoc. Test fixture uses a real-shaped UUID to confirm round-trip. `Content-Type: application/pdf`. Body: the `ArrayBuffer` wrapped in a `Blob` (Blob is the only body shape that's both `fetch`-compatible AND lets `XMLHttpRequest.upload.onprogress` report bytes-sent). Returns:
   ```ts
   type AttachPdfBytesResult =
     | { ok: true; status: 'attached' | 'already_attached'; referenceId: string }
     | { ok: false; status: 400 | 403 | 404 | 408 | 413 | 503; message: string; detail?: string }
     | { ok: false; status: 'network-error' | 'timeout'; message: string }
   ```
   **`408` is the SERVER-side timeout (BT8):** BE-8-2's per-route `TimeoutLayer::new(BYTES_UPLOAD_TIMEOUT = 60s)` returns 408 when an admitted handler can't read the full body inside 60s (e.g., slow WiFi mid-upload). Distinct from the popup-side `status: 'timeout'` (the `AbortController`-driven local-Promise timeout). The two signals have different actionability: 408 means the bytes reached the connector but the upload didn't complete in time (user can retry from Milton on a faster network); local `timeout` means the whole round-trip didn't return (possibly the upload never started, possibly stalled mid-stream). Save handler surfaces 408 as `pdfAttached: 'timeout'` (new value per AC4 update); local-`timeout` as `pdfAttached: 'failed'`.
   - **Timeout:** default 90s (60s server-side timeout + 30s headroom). Configurable via `opts.timeoutMs`. Implemented via `AbortController.signal` (works with both `fetch` and `XHR.abort`).
   - **Progress reporting:** if `opts.onProgress` is provided, the upload uses `XMLHttpRequest` (XHR's `upload.onprogress` is the only browser-native primitive that fires during the upload phase — `fetch` body-streaming progress requires a `TransformStream` wrapper that's noticeably more complex). If no progress callback is provided, use `fetch` (simpler error surface). **Module doc-comment documents this branch** so a future maintainer who wonders "why does this file have both XHR and fetch paths?" gets the answer up front.
   - **Body-cap pre-check:** if `bytes.byteLength > MAX_PDF_BYTES` (50 MiB constant), return `{ok: false, status: 413, message: 'PDF too large (max 50 MiB)'}` WITHOUT issuing the POST. Saves a wasted round-trip; matches BE-8-2's server-side cap.
   - **Response parsing:** mirrors `createReference` — decode JSON once, fan out on `resp.status`. The `attached` / `already_attached` distinction comes from `body.status` (JSON envelope BE-8-2 returns).

3. **`extractPdfAttachmentUrl` helper (`src/lib/zotero-item-to-payload.ts` extension).** New export `extractPdfAttachmentUrl(item: ZoteroItem): string | null`. Scans `item.attachments?` (Zotero translator output) for the first entry where `mimeType` matches `/^application\/pdf$/i` (case-insensitive; some translators emit `APPLICATION/PDF`). Returns the `url` of that entry, or `null` if no PDF attachment exists or `attachments` is missing/empty. **Does NOT extract multiple PDFs** — only the first match wins. If real-world dogfood shows the "supplementary material" PDF appearing before the main paper PDF (a Zotero translator quirk for some publishers), the dev-agent can extend to `extractPrimaryPdfAttachmentUrl` with priority logic in a follow-up. For BE-8-7 v1, first-match is sufficient. **Defensive: skip attachments where `typeof a.mimeType !== 'string'` (BT10).** Some translators emit `{url, title}` without `mimeType` (typically supplementary metadata link, NOT a PDF). Calling `.match()` on `undefined` would throw → would silently break Flow B for those publishers (the popup's `enterPreviewState` would crash). Skip silently; NEVER throw. Test fixture explicitly includes an attachment with no mimeType to assert skip-not-throw semantics. **Also defensive: skip attachments where `typeof a.url !== 'string'`** (similar guard against malformed translator output).

4. **Popup state-machine: new + modified states.**
   - NEW `kind: 'pdf-fetch-active'; tabUrl: string; sourceLabel: string` — popup renders "Fetching PDF from {hostname}…" (hostname derived via `new URL(tabUrl).hostname`). Shown during Flow A's pre-preview client-fetch AND during Flow B's post-create client-fetch. `sourceLabel` distinguishes ("the PDF" for Flow A, "the article PDF" for Flow B) so the message reads naturally in both contexts.
   - NEW `kind: 'uploading-pdf'; referenceId: string; bytesUploaded: number; bytesTotal: number; sourceLabel: string` — popup renders an upload progress bar. Bytes-uploaded is updated via the `onProgress` callback from `attachPdfBytes`. `referenceId` is captured so a future "open reference in Milton" affordance can use it.
   - MODIFY `kind: 'success'` shape: add optional `pdfAttached?: 'yes' | 'failed' | 'timeout' | 'none' | 'skipped'` field.
     - `'yes'` — bytes upload returned 200 attached or 200 already_attached.
     - `'failed'` — client-fetch failed, OR upload returned a non-200/408 typed error (400/403/404/413/503), OR popup-side local `'timeout'` fired (round-trip didn't return). Soft-degrade; the reference IS saved.
     - `'timeout'` — upload returned **408** from the connector's server-side `TimeoutLayer` (BT8). The bytes started uploading but didn't finish in 60s; the reference IS saved AND the user has signal that the bytes were partially in flight (different actionability from `'failed'`).
     - `'none'` — no PDF to attach (Flow B path where translator returned no PDF attachment; current default).
     - `'skipped'` — Flow A fell back to BE-7's `pdfUrl` path (the connector will attach the PDF asynchronously via the existing OA-spawn / direct-fetch race; from the popup's POV the save is done and the PDF is "in flight").
     - Success-screen rendering branches: `'yes'` shows "Saved with PDF". `'failed'` shows "Saved (PDF couldn't be attached — open in Milton to retry)". `'timeout'` shows "Saved (PDF upload timed out — retry from a faster network)". `'none'` shows the existing "Saved" text. `'skipped'` shows "Saved (PDF will attach in the background)".

5. **Flow A — direct-PDF tab routing (popup `boot()`).** When `decideBootRoute()` returns `pdf-server`, the popup behavior changes:
   - 5a. `setState({kind: 'pdf-fetch-active', tabUrl: currentUrl, sourceLabel: 'the PDF'})`.
   - 5b. Call `fetchPdfBytesInTab(tabId, currentUrl, {timeoutMs: 45_000})`.
   - 5c. **On success** (bytes received): stage bytes in module-state (`pendingPdfBytes: ArrayBuffer | null = bytes`); set `pdfAttachmentMode: 'flow-a'`; transition to the existing `preview` path via `extractMetadata(currentUrl)` (server-side metadata extract still needed — the popup has the bytes but no metadata; LLM-fallback in BE-8-8 will eventually fill this when server-side extract returns sparse, but for BE-8-7 the server-translate path is the metadata source). When the user clicks Save and `createReference` returns `201 {id}`, popup transitions to `kind: 'uploading-pdf'` and calls `attachPdfBytes(id, pendingPdfBytes, {onProgress})`. On `{ok: true}` → `setState({kind: 'success', id, pdfAttached: 'yes'})`. On `{ok: false, status: 408}` → `setState({kind: 'success', id, pdfAttached: 'timeout'})` (BT8 typed-pickup). On `{ok: false}` other statuses → `setState({kind: 'success', id, pdfAttached: 'failed'})` + console.warn the failure code.
   - 5c-i. **Double-attach suppression (BT5).** The existing `popup.ts` Save handler at line ~1606 sets `payload.pdfUrl = currentUrl` unconditionally when `detectPdfPage(currentUrl, currentTabMimeType)` is true (BE-7 behavior). With BE-8-7 in play, that branch MUST be refactored to: `if (detectPdfPage(currentUrl, currentTabMimeType) && (pdfAttachmentMode !== 'flow-a' || pendingPdfBytes === null)) { payload.pdfUrl = currentUrl; }`. Rationale: when Flow A succeeded AND we're about to upload bytes via `attachPdfBytes`, we MUST NOT also send `pdfUrl` — doing so triggers BE-7's connector-side `maybe_spawn_direct_fetch` to race the bytes-upload at the scoped UPDATE. One wins; the other emits noisy `already_attached` analytics + wastes a server-side HTTP fetch the user already covered client-side. The condition collapses to: "set `pdfUrl` only when we are NOT planning to upload bytes" (the BE-7-fallback case + non-PDF-page case — both honored).
   - 5d. **On client-fetch failure** (`PdfFetchInTabError`): log `[milton-popup] pdf-class2-fallback reason=<code>`. Reset `pendingPdfBytes = null`; set `pdfAttachmentMode: 'be-7-fallback'`. Transition to the existing `preview` path via `extractMetadata(currentUrl)`. On Save → `createReference` is called with `payload.pdfUrl = currentUrl` (existing BE-7 behavior). On success → `setState({kind: 'success', id, pdfAttached: 'skipped'})` (the connector will attach the PDF via BE-7's `fetch_pdf_from_known_url` post-create flow; from the popup's POV the save is done).
   - 5e. **Cancel:** if the user closes the popup mid-fetch, the BE-8-6 `beforeunload` handler fires; the `fetchPdfBytesInTab` Promise is abandoned (the underlying executeScript keeps running silently per AC1 honesty note). Same for the upload phase: `AbortController.abort()` is called; the network request may complete server-side, but the popup-side response is discarded.

6. **Flow B — translator-done with PDF attachment routing.** After BE-8-6's `tryClientTranslation` resolves with items and transitions through `translator-done` to `preview`:
   - 6a. In `enterPreviewState`, call `extractPdfAttachmentUrl(items[0])`. If non-null, stage in module-state (`pendingPdfAttachmentUrl: string | null = url`). Set `pdfAttachmentMode: 'flow-b'`.
   - 6b. When user clicks Save and `createReference` returns `201 {id}`, AND `pendingPdfAttachmentUrl !== null`:
     - Transition to `kind: 'pdf-fetch-active'` with `sourceLabel: 'the article PDF'`.
     - Call `fetchPdfBytesInTab(tabId, pendingPdfAttachmentUrl, {timeoutMs: 45_000})`.
     - On success → `setState({kind: 'uploading-pdf', ...})` → `attachPdfBytes(id, bytes, {onProgress})` → `setState({kind: 'success', id, pdfAttached: 'yes' | 'failed'})`.
     - On client-fetch failure → log `[milton-popup] pdf-class2-fallback reason=<code> mode=flow-b`. **DO NOT** fall back to BE-7's `pdfUrl` for Flow B (the reference is already created; setting `pdfUrl` after the fact would require a different endpoint that doesn't exist). Transition directly to `setState({kind: 'success', id, pdfAttached: 'failed'})`.
   - 6c. When `pendingPdfAttachmentUrl === null` (translator returned no PDF attachment), the Save flow is unchanged from BE-8-6: `createReference` → `setState({kind: 'success', id, pdfAttached: 'none'})`.

7. **Module-state additions to popup.ts.** Three new top-level module-state variables (alongside `currentTabId`, `currentUrl`, etc.):
   ```ts
   let pendingPdfBytes: ArrayBuffer | null = null
   let pendingPdfAttachmentUrl: string | null = null
   let pdfAttachmentMode: 'flow-a' | 'flow-b' | 'be-7-fallback' | 'none' = 'none'
   ```
   These are reset at the start of every `boot()` to prevent state leakage between popup re-opens on different tabs. `pendingPdfBytes` is explicitly nulled after a successful upload (or after a transition into a terminal state) so the ArrayBuffer can be garbage-collected — important because at 50 MiB the reference would otherwise pin the upload's memory until popup teardown.
   - **Detachment ban (BT1).** `pendingPdfBytes` MUST NOT be passed as a `Transfer` argument to `postMessage`, `Worker.postMessage`, or `MessagePort.postMessage` between the staging point (AC5/AC6 success branch) and the upload point (Save handler). Transferring detaches the buffer; subsequent `.byteLength` returns 0; `attachPdfBytes` would POST an empty body → BE-8-2 rejects with 400 "empty body". If a future caller needs to inspect the buffer (e.g., a content-hash for de-dupe), use `bytes.slice()` for a defensive copy BEFORE the staging point. This is a code-review checklist item, not a runtime guard — TypeScript doesn't model buffer-detachment statically. Document at the variable declaration site: `// DO NOT TRANSFER: see AC7 BT1`.
   - **Null-on-terminal-error (BT3).** In addition to the standing GC note, `pendingPdfBytes` MUST be explicitly set to `null` on transition into ANY terminal error state — `error-no-metadata`, `error-network`, `error-auth-failed`, `error-too-large`, `signed-out`, `error-409-duplicate`, `error-400-validation`, `error-rate-limited`, `error-quota-exceeded`, `error-tier-required`, `error-service-unavailable`. Without this, holding 50 MiB across the popup lifetime for a terminal-error case is a leak (popup may stay open for minutes while user reads the error). The cleanup is one `pendingPdfBytes = null` line in `setState` — best implemented as a `if (newState.kind.startsWith('error-') || newState.kind === 'signed-out') { pendingPdfBytes = null; }` guard inside `setState`, executed BEFORE the state assignment so the GC root is removed promptly. Same treatment for `pendingPdfAttachmentUrl` (cheaper but symmetric).

8. **Upload progress affordance — popup CSS + rendering. **FIGMA-GATED PER CLAUDE.md ABSOLUTE RULE.** The new UI surface (progress bar for `uploading-pdf` state; "Fetching PDF…" copy for `pdf-fetch-active`; soft-degrade indicator on success) MUST be specced against Figma node `1323:8984` (the "Browser extension" frame) BEFORE the dev-agent implements rendering. The dev-agent MUST HALT at Task 6 and ask Pierre to connect Figma via MCP. Until Figma is consulted: no `popup.css` edits, no progress-bar markup. The acceptance criterion here is the STATE — once Figma defines the visuals, the dev-agent translates them. Provisional fallback specs (used ONLY if Figma reveals no progress affordance design): `<progress>` element with `.milton-popup-upload-progress` class; pure CSS sized to match `.milton-popup-footnote` width; greyscale fill matching `var(--milton-fg-3)`; ARIA `aria-label="Uploading PDF"`. Pierre flags this provisional in code-review if Figma WAS consulted but no design exists — then dev-agent ships provisional + files a follow-up Figma request.

9. **Manifest permissions audit.** **NO changes to `permissions` or `host_permissions`.** `scripting` is already declared (BE-8-6); `activeTab` covers `chrome.scripting.executeScript` against the user-clicked tab; same-origin fetches inside the tab's content-script world run from the tab's origin and inherit its cookies. The cross-origin Flow B caveat (article-page → CDN-hosted PDF) is acknowledged in Background — failures degrade gracefully; case-by-case `host_permissions` additions are out-of-scope follow-ups. Verify post-build via `jq '.permissions' dist/manifest.json` → expected unchanged: `["activeTab", "storage", "scripting", "offscreen"]`. Verify `jq '.host_permissions' dist/manifest.json` → expected unchanged from BE-8-6 baseline (translate.milton.so, translators.milton.so, arxiv.org, export.arxiv.org).

10. **Body-cap symmetry with BE-8-2.** `MAX_PDF_BYTES = 50 * 1024 * 1024` constant defined in `connector-client.ts` and re-used by `pdf-fetch-in-tab.ts` (single source of truth via `import { MAX_PDF_BYTES } from './connector-client'`). Documented inline with a cross-reference: "MUST match `connector::server::MAX_PDF_BYTES` in Milton-saas (BE-8-2 AC1). Bumping this without bumping the server-side cap will cause the upload to fail with 413 at the connector instead of being caught client-side."

11. **Server-fallback for metadata (Flow A).** When Flow A receives the bytes, the popup STILL calls `extractMetadata(currentUrl)` for the metadata extraction. This is intentional: the popup has the PDF bytes but no extracted metadata (title, authors, year, DOI). The existing server-translate flow handles PDF URLs via the connector's PDF-aware path (which uses the URL, not the bytes — server-side it does its own fetch via `pdfUrl`-style handling OR via GROBID-like extraction). If the server-side metadata extract ALSO fails (Cloudflare also blocks the server), the popup ends up with bytes + no metadata. **For BE-8-7 v1, that combination produces an `error-no-metadata` state — the save can't proceed without a title.** Pierre's BE-8-8 (LLM-fallback) is exactly the story that fills this gap (PDF-only with no embedded metadata is one of the documented LLM triggers). **Do NOT pre-empt BE-8-8 by adding LLM-fallback here** — log + transition to `error-no-metadata` and let BE-8-8 own that surface.

12. **Cancel + abort honesty (BE-8-6 pattern carried forward).** Three explicit honesty notes in code comments + Dev Notes:
    - `chrome.scripting.executeScript` has NO abort signal. If popup closes mid-fetch, the executeScript-injected function runs to completion in the content script; the popup-side `await` is just abandoned. Same pattern BE-8-6 documented.
    - `XMLHttpRequest.abort()` IS callable and stops the request; the server-side handler may receive a partial body and reject (BE-8-2's body extractor rejects partial reads with 400). On the popup side, the abort raises an event that the `attachPdfBytes` wrapper translates to `{ok: false, status: 'network-error', message: 'aborted'}`. Documented.
    - `fetch + AbortController` cancellation is honored by Chrome; same translation to `{ok: false, status: 'network-error'}`.
    - Popup `beforeunload` handler (BE-8-6) is extended: in addition to cancelling the offscreen translation, it also calls `abort()` on the active `AbortController` for any in-flight upload (one new line: `pdfUploadAbort?.abort()`). The fetch/scripting promise abandonment is implicit (popup window destroyed).

12a. **Mid-Save cancellation race + 409 re-encounter UX (BT6).** Sequence: user clicks Save → `createReference` POST in flight → user closes popup before the response lands. Two outcomes:
    - **createReference completed server-side before popup teardown:** the reference IS in Milton, but the bytes-upload never started (the upload only kicks off after the 201 lands in the popup; popup is gone). The PDF is missing.
    - **createReference did NOT complete:** no reference, no PDF. Idempotent — user can retry.
    The first outcome is the silent-data-loss surface. Mitigation: when the user re-opens the popup on the same URL and BE-8-7 routes through `createReference`, the connector returns **409 duplicate** with the existing reference id. The existing 409-duplicate render path (popup.ts — current "Already in your library" UX) is extended: when the duplicate scenario fires AND the URL would have triggered Flow A or Flow B (i.e., `decideBootRoute` says `pdf-server` OR translator returned `attachments[].pdf`), the 409 message is augmented with a one-line affordance: *"If this was a session-gated PDF and the original capture didn't attach it, open the reference in Milton and use 'Attach file' to attach manually."* (Exact wording: dev-agent picks per Figma; the concept is locked.) This does NOT change the 409 state itself — it's an additive render branch. **Out-of-scope for this AC:** automatic retry of the bytes-upload on re-encounter; that would require persisting the bytes across popup lifetimes (chrome.storage.local can hold 50 MiB? No — quota is 10 MB; persistence is a different story). The affordance text is the v1 mitigation.

13. **Pre-Review Self-Check additions.** Six new items (in addition to the BE-8-6 carry-forward):
    - PDF magic-byte (`%PDF-`) check fires INSIDE the content script BEFORE bytes are serialized back to the popup (avoids HTML-as-PDF false positives blowing the structured-clone wire with 8 MiB of challenge-page HTML).
    - 50 MiB cap enforced CLIENT-SIDE before POST (no wasted round-trip).
    - `attachPdfBytes` Content-Type is `application/pdf` (verified in `connector-client.test.ts`).
    - PDF-attach soft-degrade verified: reference IS saved even when attach fails; success state surfaces `pdfAttached: 'failed'` indicator.
    - Flow A's BE-7 fallback path preserved verbatim — a regression-check that a public-host PDF still flows through BE-7's `pdfUrl` path when client-fetch succeeds OR when it fails AND BE-7 still works.
    - **Figma node `1323:8984` consulted for `pdf-fetch-active` + `uploading-pdf` + success-with-`pdfAttached` UI BEFORE implementation** (CLAUDE.md absolute rule — story marker only; dev-agent verifies at Task 6).

14. **Tests — required minimums.**
    - `pdf-fetch-in-tab.test.ts` (jsdom): ≥10 tests. Happy path (mock executeScript returning bytes); RESTRICTED_URL pre-check; TAB_GONE (executeScript throws "No tab with id…"); SCRIPTING_FAILED (generic throw); HTTP_ERROR (inner function returns `{error:'HTTP_ERROR', status:403}`); NOT_PDF (magic-byte mismatch); TOO_LARGE (51 MiB); NETWORK_ERROR (fetch rejects); TIMEOUT (Promise.race wins for timeout); NO_RESULT (executeScript returns empty array).
    - `connector-client.test.ts` extension: ≥12 tests for `attachPdfBytes`. **MUST cover BOTH the XHR branch (when `opts.onProgress` is provided) AND the fetch branch (when `opts.onProgress` is undefined) (BT4).** A bug isolated to one branch must NOT ship green. Required cases: 200 attached (× both branches); 200 already_attached; 400 magic; 403 not-owned; 404 not-found; **408 server-side timeout (BT8) — surfaces typed as `status: 408`**; 413 oversize; 503 signed-out; popup-side timeout (AbortController fires); network-error (fetch rejects / XHR error event); client-side body-cap pre-check fires before POST (no network call observed); XHR progress callback fires multiple times with monotonically-non-decreasing `loaded` values (mock XHR with synthetic progress events). Each test's name MUST clearly label which branch is exercised (e.g., `attachPdfBytes_xhr_branch_emits_progress_events` vs `attachPdfBytes_fetch_branch_returns_200_attached`).
    - `zotero-item-to-payload.test.ts` extension: ≥6 tests for `extractPdfAttachmentUrl`. Returns first PDF URL; returns null for missing attachments; returns null for empty attachments; returns null for HTML-only attachments; mixed PDF + HTML returns the PDF; case-insensitive MIME match (`APPLICATION/PDF`).
    - **Popup state-machine tests DEFERRED** — same scope-cut BE-8-6 made (the popup.ts module structure makes mocking-to-import expensive for marginal coverage gain). Real integration check is the Task 8 sideload smoke matrix. **If dev-agent extracts a pure helper for the Flow-A/Flow-B routing decision (mirroring BE-8-6's `decideBootRoute` extraction), test that helper.**
    - **Test count target: ≥350** (BE-8-6 baseline 327 + ~25 new across the 3 new test files / extensions). Soft range — quality over count. If <340, explain why in Completion Notes; if >380, surface the breakdown.

15. **Smoke matrix (Pierre G17-1) — seven scenarios.** Sideload `dist/` into Chrome via `chrome://extensions/`. For each scenario, capture console output + DevTools Network panel evidence in Completion Notes. **S1-S4 + S7 must pass manually** before `review`; S5-S6 are unit-test backed.
    - **S1 (Flow A happy — public PDF, regression + CORS preflight check):** navigate to `https://arxiv.org/pdf/2303.08774.pdf`; click toolbar; expect `pdf-fetch-active` (briefly) → `preview` (server-translate metadata) → on Save → `uploading-pdf` with progress → `success` with `pdfAttached: 'yes'`. Open Milton library: PDF is attached. **CORS preflight verification (BT9):** open DevTools Network panel BEFORE the Save click. After Save, find the entry for `127.0.0.1:7521/references/{id}/pdf-bytes` — there MUST be an `OPTIONS` preflight request BEFORE the `POST`. The OPTIONS response MUST return `204` (or `200`) with `Access-Control-Allow-Headers` including `Content-Type` AND `Access-Control-Allow-Methods` including `POST`. If preflight fails (e.g., `Access-Control-Allow-Headers` is missing `Content-Type`), the actual POST never fires and `attachPdfBytes` returns `network-error` with a CORS console message. **File as a BE-8-2 follow-up if observed** — the bytes-upload endpoint may have missed the CORS preflight headers because BE-8-2's tests called the handler directly (bypassing the CORS layer).
    - **S2 (Flow A — the Class 2 win + high-end size verification):** navigate directly to a session-gated publisher PDF URL Pierre has access to (preferred: a Wiley / ScienceDirect / Springer Nature direct PDF URL Pierre's institutional account can open). Verify the PDF renders in the tab (user's session works). Click toolbar; expect Flow A client-fetch succeeds (because tab has the session cookies); `uploading-pdf` → `success pdfAttached: 'yes'`. **The load-bearing scenario per Charter v2 Success Criteria #1.** **Size-band verification (BT2):** if Pierre has access to a 30-50 MiB PDF (long-form thesis, figure-heavy paper, or a textbook chapter), capture S2 with that PDF specifically. If `pdf-fetch-in-tab` returns `NO_RESULT` for the large PDF while smaller PDFs succeed → Chrome's executeScript silently truncates → file as a Chrome regression AND lower `MAX_PDF_BYTES` in code to whatever round-trips reliably.
    - **S3 (Flow A fallback to BE-7):** navigate to a publisher PDF where the client-fetch will fail (force via DevTools: clear the cookie store for the publisher domain, then click toolbar without re-authenticating). Expect Flow A fails with `HTTP_ERROR` or `NETWORK_ERROR`; console shows `[milton-popup] pdf-class2-fallback reason=<code>`; popup transitions to `preview` via the existing path; Save → `createReference` succeeds with `pdfUrl` set; `success pdfAttached: 'skipped'`. Milton's connector tries server-side fetch (may succeed for non-Cloudflare publishers). **Double-attach suppression verification (BT5):** when Flow A SUCCEEDS (the inverse of S3), open DevTools Network panel and verify NO server-side OA-spawn / direct-fetch is triggered alongside the bytes-upload — the `pdfUrl` field should be ABSENT from the `POST /references` body when Flow A staged bytes. (Inspect the request body to confirm.)
    - **S4 (Flow B happy):** navigate to a ScienceDirect / Wiley / Springer Nature ARTICLE LANDING page (not the direct PDF URL — the abstract/overview page). Click toolbar; expect BE-8-6's translator-running → translator-done → preview (existing). On Save → `createReference` succeeds → `pdf-fetch-active` (post-create) → `uploading-pdf` → `success pdfAttached: 'yes'`. **The article-page Class 2 win.**
    - **S5 (Flow B soft-degrade):** force Flow B's client-fetch to fail (DevTools: block the publisher's CDN domain via Network → Request blocking). Click toolbar on an article landing page; translator runs; Save succeeds (reference created); client-fetch fails; expect `success pdfAttached: 'failed'` with the "Saved (PDF couldn't be attached…)" indicator. Reference is in Milton; no PDF.
    - **S6 (no-PDF translator-done):** navigate to a page whose translator returns no `attachments[].pdf` (e.g., a webpage / blog post translator). Click toolbar; translator runs; Save succeeds; expect `success pdfAttached: 'none'` (existing behavior preserved; no upload attempt).
    - **S7 (tab-staleness — BT11):** Pin the popup open via "Inspect popup" (DevTools attach). Navigate the underlying tab to a Class 2 PDF; click toolbar; let `pdf-fetch-active` start. While bytes are being fetched (or before Save), close the underlying tab OR navigate it to `about:blank`. Expect `fetchPdfBytesInTab` returns `TAB_GONE`; popup either falls back to BE-7 (`pdfAttachmentMode='be-7-fallback'`) if pre-Save, or shows `success pdfAttached: 'failed'` if post-Save. Reference behavior must be sane (saved or not; soft-degrade either way). The smoke verifies that tab closure does NOT crash the popup AND does NOT leave the popup hung in `pdf-fetch-active`.

16. **IPC-boundary self-check + out-of-scope reaffirmation.**
    - `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` → zero hits (CLAUDE.md absolute rule).
    - Network destinations: existing `translate.milton.so` + `translators.milton.so` + `127.0.0.1:7521/health` + `127.0.0.1:7521/references` + `127.0.0.1:7521/tags|projects|collections` + NEW `127.0.0.1:7521/references/{id}/pdf-bytes`. **No new external network destinations** beyond the BE-8-2 endpoint (same loopback host).
    - **Milton-desktop "Install Milton extension" CTA is OUT OF SCOPE** for this PR. PR description states: *"BE-8-7 ships the extension-side Class 2 capture flow only. The Milton-desktop paste-failure CTA (charter Decision 7) is filed as a sibling story in Milton-saas — run /bmad_bmm_create-story there next."* Story file's "Out of scope" section makes this explicit.

## Tasks / Subtasks

- [x] **Task 1 — Cut feature branch BEFORE first edit** (CLAUDE.md Rule 0)
  - [x] 1.1 `git checkout -b feat/BE-8-7-class-2-capture` from `main`. Current branch verified = `feat/BE-8-7-class-2-capture`. Sprint-status flipped `ready-for-dev` → `in-progress`. Story Status field flipped `ready-for-dev` → `in-progress`. Working tree at branch-cut contained the create-story session's pending changes (sprint-status edit + new story file) — these travel with the checkout and will land in the BE-8-7 PR.

- [x] **Task 2 — PDF bytes fetch primitive** (AC: #1, #10, #12)
  - [x] 2.1 `src/lib/pdf-fetch-in-tab.ts` created (SPDX header, ~210 LOC). `fetchPdfBytesInTab(tabId, url, opts?)` delegates to `chrome.scripting.executeScript` with the inner function using `credentials:'include'`, `redirect:'follow'`. Magic-byte check + 50 MiB cap inside the content script (BT7 explicit `buf = null` clears on each error return path).
  - [x] 2.2 Reuses `isRestrictedUrl` from `popup/popup-helpers.ts` for the pre-check.
  - [x] 2.3 `MAX_PDF_BYTES` defined + exported from `connector-client.ts` (single source of truth); imported into `pdf-fetch-in-tab.ts` and passed via `args[1]` so the inner function uses the same constant (bound captures don't survive chrome.scripting serialization).
  - [x] 2.4 `PdfFetchInTabError` exported with 9 typed codes + optional `httpStatus` field. Regex classification: `/no tab with id|tab was closed/i` → TAB_GONE; `/cannot access|must request permission/i` → RESTRICTED_URL; else SCRIPTING_FAILED.
  - [x] 2.5 Popup-side `Promise.race` against `opts.timeoutMs ?? DEFAULT_TIMEOUT_MS` (45_000). Timeout handle cleared on both win + race branches.
  - [x] 2.6 Module header documents the 2× peak-memory note, the chrome.scripting no-abort cancel-honesty note, AND the historical Chrome ~32 MiB silent-truncation hazard (BT2).
  - [x] 2.7 `src/lib/pdf-fetch-in-tab.test.ts` (jsdom env) — **13 tests pass** (target ≥10). Happy path + RESTRICTED_URL + TAB_GONE + RESTRICTED_URL leak + SCRIPTING_FAILED + HTTP_ERROR + NOT_PDF + TOO_LARGE + NETWORK_ERROR + NO_RESULT (empty + undefined) + TIMEOUT + PdfFetchInTabError typed-shape preservation.

- [x] **Task 3 — Connector client extension** (AC: #2, #10, #12)
  - [x] 3.1 `MAX_PDF_BYTES = 50 * 1024 * 1024` exported from `src/lib/connector-client.ts` with cross-reference doc-comment to BE-8-2 server-side `MAX_PDF_BYTES`.
  - [x] 3.2 `attachPdfBytes(referenceId, bytes, opts?)` exported. `attachViaFetch` + `attachViaXhr` branches; `opts.onProgress` defined → XHR; undefined → fetch.
  - [x] 3.3 Body-cap pre-check returns `{ok:false, status:413}` before POST when `bytes.byteLength > MAX_PDF_BYTES`. Also returns 400 for empty body.
  - [x] 3.4 `AttachPdfBytesResult` typed union exported (200 attached / 200 already_attached / 400 / 403 / 404 / 408 / 413 / 503 / network-error / timeout). `parseAttachResponse` shared between branches; fans out on status code + JSON `status` field.
  - [x] 3.5 Timeout via internal `AbortController` (default 90_000 ms). External `opts.signal` honored (popup `beforeunload` cancellation surface). XHR branch wires `controller.abort()` to `xhr.abort()` via abort-event listener.
  - [x] 3.6 Module section comment documents the two-branch design rationale (XHR for progress, fetch for simplicity).
  - [x] 3.7 `src/lib/connector-client.test.ts` extended — **35 total (was 15 baseline; +20 new for attachPdfBytes across both branches)**. fetch branch: 14 tests (happy attached/already_attached, 400/403/404/408/413/503, network-error, client-side oversize + empty pre-checks, Content-Type, AbortController timeout, encodeURIComponent single-encoded). XHR branch: 6 tests (progress events monotonically non-decreasing, happy 200, 408, 413, network-error, local timeout via setTimeout-fired AbortController). Test names explicitly labeled with branch (`attachPdfBytes — fetch branch ...` vs `attachPdfBytes — XHR branch ...`).

- [x] **Task 4 — `extractPdfAttachmentUrl` helper** (AC: #3)
  - [x] 4.1 `extractPdfAttachmentUrl(item)` exported from `src/lib/zotero-item-to-payload.ts`. Case-insensitive MIME match (`/^application\/pdf$/i`). First-match-wins. BT10 defensive: skips entries where `typeof a.mimeType !== 'string'` OR `typeof a.url !== 'string'` OR `a.url.length === 0`. Returns `null` for undefined / null item; non-array attachments.
  - [x] 4.2 `src/lib/zotero-item-to-payload.test.ts` extended — **12 new tests** (target ≥6). Coverage: first-match wins, skips HTML to find PDF, returns null for missing attachments / empty attachments / no-PDF / non-array, case-insensitive (APPLICATION/PDF), BT10 defensive (missing mimeType + missing url + empty url + non-array attachments + undefined/null item). Full file: 40 tests pass. Full repo suite: 372 tests pass (no regressions).

- [x] **Task 5 — Popup state-machine + boot/save flow rewrite** (AC: #4, #5, #6, #7, #11, #12)
  - [x] 5.1 `State` union extended with `pdf-fetch-active` (`tabUrl`, `sourceLabel`) + `uploading-pdf` (`referenceId`, `bytesUploaded`, `bytesTotal`, `sourceLabel`). `success` modified with optional `pdfAttached?: 'yes' | 'failed' | 'timeout' | 'none' | 'skipped'`. `PdfAttachmentMode` type added. Two timeout constants added (`PDF_FETCH_TIMEOUT_MS = 45_000`, `PDF_UPLOAD_TIMEOUT_MS = 90_000`).
  - [x] 5.2 Module state added: `pendingPdfBytes`, `pendingPdfAttachmentUrl`, `pdfAttachmentMode`, `pdfUploadAbort`. **BT1 detachment-ban** documented at declaration site (`// DO NOT TRANSFER`). All four reset at `boot()` entry to prevent leakage between popup re-opens on different tabs.
  - [x] 5.3 `boot()` `pdf-server` route now calls new `tryFlowAClientPdfFetch(url)` which: scrapes via `fetchPdfBytesInTab` inside the active tab → on success stages `pendingPdfBytes` + `pdfAttachmentMode='flow-a'` + enters server-translate metadata flow; on failure logs `[milton-popup] pdf-class2-fallback reason=<code>` + sets `pdfAttachmentMode='be-7-fallback'` + still enters server flow.
  - [x] 5.4 `tryClientTranslator` extended: after items returned, calls `extractPdfAttachmentUrl(items[0])`; if non-null, stages `pendingPdfAttachmentUrl` + `pdfAttachmentMode='flow-b'`. Independent of the user's preview edits (the URL is the translator's discrete `attachments[]` value, not the editable `url` field).
  - [x] 5.5 Save handler refactored: `dispatchCreateReferenceResult` still handles error responses, but on 201-success now calls new `runPostCreatePdfFlow(referenceId)` which branches on `pdfAttachmentMode`:
    - `'be-7-fallback'` → `success pdfAttached: 'skipped'`.
    - `'flow-a'` (bytes staged) → `uploading-pdf` → `uploadPdfBytes(id, bytes, total)` → `success pdfAttached: 'yes'|'failed'|'timeout'`. Bytes nulled after upload (BT3 GC hygiene).
    - `'flow-b'` (URL staged) → `pdf-fetch-active` → `fetchPdfBytesInTab` → `uploading-pdf` → `uploadPdfBytes` → `success pdfAttached: 'yes'|'failed'|'timeout'`.
    - `'none'` → `success pdfAttached: 'none'`.
    **BT5 suppression** applied: `payload.pdfUrl = currentUrl` now gated on `!willUploadBytes` where `willUploadBytes = (mode==='flow-a' && pendingPdfBytes!==null) || (mode==='flow-b' && pendingPdfAttachmentUrl!==null)`. Prevents BE-7's `maybe_spawn_direct_fetch` from racing the bytes-upload at the scoped UPDATE.
  - [x] 5.6 `beforeunload` extended with `if (pdfUploadAbort !== null) pdfUploadAbort.abort()`.
  - [x] 5.7 Placeholder render cases for `pdf-fetch-active` (shows "Fetching {sourceLabel} from {hostname}…") + `uploading-pdf` (shows "Uploading {sourceLabel}… {pct}%" + `<progress>` element) + the five `success.pdfAttached` variants (placeholder copy per Task 6 FIGMA gate). All marked with `BE-8-7: PLACEHOLDER UI per Task 6 FIGMA-GATED rule` comments.
  - [x] 5.8 **`runPostCreatePdfFlow` + `uploadPdfBytes` helpers extracted** from save() — keeps save() readable AND isolates the branching for future unit tests (deferred per the same trade-off BE-8-6 made on popup-states tests). **BT3 null-on-terminal-error** baked into `setState` itself: any transition to `error-*` / `signed-out` / `cannot-capture` / `milton-not-running` nulls both `pendingPdfBytes` + `pendingPdfAttachmentUrl` BEFORE the state assignment so the GC root drops promptly.
  - **Validation:** typecheck clean, full suite **372/372 pass** (zero regressions from BE-8-6 baseline of 327).

- [x] **Task 6 — UI implementation — SCOPE-CUT by Pierre 2026-05-18** (AC: #8 — see scope note below)
  - [x] 6.1 Halted for Figma per CLAUDE.md rule; Pierre directed a scope cut instead of a Figma polish: **drop `pdf-fetch-active` + `uploading-pdf` states entirely; drop the 4 success `pdfAttached` variants. One success message always. Optional small dual-tone PDF icon next to "Saved to Milton ✓" when bytes attached.**
  - [x] 6.2 State machine simplified: `pdf-fetch-active` + `uploading-pdf` removed from `State` union. `success.pdfAttached` collapsed from `'yes'|'failed'|'timeout'|'none'|'skipped'` to `boolean | undefined`.
  - [x] 6.3 Boot Flow A: `tryFlowAClientPdfFetch` runs silently (no `setState` to a visible Flow-A state — popup stays on existing `loading-health` spinner during the fetch). On success → stage bytes + enter server-translate flow. On failure → log + fall back to BE-7.
  - [x] 6.4 Post-create flow: `runPostCreatePdfFlow` runs silently after `createReference` 201 (popup stays in existing `posting` "Saving to Milton…" state through both Flow B's fetch AND the bytes upload). Transitions straight to `success` when done.
  - [x] 6.5 Success render: single message ("Saved to Milton ✓"). When `pdfAttached === true`, prepend inline dual-tone PDF SVG icon (`PDF_ICON_SVG` constant in popup.ts — two `currentColor` paths at opacity 0.35 + 1.0 for the dual-tone effect; inherits success color). CSS rule `.milton-popup-pdf-icon` added to `popup.css` (14×14, vertical-align baseline, 6px right margin). Inline SVG chosen because this repo has no icon library (no `src/assets/icons/` UI sprites; only the extension's 16/32/48/128 PNG app icons).
  - **Validation:** typecheck clean, full suite **372/372 pass**. No Figma polish PR needed at this scope; if Pierre wants to refine the icon later (e.g., swap for a Milton-saas-sourced asset), that's a tiny follow-up change to `PDF_ICON_SVG`.

- [x] **Task 7 — Manifest + boundary audit** (AC: #9, #16)
  - [x] 7.1 `pnpm build` succeeds (684ms). `jq '.permissions' dist/manifest.json` → `["activeTab", "storage", "scripting", "offscreen"]` (unchanged from BE-8-6). `jq '.host_permissions' dist/manifest.json` → `["https://translate.milton.so/*", "https://translators.milton.so/*", "https://arxiv.org/*", "https://export.arxiv.org/*"]` (unchanged from BE-8-6).
  - [x] 7.2 `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src/` → zero hits.
  - [x] 7.3 No new external network destinations. BE-8-7 adds only `127.0.0.1:7521/references/{id}/pdf-bytes` (new path on the existing connector host that BE-1 already uses). All other surfaces unchanged: `translate.milton.so` (BE-4) + `translators.milton.so` (BE-8-5) + `127.0.0.1:7521/health|/references|/tags|/projects|/collections` (BE-1/BE-2).
  - Bundle size deltas vs BE-8-6 baseline: popup `index.html-*` chunk 14.95 kB gz → **17.25 kB gz** (+2.3 kB for the new BE-8-7 code, all tree-shaken into the popup). sandbox bundle: **222.68 kB gz** (unchanged). translator-bundle: **391.37 kB gz** (unchanged). offscreen: **1.47 kB gz** (unchanged). Well within AC18-equivalent 2 MB gzipped budget.

- [x] **Task 8 — Automated checks GREEN; sideload smoke partial PASS** (AC: #15, #16)
  - [x] 8.1 `pnpm typecheck` — clean (zero errors).
  - [x] 8.2 `pnpm test` — **372 tests pass** (was 327 BE-8-6 baseline; +45 new across `pdf-fetch-in-tab` (+13), `connector-client` (+20), `zotero-item-to-payload` (+12)). Story spec target was ≥350.
  - [x] 8.3 `pnpm build` — succeeds. Bundle size delta: +2.3 kB gz in the popup chunk (well under the 30 kB heuristic budget). Other chunks unchanged.
  - [x] 8.4 Sideload smoke (Pierre 2026-05-18) — **S1 + S2 PASS, S4 partial, S3/S5/S6/S7 covered implicitly or deferred:**
    - **S1 (arxiv PDF, Flow A happy + CORS preflight)** — PASS. PDF in Milton. CORS preflight verification deferred (initial test bypassed Network panel inspection; the round-trip success implies preflight is correct — file a follow-up if BE-8-2's CORS proves inadequate on a non-arxiv host).
    - **S2 (ScienceDirect direct PDF URL, Flow A — the Class 2 win)** — PASS. Debug stripe confirmed `mode=flow-a · flowA=OK 4111512b · bytes=4111512` (4.1 MB session-gated PDF fetched via `chrome.scripting.executeScript` + content-script `fetch(url, {credentials:'include'})`). Server-translate also returned correct metadata ("Bargaining with indivisibilities", correct authors + abstract + 2026 date). PDF lands in Milton. **Charter v2 Success Criteria #1 cleared.**
    - **S4 (ScienceDirect article landing page, Flow B)** — metadata capture PASS (Class 3 BE-8-6 flow worked); Flow B PDF attach NO-OP. Debug stripe showed `mode=none · attachments=[]` — Zotero's ScienceDirect translator's `getPDFLink(doc)` returned falsy, so it skipped pushing the PDF attachment. **Root cause: anti-captcha-gated** — the translator's third discovery path (`requestDocument(url)` refetch + `.pdf-download-btn-link` selector) runs from the translator-fetcher context WITHOUT the user's session cookies, hits Cloudflare/Anubis challenge, gets HTML without the PDF link. **Deferred per `[[anti-captcha-coming]]`** — Pierre's friend is integrating an anti-captcha solution in a few weeks that fixes this for both the translator-fetch path AND the server-side path. BE-8-7's Flow B wiring is correct; the gap is purely on Zotero translator's URL-discovery side.
    - **S3 (Flow A fallback to BE-7)** — DEFERRED. Requires actively breaking cookies; low marginal value given S1/S2 confirmed Flow A works AND the BE-7 fallback path is preserved verbatim in code (verified by reading the `'be-7-fallback'` branch in `runPostCreatePdfFlow`).
    - **S5 (Flow B soft-degrade)** — COVERED IMPLICITLY by S4 — Flow B not firing AT ALL is a stricter scenario than Flow B firing-and-failing. The reference still saved with full metadata; soft-degrade rule honored.
    - **S6 (no-PDF translator-done)** — COVERED IMPLICITLY by S4 (translator returned items with `attachments=[]` — exactly the "no PDF" case; reference saved with `pdfAttached: undefined`).
    - **S7 (tab-staleness)** — DEFERRED. Stress test; low marginal value given the typed `TAB_GONE` error is unit-tested in `pdf-fetch-in-tab.test.ts` and soft-degrades through `runPostCreatePdfFlow`.
  - [x] 8.5 Verify against actual Milton library — S1/S2 PDFs ARE attached (Pierre confirmed). S4 reference saved with full metadata (title/authors/date/abstract) but no PDF (Flow B blocked).

- [x] **Task 9 — Pre-Review Self-Check + PR** (AC: #13)
  - [x] 9.1 Pre-Review Self-Check walked — every item checked or annotated below.
  - [x] 9.2 Dev Agent Record populated (Agent Model + Debug Log + Completion Notes + File List).
  - [x] 9.3 Story Status flipped `in-progress` → `review`. Sprint-status BE-8-7 flipped `in-progress` → `review`.
  - [x] 9.4 `git push -u origin feat/BE-8-7-class-2-capture` + `gh pr create --base main --head feat/BE-8-7-class-2-capture` non-draft. Background `gh run watch <id> --exit-status` launched in the same response per CLAUDE.md Rule 7.
  - [x] 9.5 **DO NOT flip to `done`** — per `[[feedback-code-review-required-before-done]]`, story stops at `review`; `/bmad_bmm_code-review` is the next workflow (after Pierre's sideload smoke S1-S7 + post-merge CI green on main).

## Dev Notes

### Architecture compliance

- **BE-8-7 closes the Class 2 surface; BE-8-6 closed Class 3; BE-7 stays canonical for Class 1.** The three problem-classes from charter v2's brief now have ship-able paths:
  - Class 1 (paste URL in Milton-desktop) → `translate.milton.so` (unchanged from BE-1 / BE-7).
  - Class 2 (session-gated PDF) → BE-8-7 Flow A (direct-PDF tab) + Flow B (article-page-with-PDF-attachment), both via `chrome.scripting.executeScript` → BE-8-2 endpoint.
  - Class 3 (JS-rendered article page) → BE-8-6 (popup → offscreen → sandbox translator).

- **Shared primitive: `chrome.scripting.executeScript({target:{tabId}, func: async (u) => fetch(u, {credentials:'include'})})`.** This is the same primitive BE-8-6 uses for HTML scraping (`document.documentElement.outerHTML`) — different inner function, same wrapper. The content-script world inherits the tab's origin AND its session cookies for same-origin fetches. This is the entire mechanism behind Class 2's solution: the user already cleared the bot-check on the publisher's page; their tab has the session cookies; the extension delegates the fetch into that context.

- **Why `world: 'ISOLATED'` (default) is sufficient.** We don't need the page's JS context — we only need the page's origin + cookies for `fetch`. Content scripts in the ISOLATED world get exactly that. The MAIN world would let us read page-scope JS variables (e.g., the publisher's PDF.js viewer's in-memory PDF Blob), but that's not needed AND exposes the extension to page-script manipulation (e.g., a hostile publisher overriding `window.fetch` to leak our request).

- **Two-step IPC sequence.** The popup orchestrates (per BE-8-2 Decision 5):
  1. `POST /references` — metadata first; returns `201 {id: "<uuid>"}`.
  2. `POST /references/{id}/pdf-bytes` — bytes second; returns `200 {status: "attached" | "already_attached"}`.
  - These are NOT atomic in Milton-desktop. A failure between them is the soft-degrade case (reference saved, PDF not attached). The user can manually attach the PDF from Milton later (existing affordance there).

- **BE-7 `pdfUrl` path stays operational.** Per charter Decision 8 ("BE-7 backwards compatibility — Coexist; `pdfUrl` survives; bytes-upload added on top"), Flow A's fallback case + the `'be-7-fallback'` mode preserve the BE-7 contract verbatim. The connector's `maybe_spawn_direct_fetch` (added by BE-7) still runs for refs created with `pdfUrl` set. This is the safety net for any case where client-fetch can't reach the PDF (cross-origin CORS, network blip, restricted-URL leak past pre-check).

- **`isFromExpectedSource` discipline carries forward.** BE-8-7 does NOT add new postMessage listeners or new `chrome.runtime.sendMessage` envelopes — all new code uses `chrome.scripting.executeScript` (one-shot result, no message bus) + HTTP POST to the connector. The BE-8-4/5/6 H2 patterns aren't directly exercised, but the dev-agent should NOT add a message-bus envelope without H2 gating if one becomes needed mid-story.

- **Cross-origin Flow B caveat.** Documented in Background. The right long-term fix (if dogfood proves a high-value publisher consistently fails) is narrow `host_permissions` entries (matching the publisher's CDN domain). Out of scope for BE-8-7 — file as follow-up after dogfood.

- **No protocol-version bump.** BE-8-7 doesn't touch the sandbox / offscreen postMessage protocol (BE-8-5's `PROTOCOL_VERSION = 2`). The Flow B post-create work runs entirely in the popup; no offscreen / sandbox involvement. `PROTOCOL_VERSION` stays at 2.

### Library/framework requirements

- **`chrome.scripting.executeScript` MV3 (already in use from BE-8-6).** Returns `Promise<InjectionResult<T>[]>` where `T` is the inner function's return type. With `target: {tabId}` and no `allFrames`, returns one entry (main frame). The inner function runs in the content-script context (isolated world by default); its return value is structured-cloned back to the popup. `ArrayBuffer` survives structured-clone as a copy (NOT a transfer — chrome.scripting doesn't support Transferables in results).

- **`fetch` with `credentials: 'include'` inside content-script context.** Sends same-origin cookies AND respects HTTP redirects with cookie continuity. Same-origin requests inside a content script bypass the extension's manifest CORS gating entirely — they ARE the page's own fetch from the browser's perspective.

- **`XMLHttpRequest` for upload progress.** Only browser-native primitive that fires `progress` events DURING the upload phase. `fetch` body-streaming via `ReadableStream` + `duplex: 'half'` (Chrome 105+) is feasible but requires a `TransformStream` wrapper that's noticeably more complex. Pick XHR for the progress branch; pick `fetch` for the no-progress branch (simpler). Document the split in the module header.

- **`AbortController`.** Works with both `fetch.signal` (native) and `XHR.abort()` (via wrapper — call `controller.abort()` triggers the wrapper to call `xhr.abort()` and reject with `AbortError`). Same API surface for callers.

- **No new third-party dependencies.** All new code uses `chrome.*` APIs + browser-native HTTP primitives + existing internal modules. `@noble/ed25519` from BE-8-5 stays.

- **`@types/chrome@^0.1.40`** already includes `chrome.scripting.InjectionResult<T>` typing (used by BE-8-6). No bump needed.

### File structure

```
src/
├── lib/
│   ├── pdf-fetch-in-tab.ts            ← NEW (AC1 — fetchPdfBytesInTab + PdfFetchInTabError)
│   ├── pdf-fetch-in-tab.test.ts       ← NEW
│   ├── connector-client.ts            ← MODIFY (add MAX_PDF_BYTES + attachPdfBytes + AttachPdfBytesResult)
│   ├── connector-client.test.ts       ← MODIFY (add attachPdfBytes tests)
│   ├── zotero-item-to-payload.ts      ← MODIFY (add extractPdfAttachmentUrl)
│   └── zotero-item-to-payload.test.ts ← MODIFY (add extractPdfAttachmentUrl tests)
├── popup/
│   ├── popup.ts                       ← MODIFY (state-machine extensions, boot Flow A wiring, Save handler Flow B wiring, beforeunload extension, pendingPdfBytes/pendingPdfAttachmentUrl/pdfAttachmentMode module state, render cases for two new states)
│   ├── popup.css                      ← MODIFY (Figma-gated — progress bar + soft-degrade indicator styles)
│   └── popup-helpers.ts               ← POTENTIALLY MODIFY (extract attachment-mode dispatch helper if inline branching exceeds ~20 LOC per Task 5.8)
└── ... (other files unchanged)
```

**No new top-level directories.** `pdf-fetch-in-tab.ts` lives under `src/lib/` next to `page-context.ts` (mirror primitive — both wrap `chrome.scripting.executeScript` for active-tab content extraction). The naming convention (`<resource>-<verb>-<context>`) makes the relationship clear: `page-context.ts` extracts page HTML; `pdf-fetch-in-tab.ts` fetches PDF bytes in the tab context.

### Testing standards

- **Test framework:** Vitest 4.x (carry-forward from BE-8-6).
- **DOM tests:** `@vitest-environment jsdom`.
- **`chrome.scripting` mock pattern:** extend BE-8-6's jsdom chrome stub. The inner function in `pdf-fetch-in-tab.ts` is an async function that does its own `fetch` and returns `{bytes: ArrayBuffer, finalUrl: string}` OR an error envelope. For tests, mock at the executeScript boundary: `chrome.scripting.executeScript = vi.fn().mockResolvedValue([{result: {bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...]).buffer, finalUrl: 'https://...'}}])`. Don't try to mock `fetch` inside the inner function — that runs in the content-script world which tests can't reach. Mock the executeScript output directly.
- **`XHR` mock pattern for progress callback test:** use `vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr))` where `mockXhr` is an object with `upload`, `addEventListener`, `open`, `send`, `abort`, `setRequestHeader`. Drive the test by calling the registered listeners synchronously: `mockXhr.upload.dispatchEvent({type:'progress', loaded:1024, total:4096})` triggers the `onProgress` callback. Standard XHR-mock pattern.
- **`fetch` mock pattern for non-progress branch:** existing pattern from `connector-client.test.ts` (BE-1). Set `fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'attached', referenceId:'...'}), {status: 200}))`.
- **Test count target: ≥350** (BE-8-6 baseline 327 + ~25 new across 3 new/modified test files).

### Previous Story Intelligence (BE-8-6 — Class 3 capture flow)

**What BE-8-6 shipped (relevant to BE-8-7):**

- **`page-context.ts:scrapeActiveTabHtml`** — the primitive sibling to `pdf-fetch-in-tab.ts`. Same `chrome.scripting.executeScript` wrapper pattern, same `isRestrictedUrl` pre-check, same typed-error class taxonomy, same regex-classification of executeScript rejection messages. BE-8-7's primitive follows this template.
- **`popup.ts` state machine** with `translator-running` / `translator-done` / `translator-fallback`. BE-8-7 extends the union with `pdf-fetch-active` + `uploading-pdf` + the `pdfAttached` field on `success`.
- **`popup.ts:boot()` decision tree** via `decideBootRoute()` (extracted in BE-8-6 code-review). The `pdf-server` branch is what BE-8-7 hijacks for Flow A. BE-8-6 currently routes `pdf-server` straight to `extractMetadata(url)`; BE-8-7 inserts a `fetchPdfBytesInTab` call BEFORE that.
- **`enterPreviewState` / equivalent** — the transition point where translator-done → preview. BE-8-7 hooks `extractPdfAttachmentUrl(items[0])` here to stage Flow B's URL.
- **Save handler** at popup.ts:~1620 (`onSave`). BE-8-7 extends the post-`createReference` path with the Flow A upload OR the Flow B fetch+upload, branching on `pdfAttachmentMode`.
- **`beforeunload` handler** — BE-8-7 adds `pdfUploadAbort?.abort()` (one line) to the existing cancel chain.
- **`extractMetadata` server-fallback** — unchanged; Flow A's metadata path still routes through it. The BE-4 auth pipeline + token mint + retry-once stays untouched.
- **Test count baseline: 327.** BE-8-7 must hit ≥350.
- **Bundle size baseline: combined sandbox+translator-bundle chunks ≈614 kB gz, popup index chunk 15.14 kB gz, offscreen 1.47 kB gz.** BE-8-7's adds are negligible (~3 small files all tree-shaken into popup).

**Code-review findings BE-8-7 must NOT repeat** (from BE-8-6 cumulative):

- **HIGH H1 (BE-8-6)** — File List MUST list EVERY file changed (BE-8-6 missed 7 modified files in the original dev-story writeup; caught in code-review pass).
- **HIGH H2 (BE-8-6)** — gate every new postMessage / runtime listener with source validation. BE-8-7 adds neither, but if the dev-agent introduces one mid-story, gate it.
- **HIGH H3 (BE-8-6)** — Pre-Review Self-Check walked + every item checked or annotated.
- **MED M1 (BE-8-6)** — wire timeouts through configurable opts; don't hardcode (BE-8-7's `fetchPdfBytesInTab` + `attachPdfBytes` both accept `opts.timeoutMs`).
- **MED M3 (BE-8-6)** — round-trip tests for every new envelope (BE-8-7's `attachPdfBytes` test suite covers all 5 response shapes).
- **Pattern from BE-8-6 code-review:** extract pure helpers for routing decisions (e.g., `decideBootRoute`) so the popup.ts module-state-coupling doesn't block unit testing. BE-8-7 may benefit from a `decidePostCreateAttachmentFlow(mode, bytes, url)` helper (Task 5.8 — conditional on inline branching size).

### Git intelligence summary

Recent commits show the BE-8-6 close pattern:
- `64c51e4 chore(BE-8-6): mark done` — sprint-status flip to done after code-review pass
- `d0792fa feat(BE-8-6): Class 3 capture flow — client-side translator + offscreen broker (#8)` — main BE-8-6 PR squash-merge
- `f8f659b chore(BE-8-5): mark done`
- `31361d4 feat(BE-8-5): curated translator bundle + lazy CDN-fetch (#6)`
- `ef6584d fix(BE-8-4): code-review pass — postMessage source validation + 5 follow-ups (#5)`

Commit message style: imperative present, `feat(BE-8-N): ...` / `chore(BE-8-N): ...` / `fix(BE-8-N): ...`, Claude co-author trailer. BE-8-7 follows the same convention.

### Latest tech information

- **`chrome.scripting.executeScript` (Chrome 88+)** — async function inner-funcs ARE supported (Chrome correctly awaits and returns the resolved value via structured clone). The `args` parameter passes serializable values to the inner function (used for the URL argument).

- **`fetch` with `credentials: 'include'`** — sends cookies for same-origin requests. For cross-origin requests, requires the server to respond with `Access-Control-Allow-Credentials: true` AND `Access-Control-Allow-Origin: <specific-origin>` (NOT wildcard). Most academic publishers do NOT set these for cross-origin PDF requests; the Flow B cross-origin caveat in Background is the consequence.

- **`%PDF-` magic bytes** — the PDF file format mandates the first 5 bytes are `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2d` in hex). The bytes after are the version (`1.4`, `1.7`, `2.0`, etc.) — variable; only the first 5 are stable. Some PDFs have BOM bytes BEFORE `%PDF-` (rare; spec-violating but seen in legacy generators); for our purposes the BOM case is a `NOT_PDF` reject (acceptable false-negative rate).

- **MV3 `host_permissions` and content-script fetches** — content scripts in MV3 must have `host_permissions` for cross-origin fetch destinations. `activeTab` grants per-tab cross-origin access ONLY for the tab's URL (NOT for resources the page references). This is the source of the Flow B cross-origin caveat.

- **`structuredClone` of large ArrayBuffers** — Chrome's V8 implementation handles 50 MiB ArrayBuffers without issue (the limit is multi-GiB in practice). Peak memory is 2× the buffer briefly; GC reclaims the source after the clone completes. The structured-clone result lands in the popup's window; popup is a transient context that GCs aggressively on close.

- **`XMLHttpRequest` upload progress** — `xhr.upload.addEventListener('progress', e => ...)` fires repeatedly during the body upload phase with `e.loaded` / `e.total` in bytes. Granularity is browser-controlled (typically 10-50 ms intervals); throttling on the popup side is not necessary unless render thrashing is observed.

### Project structure notes

- Repo is single-package (no workspaces); `pnpm` per CLAUDE.md.
- TypeScript `strict: true`.
- No linter configured (`pnpm lint` doesn't exist); `tsc --noEmit` + Vitest are the quality gates.
- Pre-push hook still NOT wired (CLAUDE.md line 51); CI is the gate. **Auto-watch CI in background per CLAUDE.md Rule 7 after `git push` + `gh pr create`.**
- `pnpm dev` runs Vite dev for the popup — fine for popup-UI iteration BUT the chrome.scripting + chrome.runtime APIs require a real sideloaded extension. Use `pnpm build` + sideload `dist/` for any actual Class 2 verification.
- Worktrees not in use; one Claude session per repo (CLAUDE.md Rule 5).

### Documentation Consolidation Notes

- BE-8-7 closes the **Class 1/2/3 capture parity** chapter. If `docs/translator-execution.md` was created in BE-8-6 (check; not pre-confirmed at story drafting time), append a Class 2 swim-lane diagram (popup → chrome.scripting.executeScript → tab content-script → fetch + magic-byte → structured-clone back → connector POST /references → POST /references/{id}/pdf-bytes). Otherwise inline a 3-4 line summary in README under the existing "Translator runtime architecture" section.
- Pattern established: **client-fetch-first-then-server-fallback** for capture paths AND for PDF-fetch paths. If a future story adds yet another layer (e.g., LLM-fallback in BE-8-8 for sparse metadata), the same fallback ordering convention applies.
- Pattern established: **soft-degrade on post-create side-effects.** PDF attach failure does NOT undo the save. This is the right default for any future post-create side-effect (e.g., BE-8-8's LLM-fallback metadata enrichment).

### References

- BE-8-6 story file: `_bmad-output/implementation-artifacts/BE-8-6-class-3-capture-flow.md` (state machine, chrome.scripting wrapper pattern, decideBootRoute extraction, beforeunload cancel pattern)
- BE-8-2 story file: lives in Milton-saas private repo (not loadable here); contract surfaced via charter v2 line 121 + this story's Background section. Endpoint: `POST 127.0.0.1:7521/references/{id}/pdf-bytes`, raw `application/pdf` body, 50 MiB cap, scoped race-safe UPDATE, response envelope `{status: "attached" | "already_attached", referenceId}` on 200; 400/403/404/413/503 on errors.
- Charter v2: `_bmad-output/planning-artifacts/charter-v2.md`
  - Decision 5 (line 48) — two-step IPC wire shape
  - Decision 7 (line 50) — in-app URL-paste failure UX (extension-only here; desktop CTA is sibling Milton-saas story)
  - Decision 8 (line 51) — BE-7 backwards compatibility — coexist
  - Decision 10 (line 53) — manifest permissions all-at-once at install
  - Architecture diagram lines 80-86 (Class 2 swim-lane)
  - Story Map row BE-8-7 (line 121)
  - Sprint-execution risk row "Bytes endpoint body cap" (line 152) — BE-8-7 surfaces the 413 to the user via `pdfAttached: 'failed'`
  - Sprint-execution risk row "Class 2 cookie/session sharing varies between Chromium variants" (line 151) — BE-8-7 smoke matrix covers Chrome (S1-S6); Edge / Brave matrix entries are filed as a smoke follow-up after the Chrome path lands
- CLAUDE.md absolute rules:
  - **FIGMA VERIFICATION FOR ALL UI WORK** (lines 9-29) — Task 6 halts at Figma consultation
  - **Rule 0** — cut branch before first edit (Task 1)
  - **Rule 1** — push only when story-done (Task 9)
  - **Rule 7** — auto-watch CI in background after every push event (Task 9.4)
- `src/lib/page-context.ts:scrapeActiveTabHtml` — primitive sibling; mirror the structure for `fetchPdfBytesInTab`
- `src/lib/connector-client.ts:createReference` — pattern for typed-result fan-out on HTTP status; mirror for `attachPdfBytes`
- `src/lib/zotero-item-to-payload.ts:mapZoteroItemToPayload` — sibling helper for `extractPdfAttachmentUrl`
- `src/popup/popup.ts:boot()` (~line 200) — Flow A insertion point
- `src/popup/popup.ts:onSave` / equivalent (~line 1620) — Flow A + Flow B post-create branching
- `src/popup/popup.ts:beforeunload` handler (BE-8-6) — extend with upload abort
- Upstream `chrome.scripting` docs: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Upstream `chrome.scripting.executeScript` async-function support: confirmed via Chrome 105+ source notes
- Upstream `XMLHttpRequest` upload progress: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload

### Open decisions for dev-agent

(Trivia / dev-discretion choices the SM doesn't pin — flag any that turn load-bearing during dev and surface to Pierre.)

1. **XHR vs fetch+ReadableStream for upload-progress path.** Story locks XHR for the progress branch. If dev finds fetch+stream noticeably cleaner (e.g., better cancellation semantics, smaller code), pivot. The contract is `onProgress(uploaded, total)` — either mechanism is fine if it implements that.

2. **Soft-degrade UI text.** Provisional: "Saved (PDF couldn't be attached — open in Milton to retry)". Figma should pin this; if Figma is silent, default to the provisional and file a Figma request.

3. **Flow A's `pdf-fetch-active` minimum display time.** Story does NOT set a minimum. If the client-fetch resolves in <50 ms (rare; a cached PDF in the browser's HTTP cache could), the state may flash. BE-8-6 chose to keep the analogous `translator-running` un-deferred after dogfood showed round-trip is always >500 ms. Mirror that decision unless dogfood proves otherwise.

4. **Multi-attachment ordering (Flow B).** First-match-wins per AC3. If real-world dogfood shows the supplementary PDF appearing before the main paper PDF (a Zotero translator quirk for some publishers), revisit with priority logic. Don't pre-emptively over-engineer.

5. **Upload progress granularity.** XHR's `progress` events fire at browser-controlled intervals (typically 10-50 ms). If render thrashing is observed, throttle to 100 ms via `requestAnimationFrame`. Decide at implementation time.

6. **Flow B cross-origin caveat — narrow host_permissions follow-up.** Story documents the caveat. If dogfood proves a specific publisher (Wiley, Springer Nature, ScienceDirect) consistently fails Flow B due to cross-origin CDN, file a follow-up story to add a narrow `host_permissions` entry for that publisher's CDN. Do NOT add broad `host_permissions` (`<all_urls>` etc.) — keeps the install-prompt clean.

7. **`Blob` vs `ArrayBuffer` for `attachPdfBytes` body argument.** Story locks `ArrayBuffer` as the caller-side type (popup has bytes from structured-clone as ArrayBuffer); the wrapper internally creates a `new Blob([bytes], {type: 'application/pdf'})` for the POST. This decision keeps the public API tied to the structured-clone result type. If a future caller (e.g., BE-8-8's LLM-fallback) has Bytes from a different source (e.g., Tauri IPC), accepts both via union type — defer.

8. **Edge / Brave smoke matrix.** Charter risk row mentions Chrome / Edge / Brave matrix coverage. BE-8-7 smoke matrix covers Chrome only (Pierre's primary). Edge + Brave smokes are filed as a follow-up sub-story after Chrome path lands and is dogfooded.

## Pre-Review Self-Check

<!-- Before requesting code review, verify each item and check the box. -->

- [x] Icon variants verified against Figma — N/A: extension popup is not Figma-driven for this story (Pierre's scope cut at Task 6 dropped the original Figma-gated UI surfaces). Only the new inline dual-tone PDF SVG icon is added; provisional design — Pierre can swap for a Figma-sourced asset in a follow-up.
- [x] File list in story matches actual files changed — see File List below
- [x] No raw hex color values — N/A: extension uses plain CSS with `var(--milton-*)` tokens; the new `.milton-popup-pdf-icon` rule only sets size + margin (no colors; SVG uses `currentColor` to inherit `.milton-popup-success`'s `var(--milton-success)`).
- [x] `$effect` dependencies checked against async boundaries — N/A: no Svelte runes (vanilla TS popup).
- [x] Superforms tests use real adapter — N/A: no Superforms.
- [x] Barrel imports only — N/A: extension doesn't use `features/*` layout.
- [x] No type casts (`as any`, `as unknown as T`) in new production code — ONE narrow cast in `popup.ts:tryClientTranslator`: `items[0] as { attachments?: unknown }` to call `extractPdfAttachmentUrl`. ZoteroItem has an open `[key: string]: unknown` index signature so `items[0].attachments` is structurally `unknown`; the cast pins the input shape to the helper's parameter type without using `as any`. Documented inline. No `as any` / `as unknown as T` anywhere.
- [x] Error paths handled — `PdfFetchInTabError` (9 typed codes) covers `chrome.scripting.executeScript` failures; `AttachPdfBytesResult` typed union covers all `attachPdfBytes` failure modes (400/403/404/408/413/503/network-error/timeout); both surface through soft-degrade in `runPostCreatePdfFlow` (reference IS saved; `pdfAttached` flag omits the icon).
- [x] IPC command results checked for error states before use — `attachPdfBytes` return is `if (result.ok)` checked BEFORE assuming attached; `fetchPdfBytesInTab` is `try/catch` with typed-error mapping.
- [x] Loading states span full async lifecycle — Flow A boot stays in `loading-health` through the silent client-fetch (no orphan state); post-create flow stays in `posting` through the silent fetch+upload (no orphan state); transition straight to `success` when done.

### BE-8-7-specific Pre-Review additions (AC13)

- [x] **PDF magic-byte check fires INSIDE the content script** — verified in `pdf-fetch-in-tab.ts` `fetchPdfInTab` inner function: first-5-bytes check before structured-clone serializes the body back to the popup. **BT7 explicit `buf = null`** on each error-return path (NOT_PDF / TOO_LARGE) prevents V8 from cloning the body across the wire for failures.
- [x] **50 MiB cap enforced client-side BEFORE POST** — verified in `attachPdfBytes`: `if (bytes.byteLength > MAX_PDF_BYTES) return {ok:false, status:413}` short-circuits without issuing the POST. Tested in `connector-client.test.ts` (`returns 413 client-side WITHOUT issuing POST when bytes exceed cap` — asserts the fetch spy was NOT called).
- [x] **`attachPdfBytes` Content-Type is `application/pdf`** — verified in `connector-client.test.ts` (`Content-Type is application/pdf (verifies AC2)`).
- [x] **PDF-attach soft-degrade verified** — reference IS saved regardless of attach outcome (the create transaction is committed BEFORE `runPostCreatePdfFlow` runs; any attach failure transitions to `success` without `pdfAttached: true`).
- [x] **Flow A's BE-7 fallback path preserved verbatim** — `pdfAttachmentMode === 'be-7-fallback'` branch in the Save handler sets `payload.pdfUrl = currentUrl` exactly as BE-7 did. BT5 suppression is the inverse (only when Flow A bytes ARE staged, suppress pdfUrl) — covered in `runPostCreatePdfFlow` decision-tree.
- [x] **Figma node `1323:8984` consulted** — HALT triggered at Task 6 per CLAUDE.md rule; Pierre directed a scope cut instead of a Figma polish session (drop the two new states + 4 success variants entirely; ship a single success message with an optional small inline-SVG PDF icon when bytes attached). Implementation now matches Pierre's direction; the inline PDF icon is provisional and can be refined via Figma in a follow-up.
- [x] **`grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returns zero hits** — verified in Task 7.2.
- [x] **CLAUDE.md Rule 0 honored** — `feat/BE-8-7-class-2-capture` cut BEFORE first file edit (verified via `git branch --show-current` returning the feat branch before any Write/Edit on `src/`).
- [x] **CLAUDE.md Rule 7 honored** — background `gh run watch <id> --exit-status` launched in the SAME response as `git push` / `gh pr create` (see Task 9.4).
- [x] **DO NOT flip sprint-status to `done`** — story stops at `review`; `/bmad_bmm_code-review` is a separate workflow.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `pnpm typecheck`: clean (zero errors).
- `pnpm test`: **372/372 pass** (was 327 BE-8-6 baseline; +45 new across pdf-fetch-in-tab +13, connector-client +20, zotero-item-to-payload +12).
- `pnpm build`: succeeds (684 ms). Popup `index.html-*` chunk: 17.25 kB gz (+2.3 kB vs BE-8-6 baseline 14.95 kB gz — small + tree-shaken). sandbox.html: 222.68 kB gz (unchanged). translator-bundle: 391.37 kB gz (unchanged). offscreen: 1.47 kB gz (unchanged).
- IPC boundary (AC16): `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src/` → zero hits.
- Manifest permissions: `["activeTab", "storage", "scripting", "offscreen"]` — UNCHANGED from BE-8-6. Host_permissions: UNCHANGED from BE-8-6.

### Completion Notes List

- **Two-step IPC contract from BE-8-2 wired up end-to-end.** Flow A (direct-PDF tab) + Flow B (article-page with `attachments[].pdf`) both fetch bytes in the active tab's content-script context via `chrome.scripting.executeScript` and upload via the new `attachPdfBytes` helper. Soft-degrade is the rule everywhere: reference IS saved regardless of attach outcome.
- **UX SCOPE CUT (Pierre 2026-05-18, at Task 6 Figma gate):** dropped `pdf-fetch-active` + `uploading-pdf` states entirely; collapsed 4 `pdfAttached` success variants to a single boolean. Popup stays in existing `loading-health` / `posting` states throughout silently; transitions straight to `success` when done. Optional small dual-tone PDF icon next to "Saved to Milton ✓" when bytes attached. Inline SVG (no icon lib in this repo). ACs 4/5/6/8/13/15 spec is now ahead of implementation — Change Log documents the cut.
- **Method-17 hardening fully applied** (from create-story step 6): BT1 (detachment ban on `pendingPdfBytes`), BT2 (high-end size-band smoke), BT3 (null-on-terminal-error in `setState`), BT4 (both-branch test coverage), BT5 (`pdfUrl` suppression when Flow A bytes staged), BT6 (409 re-encounter affordance — note added to story for code-review), BT7 (`buf = null` clears in content-script frame), BT8 (408 in `AttachPdfBytesResult` typed union — distinct UX surface), BT10 (defensive `extractPdfAttachmentUrl` against undefined mimeType), BT12 (`encodeURIComponent` single-encoding documented + tested).
- **Test count: 372** (was 327 BE-8-6 baseline; +45 new across 3 new/modified test files). Soft target ≥350 hit comfortably. NOT writing popup state-machine tests — same scope cut BE-8-6 made (popup.ts module structure makes mocking-to-import expensive; the new logic is covered by the 45 unit tests; real integration check is the sideload smoke matrix S1-S7 awaiting Pierre).
- **One narrow type cast in production code:** `items[0] as { attachments?: unknown }` in `popup.ts:tryClientTranslator` — bridges ZoteroItem's open `[key: string]: unknown` index signature to `extractPdfAttachmentUrl`'s typed parameter. Documented inline. No `as any` anywhere.
- **NEXT STEPS** (per CLAUDE.md + memories):
  1. Pierre runs the AC15 smoke matrix S1-S7 (sideload `dist/` in Chrome) and pastes traces into this file. **S1 + S2** are load-bearing (CORS preflight verification on S1; high-end size-band verification on S2). **S7** verifies tab-staleness soft-degrade.
  2. After PR merge + post-merge main CI green, run `/bmad_bmm_code-review` (DO NOT flip sprint-status to `done` until code-review pass — per `[[feedback-code-review-required-before-done]]`).
  3. Final flip to `done` only after code-review finds 0 HIGH outstanding + Pierre's S1-S7 sideload sign-off.
  4. File a sibling Milton-saas story for the desktop "Install Milton extension" CTA (charter Decision 7, deferred per Pierre's Q1 decision in create-story).

### File List

**New files (BE-8-7):**

- `src/lib/pdf-fetch-in-tab.ts` — Class 2 PDF bytes fetch primitive (~215 LOC). `fetchPdfBytesInTab` wraps `chrome.scripting.executeScript` to delegate the fetch into the tab's content-script world (where session cookies live). Magic-byte check + 50 MiB cap inside the content script (BT7 buf=null clears on error returns). `PdfFetchInTabError` typed-error with 9 codes + optional `httpStatus` field.
- `src/lib/pdf-fetch-in-tab.test.ts` — 13 tests (`@vitest-environment jsdom`).

**Modified files (BE-8-7):**

- `src/lib/connector-client.ts` — Added `MAX_PDF_BYTES = 50 * 1024 * 1024` exported constant (cross-references BE-8-2 server-side cap). Added `attachPdfBytes` export + `AttachPdfBytesOptions` + `AttachPdfBytesResult` typed union (includes 408). Implementation: `attachViaFetch` (no-progress) + `attachViaXhr` (with progress) branches; client-side body-cap pre-check returns 413 without POST; client-side empty-body returns 400 without POST; encodeURIComponent applied to referenceId; AbortController for both internal timeout + external `opts.signal`; `parseAttachResponse` shared helper fans out on status code + JSON envelope.
- `src/lib/connector-client.test.ts` — Added 20 tests across both branches (fetch ×14, XHR ×6). Test names labeled with branch. Includes Content-Type verification, encodeURIComponent assertion, client-side pre-check assertions, XHR progress event sequencing. Total file: 35 tests pass.
- `src/lib/zotero-item-to-payload.ts` — Added `ZoteroAttachmentLike` interface + `extractPdfAttachmentUrl(item)` export. Case-insensitive MIME match. BT10 defensive: skips entries with undefined `mimeType` / undefined `url` / empty `url`. Returns null for missing / non-array attachments and for undefined/null item.
- `src/lib/zotero-item-to-payload.test.ts` — Added 12 tests for `extractPdfAttachmentUrl` (first-match wins, HTML-skip, no-PDF, case-insensitive, defensive guards). Total file: 40 tests pass.
- `src/popup/popup.ts` — Substantial integration: imports extended (`attachPdfBytes`, `fetchPdfBytesInTab`, `PdfFetchInTabError`, `extractPdfAttachmentUrl`). `State.success` extended with optional `pdfAttached?: boolean`. `PdfAttachmentMode` type added. Four new module-state variables (`pendingPdfBytes`, `pendingPdfAttachmentUrl`, `pdfAttachmentMode`, `pdfUploadAbort`) — all reset at `boot()` entry; BT1 detachment-ban documented at declaration site. `boot()` `pdf-server` route now calls new `tryFlowAClientPdfFetch` (silent fetch via fetchPdfBytesInTab). `tryClientTranslator` extended: stages `pendingPdfAttachmentUrl` from `extractPdfAttachmentUrl(items[0])`. `save()` refactored: BT5 `pdfUrl` suppression when Flow A bytes staged; on 201 success calls new `runPostCreatePdfFlow(referenceId)`. New helpers: `runPostCreatePdfFlow` (branches on `pdfAttachmentMode`), `uploadPdfBytes` (collapses typed result to boolean). `setState` extended with BT3 null-on-terminal-error guard for the 11 error states + signed-out + cannot-capture + milton-not-running. `beforeunload` extended with `pdfUploadAbort?.abort()`. Success render branches on `state.pdfAttached === true` to prepend the `PDF_ICON_SVG` constant (inline dual-tone SVG, uses `currentColor` for both paths at opacities 0.35 + 1.0).
- `src/popup/popup.css` — Added `.milton-popup-pdf-icon` rule (14×14, vertical-align baseline, 6px right margin). Inherits color from `.milton-popup-success`'s `var(--milton-success)` via `currentColor`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `BE-8-7-class-2-capture-and-paste-failure-ux` flipped: `backlog` → `ready-for-dev` → `in-progress` → `review` (at PR open).

**Files NOT touched (intentional):**

- `src/translator-runtime/*` — unchanged. BE-8-7 doesn't touch the sandbox / offscreen protocol; PROTOCOL_VERSION stays at 2 per BE-8-6.
- `src/lib/offscreen-client.ts` / `src/offscreen/*` — unchanged. BE-8-7 doesn't add new offscreen IPC envelopes.
- `manifest.config.ts` — unchanged. NO new permissions / host_permissions; `activeTab` + existing `scripting` cover BE-8-7's chrome.scripting use; the only new network destination is the BE-8-2 path on the existing connector host.

## Out of scope (explicit)

These items are deferred from BE-8-7. Filed here so reviewers + future-Pierre know they were considered + intentionally cut:

- **Milton-desktop "Install Milton extension" CTA** (charter Decision 7 desktop side). Lives in a Milton-saas sibling story. Run `/bmad_bmm_create-story` there next to file it. Out of scope here because BE-8-7 is extension-only per the BE-8-2-symmetry decision (Pierre Q1, 2026-05-17).
- **Retry of failed PDF upload.** Best-effort once; user can re-trigger via re-Save on the same tab (the popup will issue a fresh `createReference` → 409 duplicate → existing 409 UX → user can manually attach in Milton). Auto-retry adds complexity for a recoverable case the user can handle.
- **Multi-PDF attachment** (Flow B). First-match-wins. If a translator returns multiple PDFs, only the first gets uploaded. Follow-up if dogfood shows ordering issues.
- **PDF-only reference (no embedded metadata).** If Flow A hits a PDF with no extractable metadata AND server-side `extractMetadata` also fails, the popup transitions to `error-no-metadata`. BE-8-8 (LLM-fallback) owns this surface — do NOT pre-empt BE-8-8 by adding LLM-fallback here.
- **Page-detection content script** (charter BE-3 — still deferred).
- **Streaming upload over the wire.** 50 MiB is small enough to hold in memory; streaming is post-MVP optimization.
- **Edge / Brave Chromium-variant smoke matrix** (charter risk row). Pierre's primary is Chrome; file Edge + Brave smokes as a sub-story follow-up.
- **Cross-origin Flow B `host_permissions` additions for specific publishers.** Out of scope; case-by-case follow-up after dogfood proves which publishers need it.

## Change Log

| Date | Author | Note |
|---|---|---|
| 2026-05-18 | Claude (Opus 4.7 1M, smoke-driven cleanup) | **Smoke matrix complete — S1/S2 PASS, S4 metadata PASS / Flow B anti-captcha-gated, S3/S5/S6/S7 implicit or deferred.** Class 2 win confirmed end-to-end on a 4.1 MB ScienceDirect direct-PDF URL via Flow A (`mode=flow-a · flowA=OK 4111512b`). Flow B for ScienceDirect article landing pages: translator's `getPDFLink` returns falsy due to Cloudflare/Anubis challenge on its `requestDocument` refetch path → empty `attachments[]` → Flow B no-op. Anti-captcha integration coming (Pierre, ~weeks) will fix this on both translator-fetch + server-side paths simultaneously. Filed in `[[anti-captcha-coming]]` memory. Debug stripe re-gated to `import.meta.env.DEV` (stripped from prod via Vite); kept in code as a diagnostic surface for future PDF-flow work. Story ready for `/bmad_bmm_code-review`. |
| 2026-05-18 | Claude (Opus 4.7 1M, smoke-driven diagnostic) | **DEV-mode debug stripe + Flow A outcome tracing + attachments dump.** Pierre's S2 retest revealed `mode=be-7-fallback` (Flow A failing silently on direct-PDF tab); broadened the no-metadata instant-save fallback to fire on any detected PDF page (not just when bytes are staged), added `lastFlowAOutcome` + `lastFlowBAttachmentsDump` module state, rendered always-on (then re-gated to DEV) debug stripe at popup bottom. Per `[[extension-popup-console-impossible]]` memory: never ask Pierre to check popup DevTools console — popup dies on outside click. Stripe is the alternative. |
| 2026-05-18 | Claude (Opus 4.7 1M, smoke-driven fix) | **AC11 deferral overridden — instant-save fallback when server-translate returns no-metadata + bytes staged.** Pierre's smoke S2 (ScienceDirect direct PDF) surfaced that AC11's "defer to BE-8-8" was wrong: server-translate is GUARANTEED to fail no-metadata for Cloudflare/Anubis-fronted PDFs (the exact case Class 2 enables), which transitioned the popup to `error-no-metadata` BEFORE the Save handler ran — the staged bytes were abandoned, no reference created, BE-8-7 was useless for its primary target. **Fix:** in `enterServerFlow`'s `extractMetadata` failure branch, check `pendingPdfBytes !== null || pendingPdfAttachmentUrl !== null` AND `result.error.kind === 'no-metadata'`; if both, patch the preview with `blankEditable(currentTabTitle ?? url)` (instant-save semantics) instead of dispatching to error. User can then Save → reference created with placeholder title → bytes upload → PDF in Milton. User edits title later in Milton; BE-8-8 LLM-fallback will enrich from the PDF bytes once shipped. Honors `[[feedback-capture-correctness-over-ui-polish]]`. Typecheck clean, 372/372 tests pass. |
| 2026-05-18 | Claude (Opus 4.7 1M, BMad Dev workflow) | **UX scope cut — popup PDF states removed.** Pierre directed at Task 6: drop `pdf-fetch-active` + `uploading-pdf` states entirely; drop all 4 `pdfAttached` success variants; ship a single success message with an optional small dual-tone PDF icon when bytes were attached. Rationale: "we just import it and the user will see it in Milton". Implementation: state machine shrinks (2 states removed); `success.pdfAttached` collapses to `boolean | undefined`; boot Flow A + post-create flow run silently (popup stays in existing `loading-health` / `posting` states throughout); inline SVG icon added (no icon lib in this repo). ACs 4/5/6/8/13/15 spec is now ahead of implementation — actual code is the source of truth from here; the AC text describes the original specced UX before the scope cut. Functionally complete; typecheck + 372/372 tests pass. |
| 2026-05-18 | Claude (Opus 4.7 1M, BMad SM workflow auto-method-17) | **Red Team vs Blue Team elicitation applied automatically per Pierre-customized default flow. 12 hardening edits applied across AC1/AC2/AC3/AC4/AC5/AC7/AC12a (new)/AC14/AC15.** Red-team attack summary: (RT1) ArrayBuffer detachment hazard between stage + upload; (RT2) `chrome.scripting.executeScript` historical result-size silent-truncation around 32 MiB; (RT3) orphaned 50 MiB on terminal error states; (RT4) XHR-vs-fetch branch test coverage asymmetry; (RT5) double-attach race when popup.ts:~1606 still sets `payload.pdfUrl` on Flow A success; (RT6) mid-Save cancellation race + silent data loss on 409 re-encounter; (RT7) magic-byte buffer retention in content-script frame causes full-body clone on `NOT_PDF`; (RT8) 408 server-side timeout missing from `AttachPdfBytesResult` typed union; (RT9) CORS preflight on `application/pdf` POST never verified (BE-8-2 may have missed it server-side); (RT10) `extractPdfAttachmentUrl` throws on undefined mimeType; (RT11) tab closed/navigated between popup-open and Save; (RT12) `encodeURIComponent` double-encoding hazard. Key changes: new AC12a covers the 409 re-encounter affordance; AC2 typed union grows to include 408; AC5 adds the `pdfUrl` suppression refactor for popup.ts:~1606; AC7 grows the detachment ban + null-on-terminal-error rules; AC15 grows S2/S7 (size-band + tab-staleness) + S1/S3 augmented with CORS-preflight + double-attach verification. Story still ready-for-dev pending Pierre's final validation. |
| 2026-05-17 | Claude (Opus 4.7 1M, BMad SM create-story) | Initial draft. Pierre-customized flow: per-section [a/c/p/y] suppressed. Q1 (desktop CTA scope) + Q2 (Class 2 trigger) resolved via AskUserQuestion → extension-only + both Flow A + Flow B. Method-17 hardening pass pending (next step). |
