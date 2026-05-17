// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { attachPdfBytes, createReference, health, listSelectors } from '../lib/connector-client'
import { mapMetadataToPayload } from '../lib/metadata-to-payload'
import {
  OffscreenClientError,
  cancelClientTranslation,
  ensureOffscreenDocument,
  requestClientTranslation,
} from '../lib/offscreen-client'
import { scrapeActiveTabHtml, PageContextError } from '../lib/page-context'
import {
  PdfFetchInTabError,
  fetchPdfBytesInTab,
} from '../lib/pdf-fetch-in-tab'
import { extractMetadata } from '../lib/translation-client'
import {
  extractPdfAttachmentUrl,
  mapZoteroItemToPayload,
  type ZoteroItemForMapping,
} from '../lib/zotero-item-to-payload'
import type {
  CollectionSummary,
  ConnectorAuthor,
  ConnectorReferencePayload,
  CreateReferenceResult,
  EditableMetadata,
  MetadataAuthor,
  MetadataPrimary,
  ProjectSummary,
  TagSummary,
  TokenFetchResult,
  TranslateError,
} from '../lib/types'
import { findCandidateTranslatorIds } from '../translator-runtime/translator-router'
import { listBundledTranslators } from '../translator-runtime/translator-bundle'
import { fetchManifest } from '../translator-runtime/translator-fetcher'
import type { ZoteroItem } from '../translator-runtime/zotero-types'
import {
  applyGenericWebpageDefaults,
  blankEditable,
  decideBootRoute,
  decideTagInputEnter,
  detectPdfPage,
  editableToMapperInput,
  filterTagSuggestions,
  formatAuthorsDisplay,
  isTitleValid,
  metadataToEditable,
  parseYearInput,
} from './popup-helpers'

type TokenFailure = Exclude<TokenFetchResult, { ok: true; token: string }>

// ── State machine ──────────────────────────────────────────────────────────
//
// BE-1: 14 states (loading-tab, loading-health, ready-to-save, …).
// BE-4: +5 states (auth-failed, rate-limited, quota-exceeded, …) — total 19.
// BE-2: -1 (`ready-to-save` removed) +1 (`preview` replaces it). Total 19.
// `loading-selectors` is internal to preview (loadState on selectors) so it
// doesn't add a top-level state kind.

// Metadata extraction either resolves to editable fields, or fails fatally —
// in which case the popup transitions OUT of `preview` to a top-level error
// state (see `dispatchTranslateServerError`), so there's no in-preview
// "no-metadata" variant.
type MetadataLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; editable: EditableMetadata }

type SelectorsLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; tags: TagSummary[]; projects: ProjectSummary[]; collections: CollectionSummary[] }
  | {
      kind: 'partial'
      tags: TagSummary[] | null
      projects: ProjectSummary[] | null
      collections: CollectionSummary[] | null
    }

type EditField = 'title' | 'authors' | 'year' | 'abstract' | null

// BE-2 Task 12 (Figma redesign): the popup carries the "Main info / Add to..."
// segmented tab control. `main` shows the metadata preview + tags + Save;
// `add-to` shows the collections / projects picker (Figma node 1341:9327).
type ActiveTab = 'main' | 'add-to'

// Within the "Add to..." tab, a sub-toggle switches between the collections
// list and the projects list.
type AddToView = 'collections' | 'projects'

// A tag the user has attached, kept in a single list so chips render in
// insertion order (not existing-then-new, which read as a reorder). Existing
// tags carry an id (→ payload.tagIds); user-typed new tags carry a name
// (→ payload.newTagNames). The two payload arrays are derived at save time.
type SelectedTag = { kind: 'existing'; id: string } | { kind: 'new'; name: string }

// BE-8-6: provenance of the populated metadata. Drives the "Extracted by X"
// caption row in the preview. `instant-save` is the BE-1 "user saved before
// the fetch completed" branch — no caption shown.
type MetadataSource = 'client-translator' | 'server-translate' | 'instant-save'

interface PreviewState {
  kind: 'preview'
  url: string
  activeTab: ActiveTab
  metadata: MetadataLoad
  selectors: SelectorsLoad
  selectedTags: SelectedTag[]
  selectedProjectIds: string[]
  selectedCollectionIds: string[]
  tagInput: string
  // Highlighted entry in the autocomplete dropdown (↑/↓ navigation). -1 = none
  // highlighted, so plain Enter falls through to create-new / exact-match.
  tagSuggestionIndex: number
  // "Add to..." tab: which list is shown + its search filter.
  addToView: AddToView
  addToSearch: string
  edit: EditField
  // BE-8-6: provenance label for the metadata-source caption row.
  // 'client-translator' shows "Extracted by <publisher> translator".
  // 'server-translate' shows "Extracted by Milton translation service".
  // 'instant-save' suppresses the caption.
  metadataSource: MetadataSource
  // Optional publisher / translator label for the caption ("ScienceDirect",
  // "arXiv.org", etc.). Only meaningful when metadataSource = 'client-translator'.
  metadataSourceLabel?: string
}

// BE-8-6: three new states for the client-side translator path.
// `translator-running`: chrome.scripting → sandbox translation in flight.
//   Shown 1-15s typically. Cancel button bound to translatorAbort.abort().
// `translator-done`: flash "Found N items via X" for ~800ms before
//   transitioning to preview. Charter v2 names this a state; making it
//   user-visible (not zero-tick transient) gives confirmation + feels
//   right.
// `translator-fallback`: brief loader while extractMetadata(url) runs
//   as recovery. Auto-transitions to preview or error states via the
//   existing dispatchTranslateServerError machinery.
type State =
  | { kind: 'loading-tab' }
  | { kind: 'loading-health' }
  | { kind: 'cannot-capture'; reason: 'restricted-url' | 'no-url' }
  | { kind: 'milton-not-running' }
  | { kind: 'translator-running'; url: string; publisherLabel: string; translatorId: string }
  | { kind: 'translator-done'; itemCount: number; publisherLabel: string }
  | { kind: 'translator-fallback'; reason: TranslatorFallbackReason }
  | PreviewState
  | { kind: 'posting'; payload: ConnectorReferencePayload }
  // BE-8-7: `success.pdfAttached` is true when a PDF was uploaded successfully
  // via the BE-8-2 endpoint (Flow A or Flow B). Drives a small PDF icon on the
  // success screen. false / undefined = no icon (no PDF, or attach failed —
  // both surface identically per Pierre's "import silently; user sees in
  // Milton" UX direction). Soft-degrade is preserved: the reference is saved
  // regardless of attach outcome.
  | { kind: 'success'; id: string; pdfAttached?: boolean }
  | { kind: 'signed-out' }
  | { kind: 'error-no-metadata' }
  | { kind: 'error-too-large' }
  | { kind: 'error-409-duplicate'; existingId: string }
  | { kind: 'error-400-validation'; message: string; detail?: string }
  | { kind: 'error-network'; message: string }
  | { kind: 'error-auth-failed'; detail: string }
  | { kind: 'error-rate-limited'; retryAfterSeconds: number }
  | { kind: 'error-quota-exceeded'; nextResetSeconds: number; upgradeUrl: string }
  | { kind: 'error-tier-required'; requiredTiers: string[]; upgradeUrl: string }
  | { kind: 'error-service-unavailable'; retryAfterSeconds?: number }

type TranslatorFallbackReason =
  | 'no-match'
  | 'translator-error'
  | 'translator-timeout'
  | 'no-items'
  | 'html-scrape-failed'

// BE-8-7: which Class 2 path the popup is on for the post-create attach.
// 'flow-a' — Flow A bytes staged at boot (direct-PDF tab).
// 'flow-b' — Flow B URL staged at translator-done (article landing page).
// 'be-7-fallback' — Flow A's client-fetch failed; revert to BE-7 pdfUrl.
// 'none' — no PDF to attach.
type PdfAttachmentMode = 'flow-a' | 'flow-b' | 'be-7-fallback' | 'none'

const TRANSLATOR_DONE_FLASH_MS = 800
// BE-8-7: Class 2 PDF fetch + upload timeouts. PDF fetch (in-tab chrome.
// scripting): 45s covers 50 MiB over slow WiFi. Upload to BE-8-2: 90s = 60s
// server-side TimeoutLayer + 30s client headroom.
const PDF_FETCH_TIMEOUT_MS = 45_000
const PDF_UPLOAD_TIMEOUT_MS = 90_000
// BE-8-7: dual-tone PDF document icon for the success state when bytes were
// attached. Inline SVG (no icon lib in this repo); two `currentColor` fills
// at different opacities give the dual-tone effect and inherit the popup's
// success-text color automatically. Sized via `.milton-popup-pdf-icon` CSS.
const PDF_ICON_SVG =
  '<svg class="milton-popup-pdf-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" opacity="0.35" d="M3.5 1.5h5.5L13 5.5V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14V2a.5.5 0 0 1 .5-.5z"/>' +
  '<path fill="currentColor" d="M9 1.5 13 5.5h-3.5A.5.5 0 0 1 9 5z"/>' +
  '</svg>'

const root = document.getElementById('root') as HTMLDivElement
let state: State = { kind: 'loading-tab' }
let currentUrl: string | undefined
// The browser tab's own <title>, captured at boot — used as the title for an
// "instant Save" when the user saves before the metadata fetch completes.
let currentTabTitle: string | undefined
// BE-7: the active tab's reported MIME type. Used (alongside the URL suffix)
// to decide whether the page IS a PDF; when true, save() sends `pdfUrl` so
// the Milton connector can fetch + attach the binary server-side.
let currentTabMimeType: string | undefined
// BE-8-6: the active tab's id — needed for chrome.scripting.executeScript
// against the rendered DOM (Class 3 capture). Captured at boot from
// chrome.tabs.query so the rest of the flow doesn't re-query.
let currentTabId: number | undefined

// BE-8-6: AbortController for the in-flight client-side translation request.
// The popup-side timeout + the user closing the popup both trigger abort.
// chrome.runtime.sendMessage doesn't accept AbortSignal natively (the offscreen
// translation keeps running and its reply is silently dropped); this only
// aborts the LOCAL Promise wrapper in offscreen-client.requestClientTranslation.
let translatorAbort: AbortController | null = null
let translatorRequestId: string | null = null

// ── BE-8-7: Class 2 PDF-attach module state ───────────────────────────────
//
// `pendingPdfBytes` is staged at Flow A boot (direct-PDF tab); read at Save
// time and POSTed via attachPdfBytes. DO NOT TRANSFER (see AC7 BT1):
// transferring detaches the buffer; subsequent .byteLength returns 0; the
// POST hits BE-8-2 with an empty body → 400. If a future caller needs to
// inspect the buffer (e.g., content hash), use bytes.slice() for a defensive
// copy BEFORE the staging point.
let pendingPdfBytes: ArrayBuffer | null = null
// `pendingPdfAttachmentUrl` is staged at Flow B's translator-done (the first
// PDF attachment URL from the ZoteroItem); read at Save time, then the popup
// fetches the bytes in-tab + uploads.
let pendingPdfAttachmentUrl: string | null = null
// Which Class 2 path the popup is on. Drives post-create Save branching.
let pdfAttachmentMode: PdfAttachmentMode = 'none'
// AbortController for the in-flight bytes upload. Popup `beforeunload` aborts
// it; the XHR/fetch wrapper translates the abort into a 'network-error' /
// 'timeout' result that the success branch surfaces as pdfAttached: 'failed'.
let pdfUploadAbort: AbortController | null = null

