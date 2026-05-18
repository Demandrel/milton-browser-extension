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
import { getResolvedTranslator } from './translator-bundle'
import { fetchManifest } from './translator-fetcher'

const TRANSLATOR_CACHE_KEY_PREFIX = 'translator-fetched:'

/**
 * If the SW's auto-refresh has cached a fresher version of the bundled
 * translator at `uuid`, return the cached body so the popup can inline it
 * in the translate-request envelope. Otherwise return `undefined` (popup
 * proceeds with the bundled version via the sandbox's own lookup).
 *
 * Best-effort: never throws. Failures degrade silently to `undefined`.
 *
 * Hot-path optimization (code-review H1 fix 2026-05-18): probe
 * `chrome.storage.local` for the per-UUID cache key BEFORE calling
 * `fetchManifest()`. The manifest fetch has a 1h TTL but the SW refresh
 * runs every 6h, so without this short-circuit 5 of every 6 hours' first
 * captures would pay a network round-trip to translators.milton.so just
 * to discover that no cached-fresher entry exists. The cache-key probe is
 * sub-millisecond; the manifest fetch (cache-miss case) is ~50-200ms over
 * the wire. Cached-fresher entries only exist after a divergence has been
 * detected + fetched — empirically rare for the bundled subset.
 */
export async function maybeInlineFresherTranslator(
  uuid: string,
): Promise<BundledTranslator | undefined> {
  try {
    if (typeof chrome === 'undefined' || chrome.storage === undefined) return undefined
    const cacheKey = `${TRANSLATOR_CACHE_KEY_PREFIX}${uuid}`
    const cacheLookup = (await chrome.storage.local.get(cacheKey)) as Record<string, unknown>
    if (cacheLookup[cacheKey] === undefined) return undefined

    const manifest = await fetchManifest()
    const resolved = await getResolvedTranslator(uuid, manifest)
    // `resolved === null` covers all the no-inline cases:
    //   - getResolvedTranslator found no cached-fresher match against the
    //     manifest and fell through to getBundledTranslator(uuid), which
    //     returns null in popup context (verifiedSet is only installed in
    //     the sandbox by bootstrapIntegrity).
    //   - The cached entry exists but its SHA no longer matches the current
    //     manifest (stale-cache case).
    // Non-null resolution in popup context is therefore unambiguously the
    // cached-fresher win — inline it.
    if (resolved === null) return undefined
    return resolved
  } catch (err) {
    console.warn('[milton-popup] cached-fresher resolve failed; falling back to bundled', err)
    return undefined
  }
}
