// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { afterEach, describe, expect, it } from 'vitest'
import {
  clearRegistry,
  findWebTranslators,
  getRegisteredTranslator,
  installZoteroTranslators,
  registerTranslator,
} from './zotero-translators'
import type { BundledTranslator, ZoteroGlobal } from './zotero-types'

const arxivLike: BundledTranslator = {
  metadata: {
    translatorID: 'arxiv-id',
    label: 'arXiv.org',
    target: '^https?://([^.]+\\.)?(arxiv\\.org|xxx\\.lanl\\.gov)/(abs|pdf)/',
    priority: 100,
  },
  body: 'function detectWeb() {}',
}

const highPriority: BundledTranslator = {
  metadata: {
    translatorID: 'overlap-id',
    label: 'OverlapHigh',
    target: 'arxiv\\.org',
    priority: 50,
  },
  body: '',
}

afterEach(() => {
  clearRegistry()
})

describe('zotero-translators registry', () => {
  it('registers + retrieves a translator by ID', () => {
    registerTranslator(arxivLike)
    expect(getRegisteredTranslator('arxiv-id')?.metadata.label).toBe('arXiv.org')
  })

  it('returns null on unknown ID', () => {
    expect(getRegisteredTranslator('nope')).toBeNull()
  })

  it('finds web translators by URL via target regex', () => {
    registerTranslator(arxivLike)
    const matches = findWebTranslators('https://arxiv.org/abs/2303.08774')
    expect(matches).toHaveLength(1)
    expect(matches[0].metadata.translatorID).toBe('arxiv-id')
  })

  it('returns empty array when no targets match', () => {
    registerTranslator(arxivLike)
    expect(findWebTranslators('https://example.com/x')).toEqual([])
  })

  it('orders matches by ascending priority', () => {
    registerTranslator(arxivLike) // priority 100
    registerTranslator(highPriority) // priority 50
    const matches = findWebTranslators('https://arxiv.org/abs/x')
    expect(matches.map((m) => m.metadata.translatorID)).toEqual(['overlap-id', 'arxiv-id'])
  })

  it('installs Zotero.Translators with get + getWebTranslators on the global', async () => {
    registerTranslator(arxivLike)
    const z: ZoteroGlobal = {}
    installZoteroTranslators(z)
    expect(z.Translators).toBeDefined()
    const fromGet = z.Translators!.get('arxiv-id') as { label?: string } | null
    expect(fromGet?.label).toBe('arXiv.org')
    const [translators] = await z.Translators!.getWebTranslators('https://arxiv.org/abs/x')
    expect(translators).toHaveLength(1)
  })
})
