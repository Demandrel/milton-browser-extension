// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Lazy CDN-fetch path for translators NOT in the curated bundle
// (BE-8-5 AC7/AC8). Runs in popup / service-worker / spike-page context
// (NEVER in the sandbox — sandbox is at opaque origin and can't fetch
// from translators.milton.so). The sandbox's fallback path (Task 7)
// delegates via the protocol-v2 translator-load-request message to a
// handler that calls fetchTranslatorFromCdn() here.
//
// Two-layer verification (matches BE-8-1 AC8):
//   1. Manifest Ed25519 signature against embedded production pubkey
//   2. Per-translator SHA-256 against the manifest entry
// Either failure → throw with typed-code error envelope.
//
// Cache strategy:
//   - Manifest: chrome.storage.local['translator-mirror-metadata'] with
//     1h TTL aligned with CDN Cache-Control (signed manifest cached for
//     fast subsequent fetches; signature re-verified on each load —
//     microseconds-fast and means cached-state-tamper still fails closed).
//   - Per-translator: chrome.storage.local['translator-fetched:{uuid}']
//     with 7-day TTL + 50-entry LRU cap. Invalidation is hash-driven
//     (manifest refresh → if cached sha256 differs from new manifest,
//     evict). Time-TTL is fallback only.
//
// Pin scope: lazy-fetched translators are verified against the CURRENT
// manifest's signature + sha256, NOT against the build-time pin
// (translator-bundle-pin.json). Rationale: bundled subset is pinned for
// reproducible builds (Charter v2 Decision 6); long-tail tracks the live
// mirror. Bundled-vs-lazy is mutually exclusive — translator-bundle.ts'
// verifiedSet is the union of bundled UUIDs; lazy-fetch only runs when
// getBundledTranslator returns null.

import type { BundledTranslator, TranslatorMetadata } from './zotero-types'
import {
  bytesToHex,
  hexToBytes,
  verifyManifestSignature,
} from './manifest-verify'
import { MANIFEST_SIGNING_PUBKEY } from './manifest-signing-pubkey'

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const MIRROR_BASE_URL = 'https://translators.milton.so/repo'
const MANIFEST_CACHE_KEY = 'translator-mirror-metadata'
const TRANSLATOR_CACHE_KEY_PREFIX = 'translator-fetched:'
const MANIFEST_TTL_MS = 60 * 60 * 1000 // 1 hour, aligns with CDN max-age=3600
const TRANSLATOR_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const TRANSLATOR_CACHE_MAX_ENTRIES = 50

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface ManifestEntry {
  translatorID: string
  label: string
  sha256: string
  size_bytes: number
  priority: number
  target?: string
  translatorType: number
  lastUpdated: string
  creator?: string
  minVersion?: string
  maxVersion?: string
}

export interface Manifest {
  schema_version: string
  mirror: string
  generated_at: string
  upstream_commit: string
  upstream_source: string
  license: string
  signature_url: string
  translators: ManifestEntry[]
}

interface CachedManifest {
  manifest: Manifest
  manifestBytesHex: string // hex of the raw manifest bytes (preserves signature verify integrity)
  signatureHex: string
  fetchedAt: number // Date.now() at cache write
}

interface CachedTranslator {
  metadata: TranslatorMetadata
  body: string
  sha256: string
  fetchedAt: number
}

export type FetcherErrorCode =
  | 'NETWORK_ERROR'
  | 'CDN_4XX'
  | 'CDN_5XX'
  | 'SIGNATURE_INVALID'
  | 'MANIFEST_MALFORMED'
  | 'NOT_IN_MANIFEST'
  | 'HASH_MISMATCH'
  | 'STORAGE_UNAVAILABLE'

export class TranslatorFetcherError extends Error {
  readonly code: FetcherErrorCode
  constructor(code: FetcherErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'TranslatorFetcherError'
    this.code = code
  }
}

// ────────────────────────────────────────────────────────────────────────
// chrome.storage.local wrappers — Promise-style API (MV3 ≥88)
// ────────────────────────────────────────────────────────────────────────

