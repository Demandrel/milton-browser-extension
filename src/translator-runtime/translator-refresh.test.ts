// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./translator-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./translator-fetcher')>()
  return {
    ...actual,
    fetchManifest: vi.fn(),
    fetchTranslatorFromCdn: vi.fn(),
  }
})

import pinJson from '../../translator-bundle-pin.json' with { type: 'json' }
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
// After the M4 fix, the refresh module iterates over Object.entries(pin.bundleHashes)
// directly (no longer calls listBundledTranslators). The tests pick specific
// UUIDs to mock manifest entries against; UUIDs NOT in the manifest mock get
// "absent from upstream manifest" warn + skip (which is the correct behavior
// and doesn't affect assertions).
// ────────────────────────────────────────────────────────────────────────

const PINNED_UUIDS = Object.keys(pinJson.bundleHashes) as string[]
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
  setMock: ReturnType<typeof vi.fn>
}

function installChromeStorageMock(opts: { setRejects?: Error } = {}): MockStorage {
  const data = new Map<string, unknown>()
  const setMock = opts.setRejects
    ? vi.fn(async () => {
        throw opts.setRejects
      })
    : vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) data.set(k, v)
      })
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
        set: setMock,
        remove: vi.fn(async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys]
          for (const k of arr) data.delete(k)
        }),
      },
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock
  return { data, setMock }
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
    // Manifest:
    //   UUID_NOOP   → sha = pin (no-op)
    //   UUID_DIFF   → sha = "DIFFERENT" (triggers per-translator fetch)
    //   UUID_ABSENT → absent (along with all the other ~31 pinned UUIDs;
    //                 they all warn + skip — verified separately via
    //                 fetchTranslatorFromCdn call count)
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
    storage.data.set('translator-fetched:cache-survivor', { metadata: {}, body: 'x', sha256: 'y', fetchedAt: 1 })
    await refreshBundledTranslators()
    expect(storage.data.has('translator-fetched:cache-survivor')).toBe(true)
  })
})

describe('refreshBundledTranslators — partial (per-translator failure, AC7)', () => {
  beforeEach(() => {
    installChromeStorageMock()
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
    // Cite UUID_ABSENT to keep the import used (signals intent — this fixture
    // represents "any pinned UUID for which the manifest has no entry").
    expect(UUID_ABSENT).toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────────────────
// Code-review H2 fix (2026-05-18): storage-write failures during state
// persistence must NOT propagate out of refreshBundledTranslators. AC7
// makes failure modes non-fatal; a chrome.storage.local.set throw (quota
// exceeded, extension shutdown, policy-disabled storage) would otherwise
// land in sw-handlers.refreshSafely's catch as an unexpected exception
// and risk marking the SW errored — breaking subsequent alarm dispatch.
// ────────────────────────────────────────────────────────────────────────

describe('refreshBundledTranslators — storage-write failure tolerance (H2 fix)', () => {
  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('does NOT throw when chrome.storage.local.set rejects on the success path', async () => {
    installChromeStorageMock({ setRejects: new Error('QUOTA_BYTES exceeded') })
    vi.mocked(fetchManifest).mockResolvedValue(
      fakeManifest([fakeManifestEntry(UUID_NOOP, PIN_BY_UUID[UUID_NOOP])]),
    )
    const result = await refreshBundledTranslators()
    // In-memory result still returned correctly; only the persisted state is lost.
    expect(result.lastRefreshResult).toBe('success')
    expect(result.updatedCount).toBe(0)
  })

  it('does NOT throw when storage.set rejects on the manifest-fetch-failed path', async () => {
    installChromeStorageMock({ setRejects: new Error('storage gone') })
    vi.mocked(fetchManifest).mockRejectedValue(
      new TranslatorFetcherError('NETWORK_ERROR', 'offline'),
    )
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('manifest-fetch-failed')
  })

  it('does NOT throw when storage.set rejects on the signature-invalid path', async () => {
    installChromeStorageMock({ setRejects: new Error('storage gone') })
    vi.mocked(fetchManifest).mockRejectedValue(
      new TranslatorFetcherError('SIGNATURE_INVALID', 'tampered'),
    )
    const result = await refreshBundledTranslators()
    expect(result.lastRefreshResult).toBe('signature-invalid')
  })
})
