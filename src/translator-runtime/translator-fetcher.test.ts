// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Test env: explicitly NODE (not jsdom). @noble/ed25519@1.x's jsdom code
// path falls back to crypto.subtle.digest() with a stricter input check
// that rejects Uint8Array (Failed to execute 'digest' on 'SubtleCrypto'),
// breaking sig verification. Node env uses node:crypto's SHA-512
// directly, which works. We don't need a DOM here — chrome.storage is
// stubbed below with a plain Map, fetch is mocked, and crypto.subtle is
// provided by Node 20+ webcrypto natively.
//
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _internal,
  fetchManifest,
  fetchTranslatorFromCdn,
  TranslatorFetcherError,
} from './translator-fetcher'

const ARXIV_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'
const FIXTURE_DIR = resolve(__dirname, '__fixtures__')
const FIXTURE_MANIFEST_BYTES = readFileSync(resolve(FIXTURE_DIR, 'manifest.fixture.json'))
const FIXTURE_MANIFEST_SIG_HEX = readFileSync(
  resolve(FIXTURE_DIR, 'manifest.fixture.sig'),
  'utf-8',
).trim()
const FIXTURE_MANIFEST = JSON.parse(FIXTURE_MANIFEST_BYTES.toString('utf-8'))
const ARXIV_ENTRY = FIXTURE_MANIFEST.translators.find((t: { translatorID: string }) => t.translatorID === ARXIV_ID)

// ────────────────────────────────────────────────────────────────────────
// chrome.storage.local mock — Promise-style (MV3 ≥88) per Testing standards
// ────────────────────────────────────────────────────────────────────────

interface MockStorage {
  data: Map<string, unknown>
  setShouldThrow: Error | null
}

function installChromeStorageMock(): MockStorage {
  const data = new Map<string, unknown>()
  const state: MockStorage = { data, setShouldThrow: null }
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) {
            return Object.fromEntries(data.entries())
          }
          const asArr = Array.isArray(keys) ? keys : [keys]
          const out: Record<string, unknown> = {}
          for (const k of asArr) {
            if (data.has(k)) out[k] = data.get(k)
          }
          return out
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          if (state.setShouldThrow !== null) throw state.setShouldThrow
          for (const [k, v] of Object.entries(items)) data.set(k, v)
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const asArr = Array.isArray(keys) ? keys : [keys]
          for (const k of asArr) data.delete(k)
        }),
      },
    },
    runtime: { lastError: undefined },
  }
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock
  return state
}

function uninstallChromeStorageMock(): void {
  delete (globalThis as { chrome?: unknown }).chrome
}

// ────────────────────────────────────────────────────────────────────────
// fetch mock helpers
// ────────────────────────────────────────────────────────────────────────

interface MockFetchHandler {
  url: string | RegExp
  response: () => Response | Promise<Response>
}

function installFetchMock(handlers: MockFetchHandler[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    for (const h of handlers) {
      if (typeof h.url === 'string' ? h.url === url : h.url.test(url)) {
        return h.response()
      }
    }
    throw new Error(`unmocked fetch: ${url}`)
  })
}

function toArrayBuffer(buf: Buffer | Uint8Array): ArrayBuffer {
  // Copy into a fresh ArrayBuffer to (a) satisfy strict TS BodyInit typing
  // and (b) work around jsdom's Response constructor not handling
  // Buffer/Uint8Array bodies (throws "object.stream is not a function").
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  return out
}

function manifestResponse(): Response {
  return new Response(toArrayBuffer(FIXTURE_MANIFEST_BYTES), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sigResponse(): Response {
  return new Response(FIXTURE_MANIFEST_SIG_HEX + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function arxivTranslatorBytes(): Uint8Array {
  const path = resolve(__dirname, 'translators/arxiv-org.js')
  return new Uint8Array(readFileSync(path))
}

function arxivCodeResponse(): Response {
  return new Response(toArrayBuffer(arxivTranslatorBytes()), {
    status: 200,
    headers: { 'Content-Type': 'application/javascript' },
  })
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('translator-fetcher — happy path (AC7)', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
      { url: new RegExp(`/repo/code/${ARXIV_ID}$`), response: () => arxivCodeResponse() },
    ])
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
  })

  it('fetchManifest fetches + verifies + caches the manifest', async () => {
    const manifest = await fetchManifest()
    expect(manifest.translators.length).toBeGreaterThan(700)
    expect(manifest.upstream_commit).toBe(FIXTURE_MANIFEST.upstream_commit)
    expect(storage.data.has(_internal.MANIFEST_CACHE_KEY)).toBe(true)
  })

  it('fetchManifest returns from cache on second call within TTL (single network round-trip)', async () => {
    await fetchManifest()
    const fetchCallCountAfterFirst = vi.mocked(globalThis.fetch).mock.calls.length
    await fetchManifest()
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(fetchCallCountAfterFirst)
  })

  it('fetchManifest refetches when force=true even if cache is fresh', async () => {
    await fetchManifest()
    const before = vi.mocked(globalThis.fetch).mock.calls.length
    await fetchManifest(true)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before)
  })

  it('fetchTranslatorFromCdn happy path returns the translator with verified bytes', async () => {
    const t = await fetchTranslatorFromCdn(ARXIV_ID)
    expect(t).not.toBeNull()
    expect(t!.metadata.translatorID).toBe(ARXIV_ID)
    expect(t!.metadata.label).toBe('arXiv.org')
    expect(t!.body.length).toBeGreaterThan(100)
    // Cache populated.
    const cacheKey = `${_internal.TRANSLATOR_CACHE_KEY_PREFIX}${ARXIV_ID}`
    expect(storage.data.has(cacheKey)).toBe(true)
  })

  it('fetchTranslatorFromCdn returns cached result on second call (no network)', async () => {
    await fetchTranslatorFromCdn(ARXIV_ID)
    const before = vi.mocked(globalThis.fetch).mock.calls.length
    const t2 = await fetchTranslatorFromCdn(ARXIV_ID)
    expect(t2).not.toBeNull()
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before)
  })
})