// BE-8-7 diagnostic (DEV-only): the last Flow A outcome string so the popup's
// debug stripe can show WHY Flow A took a path. Survives the boot() reset
// until the next boot() call. Avoids relying on the popup console (which dies
// on outside click — see memory `extension-popup-console-impossible`).
let lastFlowAOutcome: string | null = null

void boot()

async function boot() {
  // BE-8-7: reset Class 2 module state on every boot() entry. Prevents state
  // leakage between popup re-opens on different tabs (e.g., user closes the
  // popup mid-flow, opens it on a new URL — the prior pendingPdfBytes /
  // pendingPdfAttachmentUrl must NOT survive).
  pendingPdfBytes = null
  pendingPdfAttachmentUrl = null
  pdfAttachmentMode = 'none'
  pdfUploadAbort = null
  lastFlowAOutcome = null

  // AC2 — read current tab URL + id (BE-8-6 needs tabId for chrome.scripting).
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tabs[0]?.url
  currentTabTitle = tabs[0]?.title
  // BE-7: capture the tab's reported MIME type for PDF detection at save time.
  // Field declared via local augmentation in `src/chrome-augment.d.ts`
  // (the pinned `@types/chrome` doesn't surface it yet).
  currentTabMimeType = tabs[0]?.mimeType
  // BE-8-6: capture tab id for chrome.scripting.executeScript.
  currentTabId = tabs[0]?.id

  // Pre-flight URL routing (no-URL + restricted-URL guards). Candidate
  // discovery requires a valid URL, so it runs AFTER this branch.
  const preRoute = decideBootRoute({ url, mimeType: currentTabMimeType, candidateIds: [] })
  if (preRoute.kind === 'cannot-capture') {
    setState({ kind: 'cannot-capture', reason: preRoute.reason })
    return
  }
  currentUrl = url

  // AC3 — health probe gates the preview state.
  // BE-8-6: parallel with ensureOffscreenDocument so the offscreen cold-start
  // (~500-1500ms) hides behind the localhost health probe; by the time we'd
  // ever call requestClientTranslation, the offscreen iframe is warm.
  setState({ kind: 'loading-health' })
  const [h] = await Promise.all([health(), ensureOffscreenSafe()])
  if (!h.ok) {
    setState({ kind: 'milton-not-running' })
    return
  }

  // BE-8-6: client-first decision tree. PDF page → straight to server (BE-7
  // pdfUrl path preserved). No translator candidates → straight to server
  // (no translator-running flash). Candidates available → try client first;
  // on success → preview; on miss → translator-fallback → server.
  // Router lookup happens before the final route decision so the helper sees
  // the real candidate list (decideBootRoute is pure; routing logic ≡ helper).
  let candidateIds: string[] = []
  // For PDF pages we skip router entirely (perf + BE-7 parity); else look up.
  if (!detectPdfPage(url!, currentTabMimeType)) {
    try {
      candidateIds = await findCandidateTranslatorIds(url!)
    } catch (err) {
      console.warn('[milton-popup] router failure; falling back to server', err)
    }
  }
  const route = decideBootRoute({ url, mimeType: currentTabMimeType, candidateIds })
  switch (route.kind) {
    case 'pdf-server':
      // BE-8-7 Flow A: try client-fetch FIRST inside the active tab's
      // content-script context (session cookies travel). On success, stage
      // bytes + enter the server-translate metadata flow; the Save handler
      // uploads via attachPdfBytes after createReference returns 201. On
      // failure, fall back to BE-7's pdfUrl pass-through path.
      await tryFlowAClientPdfFetch(url!)
      return
    case 'no-candidates-server':
      console.log('[milton-popup] translator-fallback reason=no-match')
      enterServerFlow(url!)
      return
    case 'client-translator':
      await tryClientTranslator(url!, candidateIds)
      return
    case 'cannot-capture':
      // Unreachable: pre-route caught this. Defensive.
      setState({ kind: 'cannot-capture', reason: route.reason })
      return
  }
}

/**
 * BE-8-7 Flow A: direct-PDF tab. Silently attempt client-fetch inside the
 * active tab's content-script context — no user-visible state transition.
 * Per Pierre's UX direction: "we just import it and the user will see it
 * in Milton". Popup stays on the loading-health spinner (already showing)
 * during the fetch. On success → stage bytes + enter the server-translate
 * metadata flow. On failure → log + fall back to BE-7's pdfUrl path; the
 * connector fetches server-side as before. The user sees one fluid
 * "Checking Milton…" then the preview, with no Flow-A-specific UI.
 */
async function tryFlowAClientPdfFetch(url: string): Promise<void> {
  if (currentTabId === undefined) {
    console.warn('[milton-popup] no tabId for Flow A; falling back to BE-7')
    pdfAttachmentMode = 'be-7-fallback'
    lastFlowAOutcome = 'NO_TAB_ID'
    enterServerFlow(url)
    return
  }
  try {
    const result = await fetchPdfBytesInTab(currentTabId, url, {
      timeoutMs: PDF_FETCH_TIMEOUT_MS,
    })
    pendingPdfBytes = result.bytes
    pdfAttachmentMode = 'flow-a'
    lastFlowAOutcome = `OK ${result.bytes.byteLength}b`
  } catch (err) {
    const code = err instanceof PdfFetchInTabError ? err.code : 'UNKNOWN'
    const httpStatus = err instanceof PdfFetchInTabError ? err.httpStatus : undefined
    const errMsg = err instanceof Error ? err.message : String(err)
    console.log(`[milton-popup] pdf-class2-fallback reason=${code}`)
    pendingPdfBytes = null
    pdfAttachmentMode = 'be-7-fallback'
    lastFlowAOutcome = httpStatus !== undefined
      ? `${code} status=${httpStatus}`
      : `${code} ${errMsg.slice(0, 80)}`
  }
  enterServerFlow(url)
}

/**
 * BE-8-6: enter the "preview + concurrent loaders" state that BE-1 set up.
 * Extracted from the original boot() so both the client-translator-hit
 * path AND the server-fallback path can share it. `populateFromSource` is
 * called once metadata is known: it patches the preview state with the
 * EditableMetadata + the metadata-source label.
 */
function enterPreviewState(args: {
  url: string
  metadataSource: MetadataSource
  metadataSourceLabel?: string
  initialMetadata: MetadataLoad
}): void {
  setState({
    kind: 'preview',
    url: args.url,
    activeTab: 'main',
    metadata: args.initialMetadata,
    selectors: { kind: 'loading' },
    selectedTags: [],
    selectedProjectIds: [],
    selectedCollectionIds: [],
    tagInput: '',
    tagSuggestionIndex: -1,
    addToView: 'collections',
    addToSearch: '',
    edit: null,
    metadataSource: args.metadataSource,
    metadataSourceLabel: args.metadataSourceLabel,
  })
  // Selectors fire concurrently — same pattern as BE-1, no client/server
  // branching.
  void listSelectors().then((sel) => {
    if (state.kind !== 'preview') return
    if (sel.ok) {
      patchPreview({
        selectors: {
          kind: 'ready',
          tags: sel.tags,
          projects: sel.projects,
          collections: sel.collections,
        },
      })
      return
    }
    if (sel.reason === 'signed-out') {
      setState({ kind: 'signed-out' })
      return
    }
    patchPreview({
      selectors: {
        kind: 'partial',
        tags: sel.tags,
        projects: sel.projects,
        collections: sel.collections,
      },
    })
  })
}

/**
 * BE-8-6: server-side translation flow (the pre-BE-8-6 path, preserved
 * verbatim). Invoked when (a) the page is a PDF, (b) no client translator
 * matches, OR (c) the client translator failed/timed-out/returned 0 items.
 */
function enterServerFlow(url: string): void {
  enterPreviewState({
    url,
    metadataSource: 'server-translate',
    initialMetadata: { kind: 'loading' },
  })
  void extractMetadata(url).then((result) => {
    if (state.kind !== 'preview') return
    if (result.ok) {
      patchPreview({
        metadata: { kind: 'ready', editable: metadataToEditable(result.primary) },
      })
      return
    }
    // BE-8-7 (fix 2026-05-18, broadened later same day): when server-translate
    // returns no-metadata AND either (a) Class 2 bytes/URL staged OR (b) we're
    // on a detected PDF page, DON'T transition to error-no-metadata. The
    // tab-title fallback gives the user a savable reference; on Save: if
    // bytes are staged → upload via BE-8-2; if not but PDF page → set pdfUrl
    // so BE-7 attempts server-side fetch (may also fail for Cloudflare, but
    // at least the reference exists). User can edit title in Milton later;
    // BE-8-8 LLM-fallback will enrich from the PDF bytes once shipped.
    // Overrides AC11's deferral; see story Change Log 2026-05-18.
    const hasPendingPdf = pendingPdfBytes !== null || pendingPdfAttachmentUrl !== null
    const isPdfPage = detectPdfPage(url, currentTabMimeType)
    if (
      (hasPendingPdf || isPdfPage) &&
      result.via === 'translate-server' &&
      result.error.kind === 'no-metadata'
    ) {
      const instantTitle = (currentTabTitle ?? '').trim() || url
      patchPreview({
        metadata: { kind: 'ready', editable: blankEditable(instantTitle) },
      })
      return
    }
    if (result.via === 'token-mint') {
      dispatchTokenMintError(result.error)
    } else {
      dispatchTranslateServerError(result.error)
    }
  })
}

/**
 * BE-8-6: client-side translation flow. Scrapes the active tab's rendered
 * DOM via chrome.scripting (past any Cloudflare/Anubis bot check the user's
 * session has cleared), forwards to the offscreen sandbox, awaits items,
 * transitions to preview on success OR translator-fallback → server on
 * miss/error.
 */
async function tryClientTranslator(url: string, candidateIds: string[]): Promise<void> {
  const translatorId = candidateIds[0]
  const publisherLabel = await lookupPublisherLabel(translatorId)
  setState({ kind: 'translator-running', url, publisherLabel, translatorId })

  // Scrape rendered HTML from the active tab.
  let scraped: { html: string; finalUrl: string }
  if (currentTabId === undefined) {
    console.warn('[milton-popup] no tabId; cannot scrape — falling back to server')
    transitionToFallback(url, 'html-scrape-failed')
    return
  }
  try {
    scraped = await scrapeActiveTabHtml(currentTabId, url)
  } catch (err) {
    const code = err instanceof PageContextError ? err.code : 'UNKNOWN'
    console.warn(`[milton-popup] html scrape failed (${code}); translator-fallback`, err)
    transitionToFallback(url, 'html-scrape-failed')
    return
  }

  // Fire client translation via offscreen.
  translatorAbort = new AbortController()
  translatorRequestId = crypto.randomUUID()
  let items: ZoteroItem[]
  try {
    items = await requestClientTranslation({
      url,
      html: scraped.html,
      translatorId,
      requestId: translatorRequestId,
      signal: translatorAbort.signal,
    })
  } catch (err) {
    const code = err instanceof OffscreenClientError ? err.code : 'UNKNOWN'
    console.warn(`[milton-popup] client translator failed (${code}); translator-fallback`, err)
    transitionToFallback(
      url,
      code === 'POPUP_TIMEOUT' || code === 'OFFSCREEN_TIMEOUT' ? 'translator-timeout' : 'translator-error',
    )
    return
  } finally {
    translatorAbort = null
    translatorRequestId = null
  }
  if (items.length === 0) {
    console.log('[milton-popup] translator-fallback reason=no-items')
    transitionToFallback(url, 'no-items')
    return
  }

  // BE-8-7 Flow B: stage the first PDF attachment URL (if any). Save handler
  // will fetch + upload bytes AFTER createReference returns 201. Best-effort:
  // failure soft-degrades to pdfAttached: 'failed' without undoing the save.
  const pdfAttachmentUrl = extractPdfAttachmentUrl(items[0] as { attachments?: unknown })
  if (pdfAttachmentUrl !== null) {
    pendingPdfAttachmentUrl = pdfAttachmentUrl
    pdfAttachmentMode = 'flow-b'
  }

  // Translation succeeded — flash translator-done state, then enter preview.
  setState({ kind: 'translator-done', itemCount: items.length, publisherLabel })
  window.setTimeout(() => {
    if (state.kind !== 'translator-done') return
    const editable = zoteroItemToEditable(items[0], url)
    enterPreviewState({
      url,
      metadataSource: 'client-translator',
      metadataSourceLabel: publisherLabel,
      initialMetadata: { kind: 'ready', editable },
    })
  }, TRANSLATOR_DONE_FLASH_MS)
}

