// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import { getBundledTranslator, listBundledTranslatorIDs } from './translator-bundle'

const ARXIV_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'

describe('translator-bundle', () => {
  it('lists arXiv as the only bundled translator (BE-8-4)', () => {
    const ids = listBundledTranslatorIDs()
    expect(ids).toContain(ARXIV_ID)
    expect(ids).toHaveLength(1)
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
})
