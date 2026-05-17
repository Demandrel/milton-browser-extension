// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-6: URL → translator UUID discovery. The popup uses this to decide
// which translator (if any) to run against the active tab URL BEFORE
// firing the client-side translation flow.
//
// Two-tier lookup:
//   1. Bundled REGISTRY (synchronous, fast): walk every bundled
//      translator's metadata.target regex; match against URL.
//   2. Manifest (async, fetched/cached via translator-fetcher.ts): same
//      regex-match across all 743 mirror translators. Only consulted when
//      bundled returns empty — bundle wins when it covers the URL, both
//      for speed and to honor Charter v2 Decision 6 (bundled subset
//      pinned at build for reproducibility; long-tail tracks live mirror).
//
// Returns UUIDs sorted by `priority` ascending (lower = higher priority,
// per Zotero convention). Empty array means "no translator covers this
// URL" — caller falls back to the existing server-side translate.milton.so
// flow.
//
// Web-translator filter is BITMASK-based, not strict equality. Zotero
// `translatorType` is a bitmask: 1=Import, 2=Export, 4=Web, 8=Search.
// A translator may carry combined flags (e.g., 4+8=12 for Web+Search);
// strict `=== 4` would skip those, so we use `(t & 4) !== 0` to keep
// any translator that participates in the Web class.
//
// Fault tolerance: a single bad regex in the manifest (e.g., a translator
// with `target: '['` that fails to compile) MUST NOT kill discovery for
// the rest of the manifest. We catch + console.warn + skip.

import { fetchManifest, type Manifest, type ManifestEntry } from './translator-fetcher'
import { listBundledTranslators } from './translator-bundle'
import type { BundledTranslator } from './zotero-types'

const ZOTERO_TRANSLATOR_TYPE_WEB = 4 // bit 4 set = Web translator

interface Candidate {
  translatorID: string
  priority: number
}

function isWebTranslator(translatorType: number | undefined): boolean {
  if (typeof translatorType !== 'number') return false
  return (translatorType & ZOTERO_TRANSLATOR_TYPE_WEB) !== 0
}

function safeRegExpTest(pattern: string, url: string, source: string): boolean {
  try {
    return new RegExp(pattern).test(url)
  } catch (err) {
    console.warn(
      `[milton-router] ${source}: bad target regex skipped`,
      { pattern, error: err instanceof Error ? err.message : String(err) },
    )
    return false
  }
}

function bundledCandidates(url: string, bundle: BundledTranslator[]): Candidate[] {
  const out: Candidate[] = []
  for (const t of bundle) {
    if (!isWebTranslator(t.metadata.translatorType)) continue
    const target = t.metadata.target
    if (typeof target !== 'string' || target.length === 0) continue
    if (!safeRegExpTest(target, url, `bundle:${t.metadata.label}`)) continue
    out.push({
      translatorID: t.metadata.translatorID,
      priority: t.metadata.priority ?? 100,
    })
  }
  return out
}

function manifestCandidates(url: string, manifest: Manifest, excludeIds: Set<string>): Candidate[] {
  const out: Candidate[] = []
  for (const e of manifest.translators) {
    if (excludeIds.has(e.translatorID)) continue
    if (!isWebTranslator(e.translatorType)) continue
    const target = e.target
    if (typeof target !== 'string' || target.length === 0) continue
    if (!safeRegExpTest(target, url, `manifest:${e.label}`)) continue
    out.push({
      translatorID: e.translatorID,
      priority: e.priority ?? 100,
    })
  }
  return out
}

function sortByPriority(candidates: Candidate[]): string[] {
  return [...candidates]
    .sort((a, b) => a.priority - b.priority)
    .map((c) => c.translatorID)
}

/**
 * Return candidate translator UUIDs whose `metadata.target` regex matches `url`,
 * sorted by `priority` ascending. Bundled translators are checked first; if
 * any bundled hit exists, manifest entries with the same UUIDs are de-duplicated
 * out of the result. If bundled returns empty, the full manifest is consulted.
 *
 * Returns `[]` when no translator covers the URL.
 *
 * Never throws on a single bad regex — those are logged + skipped.
 */
export async function findCandidateTranslatorIds(url: string): Promise<string[]> {
  const bundle = listBundledTranslators()
  const bundled = bundledCandidates(url, bundle)
  if (bundled.length > 0) {
    // Bundle wins. Avoid even fetching the manifest if we already have a
    // covering translator — saves a network round-trip on the common path.
    return sortByPriority(bundled)
  }

  let manifest: Manifest
  try {
    manifest = await fetchManifest()
  } catch (err) {
    // Mirror unreachable / signature failure / etc. Bundle had no match
    // either, so caller should fall back to the server flow. Don't crash
    // the popup boot on a manifest fetch failure.
    console.warn(
      '[milton-router] manifest fetch failed; no client-translator candidates',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
  const bundledIds = new Set(bundle.map((t) => t.metadata.translatorID))
  const fromManifest = manifestCandidates(url, manifest, bundledIds)
  return sortByPriority(fromManifest)
}

/**
 * Test-only — exposed for unit tests that want to exercise the priority
 * sort + bitmask filter in isolation.
 */
export const _internal = {
  isWebTranslator,
  bundledCandidates,
  manifestCandidates,
  sortByPriority,
} as const

export type { ManifestEntry }