function transitionToFallback(url: string, reason: TranslatorFallbackReason): void {
  console.log(`[milton-popup] translator-fallback reason=${reason}`)
  setState({ kind: 'translator-fallback', reason })
  // Brief fallback indicator before invoking server flow. Use a microtask so
  // the fallback render flashes; server flow then re-renders into preview/error.
  queueMicrotask(() => {
    if (state.kind === 'translator-fallback') enterServerFlow(url)
  })
}

/**
 * BE-8-6: best-effort label lookup for the translator-running / translator-done
 * caption. Tries the bundled registry first (synchronous); on miss falls
 * back to the cached manifest. Returns 'translator' as the ultimate fallback
 * so the UI never shows an undefined string.
 */
async function lookupPublisherLabel(translatorId: string): Promise<string> {
  for (const t of listBundledTranslators()) {
    if (t.metadata.translatorID === translatorId) return t.metadata.label
  }
  try {
    const manifest = await fetchManifest()
    const entry = manifest.translators.find((e) => e.translatorID === translatorId)
    if (entry !== undefined) return entry.label
  } catch {
    // ignore — fall through to default
  }
  return 'translator'
}

/**
 * BE-8-6: adapt a ZoteroItem to the popup's EditableMetadata shape. Goes
 * through `mapZoteroItemToPayload` first so the connector-bound mapping is
 * the single source of truth, then re-derives the EditableMetadata fields
 * (which carry author tuples + the journal/issn/volume/issue/pages fields
 * that aren't in the payload mapper output).
 */
function zoteroItemToEditable(item: ZoteroItem, fallbackUrl: string): EditableMetadata {
  const itemForMap: ZoteroItemForMapping = item as ZoteroItemForMapping
  const payload = mapZoteroItemToPayload(itemForMap, fallbackUrl)
  const authors: MetadataAuthor[] = payload.authors.map((a: ConnectorAuthor) => {
    if ('fullName' in a) {
      // The mapper preserves fullName authors; split heuristically for
      // EditableMetadata's first/last shape. Take the last space-separated
      // token as `last`, the rest as `first`.
      const parts = a.fullName.split(/\s+/)
      if (parts.length === 1) return { first: '', last: parts[0] }
      return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
    }
    return { first: a.firstName ?? '', last: a.lastName ?? '' }
  })
  return {
    title: payload.title,
    authors,
    year: payload.year ?? 0,
    doi: payload.doi ?? '',
    journal: typeof item.publicationTitle === 'string' ? item.publicationTitle : '',
    abstract: payload.abstract ?? '',
    issued_date: typeof item.date === 'string' ? item.date : '',
    arxiv_id: typeof item.archiveID === 'string' ? item.archiveID : '',
    issn: typeof item.ISSN === 'string' ? item.ISSN : '',
    volume: typeof item.volume === 'string' ? item.volume : '',
    issue: typeof item.issue === 'string' ? item.issue : '',
    pages: typeof item.pages === 'string' ? item.pages : '',
  }
}

/**
 * BE-8-6: ensureOffscreenDocument wrapper that swallows errors. Failure to
 * create the offscreen doc isn't fatal — the popup falls back to the server
 * flow on the next decision branch. We only WARN; the popup still boots.
 */
async function ensureOffscreenSafe(): Promise<void> {
  try {
    await ensureOffscreenDocument()
  } catch (err) {
    console.warn('[milton-popup] offscreen-document ensure failed; client translator disabled', err)
  }
}

// BE-8-6: best-effort cancel on popup close. Per AC13, beforeunload isn't
// guaranteed to fire AND chrome.runtime.sendMessage is async (may not deliver
// before the popup window dies). The offscreen-side 10s timeout is the real
// abort gate; this is just a hint so the offscreen drops a reply destined
// for our dead sendResponse channel.
// BE-8-7: also abort any in-flight bytes upload. AbortController fires
// fetch/XHR abort; popup wrapper translates to network-error result that
// would surface as pdfAttached: 'failed' — moot once popup is dead.
window.addEventListener('beforeunload', () => {
  if (translatorAbort !== null) translatorAbort.abort()
  if (translatorRequestId !== null) cancelClientTranslation(translatorRequestId)
  if (pdfUploadAbort !== null) pdfUploadAbort.abort()
})

// BE-8-6: dev-only console hook for driving the full popup → offscreen → sandbox
// flow without needing to open a real publisher page. Gated by Vite's
// `import.meta.env.DEV` — stripped from production builds. Hook lifetime is
// bound to the popup window; pin DevTools (right-click toolbar → Inspect popup)
// to keep `window.miltonPopupSpike` available across actions.
if (import.meta.env.DEV) {
  ;(window as Window & { miltonPopupSpike?: (url: string) => Promise<{ source: string; items?: ZoteroItem[] }> }).miltonPopupSpike =
    async (url: string) => {
      const candidates = await findCandidateTranslatorIds(url)
      if (candidates.length === 0) return { source: 'no-match' }
      const resp = await fetch(url, { credentials: 'omit' })
      const html = await resp.text()
      const items = await requestClientTranslation({
        url,
        html,
        translatorId: candidates[0],
        requestId: crypto.randomUUID(),
      })
      return { source: 'client-translator', items }
    }
}

function setState(next: State): void {
  // BE-8-7 BT3: null `pendingPdfBytes` on transition into any terminal error
  // state. Holding 50 MiB for a terminal-error case while the popup is open
  // (user reading the error) is a leak; explicit null lets V8 GC promptly.
  // Symmetric treatment for `pendingPdfAttachmentUrl` (cheaper but tidier).
  if (
    next.kind.startsWith('error-') ||
    next.kind === 'signed-out' ||
    next.kind === 'cannot-capture' ||
    next.kind === 'milton-not-running'
  ) {
    pendingPdfBytes = null
    pendingPdfAttachmentUrl = null
  }
  state = next
  render()
}

function patchPreview(patch: Partial<PreviewState>): void {
  if (state.kind !== 'preview') return
  state = { ...state, ...patch }
  render()
}

function render(): void {
  root.innerHTML = ''
  // BE-8-7 DEV-only diagnostic stripe (memory `extension-popup-console-impossible`):
  // surface the BE-8-7 state in the visible popup so debugging doesn't require
  // the popup console. Rendered AFTER state markup so it doesn't disrupt
  // existing layout; conditional on import.meta.env.DEV (stripped from prod).
  const renderDebugStripe = (): void => {
    // BE-8-7 debugging: always-on during this branch so the prod `pnpm build`
    // sideload also shows the stripe. TODO: gate on import.meta.env.DEV
    // before merge (or remove entirely once Flow A failure mode is fixed).
    const parts: string[] = [`mode=${pdfAttachmentMode}`]
    if (lastFlowAOutcome !== null) parts.push(`flowA=${lastFlowAOutcome}`)
    if (pendingPdfBytes !== null) parts.push(`bytes=${pendingPdfBytes.byteLength}`)
    if (pendingPdfAttachmentUrl !== null) parts.push('flowB-url-staged')
    const stripe = document.createElement('div')
    stripe.className = 'milton-popup-debug-stripe'
    stripe.textContent = parts.join(' · ')
    root.appendChild(stripe)
  }
  switch (state.kind) {
    case 'loading-tab':
    case 'loading-health':
      root.innerHTML = `<p class="milton-popup-loading">Checking Milton…</p>`
      break

    case 'cannot-capture':
      root.innerHTML = `
        <p class="milton-popup-header">Save to Milton</p>
        <button class="milton-popup-button" disabled>Save</button>
        <p class="milton-popup-helper">${
          state.reason === 'restricted-url'
            ? "This page can't be captured (restricted URL)."
            : 'No URL to save.'
        }</p>
      `
      break

    case 'milton-not-running':
      root.innerHTML = `
        <p class="milton-popup-header">Milton isn't running</p>
        <p class="milton-popup-helper">Open the desktop app to receive references from your browser.</p>
        <button class="milton-popup-button" id="open-milton">Open Milton</button>
        <p class="milton-popup-footnote">Don't have Milton? <a href="https://milton.so" target="_blank" rel="noopener">Get it here</a>.</p>
      `
      bind('open-milton', openMilton)
      break

    case 'translator-running':
      root.innerHTML = `
        <p class="milton-popup-loading">Extracting metadata via ${escapeHtml(state.publisherLabel)}…</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="cancel-translator">Cancel</button>
      `
      bind('cancel-translator', () => {
        if (translatorAbort !== null) translatorAbort.abort()
      })
      break

    case 'translator-done':
      root.innerHTML = `
        <p class="milton-popup-loading">Found ${state.itemCount} item${state.itemCount === 1 ? '' : 's'} via ${escapeHtml(state.publisherLabel)}.</p>
      `
      break

    case 'translator-fallback':
      root.innerHTML = `
        <p class="milton-popup-loading">Trying Milton's translation service…</p>
      `
      break

    case 'preview':
      renderPreview(state)
      break

    case 'posting':
      root.innerHTML = `<p class="milton-popup-loading">Saving to Milton…</p>`
      break

    case 'success': {
      // BE-8-7: single success message. When pdfAttached === true (Flow A or
      // Flow B bytes-upload returned 200), prepend a small dual-tone PDF icon.
      // Inline SVG (no icon lib in this repo); dual-tone via two paths at
      // currentColor with different opacities — adapts to popup theme.
      const pdfIcon = state.pdfAttached === true ? PDF_ICON_SVG : ''
      root.innerHTML = `<p class="milton-popup-success">${pdfIcon}Saved to Milton ✓</p>`
      window.setTimeout(() => window.close(), 1500)
      break
    }

    case 'signed-out':
      root.innerHTML = `
        <p class="milton-popup-header">Sign in to Milton</p>
        <p class="milton-popup-helper">Milton needs you to sign in before it can save references.</p>
        <button class="milton-popup-button" id="open-milton">Open Milton</button>
      `
      bind('open-milton', openMilton)
      break

    case 'error-no-metadata':
      root.innerHTML = `
        <p class="milton-popup-header">Couldn't extract metadata</p>
        <p class="milton-popup-error">No reference data could be extracted from this page.</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-too-large':
      root.innerHTML = `
        <p class="milton-popup-header">Page metadata too large</p>
        <p class="milton-popup-error">The metadata for this page is over 64 KB and can't be captured.</p>
      `
      break

    case 'error-409-duplicate':
      root.innerHTML = `
        <p class="milton-popup-header">Already in your library</p>
        <p class="milton-popup-helper">This reference is already saved in Milton.</p>
        <p class="milton-popup-error-detail">id: ${escapeHtml(state.existingId)}</p>
      `
      break

    case 'error-400-validation':
      root.innerHTML = `
        <p class="milton-popup-header">Couldn't save</p>
        <p class="milton-popup-error">${escapeHtml(state.message)}${
          state.detail
            ? `<span class="milton-popup-error-detail">${escapeHtml(state.detail)}</span>`
            : ''
        }</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-network':
      root.innerHTML = `
        <p class="milton-popup-header">Connection error</p>
        <p class="milton-popup-error">${escapeHtml(state.message)}</p>
        <button class="milton-popup-button" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-auth-failed':
      root.innerHTML = `
        <p class="milton-popup-header">Authentication failed</p>
        <p class="milton-popup-error">${escapeHtml(state.detail)}</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-rate-limited':
      root.innerHTML = `
        <p class="milton-popup-header">Too many requests</p>
        <p class="milton-popup-error">Try again in ${humanizeSeconds(state.retryAfterSeconds)}.</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-quota-exceeded':
      root.innerHTML = `
        <p class="milton-popup-header">Free quota reached</p>
        <p class="milton-popup-error">Next slot in ${humanizeSeconds(state.nextResetSeconds)}, or upgrade for unlimited.</p>
        <a class="milton-popup-button" href="${escapeAttr(state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade Milton</a>
      `
      break

    case 'error-tier-required': {
      const tier = state.requiredTiers[0] ?? 'paid'
      root.innerHTML = `
        <p class="milton-popup-header">Paid plan required</p>
        <p class="milton-popup-error">This feature requires the ${escapeHtml(tier)} plan or higher.</p>
        <a class="milton-popup-button" href="${escapeAttr(state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade Milton</a>
      `
      break
    }

    case 'error-service-unavailable':
      root.innerHTML = `
        <p class="milton-popup-header">Translation service unavailable</p>
        <p class="milton-popup-error">${
          state.retryAfterSeconds
            ? `Try again in ${humanizeSeconds(state.retryAfterSeconds)}.`
            : 'Try again in a moment.'
        }</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break
  }
  renderDebugStripe()
}

