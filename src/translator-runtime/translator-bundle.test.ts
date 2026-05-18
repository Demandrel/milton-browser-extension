// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pinJson from '../../translator-bundle-pin.json' with { type: 'json' }
import {
  _resetForTests,
  _setVerifiedSet,
  getBundledTranslator,
  getResolvedTranslator,
  listBundledTranslatorIDs,
  verifyAllBundleIntegrity,
} from './translator-bundle'
import type { Manifest, ManifestEntry } from './translator-fetcher'

const ARXIV_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'
const ARXIV_PIN_SHA = (pinJson.bundleHashes as Record<string, string>)[ARXIV_ID]

describe('translator-bundle', () => {
  // Most tests want the production-like flow: integrity verified + set
  // installed, so getBundledTranslator returns real translators. AC6 gate
  // tests reset and exercise the unbootstrapped state explicitly.
  beforeEach(async () => {
    _resetForTests()
    const verified = await verifyAllBundleIntegrity()
    _setVerifiedSet(verified)
  })

  it('lists arXiv among the bundled translators (BE-8-5 — curated bundle of ~26 translators)', () => {
    const ids = listBundledTranslatorIDs()
    expect(ids).toContain(ARXIV_ID)
    // BE-8-5 expanded the bundle from 1 (BE-8-4 spike) to ~26 curated entries.
    // Lower bound guards against accidental empty-bundle regressions; upper
    // bound is the AC2 + SANITY_MAX (200) ceiling enforced by refresh script.
    expect(ids.length).toBeGreaterThanOrEqual(20)
    expect(ids.length).toBeLessThanOrEqual(200)
  })

  it('getBundledTranslator returns the arXiv translator with parsed metadata', () => {
    const t = getBundledTranslator(ARXIV_ID)
    expect(t).not.toBeNull()
    expect(t!.metadata.label).toBe('arXiv.org')
    expect(t!.metadata.translatorID).toBe(ARXIV_ID)
    expect(t!.metadata.target).toContain('arxiv')
    expect(t!.body.length).toBeGreaterThan(100)
  })

  it('returns null for translator IDs not in the bundle', () => {
    expect(getBundledTranslator('nonexistent-translator-id')).toBeNull()
  })

  it('parsed body INCLUDES the metadata header JSON (framework evals `var ZOTERO_TRANSLATOR_INFO = ${body}` so metadata must be the value expression)', () => {
    const t = getBundledTranslator(ARXIV_ID)
    expect(t!.body).toContain('"translatorID"')
    // Sanity: body also contains the function declarations after the metadata
    expect(t!.body).toMatch(/function\s+detectWeb/)
    expect(t!.body).toMatch(/function\s+doWeb/)
  })

  // Regression coverage for the M2 finding (code-review fix) — the leading
  // comment skip used to only handle `//` line comments. Now it also accepts
  // `/* ... */` block comments before the metadata block. We exercise this
  // via the arXiv translator's existing `/* */` BEGIN LICENSE BLOCK to prove
  // the parser doesn't choke when the lookahead runs into a block-comment
  // form after the metadata block (depth=0 short-circuits before getting
  // there, but the unit-of-truth is: arXiv loads end-to-end).
  it('arXiv translator with /* BEGIN LICENSE BLOCK */ comment AFTER metadata parses cleanly', () => {
    const t = getBundledTranslator(ARXIV_ID)
    expect(t).not.toBeNull()
    expect(t!.body).toContain('BEGIN LICENSE BLOCK')
  })
})

