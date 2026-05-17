// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-6: Map a Zotero translator's `ZoteroItem` shape to Milton's
// connector `ConnectorReferencePayload`. Mirrors BE-4's
// `metadata-to-payload.ts` (which maps the translate.milton.so/metadata
// envelope's `MetadataPrimary` shape); this is the parallel mapper for
// when the popup receives items from the CLIENT-side translator (BE-8-6
// Class 3 flow) instead of the server-side translation orchestrator.
//
// Field mapping reference: vendor/zotero-translate/modules/utilities/
// resource/zoteroTypeSchemaData.js documents canonical Zotero item
// fields. Translator output typically populates: itemType, title,
// creators[], date, abstractNote, DOI, url, publicationTitle (journal),
// plus per-type extras (archiveID for arXiv, etc.).
//
// DOI passed verbatim — mirrors `metadata-to-payload.ts:46`. Connector
// handles canonicalization server-side.

import type {
  ConnectorAuthor,
  ConnectorReferencePayload,
  ConnectorReferenceType,
} from './types'

// Constants for parseYearFromDateString — mirror popup-helpers.parseYearInput
// so behavior stays uniform across the two entry points.
const CURRENT_YEAR = new Date().getFullYear()
const MIN_YEAR = 1500
const MAX_YEAR = CURRENT_YEAR + 2

/**
 * Subset of the ZoteroItem shape that the mapper consumes. The full
 * ZoteroItem (defined in `../translator-runtime/zotero-types.d.ts`)
 * carries an open index signature for translator-specific extras.
 */
export interface ZoteroItemForMapping {
  itemType?: string
  title?: string
  creators?: ZoteroItemCreator[]
  date?: string
  abstractNote?: string
  DOI?: string
  url?: string
  publicationTitle?: string
  [key: string]: unknown
}

export interface ZoteroItemCreator {
  firstName?: string
  lastName?: string
  name?: string
  creatorType?: string
}

/**
 * Parse a 4-digit year from a Zotero date string. Zotero dates are loosely
 * structured ("2024", "2024-03", "2024-03-15", "March 2024", "in press", etc.).
 * Returns the first 4-consecutive-digit substring as an int if within bounds,
 * else 0 (sentinel for "omit year from payload" — matches mapMetadataToPayload).
 */
export function parseYearFromDateString(input: string | undefined): number {
  if (input === undefined || input === null || input.length === 0) return 0
  const m = input.match(/(\d{4})/)
  if (!m) return 0
  const year = Number.parseInt(m[1], 10)
  if (!Number.isFinite(year)) return 0
  if (year < MIN_YEAR || year > MAX_YEAR) return 0
  return year
}

/**
 * Map Zotero translator `itemType` strings to Milton's connector enum.
 * Default branch returns 'other'. Mappings cover the documented Zotero
 * itemType values most commonly emitted by Web translators (per
 * vendor/zotero-translate/modules/utilities/resource/schema/global/schema.json
 * — Zotero schema's item-type table).
 */
export function mapZoteroItemTypeToConnector(itemType: string | undefined): ConnectorReferenceType {
  if (typeof itemType !== 'string' || itemType.length === 0) return 'other'
  switch (itemType) {
    // Articles (incl. legacy variants used by some translators).
    case 'journalArticle':
    case 'journal-article':
    case 'article':
    case 'magazineArticle':
    case 'newspaperArticle':
      return 'article'
    case 'conferencePaper':
    case 'conference-paper':
      return 'conferencePaper'
    case 'preprint':
    case 'manuscript':
      return 'preprint'
    case 'book':
      return 'book'
    case 'bookSection':
    case 'chapter':
    case 'book-section':
      return 'chapter'
    case 'thesis':
      return 'thesis'
    case 'report':
    case 'document':
      return 'report'
    case 'webpage':
    case 'blogPost':
    case 'web-page':
      return 'website'
    default:
      return 'other'
  }
}

/**
 * Filter creators to authors only (translators may emit editors,
 * translators, reviewers, contributors, etc.; the connector payload's
 * `authors[]` is authors-specifically). Maps to the connector's
 * `firstName+lastName` OR `fullName` union shape.
 */
function mapAuthors(creators: ZoteroItemCreator[] | undefined): ConnectorAuthor[] {
  if (!Array.isArray(creators)) return []
  const out: ConnectorAuthor[] = []
  for (const c of creators) {
    if (c.creatorType !== undefined && c.creatorType !== 'author') continue
    const first = (c.firstName ?? '').trim()
    const last = (c.lastName ?? '').trim()
    if (first.length > 0 || last.length > 0) {
      out.push({ firstName: first, lastName: last })
      continue
    }
    const full = (c.name ?? '').trim()
    if (full.length > 0) {
      out.push({ fullName: full })
    }
  }
  return out
}

/**
 * Map a ZoteroItem to a ConnectorReferencePayload. The `fallbackUrl` is
 * used when the item itself doesn't carry a `url` (most translators
 * populate it; arXiv-style translators sometimes don't).
 *
 * Emits the AC7 forward-compat envelope (empty tagIds/newTagNames/
 * projectIds/collectionIds) so the popup can populate from BE-2 selectors
 * at save time without re-mapping.
 */
export function mapZoteroItemToPayload(
  item: ZoteroItemForMapping,
  fallbackUrl: string,
): ConnectorReferencePayload {
  const title = typeof item.title === 'string' ? item.title : ''
  const url = typeof item.url === 'string' && item.url.length > 0 ? item.url : fallbackUrl
  const payload: ConnectorReferencePayload = {
    title,
    authors: mapAuthors(item.creators),
    tagIds: [],
    newTagNames: [],
    projectIds: [],
    collectionIds: [],
  }
  const year = parseYearFromDateString(item.date)
  if (year > 0) payload.year = year
  if (typeof item.DOI === 'string' && item.DOI.length > 0) payload.doi = item.DOI
  if (typeof item.abstractNote === 'string' && item.abstractNote.length > 0) {
    payload.abstract = item.abstractNote
  }
  if (url.length > 0) payload.url = url
  const type = mapZoteroItemTypeToConnector(item.itemType)
  if (type !== 'other' || item.itemType !== undefined) {
    // Always send `type` so the connector doesn't default-assume — except
    // the literal `undefined → 'other'` collapse where omission is fine.
    payload.type = type
  }
  return payload
}