// ── Preview rendering ──────────────────────────────────────────────────────

function renderPreview(s: PreviewState): void {
  // BE-2 Task 12 (Figma redesign): the "Main info / Add to..." segmented
  // control sits above the content column. `main` is the metadata preview +
  // tags; `add-to` is the collections / projects picker. "Save to Milton" is
  // shared — it lives below the column on both tabs.
  const parts: string[] = []
  parts.push(renderTabs(s))
  parts.push('<div class="milton-popup-content">')

  if (s.activeTab === 'main') {
    parts.push('<div class="milton-popup-sections">')
    parts.push(
      `<section class="milton-popup-section"><h3 class="milton-popup-section-header">Preview</h3>${renderPreviewMetadata(s)}</section>`,
    )
    parts.push('<div class="milton-popup-separator" aria-hidden="true"></div>')
    parts.push(renderTagSection(s))
    parts.push('</div>')
  } else {
    parts.push(renderAddTo(s))
  }

  const saveDisabled = !canSave(s)
  parts.push(
    `<button class="milton-popup-button milton-popup-save" id="save-btn"${saveDisabled ? ' disabled' : ''}>Save to Milton</button>`,
  )
  if (
    s.activeTab === 'main' &&
    s.metadata.kind === 'ready' &&
    !isTitleValid(s.metadata.editable)
  ) {
    parts.push(`<p class="milton-popup-helper">Title is required.</p>`)
  }

  parts.push('</div>')
  root.innerHTML = parts.join('\n')
  bindPreviewHandlers(s)
}

// ── Segmented tab control (Figma node 1323:8985) ───────────────────────────

function renderTabs(s: PreviewState): string {
  const main = s.activeTab === 'main'
  return `<div class="milton-popup-tabs" role="tablist">
    <button class="milton-popup-tab${main ? ' milton-popup-tab-active' : ''}" id="tab-main" type="button" role="tab" aria-selected="${main}">Main info</button>
    <button class="milton-popup-tab${main ? '' : ' milton-popup-tab-active'}" id="tab-add-to" type="button" role="tab" aria-selected="${!main}">Add to...</button>
  </div>`
}

function canSave(s: PreviewState): boolean {
  // Metadata ready → needs a valid (non-empty) title. Still loading → "instant
  // Save" is allowed; `save()` falls back to the browser tab's title (or URL).
  return s.metadata.kind === 'ready' ? isTitleValid(s.metadata.editable) : true
}

// ── "Add to..." tab — collections / projects picker (Figma node 1341:9327) ──

// Inline icons. Search + checkbox glyphs are verbatim from the Figma export.
// The collections / projects glyphs are the Figma `layer/layer-three` and
// `briefcase-job` icons (DUO-SOLID variant) — assembled verbatim from the two
// exported vector fragments, positioned by the Figma wrapper insets. They
// inherit `currentColor`; `.milton-popup-icon-duo` paints them neutral-700.
const LAYERS_ICON =
  '<svg class="milton-popup-icon milton-popup-icon-duo" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<g transform="translate(1.3333 1.3333)" fill="currentColor"><path d="M7.0287 0.0318511C6.78936 -0.010617 6.54397 -0.010617 6.30463 0.0318511C6.03117 0.0803752 5.77873 0.200052 5.48733 0.338202L1.22337 2.3546C0.999147 2.46061 0.792286 2.55841 0.633962 2.65117C0.481817 2.7403 0.253293 2.89036 0.122121 3.15194C-0.0407069 3.47663 -0.0407069 3.8567 0.122121 4.1814C0.253293 4.44297 0.481817 4.59303 0.633963 4.68217C0.792291 4.77492 0.99915 4.87272 1.22338 4.97873L5.48732 6.99513C5.77873 7.13328 6.03116 7.25296 6.30463 7.30148C6.54397 7.34395 6.78936 7.34395 7.0287 7.30148C7.30217 7.25296 7.5546 7.13328 7.84601 6.99513L12.11 4.97873C12.3342 4.87272 12.541 4.77492 12.6994 4.68217C12.8515 4.59303 13.08 4.44297 13.2112 4.1814C13.374 3.8567 13.374 3.47663 13.2112 3.15194C13.08 2.89036 12.8515 2.7403 12.6994 2.65117C12.5411 2.55841 12.3342 2.46062 12.11 2.35462L7.84601 0.338202C7.5546 0.200052 7.30217 0.0803752 7.0287 0.0318511Z"/></g>' +
  '<g transform="translate(1.5 7.5)" opacity="0.28"><path d="M12.5001 0.500118C12.4207 0.669297 12.1732 0.794317 11.6783 1.04436L7.46123 3.17476C7.10882 3.3528 6.93262 3.44181 6.7478 3.47685C6.58411 3.50788 6.41613 3.50788 6.25244 3.47685C6.06762 3.44181 5.8914 3.35279 5.53901 3.17476L1.32195 1.04436C0.827005 0.794317 0.579532 0.669297 0.500118 0.500118M12.5001 3.50012C12.4207 3.6693 12.1732 3.79432 11.6783 4.04436L7.46123 6.17477C7.10882 6.3528 6.93262 6.44181 6.7478 6.47685C6.58411 6.50788 6.41613 6.50788 6.25244 6.47685C6.06762 6.44181 5.8914 6.35279 5.53901 6.17477L1.32195 4.04436C0.827005 3.79432 0.579532 3.6693 0.500118 3.50012" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g>' +
  '</svg>'

const BRIEFCASE_ICON =
  '<svg class="milton-popup-icon milton-popup-icon-duo" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
  '<g transform="translate(1.19 1.167)" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.88851 2.75431e-05C6.35249 -0.0002237 6.69704 -0.00041027 6.9955 0.0795627C7.80072 0.295319 8.42966 0.924264 8.64542 1.72948C8.69761 1.92426 8.71566 2.13866 8.72183 2.39308C8.90195 2.41824 9.06697 2.45398 9.22317 2.50473C10.2887 2.85094 11.1241 3.68634 11.4703 4.75187C11.5512 5.00089 11.594 5.27233 11.6165 5.59159C11.4592 6.66038 10.5822 7.49048 9.49133 7.57634C9.4057 7.58308 9.29853 7.58353 9.01659 7.58353H6.39152V7.46703C6.39152 7.14487 6.13035 6.8837 5.80819 6.8837C5.48602 6.8837 5.22485 7.14487 5.22485 7.46703V7.58353H2.59993C2.31799 7.58353 2.21082 7.58308 2.12519 7.57634C1.03434 7.49049 0.157446 6.66046 0 5.59176C0.0225644 5.27242 0.0653218 5.00093 0.146246 4.75187C0.492459 3.68634 1.32785 2.85094 2.39338 2.50473C2.54957 2.45398 2.71458 2.41825 2.89468 2.39308C2.90086 2.13867 2.91891 1.92426 2.9711 1.72948C3.18686 0.924264 3.8158 0.295319 4.62101 0.0795627C4.91948 -0.00041027 5.26403 -0.0002237 5.728 2.75431e-05H5.88851ZM4.06399 2.33409C4.11761 2.33381 4.17239 2.33364 4.2284 2.33353H7.38815C7.44415 2.33364 7.49892 2.33381 7.55253 2.33409C7.54718 2.1834 7.5371 2.10084 7.51851 2.03143C7.41063 1.62883 7.09615 1.31435 6.69355 1.20648C6.56389 1.17173 6.3883 1.16672 5.80826 1.16672C5.22822 1.16672 5.05263 1.17173 4.92297 1.20648C4.52036 1.31435 4.20589 1.62883 4.09801 2.03143C4.07942 2.10084 4.06934 2.1834 4.06399 2.33409Z"/></g>' +
  '<g transform="translate(1.17 9.03)" fill="currentColor" opacity="0.28"><path d="M5.2463 1.00485V0.888012L2.5923 0.888013C2.34927 0.88803 2.19254 0.88804 2.05509 0.877223C1.26753 0.815241 0.554318 0.494662 0 3.2266e-05C0.00963056 0.574321 0.0442774 1.00632 0.167689 1.38614C0.513901 2.45167 1.34929 3.28706 2.41483 3.63327C2.94341 3.80502 3.57305 3.80486 4.54663 3.8046H7.1128C8.08639 3.80486 8.71603 3.80502 9.24461 3.63327C10.3101 3.28706 11.1455 2.45167 11.4918 1.38614C11.6152 1.00631 11.6498 0.574304 11.6594 0C11.1051 0.494648 10.3919 0.815239 9.60431 0.877223C9.46686 0.88804 9.31014 0.88803 9.06711 0.888013L6.41296 0.888012V1.00485C6.41296 1.32701 6.1518 1.58818 5.82963 1.58818C5.50746 1.58818 5.2463 1.32701 5.2463 1.00485Z"/></g>' +
  '</svg>'

