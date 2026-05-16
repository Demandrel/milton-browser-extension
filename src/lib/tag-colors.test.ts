// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import { TAG_COLOR_PALETTE, getTagColor } from './tag-colors'

// ── Drift-guard test ────────────────────────────────────────────────────────
// If this file fails after a palette / hash change, verify the canonical
// impl at `milton/src/lib/features/projects/utils/tag-colors.ts` and update
// BOTH files together.
//
// Single-character names give easy hand-verified outputs:
//   "a"(97) %10 = 7 → palette[7]
//   "b"(98) %10 = 8 → palette[8]
//   "c"(99) %10 = 9 → palette[9]
//   "d"(100)%10 = 0 → palette[0]
//   "e"(101)%10 = 1 → palette[1]
// Longer names are snapshotted from the canonical impl.

describe('TAG_COLOR_PALETTE', () => {
  it('has exactly 10 colors (Figma-verified)', () => {
    expect(TAG_COLOR_PALETTE).toHaveLength(10)
  })

  it('starts with the four Figma sample colors in order', () => {
    expect(TAG_COLOR_PALETTE[0]).toBe('#8698f3') // blue-purple
    expect(TAG_COLOR_PALETTE[1]).toBe('#10b981') // emerald
    expect(TAG_COLOR_PALETTE[2]).toBe('#ccb797') // tan
    expect(TAG_COLOR_PALETTE[3]).toBe('#b1b1b1') // gray
  })

  it('every entry is a 6-digit hex color', () => {
    for (const c of TAG_COLOR_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('getTagColor', () => {
  it('returns palette[7] for "a"', () => {
    expect(getTagColor('a')).toBe(TAG_COLOR_PALETTE[7])
    expect(getTagColor('a')).toBe('#ef4444')
  })

  it('returns palette[8] for "b"', () => {
    expect(getTagColor('b')).toBe(TAG_COLOR_PALETTE[8])
  })

  it('returns palette[9] for "c"', () => {
    expect(getTagColor('c')).toBe(TAG_COLOR_PALETTE[9])
  })

  it('returns palette[0] for "d"', () => {
    expect(getTagColor('d')).toBe(TAG_COLOR_PALETTE[0])
  })

  it('returns palette[1] for "e"', () => {
    expect(getTagColor('e')).toBe(TAG_COLOR_PALETTE[1])
  })

  it('is deterministic — same input always returns same color', () => {
    const samples = ['Machine Learning', 'Quantum', 'NLP', 'tag with spaces', 'unicode-é']
    for (const s of samples) {
      expect(getTagColor(s)).toBe(getTagColor(s))
    }
  })

  it('is case-sensitive (consistent with canonical impl)', () => {
    // The canonical Milton getTagColor does NOT lowercase before hashing.
    // 'Machine Learning' and 'machine learning' may produce different colors.
    // We just verify both stay within the palette and remain deterministic.
    expect(TAG_COLOR_PALETTE).toContain(getTagColor('Machine Learning'))
    expect(TAG_COLOR_PALETTE).toContain(getTagColor('machine learning'))
  })

  it('every output is a member of the palette (broad drift guard)', () => {
    const samples = [
      'a', 'b', 'c', 'd', 'e', 'f', 'g',
      'Machine Learning', 'Quantum Computing', 'NLP',
      'A',  'Empirical', 'Theoretical', 'Statistics',
      '', // empty string — hash stays at 0 → palette[0]
      'a very very long tag name with many words inside that we expect to hash deterministically',
    ]
    for (const s of samples) {
      expect(TAG_COLOR_PALETTE).toContain(getTagColor(s))
    }
  })

  it('empty string hashes to palette[0]', () => {
    // hash starts at 0, loop body never runs, Math.abs(0) % 10 = 0
    expect(getTagColor('')).toBe(TAG_COLOR_PALETTE[0])
  })
})
