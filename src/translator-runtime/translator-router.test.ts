// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BundledTranslator } from './zotero-types'
import type { Manifest } from './translator-fetcher'

vi.mock('./translator-bundle', () => ({
  listBundledTranslators: vi.fn(),
}))
vi.mock('./translator-fetcher', () => ({
  fetchManifest: vi.fn(),
}))

import { findCandidateTranslatorIds, _internal } from './translator-router'
import { listBundledTranslators } from './translator-bundle'
import { fetchManifest } from './translator-fetcher'

const mockedListBundled = vi.mocked(listBundledTranslators)
const mockedFetchManifest = vi.mocked(fetchManifest)

function bt(
  translatorID: string,
  target: string,
  opts: { priority?: number; translatorType?: number; label?: string } = {},
): BundledTranslator {
  return {
    metadata: {
      translatorID,
      label: opts.label ?? translatorID,
      target,
      priority: opts.priority ?? 100,
      translatorType: opts.translatorType ?? 4,
    },
    body: '/* mock body */',
  }
}

function emptyManifest(translators: Manifest['translators']): Manifest {
  return {
    schema_version: 'v1',
    mirror: 'test',
    generated_at: '2026-05-17T00:00:00Z',
    upstream_commit: 'abc',
    upstream_source: 'https://github.com/zotero/translators',
    license: 'AGPL-3.0-or-later',
    signature_url: 'https://translators.milton.so/repo/metadata.sig',
    translators,
  }
}

describe('translator-router · bitmask filter', () => {
  it('keeps translatorType === 4 (Web only)', () => {
    expect(_internal.isWebTranslator(4)).toBe(true)
  })
  it('keeps translatorType === 12 (Web | Search)', () => {
    expect(_internal.isWebTranslator(12)).toBe(true)
  })
  it('keeps translatorType === 5 (Web | Import)', () => {
    expect(_internal.isWebTranslator(5)).toBe(true)
  })
  it('rejects translatorType === 1 (Import only)', () => {
    expect(_internal.isWebTranslator(1)).toBe(false)
  })
  it('rejects translatorType === 2 (Export only)', () => {
    expect(_internal.isWebTranslator(2)).toBe(false)
  })
  it('rejects translatorType === 8 (Search only)', () => {
    expect(_internal.isWebTranslator(8)).toBe(false)
  })
  it('rejects undefined translatorType', () => {
    expect(_internal.isWebTranslator(undefined)).toBe(false)
  })
})

