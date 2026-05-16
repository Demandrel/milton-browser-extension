// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import {
  installZoteroItemSaver,
  TranslatorTimeoutError,
  translateWithTimeout,
} from './zotero-translate'
import type { ZoteroGlobal } from './zotero-types'

describe('translateWithTimeout', () => {
  it('resolves when translation completes within timeout', async () => {
    await expect(translateWithTimeout(() => Promise.resolve(), 'x', 100)).resolves.toBeUndefined()
  })

  it('rejects with TranslatorTimeoutError if translate hangs past timeout', async () => {
    await expect(
      translateWithTimeout(() => new Promise(() => undefined), 'arxiv-id', 30),
    ).rejects.toBeInstanceOf(TranslatorTimeoutError)
  })

  it('preserves translator id in timeout error', async () => {
    try {
      await translateWithTimeout(() => new Promise(() => undefined), 'arxiv-id', 20)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TranslatorTimeoutError)
      expect((err as TranslatorTimeoutError).translatorId).toBe('arxiv-id')
    }
  })
})

describe('installZoteroItemSaver', () => {
  it('installs Zotero.Translate.ItemSaver as a constructible factory', () => {
    const z: ZoteroGlobal = {}
    installZoteroItemSaver(z)
    expect(z.Translate?.ItemSaver).toBeDefined()
  })

  it('collected items are retrievable via getCollectedItems() + itemsDoneCallback fires', async () => {
    const z: ZoteroGlobal = {}
    installZoteroItemSaver(z)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (z.Translate as any).ItemSaver
    const inst = new Ctor()
    let doneItems: unknown = null
    const result = await inst.saveItems(
      [{ itemType: 'journalArticle', title: 'hello' }],
      undefined, // attachmentCallback unused
      (newItems: unknown) => {
        doneItems = newItems
      },
    )
    expect(result).toEqual([{ itemType: 'journalArticle', title: 'hello' }])
    expect(doneItems).toEqual([{ itemType: 'journalArticle', title: 'hello' }])
    expect(inst.getCollectedItems()).toEqual([{ itemType: 'journalArticle', title: 'hello' }])
  })
})
