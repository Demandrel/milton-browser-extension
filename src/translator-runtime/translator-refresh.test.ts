// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./translator-bundle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./translator-bundle')>()
  return { ...actual, listBundledTranslators: vi.fn() }
})

vi.mock('./translator-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./translator-fetcher')>()
  return {
    ...actual,
    fetchManifest: vi.fn(),
    fetchTranslatorFromCdn: vi.fn(),
  }
})

import pinJson from '../../translator-bundle-pin.json' with { type: 'json' }
import { listBundledTranslators } from './translator-bundle'
import {
  fetchManifest,
  fetchTranslatorFromCdn,
  TranslatorFetcherError,
} from './translator-fetcher'
import type { Manifest, ManifestEntry } from './translator-fetcher'
import type { BundledTranslator } from './zotero-types'
import {
  REFRESH_STATE_KEY,
  refreshBundledTranslators,
} from './translator-refresh'

// ────────────────────────────────────────────────────────────────────────
// Fixtures: use real pinned UUIDs so pin.bundleHashes lookups succeed.
// ────────────────────────────────────────────────────────────────────────

const PINNED_UUIDS = Object.keys(pinJson.bundleHashes) as string[]
// Three UUIDs with distinct pin SHAs — picked from the front of the pin
// for stability; any three with non-equal pins would do.
const UUID_NOOP = PINNED_UUIDS[0]
const UUID_DIFF = PINNED_UUIDS[1]
const UUID_ABSENT = PINNED_UUIDS[2]
const PIN_BY_UUID = pinJson.bundleHashes as Record<string, string>

function fakeBundled(uuid: string): BundledTranslator {
  return { metadata: { translatorID: uuid, label: `Label-${uuid.slice(0, 8)}` }, body: '/* fake */' }
}

function fakeManifestEntry(uuid: string, sha256: string): ManifestEntry {
  return {
    translatorID: uuid,
    label: `Label-${uuid.slice(0, 8)}`,
    sha256,
    size_bytes: 100,
    priority: 100,
    translatorType: 4,
    lastUpdated: '2024-01-01',
  }
}

function fakeManifest(entries: ManifestEntry[]): Manifest {
  return {
    schema_version: '1',
    mirror: 'test',
    generated_at: '2024-01-01',
    upstream_commit: 'test-commit',
    upstream_source: 'test',
    license: 'AGPL-3.0-or-later',
    signature_url: 'test.sig',
    translators: entries,
  }
}

// ────────────────────────────────────────────────────────────────────────
// chrome.storage.local mock — mirrors translator-fetcher.test.ts pattern
// ────────────────────────────────────────────────────────────────────────

interface MockStorage {
  data: Map<string, unknown>
}

function installChromeStorageMock(): MockStorage {
  const data = new Map<string, unknown>()
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) return Object.fromEntries(data.entries())
          const arr = Array.isArray(keys) ? keys : [keys]
          const out: Record<string, unknown> = {}
          for (const k of arr) if (data.has(k)) out[k] = data.get(k)
          return out
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) data.set(k, v)
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys]
          for (const k of arr) data.delete(k)
        }),
      },
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock
  return { data }
}

function uninstallChromeStorageMock(): void {
  delete (globalThis as { chrome?: unknown }).chrome
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('refreshBundledTranslators — happy path (AC4)', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
    vi.mocked(listBundledTranslators).mockReturnValue([
      fakeBundled(UUID_NOOP),
      fakeBundled(UUID_DIFF),
      fakeBundled(UUID_ABSENT),
    ])
    // Manifest:
    //   UUID_NOOP   → sha = pin (no-op)
    //   UUID_DIFF   → sha = "DIFFERENT" (triggers per-translator fetch)
    //   UUID_ABSENT → absent
    vi.mocked(fetchManifest).mockResolvedValue(
      fakeManifest([
        fakeManifestEntry(UUID_NOOP, PIN_BY_UUID[UUID_NOOP]),
        fakeManifestEntry(UUID_DIFF, 'DIFFERENT_SHA_FROM_PIN_FOR_DIFF_UUID'),
      ]),
    )
    vi.mocked(fetchTranslatorFromCdn).mockResolvedValue(
      fakeBundled(UUID_DIFF),
    )
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('refreshes the differing UUID exactly once; no-op + absent UUIDs are not fetched', async () => {
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('success')
    expect(result.updatedCount).toBe(1)
    expect(result.perUuidErrors).toBeUndefined()
    expect(vi.mocked(fetchTranslatorFromCdn)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchTranslatorFromCdn)).toHaveBeenCalledWith(UUID_DIFF)
  })

  it('persists the refresh state to chrome.storage.local', async () => {
    await refreshBundledTranslators()
    const stored = storage.data.get(REFRESH_STATE_KEY) as { updatedCount: number; lastRefreshResult: string }
    expect(stored).toBeDefined()
    expect(stored.updatedCount).toBe(1)
    expect(stored.lastRefreshResult).toBe('success')
  })

  it('reports `lastRefreshAt` as a timestamp (positive number)', async () => {
    const beforeMs = Date.now() - 1
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshAt).toBeGreaterThanOrEqual(beforeMs)
  })
})

