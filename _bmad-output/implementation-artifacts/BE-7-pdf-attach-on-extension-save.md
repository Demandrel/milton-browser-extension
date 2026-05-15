# Story BE-7: Auto-Attach PDF When Saving from a PDF Page

Status: done
Origin: BE-2 dogfood finding (Pierre 2026-05-15) — net-export of `https://www.econstor.eu/bitstream/10419/32581/1/623739976.pdf` confirmed the extension creates a reference (201 Created, 188-byte payload) but never asks Milton to download the PDF. Two architectural gaps: (1) `connector::handlers::add_reference` does NOT call `maybe_spawn_auto_fetch` (asymmetry vs. IPC `commands::references::create_reference`); (2) `auto_fetch_pdf_inner` is OA-discovery (Unpaywall → arXiv → SciHub), not direct-URL download — even if triggered, econstor working papers wouldn't surface.
Depends on: BE-2 (popup preview + Save flow), Story 17-5 (connector server scaffolding), Story 15-1a (`auto_fetch_pdf` IPC + `maybe_spawn_auto_fetch` helper + `pdf-auto-fetch-complete` event)
Coordinates with: Epic 19 Story 19-5 (coverage gap-fill) — 19-5 defers adding tests to `connector/payload.rs`, `connector/handlers.rs`, `commands/pdf_fetch.rs` until BE-7 lands; tests for those files are added in BE-7 + extended in 19-5 against the post-BE-7 surface

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pierre using the Milton browser extension on academic PDF pages (working papers, arXiv preprints, publisher direct-PDF links),
I want the popup's Save action to atomically capture both the reference metadata AND the PDF binary,
so that the saved reference is immediately readable/annotatable in Milton without a manual follow-up "Fetch PDF" click — closing the BE-2 dogfood gap where references silently land with garbage metadata AND no PDF.

## Background

**Charter scope revision.** The 2026-05-04 charter (`tools/browser-extension/_bmad-output/planning-artifacts/charter.md` line 62) initially out-of-scoped PDF binary upload from the extension: *"Milton's 15-1a auto-fetch handles OA-PDF download server-side."* That assumption was incomplete on two counts:

1. **15-1a's auto-fetch is OA discovery, not direct download.** `auto_fetch_pdf_inner` runs `PdfFetchPipeline` (Unpaywall → arXiv → hardcoded SciHub-fallback). It looks up an OA copy by DOI / arXiv ID. For a working-paper repository like econstor — no DOI on file at Unpaywall, no arXiv presence — the pipeline finds nothing, even though Pierre is literally on the PDF URL.

2. **The connector handler doesn't even trigger 15-1a.** `connector::handlers::add_reference` (`milton/src-tauri/src/connector/handlers.rs:546`) creates the reference atomically and returns 201, but never calls `maybe_spawn_auto_fetch` — the helper that IPC `commands::references::create_reference` (`milton/src-tauri/src/commands/references.rs:877`) DOES call after insert. So extension-created refs were already on a code path that lost the auto-fetch even in the cases where it would have worked.

**Net-export evidence (2026-05-15).** Pierre's net-export log captured: `POST /references` request body = **188 bytes** (fits the AC7 baseline envelope: title, url, four empty selector arrays), response = **201 Created with 45 bytes** (just the ref id). No `pdfUrl`, no `pdfBinary`, no `Content-Length` consistent with a PDF — the bug is at the wire-contract level, not at the connector implementation alone.

**This story revises the charter** to ship a minimal, opinionated PDF-attach path: when the page is a PDF, the extension tells Milton's connector via a new `pdfUrl` field, and Milton downloads + attaches the PDF server-side. No UI affordance in the popup — the operation is silent and best-effort, per Pierre's design call (2026-05-15): *"just attach the pdf if the page is a pdf, nothing to mention to the user, no feedback etc."*

## Acceptance Criteria

**AC1 — Extension detects PDF pages and populates `pdfUrl` in the connector payload**