const SEARCH_ICON =
  '<svg class="milton-popup-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path d="M11.25 11.25 7.7207 7.7207M7.7207 7.7207C8.4596 6.9818 8.9167 5.9609 8.9167 4.8333C8.9167 2.5782 7.0885 0.75 4.8333 0.75C2.5782 0.75 0.75 2.5782 0.75 4.8333C0.75 7.0885 2.5782 8.9167 4.8333 8.9167C5.9609 8.9167 6.9818 8.4596 7.7207 7.7207Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'

// Unchecked: neutral-300 rounded-square outline. Checked: solid brand-black
// rounded square with the tick knocked out (verbatim Figma `check-tick-square`).
const CHECKBOX_UNCHECKED =
  '<svg class="milton-popup-checkbox" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M1 10C1 7.2 1 5.81 1.46 4.7C2.07 3.23 3.23 2.07 4.7 1.46C5.81 1 7.2 1 10 1C12.8 1 14.19 1 15.3 1.46C16.77 2.07 17.93 3.23 18.54 4.7C19 5.81 19 7.2 19 10C19 12.8 19 14.19 18.54 15.3C17.93 16.77 16.77 17.93 15.3 18.54C14.19 19 12.8 19 10 19C7.2 19 5.81 19 4.7 18.54C3.23 17.93 2.07 16.77 1.46 15.3C1 14.19 1 12.8 1 10Z" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'

const CHECKBOX_CHECKED =
  '<svg class="milton-popup-checkbox" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M9.963 0H10.037C11.404 0 12.48 0 13.351 0.059C14.239 0.12 14.985 0.246 15.679 0.533C17.394 1.243 18.757 2.606 19.467 4.321C19.754 5.015 19.88 5.761 19.941 6.649C20 7.52 20 8.597 20 9.963V10.037C20 11.404 20 12.48 19.941 13.351C19.88 14.239 19.754 14.985 19.467 15.679C18.757 17.394 17.394 18.757 15.679 19.467C14.985 19.754 14.239 19.88 13.351 19.941C12.48 20 11.404 20 10.037 20H9.963C8.597 20 7.52 20 6.649 19.941C5.761 19.88 5.015 19.754 4.321 19.467C2.606 18.757 1.243 17.394 0.533 15.679C0.246 14.985 0.12 14.239 0.059 13.351C0 12.48 0 11.404 0 10.037V9.963C0 8.597 0 7.52 0.059 6.649C0.12 5.761 0.246 5.015 0.533 4.321C1.243 2.606 2.606 1.243 4.321 0.533C5.015 0.246 5.761 0.12 6.649 0.059C7.52 0 8.597 0 9.963 0ZM14.064 8.672C14.52 8.361 14.637 7.738 14.326 7.282C14.014 6.826 13.392 6.709 12.936 7.02L12.835 7.09C11.194 8.21 9.779 9.624 8.661 11.258L7.207 9.805C6.816 9.415 6.183 9.415 5.793 9.806C5.402 10.196 5.403 10.83 5.793 11.22L8.134 13.559C8.355 13.779 8.665 13.884 8.974 13.842C9.283 13.801 9.555 13.618 9.709 13.348C10.76 11.51 12.215 9.935 13.963 8.741L14.064 8.672Z" fill="#0a0a0a"/>' +
  '</svg>'

function renderAddTo(s: PreviewState): string {
  const collActive = s.addToView === 'collections'
  const collCount = s.selectedCollectionIds.length
  const projCount = s.selectedProjectIds.length
  return `<div class="milton-popup-addto">
    <h3 class="milton-popup-addto-title">Add to collections/projects</h3>
    <p class="milton-popup-addto-body">Select one or more existing collections and/or projects.</p>
    <div class="milton-popup-addto-toggle" role="tablist">
      <button class="milton-popup-addto-toggle-btn${collActive ? ' milton-popup-addto-toggle-btn-active' : ''}" id="addto-collections" type="button" role="tab" aria-selected="${collActive}">
        ${LAYERS_ICON}<span>Add to collections (${collCount})</span>
      </button>
      <button class="milton-popup-addto-toggle-btn${collActive ? '' : ' milton-popup-addto-toggle-btn-active'}" id="addto-projects" type="button" role="tab" aria-selected="${!collActive}">
        ${BRIEFCASE_ICON}<span>Add to projects (${projCount})</span>
      </button>
    </div>
    <div class="milton-popup-separator" aria-hidden="true"></div>
    <h4 class="milton-popup-addto-label">Select ${collActive ? 'collections' : 'projects'}:</h4>
    <div class="milton-popup-addto-search">
      ${SEARCH_ICON}
      <input class="milton-popup-addto-search-input" id="addto-search" type="text" placeholder="Search" value="${escapeAttr(s.addToSearch)}" autocomplete="off" />
    </div>
    ${renderAddToList(s)}
  </div>`
}

function renderAddToList(s: PreviewState): string {
  const query = s.addToSearch.trim().toLowerCase()
  if (s.addToView === 'collections') {
    const status = selectorStatus(s.selectors, 'collections')
    if (status.kind === 'loading') {
      return `<div class="milton-popup-addto-list"><p class="milton-popup-section-loading">Loading…</p></div>`
    }
    if (status.kind === 'unavailable') {
      return `<div class="milton-popup-addto-list"><p class="milton-popup-empty-section-note">Collections unavailable.</p></div>`
    }
    const rows = status.collections
      .filter((c) => query.length === 0 || c.name.toLowerCase().includes(query))
      .map((c) =>
        renderAddToItem(c.id, c.name, s.selectedCollectionIds.includes(c.id), 'collection'),
      )
    return `<div class="milton-popup-addto-list">${rows.length > 0 ? rows.join('') : renderAddToEmpty(query, 'collections')}</div>`
  }
  const status = selectorStatus(s.selectors, 'projects')
  if (status.kind === 'loading') {
    return `<div class="milton-popup-addto-list"><p class="milton-popup-section-loading">Loading…</p></div>`
  }
  if (status.kind === 'unavailable') {
    return `<div class="milton-popup-addto-list"><p class="milton-popup-empty-section-note">Projects unavailable.</p></div>`
  }
  const rows = status.projects
    .filter((p) => query.length === 0 || p.title.toLowerCase().includes(query))
    .map((p) => renderAddToItem(p.id, p.title, s.selectedProjectIds.includes(p.id), 'project'))
  return `<div class="milton-popup-addto-list">${rows.length > 0 ? rows.join('') : renderAddToEmpty(query, 'projects')}</div>`
}

function renderAddToEmpty(query: string, which: 'collections' | 'projects'): string {
  const msg = query.length > 0 ? 'No matches.' : `No ${which} yet.`
  return `<p class="milton-popup-empty-section-note">${msg}</p>`
}

function renderAddToItem(
  id: string,
  name: string,
  selected: boolean,
  kind: 'collection' | 'project',
): string {
  const icon = kind === 'collection' ? LAYERS_ICON : BRIEFCASE_ICON
  return `<button class="milton-popup-addto-item" data-toggle-${kind}="${escapeAttr(id)}" type="button" title="${escapeAttr(name)}">
    <span class="milton-popup-addto-item-link">
      ${icon}<span class="milton-popup-addto-item-name">${escapeHtml(name)}</span>
    </span>
    ${selected ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED}
  </button>`
}

function renderPreviewMetadata(s: PreviewState): string {
  if (s.metadata.kind === 'loading') {
    // Skeleton occupies the SAME fixed-height card as the populated state, so
    // the popup window doesn't jump in height when the metadata arrives.
    return `<div class="milton-popup-preview milton-popup-preview-skeleton" aria-hidden="true">
      <div class="milton-popup-skel milton-popup-skel-title"></div>
      <div class="milton-popup-skel milton-popup-skel-line"></div>
      <div class="milton-popup-skel milton-popup-skel-line milton-popup-skel-short"></div>
      <div class="milton-popup-skel milton-popup-skel-abstract"></div>
    </div>`
  }
  const e = s.metadata.editable
  const rows: string[] = []
  // BE-8-6: metadata-source caption row. Always rendered for client-translator
  // and server-translate paths (suppressed for instant-save where the user
  // didn't wait for any fetch).
  const caption = renderMetadataSourceCaption(s)
  if (caption.length > 0) rows.push(caption)
  // Figma rows: Title (no label, big) → Author(s) → Date → Abstract. Journal
  // and DOI are no longer displayed (Pierre 2026-05-14) — the Figma frame has
  // neither, and dropping them keeps the preview card a fixed height that
  // never needs to scroll unless a property is expanded for editing. (DOI
  // still flows through `mapMetadataToPayload` into the saved reference;
  // journal was display-only and never mapped.)
  rows.push(renderTitleRow(e, s.edit === 'title'))
  rows.push(renderAuthorsRow(e, s.edit === 'authors'))
  if (e.year > 0 || s.edit === 'year') {
    rows.push(renderYearRow(e, s.edit === 'year'))
  } else {
    // give the user a way to ADD a date if missing
    rows.push(
      `<div class="milton-popup-field-row milton-popup-row-date milton-popup-field-row-empty" data-edit="year">
        <span class="milton-popup-field-label">Date</span>
        <span class="milton-popup-field-empty">(add)</span>
      </div>`,
    )
  }
  if (e.abstract.length > 0 || s.edit === 'abstract') {
    rows.push(renderAbstractRow(e, s.edit === 'abstract'))
  } else {
    // give the user a way to ADD an abstract if missing (mirrors the Date row)
    rows.push(
      `<div class="milton-popup-field-row milton-popup-row-abstract milton-popup-field-row-empty" data-edit="abstract">
        <span class="milton-popup-field-label">Abstract</span>
        <span class="milton-popup-field-empty">(add)</span>
      </div>`,
    )
  }
  return `<div class="milton-popup-preview">${rows.join('\n')}</div>`
}

/**
 * BE-8-6: render the "Extracted by X" caption row above the title. Suppressed
 * for the instant-save branch (BE-1 — user saved before any fetch completed).
 * Returns empty string when no caption should render.
 */
function renderMetadataSourceCaption(s: PreviewState): string {
  if (s.metadataSource === 'instant-save') return ''
  if (s.metadata.kind !== 'ready') return ''
  let label: string
  if (s.metadataSource === 'client-translator') {
    label = `Extracted by ${escapeHtml(s.metadataSourceLabel ?? 'translator')} translator`
  } else {
    label = 'Extracted by Milton translation service'
  }
  return `<p class="milton-popup-source-caption">${label}</p>`
}

function renderTitleRow(e: EditableMetadata, editing: boolean): string {
  if (editing) {
    return `<div class="milton-popup-field-row milton-popup-field-row-editing">
      <input class="milton-popup-field-edit" id="edit-title" type="text" value="${escapeAttr(e.title)}" />
    </div>`
  }
  // Figma: title is the card's headline — no label, larger type, single line.
  // The full title rides along in `title=` so it's recoverable on hover.
  return `<div class="milton-popup-field-row milton-popup-meta-title-row" data-edit="title">
    <span class="milton-popup-field-value milton-popup-field-title" title="${escapeAttr(e.title)}">${escapeHtml(e.title) || '<em>(empty — click to add)</em>'}</span>
  </div>`
}

