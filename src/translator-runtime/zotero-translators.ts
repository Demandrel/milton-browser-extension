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
 *
 * The framework's `_translatorProvider` defaults to `Zotero.Translators` and
 * calls these methods during translation:
 *   - get(id)                                  — translator-by-id lookup
 *   - getWebTranslators(url)                   — match by `target` regex
 *   - getWebTranslatorsForLocation(loc, root)  — location-based variant
 *   - getCodeForTranslator(translator)         — lazy-load JS body
 *   - getAllForType(type)                      — registry enumeration
 *
 * We populate `code` eagerly inside `get` / `getWebTranslators` so the
 * `getCodeForTranslator` lazy-load is a no-op for already-resolved
 * translators (returns the embedded code).
 */
export function installZoteroTranslators(zotero: ZoteroGlobal): void {
  const buildResolvedTranslator = (t: RegisteredTranslator): Record<string, unknown> => ({
    ...t.metadata,
    code: t.body,
    // Framework checks translator.runMode in Translate.Web._translateTranslatorLoaded
    // to decide between in-browser execution vs RPC to Zotero Standalone /
    // Server. We always run in-browser (1 = RUN_MODE_IN_BROWSER per
    // vendor/zotero-translate/src/translator.js); without this the branch
    // falls through and translation silently never starts.
    runMode: 1,
  })

  const provider = {
    get: (translatorID: string) => {
      const t = getRegisteredTranslator(translatorID)
      return t === null ? null : buildResolvedTranslator(t)
    },
    getWebTranslators: async (url: string) => {
      const matches = findWebTranslators(url)
      return [matches.map(buildResolvedTranslator), []]
    },
    getWebTranslatorsForLocation: async (location: unknown, _rootLocation?: unknown) => {
      const url =
        typeof location === 'string'
          ? location
          : (location as { href?: string } | null)?.href ?? ''
      const matches = findWebTranslators(url)
      return [matches.map(buildResolvedTranslator), []]
    },
    getCodeForTranslator: async (translator: unknown) => {
      // Framework calls this with either the full translator object (with
      // `.code` populated by our `get`) or a sparse `{translatorID}` stub.
      const t = translator as { code?: string; translatorID?: string }
      if (typeof t.code === 'string' && t.code.length > 0) return t.code
      if (typeof t.translatorID === 'string') {
        const reg = getRegisteredTranslator(t.translatorID)
        if (reg !== null) return reg.body
      }
      throw new Error('getCodeForTranslator: translator not registered')
    },
    getAllForType: async (_type: unknown) => {
      // BE-8-4 spike calls setTranslator directly; framework's getAllForType
      // path isn't exercised. BE-8-5 will implement proper type filtering
      // when the curated bundle lands.
      return []
    },
  }
  zotero.Translators = provider as unknown as ZoteroGlobal['Translators']
}
