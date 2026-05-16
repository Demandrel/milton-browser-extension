// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Zotero.Translate.ItemSaver adapter — replaces upstream's translation/
// translate_item.js item-persistence layer. Items are COLLECTED in memory
// (no actual Zotero library write); the caller retrieves them via
// getCollectedItems() after translation resolves.
//
// Also wires a translation timeout (default 10s; configurable) — protects
// against malformed translators that infinite-loop in the sandbox.

import type { ZoteroGlobal, ZoteroItem } from './zotero-types'

const DEFAULT_TRANSLATE_TIMEOUT_MS = 10_000

export class TranslatorTimeoutError extends Error {
  constructor(
    public readonly translatorId: string,
    public readonly elapsedMs: number,
  ) {
    super(`Translator ${translatorId} did not resolve within ${elapsedMs}ms`)
    this.name = 'TranslatorTimeoutError'
  }
}

class CollectingItemSaver {
  private readonly collected: ZoteroItem[] = []

  saveItems(items: ZoteroItem[], callback: (success: boolean, savedItems: ZoteroItem[]) => void): void {
    for (const item of items) {
      this.collected.push(item)
    }
    callback(true, items)
  }

  getCollectedItems(): ZoteroItem[] {
    return [...this.collected]
  }
}

/**
 * Wrap a `Zotero.Translate.Web.translate()` invocation in a timeout race;
 * reject with `TranslatorTimeoutError` if the translator hasn't resolved
 * by `timeoutMs`. Mirrors the upstream framework's translate() contract
 * (returns a Promise that resolves with the items the ItemSaver collected).
 */
export async function translateWithTimeout(
  translate: () => Promise<unknown>,
  translatorId: string,
  timeoutMs: number = DEFAULT_TRANSLATE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      translate(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TranslatorTimeoutError(translatorId, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Install our ItemSaver onto the framework-provided Zotero global. Returns
 * a factory: `newItemSaver()` constructs a fresh saver each translation so
 * collected items don't leak across requests.
 */
export function installZoteroItemSaver(zotero: ZoteroGlobal): () => CollectingItemSaver {
  const factory = (): CollectingItemSaver => new CollectingItemSaver()
  // Surface a default-instance constructor that upstream framework code
  // expects via `new Zotero.Translate.ItemSaver(...)`. Each `new` call
  // gives a fresh collector.
  if (zotero.Translate === undefined) {
    zotero.Translate = {} as ZoteroGlobal['Translate'] & object
  }
  ;(zotero.Translate as { ItemSaver?: unknown }).ItemSaver = function (this: CollectingItemSaver) {
    const saver = factory()
    this.saveItems = saver.saveItems.bind(saver)
    ;(this as unknown as { getCollectedItems?: () => ZoteroItem[] }).getCollectedItems =
      saver.getCollectedItems.bind(saver)
  } as unknown
  return factory
}