function renderAuthorsRow(e: EditableMetadata, editing: boolean): string {
  if (editing) {
    const rows = e.authors.map((a, i) => {
      return `<div class="milton-popup-author-edit-row" data-author-index="${i}">
        <input class="milton-popup-field-edit milton-popup-author-first" type="text" placeholder="First" value="${escapeAttr(a.first)}" />
        <input class="milton-popup-field-edit milton-popup-author-last" type="text" placeholder="Last" value="${escapeAttr(a.last)}" />
        <button class="milton-popup-author-remove" data-action="remove-author" data-index="${i}" title="Remove author">×</button>
      </div>`
    })
    // The author rows live in their own capped scroll region so a paper with
    // 40+ authors doesn't push the "Add author" / "Done" controls out of reach.
    return `<div class="milton-popup-field-row milton-popup-field-row-editing milton-popup-field-row-editing-stack">
      <span class="milton-popup-field-label">Author(s)</span>
      <div class="milton-popup-author-edit-list">
        <div class="milton-popup-author-edit-rows">
          ${rows.join('\n')}
        </div>
        <button class="milton-popup-author-add" id="add-author">+ Add author</button>
        <div class="milton-popup-edit-actions">
          <button class="milton-popup-button-secondary" id="authors-commit">Done</button>
        </div>
      </div>
    </div>`
  }
  // Display collapses to "First, Second et al." past 3 authors (some papers
  // carry 40+) so the row never blows past a line or two; the inline editor
  // below still works on the full `e.authors` array.
  const display = formatAuthorsDisplay(e.authors)
  const displayed = display.length > 0 ? escapeHtml(display) : '<em>(unknown — click to add)</em>'
  return `<div class="milton-popup-field-row milton-popup-row-author" data-edit="authors">
    <span class="milton-popup-field-label">Author(s)</span>
    <span class="milton-popup-field-value">${displayed}</span>
  </div>`
}

function renderYearRow(e: EditableMetadata, editing: boolean): string {
  // Figma labels this row "Date"; the underlying state + payload field is the
  // integer `year` (the only date granularity the connector accepts).
  if (editing) {
    // `milton-popup-row-date` keeps the input at the same x as the read-only
    // value (to the right of the label, not stacked below it).
    return `<div class="milton-popup-field-row milton-popup-row-date milton-popup-field-row-editing">
      <span class="milton-popup-field-label">Date</span>
      <input class="milton-popup-field-edit milton-popup-field-year" id="edit-year" type="text" inputmode="numeric" value="${e.year > 0 ? String(e.year) : ''}" />
    </div>`
  }
  return `<div class="milton-popup-field-row milton-popup-row-date" data-edit="year">
    <span class="milton-popup-field-label">Date</span>
    <span class="milton-popup-field-value">${e.year > 0 ? String(e.year) : '<em>(add)</em>'}</span>
  </div>`
}

function renderAbstractRow(e: EditableMetadata, editing: boolean): string {
  if (editing) {
    // Multi-line → a textarea. Plain Enter inserts a newline; Cmd/Ctrl+Enter
    // commits + saves; blur commits; Escape reverts. `milton-popup-row-abstract`
    // keeps the textarea at the same x as the read-only value (right of the
    // label, top-aligned), not stacked below it.
    return `<div class="milton-popup-field-row milton-popup-row-abstract milton-popup-field-row-editing">
      <span class="milton-popup-field-label">Abstract</span>
      <textarea class="milton-popup-field-edit milton-popup-field-edit-abstract" id="edit-abstract">${escapeHtml(e.abstract)}</textarea>
    </div>`
  }
  return `<div class="milton-popup-field-row milton-popup-row-abstract" data-edit="abstract">
    <span class="milton-popup-field-label">Abstract</span>
    <span class="milton-popup-field-value milton-popup-field-abstract">${escapeHtml(e.abstract)}</span>
  </div>`
}

// ── Tag section ────────────────────────────────────────────────────────────

// Split the ordered `selectedTags` list into the connector's two payload
// arrays. Insertion order is preserved within each.
function selectedExistingIds(tags: SelectedTag[]): string[] {
  const ids: string[] = []
  for (const t of tags) if (t.kind === 'existing') ids.push(t.id)
  return ids
}

function selectedNewNames(tags: SelectedTag[]): string[] {
  const names: string[] = []
  for (const t of tags) if (t.kind === 'new') names.push(t.name)
  return names
}

// The autocomplete matches for the current input — recomputed wherever needed
// (render + the ↑/↓/Enter keyboard handler) so they always agree.
function currentTagSuggestions(s: PreviewState): TagSummary[] {
  const status = selectorStatus(s.selectors, 'tags')
  if (status.kind !== 'ready') return []
  return filterTagSuggestions(s.tagInput, status.tags, selectedExistingIds(s.selectedTags))
}

function renderTagSection(s: PreviewState): string {
  const status = selectorStatus(s.selectors, 'tags')
  if (status.kind === 'loading') {
    return `<section class="milton-popup-section">
      <h3 class="milton-popup-section-header">Tags</h3>
      <p class="milton-popup-section-loading">Loading…</p>
    </section>`
  }
  if (status.kind === 'unavailable') {
    return `<section class="milton-popup-section">
      <h3 class="milton-popup-section-header">Tags</h3>
      <p class="milton-popup-empty-section-note">Tags unavailable.</p>
    </section>`
  }
  const allTags = status.tags
  // Chips render straight from `selectedTags`, so they stay in the exact order
  // the user attached them — existing and new tags interleaved as added.
  const chips = s.selectedTags
    .map((t) => {
      if (t.kind === 'new') return renderChip(t.name, 'remove-new-tag', t.name)
      const tag = allTags.find((x) => x.id === t.id)
      // Existing tag whose id vanished from the loaded list (deleted in Milton
      // between popup-open and now) — drop the chip silently.
      return tag ? renderChip(tag.name, 'remove-tag-id', tag.id) : ''
    })
    .join('')

  // Autocomplete: existing tags matching what the user is typing surface as a
  // floating click- or ↑/↓-navigable dropdown. `data-suggestion-index` lets the
  // keyboard handler map the highlighted entry back to its tag.
  const suggestions = currentTagSuggestions(s)
  const suggestionList =
    suggestions.length > 0
      ? `<div class="milton-popup-tag-options">${suggestions
          .map((t, i) => {
            const active = i === s.tagSuggestionIndex ? ' milton-popup-tag-option-active' : ''
            return `<button class="milton-popup-tag-option${active}" data-add-tag-id="${escapeAttr(t.id)}" data-suggestion-index="${i}" type="button">${escapeHtml(t.name)}</button>`
          })
          .join('')}</div>`
      : ''

  // Tag field = the chip row itself, with an invisible inline input flex-growing
  // after the chips (Dribbble pattern). The chip row lives in a capped scroll
  // wrapper so the tags card never grows the popup past the browser cap; the
  // dropdown is a sibling of that wrapper so it isn't clipped by its scroll.
  return `<section class="milton-popup-section">
    <h3 class="milton-popup-section-header">Tags</h3>
    <div class="milton-popup-card">
      <div class="milton-popup-tag-scroll">
        <div class="milton-popup-tag-chips milton-popup-tag-field" id="tag-field">
          ${chips}
          <input class="milton-popup-tag-input" id="tag-input" type="text" placeholder="New tag…" value="${escapeAttr(s.tagInput)}" autocomplete="off" />
        </div>
      </div>
      ${suggestionList}
    </div>
  </section>`
}

// Inline X — the Figma "multiple-cross-cancel" icon (node I1323:9019;724:14288):
// a 4-segment cross drawn from the centre, stroke 1.6, round cap + join, sized
// ~8px inside the 16px slot. Inlined rather than bundled: it's a few strokes,
// and `currentColor` lets it inherit the chip's hover color for free.
const X_ICON =
  '<svg class="milton-popup-x-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M4.8 11.2 8 8M8 8 11.2 4.8M8 8 4.8 4.8M8 8 11.2 11.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'

// Renders a SELECTED tag chip (existing tag or a user-typed new tag). Existing
// tags matched via autocomplete render through `.milton-popup-tag-option`, not
// this function.
function renderChip(name: string, action: 'remove-tag-id' | 'remove-new-tag', id: string): string {
  // Figma chip (node 1323:9017) is a flat neutral grey pill — tag name + the
  // inline × icon, no color dot. Tags have no user-supplied color (memory rule).
  return `<button class="milton-popup-tag-chip milton-popup-tag-chip-selected" data-${action}="${escapeAttr(id)}" type="button">
    <span class="milton-popup-tag-name">${escapeHtml(name)}</span>
    <span class="milton-popup-tag-remove">${X_ICON}</span>
  </button>`
}

// BE-2 Task 12: the Project + Collection picker sections were removed from the
// popup (not in the Figma design). `listSelectors()` still fetches projects +
// collections and the types/SelectorsLoad shape are unchanged — the popup just
// doesn't render them, and `selectedProjectIds` / `selectedCollectionIds` stay
// empty arrays through to the Save payload.

type SelectorStatus<TName extends 'tags' | 'projects' | 'collections'> =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | (TName extends 'tags'
      ? { kind: 'ready'; tags: TagSummary[] }
      : TName extends 'projects'
        ? { kind: 'ready'; projects: ProjectSummary[] }
        : { kind: 'ready'; collections: CollectionSummary[] })

function selectorStatus<TName extends 'tags' | 'projects' | 'collections'>(
  s: SelectorsLoad,
  which: TName,
): SelectorStatus<TName> {
  if (s.kind === 'loading') return { kind: 'loading' } as SelectorStatus<TName>
  if (s.kind === 'ready') {
    if (which === 'tags') return { kind: 'ready', tags: s.tags } as SelectorStatus<TName>
    if (which === 'projects')
      return { kind: 'ready', projects: s.projects } as SelectorStatus<TName>
    return { kind: 'ready', collections: s.collections } as SelectorStatus<TName>
  }
  // partial
  if (which === 'tags') {
    if (s.tags === null) return { kind: 'unavailable' } as SelectorStatus<TName>
    return { kind: 'ready', tags: s.tags } as SelectorStatus<TName>
  }
  if (which === 'projects') {
    if (s.projects === null) return { kind: 'unavailable' } as SelectorStatus<TName>
    return { kind: 'ready', projects: s.projects } as SelectorStatus<TName>
  }
  if (s.collections === null) return { kind: 'unavailable' } as SelectorStatus<TName>
  return { kind: 'ready', collections: s.collections } as SelectorStatus<TName>
}

// ── Event binding for preview ──────────────────────────────────────────────

