// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-9: popup-side helper that decides whether to inline a cached-fresher
// translator body in `milton-translate-request`.
//
// Why this lives here, not in popup.ts:
//   - The decision wants both fetchManifest() (manifest in hand) and
//     getResolvedTranslator() (cache vs bundled comparison). Wrapping the
//     two-step ceremony in one helper keeps popup.ts readable.
//   - Best-effort by design: any failure (manifest fetch error, storage
//     read error, no cached entry) returns `undefined` so the popup falls
//     back to the existing bundled-only path. The cached-fresher win is a
//     freshness optimization — never required for correctness.
//
// Called from the popup's tryClientTranslator flow + the DEV-mode
// miltonPopupSpike. Both surfaces want the same semantics; centralizing
// avoids drift.

import type { BundledTranslator } from './zotero-types'
import { getBundledTranslator, getResolvedTranslator } from './translator-bundle'
import { fetchManifest } from './translator-fetcher'

/**
 * If the SW's auto-refresh has cached a fresher version of the bundled
 * translator at `uuid`, return the cached body so the popup can inline it
 * in the translate-request envelope. Otherwise return `undefined` (popup
 * proceeds with the bundled version via the sandbox's own lookup).
 *
 * Best-effort: never throws. Failures degrade silently to `undefined`.
 */
export async function maybeInlineFresherTranslator(
  uuid: string,
): Promise<BundledTranslator | undefined> {
  try {
    const manifest = await fetchManifest()
    const resolved = await getResolvedTranslator(uuid, manifest)
    if (resolved === null) return undefined
    const bundled = getBundledTranslator(uuid)
    // If the resolver picked a body different from the bundle, that's the
    // cached-fresher win — inline it. If the resolver picked the same body
    // (manifest === pin OR no cached entry OR cached SHA stale), no need
    // to inline; the sandbox's own bundled lookup gives the same answer.
    if (bundled !== null && resolved.body === bundled.body) return undefined
    return resolved
  } catch (err) {
    console.warn('[milton-popup] cached-fresher resolve failed; falling back to bundled', err)
    return undefined
  }
}
