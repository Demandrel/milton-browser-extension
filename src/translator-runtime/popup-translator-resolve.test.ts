// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./translator-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./translator-fetcher')>()
  return { ...actual, fetchManifest: vi.fn() }
})

vi.mock('./translator-bundle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./translator-bundle')>()
  return {
    ...actual,
    getResolvedTranslator: vi.fn(),
  }
})

import { fetchManifest } from './translator-fetcher'
import { getResolvedTranslator } from './translator-bundle'
import type { Manifest } from './translator-fetcher'
import type { BundledTranslator } from './zotero-types'
import { maybeInlineFresherTranslator } from './popup-translator-resolve'

const TEST_UUID = 'test-uuid'
const CACHE_KEY = `translator-fetched:${TEST_UUID}`
const EMPTY_MANIFEST: Manifest = {
  schema_version: '1',
  mirror: 'test',
  generated_at: '2024-01-01',
  upstream_commit: 'test',
  upstream_source: 'test',
  license: 'AGPL-3.0-or-later',
  signature_url: 'test.sig',
  translators: [],
}

function mkTranslator(body: string): BundledTranslator {
  return { metadata: { translatorID: TEST_UUID, label: 'test' }, body }
}

// chrome.storage.local mock — minimal surface for the cache-existence probe.
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
      },
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock
  return { data }
}

function uninstallChromeStorageMock(): void {
  delete (globalThis as { chrome?: unknown }).chrome
}

describe('maybeInlineFresherTranslator', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
    vi.mocked(fetchManifest).mockResolvedValue(EMPTY_MANIFEST)
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.clearAllMocks()
  })

  it('returns the resolved translator when a cached-fresher entry exists (cached-fresher won)', async () => {
    const cached = mkTranslator('/* CACHED FRESHER */')
    storage.data.set(CACHE_KEY, {
      metadata: cached.metadata,
      body: cached.body,
      sha256: 'a'.repeat(64),
      fetchedAt: Date.now(),
    })
    vi.mocked(getResolvedTranslator).mockResolvedValue(cached)
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeDefined()
    expect(out!.body).toBe('/* CACHED FRESHER */')
  })

  it('SHORT-CIRCUITS: skips fetchManifest entirely when no cached entry exists for the UUID (H1 hot-path fix)', async () => {
    // No storage entry for CACHE_KEY → must return undefined WITHOUT touching
    // fetchManifest. This is the common case on every popup capture; the
    // short-circuit is what keeps the hot path off the wire.
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
    expect(vi.mocked(fetchManifest)).not.toHaveBeenCalled()
    expect(vi.mocked(getResolvedTranslator)).not.toHaveBeenCalled()
  })

  it('returns undefined when cached entry exists but resolver returns null (stale-cache case)', async () => {
    // Cached entry present but its SHA no longer matches the current manifest
    // (resolver fell through to getBundledTranslator → null in popup context).
    storage.data.set(CACHE_KEY, {
      metadata: mkTranslator('/* stale */').metadata,
      body: '/* stale */',
      sha256: 'a'.repeat(64),
      fetchedAt: Date.now(),
    })
    vi.mocked(getResolvedTranslator).mockResolvedValue(null)
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined and does not throw when fetchManifest fails (best-effort)', async () => {
    storage.data.set(CACHE_KEY, {
      metadata: mkTranslator('/* x */').metadata,
      body: '/* x */',
      sha256: 'a'.repeat(64),
      fetchedAt: Date.now(),
    })
    vi.mocked(fetchManifest).mockRejectedValue(new Error('network down'))
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined when resolver throws (best-effort)', async () => {
    storage.data.set(CACHE_KEY, {
      metadata: mkTranslator('/* x */').metadata,
      body: '/* x */',
      sha256: 'a'.repeat(64),
      fetchedAt: Date.now(),
    })
    vi.mocked(getResolvedTranslator).mockRejectedValue(new Error('storage corrupt'))
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined when chrome.storage is unavailable (sandbox-like context, never throws)', async () => {
    uninstallChromeStorageMock()
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
    expect(vi.mocked(fetchManifest)).not.toHaveBeenCalled()
  })
})