describe('translator-fetcher — error paths (AC15 task 5.6)', () => {
  beforeEach(() => {
    installChromeStorageMock()
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
  })

  it('returns null when the UUID is NOT in the manifest (NOT_IN_MANIFEST shortcut)', async () => {
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
    ])
    const t = await fetchTranslatorFromCdn('00000000-0000-0000-0000-000000000000')
    expect(t).toBeNull()
  })

  it('throws CDN_4XX on /repo/code/{id} 404', async () => {
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
      { url: new RegExp(`/repo/code/${ARXIV_ID}$`), response: () => new Response('', { status: 404 }) },
    ])
    await expect(fetchTranslatorFromCdn(ARXIV_ID)).rejects.toMatchObject({
      code: 'CDN_4XX',
    })
  })

  it('throws CDN_5XX on /repo/metadata 503', async () => {
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => new Response('', { status: 503 }) },
    ])
    await expect(fetchManifest(true)).rejects.toMatchObject({ code: 'CDN_5XX' })
  })

  it('throws NETWORK_ERROR on fetch() throwing (e.g. offline)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('NetworkError: offline')
    })
    await expect(fetchManifest(true)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('throws SIGNATURE_INVALID when the manifest sig is bytewise-bad (tampered)', async () => {
    // Flip the first byte of the sig — verify will fail.
    const tamperedSig = Buffer.from(FIXTURE_MANIFEST_SIG_HEX, 'utf-8')
    tamperedSig[0] = tamperedSig[0] === 0x39 ? 0x38 : 0x39 // bump first hex char by 1
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => new Response(tamperedSig.toString('utf-8') + '\n', { status: 200 }) },
    ])
    await expect(fetchManifest(true)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
  })

  it('throws SIGNATURE_INVALID when the manifest bytes are tampered (signed bytes vs served bytes diverge)', async () => {
    const tampered = Buffer.concat([FIXTURE_MANIFEST_BYTES, Buffer.from(' ')])
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => new Response(tampered, { status: 200 }) },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
    ])
    await expect(fetchManifest(true)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
  })

  it('throws MANIFEST_MALFORMED on non-hex signature', async () => {
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => new Response('NOT_HEX_AT_ALL', { status: 200 }) },
    ])
    await expect(fetchManifest(true)).rejects.toMatchObject({ code: 'MANIFEST_MALFORMED' })
  })

  it('throws HASH_MISMATCH when /repo/code/{id} bytes do not match the manifest sha256', async () => {
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
      // Return mismatched bytes for the arXiv code endpoint.
      { url: new RegExp(`/repo/code/${ARXIV_ID}$`), response: () => new Response('TAMPERED', { status: 200 }) },
    ])
    await expect(fetchTranslatorFromCdn(ARXIV_ID)).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    // ARXIV_ENTRY should be defined; sanity check we're not skipping the assertion.
    expect(ARXIV_ENTRY).toBeDefined()
  })
})

