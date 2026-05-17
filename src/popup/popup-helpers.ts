// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Pure helpers extracted from popup.ts for unit testing.
// Anything DOM-touching stays in popup.ts; this file is all data/logic.

import type {
  ConnectorReferencePayload,
  EditableMetadata,
  MetadataAuthor,
  MetadataPrimary,
  TagSummary,
} from '../lib/types'

const CURRENT_YEAR = new Date().getFullYear()
const MIN_YEAR = 1500
const MAX_YEAR = CURRENT_YEAR + 2

const MAX_SUGGESTIONS = 6

/**
 * Join authors into a comma-separated display string.
 * Filters out fully-empty entries before joining.
 */
export function joinAuthors(authors: MetadataAuthor[]): string {
  return authors
    .filter((a) => a.first.length > 0 || a.last.length > 0)
    .map((a) => `${a.first} ${a.last}`.trim())
    .join(', ')
}

/**
 * Format authors for the read-only preview row — mirrors Milton's
 * `formatAuthors` (milton/src/lib/utils/format-authors.ts): up to 3 authors
 * are listed in full, more than 3 collapse to the first 2 + "et al." so the
 * row never grows past a line or two (a paper can carry 40+ authors).
 * Inline edit still operates on the full `authors` array — this is display-only.
 */
export function formatAuthorsDisplay(authors: MetadataAuthor[]): string {
  const names = authors
    .filter((a) => a.first.length > 0 || a.last.length > 0)
    .map((a) => `${a.first} ${a.last}`.trim())
  if (names.length === 0) return ''
  if (names.length <= 3) return names.join(', ')
  return names.slice(0, 2).join(', ') + ' et al.'
}

/**
 * Parse year from a possibly-noisy user input ("2025-03", "in press", "abc").
 * Returns the first 4 consecutive digits as int if it's a valid year, else 0.
 * 0 is the sentinel "omit year from payload" — matches mapMetadataToPayload.
 */
export function parseYearInput(input: string): number {
  const m = input.match(/(\d{4})/)
  if (!m) return 0
  const year = Number.parseInt(m[1], 10)
  if (!Number.isFinite(year)) return 0
  if (year < MIN_YEAR || year > MAX_YEAR) return 0
  return year
}

export type TagInputAction =
  | { kind: 'select-existing'; id: string }
  | { kind: 'create-new'; name: string }
  | { kind: 'ignore' }

/**
 * Decide what hitting Enter on the tag input should do.
 *   • pure-whitespace → ignore
 *   • exact case-insensitive match against an existing tag → select that tag
 *   • otherwise → create-new with the trimmed name
 */
export function decideTagInputEnter(input: string, existingTags: TagSummary[]): TagInputAction {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { kind: 'ignore' }
  const match = existingTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
  if (match) return { kind: 'select-existing', id: match.id }
  return { kind: 'create-new', name: trimmed }
}

/**
 * Substring-match autosuggest. Returns up to MAX_SUGGESTIONS tags whose names
 * contain the input substring (case-insensitive), excluding already-selected ids.
 * Returns [] when input is whitespace-only.
 */
export function filterTagSuggestions(
  input: string,
  allTags: TagSummary[],
  selectedIds: string[],
): TagSummary[] {
  const trimmed = input.trim().toLowerCase()
  if (trimmed.length === 0) return []
  const selected = new Set(selectedIds)
  const out: TagSummary[] = []
  for (const t of allTags) {
    if (selected.has(t.id)) continue
    if (!t.name.toLowerCase().includes(trimmed)) continue
    out.push(t)
    if (out.length >= MAX_SUGGESTIONS) break
  }
  return out
}

/**
 * Clone a MetadataPrimary into an EditableMetadata mirror. The shapes are
 * structurally compatible — this is mostly explicit field copy so future
 * MetadataPrimary additions force us to update the popup state explicitly.
 */
export function metadataToEditable(primary: MetadataPrimary): EditableMetadata {
  return {
    title: primary.title,
    authors: primary.authors.map((a) => ({ first: a.first, last: a.last })),
    year: primary.year,
    doi: primary.doi,
    journal: primary.journal,
    abstract: primary.abstract,
    issued_date: primary.issued_date,
    arxiv_id: primary.arxiv_id,
    issn: primary.issn,
    volume: primary.volume,
    issue: primary.issue,
    pages: primary.pages,
  }
}

/** EditableMetadata is structurally a MetadataPrimary; the mapper accepts it. */
export function editableToMapperInput(editable: EditableMetadata): MetadataPrimary {
  return editable
}

/**
 * A blank EditableMetadata carrying only a title — used for "instant Save"
 * when the user saves a reference before the metadata fetch completes. Every
 * other field is empty so the mapper emits a title-and-URL-only payload.
 */