interface StorageGetResult {
  [key: string]: unknown
}

async function storageGet(keys: string | string[] | null): Promise<StorageGetResult> {
  if (typeof chrome === 'undefined' || chrome.storage === undefined) {
    throw new TranslatorFetcherError('STORAGE_UNAVAILABLE', 'chrome.storage.local is not available in this context')
  }
  return (await chrome.storage.local.get(keys)) as StorageGetResult
}

async function storageSet(items: Record<string, unknown>): Promise<void> {
  if (typeof chrome === 'undefined' || chrome.storage === undefined) {
    throw new TranslatorFetcherError('STORAGE_UNAVAILABLE', 'chrome.storage.local is not available in this context')
  }
  await chrome.storage.local.set(items)
}

async function storageRemove(keys: string | string[]): Promise<void> {
  if (typeof chrome === 'undefined' || chrome.storage === undefined) {
    throw new TranslatorFetcherError('STORAGE_UNAVAILABLE', 'chrome.storage.local is not available in this context')
  }
  await chrome.storage.local.remove(keys)
}

// ────────────────────────────────────────────────────────────────────────
// Network primitives
// ────────────────────────────────────────────────────────────────────────

async function fetchBytes(url: string): Promise<Uint8Array> {
  let resp: Response
  try {
    resp = await fetch(url)
  } catch (err) {
    throw new TranslatorFetcherError(
      'NETWORK_ERROR',
      `fetch(${url}) threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (resp.status >= 400 && resp.status < 500) {
    throw new TranslatorFetcherError('CDN_4XX', `${resp.status} ${resp.statusText} for ${url}`)
  }
  if (resp.status >= 500) {
    throw new TranslatorFetcherError('CDN_5XX', `${resp.status} ${resp.statusText} for ${url}`)
  }
  return new Uint8Array(await resp.arrayBuffer())
}

async function fetchText(url: string): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url))
}

// ────────────────────────────────────────────────────────────────────────
// SHA-256 (via crypto.subtle for browser/SW; Node ≥20's webcrypto is API-compat)
// ────────────────────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast to BufferSource — TS 5.9+ strict-types Uint8Array as
  // Uint8Array<ArrayBufferLike> which doesn't satisfy BufferSource (needs
  // ArrayBufferView<ArrayBuffer>). At runtime any Uint8Array works.
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

// ────────────────────────────────────────────────────────────────────────
// Manifest fetch + verify (with cache)
// ────────────────────────────────────────────────────────────────────────

async function fetchAndVerifyManifestFresh(): Promise<{
  manifest: Manifest
  manifestBytes: Uint8Array
  signature: Uint8Array
  signatureHex: string
}> {
  const manifestBytes = await fetchBytes(`${MIRROR_BASE_URL}/metadata`)
  const sigText = await fetchText(`${MIRROR_BASE_URL}/metadata.sig`)
  const signature = hexToBytes(sigText)
  if (signature === null) {
    throw new TranslatorFetcherError(
      'MANIFEST_MALFORMED',
      'signature file is not valid hex-encoded Ed25519 (expected 128 hex chars)',
    )
  }
  const verified = await verifyManifestSignature(manifestBytes, signature, MANIFEST_SIGNING_PUBKEY)
  if (!verified) {
    throw new TranslatorFetcherError(
      'SIGNATURE_INVALID',
      'manifest signature verification failed — possible signing key rotation or tampered CDN',
    )
  }
  let manifest: Manifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest
  } catch (err) {
    throw new TranslatorFetcherError(
      'MANIFEST_MALFORMED',
      `manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return { manifest, manifestBytes, signature, signatureHex: sigText.trim() }
}

export async function fetchManifest(force = false): Promise<Manifest> {
  // Try cached first (unless caller forces refresh).
  if (!force) {
    const cached = await loadCachedManifest()
    if (cached !== null && Date.now() - cached.fetchedAt < MANIFEST_TTL_MS) {
      // Re-verify cached signature on every load — microseconds-fast +
      // catches cache-state-tamper (e.g., extension storage corruption).
      const manifestBytes = hexToBytes(cached.manifestBytesHex)
      const signature = hexToBytes(cached.signatureHex)
      if (manifestBytes !== null && signature !== null) {
        const ok = await verifyManifestSignature(
          manifestBytes,
          signature,
          MANIFEST_SIGNING_PUBKEY,
        )
        if (ok) {
          return cached.manifest
        }
        // Cache corruption — fall through to fresh fetch.
        console.warn('[translator-fetcher] cached manifest signature failed re-verify; refetching')
      }
    }
  }
  // Fresh fetch + cache + invalidate stale translator entries.
  const fresh = await fetchAndVerifyManifestFresh()
  await saveCachedManifest({
    manifest: fresh.manifest,
    manifestBytesHex: bytesToHex(fresh.manifestBytes),
    signatureHex: fresh.signatureHex,
    fetchedAt: Date.now(),
  })
  await evictStaleTranslatorCache(fresh.manifest)
  return fresh.manifest
}

async function loadCachedManifest(): Promise<CachedManifest | null> {
  try {
    const result = await storageGet(MANIFEST_CACHE_KEY)
    const cached = result[MANIFEST_CACHE_KEY]
    if (cached === undefined || cached === null) return null
    return cached as CachedManifest
  } catch {
    return null
  }
}

async function saveCachedManifest(cached: CachedManifest): Promise<void> {
  await storageSet({ [MANIFEST_CACHE_KEY]: cached })
}

// ────────────────────────────────────────────────────────────────────────
// Per-translator fetch + verify (with cache)
// ────────────────────────────────────────────────────────────────────────

export async function fetchTranslatorFromCdn(translatorID: string): Promise<BundledTranslator | null> {
  // Try cache first.
  const cached = await loadCachedTranslator(translatorID)
  if (cached !== null && Date.now() - cached.fetchedAt < TRANSLATOR_TTL_MS) {
    return { metadata: cached.metadata, body: cached.body }
  }

  // Resolve manifest (cached or fresh).
  const manifest = await fetchManifest()
  const entry = manifest.translators.find((t) => t.translatorID === translatorID)
  if (entry === undefined) {
    // Per AC7: return null if UUID not in manifest (caller falls back to
    // "no translator found"). NOT an error — long-tail discovery just hit
    // a UUID that never made it upstream.
    return null
  }

  // Fetch + verify bytes.
  const source = await fetchBytes(`${MIRROR_BASE_URL}/code/${translatorID}`)
  const actualHex = await sha256Hex(source)
  if (actualHex !== entry.sha256) {
    throw new TranslatorFetcherError(
      'HASH_MISMATCH',
      `sha256 mismatch for ${translatorID}: manifest=${entry.sha256}, actual=${actualHex}`,
    )
  }
  const body = new TextDecoder().decode(source)
  const metadata: TranslatorMetadata = {
    translatorID: entry.translatorID,
    label: entry.label,
    creator: entry.creator,
    target: entry.target,
    minVersion: entry.minVersion,
    maxVersion: entry.maxVersion,
    priority: entry.priority,
    translatorType: entry.translatorType,
    lastUpdated: entry.lastUpdated,
  }

  await saveCachedTranslator(translatorID, {
    metadata,
    body,
    sha256: actualHex,
    fetchedAt: Date.now(),
  })
  return { metadata, body }
}

async function loadCachedTranslator(translatorID: string): Promise<CachedTranslator | null> {
  try {
    const key = `${TRANSLATOR_CACHE_KEY_PREFIX}${translatorID}`
    const result = await storageGet(key)
    const cached = result[key]
    if (cached === undefined || cached === null) return null
    return cached as CachedTranslator
  } catch {
    return null
  }
}

async function saveCachedTranslator(translatorID: string, cached: CachedTranslator): Promise<void> {
  const key = `${TRANSLATOR_CACHE_KEY_PREFIX}${translatorID}`
  await enforceTranslatorCacheCap()
  try {
    await storageSet({ [key]: cached })
  } catch (err) {
    // QUOTA_BYTES error surfaces here as a rejected promise. Evict the
    // oldest entry + retry once. If still failing, surface to caller.
    const evicted = await evictOldestTranslatorEntry()
    if (evicted) {
      try {
        await storageSet({ [key]: cached })
        return
      } catch (retryErr) {
        throw new TranslatorFetcherError(
          'STORAGE_UNAVAILABLE',
          `quota exceeded even after LRU eviction: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        )
      }
    }
    throw new TranslatorFetcherError(
      'STORAGE_UNAVAILABLE',
      `storage.local.set failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Walk all chrome.storage.local entries; if more than TRANSLATOR_CACHE_MAX_ENTRIES
 * lazy-fetched translators are cached, LRU-evict oldest until under the cap.
 * Called before each cache write to keep the on-the-51st-add eviction path
 * predictable.
 */
async function enforceTranslatorCacheCap(): Promise<void> {
  const all = await listCachedTranslators()
  if (all.length < TRANSLATOR_CACHE_MAX_ENTRIES) return
  // Sort by fetchedAt ascending; evict the oldest entries above the cap.
  all.sort((a, b) => a.fetchedAt - b.fetchedAt)
  const toEvict = all.slice(0, all.length - TRANSLATOR_CACHE_MAX_ENTRIES + 1)
  if (toEvict.length === 0) return
  await storageRemove(toEvict.map((e) => e.key))
}

async function evictOldestTranslatorEntry(): Promise<boolean> {
  const all = await listCachedTranslators()
  if (all.length === 0) return false
  all.sort((a, b) => a.fetchedAt - b.fetchedAt)
  await storageRemove(all[0].key)
  return true
}

interface CacheEntryRef {
  key: string
  fetchedAt: number
  sha256: string
}

async function listCachedTranslators(): Promise<CacheEntryRef[]> {
  const all = await storageGet(null)
  const refs: CacheEntryRef[] = []
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(TRANSLATOR_CACHE_KEY_PREFIX)) continue
    if (typeof value !== 'object' || value === null) continue
    const v = value as Partial<CachedTranslator>
    if (typeof v.fetchedAt !== 'number' || typeof v.sha256 !== 'string') continue
    refs.push({ key, fetchedAt: v.fetchedAt, sha256: v.sha256 })
  }
  return refs
}

/**
 * Hash-driven invalidation. When manifest refreshes, walk all cached
 * translator entries; if a cached UUID still exists in the new manifest
 * but its sha256 differs, the cached entry is evicted. Time-TTL is a
 * fallback only.
 */
async function evictStaleTranslatorCache(manifest: Manifest): Promise<void> {
  const byID = new Map<string, string>()
  for (const t of manifest.translators) byID.set(t.translatorID, t.sha256)
  const cached = await listCachedTranslators()
  const stale: string[] = []
  for (const entry of cached) {
    const uuid = entry.key.slice(TRANSLATOR_CACHE_KEY_PREFIX.length)
    const newHash = byID.get(uuid)
    if (newHash !== undefined && newHash !== entry.sha256) {
      stale.push(entry.key)
    }
  }
  if (stale.length > 0) {
    await storageRemove(stale)
    console.log(`[translator-fetcher] evicted ${stale.length} stale translator cache entr${stale.length === 1 ? 'y' : 'ies'} after manifest refresh`)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test seams — exported only for unit-test instrumentation
// ────────────────────────────────────────────────────────────────────────

export const _internal = {
  MANIFEST_CACHE_KEY,
  TRANSLATOR_CACHE_KEY_PREFIX,
  MANIFEST_TTL_MS,
  TRANSLATOR_TTL_MS,
  TRANSLATOR_CACHE_MAX_ENTRIES,
  evictStaleTranslatorCache,
  listCachedTranslators,
}
