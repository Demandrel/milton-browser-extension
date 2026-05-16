// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Deterministic tag color palette — COPIED from Milton's frontend.
//
// Canonical source: milton/src/lib/features/projects/utils/tag-colors.ts
// Last sync: 2026-05-14 (BE-2 Story creation)
//
// The browser-extension build is self-contained (no imports from Milton's
// pnpm workspace), so this function is replicated rather than imported.
// If the canonical impl changes, update this file AND the drift-guard
// test (`tag-colors.test.ts`) at the same time.
//
// Tags have NO user-supplied color (memory rule + protocol doc enforcement).
// This deterministic hash assigns a stable display color from a fixed
// 10-color Figma-verified palette; colors are NEVER stored, NEVER sent to
// the server, NEVER round-tripped.

export const TAG_COLOR_PALETTE = [
  '#8698f3', // [0] blue-purple (Figma: Overconfidence)
  '#10b981', // [1] emerald (Figma: Empirical)
  '#ccb797', // [2] tan (Figma: Theoretical)
  '#b1b1b1', // [3] gray (Figma: Information cascades)
  '#f59e0b', // [4] amber
  '#8b5cf6', // [5] violet
  '#06b6d4', // [6] cyan
  '#ef4444', // [7] red
  '#ec4899', // [8] pink
  '#14b8a6', // [9] teal
] as const

export type TagColor = (typeof TAG_COLOR_PALETTE)[number]

/**
 * Return a deterministic color for a tag name.
 * Same name always produces the same color (no PRNG, no time-based).
 */
export function getTagColor(tagName: string): TagColor {
  let hash = 0
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length]
}