// ─── BE-8-5 AC6: runtime bundle integrity check ─────────────────────────
describe('translator-bundle integrity (AC6)', () => {
  afterEach(() => {
    _resetForTests()
    vi.restoreAllMocks()
  })

  it('verifyAllBundleIntegrity returns the full set of bundled translators when all hashes match', async () => {
    _resetForTests()
    const verified = await verifyAllBundleIntegrity()
    // Every translator in the bundle should verify against its pin entry
    // (the refresh script wrote both; bit-flips between then and now would
    // mean someone tampered with the repo).
    expect(verified.size).toBe(listBundledTranslatorIDs().length)
    expect(verified.has(ARXIV_ID)).toBe(true)
  })

  it('getBundledTranslator returns null when verifiedSet === null (bootstrap-not-run defense)', () => {
    _resetForTests() // verifiedSet starts null
    expect(getBundledTranslator(ARXIV_ID)).toBeNull()
  })

  it('getBundledTranslator returns null for translatorIDs not in verifiedSet', async () => {
    _resetForTests()
    // Install an EMPTY verified set — every lookup should now be gated off
    // even though the registry still contains the translators.
    _setVerifiedSet(new Set())
    expect(getBundledTranslator(ARXIV_ID)).toBeNull()
  })

  it('getBundledTranslator returns null for translatorIDs in registry but excluded from verifiedSet', async () => {
    _resetForTests()
    // Install a verified set that DELIBERATELY excludes arXiv — simulates
    // arXiv source-bytes failing the integrity check while the rest pass.
    const verified = await verifyAllBundleIntegrity()
    verified.delete(ARXIV_ID)
    _setVerifiedSet(verified)
    expect(getBundledTranslator(ARXIV_ID)).toBeNull()
    // A different translator that DID verify should still resolve.
    const remaining = [...verified][0]
    expect(getBundledTranslator(remaining)).not.toBeNull()
  })

  it('returns null for translatorIDs that are not in the bundle at all', async () => {
    _resetForTests()
    const verified = await verifyAllBundleIntegrity()
    _setVerifiedSet(verified)
    expect(getBundledTranslator('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

// ─── BE-8-9 AC5: cached-fresher resolver ─────────────────────────────────

describe('getResolvedTranslator — three-way cached / pin / manifest decision (AC5)', () => {
  function makeManifestEntry(uuid: string, sha256: string): ManifestEntry {
    return {
      translatorID: uuid,
      label: 'arXiv.org',
      sha256,
      size_bytes: 100,
      priority: 100,
      translatorType: 4,
      lastUpdated: '2024-01-01',
    }
  }

  function makeManifest(entries: ManifestEntry[]): Manifest {
    return {
      schema_version: '1',
      mirror: 'test',
      generated_at: '2024-01-01',
      upstream_commit: 'test',
      upstream_source: 'test',
      license: 'AGPL-3.0-or-later',
      signature_url: 'test.sig',
      translators: entries,
    }
  }

  function installChromeStorage(): Map<string, unknown> {
    const data = new Map<string, unknown>()
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            const out: Record<string, unknown> = {}
            if (data.has(key)) out[key] = data.get(key)
            return out
          }),
        },
      },
    }
    return data
  }

  beforeEach(async () => {
    _resetForTests()
    const verified = await verifyAllBundleIntegrity()
    _setVerifiedSet(verified)
  })

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome
    vi.restoreAllMocks()
  })

  it('returns CACHED fresher when cached sha256 matches manifest entry AND differs from bundle pin', async () => {
    const data = installChromeStorage()
    const NEW_SHA = 'b'.repeat(64)
    data.set(`translator-fetched:${ARXIV_ID}`, {
      metadata: { translatorID: ARXIV_ID, label: 'arXiv.org (fresher)' },
      body: '/* CACHED FRESHER BODY */',
      sha256: NEW_SHA,
      fetchedAt: Date.now(),
    })
    const manifest = makeManifest([makeManifestEntry(ARXIV_ID, NEW_SHA)])
    const resolved = await getResolvedTranslator(ARXIV_ID, manifest)
    expect(resolved).not.toBeNull()
    expect(resolved!.body).toBe('/* CACHED FRESHER BODY */')
    expect(resolved!.metadata.label).toBe('arXiv.org (fresher)')
  })

  it('falls through to BUNDLED when manifest sha matches pin (bundled is current; no-op case)', async () => {
    // Even with a cached entry present, when manifest === pin the bundled
    // version is current and the cached check short-circuits.
    const data = installChromeStorage()
    data.set(`translator-fetched:${ARXIV_ID}`, {
      metadata: { translatorID: ARXIV_ID, label: 'wrong-label' },
      body: '/* cached body (ignored — manifest matches pin) */',
      sha256: ARXIV_PIN_SHA,
      fetchedAt: Date.now(),
    })
    const manifest = makeManifest([makeManifestEntry(ARXIV_ID, ARXIV_PIN_SHA)])
    const resolved = await getResolvedTranslator(ARXIV_ID, manifest)
    expect(resolved).not.toBeNull()
    expect(resolved!.metadata.label).toBe('arXiv.org') // real bundled label
  })

  it('falls through to BUNDLED when cached sha differs from manifest entry (stale-cache case)', async () => {
    // Manifest says newest sha = X, but cached sha = Y (stale entry from
    // earlier refresh, then upstream rolled forward). Cached entry is not
    // trusted; bundled version is served.
    const data = installChromeStorage()
    data.set(`translator-fetched:${ARXIV_ID}`, {
      metadata: { translatorID: ARXIV_ID, label: 'stale-cached' },
      body: '/* stale cached body — must NOT win */',
      sha256: 'a'.repeat(64),
      fetchedAt: Date.now(),
    })
    const manifest = makeManifest([makeManifestEntry(ARXIV_ID, 'b'.repeat(64))])
    const resolved = await getResolvedTranslator(ARXIV_ID, manifest)
    expect(resolved).not.toBeNull()
    expect(resolved!.metadata.label).toBe('arXiv.org')
  })

  it('falls through to BUNDLED when currentManifest === null (degraded mode, AC9)', async () => {
    // Even with a "cached-fresher" entry present, null manifest means we
    // skip the cached check entirely. Bundled wins.
    const data = installChromeStorage()
    data.set(`translator-fetched:${ARXIV_ID}`, {
      metadata: { translatorID: ARXIV_ID, label: 'cached-but-no-manifest' },
      body: '/* cached body but no manifest to validate against */',
      sha256: 'b'.repeat(64),
      fetchedAt: Date.now(),
    })
    const resolved = await getResolvedTranslator(ARXIV_ID, null)
    expect(resolved).not.toBeNull()
    expect(resolved!.metadata.label).toBe('arXiv.org')
  })

  it('returns null when UUID is in neither bundle nor cache', async () => {
    installChromeStorage()
    const unknownUuid = '00000000-0000-0000-0000-000000000000'
    const manifest = makeManifest([makeManifestEntry(unknownUuid, 'a'.repeat(64))])
    const resolved = await getResolvedTranslator(unknownUuid, manifest)
    expect(resolved).toBeNull()
  })

  it('falls through to BUNDLED when manifest entry is missing for the UUID (manifest-deleted case)', async () => {
    // Bundled UUID present, but upstream removed the entry from the manifest
    // (rare — would mean Zotero deleted the translator). Bundled stays.
    installChromeStorage()
    const manifest = makeManifest([])
    const resolved = await getResolvedTranslator(ARXIV_ID, manifest)
    expect(resolved).not.toBeNull()
    expect(resolved!.metadata.label).toBe('arXiv.org')
  })

  it('falls through to BUNDLED when chrome.storage is unavailable (sandbox-like context)', async () => {
    // No installChromeStorage call → chrome is undefined.
    delete (globalThis as { chrome?: unknown }).chrome
    const NEW_SHA = 'b'.repeat(64)
    const manifest = makeManifest([makeManifestEntry(ARXIV_ID, NEW_SHA)])
    const resolved = await getResolvedTranslator(ARXIV_ID, manifest)
    expect(resolved).not.toBeNull()
    expect(resolved!.metadata.label).toBe('arXiv.org')
  })
})
