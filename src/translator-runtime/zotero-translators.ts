// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Zotero.Translators adapter — replaces upstream framework's translators.js
// repository abstraction with an in-memory registry populated at build time
// (BE-8-4) and lazily at runtime (BE-8-5+ CDN long-tail).
//
// Translators are looked up by ID (Zotero.Translators.get) or by URL via
// `target` regex matching (Zotero.Translators.getWebTranslators).

import type { BundledTranslator, ZoteroGlobal } from './zotero-types'

interface RegisteredTranslator {
  metadata: BundledTranslator['metadata']
  body: string
  targetRe: RegExp | null
}

const registry = new Map<string, RegisteredTranslator>()

function compileTarget(target: string | undefined): RegExp | null {
  if (target === undefined || target.length === 0) return null
  try {
    return new RegExp(target)
  } catch {
    return null
  }
}

export function registerTranslator(t: BundledTranslator): void {
  registry.set(t.metadata.translatorID, {
    metadata: t.metadata,
    body: t.body,
    targetRe: compileTarget(t.metadata.target),
  })
}

export function clearRegistry(): void {
  registry.clear()
}

export function getRegisteredTranslator(translatorID: string): RegisteredTranslator | null {
  return registry.get(translatorID) ?? null
}

export function findWebTranslators(url: string): RegisteredTranslator[] {
  const matches: RegisteredTranslator[] = []
  for (const t of registry.values()) {
    if (t.targetRe !== null && t.targetRe.test(url)) {
      matches.push(t)
    }
  }
  return matches.sort((a, b) => (a.metadata.priority ?? 100) - (b.metadata.priority ?? 100))
}

/**
 * Install our Zotero.Translators registry onto the framework-provided Zotero
 * global. Replaces upstream's `Zotero.Translators` which expects a SQLite/
 * IndexedDB backing store we don't provide.
 */
export function installZoteroTranslators(zotero: ZoteroGlobal): void {
  zotero.Translators = {
    get: (translatorID: string) => {
      const t = getRegisteredTranslator(translatorID)
      return t === null ? null : { ...t.metadata, code: t.body }
    },
    getWebTranslators: async (url: string) => {
      const matches = findWebTranslators(url)
      const translators = matches.map((t) => ({ ...t.metadata, code: t.body }))
      // Upstream signature returns [translators, functions]; we have no
      // function-style translators yet, so second array is always empty.
      return [translators, []]
    },
  }
}
