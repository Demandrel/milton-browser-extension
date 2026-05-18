// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-9: periodic auto-refresh coordinator for bundled translators.
//
// Why a separate module instead of extending translator-fetcher.ts:
// fetcher is the LOW-LEVEL fetch + verify + cache primitive (BE-8-5).
// This module is the COORDINATOR that decides which bundled UUIDs need
// a refresh + writes the observability state. Keeping them split lets
// each be unit-tested independently and respects single-responsibility.
//
// Trust chain (matches BE-8-5 AC7):
//   1. Manifest Ed25519 signature verified inside fetchManifest(force=true).
//      A SIGNATURE_INVALID throw aborts the refresh — we do NOT touch
//      cached entries because either upstream rotated keys (BE-8-1
//      contingency) or someone is tampering with the CDN; in both cases
//      the build-time-pinned bundle must remain authoritative.
//   2. Per-translator SHA-256 verified inside fetchTranslatorFromCdn
//      against the freshly-verified manifest entry.
//
// Failure modes are deliberately non-fatal at the per-translator level —
// one bad CDN response shouldn't halt the rest of the refresh cycle.
// The refresh-state record carries per-UUID errors so a developer can
// see them via `chrome.storage.local.get('translator-refresh-state')`.

import pin from '../../translator-bundle-pin.json' with { type: 'json' }
import {
  fetchManifest,
  fetchTranslatorFromCdn,
  TranslatorFetcherError,
} from './translator-fetcher'
import { listBundledTranslators } from './translator-bundle'

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

export const REFRESH_ALARM_NAME = 'milton-translator-refresh'
export const REFRESH_PERIOD_MINUTES = 360 // 6h — well clear of Chrome's 30s minimum
export const REFRESH_PERIOD_MS = REFRESH_PERIOD_MINUTES * 60 * 1000
export const REFRESH_STATE_KEY = 'translator-refresh-state'
const LOG_PREFIX = '[milton-refresh]'

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type RefreshOutcome =
  | 'success'
  | 'manifest-fetch-failed'
  | 'signature-invalid'
  | 'partial'

export interface RefreshResult {
  lastRefreshAt: number
  lastRefreshResult: RefreshOutcome
  updatedCount: number
  perUuidErrors?: Record<string, string>
  durationMs: number
}

// ────────────────────────────────────────────────────────────────────────
// chrome.storage.local shim — graceful no-op when storage unavailable
// (the SW always has storage; helper keeps tests + future contexts safe).
// ────────────────────────────────────────────────────────────────────────

function isStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && chrome.storage !== undefined
}

async function writeRefreshState(state: RefreshResult): Promise<void> {
  if (!isStorageAvailable()) return
  await chrome.storage.local.set({ [REFRESH_STATE_KEY]: state })
}

export async function readRefreshState(): Promise<RefreshResult | null> {
  if (!isStorageAvailable()) return null
  const result = (await chrome.storage.local.get(REFRESH_STATE_KEY)) as Record<string, unknown>
  const raw = result[REFRESH_STATE_KEY]
  if (raw === undefined || raw === null) return null
  return raw as RefreshResult
}

// ────────────────────────────────────────────────────────────────────────
// Refresh entry point
// ────────────────────────────────────────────────────────────────────────

/**
 * Refresh the bundled-translator subset against the live mirror manifest.
 *
 * Flow:
 *   1. fetchManifest(force=true) — Ed25519-verified fresh fetch.
 *      - SIGNATURE_INVALID → return early with 'signature-invalid'. Do NOT
 *        touch any cached entries. The pre-verify ordering inside
 *        fetchManifest (translator-fetcher.ts:244-249) means a bad signature
 *        never overwrites the in-process manifest cache.
 *      - Other failures → return early with 'manifest-fetch-failed'.
 *   2. For each bundled UUID:
 *      - Look up the entry in the fresh manifest.
 *      - If missing → warn + skip (graceful: bundled stays authoritative).
 *      - If sha256 matches the build-time pin → no-op.
 *      - If sha256 differs → call fetchTranslatorFromCdn which writes
 *        the verified-fresher bytes to `translator-fetched:{uuid}`.
 *        Per-translator failures are non-fatal; recorded in perUuidErrors.
 *   3. Persist the result atomically to `translator-refresh-state`.
 */
