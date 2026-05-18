// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import type {
  CollectionSummary,
  ConnectorReferencePayload,
  CreateReferenceResult,
  HealthResponse,
  HealthResult,
  ProjectSummary,
  SelectorsResult,
  TagSummary,
} from './types'

// SINGLE source of truth for the connector base URL — story BE-1 AC1 + Pre-Review check.
// Per docs/integrations/browser-extension-protocol.mdx the port is part of the contract;
// the extension hardcodes it.
const CONNECTOR_BASE = 'http://127.0.0.1:7521'
const HEALTH_TIMEOUT_MS = 2000
const SELECTOR_TIMEOUT_MS = 2000
const MAX_BODY_BYTES = 64 * 1024 // matches connector/server.rs MAX_BODY_BYTES

/**
 * BE-8-7 — Maximum PDF body size for `POST /references/{id}/pdf-bytes`.
 *
 * MUST match `connector::server::MAX_PDF_BYTES` in Milton-saas (BE-8-2 AC1).
 * Bumping this without bumping the server-side cap will cause uploads to fail
 * with 413 at the connector instead of being caught client-side. Both ends
 * sized to cover typical academic PDFs (MIT thesis ~10-30 MiB, Nature paper
 * ~1-5 MiB) while rejecting attacker-supplied 1 GiB textbooks before they
 * exhaust memory.
 *
 * Re-exported so `src/lib/pdf-fetch-in-tab.ts` and any future caller share a
 * single source of truth.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MiB

/**
 * Probe Milton's local connector for liveness.
 * 200 OK + valid JSON shape → ok; refusal / timeout / shape mismatch → !ok with reason.
 *
 * Per protocol doc: GET /health returns 200 unconditionally when the server runs.
 * Used by the popup to gate the Save UI BEFORE allowing AC5 → AC6 flow.
 */
export async function health(): Promise<HealthResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
  try {
    const resp = await fetch(`${CONNECTOR_BASE}/health`, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!resp.ok) return { ok: false, reason: 'shape' }
    const body = (await resp.json()) as HealthResponse
    if (typeof body.app !== 'string' || typeof body.version !== 'string') {
      return { ok: false, reason: 'shape' }
    }
    if (body.app !== 'milton') {
      // AC3 atypical: log + proceed (forward-compat).
      console.warn(
        `[milton-ext] connector returned unexpected app: "${body.app}" (proceeding)`,
      )
    }
    return { ok: true, body }
  } catch (e) {
    clearTimeout(t)
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' }
    }
    return { ok: false, reason: 'refused' }
  }
}

/**
 * POST a reference to Milton's connector.
 *
 * AC6 atypical: pre-checks body size against the 64 KB connector limit and
 * surfaces a friendly error rather than letting axum reject it.
 *
 * AC7 forward-compat: caller must pass the 4 organization arrays. The mapper
 * (`csl-to-payload.ts`) populates them as empty defaults so the wire shape
 * stays locked.
 */
