// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelClientTranslation,
  ensureOffscreenDocument,
  OffscreenClientError,
  requestClientTranslation,
} from './offscreen-client'

function installChromeStub(over: Partial<typeof chrome> = {}): {
  hasDoc: ReturnType<typeof vi.fn>
  createDoc: ReturnType<typeof vi.fn>
  sendMsg: ReturnType<typeof vi.fn>
} {
  const hasDoc = vi.fn().mockResolvedValue(false)
  const createDoc = vi.fn().mockResolvedValue(undefined)
  const sendMsg = vi.fn()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test-ext',
      sendMessage: sendMsg,
    },
    offscreen: {
      hasDocument: hasDoc,
      createDocument: createDoc,
      Reason: { IFRAME_SCRIPTING: 'IFRAME_SCRIPTING' },
    },
    ...over,
  }
  return { hasDoc, createDoc, sendMsg }
}

describe('ensureOffscreenDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  it('calls createDocument when no offscreen doc exists', async () => {
    const { hasDoc, createDoc } = installChromeStub()
    await ensureOffscreenDocument()
    expect(hasDoc).toHaveBeenCalled()
    expect(createDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'src/offscreen/offscreen.html',
        reasons: ['IFRAME_SCRIPTING'],
        justification: expect.stringMatching(/translator/i),
      }),
    )
  })

  it('is idempotent: does NOT call createDocument when one exists', async () => {
    const { hasDoc, createDoc } = installChromeStub()
    hasDoc.mockResolvedValue(true)
    await ensureOffscreenDocument()
    expect(createDoc).not.toHaveBeenCalled()
  })

  it('throws OFFSCREEN_UNAVAILABLE when chrome.offscreen is undefined', async () => {
    ;(globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'x' } }
    await expect(ensureOffscreenDocument()).rejects.toBeInstanceOf(OffscreenClientError)
  })
})

describe('requestClientTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  it('resolves with items on the happy path', async () => {
    const { sendMsg } = installChromeStub()
    sendMsg.mockResolvedValue({
      kind: 'milton-translate-response',
      requestId: 'rid',
      items: [{ itemType: 'journalArticle', title: 'X' }],
    })
    const items = await requestClientTranslation({
      url: 'https://x',
      html: '<html></html>',
      translatorId: 't',
      requestId: 'rid',
    })
    expect(items.length).toBe(1)
    expect(items[0].title).toBe('X')
  })

  it('rejects with typed code when offscreen returns error envelope', async () => {
    const { sendMsg } = installChromeStub()
    sendMsg.mockResolvedValue({
      kind: 'milton-translate-response',
      requestId: 'rid',
      error: { code: 'OFFSCREEN_BUSY', message: 'full' },
    })
    await expect(
      requestClientTranslation({ url: 'u', html: 'h', translatorId: 't', requestId: 'rid' }),
    ).rejects.toMatchObject({ code: 'OFFSCREEN_BUSY' })
  })

  it('rejects with NO_REPLY when sendMessage resolves with undefined', async () => {
    const { sendMsg } = installChromeStub()
    sendMsg.mockResolvedValue(undefined)
    await expect(
      requestClientTranslation({ url: 'u', html: 'h', translatorId: 't', requestId: 'rid' }),
    ).rejects.toMatchObject({ code: 'NO_REPLY' })
  })

  it('rejects with POPUP_TIMEOUT when sendMessage never resolves', async () => {
    const { sendMsg } = installChromeStub()
    // Never-resolving Promise simulates offscreen hung.
    sendMsg.mockReturnValue(new Promise(() => {}))
    await expect(
      requestClientTranslation({ url: 'u', html: 'h', translatorId: 't', requestId: 'rid', timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'POPUP_TIMEOUT' })
  })

  it('rejects with POPUP_ABORTED when signal aborts mid-flight', async () => {
    const { sendMsg } = installChromeStub()
    sendMsg.mockReturnValue(new Promise(() => {}))
    const ctrl = new AbortController()
    const p = requestClientTranslation({
      url: 'u',
      html: 'h',
      translatorId: 't',
      requestId: 'rid',
      timeoutMs: 60_000,
      signal: ctrl.signal,
    })
    queueMicrotask(() => ctrl.abort())
    await expect(p).rejects.toMatchObject({ code: 'POPUP_ABORTED' })
  })
})

describe('cancelClientTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  it('fires sendMessage with the cancel kind', () => {
    const { sendMsg } = installChromeStub()
    cancelClientTranslation('rid-to-cancel')
    expect(sendMsg).toHaveBeenCalledWith({ kind: 'milton-translate-cancel', requestId: 'rid-to-cancel' })
  })

  it('does not throw when chrome.runtime.sendMessage is missing', () => {
    ;(globalThis as unknown as { chrome: unknown }).chrome = {}
    expect(() => cancelClientTranslation('rid')).not.toThrow()
  })
})