describe('translator-fetcher — cache invalidation + LRU (AC8)', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
  })

  it('hash-driven invalidation: on manifest refresh, evicts cached translators whose sha256 changed', async () => {
    // Seed cache with arXiv at an OLD sha256 (not matching the live manifest).
    const cacheKey = `${_internal.TRANSLATOR_CACHE_KEY_PREFIX}${ARXIV_ID}`
    storage.data.set(cacheKey, {
      metadata: { translatorID: ARXIV_ID, label: 'arXiv.org' },
      body: '/* old stale source */',
      sha256: 'OLD_SHA_THAT_DIFFERS_FROM_MANIFEST',
      fetchedAt: Date.now(),
    })
    expect(storage.data.has(cacheKey)).toBe(true)

    // Force a manifest refresh.
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
    ])
    await fetchManifest(true)

    // Stale cache entry should be evicted (sha256 differs from manifest).
    expect(storage.data.has(cacheKey)).toBe(false)
  })

  it('hash-driven invalidation: does NOT evict cached entries whose sha256 still matches', async () => {
    const cacheKey = `${_internal.TRANSLATOR_CACHE_KEY_PREFIX}${ARXIV_ID}`
    storage.data.set(cacheKey, {
      metadata: { translatorID: ARXIV_ID, label: 'arXiv.org' },
      body: '/* source */',
      sha256: ARXIV_ENTRY.sha256, // matches the live manifest exactly
      fetchedAt: Date.now(),
    })
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
    ])
    await fetchManifest(true)
    expect(storage.data.has(cacheKey)).toBe(true)
  })

  it('listCachedTranslators only returns entries with the translator-fetched: prefix', async () => {
    storage.data.set('translator-mirror-metadata', { foo: 'bar' })
    storage.data.set('translator-fetched:uuid-1', { sha256: 'a', fetchedAt: 1 })
    storage.data.set('translator-fetched:uuid-2', { sha256: 'b', fetchedAt: 2 })
    storage.data.set('unrelated-key', { sha256: 'c', fetchedAt: 3 })
    const refs = await _internal.listCachedTranslators()
    expect(refs.map((r) => r.key).sort()).toEqual(['translator-fetched:uuid-1', 'translator-fetched:uuid-2'])
  })

  it('LRU cap: enforces TRANSLATOR_CACHE_MAX_ENTRIES on cache write', async () => {
    // Pre-fill cache to MAX entries with fake oldest entry at time=0.
    for (let i = 0; i < _internal.TRANSLATOR_CACHE_MAX_ENTRIES; i++) {
      storage.data.set(`${_internal.TRANSLATOR_CACHE_KEY_PREFIX}filler-${i}`, {
        metadata: { translatorID: `filler-${i}`, label: 'x' },
        body: 'x',
        sha256: `hash-${i}`,
        fetchedAt: i, // oldest first
      })
    }
    expect(storage.data.size).toBeGreaterThanOrEqual(_internal.TRANSLATOR_CACHE_MAX_ENTRIES)

    // Add a new translator via the fetcher's full path.
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
      { url: new RegExp(`/repo/code/${ARXIV_ID}$`), response: () => arxivCodeResponse() },
    ])
    await fetchTranslatorFromCdn(ARXIV_ID)

    // The oldest filler (filler-0) should be evicted; arxiv should be present.
    expect(storage.data.has(`${_internal.TRANSLATOR_CACHE_KEY_PREFIX}${ARXIV_ID}`)).toBe(true)
    expect(storage.data.has(`${_internal.TRANSLATOR_CACHE_KEY_PREFIX}filler-0`)).toBe(false)
    // Cap holds at MAX.
    const lazyEntries = [...storage.data.keys()].filter((k) =>
      k.startsWith(_internal.TRANSLATOR_CACHE_KEY_PREFIX),
    )
    expect(lazyEntries.length).toBeLessThanOrEqual(_internal.TRANSLATOR_CACHE_MAX_ENTRIES)
  })
})

describe('translator-fetcher — TTL refresh', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = installChromeStorageMock()
  })

  afterEach(() => {
    uninstallChromeStorageMock()
    vi.restoreAllMocks()
  })

  it('fetchManifest refetches when cache is older than TTL', async () => {
    // Pre-populate cache with a stale entry (fetchedAt far in the past).
    storage.data.set(_internal.MANIFEST_CACHE_KEY, {
      manifest: FIXTURE_MANIFEST,
      manifestBytesHex: 'aa', // intentionally garbage so re-verify also fails the cached path
      signatureHex: 'bb',
      fetchedAt: Date.now() - _internal.MANIFEST_TTL_MS - 1000,
    })
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
    ])
    await fetchManifest()
    // Should have made a fresh fetch (stale TTL bypassed cache).
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(0)
  })

  it('fetchTranslatorFromCdn refetches when translator cache TTL expired', async () => {
    const cacheKey = `${_internal.TRANSLATOR_CACHE_KEY_PREFIX}${ARXIV_ID}`
    storage.data.set(cacheKey, {
      metadata: { translatorID: ARXIV_ID, label: 'arXiv.org' },
      body: '/* old */',
      sha256: ARXIV_ENTRY.sha256,
      fetchedAt: Date.now() - _internal.TRANSLATOR_TTL_MS - 1000,
    })
    installFetchMock([
      { url: /\/repo\/metadata$/, response: () => manifestResponse() },
      { url: /\/repo\/metadata\.sig$/, response: () => sigResponse() },
      { url: new RegExp(`/repo/code/${ARXIV_ID}$`), response: () => arxivCodeResponse() },
    ])
    await fetchTranslatorFromCdn(ARXIV_ID)
    // Should have hit the /repo/code/{id} endpoint at least once.
    const codeCalls = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
      const url = c[0]
      const s = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
      return s.includes(`/code/${ARXIV_ID}`)
    })
    expect(codeCalls.length).toBeGreaterThan(0)
  })
})

describe('TranslatorFetcherError', () => {
  it('is an Error with a typed code field + formatted message', () => {
    const err = new TranslatorFetcherError('HASH_MISMATCH', 'bytes differ')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('HASH_MISMATCH')
    expect(err.message).toContain('HASH_MISMATCH')
    expect(err.message).toContain('bytes differ')
  })
})
