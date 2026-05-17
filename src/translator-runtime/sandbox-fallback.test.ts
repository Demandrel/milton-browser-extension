// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslatorLoadResponse } from './host-bridge'
import {
  loadTranslatorFromParent,
  TranslatorLoadTimeoutError,
  TranslatorUnavailableError,
} from './sandbox-fallback'
import type { BundledTranslator } from './zotero-types'

const FAKE_UUID = '11111111-2222-3333-4444-555555555555'

/**
 * Build a fake "parent" window with a postMessage spy. The spy captures
 * what the sandbox sends; the test then dispatches a synthetic
 * MessageEvent back into the listenerHost to simulate the parent reply.
 */
function makeFakeParent(): { parent: Window; lastPostedMessage: () => unknown } {
  let lastMessage: unknown = null
  const parent = {
    postMessage: vi.fn((msg: unknown) => {
      lastMessage = msg
    }),
  } as unknown as Window
  return { parent, lastPostedMessage: () => lastMessage }
}

function dispatchReplyFrom(source: Window, reply: unknown, host: Window = window): void {
  // jsdom's MessageEvent constructor accepts `source` directly in init.
  const ev = new MessageEvent('message', { data: reply, source })
  host.dispatchEvent(ev)
}

describe('loadTranslatorFromParent (AC9)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the translator when parent replies with a translator-load-response carrying translator', async () => {
    const { parent, lastPostedMessage } = makeFakeParent()
    const expected: BundledTranslator = {
      metadata: { translatorID: FAKE_UUID, label: 'Test Pub' },
      body: '/* source */',
    }
    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 1000,
    })

    // The request should have been posted; extract requestId and craft the reply.
    const posted = lastPostedMessage() as { requestId: string; translatorId: string; type: string }
    expect(posted.type).toBe('translator-load-request')
    expect(posted.translatorId).toBe(FAKE_UUID)
    const reply = makeTranslatorLoadResponse({ requestId: posted.requestId, translator: expected })
    dispatchReplyFrom(parent, reply)

    await expect(promise).resolves.toEqual(expected)
  })

  it('rejects with TranslatorUnavailableError when parent replies with an error envelope', async () => {
    const { parent, lastPostedMessage } = makeFakeParent()
    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 1000,
    })
    const posted = lastPostedMessage() as { requestId: string }
    const reply = makeTranslatorLoadResponse({
      requestId: posted.requestId,
      error: { code: 'NOT_IN_MANIFEST', message: 'translator not in mirror manifest' },
    })
    dispatchReplyFrom(parent, reply)

    await expect(promise).rejects.toBeInstanceOf(TranslatorUnavailableError)
    await expect(promise).rejects.toMatchObject({
      translatorId: FAKE_UUID,
      upstreamCode: 'NOT_IN_MANIFEST',
    })
  })

  it('rejects with TranslatorLoadTimeoutError when no reply arrives within timeout', async () => {
    const { parent } = makeFakeParent()
    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 500,
    })

    // Suppress the unhandled-rejection warning while we advance timers and
    // await the rejection. (vitest warns even though we catch it below.)
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)

    await expect(promise).rejects.toBeInstanceOf(TranslatorLoadTimeoutError)
    await expect(promise).rejects.toMatchObject({ translatorId: FAKE_UUID })
  })

  it('ignores replies from a window other than postTarget (source validation)', async () => {
    const { parent, lastPostedMessage } = makeFakeParent()
    const otherWindow = {} as Window // hostile / unrelated window

    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 500,
    })
    promise.catch(() => undefined)
    const posted = lastPostedMessage() as { requestId: string }
    // Hostile reply with the right requestId BUT wrong source — must be ignored.
    const hostile = makeTranslatorLoadResponse({
      requestId: posted.requestId,
      translator: { metadata: { translatorID: 'ATTACKER', label: 'PWNED' }, body: '/* evil */' },
    })
    dispatchReplyFrom(otherWindow, hostile)
    // Timer hasn't fired yet → still pending. Advance to timeout to confirm
    // the hostile reply was ignored (would've resolved otherwise).
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).rejects.toBeInstanceOf(TranslatorLoadTimeoutError)
  })

  it('ignores replies whose requestId does not match', async () => {
    const { parent } = makeFakeParent()

    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 500,
    })
    promise.catch(() => undefined)
    // Reply from the right source but with a different requestId — must be ignored.
    const bogus = makeTranslatorLoadResponse({
      requestId: 'NOT_MATCHING',
      translator: { metadata: { translatorID: 'x', label: 'x' }, body: '' },
    })
    dispatchReplyFrom(parent, bogus)
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).rejects.toBeInstanceOf(TranslatorLoadTimeoutError)
  })

  it('ignores non-translator-load-response messages on the same channel', async () => {
    const { parent } = makeFakeParent()

    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 500,
    })
    promise.catch(() => undefined)
    // Foreign message (a translate-response stamped with a v2 protocolVersion)
    // — must be ignored.
    dispatchReplyFrom(parent, {
      type: 'translate-response',
      protocolVersion: 2,
      requestId: 'any',
      items: [],
    })
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).rejects.toBeInstanceOf(TranslatorLoadTimeoutError)
  })

  it('rejects when parent reply has neither translator nor error envelope (malformed)', async () => {
    const { parent, lastPostedMessage } = makeFakeParent()
    const promise = loadTranslatorFromParent({
      postTarget: parent,
      listenerHost: window,
      translatorId: FAKE_UUID,
      timeoutMs: 1000,
    })
    const posted = lastPostedMessage() as { requestId: string }
    dispatchReplyFrom(parent, makeTranslatorLoadResponse({ requestId: posted.requestId }))

    await expect(promise).rejects.toThrow(/neither translator nor error/)
  })
})
