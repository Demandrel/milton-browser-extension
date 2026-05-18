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
    getBundledTranslator: vi.fn(),
  }
})

import { fetchManifest } from './translator-fetcher'
import { getBundledTranslator, getResolvedTranslator } from './translator-bundle'
import type { Manifest } from './translator-fetcher'
import type { BundledTranslator } from './zotero-types'
import { maybeInlineFresherTranslator } from './popup-translator-resolve'

const TEST_UUID = 'test-uuid'
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

describe('maybeInlineFresherTranslator', () => {
  beforeEach(() => {
    vi.mocked(fetchManifest).mockResolvedValue(EMPTY_MANIFEST)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the resolved translator when its body differs from bundled (cached-fresher won)', async () => {
    const cached = mkTranslator('/* CACHED FRESHER */')
    const bundled = mkTranslator('/* bundled */')
    vi.mocked(getResolvedTranslator).mockResolvedValue(cached)
    vi.mocked(getBundledTranslator).mockReturnValue(bundled)
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeDefined()
    expect(out!.body).toBe('/* CACHED FRESHER */')
  })

  it('returns undefined when resolved body matches bundled (no inline needed; sandbox lookup gives same answer)', async () => {
    const same = mkTranslator('/* same */')
    vi.mocked(getResolvedTranslator).mockResolvedValue(same)
    vi.mocked(getBundledTranslator).mockReturnValue(same)
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined when resolver returns null (UUID not in bundle or cache)', async () => {
    vi.mocked(getResolvedTranslator).mockResolvedValue(null)
    vi.mocked(getBundledTranslator).mockReturnValue(null)
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined and does not throw when fetchManifest fails (best-effort)', async () => {
    vi.mocked(fetchManifest).mockRejectedValue(new Error('network down'))
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })

  it('returns undefined when resolver throws (best-effort)', async () => {
    vi.mocked(getResolvedTranslator).mockRejectedValue(new Error('storage corrupt'))
    const out = await maybeInlineFresherTranslator(TEST_UUID)
    expect(out).toBeUndefined()
  })
})