function bindPreviewHandlers(s: PreviewState): void {
  // Field-row click → enter edit mode (only if metadata is ready).
  if (s.metadata.kind === 'ready') {
    document.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        // Don't re-enter edit mode if user clicked inside the input itself.
        if ((ev.target as HTMLElement)?.tagName === 'INPUT') return
        const field = el.dataset.edit as EditField
        if (field) patchPreview({ edit: field })
      })
    })
  }

  // Title input handlers.
  const titleInput = document.getElementById('edit-title') as HTMLInputElement | null
  if (titleInput) {
    titleInput.focus()
    titleInput.select()
    titleInput.addEventListener('blur', () => commitTitle(titleInput.value))
    titleInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !(ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        commitTitle(titleInput.value)
      } else if (ev.key === 'Escape') {
        ev.preventDefault()
        if (state.kind === 'preview') patchPreview({ edit: null })
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        commitTitle(titleInput.value)
        // Cmd+Enter from any edit triggers Save when title non-empty.
        triggerSaveFromKeyboard()
      }
    })
  }

  // Year input handlers.
  const yearInput = document.getElementById('edit-year') as HTMLInputElement | null
  if (yearInput) {
    yearInput.focus()
    yearInput.select()
    yearInput.addEventListener('blur', () => commitYear(yearInput.value))
    yearInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !(ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        commitYear(yearInput.value)
      } else if (ev.key === 'Escape') {
        ev.preventDefault()
        if (state.kind === 'preview') patchPreview({ edit: null })
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        commitYear(yearInput.value)
        triggerSaveFromKeyboard()
      }
    })
  }

  // Abstract textarea handlers. Plain Enter is a newline (multi-line field);
  // only blur / Cmd+Enter commit, Escape reverts.
  const abstractInput = document.getElementById('edit-abstract') as HTMLTextAreaElement | null
  if (abstractInput) {
    abstractInput.focus()
    const end = abstractInput.value.length
    abstractInput.setSelectionRange(end, end)
    abstractInput.addEventListener('blur', () => commitAbstract(abstractInput.value))
    abstractInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        if (state.kind === 'preview') patchPreview({ edit: null })
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        commitAbstract(abstractInput.value)
        triggerSaveFromKeyboard()
      }
    })
  }

  // Authors edit handlers.
  //
  // The editor's own buttons (+ Add author / Done / × remove) bind on
  // `mousedown` + `preventDefault`, NOT `click`: a `click` would first blur the
  // focused first/last input, whose blur handler re-renders the whole popup —
  // destroying the button before `mouseup`, so the click never lands. Binding
  // on `mousedown` + `preventDefault` keeps input focus, lets us commit the
  // in-progress edits explicitly, then apply the action.
  if (s.edit === 'authors' && s.metadata.kind === 'ready') {
    const addBtn = document.getElementById('add-author')
    addBtn?.addEventListener('mousedown', (ev) => {
      ev.preventDefault()
      commitAuthorsFromDOM() // capture in-progress first/last edits
      if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
      const next: EditableMetadata = {
        ...state.metadata.editable,
        authors: [...state.metadata.editable.authors, { first: '', last: '' }],
      }
      patchPreview({ metadata: { kind: 'ready', editable: next } })
    })
    document.querySelectorAll<HTMLButtonElement>('[data-action="remove-author"]').forEach((btn) => {
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        const idx = Number.parseInt(btn.dataset.index ?? '-1', 10)
        commitAuthorsFromDOM() // capture the OTHER rows' in-progress edits first
        if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
        if (!Number.isFinite(idx) || idx < 0) return
        const authors = state.metadata.editable.authors.filter((_, i) => i !== idx)
        patchPreview({
          metadata: { kind: 'ready', editable: { ...state.metadata.editable, authors } },
        })
      })
    })
    const doneBtn = document.getElementById('authors-commit')
    doneBtn?.addEventListener('mousedown', (ev) => {
      ev.preventDefault()
      commitAuthorsFromDOM()
      patchPreview({ edit: null })
    })
    // Live-sync author edits to state on blur of any first/last input. (Blur
    // still fires when focus leaves the editor entirely — e.g. clicking a
    // metadata row or the tag input — which is the intended commit path.)
    document
      .querySelectorAll<HTMLInputElement>('.milton-popup-author-first, .milton-popup-author-last')
      .forEach((inp) => {
        inp.addEventListener('blur', () => commitAuthorsFromDOM())
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault()
            commitAuthorsFromDOM()
            triggerSaveFromKeyboard()
          } else if (ev.key === 'Escape') {
            ev.preventDefault()
            if (state.kind === 'preview') patchPreview({ edit: null })
          }
        })
      })
  }

  // Clicking the tag field's empty space focuses the inline input (clicks that
  // land on a chip button fall through to the chip's own handler).
  const tagField = document.getElementById('tag-field')
  tagField?.addEventListener('mousedown', (ev) => {
    if (ev.target === tagField) {
      ev.preventDefault()
      document.getElementById('tag-input')?.focus()
    }
  })

  // Tag input handlers.
  const tagInput = document.getElementById('tag-input') as HTMLInputElement | null
  if (tagInput) {
    // Restore focus + cursor at end if user was typing.
    if (s.tagInput.length > 0) {
      tagInput.focus()
      const pos = tagInput.value.length
      tagInput.setSelectionRange(pos, pos)
    }
    tagInput.addEventListener('input', () => {
      if (state.kind !== 'preview') return
      // New input → the suggestion list changes; drop any ↑/↓ highlight.
      patchPreview({ tagInput: tagInput.value, tagSuggestionIndex: -1 })
    })
    tagInput.addEventListener('keydown', (ev) => {
      if (state.kind !== 'preview') return
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        const count = currentTagSuggestions(state).length
        if (count === 0) return
        patchPreview({ tagSuggestionIndex: Math.min(state.tagSuggestionIndex + 1, count - 1) })
        focusTagInput()
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        const count = currentTagSuggestions(state).length
        if (count === 0) return
        patchPreview({ tagSuggestionIndex: Math.max(state.tagSuggestionIndex - 1, -1) })
        focusTagInput()
      } else if (ev.key === 'Enter') {
        ev.preventDefault()
        const withSave = ev.metaKey || ev.ctrlKey
        // A highlighted dropdown entry wins; otherwise fall through to the
        // exact-match / create-new routing.
        const suggestions = currentTagSuggestions(state)
        const highlighted =
          state.tagSuggestionIndex >= 0 ? suggestions[state.tagSuggestionIndex] : undefined
        if (highlighted) {
          addExistingTag(highlighted.id)
        } else {
          handleTagEnter()
        }
        // Keep the cursor in the field so tags can be added back-to-back.
        focusTagInput()
        if (withSave) triggerSaveFromKeyboard()
      }
    })
  }

  // Autocomplete options (existing tags) + tag chip remove buttons.
  // `mousedown` preventDefault keeps focus in the tag input while clicking an
  // option; after the re-render we re-focus it so the user can keep adding
  // tags without re-clicking the field.
  document.querySelectorAll<HTMLElement>('[data-add-tag-id]').forEach((el) => {
    el.addEventListener('mousedown', (ev) => ev.preventDefault())
    el.addEventListener('click', () => {
      const id = el.dataset.addTagId
      if (!id) return
      addExistingTag(id)
      focusTagInput()
    })
  })
  // Keep the ↑/↓-highlighted option visible inside the capped dropdown.
  document
    .querySelector<HTMLElement>('.milton-popup-tag-option-active')
    ?.scrollIntoView({ block: 'nearest' })
  document.querySelectorAll<HTMLElement>('[data-remove-tag-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.removeTagId
      if (!id) return
      if (state.kind !== 'preview') return
      patchPreview({
        selectedTags: state.selectedTags.filter((t) => !(t.kind === 'existing' && t.id === id)),
      })
    })
  })
  document.querySelectorAll<HTMLElement>('[data-remove-new-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.dataset.removeNewTag
      if (!name) return
      if (state.kind !== 'preview') return
      patchPreview({
        selectedTags: state.selectedTags.filter((t) => !(t.kind === 'new' && t.name === name)),
      })
    })
  })

  // Segmented tab control — switches between the metadata preview and the
  // collections / projects picker. Bound regardless of `activeTab` so both
  // tabs stay clickable.
  bind('tab-main', () => {
    if (state.kind === 'preview') patchPreview({ activeTab: 'main' })
  })
  bind('tab-add-to', () => {
    if (state.kind === 'preview') patchPreview({ activeTab: 'add-to' })
  })

  // "Add to..." tab — collections / projects sub-toggle (resets the search).
  bind('addto-collections', () => {
    if (state.kind === 'preview') patchPreview({ addToView: 'collections', addToSearch: '' })
  })
  bind('addto-projects', () => {
    if (state.kind === 'preview') patchPreview({ addToView: 'projects', addToSearch: '' })
  })

  // "Add to..." tab — search filter.
  const addToSearch = document.getElementById('addto-search') as HTMLInputElement | null
  if (addToSearch) {
    if (s.addToSearch.length > 0) {
      addToSearch.focus()
      const pos = addToSearch.value.length
      addToSearch.setSelectionRange(pos, pos)
    }
    addToSearch.addEventListener('input', () => {
      if (state.kind !== 'preview') return
      patchPreview({ addToSearch: addToSearch.value })
    })
  }

  // "Add to..." tab — collection / project checkboxes (toggle membership).
  document.querySelectorAll<HTMLElement>('[data-toggle-collection]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleCollection
      if (!id || state.kind !== 'preview') return
      const have = state.selectedCollectionIds.includes(id)
      patchPreview({
        selectedCollectionIds: have
          ? state.selectedCollectionIds.filter((x) => x !== id)
          : [...state.selectedCollectionIds, id],
      })
    })
  })
  document.querySelectorAll<HTMLElement>('[data-toggle-project]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleProject
      if (!id || state.kind !== 'preview') return
      const have = state.selectedProjectIds.includes(id)
      patchPreview({
        selectedProjectIds: have
          ? state.selectedProjectIds.filter((x) => x !== id)
          : [...state.selectedProjectIds, id],
      })
    })
  })

  // Save button.
  bind('save-btn', () => save())
}

function commitTitle(newTitle: string): void {
  if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
  patchPreview({
    metadata: {
      kind: 'ready',
      editable: { ...state.metadata.editable, title: newTitle },
    },
    edit: null,
  })
}

function commitYear(input: string): void {
  if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
  const year = parseYearInput(input)
  patchPreview({
    metadata: {
      kind: 'ready',
      editable: { ...state.metadata.editable, year },
    },
    edit: null,
  })
}

function commitAbstract(value: string): void {
  if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
  patchPreview({
    metadata: {
      kind: 'ready',
      editable: { ...state.metadata.editable, abstract: value },
    },
    edit: null,
  })
}

function commitAuthorsFromDOM(): void {
  if (state.kind !== 'preview' || state.metadata.kind !== 'ready') return
  const rows = document.querySelectorAll<HTMLElement>('.milton-popup-author-edit-row')
  // Editor not in the DOM (mid-teardown, or a stray blur fired during a
  // re-render) — there's nothing to read, so don't clobber state with [].
  if (rows.length === 0) return
  const authors: { first: string; last: string }[] = []
  rows.forEach((row) => {
    const first = (row.querySelector('.milton-popup-author-first') as HTMLInputElement | null)?.value ?? ''
    const last = (row.querySelector('.milton-popup-author-last') as HTMLInputElement | null)?.value ?? ''
    authors.push({ first, last })
  })
  patchPreview({
    metadata: {
      kind: 'ready',
      editable: { ...state.metadata.editable, authors },
    },
  })
}

function focusTagInput(): void {
  document.getElementById('tag-input')?.focus()
}

// Attach an existing tag (from a clicked or ↑/↓-selected dropdown option),
// clearing the input + dropdown highlight so the user can type the next one.
function addExistingTag(id: string): void {
  if (state.kind !== 'preview') return
  const alreadyThere = state.selectedTags.some((t) => t.kind === 'existing' && t.id === id)
  patchPreview({
    selectedTags: alreadyThere
      ? state.selectedTags
      : [...state.selectedTags, { kind: 'existing', id }],
    tagInput: '',
    tagSuggestionIndex: -1,
  })
}

function handleTagEnter(): void {
  if (state.kind !== 'preview') return
  const status = selectorStatus(state.selectors, 'tags')
  const allTags = status.kind === 'ready' ? status.tags : []
  const action = decideTagInputEnter(state.tagInput, allTags)
  if (action.kind === 'ignore') return
  if (action.kind === 'select-existing') {
    addExistingTag(action.id)
    return
  }
  // create-new: avoid dupes (case-insensitive)
  const exists = state.selectedTags.some(
    (t) => t.kind === 'new' && t.name.toLowerCase() === action.name.toLowerCase(),
  )
  if (exists) {
    patchPreview({ tagInput: '', tagSuggestionIndex: -1 })
    return
  }
  patchPreview({
    selectedTags: [...state.selectedTags, { kind: 'new', name: action.name }],
    tagInput: '',
    tagSuggestionIndex: -1,
  })
}