describe('refreshBundledTranslators — manifest-fetch failure (AC7)', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
    vi.mocked(listBundledTranslators).mockReturnValue([fakeBundled(UUID_DIFF)])
    vi.mocked(fetchManifest).mockRejectedValue(
      new TranslatorFetcherError('NETWORK_ERROR', 'offline'),
    )
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('records manifest-fetch-failed and does NOT call fetchTranslatorFromCdn', async () => {
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('manifest-fetch-failed')
    expect(result.updatedCount).toBe(0)
    expect(vi.mocked(fetchTranslatorFromCdn)).not.toHaveBeenCalled()
    const stored = storage.data.get(REFRESH_STATE_KEY) as { lastRefreshResult: string }
    expect(stored.lastRefreshResult).toBe('manifest-fetch-failed')
  })

  it('records manifest-fetch-failed on CDN_5XX too', async () => {
    vi.mocked(fetchManifest).mockRejectedValue(
      new TranslatorFetcherError('CDN_5XX', '503'),
    )
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('manifest-fetch-failed')
  })
})

describe('refreshBundledTranslators — signature-invalid is the trap (AC7 CRITICAL)', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
    vi.mocked(listBundledTranslators).mockReturnValue([fakeBundled(UUID_DIFF)])
    vi.mocked(fetchManifest).mockRejectedValue(
      new TranslatorFetcherError('SIGNATURE_INVALID', 'tampered'),
    )
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('records signature-invalid and aborts: NO per-translator fetches', async () => {
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('signature-invalid')
    expect(result.updatedCount).toBe(0)
    expect(vi.mocked(fetchTranslatorFromCdn)).not.toHaveBeenCalled()
  })

  it('on signature-invalid, leaves any previously-cached translator entries UNTOUCHED', async () => {
    // Pre-seed a cached translator entry. Refresh failing on signature
    // must NOT evict / overwrite it — the cached entry remains usable
    // by future runtime resolves (which re-verify against the next valid
    // manifest).
    storage.data.set('translator-fetched:cache-survivor', { metadata: {}, body: 'x', sha256: 'y', fetchedAt: 1 })
    await refreshBundledTranslators()
    expect(storage.data.has('translator-fetched:cache-survivor')).toBe(true)
  })
})

describe('refreshBundledTranslators — partial (per-translator failure, AC7)', () => {
  beforeEach(() => {
    installChromeStorageMock()
    vi.mocked(listBundledTranslators).mockReturnValue([
      fakeBundled(UUID_DIFF),
      fakeBundled(UUID_NOOP),
    ])
    vi.mocked(fetchManifest).mockResolvedValue(
      fakeManifest([
        fakeManifestEntry(UUID_DIFF, 'DIFFERENT_SHA_FROM_PIN'),
        fakeManifestEntry(UUID_NOOP, PIN_BY_UUID[UUID_NOOP]),
      ]),
    )
    vi.mocked(fetchTranslatorFromCdn).mockRejectedValue(
      new TranslatorFetcherError('CDN_4XX', '404'),
    )
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('records partial + populates perUuidErrors for the failing UUID; other UUIDs unaffected', async () => {
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('partial')
    expect(result.updatedCount).toBe(0) // the only diff UUID failed
    expect(result.perUuidErrors).toBeDefined()
    expect(result.perUuidErrors![UUID_DIFF]).toContain('CDN_4XX')
  })
})

describe('refreshBundledTranslators — translator absent from manifest (AC4 graceful degradation)', () => {
  beforeEach(() => {
    installChromeStorageMock()
    vi.mocked(listBundledTranslators).mockReturnValue([fakeBundled(UUID_ABSENT)])
    vi.mocked(fetchManifest).mockResolvedValue(fakeManifest([]))
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('does not fetch + reports success with updatedCount=0 when bundled UUID is absent upstream', async () => {
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('success')
    expect(result.updatedCount).toBe(0)
    expect(vi.mocked(fetchTranslatorFromCdn)).not.toHaveBeenCalled()
  })
})