export function blankEditable(title: string): EditableMetadata {
  return {
    title,
    authors: [],
    year: 0,
    doi: '',
    journal: '',
    abstract: '',
    issued_date: '',
    arxiv_id: '',
    issn: '',
    volume: '',
    issue: '',
    pages: '',
  }
}

/** Title must be non-empty (after trim) for the connector to accept the POST. */
export function isTitleValid(editable: EditableMetadata): boolean {
  return editable.title.trim().length > 0
}

/**
 * BE-8-6 smoke S4 follow-up: when the user saves a page that fell all the way
 * through to the server-fallback flow AND the server returned no academic
 * signal (no DOI, no year, no journal — typically a plain webpage where
 * translate.milton.so could only scrape the `<title>`), the saved reference
 * shouldn't default to `article` with no date. Treat it as a webpage capture
 * — set `type='website'` + `year=currentYear` so the user's library doesn't
 * fill with dateless "article" junk when they save random pages.
 *
 * Why gated on `isFromServerFallback`: a client-translator that produces
 * just a title (rare, e.g., a stripped-down translator) is still trying to
 * extract structured data — overriding its result to `'website'` would be
 * wrong. The server fallback is the path taken when NO translator matched
 * the URL at all, which IS the "looks like a generic webpage" signal.
 *
 * User edits win: if the user manually types in a DOI or year, this helper
 * returns the payload unchanged (the no-academic-signal check fails).
 */
export function applyGenericWebpageDefaults(
  payload: ConnectorReferencePayload,
  editable: EditableMetadata,
  isFromServerFallback: boolean,
): ConnectorReferencePayload {
  const looksGeneric =
    isFromServerFallback &&
    editable.doi.length === 0 &&
    editable.year === 0 &&
    editable.journal.length === 0
  if (!looksGeneric) return payload
  return {
    ...payload,
    type: 'website',
    year: new Date().getFullYear(),
  }
}

/**
 * BE-8-6: shared restricted-URL guard. Used by `popup.ts:boot()` to short-circuit
 * to `cannot-capture` and by `src/lib/page-context.ts:scrapeActiveTabHtml` to
 * reject the chrome.scripting call before it errors. Keeping ONE definition
 * means drift can't open between the popup gate and the scrape gate — both
 * must reject the same URL classes.
 *
 * Restricted schemes:
 *   - chrome:// / chrome-extension:// — browser-internal pages (extension
 *     scripting forbidden by Chrome)
 *   - about: / edge:// / brave:// — Firefox/Edge/Brave internal pages
 *   - file:// — local files; extensions need explicit "Allow access to file
 *     URLs" toggle the user controls. Treat as unsupported by default.
 */
export function isRestrictedUrl(url: string): boolean {
  if (url.length === 0) return true
  const lower = url.toLowerCase()
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('about:') ||
    lower.startsWith('edge://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('file://')
  )
}

/**
 * BE-7: detect whether the active tab is itself a PDF document.
 *
 * Two signals, in order of preference:
 *   1. `mimeType === 'application/pdf'` — Chrome's built-in PDF viewer
 *      surfaces this on the `tabs.Tab` object; content-type-true so it
 *      catches PDFs served from non-`.pdf` URLs (e.g. `/download?file=...`).
 *   2. URL suffix `.pdf` (after stripping `?...` query + `#...` hash) — used
 *      as a fallback when mimeType is undefined or non-PDF (some Chromium
 *      builds omit `mimeType` for non-PDF tabs).
 *
 * Deliberately rejects `.pdf.html` (substring match would false-positive;
 * the trailing-suffix check fires only on exact `.pdf` ending) and
 * `chrome://`, `chrome-extension://`, `about:` URLs (those don't reach the
 * popup's preview state in the first place, but defensively handled here so
 * the helper is safe in isolation).
 */
export function detectPdfPage(url: string, mimeType?: string): boolean {
  if (mimeType === 'application/pdf') return true
  if (!url) return false
  // Reject restricted-URL schemes defensively (popup boot already blocks these,
  // but the helper is exported and must be safe to call standalone). Reuses
  // the shared `isRestrictedUrl` so the two definitions can't drift.
  if (isRestrictedUrl(url)) return false
  // Strip query (`?...`) and fragment (`#...`) before suffix-checking so URLs
  // like `https://host/paper.pdf?download=true` flag correctly.
  const lower = url.toLowerCase()
  const queryIdx = lower.indexOf('?')
  const hashIdx = lower.indexOf('#')
  const cutAt = [queryIdx, hashIdx].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), lower.length)
  const path = lower.slice(0, cutAt)
  return path.endsWith('.pdf')
}

export const POPUP_HELPERS_CONSTANTS = {
  CURRENT_YEAR,
  MIN_YEAR,
  MAX_YEAR,
  MAX_SUGGESTIONS,
} as const
