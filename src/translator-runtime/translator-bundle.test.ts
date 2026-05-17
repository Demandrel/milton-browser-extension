// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import { getBundledTranslator, listBundledTranslatorIDs } from './translator-bundle'

const ARXIV_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'

describe('translator-bundle', () => {
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