export async function createReference(
  payload: ConnectorReferencePayload,
): Promise<CreateReferenceResult> {
  const body = JSON.stringify(payload)
  if (body.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 'payload-too-large',
      message: 'Page metadata too large to capture',
    }
  }

  let resp: Response
  try {
    resp = await fetch(`${CONNECTOR_BASE}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  } catch (e) {
    return {
      ok: false,
      status: 'network-error',
      message: e instanceof Error ? e.message : 'Network error',
    }
  }

  // Decode body once. Many error responses share { message, detail? }.
  let parsed: unknown
  try {
    parsed = await resp.json()
  } catch {
    parsed = {}
  }
  const data = (typeof parsed === 'object' && parsed !== null
    ? parsed
    : {}) as Record<string, unknown>

  switch (resp.status) {
    case 201:
      return { ok: true, status: 201, id: String(data.id ?? '') }
    case 400:
      return {
        ok: false,
        status: 400,
        message: String(data.message ?? 'Invalid request'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    case 403:
      return {
        ok: false,
        status: 403,
        message: String(data.message ?? 'Forbidden'),
      }
    case 409:
      return {
        ok: false,
        status: 409,
        id: String(data.id ?? ''),
        matchedBy: String(data.matchedBy ?? ''),
        message: String(data.message ?? 'Already in your library'),
      }
    case 503:
      return {
        ok: false,
        status: 503,
        message: String(data.message ?? 'Milton is not signed in'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    default:
      return {
        ok: false,
        status: 'network-error',
        message: `Unexpected response: ${resp.status}`,
      }
  }
}

// --- Story BE-2: dropdown selectors for the rich popup ---------------------
//
// Fires GET /tags + GET /projects + GET /collections in parallel via
// Promise.allSettled with a 2s per-call timeout. Result-shape rules:
//
//   • All three 200 → { ok: true, tags, projects, collections }
//   • Any 503 (signed out) → { ok: false, reason: 'signed-out' }
//     — popup transitions to existing `signed-out` state; selectors AND
//       save UI disappear together (no half-rendered preview).
//   • Mix of 200 + non-503 failures → { ok: false, reason: 'partial-failure',
//     tags|projects|collections: null for the failed call(s) }
//     — popup renders graceful-degrade per AC3/AC4/AC5 ("Tags unavailable",
//       hide-section-on-empty, etc.). Save proceeds with empty arrays.

type SelectorFetch<T> =
  | { kind: 'ok'; value: T[] }
  | { kind: 'signed-out' }
  | { kind: 'failed' }

export async function listSelectors(): Promise<SelectorsResult> {
  const [tagsRes, projectsRes, collectionsRes] = await Promise.all([
    fetchSelector<TagSummary>('/tags', parseTagSummary),
    fetchSelector<ProjectSummary>('/projects', parseProjectSummary),
    fetchSelector<CollectionSummary>('/collections', parseCollectionSummary),
  ])

  if (
    tagsRes.kind === 'signed-out' ||
    projectsRes.kind === 'signed-out' ||
    collectionsRes.kind === 'signed-out'
  ) {
    return { ok: false, reason: 'signed-out' }
  }

  if (
    tagsRes.kind === 'ok' &&
    projectsRes.kind === 'ok' &&
    collectionsRes.kind === 'ok'
  ) {
    return {
      ok: true,
      tags: tagsRes.value,
      projects: projectsRes.value,
      collections: collectionsRes.value,
    }
  }

  return {
    ok: false,
    reason: 'partial-failure',
    tags: tagsRes.kind === 'ok' ? tagsRes.value : null,
    projects: projectsRes.kind === 'ok' ? projectsRes.value : null,
    collections: collectionsRes.kind === 'ok' ? collectionsRes.value : null,
  }
}

async function fetchSelector<T>(
  path: '/tags' | '/projects' | '/collections',
  parseEntry: (raw: unknown) => T | null,
): Promise<SelectorFetch<T>> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), SELECTOR_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(`${CONNECTOR_BASE}${path}`, {
      method: 'GET',
      signal: ctrl.signal,
    })
  } catch {
    clearTimeout(t)
    return { kind: 'failed' }
  }
  clearTimeout(t)

  if (resp.status === 503) return { kind: 'signed-out' }
  if (!resp.ok) return { kind: 'failed' }

  let parsed: unknown
  try {
    parsed = await resp.json()
  } catch {
    return { kind: 'failed' }
  }
  if (!Array.isArray(parsed)) return { kind: 'failed' }

  const value: T[] = []
  for (const raw of parsed) {
    const entry = parseEntry(raw)
    if (entry === null) {
      console.warn(`[milton-ext] dropping malformed ${path} entry`, raw)
      continue
    }
    value.push(entry)
  }
  return { kind: 'ok', value }
}

function parseTagSummary(raw: unknown): TagSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  return { id: r.id, name: r.name }
}

function parseProjectSummary(raw: unknown): ProjectSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null
  // The connector still sends `status` on the wire, but the popup's "Add to..."
  // picker doesn't render a status badge (cut in the Figma redesign — AC4
  // reconciled), so `status` is ignored as a forward-compat extra field.
  return { id: r.id, title: r.title }
}

function parseCollectionSummary(raw: unknown): CollectionSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  return { id: r.id, name: r.name }
}

// --- Story BE-8-7: PDF bytes upload (Class 2 capture two-step IPC) ---------
//
// Second leg of the BE-8-2 two-step contract: after createReference returns
// 201 {id}, the extension may POST the actual PDF bytes for that reference
// to /references/{id}/pdf-bytes (raw application/pdf body). BE-8-7's Flow A
// (direct-PDF tab) + Flow B (translator returned attachments[].pdf) both
// call this.
//
// Response envelope (per BE-8-2 AC2):
//   200 {status:"attached", referenceId}     — bytes upload won the race
//   200 {status:"already_attached", referenceId} — another writer won
//   400 — empty body / non-PDF magic / invalid id shape
//   403 — reference not owned by active user
//   404 — reference not found
//   408 — server-side TimeoutLayer fired (60s — bytes started uploading but
//         didn't finish). Distinct UX signal from popup-side 'timeout'.
//   413 — body exceeds 50 MiB
//   503 — Milton not signed in
//
// Uses fetch + AbortController for both internal timeout + caller-side
// cancellation. The BE-8-7 Task 6 scope cut dropped the upload-progress UI,
// so no XHR/onProgress branch — fetch is sufficient. (If a future story
// re-introduces a progress bar, swap to XMLHttpRequest's upload.onprogress
// or fetch + TransformStream wrapper at that time.)

export type AttachPdfBytesResult =
  | { ok: true; status: 'attached' | 'already_attached'; referenceId: string }
  | {
      ok: false
      status: 400 | 403 | 404 | 408 | 413 | 503
      message: string
      detail?: string
    }
  | { ok: false; status: 'network-error' | 'timeout'; message: string }

export interface AttachPdfBytesOptions {
  /** Default 90_000 ms (60s server-side timeout + 30s headroom for slow WiFi). */
  timeoutMs?: number
  /**
   * Optional external AbortSignal (popup's beforeunload handler wires this
   * to cancel the upload on popup close). Cancellation via this signal
   * surfaces as `status: 'network-error'`; the internal timeout fires
   * `status: 'timeout'` — two outcomes, two statuses (M6 from BE-8-7
   * code-review).
   */
  signal?: AbortSignal
}

const ATTACH_PDF_DEFAULT_TIMEOUT_MS = 90_000

/**
 * POST PDF bytes to `/references/{referenceId}/pdf-bytes` (BE-8-2 endpoint).
 *
 * Callers MUST pass the RAW reference-id string (a UUID from
 * createReference's 201 response). Internal `encodeURIComponent` is
 * defense-in-depth; double-encoding (caller pre-encodes) would produce
 * `%252F` and fail validation server-side.
 */
export async function attachPdfBytes(
  referenceId: string,
  bytes: ArrayBuffer,
  opts?: AttachPdfBytesOptions,
): Promise<AttachPdfBytesResult> {
  // BT5: body-cap pre-check. Save a wasted round-trip when the bytes are
  // already over the documented cap. Matches BE-8-2's server-side limit.
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `PDF too large (${bytes.byteLength} bytes exceeds ${MAX_PDF_BYTES})`,
    }
  }
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      message: 'PDF body is empty',
    }
  }

  const url = `${CONNECTOR_BASE}/references/${encodeURIComponent(referenceId)}/pdf-bytes`
  const timeoutMs = opts?.timeoutMs ?? ATTACH_PDF_DEFAULT_TIMEOUT_MS
  const externalSignal = opts?.signal

  const ctrl = new AbortController()
  const onExternalAbort = (): void => ctrl.abort()
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) ctrl.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  // M6: track which source aborted so we can distinguish local-timeout
  // (`status: 'timeout'`) from external-cancel (`status: 'network-error'`).
  let timeoutTriggered = false
  const t = setTimeout(() => {
    timeoutTriggered = true
    ctrl.abort()
  }, timeoutMs)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Blob([bytes], { type: 'application/pdf' }),
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(t)
    if (externalSignal !== undefined) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
    if (ctrl.signal.aborted) {
      if (timeoutTriggered) {
        return {
          ok: false,
          status: 'timeout',
          message: `upload did not complete within ${timeoutMs} ms`,
        }
      }
      // External signal aborted — caller cancelled (e.g., popup beforeunload).
      return { ok: false, status: 'network-error', message: 'aborted' }
    }
    return {
      ok: false,
      status: 'network-error',
      message: e instanceof Error ? e.message : 'Network error',
    }
  }
  clearTimeout(t)
  if (externalSignal !== undefined) {
    externalSignal.removeEventListener('abort', onExternalAbort)
  }
  return parseAttachResponse(resp, referenceId)
}

async function parseAttachResponse(
  resp: Response,
  referenceId: string,
): Promise<AttachPdfBytesResult> {
  let parsed: unknown
  try {
    parsed = await resp.json()
  } catch {
    parsed = {}
  }
  const data = (typeof parsed === 'object' && parsed !== null
    ? parsed
    : {}) as Record<string, unknown>

  switch (resp.status) {
    case 200: {
      const status = data.status === 'already_attached' ? 'already_attached' : 'attached'
      // referenceId in the response is informational; we already have it.
      return { ok: true, status, referenceId }
    }
    case 400:
      return {
        ok: false,
        status: 400,
        message: String(data.message ?? 'Bad request'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    case 403:
      return {
        ok: false,
        status: 403,
        message: String(data.message ?? 'Reference not owned by active user'),
      }
    case 404:
      return {
        ok: false,
        status: 404,
        message: String(data.message ?? 'Reference not found'),
      }
    case 408:
      return {
        ok: false,
        status: 408,
        message: String(data.message ?? 'Upload timed out at the connector'),
      }
    case 413:
      return {
        ok: false,
        status: 413,
        message: String(data.message ?? 'PDF too large'),
      }
    case 503:
      return {
        ok: false,
        status: 503,
        message: String(data.message ?? 'Milton is not signed in'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    default:
      return {
        ok: false,
        status: 'network-error',
        message: `Unexpected response: ${resp.status}`,
      }
  }
}