function triggerSaveFromKeyboard(): void {
  if (state.kind !== 'preview') return
  if (!canSave(state)) return
  void save()
}

// ── Save flow ──────────────────────────────────────────────────────────────

async function save(): Promise<void> {
  if (state.kind !== 'preview') return
  if (!canSave(state) || !currentUrl) return

  // `ready` → save the (possibly edited) metadata. `loading` → "instant Save":
  // the user didn't wait for the fetch, so save with the browser tab's title
  // (or the URL as a last resort). Any tags the user picked still go through.
  let editable: EditableMetadata
  if (state.metadata.kind === 'ready') {
    editable = state.metadata.editable
  } else {
    const instantTitle = (currentTabTitle ?? '').trim() || currentUrl
    editable = blankEditable(instantTitle)
  }

  // Split the ordered `selectedTags` list into the connector's two arrays.
  const tagIds = selectedExistingIds(state.selectedTags)
  const newTagNames = selectedNewNames(state.selectedTags)
  const projectIds = [...state.selectedProjectIds]
  const collectionIds = [...state.selectedCollectionIds]

  // Build the payload via the mapper, then assign the four selector arrays.
  let payload = mapMetadataToPayload(editableToMapperInput(editable), currentUrl)
  payload.tagIds = tagIds
  payload.newTagNames = newTagNames
  payload.projectIds = projectIds
  payload.collectionIds = collectionIds

  // BE-7: when the active tab IS a PDF, pass its URL so Milton's connector can
  // download + attach the binary server-side. Silent best-effort — no popup
  // UI affordance; SSRF validation happens on the connector side (AC9).
  // BE-8-7 BT5 suppression: when Flow A succeeded and pendingPdfBytes is
  // staged, we will upload the bytes via attachPdfBytes post-create — do NOT
  // also set pdfUrl, or the connector's BE-7 `maybe_spawn_direct_fetch` will
  // race the bytes-upload (one wins; the other emits "already_attached"
  // noise + wastes a server-side fetch). `pdfUrl` is set ONLY when we are
  // NOT planning to upload bytes (BE-7 fallback OR non-PDF page).
  const willUploadBytes =
    (pdfAttachmentMode === 'flow-a' && pendingPdfBytes !== null) ||
    (pdfAttachmentMode === 'flow-b' && pendingPdfAttachmentUrl !== null)
  if (detectPdfPage(currentUrl, currentTabMimeType) && !willUploadBytes) {
    payload.pdfUrl = currentUrl
  }

  // BE-8-6 smoke S4 follow-up: when the save came from the server-fallback
  // path AND the metadata has no academic signal (no DOI / no year / no
  // journal), treat as a webpage capture — `type='website'` + today's year.
  // User-edited DOI/year/journal disables the override.
  payload = applyGenericWebpageDefaults(
    payload,
    editable,
    state.metadataSource === 'server-translate',
  )

  setState({ kind: 'posting', payload })
  const result = await createReference(payload)
  if (!result.ok) {
    dispatchCreateReferenceResult(result)
    return
  }
  // createReference succeeded. BE-8-7: branch on pdfAttachmentMode.
  await runPostCreatePdfFlow(result.id)
}

/**
 * BE-8-7: post-create PDF-attachment dispatch. Runs AFTER createReference
 * returns 201; branches on `pdfAttachmentMode`. **Silent** per Pierre's UX
 * direction: no visible state transitions during fetch/upload. The popup
 * stays in `posting` ("Saving to Milton…") until the upload resolves, then
 * transitions straight to `success` — with `pdfAttached: true` (small PDF
 * icon) when bytes attached, `pdfAttached: false` otherwise. Soft-degrade
 * is the rule: reference IS saved regardless of attach outcome.
 */
async function runPostCreatePdfFlow(referenceId: string): Promise<void> {
  // 'be-7-fallback' — connector attaches PDF asynchronously via the existing
  // BE-7 direct-fetch path. From the popup's POV the save is done. We don't
  // know whether the connector's async fetch will succeed, so omit the icon.
  if (pdfAttachmentMode === 'be-7-fallback') {
    setState({ kind: 'success', id: referenceId })
    return
  }

  // 'flow-a' — bytes staged at boot; upload directly. Stay in `posting`
  // visually; transition to success when done.
  if (pdfAttachmentMode === 'flow-a' && pendingPdfBytes !== null) {
    const ok = await uploadPdfBytes(referenceId, pendingPdfBytes)
    pendingPdfBytes = null // BT1/BT3 hygiene — release the 50 MiB ASAP
    setState({ kind: 'success', id: referenceId, pdfAttached: ok })
    return
  }

  // 'flow-b' — fetch the PDF attachment URL in-tab, then upload. Stay in
  // `posting` visually throughout both phases.
  if (pdfAttachmentMode === 'flow-b' && pendingPdfAttachmentUrl !== null) {
    if (currentTabId === undefined) {
      console.warn('[milton-popup] no tabId for Flow B attach; saved without PDF')
      setState({ kind: 'success', id: referenceId })
      return
    }
    let bytes: ArrayBuffer
    try {
      const result = await fetchPdfBytesInTab(currentTabId, pendingPdfAttachmentUrl, {
        timeoutMs: PDF_FETCH_TIMEOUT_MS,
      })
      bytes = result.bytes
    } catch (err) {
      const code = err instanceof PdfFetchInTabError ? err.code : 'UNKNOWN'
      console.log(`[milton-popup] pdf-class2-fallback reason=${code} mode=flow-b`)
      setState({ kind: 'success', id: referenceId })
      return
    }
    const ok = await uploadPdfBytes(referenceId, bytes)
    setState({ kind: 'success', id: referenceId, pdfAttached: ok })
    return
  }

  // 'none' — no PDF to attach. Preserve the BE-1/BE-2 success UX (no icon).
  setState({ kind: 'success', id: referenceId })
}

/**
 * BE-8-7: upload PDF bytes via attachPdfBytes. Returns true if bytes were
 * attached (200 attached or already_attached); false otherwise. Pierre's
 * UX direction: no per-error distinction at the popup level; 408 timeout +
 * 400/403/404/413/503 + network-error all collapse to "saved without PDF"
 * (user sees in Milton). Uses fetch branch (no onProgress) since the
 * popup no longer renders progress.
 */
async function uploadPdfBytes(referenceId: string, bytes: ArrayBuffer): Promise<boolean> {
  pdfUploadAbort = new AbortController()
  try {
    const result = await attachPdfBytes(referenceId, bytes, {
      timeoutMs: PDF_UPLOAD_TIMEOUT_MS,
      signal: pdfUploadAbort.signal,
    })
    if (result.ok) return true
    console.warn('[milton-popup] attachPdfBytes failed', result)
    return false
  } finally {
    pdfUploadAbort = null
  }
}

// ── Error dispatchers (inherited from BE-4) ────────────────────────────────

function dispatchTokenMintError(err: TokenFailure): void {
  switch (err.reason) {
    case 'signed-out':
      setState({ kind: 'signed-out' })
      break
    case 'origin-rejected':
      setState({
        kind: 'error-auth-failed',
        detail: 'This extension is not authorized by your Milton install.',
      })
      break
    case 'rate-limited':
      setState({ kind: 'error-rate-limited', retryAfterSeconds: err.retryAfterSeconds })
      break
    case 'network-error':
      setState({ kind: 'milton-not-running' })
      break
    case 'unexpected':
      setState({ kind: 'error-network', message: err.message })
      break
  }
}

function dispatchTranslateServerError(err: TranslateError): void {
  switch (err.kind) {
    case 'no-metadata':
      // Title is required for the connector POST, so an empty extraction can't
      // produce a savable preview — exit to the dedicated error state.
      setState({ kind: 'error-no-metadata' })
      break
    case 'token-expired':
    case 'token-invalid':
    case 'wrong-audience':
    case 'device-owner-mismatch':
      setState({ kind: 'error-auth-failed', detail: 'Authentication failed, try again.' })
      break
    case 'device-not-registered':
      setState({
        kind: 'error-auth-failed',
        detail: 'Sign out and back in to Milton to re-register this device.',
      })
      break
    case 'tier-required':
      setState({
        kind: 'error-tier-required',
        requiredTiers: err.requiredTiers,
        upgradeUrl: err.upgradeUrl,
      })
      break
    case 'tier-revoked':
      setState({
        kind: 'error-tier-required',
        requiredTiers: [err.dbTier || 'paid'],
        upgradeUrl: err.upgradeUrl,
      })
      break
    case 'quota-exceeded':
      setState({
        kind: 'error-quota-exceeded',
        nextResetSeconds: err.nextResetSeconds,
        upgradeUrl: 'https://milton.so/upgrade',
      })
      break
    case 'rate-limited':
      setState({ kind: 'error-rate-limited', retryAfterSeconds: err.retryAfterSeconds })
      break
    case 'key-lookup-unavailable':
    case 'service-unavailable':
      setState({
        kind: 'error-service-unavailable',
        retryAfterSeconds: err.retryAfterSeconds,
      })
      break
    case 'payload-too-large':
      setState({ kind: 'error-too-large' })
      break
    case 'bad-gateway':
    case 'method-not-allowed':
    case 'not-found':
      setState({ kind: 'error-network', message: 'Translation service returned an unexpected response.' })
      break
    case 'unexpected':
      setState({ kind: 'error-network', message: err.message })
      break
    case 'network-error':
      setState({ kind: 'error-network', message: err.message })
      break
  }
}

function dispatchCreateReferenceResult(result: CreateReferenceResult): void {
  if (result.ok) {
    setState({ kind: 'success', id: result.id })
    return
  }
  switch (result.status) {
    case 503:
      setState({ kind: 'signed-out' })
      break
    case 409:
      setState({ kind: 'error-409-duplicate', existingId: result.id })
      break
    case 400:
      setState({
        kind: 'error-400-validation',
        message: result.message,
        detail: result.detail,
      })
      break
    case 'payload-too-large':
      setState({ kind: 'error-too-large' })
      break
    case 403:
    case 'network-error':
    default:
      setState({ kind: 'error-network', message: result.message })
      break
  }
}

// ── Misc ───────────────────────────────────────────────────────────────────

function retry(): void {
  // Full re-boot — simpler than trying to thread state from an error back to
  // preview. The user already lost their selections when we transitioned out.
  setState({ kind: 'loading-tab' })
  void boot()
}

function openMilton(): void {
  void chrome.tabs.create({ url: 'milton://' })
  window.close()
}

function bind(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', handler)
}

function humanizeSeconds(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return 'a moment'
  if (secs < 60) return `${Math.round(secs)} seconds`
  if (secs < 3600) return `${Math.round(secs / 60)} minutes`
  if (secs < 86400) return `${Math.round(secs / 3600)} hours`
  return `${Math.round(secs / 86400)} days`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}

// Suppress "unused import" warning — MetadataPrimary is used via inferred types only.
export type { MetadataPrimary as _MetadataPrimaryRef }

// Force initial render so the DOM matches `state` from the very first frame.
render()