export async function refreshBundledTranslators(): Promise<RefreshResult> {
  const startedAt = Date.now()

  // Step 1 — manifest fetch + verify.
  let manifest
  try {
    manifest = await fetchManifest(true)
  } catch (err) {
    if (err instanceof TranslatorFetcherError && err.code === 'SIGNATURE_INVALID') {
      console.error(
        `${LOG_PREFIX} signature-invalid — aborting refresh; bundled translators remain authoritative.`,
        err,
      )
      const result: RefreshResult = {
        lastRefreshAt: startedAt,
        lastRefreshResult: 'signature-invalid',
        updatedCount: 0,
        durationMs: Date.now() - startedAt,
      }
      await writeRefreshState(result)
      return result
    }
    console.warn(`${LOG_PREFIX} manifest-fetch-failed — bundled translators remain authoritative.`, err)
    const result: RefreshResult = {
      lastRefreshAt: startedAt,
      lastRefreshResult: 'manifest-fetch-failed',
      updatedCount: 0,
      durationMs: Date.now() - startedAt,
    }
    await writeRefreshState(result)
    return result
  }

  // Index manifest by translatorID for O(1) lookup.
  const manifestByUuid = new Map<string, { sha256: string; label: string }>()
  for (const entry of manifest.translators) {
    manifestByUuid.set(entry.translatorID, { sha256: entry.sha256, label: entry.label })
  }

  // Step 2 — per-translator SHA compare + lazy-fetch on diff.
  const bundlePins = pin.bundleHashes as Record<string, string>
  const perUuidErrors: Record<string, string> = {}
  let updatedCount = 0
  const bundled = listBundledTranslators()
  for (const bundledEntry of bundled) {
    const uuid = bundledEntry.metadata.translatorID
    const manifestEntry = manifestByUuid.get(uuid)
    if (manifestEntry === undefined) {
      console.warn(
        `${LOG_PREFIX} bundled translator ${uuid} (${bundledEntry.metadata.label}) absent from upstream manifest; keeping bundled version.`,
      )
      continue
    }
    const bundlePinSha = bundlePins[uuid]
    if (bundlePinSha === undefined) {
      // Bundle ships without a pin entry — already flagged at bootstrap
      // by verifyAllBundleIntegrity. Skip silently here; nothing to compare.
      continue
    }
    if (manifestEntry.sha256 === bundlePinSha) {
      // Bundled bytes still current; nothing to do.
      continue
    }
    // Diff detected → fetch fresh bytes (lazy-fetch path writes to cache).
    try {
      const fresh = await fetchTranslatorFromCdn(uuid)
      if (fresh === null) {
        // Race: manifest changed mid-iteration so UUID disappeared.
        // Non-fatal — log + continue.
        console.warn(`${LOG_PREFIX} fetchTranslatorFromCdn(${uuid}) returned null (manifest race?); skipping.`)
        continue
      }
      updatedCount++
      console.log(
        `${LOG_PREFIX} refreshed ${uuid} (${bundledEntry.metadata.label}): pin=${bundlePinSha.slice(0, 12)}… manifest=${manifestEntry.sha256.slice(0, 12)}…`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      perUuidErrors[uuid] = message
      console.warn(`${LOG_PREFIX} per-translator refresh failed for ${uuid}:`, message)
    }
  }

  // Step 3 — persist the outcome.
  const hasErrors = Object.keys(perUuidErrors).length > 0
  const result: RefreshResult = {
    lastRefreshAt: startedAt,
    lastRefreshResult: hasErrors ? 'partial' : 'success',
    updatedCount,
    durationMs: Date.now() - startedAt,
    ...(hasErrors ? { perUuidErrors } : {}),
  }
  await writeRefreshState(result)
  return result
}