- At popup boot, `chrome.tabs.query({ active: true, currentWindow: true })` already returns the active tab; the popup additionally captures `tabs[0].url` (existing) AND derives a `pageIsPdf` flag from one of:
  - `tabs[0].mimeType === 'application/pdf'` (Chrome's built-in PDF viewer surfaces this — preferred signal, content-type-true)
  - Fallback: `url.toLowerCase()` with query-string stripped ends in `.pdf`
- When `pageIsPdf` is true at Save time, the popup sets `payload.pdfUrl = currentUrl` (the same URL it already uses as `payload.url`). When false, `pdfUrl` is omitted from the payload.
- The extension does NOT download the PDF in the popup — the URL is passed through and Milton fetches it server-side (charter "no PDF binary in the wire" stays; the new field is a URL string).
- The popup renders no UI change whatsoever — no "Will attach PDF" line, no toggle, no toast. The flag flows silently into the payload. (Pierre 2026-05-15: *"nothing to mention to the user, no feedback etc."*)
- **Atypical:** URL with query params after `.pdf` (`?download=true`, `#page=4`) → mimeType signal still resolves to `application/pdf`; fallback suffix-check strips the query/hash before testing. Both paths flag correctly.
- **Atypical:** PDF served from a non-`.pdf` URL (e.g., `https://host/download?file=623739976`) → only the `mimeType: 'application/pdf'` signal catches this; suffix check misses, but mimeType wins.
- **Atypical:** HTML page with `.pdf.html` filename → `mimeType: 'text/html'`; suffix check on `.pdf.html` does NOT match (suffix-checks for exact `.pdf` trailing, not substring). Do NOT flag.
- **Atypical:** `chrome.tabs.query` doesn't return `mimeType` for some browsers / non-PDF tabs → field is `undefined`; gracefully fall back to suffix check.
- **Atypical:** `file://` URL → fallback suffix-check would match `.pdf` but Milton can't fetch a `file://` URL server-side. Connector handler MUST reject `file://` schemes in `pdfUrl` (see AC3). The popup may pass it through — connector is the validation chokepoint.
- **Atypical:** `chrome://`, `chrome-extension://` URLs → already blocked at the `cannot-capture` state in BE-1's popup boot (line 125-134 of `popup.ts`); `pageIsPdf` is never evaluated for these.

**AC2 — `ConnectorReferencePayload` accepts a new optional `pdfUrl` field**

- Rust struct in `milton/src-tauri/src/connector/payload.rs`: add `pub pdf_url: Option<String>` (snake_case in the struct, `pdfUrl` on the wire via the existing serde `rename_all = "camelCase"`).
- TypeScript type in `tools/browser-extension/src/lib/types.ts`: extend `ConnectorReferencePayload` with `pdfUrl?: string`.
- Protocol doc updated at `docs/integrations/browser-extension-protocol.mdx`: new field documented in the `POST /references` request schema with the silent-best-effort behavior contract.
- The forward-compat decision documented in `payload.rs` (no `deny_unknown_fields`, 64 KiB body cap) is preserved — adding `pdf_url` does not regress that decision.
- **Atypical:** payload missing `pdfUrl` (BE-1 / BE-2 baseline clients) → behavior unchanged. Reference is inserted, no direct-URL download attempted. The new `maybe_spawn_auto_fetch` call in the connector handler (AC3) still fires the OA discovery path, so refs with a DOI but no extension-supplied PDF can still get one via the existing 15-1a pipeline.
- **Atypical:** payload includes `pdfUrl: ""` → parsed as `Some("")`; handler treats empty string as "absent" (see AC3 validation).
- **Atypical:** payload includes `pdfUrl: null` → JSON `null` deserializes to `None` via `Option<String>`. No special handling.

**AC3 — `add_reference` connector handler triggers both auto-fetch paths after the atomic insert**

- After the existing atomic `create_reference_with_organization` insert in `connector::handlers::add_reference` returns the new reference, the handler:
  1. **Always** calls `crate::commands::references::maybe_spawn_auto_fetch(pool, app, &reference)` — closes the asymmetry with the IPC `create_reference` path. This means refs with a DOI (and no `pdfUrl`) now get the same OA-discovery treatment whether they were imported via the desktop UI or via the extension.
  2. **If `payload.pdf_url` is `Some(url)` AND the URL is well-formed** (see validation below), additionally spawns a `tokio::spawn` of a new direct-URL fetch task (AC4). The two spawns are independent — neither blocks the other; `pdf_path` race-safety inside the existing pipeline means whichever lands first wins.
- The handler returns 201 **immediately** after the DB insert + the two spawn calls. PDF download is fire-and-forget; the popup's Save flow does NOT wait on it.
- **`pdfUrl` validation (in-handler, BEFORE spawn):** the URL must (a) parse via `url::Url::parse`, (b) have scheme `http` or `https` ONLY (no `file://`, no `data:`, no `javascript:`, no `ftp://`, no `chrome-extension://`), (c) not exceed a sane URL length (4096 chars).
- Invalid `pdfUrl` → handler logs `warn` with the offending URL (sanitized), skips the direct-fetch spawn entirely, but still completes the reference insert + the OA `maybe_spawn_auto_fetch` call. The reference is still created — the bad URL just gets dropped.
- **Atypical:** `pdf_url` present AND reference already has a DOI that Unpaywall would resolve → BOTH paths fire concurrently. The existing race-safe `WHERE id = ? AND pdf_path IS NULL` UPDATE in `auto_fetch_pdf_inner` ensures only the first writer persists; second writer's bytes are deleted as an orphan (existing 15-1a behavior). No new race-safety code needed.
- **Atypical:** the spawn handle is never awaited (fire-and-forget). If Milton shuts down mid-download, the task is cancelled at runtime drop; partial bytes on disk are orphaned (rare; manageable as an `app_data_dir/pdfs/*-autofetch.pdf` cleanup pass in a future story if it becomes a problem).
- **Atypical:** signed-out user calling `POST /references` → the existing 503 active-user gate fires BEFORE this handler runs (`active_user.read().await.is_some()`). No code change in BE-7.

**AC4 — Direct-URL PDF download service**

- New function (location: `milton/src-tauri/src/commands/pdf_fetch.rs` next to `auto_fetch_pdf_inner`, OR a new sibling module `connector_pdf_fetch.rs` if `pdf_fetch.rs` is already crowded — dev decides):

  ```rust
  pub async fn fetch_pdf_from_known_url<R: Runtime>(
      pool: SqlitePool,
      app: AppHandle<R>,
      reference_id: String,
      pdf_url: String,
  ) -> Result<(), AppError>
  ```

- Behavior:
  1. **Idempotency** — load reference; if `pdf_path.is_some()`, short-circuit and return Ok (matches 15-1a's gate at `pdf_fetch.rs:113`).
  2. **HTTP GET** the `pdf_url` via the existing `reqwest::Client` Milton uses elsewhere (likely a shared client in `milton-core`; reuse don't reinstantiate). Set:
     - `User-Agent` matching Milton's existing outbound calls (whatever 15-1a uses).
     - Timeout: 30s total (covers slow first-byte + slow body — academic publisher CDNs are sometimes lazy).
     - Max redirects: 10 (reqwest default, no override needed).
     - **No `Referer`** in v1 — keep it simple; if specific publishers block on absent Referer we add it later (none observed in econstor / arXiv).
  3. **Response validation:**
     - Status: `2xx` only. `3xx` is handled by reqwest's redirect follower; any non-2xx after redirects → log + return Ok (silent best-effort, no error to surface).
     - `Content-Type`: **NOT used as a gate** (was: `application/pdf` OR `application/octet-stream`). The header is logged for observability via `direct_fetch_response` only. Reasoning recorded in change-log entry 2026-05-15: real academic web servers emit PDFs under `application/pdf`, `application/octet-stream`, `application/x-pdf`, `application/force-download`, and occasionally `text/html` (broken Apache configs). The magic-byte gate below is the reliable content floor — HTML starts with `<!doctype` / `<html`, never `%PDF-`.
     - **Magic-byte check** on first 5 bytes received: must be `%PDF-`. This catches HTML challenge pages (Anubis, Cloudflare PoW interstitials) and any payload that lies about `Content-Type`. If magic bytes wrong → abort, log, no persist.
  4. **Size cap** at stream-time: 50 MiB hard limit. Stream `bytes_stream()` and accumulate; abort the body read once total exceeds the cap. (Don't buffer the whole response then check — a 1 GiB textbook would OOM.)
  5. **Persist** to `app_data_dir/pdfs/{reference_id}-autofetch.pdf` (matches the path 15-1a writes to — same naming convention so a follow-up "where did this come from" investigation looks the same).
  6. **Race-safe UPDATE** via the existing `race_safe_set_autofetch_pdf` (`milton-core::db::models::reference`) — `WHERE id = ? AND pdf_path IS NULL`. If the UPDATE loses (rows_affected == 0), delete the orphan file, log, return Ok.
  7. **Emit `pdf-auto-fetch-complete` event** on the AppHandle (same event 15-1a emits, so the frontend listener at `auto-fetch-analytics.ts` + `referenceStore.invalidate()` works unchanged). Distinguishing data:
     - `trigger`: NEW variant `FetchTrigger::Connector` added to `milton-core::services::pdf_fetch::FetchTrigger` (alongside `Manual` and `Auto`) so PostHog analytics can split the new code path from the existing two.
     - `source`: NEW variant `FetchSource::ExtensionDirect` added (alongside `Unpaywall`, `Arxiv`, `FallbackUrl`, `None`). Keeps the analytics breakdown coherent.
     - `iframe_extracted`: always `false` (only relevant to the SciHub-fallback HTML-then-iframe path).
- **Atypical:** server returns HTML error page with status 200 → Content-Type `text/html` catches it; magic-byte check is the second line of defense.
- **Atypical:** server returns gzipped PDF (`Content-Encoding: gzip`) → reqwest auto-decompresses; magic bytes after decompression are still `%PDF-`. Fine.
- **Atypical:** server requires cookies (paywalled PDF, redirect-to-login) → request goes out cookie-less; we get the login page HTML, magic-byte rejects. Quiet fail. (Paywall handling could be a future story but not BE-7.)
- **Atypical:** the URL hits a CDN that serves a 302 redirect chain to a presigned URL → reqwest follows; final bytes magic-check.
- **Atypical:** very slow first byte (60s+ TTFB) → 30s timeout fires; reqwest returns an error → caught, logged, Ok.
- **Atypical:** `app_data_dir/pdfs/` doesn't exist on disk → ensure-dir on the persist step (15-1a's persist helper already does this; if we reuse the shared helper we get it free).
- **Atypical:** disk full / write error mid-stream → caught, logged, partial file deleted, Ok.

**AC5 — Path-trust + size limit honored**

- The persist path `app_data_dir/pdfs/{reference_id}-autofetch.pdf` is constructed server-side from `reference_id` (a validated UUID from the just-inserted reference, not user-supplied) and a static suffix. No `validate_user_path` call needed — `reference_id` IS the path component and the connector's existing payload validation guards it.
- **Atypical:** `reference_id` contains characters that would be unsafe as a filename — impossible by construction (UUID v4 only). But: if a future contract change ever loosens the ID shape, the path is built via `PathBuf::join` which handles separators; a malicious ID would have to pass `Uuid::parse_str` which the connector already does at insert.
- Size cap (50 MiB) enforced at stream-time, not file-write-time. The cap is hardcoded; a future story could surface it as a setting if needed.

**AC6 — Tests**

- **Rust unit tests** (added in BE-7; 19-5 will extend coverage afterward against the post-refactor surface):
  - `connector::handlers::add_reference` accepts `pdfUrl` in the payload and calls the direct-fetch spawn — use the existing `AUTO_FETCH_SPAWN_COUNTER` test pattern (`commands/references.rs` already uses it for `maybe_spawn_auto_fetch`). Add a parallel counter for the direct-fetch spawn so the test asserts both counters increment when `pdfUrl` is present and only `maybe_spawn_auto_fetch`'s counter increments when it's absent.
  - `add_reference` rejects invalid `pdfUrl` schemes (`file://`, `data:`, `javascript:`, `ftp://`) — the reference is still inserted (counter for `maybe_spawn_auto_fetch` increments) but the direct-fetch counter does NOT.
  - `fetch_pdf_from_known_url` idempotency: reference already has `pdf_path` → no-op.
  - `fetch_pdf_from_known_url` happy path with a mocked HTTP server returning a tiny valid PDF (just `%PDF-` magic + minimal trailer). Asserts file persisted, `pdf_path` set, event emitted with correct `trigger` + `source`.
  - `fetch_pdf_from_known_url` magic-byte rejection when server returns HTML.
  - `fetch_pdf_from_known_url` size-cap behavior when server streams more than 50 MiB (use a streaming mock that returns a 50.1 MiB body).
  - `fetch_pdf_from_known_url` race-loss path: pre-populate `pdf_path` between idempotency check and UPDATE (simulate via a synchronous DB write in the test).
  - **AC9 SSRF coverage (added 2026-05-15):**
    - localhost IP rejection: `http://127.0.0.1/`, `http://[::1]/` → validation rejects, no fetch attempted
    - RFC1918 IP rejection: `http://10.0.0.1/`, `http://192.168.1.1/`, `http://172.16.0.1/` → rejected
    - Cloud-metadata IP rejection: `http://169.254.169.254/` → rejected
    - Non-canonical IP forms: `http://0177.0.0.1/` (octal), `http://2130706433/` (decimal), `http://[::ffff:127.0.0.1]/` (IPv4-mapped IPv6) — all resolve to 127.0.0.1, all rejected
    - Redirect chain to `file://`: mocked HTTP server returns `302 Location: file:///etc/passwd` → per-redirect handler rejects on hop 2 (scheme not allowed)
    - Redirect chain to internal IP: mocked server returns `302 Location: http://10.0.0.1/` → per-redirect handler rejects on hop 2 (IP blocklisted)
    - URL with userinfo: `https://user:secret@example.com/file.pdf` → fetch happens (mocked 200 + valid PDF bytes); log capture asserts NO occurrence of `secret` in any emitted log line; sanitized URL appears instead
    - Cookie isolation: mocked server #1 (OA pipeline simulated) sets `Set-Cookie: session=abc`; mocked server #2 (direct-fetch target) records request headers and asserts no `Cookie: session=abc` was sent
    - Multi-IP DNS: hostname resolves to `[1.2.3.4, 10.0.0.1]` → reject (any blocked IP in the set fails the whole URL)
- **TypeScript unit tests** (popup-helpers / connector-client):
  - Helper `detectPdfPage(url, mimeType)` (new pure helper in `popup-helpers.ts` so it's jsdom-friendly) returns `true` for `mimeType === 'application/pdf'`, `true` for `.pdf` suffix with mimeType absent, `false` for `.pdf.html`, `false` for `chrome://`, `false` for query-string-after-pdf when mimeType absent (because we strip the query and re-check), etc. 8–10 scenarios.
  - `connector-client.test.ts`: `createReference` happy path with `pdfUrl` in the payload — assert the request body's JSON contains `pdfUrl`. (Network mocking already wired in this file.)
- **No web research / Context7 lookups** needed — reqwest, axum, tokio, and Chrome `tabs` API are all stable, idiomatic, and already in use.
- All existing BE-1/BE-2/BE-4 tests continue passing (current baseline: 99/99). Expected total ≥ 105 (BE-7 adds ~8–10 in `popup-helpers.test.ts` + `connector-client.test.ts`; Rust adds ~7 unit tests).

**AC7 — Smoke matrix (G15-1 boundary inputs + G18-4 cross-content-type cycles)**

Pierre's manual sideload smoke list (Task 7). Each scenario must pass before code review.

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | econstor PDF (Pierre's repro: `https://www.econstor.eu/.../623739976.pdf`) | Reference created, PDF attached within ~30s, opens in Milton's reader. Library refresh shows attached. |
| 2 | arXiv PDF link (`https://arxiv.org/pdf/2303.08774.pdf`) | Reference created; PDF attached via the new direct path (mimeType: `application/pdf`). Verify `source: ExtensionDirect` in PostHog event payload. |
| 3 | arXiv abs page (`https://arxiv.org/abs/2303.08774`) | Reference created; PDF attached via the EXISTING OA-discovery path (`source: Arxiv`) — confirms `maybe_spawn_auto_fetch` now fires from the connector. |
| 4 | Publisher article page (Nature / Springer, has DOI) | Reference created; PDF MAY attach via Unpaywall if it has an OA copy (same as IPC manual-import behavior — `source: Unpaywall` if hit, no PDF if not). |
| 5 | Page with `.pdf.html` filename | Reference created; NO direct-fetch attempted (mimeType: `text/html`, suffix check correctly rejects). OA discovery may still fire if DOI present. |
| 6 | `chrome://` or `chrome-extension://` URL | Popup shows `cannot-capture` (BE-1 unchanged); no save attempted. |
| 7 | Paywalled PDF URL (server returns 200 + login HTML page) | Reference created; direct-fetch silently fails on magic-byte mismatch; no PDF attached; no UI error. |
| 8 | 404 PDF URL (broken link) | Reference created; direct-fetch logs + Ok; no PDF; no UI error. |
| 9 | Save same arXiv PDF URL twice in a row | First save creates ref + PDF; second save → connector returns 409 (duplicate); duplicate's `pdfUrl` is ignored (dedup-is-noop per protocol). Existing PDF on the first ref is NOT replaced. |
| 10 | Server returns 50 MiB+ stream | Direct-fetch aborts mid-stream at cap; partial file cleaned up; no PDF; no UI error. (Hard to reproduce naturally; defer to Rust unit test #6 — Pierre can skip this in smoke.) |
| 11 | Signed-out save attempt on a PDF page | 503 from connector active-user gate → popup shows `signed-out` (BE-4 unchanged); no insert, no fetch. |
| 12 | Cross-content cycle: PDF page (#1) → article page (#3) → another PDF page within the same popup-session | All three save independently, no state leak between popups (popup is short-lived per Chrome). Verify in Milton library. |

**AC8 — Charter + protocol doc + README updates**

- `tools/browser-extension/_bmad-output/planning-artifacts/charter.md` line 62 "Out of scope" entry **superseded** with a note pointing to BE-7. The line is preserved (for historical accuracy) but annotated.
- `docs/integrations/browser-extension-protocol.mdx`: `POST /references` schema gains `pdfUrl` field documentation; new section "PDF attachment (BE-7)" describing the silent best-effort contract, the URL validation gate, the size cap, and the `pdf-auto-fetch-complete` event with the new `trigger: connector` / `source: extension_direct` variants.
- `tools/browser-extension/README.md`: status banner updated (BE-7 → shipped); story-map BE-7 row added with `shipped`; smoke section gets ~3 representative scenarios.
- NO new entries in main Milton's `docs/` (the protocol doc IS in `docs/integrations/`; everything else stays in this story file + the extension README).

**AC9 — SSRF hardening for the direct-fetch path** (added 2026-05-15 via Red Team vs Blue Team elicitation)

The `pdfUrl` field lets the extension ask Milton's process to make outbound HTTP requests from the **user's machine** with the user's **network position** (LAN, VPN, localhost services, cloud metadata where applicable). This is net-new attack surface BE-7 introduces and must be hardened before ship.

- **IP-based validation, not hostname-string.** Resolve the `pdfUrl` hostname **once** at validation time; reject if the resolved IP is in any of these reserved ranges:
  - **IPv4:** `127.0.0.0/8` (loopback), `10.0.0.0/8` + `172.16.0.0/12` + `192.168.0.0/16` (RFC1918 private), `169.254.0.0/16` (link-local incl. cloud metadata `169.254.169.254`), `0.0.0.0/8` (unspecified), `224.0.0.0/4` (multicast), `255.255.255.255` (broadcast)
  - **IPv6:** `::1` (loopback), `fc00::/7` (ULA), `fe80::/10` (link-local), `::ffff:0:0/96` (IPv4-mapped — recurses to the IPv4 check)
- **Connect to the resolved IP directly, not by hostname.** Defeats DNS rebinding (TOCTOU between validation lookup and connection lookup). Set the original `Host:` header explicitly on the request so virtual-host-aware servers still route correctly.
- **Per-redirect re-validation.** Custom redirect handler in reqwest re-runs BOTH the scheme allowlist (http/https only) AND the IP blocklist on EVERY hop. Reject redirects to `file://`, `data:`, `javascript:`, `ftp://`, `chrome-extension://`, or to any IP in the reserved ranges. **Critical:** AC3's initial-URL scheme validation alone is bypassable via `https://attacker.com → 302 → file:///etc/passwd`; the per-hop re-check closes this.
- **Log sanitization everywhere.** All URL logging in the direct-fetch path uses `milton-core::services::pdf_fetch::sanitize_url_for_log` (already used by the OA pipeline). Strips userinfo (`user:pass@`) and query-string secrets before emitting to `log::warn!` / Sentry breadcrumbs.
- **Dedicated cookie-less `reqwest::Client`.** Direct-fetch constructs its own `reqwest::Client` with `.cookie_store(false)` (or equivalent). Direct-fetch never carries cookies from the OA pipeline's client; OA never sees direct-fetch's. Defeats credential-leakage-via-shared-jar.
- **Atypical:** `pdfUrl: http://0177.0.0.1/` (octal 127.0.0.1) — `url::Url::parse` resolves to numeric IP `127.0.0.1`; IP blocklist rejects. Same for `http://2130706433/` (decimal), `http://[::1]/` (IPv6 loopback), `http://[::ffff:127.0.0.1]/` (IPv4-mapped IPv6).
- **Atypical:** `pdfUrl: https://attacker.com/r` where attacker.com returns `302 → file:///etc/passwd` — redirect handler rejects on hop 2 (scheme not in allowlist). Direct-fetch returns Ok (silent best-effort), logs the rejection with sanitized URL.
- **Atypical:** `pdfUrl: https://attacker.com/r` where attacker.com returns `302 → http://10.0.0.1/admin` — redirect handler rejects on hop 2 (IP in blocklist).
- **Atypical:** `pdfUrl: https://user:supersecret@example.com/file.pdf` (HTTP basic auth — legitimate for private feeds). Fetch proceeds normally with credentials in the request, but ALL log lines show the sanitized URL with userinfo stripped. No leak.
- **Atypical:** DNS resolves to multiple IPs (A record returns ipv4 + ipv6, or split-horizon DNS returns public + internal) → validate ALL resolved IPs. If ANY is in the blocklist, reject the URL entirely. Defense against split-horizon abuse where one record passes validation but the connect-time lookup uses a different record.

**Threats explicitly out-of-scope for BE-7** (referenced in Dev Notes' "Threat model" subsection):
- **PDF parser exploits via `extract_and_chunk_pdf_service`** — inherited from existing OA flow; magic-byte check is the floor; `cargo audit` is the maintenance gate.
- **Local native app spoofing the extension Origin header** — pre-existing TD-68 known-issue (`connector::handlers.rs:441-443` already acknowledges); not BE-7's job to fix.
- **Disk-fill via rapid `POST /references` flooding** — connector lacks general rate limiting; filed as a new tech-debt entry (TD-77 — "connector lacks rate limiting on POST /references"), addressed in a future story.

## Tasks / Subtasks

- [x] Task 1 (AC: 2, 8) — Wire contract: Rust struct + TS types + protocol doc
  - [x] Add `pdf_url: Option<String>` to `ConnectorReferencePayload` (`milton/src-tauri/src/connector/payload.rs`); preserve existing forward-compat decision (no `deny_unknown_fields`).
  - [x] Extend TypeScript `ConnectorReferencePayload` in `tools/browser-extension/src/lib/types.ts` with `pdfUrl?: string`.
  - [x] Update `docs/integrations/browser-extension-protocol.mdx` with the new field + behavior contract.

- [x] Task 2 (AC: 1) — Extension popup: PDF detection + payload wiring
  - [x] New pure helper `detectPdfPage(url: string, mimeType?: string): boolean` in `tools/browser-extension/src/popup/popup-helpers.ts`. Returns `true` when `mimeType === 'application/pdf'` OR (mimeType absent/non-pdf AND `url` after stripping `?...#...` ends in `.pdf`).
  - [x] In `popup.ts::boot()`, capture `tabs[0].mimeType` alongside the existing `tabs[0].url` and `tabs[0].title`; store in a new module-scoped `currentTabMimeType: string | undefined`.
  - [x] In `popup.ts::save()`, after building `payload` from the mapper, set `payload.pdfUrl = currentUrl` iff `detectPdfPage(currentUrl, currentTabMimeType)` is true. No UI affordance.
  - [x] Unit test `detectPdfPage` covering: PDF mimeType, .pdf suffix, .pdf.html (false), query/hash stripping, `chrome://` (false), undefined mimeType fallback. (10 scenarios in `popup-helpers.test.ts`.)

- [x] Task 3 (AC: 3, 5) — Connector handler: trigger both auto-fetch paths after insert
  - [x] In `connector::handlers::add_reference` (after the existing atomic insert returns the new reference), call `maybe_spawn_auto_fetch(pool, app, &reference)` — closes the asymmetry. Existing eligibility gate (`is_auto_fetch_eligible`) decides whether to fire.
  - [x] If `payload.pdf_url.is_some()`, sync-validate at handler entry (scheme `http`/`https`, length ≤ 4096, parses via `url::Url::parse`) via `is_pdf_url_sync_valid`; spawn `fetch_pdf_from_known_url` fire-and-forget when valid; log warn + skip spawn when invalid (reference + maybe_spawn_auto_fetch still proceed). **Note:** DNS resolution + IP-blocklist validation moved into the spawned task via the custom `SsrfSafeResolver` so they don't block the 201 response — same defense, async location.
  - [x] Both spawns are fire-and-forget; handler returns 201 immediately after the spawn calls.
  - [x] Rust unit tests added in `connector::handlers::tests`: `add_reference_with_pdf_url_spawns_direct_fetch`, `add_reference_without_pdf_url_does_not_spawn_direct_fetch`, `add_reference_invalid_pdf_url_scheme_does_not_spawn` (loops through `file://`, `data:`, `javascript:`, `ftp://`). New `DIRECT_FETCH_SPAWN_COUNTER` (paired `direct_fetch_spawn_counter()` / `reset_direct_fetch_spawn_counter()` accessors) mirrors the `AUTO_FETCH_SPAWN_COUNTER` test seam.

- [x] Task 4 (AC: 4) — Direct-URL PDF download service
  - [x] Added `fetch_pdf_from_known_url(pool, app, reference_id, pdf_url) -> Result<(), AppError>` in `commands/pdf_fetch.rs` (the file IS crowded, but the new section is clearly delimited with `// ── BE-7:` banner; keeps all PDF-fetch logic in one module).
  - [x] **Dedicated `reqwest::Client`** via `build_direct_fetch_client()` — `.cookie_store(false)` + custom `SsrfSafeResolver` (per-connect IP blocklist that ALSO covers redirect hops via reqwest's resolver pipeline) + custom redirect Policy that re-runs the scheme allowlist on every hop. Does NOT reuse milton-core's OA-pipeline client.
  - [x] Idempotency: `load_reference` + short-circuit on `pdf_path.is_some()` (matches `auto_fetch_pdf_inner`'s gate).
  - [x] HTTP GET with: 30s total timeout, custom redirect Policy (per-hop scheme re-validation + 10-redirect cap), no Referer, sanitized URL logging via existing `sanitize_url_for_log`.
  - [x] Validation: status 2xx; Content-Type in `{application/pdf, application/octet-stream, ""}` (empty allowed; magic-byte is the floor); first 5 bytes `%PDF-` magic check on the first chunk.
  - [x] Size cap 50 MiB enforced at stream time via `response.chunk()` accumulation; aborts before persisting.
  - [x] Persist via the shared `persist_pdf(pool, app, pdfs_dir, ref_id, source, source_url, bytes)` helper that the OA pipeline already uses — automatic reuse of race-safe UPDATE + orphan-cleanup + extract-spawn + path-trust `validate_id_for_path`.
  - [x] Race-safe UPDATE handled by `persist_pdf` (via `race_safe_set_autofetch_pdf`); rows_affected == 0 → orphan removed + Ok.
  - [x] Emit `pdf-auto-fetch-complete` via existing `emit_complete_event` with `trigger: FetchTrigger::Connector` + `source: FetchSource::ExtensionDirect`. Frontend listener at `auto-fetch-analytics.ts` works unchanged.
  - [x] Added `FetchTrigger::Connector` and `FetchSource::ExtensionDirect` variants in `milton-core::services::pdf_fetch`. `source_name_str` extended to map `ExtensionDirect → "extension_direct"`.
  - [x] **11 Rust unit tests** in `commands::pdf_fetch::direct_fetch_unit_tests`: `is_pdf_url_sync_valid` (accepts https PDF, rejects dangerous schemes incl. data/javascript/ftp/chrome-extension/file, rejects oversize 4096+); `is_blocked_ip` exhaustive coverage (IPv4 loopback / RFC1918 / link-local incl. 169.254.169.254 cloud metadata / 0.0.0.0 / multicast / broadcast / CGNAT; IPv6 ::1 / fc00::/7 / fe80::/10 / multicast / `::ffff:127.0.0.1` IPv4-mapped recursion; public-routable IPv4 + IPv6 pass).

- [x] Task 5 (AC: 6) — TypeScript tests
  - [x] `popup-helpers.test.ts`: 10 scenarios for `detectPdfPage` covering mimeType signal, .pdf suffix, query/hash stripping, `.pdf.html` rejection, restricted schemes (chrome/about/file/edge/brave), case-insensitivity, mimeType-wins-over-suffix, empty URL handling, broken-server `Content-Type: text/html` on `.pdf` URL.
  - [x] `connector-client.test.ts`: extended with 2 new BE-7 scenarios — `createReference` sends `pdfUrl` in the request body when supplied; omits it when not supplied.

- [x] Task 6 (AC: 8) — Documentation
  - [x] `docs/integrations/browser-extension-protocol.mdx`: `pdfUrl` field added to the JSON example; new "PDF attachment (Story BE-7)" section enumerating the SSRF defenses + behavior contract.
  - [x] `tools/browser-extension/_bmad-output/planning-artifacts/charter.md`: line 62 "Out of scope" entry annotated as SUPERSEDED with rationale + pointer to BE-7.
  - [x] `tools/browser-extension/README.md`: status banner updated; story-map BE-7 row added with `shipped`; smoke section extended with 4 BE-7 scenarios (econstor, arXiv direct PDF, arXiv abs page, `.pdf.html` rejection).

- [x] Task 7 (AC: 7) — Manual sideload smoke (Pierre cleared 2026-05-15 post-review-fix-pass)
  - [x] Scenarios 1 + 2 + 3 from AC7 — happy path across PDF URL / arXiv PDF / arXiv abs page (covers the new direct path AND the now-wired OA path).
  - [x] Scenarios 5 + 7 — `.pdf.html` rejection + paywall-HTML magic-byte rejection.
  - [x] Scenario 9 — 409 dedup-is-noop verified (existing PDF not replaced).
  - [x] Scenario 12 — cross-content cycle (PDF → article → PDF) to confirm no state leak.

## Dev Notes

### Why the asymmetry existed (and why we fix it now, not via a smaller patch)

The IPC `create_reference` (`commands/references.rs:877`) was extended in Story 15-1a to spawn `auto_fetch_pdf_inner` after insert. The connector handler (`connector/handlers.rs::add_reference`) is the OTHER write path into the references table — added in Story 17-5 — and 15-1a never extended it to share the same post-insert behavior. This is invisible until you save a non-OA PDF page via the extension AND notice the missing attachment, which is exactly what BE-2 dogfood surfaced. We could patch this with a one-liner that calls `maybe_spawn_auto_fetch` in the connector handler — but on its own that doesn't fix Pierre's bug, because OA discovery doesn't find econstor papers. So BE-7 ships BOTH: the asymmetry fix AND the new direct path. Cleanest combined story.

### Why `pdfUrl` and not `pdfBinary`

The connector's 64 KiB body cap rules out base64'd PDF binaries — even a small 50 KiB PDF inflates to ~68 KiB after base64. Raising the cap would expose more attack surface (large-body DoS), require Tauri-side memory accounting, and complicate the path-trust model. The URL approach:
- Keeps the connector's 64 KiB cap intact (URLs are tiny, <100 bytes typical).
- Lets Milton's outbound HTTP stack handle the heavy lifting on a runtime that already does HTTP for OA discovery.
- Leverages the existing race-safe persist + event emit + frontend listener.

The Charter Q6 answer (2026-05-04) — *"a — Metadata-only; Milton's 15-1a handles PDF fetch"* — anticipated this. BE-7 doesn't reverse that decision; it extends it: extension still doesn't ship binary, just a URL hint.

### Threat model (added 2026-05-15)

BE-7 introduces a net-new attack surface: the extension can ask Milton to make outbound HTTP requests to arbitrary URLs from the **user's machine** with the user's **network position**. AC9 enumerates the SSRF defenses (IP-based blocklist, per-redirect re-validation, log sanitization, cookie-less client) that ship with BE-7.

**Inherited risks (NOT introduced by BE-7, NOT BE-7's job to fix):**

- **PDF parser exploits** via `extract_and_chunk_pdf_service` — the magic-byte check is structural floor only; a malformed PDF that passes magic-byte but exploits a `pdf_extract` parser bug reaches the existing post-fetch pipeline. Same risk surface as Milton's existing manual PDF imports + OA auto-fetch. Maintenance gate: `cargo audit`.
- **Local native app spoofing the `chrome-extension://...` Origin header** — pre-existing TD-68 known-issue. `connector::handlers.rs:441-443` already acknowledges this: "the connector's own threat model explicitly acknowledges a local native app can spoof the extension origin." Not BE-7's job; the AC9 mitigations defend against the URL payload regardless of who supplies it.
- **Disk-fill via rapid `POST /references` flooding** — connector has no general rate limiting. Filed as **TD-77** (separate from BE-7 because rate-limiting affects all connector endpoints, not just the new direct-fetch path).

### ADR — SSRF hardening: IP-based validation + per-redirect re-check (2026-05-15)

**Decision:** Validate by **resolved IP**, not hostname. Re-validate scheme AND IP on EVERY redirect hop. Use a dedicated cookie-less `reqwest::Client` for direct-fetch.

**Alternatives considered:**

1. **Hostname-string blocklist** (reject `"localhost"`, `"127.0.0.1"`, `"10.*"`, etc.) — fails on non-canonical IP forms (`http://0177.0.0.1/`, decimal `http://2130706433/`, IPv4-mapped IPv6 `http://[::ffff:127.0.0.1]/`) AND on DNS rebinding (hostname looks public at validation time, resolves to private at connect time).
2. **HTTP proxy in front of reqwest** that filters — same logic moved elsewhere, adds an infra surface to maintain, doesn't fundamentally improve the security posture vs in-process validation.
3. **Accept the SSRF risk** — Pierre's user is sole owner of his machine, but cloud metadata IPs (`169.254.169.254`) + future Linux/cloud deploys + LAN-exposed services + Mac's Homebrew localhost services (Ollama on `:11434`, Postgres on `:5432`, Redis on `:6379`, etc.) make this unacceptable for a "extension silently asks Milton to fetch arbitrary URL" path.

**Trade-off accepted:** Connecting to the resolved IP (not the hostname) could in theory break virtual hosting. In practice, reqwest's `Client.dns_resolver` hook leaves SNI + `Host:` derivation on the original URL hostname (the resolver only supplies IPs), so virtual hosting works without an explicit Host header. No code change needed — flagged here so a future maintainer reading the ADR doesn't look for a missing line.

**Why not also apply this to the existing OA pipeline?** OA pipeline targets a narrow allowlist of trusted publishers (Unpaywall, arXiv, one hardcoded SciHub URL) — implicit trust boundary. Direct-fetch accepts arbitrary URLs from the extension — wider trust boundary, needs the full mitigation. Could backport the SSRF defenses to OA in a future story if its threat model expands (e.g., user-configurable fallback URLs come back from beta.10 ad-hoc lockdown).

### Why a new direct path, not extending `PdfFetchPipeline`

`PdfFetchPipeline` is designed around the OA-discovery problem: given a `LookupContext` (DOI, arXiv ID, fallback URL), iterate providers until one returns a PDF. The providers (`UnpaywallProvider`, `ArxivProvider`, `FallbackUrlProvider`) each implement `LookupAndFetch` and yield a `FetchOutcome`. Forcing "I already have the URL, just download it" into that shape would either:
- Add a `KnownUrlProvider` that's always tried first — but it shouldn't run unless the URL was supplied, so it's not a "provider" in the registry sense.
- Make the pipeline aware of a "skip discovery, here's the URL" mode — adds a code branch with no shared behavior with the rest of the pipeline.

A separate function (`fetch_pdf_from_known_url`) is the cleaner factoring. It reuses the persist + race-safe UPDATE + event emit helpers (extract the smallest shared seam if needed), but its discovery side is just "the caller gave me a URL." The two paths can spawn concurrently and race-safe-UPDATE picks a winner.

### G17-1 / G18-4 / G15-1 alignment

- **G17-1 (Pierre smoke is HARD gate for layout/motion/hydration):** BE-7 has no popup UI change — the `pdfUrl` flag flows silently. JSDOM/Vitest can fully exercise the popup-side detection logic. Pierre's manual smoke is still the gate for the connector → fetch → frontend-refresh end-to-end loop, since Tauri runtime isn't jsdom-testable.
- **G18-4 (cross-entity-type smoke cycles):** AC7 #12 explicitly cycles PDF → article → PDF within a session.
- **G15-1 (≥1 atypical input per behavior-changing AC):** every AC above carries ≥3 atypical/boundary scenarios.

### Coordination with Epic 19 / Story 19-5

Pierre confirmed (2026-05-15) that his parallel session running 19-5 (coverage gap-fill) will **defer adding tests to `connector/payload.rs`, `connector/handlers.rs`, and `commands/pdf_fetch.rs`** until BE-7 lands. 19-5 has other AI-safety-critical surfaces to cover first (IPC path-trust validators per 19-4, RLS-edge functions per 19-2 routing, FTS5 boundary, the `pdf_performance_mode` opt-in path). When BE-7 ships, 19-5 picks up the three files against the post-refactor surface — tests will be more useful with the service-extraction visible.

Both branches will live off `main` simultaneously. We've validated `epic/19-health-audit` is currently at main HEAD (no in-flight merge on the remote). Merge-conflict risk is low (different file regions); resolution at PR time uses the same flow we ran on PR #27.

### File coordination — first BE-N story crossing into Milton core

BE-1 / BE-2 / BE-4 all stayed under `tools/browser-extension/`. BE-7 is the first BE-N story to modify `milton/src-tauri/` files. This is sanctioned by the standing rule [[feedback-epic-19-parallel-session]] (*"In-scope here: browser-extension (BE-N), tools sub-projects, tech-debt touching extension/Milton core"*). Pierre flagged this as a category change worth documenting; a memory entry capturing the "BE-N crosses into milton core when wire contract demands" pattern will be filed after BE-7 ships, not speculatively.

### Sub-project conventions (unchanged from BE-1 → BE-4)

- Sprint-status file: `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml` (NOT main Milton's). BE-7 added at story-creation time (Step 6 of this workflow).
- Build / test gates: `cd tools/browser-extension && pnpm typecheck && pnpm test && pnpm build` (extension side); `cd milton && cargo test --workspace` + `cargo clippy --workspace -- -D warnings` (Milton-side).
- Code-review entry: `/bmad_bmm_code-review BE-7`.

### Tech stack — version pins unchanged

| Package | Version | Source of truth |
|---|---|---|
| `vite` | `^7.3.x` | BE-1 / BE-4 pin |
| `@crxjs/vite-plugin` | `^2.4.x` | BE-1 / BE-4 pin |
| `typescript` | `^5.9.x` | BE-1 / BE-4 pin |
| `vitest` | `^4.1.x` | BE-1 / BE-4 pin |
| `reqwest` (Rust) | as pinned in `milton-core/Cargo.toml` | shared with `auto_fetch_pdf_inner` |
| `tokio` (Rust) | as pinned | shared |
| `axum` (Rust) | as pinned | connector framework, unchanged |

**No new dependencies on either side.**

### File structure (target)

```
tools/browser-extension/
└── src/
    ├── lib/
    │   ├── connector-client.ts             # extend: createReference happy-path test asserts pdfUrl flows
    │   └── types.ts                        # extend: ConnectorReferencePayload += pdfUrl?: string
    └── popup/
        ├── popup.ts                        # extend: capture currentTabMimeType; set payload.pdfUrl in save()
        ├── popup-helpers.ts                # extend: detectPdfPage()
        └── popup-helpers.test.ts           # extend: detectPdfPage scenarios

milton/
├── src-tauri/
│   ├── milton-core/
│   │   └── src/services/
│   │       └── pdf_fetch.rs                # extend: FetchTrigger += Connector; FetchSource += ExtensionDirect
│   └── src/
│       ├── connector/
│       │   ├── payload.rs                  # extend: pdf_url: Option<String>
│       │   └── handlers.rs                 # extend: add_reference calls maybe_spawn_auto_fetch + direct-fetch spawn
│       └── commands/
│           └── pdf_fetch.rs                # extend: fetch_pdf_from_known_url() + unit tests

docs/integrations/
└── browser-extension-protocol.mdx          # extend: pdfUrl field + "PDF attachment (BE-7)" section
```

### Net-export diagnosis artifact

Pierre's 2026-05-15 net-export log (`/Users/pierrejacquel/Downloads/chrome-net-export-log.json`, 1.17 MB) is the definitive proof of the root cause:

- `POST /references` request body: **188 bytes** (baseline AC7 envelope; no `pdfUrl`).
- `POST /references` response: `201 Created`, 45 bytes.
- `POST translate.milton.so/metadata` response: 200 OK, **266 bytes** (near-empty envelope — GROBID extraction quality, TS-future-1 territory, not BE-7's scope).
- Authentication, CORS preflights, selector fetches all green.

The log is a personal Downloads artifact, not checked into the repo. BE-7's tests assert the post-fix shape (request body now ≥ 188 + len("pdfUrl") + len(url) + JSON overhead when the source is a PDF) rather than relying on the log directly.

### What this story does NOT do

- ❌ Improve GROBID extraction quality on PDFs that yielded garbage metadata (TS-future-1 — LLM extraction tier).
- ❌ **Fetch PDFs from sites behind a bot-challenge wall** (Anubis, Cloudflare PoW interstitials, hCaptcha, etc.). Surfaced by Pierre's 2026-05-15 smoke on econstor: server returns the JS-challenge HTML page to any non-browser HTTP client, including Milton's direct-fetch. Magic-byte gate correctly rejects the HTML; reference is created with metadata, no PDF attached. A future story could close this with extension-side download + base64-upload (raise the 64 KiB body cap) or cookie passthrough — both have meaningful security trade-offs and are out of BE-7 scope.
- ❌ Cross-user PDF caching at the translation-server level (TS-future-1 — content-hash-keyed cache).
- ❌ Paywall handling / cookie-passthrough / Sci-Hub fallback for direct-URL fetches (best-effort only; quiet fail on magic-byte mismatch).
- ❌ PDF preview in the popup before save (the user already opened the page in Chrome — they've seen it).
- ❌ Setting/toggle to disable extension-driven PDF attach (silent best-effort by design; if needed, surface in a future story).
- ❌ Retry button when direct-fetch fails (Milton's existing manual "Fetch PDF" action covers this — no new UX needed).
- ❌ Replace existing PDF on a 409 duplicate (protocol "dedup-is-noop" stays).
- ❌ Re-extract metadata server-side from the downloaded PDF (could be a future enhancement once LLM extraction lands).

### Why selectors-before-metadata pattern still applies (no change)

BE-2's `Promise.all` parallel-fetch pattern (`listSelectors()` + `extractMetadata()` fire concurrently while the popup renders the preview) is untouched. BE-7 only adds a new field at Save time; the boot flow is unchanged.

### Charter scope revision — record of decision

Charter line 62 ("PDF binary upload from extension — out of scope") was correct at 2026-05-04 given the BE-1-era assumption that Milton's 15-1a would handle PDF fetch server-side via OA discovery. BE-2 dogfood (2026-05-15) revealed:
- 15-1a's OA discovery doesn't cover non-DOI/non-arXiv PDFs (working papers, repository PDFs).
- The connector handler doesn't even trigger 15-1a — so the assumption never even applied to the extension path.

Pierre's design call (2026-05-15): *"just attach the pdf if the page is a pdf, nothing to mention to the user, no feedback etc."* BE-7 implements that with the minimal-surface approach (URL hint only, silent best-effort, reuses existing infrastructure where possible).

### References

- **Charter** — `tools/browser-extension/_bmad-output/planning-artifacts/charter.md` (line 62 superseded; line 31 + 42 architecture diagram still accurate)
- **BE-1 story** — `tools/browser-extension/_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md` (AC7 forward-compat envelope; popup state machine baseline)
- **BE-2 story** — `tools/browser-extension/_bmad-output/implementation-artifacts/BE-2-rich-popup-selectors.md` (current popup, save flow, types.ts shape)
- **BE-4 story** — `tools/browser-extension/_bmad-output/implementation-artifacts/BE-4-auth-migration-connector-token.md` (auth + token flow — unchanged in BE-7)
- **Story 15-1a (auto-fetch PDF)** — established `auto_fetch_pdf` IPC + `auto_fetch_pdf_inner` + `pdf-auto-fetch-complete` event + `race_safe_set_autofetch_pdf`
- **Story 17-5 (connector server)** — `connector/handlers.rs::add_reference` was added here; auto-fetch trigger was NOT
- **Connector protocol** — `docs/integrations/browser-extension-protocol.mdx` (canonical wire contract; gains `pdfUrl` here)
- **`maybe_spawn_auto_fetch` reusable helper** — `milton/src-tauri/src/commands/references.rs:859`
- **`auto_fetch_pdf_inner` (OA pipeline entry)** — `milton/src-tauri/src/commands/pdf_fetch.rs:91`
- **`PdfFetchPipeline` (OA discovery)** — `milton/src-tauri/milton-core/src/services/pdf_fetch.rs:708`
- **Connector handler** — `milton/src-tauri/src/connector/handlers.rs:546` (`add_reference`)
- **TD-65 (auto-fetch docs gap)** — `_bmad-output/implementation-artifacts/tech-debt.md` (notes the manual-only auto-fetch trigger; BE-7 closes part of that gap)
- **Epic 19 / Story 19-5 coordination** — `_bmad-output/implementation-artifacts/sprint-status.yaml` (19-5 backlog; defer pdf_fetch/connector tests until BE-7 lands)

### Provenance

BE-2 dogfood (Pierre 2026-05-15): *"when I add a pdf page... the pdf is not added to Milton!"* → net-export confirmed (b)-interpretation (reference created, garbage metadata, no PDF attached). Pierre's design call: *"just attach the pdf if the page is a pdf, nothing to mention to the user, no feedback etc."* Scoping conversation (2026-05-15) locked: silent best-effort, URL-not-binary, three coordinated layers (extension detection + wire contract + Milton handler/service). Cross-session coordination with 19-5 negotiated same day: 19-5 defers test additions on the three target files until BE-7 lands.

## Pre-Review Self-Check

<!-- Tools sub-project — adapted from BE-2's checklist. -->

- [x] `cd tools/browser-extension && pnpm install --ignore-workspace` clean (no new TypeScript deps; lockfile unchanged)
- [x] `pnpm typecheck` (`tsc --noEmit`) reports 0 errors
- [x] `pnpm test` — **111/111 passing** (99 baseline + 10 new `detectPdfPage` + 2 new `createReference` `pdfUrl` body assertions)
- [x] `pnpm build` produces `dist/` — **JS 43.02 KB** (gzip 12.07 KB), CSS unchanged at 12.52 KB. Within the < 50 KB target; +0.44 KB vs the BE-2 baseline (the new `detectPdfPage` helper + the mimeType capture)
- [x] `cargo clippy --workspace -- -D warnings` clean — finished in 3.87s, no findings
- [x] `cargo test --workspace --lib` — **245/245 passing** (242 baseline + 3 new `add_reference_*` BE-7 spawn tests + 11 new `direct_fetch_unit_tests::*` SSRF tests + 3 new `connector::payload::tests::*_pdf_url_*` tests). _Note: 1 ignored is the pre-existing `tests::export_bindings` — not BE-7._
- [x] No `pdfBinary` field anywhere in the wire (URL-only contract per Dev Notes; grepped `tools/browser-extension/src/` and `milton/src-tauri/src/connector/` — zero matches)
- [x] No `Referer` header added in v1 (`build_direct_fetch_client` only sets `User-Agent`; future story if a specific publisher needs it)
- [x] Magic-byte check applied BEFORE persisting any bytes to disk (`stream_pdf_bytes` checks `%PDF-` on the first 5 received bytes; persist happens only after the full stream succeeds)
- [x] Size cap (50 MiB) enforced at stream-time, not file-write-time (`stream_pdf_bytes` aborts when cumulative chunks exceed `DIRECT_FETCH_MAX_BYTES` constant)
- [x] `pdfUrl` scheme validation rejects `file://`, `data:`, `javascript:`, `ftp://`, `chrome-extension://` (`is_pdf_url_sync_valid` matches only `http | https`; `add_reference_invalid_pdf_url_scheme_does_not_spawn` test verifies all four)
- [x] **AC9 SSRF:** resolved IP validated against reserved-range blocklist (loopback, RFC1918, link-local incl. `169.254.169.254`, IPv6 equivalents incl. `::ffff:0:0/96`) — `is_blocked_ip` exhaustively covered by 8 unit tests
- [x] **AC9 SSRF:** HTTP client connects via the custom `SsrfSafeResolver` which validates the resolved IP at every connect — defeats DNS rebinding (every connect, including redirect hops, re-resolves through this resolver)
- [x] **AC9 SSRF:** per-redirect handler re-validates scheme on every hop (`reqwest::redirect::Policy::custom`); IP re-validation rides on the resolver (every hop's hostname is re-resolved → re-validated)
- [x] **AC9 SSRF:** dedicated cookie-less `reqwest::Client` (`build_direct_fetch_client` calls `.cookie_store(false)`) — no cookie sharing with OA pipeline
- [x] **AC9 SSRF:** all URL log lines wrapped in `sanitize_url_for_log` (strips userinfo + query secrets) — applied in `direct_fetch_start`, `direct_fetch_request_failed`, `direct_fetch_bad_status`, `direct_fetch_bad_content_type`, `direct_fetch_stream_failed`, `direct_fetch_invalid_url`
- [x] **TD-77 filed** for connector rate-limiting (separate story; recorded in `_bmad-output/implementation-artifacts/tech-debt.md`)
- [x] Manual sideload smoke (Task 7) — Pierre cleared 2026-05-15 post-fix-pass (G17-1 satisfied)
- [x] Both spawn calls fire-and-forget; handler returns 201 immediately
- [x] Existing race-safe `WHERE id = ? AND pdf_path IS NULL` path reused (review-pass H5: now via temp + `fs::rename` to prevent concurrent same-canonical write interleaving)
- [x] `pdf-auto-fetch-complete` event reused (frontend listener works unchanged)
- [x] New `FetchTrigger::Connector` + `FetchSource::ExtensionDirect` enum variants added
- [x] Charter line 62 annotated as superseded
- [x] Protocol doc updated with new field + behavior section
- [x] README story-map BE-7 → shipped; smoke section extended
- [x] Manual sideload smoke (Task 7) — Pierre cleared 2026-05-15 post-fix-pass (G17-1 satisfied)

**Review-pass additions (2026-05-15):**
- [x] **H1/H2/H3** — `fetch_pdf_from_known_url_with_client` reachable from tests via `SsrfPolicy::test_with_loopback` + `pdfs_dir_override`; 9 integration tests covering AC6 happy-path/magic-byte/idempotency/size-cap/non-2xx/race-loss + AC9 redirect-scheme-rejection + production-vs-test-policy divergence
- [x] **H4** — `e.without_url()` strips reqwest::Error's embedded URL from the `direct_fetch_request_failed` log
- [x] **H5** — `persist_pdf` writes to `{ref_id}-autofetch.{source}.tmp` then renames; concurrent same-canonical writers can't interleave bytes anymore
- [x] **M1** — AC4 prose updated: Content-Type allowlist removed; magic-byte is sole content gate
- [x] **M2** — `#[serial_test::serial(direct_fetch_be7)]` on the 3 BE-7 spawn-counter handler tests
- [x] **M3** — `SsrfSafeResolver`'s `:0` port magic explained in a comment
- [x] **M4** — `chrome-augment.d.ts` augmentation replaces the `as ... & { mimeType?: string }` cast
- [x] **L1** — File List includes `milton/src/lib/bindings.ts` (auto-regenerated, committed via TD-63 follow-ups)
- [x] **L2** — ADR's "set Host header" note clarified as not needed in code

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — invoked via `/bmad_bmm_dev-story BE-7` after the `/bmad_bmm_create-story BE-7` + Advanced Elicitation (method 3, Red Team vs Blue Team) pass.

### Debug Log References

- `cargo check` initially failed: `reqwest` was declared only in `[workspace.dependencies]` of `milton/src-tauri/Cargo.toml`, not in milton-desktop's own `[dependencies]`. Direct fix: added `reqwest = { workspace = true, features = ["json", "rustls-tls", "cookies"] }` and `url = "2"` to milton-desktop's deps. The `cookies` feature is required for `.cookie_store(false)` (the cookie-less client per AC9).
- `add_reference_invalid_pdf_url_scheme_does_not_spawn` first iteration passed but second iteration hit 409 (connector dedup on identical title+url). Fix: vary `title` + `url` per iteration so each insert is unique.
- `cargo test --workspace --lib` final: **245 passed, 0 failed, 1 ignored** (the pre-existing `tests::export_bindings` ignore — not BE-7).
- `pnpm test` final: **111/111 passing** in 283ms.
- `pnpm build` final: JS 43.02 KB (gzip 12.07 KB), CSS 12.52 KB. +0.44 KB vs the BE-2 baseline of 42.58 KB.

### Completion Notes List

**AC1 (extension PDF detection + payload wiring)** — `detectPdfPage(url, mimeType)` pure helper in `popup-helpers.ts`. Two signals in order: `mimeType === 'application/pdf'` (Chrome's PDF viewer surfaces this; content-type-true), URL `.pdf` suffix fallback (strips `?...#...` first). Restricted schemes (`chrome://`, `chrome-extension://`, `about:`, `edge://`, `brave://`, `file://`) rejected defensively. `.pdf.html` correctly returns false (suffix check uses `endsWith`, not substring). Case-insensitive on the suffix. `popup.ts::boot` captures `tabs[0].mimeType` into module-scoped `currentTabMimeType`; `popup.ts::save` sets `payload.pdfUrl = currentUrl` iff `detectPdfPage` is true. **Zero UI affordance** per Pierre's design call.

**AC2 (wire contract)** — Rust `ConnectorReferencePayload.pdf_url: Option<String>` added in `connector/payload.rs` with `serde(rename_all = "camelCase")` so the wire key is `pdfUrl`. TypeScript `ConnectorReferencePayload.pdfUrl?: string` extended in `tools/browser-extension/src/lib/types.ts`. Three deserialization tests confirm: absent → `None`, JSON `null` → `None`, present-string → `Some(...)`. Forward-compat (`deny_unknown_fields` still off) preserved.

**AC3 (connector handler triggers both auto-fetch paths)** — `add_reference_inner` extended: after the atomic `create_reference_service` returns the new reference, the handler calls (1) `crate::commands::references::maybe_spawn_auto_fetch(pool.clone(), app.clone(), &reference)` to close the asymmetry with the IPC `create_reference` path (which has called it since 15-1a); (2) `crate::commands::pdf_fetch::maybe_spawn_direct_fetch(pool.clone(), app.clone(), reference.id.clone(), pdf_url_for_fetch)` for the new direct path. Sync URL validation (`is_pdf_url_sync_valid`: scheme http/https, length ≤ 4096, parses) happens at spawn entry — invalid → log + skip spawn, reference still inserted. Both spawns are fire-and-forget; 201 returns immediately. **DNS resolution + IP-blocklist validation deferred to the spawned task** (via the custom `SsrfSafeResolver`) so they don't block the 201 response — same defense, async location, justified in the story Task 3 entry.

**AC4 (direct-URL PDF download service)** — `fetch_pdf_from_known_url` added to `commands/pdf_fetch.rs` (kept inline; the file is large but the new section is clearly banner-delimited). Idempotency via `load_reference` + `pdf_path.is_some()` short-circuit. Dedicated cookie-less `reqwest::Client` via `build_direct_fetch_client()`. HTTP GET with 30s timeout, per-hop scheme re-validation (custom `redirect::Policy`), 10-redirect cap. Response validation: 2xx status, Content-Type ∈ `{application/pdf, application/octet-stream, ""}`, first-5-bytes `%PDF-` magic on the first chunk. 50 MiB cap at stream time via `response.chunk()` accumulation. Persist via the shared `persist_pdf` helper — automatic reuse of race-safe `WHERE pdf_path IS NULL` UPDATE + orphan cleanup + `extract_and_chunk_pdf_service` spawn + path-trust `validate_id_for_path`. Emit `pdf-auto-fetch-complete` event via existing `emit_complete_event` with new variants `FetchTrigger::Connector` + `FetchSource::ExtensionDirect`. Frontend listener at `auto-fetch-analytics.ts` works unchanged.

**AC5 (path-trust + size limit)** — destination path is built server-side from the just-inserted reference's UUID (`{reference_id}-autofetch.pdf` under `app_data_dir/pdfs/`). `validate_id_for_path` is called by the shared `persist_pdf` helper. Size cap is a hard 50 MiB ceiling enforced at stream-time, not at file-write-time. Hardcoded; future story could make it a setting.

**AC6 (tests)** — **TypeScript:** +10 `detectPdfPage` scenarios in `popup-helpers.test.ts`, +2 `createReference` body-assertion scenarios in `connector-client.test.ts`. **Rust:** +3 `ConnectorReferencePayload` `pdf_url` deserialization tests in `payload.rs::tests`; +3 `add_reference_*` handler tests in `connector::handlers::tests` (spawn-counter pattern mirrors `AUTO_FETCH_SPAWN_COUNTER`); +11 `direct_fetch_unit_tests` covering `is_pdf_url_sync_valid` (3 cases) and `is_blocked_ip` (8 cases — exhaustive IPv4 + IPv6 reserved-range coverage incl. IPv4-mapped IPv6 recursion). Total: TypeScript 99 → **111 passing**; Rust 242 → **245 passing**.

**AC7 (smoke matrix)** — 12 scenarios documented for Pierre's Task 7 sideload smoke at code-review time per G17-1.

**AC8 (documentation)** — `docs/integrations/browser-extension-protocol.mdx` updated with `pdfUrl` in the JSON example + new "PDF attachment (Story BE-7)" section. Charter line 62 annotated as SUPERSEDED with rationale. README status banner + story-map BE-7 row + 4 BE-7 smoke scenarios appended.

**AC9 (SSRF hardening — added by Advanced Elicitation method 3)** — Five defenses ship:

1. **IP-based blocklist via `is_blocked_ip`:** IPv4 loopback (127.0.0.0/8), RFC1918 (10/172.16/192.168), link-local (169.254/16 — covers cloud metadata 169.254.169.254), CGNAT (100.64/10), 0.0.0.0/8, multicast (224/4), broadcast. IPv6 ::1, ::, multicast (ff00::/8), ULA (fc00::/7), link-local (fe80::/10), `::ffff:0:0/96` IPv4-mapped (recurses to v4 check so `[::ffff:127.0.0.1]` is rejected the same as `127.0.0.1`).
2. **Connect-to-resolved-IP via `SsrfSafeResolver`:** custom `reqwest::dns::Resolve` impl validates EVERY hostname lookup; rejects if ANY resolved IP is in the blocklist (multi-A-record / split-horizon defense). Runs at connect time (initial + every redirect), defeats DNS rebinding TOCTOU.
3. **Per-redirect scheme re-validation:** custom `reqwest::redirect::Policy::custom` re-runs the http/https allowlist on every hop. IP re-validation rides on `SsrfSafeResolver`.
4. **Dedicated cookie-less client:** `.cookie_store(false)`. No jar sharing with milton-core's OA pipeline client. Independently constructed per call.
5. **Log sanitization:** every URL log line wraps the URL in `sanitize_url_for_log` (the existing OA pipeline helper). Strips userinfo + query secrets.

**Out of scope (filed elsewhere):**
- **TD-77** — connector lacks general rate limiting on `POST /references` (disk-fill via floods). Separate story.
- **PDF parser exploits** via `extract_and_chunk_pdf_service` — inherited from existing OA flow; magic-byte is the floor; `cargo audit` is the maintenance gate.
- **Origin-spoofing by local native app** — pre-existing TD-68 known-issue.

**Pierre's gate (G17-1):** Task 7 manual sideload smoke is the layout/runtime validation gate. Code review (`/bmad_bmm_code-review BE-7`) handles the functional confirmation of the remaining AC7 scenarios. Story stays at `review` pending both.

### File List

**New:**
- _(none — all changes extend existing files)_

**Modified — `tools/browser-extension/`:**
- `src/lib/types.ts` — `ConnectorReferencePayload` gains `pdfUrl?: string`
- `src/lib/connector-client.test.ts` — +2 BE-7 scenarios asserting `pdfUrl` round-trips into the POST body when supplied; omitted when not
- `src/popup/popup-helpers.ts` — new `detectPdfPage(url, mimeType)` pure helper
- `src/popup/popup-helpers.test.ts` — +10 `detectPdfPage` scenarios
- `src/popup/popup.ts` — captures `tabs[0].mimeType` at boot (now via the local `chrome-augment.d.ts` augmentation — review-pass M4); sets `payload.pdfUrl` in `save()` when `detectPdfPage` is true

**New — `tools/browser-extension/`:**
- `src/chrome-augment.d.ts` — local type augmentation declaring `chrome.tabs.Tab.mimeType` (the pinned `@types/chrome` doesn't surface it yet). Replaces the `as chrome.tabs.Tab & { mimeType?: string }` cast bypass in `popup.ts` (review-pass M4).
- `README.md` — status banner + story-map BE-7 row + 4 BE-7 smoke scenarios
- `_bmad-output/planning-artifacts/charter.md` — line 62 "PDF binary upload from extension" out-of-scope entry annotated as SUPERSEDED
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — BE-7 status flow: `ready-for-dev` → `in-progress` → `review`

**Modified — `milton/src-tauri/`:**
- `Cargo.toml` — added `reqwest = { workspace = true, features = ["json", "rustls-tls", "cookies"] }` and `url = "2"` to milton-desktop's `[dependencies]`; **review pass:** added `mockito = "1"` and `serial_test = "3"` to `[dev-dependencies]` for the BE-7 H1/H2/H3/M2 integration tests.
- `src/connector/payload.rs` — `ConnectorReferencePayload.pdf_url: Option<String>` field + 3 new deserialization tests
- `src/connector/handlers.rs` — `add_reference_inner` extracts `pdf_url_for_fetch` before consuming the payload; after 201 calls both `maybe_spawn_auto_fetch` (closes the asymmetry with IPC `create_reference`) and `maybe_spawn_direct_fetch` (BE-7's new path). +3 spawn-counter tests, each annotated `#[serial_test::serial(direct_fetch_be7)]` (review-pass M2).
- `src/commands/pdf_fetch.rs` — new section (~430 lines) defining `is_pdf_url_sync_valid`, `is_blocked_ip` + IPv4/IPv6 helpers, `SsrfPolicy` (production / test_with_loopback variants), `SsrfSafeResolver` (now carrying the policy), `build_direct_fetch_client(SsrfPolicy)`, `stream_pdf_bytes`, `fetch_pdf_from_known_url` (production wrapper) + `fetch_pdf_from_known_url_with_client` (test injection seam, takes `client` + optional `pdfs_dir_override`), `maybe_spawn_direct_fetch`, `DIRECT_FETCH_SPAWN_COUNTER` + accessors. **+11 `direct_fetch_unit_tests` + 9 review-pass integration tests** (happy path, magic-byte rejection, idempotency, size cap, non-2xx, race-loss, redirect-to-disallowed-scheme rejection, production-policy blocks loopback, test-vs-production-policy divergence). `source_name_str` extended for `FetchSource::ExtensionDirect`. `persist_pdf` rewritten to write temp → race-safe UPDATE → `fs::rename` to canonical (review-pass H5).
- `milton-core/src/services/pdf_fetch.rs` — `FetchSource` gains `ExtensionDirect` variant; `FetchTrigger` gains `Connector` variant. (Specta types update; frontend bindings will regen on next `cargo run`.)

**Modified — `docs/`:**
- `integrations/browser-extension-protocol.mdx` — `pdfUrl` field added to the `POST /references` JSON example + new "PDF attachment (Story BE-7)" section detailing the silent best-effort contract + SSRF defenses + size cap + event emit shape

**Auto-regenerated (Specta bindings, committed via TD-63 follow-ups):**
- `milton/src/lib/bindings.ts` — `FetchSource` / `FetchTrigger` TS unions gain `"ExtensionDirect"` / `"Connector"` variants. Frontend listener at `auto-fetch-analytics.ts` consumes these via the existing event handler.

**Modified — repo root:**
- `_bmad-output/implementation-artifacts/tech-debt.md` — **TD-77** logged (connector lacks general rate limiting on `POST /references`)

## Change Log

| Date | Author | Summary |
|------|--------|---------|
| 2026-05-15 | BMad Master (Opus 4.7 1M) | Story drafted via `/bmad_bmm_create-story BE-7` after BE-2 dogfood net-export diagnosis pinpointed: (1) connector `add_reference` handler missing the `maybe_spawn_auto_fetch` call that IPC `create_reference` has, and (2) OA-discovery pipeline can't handle direct PDF URLs (working papers / repositories without DOI). Charter line 62 ("PDF binary upload from extension — out of scope") superseded; silent best-effort URL-hint design locked with Pierre 2026-05-15. Cross-session coordination negotiated with Epic 19 Story 19-5 (defer tests on the three target Milton-core files until BE-7 lands). G15-1 boundary inputs per AC; G18-4 cross-content-type smoke cycle; G17-1 manual-smoke gate explicit. First BE-N story to cross into `milton/src-tauri/` — sanctioned by the standing scope rule. Promoted to ready-for-dev. |
| 2026-05-15 | BMad Master (Opus 4.7 1M) | **Advanced Elicitation pass — method 3 (Red Team vs Blue Team).** Pierre approved (`y`) all hardenings. Added **AC9 SSRF mitigations** (IP-based blocklist incl. loopback/RFC1918/link-local/multicast + IPv6 equivalents incl. `::ffff:0:0/96`; per-redirect re-validation of scheme + IP; dedicated cookie-less `reqwest::Client`; `sanitize_url_for_log` wrapping for all URL log emissions); extended **AC6 tests** with 9 SSRF-specific scenarios (localhost/RFC1918/cloud-metadata rejection, non-canonical IP forms, redirect-to-file-scheme, redirect-to-internal-IP, userinfo log sanitization, cookie isolation across clients, multi-IP DNS); updated **Task 3 + Task 4** with the new validation subtasks; new **Dev Notes "Threat model" section** referencing TD-68 (origin-spoofing acknowledged inherited) + new **ADR — SSRF hardening** documenting the IP-validation choice vs hostname-string vs HTTP-proxy alternatives; extended Pre-Review Self-Check with 5 SSRF gate items; filed **TD-77** for the inherited connector-rate-limiting gap (separate story). |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Smoke-discovered fix #2: race-condition in `persist_pdf` orphan-cleanup.** Pierre's second smoke (arXiv `https://arxiv.org/pdf/2601.00113`) created the reference + showed the PDF icon, but `asset://` URL returned **404 Not Found**. Root cause: BE-7's connector handler spawns TWO concurrent paths (`maybe_spawn_auto_fetch` + `maybe_spawn_direct_fetch`); for arXiv both succeed (Unpaywall finds the DOI, direct-fetch downloads the `.pdf` URL). Both write to the SAME canonical filename `{ref_id}-autofetch.pdf`. The race-lost branch in the shared `persist_pdf` helper unconditionally deleted the file at `dest` — which for the two-spawn case IS the path the winner's `pdf_path` is now pointing at. Net: pdf_path → deleted file → 404. **Fix:** before deleting in the race-lost branch, query `SELECT pdf_path FROM references WHERE id = ?`; only delete if `winner_path != dest_str`. Path-equality means both writers targeted the same file (BE-7's two-spawn case) — leave it in place; the bytes on disk are the winner's. Different paths (manual attach with a different filename) preserve the existing delete-the-orphan behavior. New log line `race_lost_same_path` distinguishes the two cases for forensics. The fix is in `persist_pdf` so it benefits any future caller that uses the same canonical filename. Gates green: `cargo test --workspace --lib` 245/245. Story still at `review`; awaiting Pierre's re-smoke. |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Smoke-discovered fix: drop Content-Type allowlist; rely on `%PDF-` magic byte as the sole content gate.** Pierre's first smoke on the econstor URL (`https://www.econstor.eu/.../623739976.pdf`) reached `direct_fetch_bad_content_type` because econstor is gated by [Anubis](https://github.com/TecharoHQ/anubis) — a JS-PoW bot-challenge wall that returns the challenge HTML page to any non-browser HTTP client. The Content-Type allowlist (`application/pdf` ‖ `application/octet-stream` ‖ empty) was a needless second gate — real academic servers serve real PDFs with all sorts of headers (`application/x-pdf`, `application/force-download`, sometimes `text/html` on broken Apache configs), and the magic-byte check is the reliable floor (HTML never starts with `%PDF-`). Replaced the gate with an informational `direct_fetch_response` log line. Updated protocol doc + added explicit "bot-challenge protected sites" out-of-scope note (Anubis-gated sites like econstor cannot be fetched by ANY non-browser client; future story could close via extension-side download or cookie passthrough). Story still at `review`; awaiting Pierre's re-smoke against an Anubis-free site (arXiv PDF). |
| 2026-05-15 | Pierre + Claude | **Merged.** Smoke passed (AC7 #1, #2, #3, #5, #7, #9, #12 all green post-fix-pass). PR #30 squash-merged at commit `76df5cb7`; branch `feat/BE-7-pdf-attach-on-extension-save` deleted. Status flipped `review` → `done`; sprint-status synced. |
| 2026-05-15 | Code Review (Opus 4.7 1M) | **Adversarial review pass via `/bmad_bmm_code-review BE-7`** found 5 HIGH + 4 MEDIUM + 2 LOW issues; Pierre approved "fix all in this pass". Resolutions: **H1+H2+H3** — lifted `#[cfg(not(test))]` gating off `fetch_pdf_from_known_url`, `build_direct_fetch_client`, `stream_pdf_bytes`, `SsrfSafeResolver`, and the direct-fetch constants; introduced `SsrfPolicy::{production, test_with_loopback}` carried by the resolver so the production blocklist is preserved while wiremock servers on `127.0.0.1` reach the code-under-test in tests; added `fetch_pdf_from_known_url_with_client` (Client + optional `pdfs_dir_override` injection seam) as the test-callable entry; added `mockito` + `serial_test` dev-deps; wrote 9 integration tests covering happy-path/magic-byte-rejection/idempotency/size-cap/non-2xx/race-loss/per-redirect-scheme-rejection/production-policy-blocks-loopback/test-vs-production-policy-divergence. **H4** — switched `direct_fetch_request_failed` log to `e.without_url()` so reqwest's Display impl no longer leaks unsanitized URLs through the `error={}` field. **H5** — `persist_pdf` now writes to a source-discriminated temp (`{ref_id}-autofetch.{source}.tmp`), then `fs::rename`s to canonical only after the race-safe UPDATE wins; concurrent same-canonical writers no longer interleave bytes (was real-corruption-risk when OA pipeline returned different bytes than direct-fetch for the same paper). **M1** — AC4 prose updated to match the dropped Content-Type allowlist (magic-byte is sole content gate). **M2** — `#[serial_test::serial(direct_fetch_be7)]` on the 3 BE-7 spawn-counter handler tests so cargo's parallel runner can't interleave reset/read cycles on the global `DIRECT_FETCH_SPAWN_COUNTER`. **M3** — comment on `SsrfSafeResolver`'s `:0` port explaining reqwest ignores the resolver-supplied port. **M4** — added `src/chrome-augment.d.ts` for `chrome.tabs.Tab.mimeType` and removed the `as ... & { mimeType?: string }` cast bypass in `popup.ts`. **L1** — File List notes the auto-regenerated `milton/src/lib/bindings.ts`. **L2** — ADR's "set Host: header explicitly" note clarified: not needed in code (reqwest's `dns_resolver` hook leaves SNI/Host on the URL hostname). **Gates green:** `cargo test --workspace --lib` 254/254 (+9), `cargo clippy --workspace --all-targets -- -D warnings` clean, `pnpm typecheck` 0, `pnpm test` (extension) 111/111, `pnpm lint:reactive` clean, `pnpm format:check` (milton) clean modulo a pre-existing `supabase/.temp` nag. Story stays at **`review`** pending Pierre's Task 7 sideload smoke (G17-1). |
| 2026-05-15 | Dev Agent (Opus 4.7 1M) | **Implementation complete via `/bmad_bmm_dev-story BE-7`.** Tasks 1–6 shipped; Task 7 (Pierre's manual sideload smoke) deferred per G17-1. Highlights: (1) **Wire contract** — `ConnectorReferencePayload.pdf_url: Option<String>` + camelCase `pdfUrl` on the wire; TypeScript mirror added. (2) **Extension popup detection** — new pure helper `detectPdfPage(url, mimeType)`; capture `tabs[0].mimeType` at boot; set `payload.pdfUrl` in `save()` when detected. Zero UI affordance per Pierre's design call. (3) **Connector asymmetry closed** — `add_reference_inner` now calls both `maybe_spawn_auto_fetch` (was IPC-only since 15-1a) and the new `maybe_spawn_direct_fetch` after the atomic insert; both fire-and-forget, 201 returns immediately. (4) **New direct-URL fetch service** — `fetch_pdf_from_known_url` reuses the existing `persist_pdf` helper (race-safe UPDATE + orphan cleanup + extract spawn + path-trust); new SSRF defenses (`SsrfSafeResolver` for IP blocklist at connect-time, custom redirect Policy for per-hop scheme re-validation, dedicated cookie-less `reqwest::Client`). (5) **New enum variants** — `FetchSource::ExtensionDirect`, `FetchTrigger::Connector` in milton-core. (6) **Tests** — TS 99 → **111 passing** (+10 `detectPdfPage`, +2 `createReference pdfUrl` body); Rust 242 → **245 passing** (+3 `add_reference_*` spawn-counter, +11 `direct_fetch_unit_tests` SSRF coverage, +3 `connector::payload::tests` deserialization). (7) **Docs** — protocol.mdx `pdfUrl` field + new "PDF attachment (BE-7)" section; charter line 62 annotated SUPERSEDED; README status banner + story-map + 4 BE-7 smoke scenarios. **Gates green:** `pnpm typecheck` 0, `pnpm test` 111/111, `pnpm build` OK (JS 43.02 KB), `cargo test --workspace --lib` 245/245, `cargo clippy --workspace -- -D warnings` clean. **Dependency change:** added `reqwest = { workspace = true, features = ["json", "rustls-tls", "cookies"] }` + `url = "2"` to milton-desktop's `[dependencies]` (workspace dep was declared at root but not pulled into the desktop crate — `cookies` feature required for `.cookie_store(false)`). Status: `ready-for-dev` → `in-progress` → `review`. |