describe('findCandidateTranslatorIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns bundled match without fetching manifest', async () => {
    mockedListBundled.mockReturnValue([bt('arxiv-id', '^https?://arxiv\\.org/abs/')])
    const out = await findCandidateTranslatorIds('https://arxiv.org/abs/2303.08774')
    expect(out).toEqual(['arxiv-id'])
    expect(mockedFetchManifest).not.toHaveBeenCalled()
  })

  it('sorts multiple bundled matches by priority ascending', async () => {
    mockedListBundled.mockReturnValue([
      bt('low-prio', 'example\\.com', { priority: 200 }),
      bt('high-prio', 'example\\.com', { priority: 50 }),
      bt('mid-prio', 'example\\.com', { priority: 100 }),
    ])
    const out = await findCandidateTranslatorIds('https://example.com/paper')
    expect(out).toEqual(['high-prio', 'mid-prio', 'low-prio'])
  })

  it('falls through to manifest when no bundled match', async () => {
    mockedListBundled.mockReturnValue([bt('arxiv', 'arxiv\\.org')])
    mockedFetchManifest.mockResolvedValue(
      emptyManifest([
        {
          translatorID: 'lazy-translator',
          label: 'Library Hub',
          target: 'libraryhub\\.example',
          translatorType: 4,
          priority: 100,
          sha256: 'aa',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
      ]),
    )
    const out = await findCandidateTranslatorIds('https://libraryhub.example/catalog/123')
    expect(out).toEqual(['lazy-translator'])
  })

  it('returns empty array when neither bundled nor manifest match', async () => {
    mockedListBundled.mockReturnValue([bt('arxiv', 'arxiv\\.org')])
    mockedFetchManifest.mockResolvedValue(emptyManifest([]))
    const out = await findCandidateTranslatorIds('https://example.com/random')
    expect(out).toEqual([])
  })

  it('bitmask filter — accepts manifest entry with translatorType=12 (Web|Search)', async () => {
    mockedListBundled.mockReturnValue([])
    mockedFetchManifest.mockResolvedValue(
      emptyManifest([
        {
          translatorID: 'combined',
          label: 'Combined Web+Search',
          target: 'example\\.com',
          translatorType: 12,
          priority: 100,
          sha256: 'aa',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
      ]),
    )
    const out = await findCandidateTranslatorIds('https://example.com/x')
    expect(out).toEqual(['combined'])
  })

  it('bitmask filter — rejects Import-only translator (translatorType=1)', async () => {
    mockedListBundled.mockReturnValue([])
    mockedFetchManifest.mockResolvedValue(
      emptyManifest([
        {
          translatorID: 'import-only',
          label: 'Some Importer',
          target: 'example\\.com',
          translatorType: 1,
          priority: 100,
          sha256: 'aa',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
      ]),
    )
    const out = await findCandidateTranslatorIds('https://example.com/x')
    expect(out).toEqual([])
  })

  it('tolerates bad regex without throwing — manifest case', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedListBundled.mockReturnValue([])
    mockedFetchManifest.mockResolvedValue(
      emptyManifest([
        {
          translatorID: 'bad-regex',
          label: 'Bad',
          target: '[', // unterminated character class — compiles to an error
          translatorType: 4,
          priority: 100,
          sha256: 'aa',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
        {
          translatorID: 'good',
          label: 'Good',
          target: 'example\\.com',
          translatorType: 4,
          priority: 100,
          sha256: 'bb',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
      ]),
    )
    const out = await findCandidateTranslatorIds('https://example.com/x')
    expect(out).toEqual(['good'])
    expect(warn).toHaveBeenCalled()
    const calls = warn.mock.calls.map((c) => c.join(' '))
    expect(calls.some((s) => s.includes('bad target regex'))).toBe(true)
  })

  it('tolerates manifest-fetch failure (returns [])', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedListBundled.mockReturnValue([])
    mockedFetchManifest.mockRejectedValue(new Error('CDN down'))
    const out = await findCandidateTranslatorIds('https://example.com/x')
    expect(out).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('de-duplicates manifest entries that share a UUID with bundled entries', async () => {
    // Edge case: a translator that is BOTH bundled (verified) AND in the manifest.
    // Bundle wins; manifest entry is excluded from the result so the same UUID
    // doesn't appear twice.
    mockedListBundled.mockReturnValue([bt('shared', 'shared\\.example')])
    mockedFetchManifest.mockResolvedValue(
      emptyManifest([
        {
          translatorID: 'shared',
          label: 'Shared',
          target: 'shared\\.example',
          translatorType: 4,
          priority: 100,
          sha256: 'aa',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
        {
          translatorID: 'other',
          label: 'Other',
          target: 'shared\\.example',
          translatorType: 4,
          priority: 50,
          sha256: 'bb',
          size_bytes: 1,
          lastUpdated: '2026-01-01',
        },
      ]),
    )
    // Bundled covered → manifest NOT consulted because findCandidateTranslatorIds
    // takes the short-circuit when bundled.length > 0. So only ['shared'].
    const out = await findCandidateTranslatorIds('https://shared.example/x')
    expect(out).toEqual(['shared'])
    expect(mockedFetchManifest).not.toHaveBeenCalled()
  })

  it('does not list translators with empty/missing target', async () => {
    mockedListBundled.mockReturnValue([
      bt('no-target', '', { priority: 100 }),
    ])
    mockedFetchManifest.mockResolvedValue(emptyManifest([]))
    const out = await findCandidateTranslatorIds('https://example.com/x')
    expect(out).toEqual([])
  })
})
