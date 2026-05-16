// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import type { ConnectorReferencePayload, MetadataPrimary } from './types'

/**
 * Map a `translate.milton.so/metadata` envelope `primary` to the connector's
 * POST /references payload shape.
 *
 * Story BE-4 — replaces BE-1's `csl-to-payload.ts` since TS-14 removed `/web`
 * (Zotero CSL-JSON) in favour of `/metadata` (unified orchestrator envelope).
 *
 * Differences vs. BE-1's mapper:
 *   - Input shape: `MetadataPrimary` with `authors[{first, last}]`, integer
 *     `year`, plain `abstract` (no `abstractNote` rename), explicit empty
 *     strings (no key omission).
 *   - `itemType` is GONE — the new envelope doesn't carry it. Server-side
 *     fallback applies (`type` omitted → connector defaults to `article`).
 *   - `url` comes from the caller (the page URL the user is saving), not
 *     from the metadata response. Translation server doesn't echo it.
 *
 * AC7 forward-compat envelope: `tagIds` / `newTagNames` / `projectIds` /
 * `collectionIds` are always emitted as empty arrays. BE-2 adds UI to
 * populate them without any wire-shape change.
 */
export function mapMetadataToPayload(
  primary: MetadataPrimary,
  inputUrl: string,
): ConnectorReferencePayload {
  const payload: ConnectorReferencePayload = {
    title: primary.title,
    authors: primary.authors
      .filter((a) => a.first.length > 0 || a.last.length > 0)
      .map((a) => ({ firstName: a.first, lastName: a.last })),
    tagIds: [],
    newTagNames: [],
    projectIds: [],
    collectionIds: [],
  }
  if (primary.year > 0) payload.year = primary.year
  if (primary.doi.length > 0) payload.doi = primary.doi
  if (primary.abstract.length > 0) payload.abstract = primary.abstract
  if (inputUrl.length > 0) payload.url = inputUrl
  return payload
}
