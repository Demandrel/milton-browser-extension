// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// BE-8-6 code-review M2 fix: mock translator-fetcher so the
// translator-load-request handler tests don't try a real CDN fetch.
vi.mock('../translator-runtime/translator-fetcher', () => ({
  fetchTranslatorFromCdn: vi.fn(),
  TranslatorFetcherError: class extends Error {
    readonly code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

// Stub chrome.runtime BEFORE importing offscreen.ts so its top-level
// `chrome.runtime.onMessage.addListener` call hits our spy.

interface StoredListener {
  fn: (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => boolean | undefined | void
}

const runtimeListeners: StoredListener[] = []

// Track window message listeners added during a test so afterEach can
// remove them (each importOffscreen() re-adds two listeners; without
// cleanup they accumulate and cross-contaminate tests).
const trackedWindowListeners: { type: string; fn: EventListenerOrEventListenerObject }[] = []
const originalWindowAdd = window.addEventListener.bind(window)

beforeEach(() => {
  runtimeListeners.length = 0
  trackedWindowListeners.length = 0
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => {
    trackedWindowListeners.push({ type, fn })
    return originalWindowAdd(type, fn)
  }) as typeof window.addEventListener
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test-extension-id',
      onMessage: {
        addListener: vi.fn((fn) => {
          runtimeListeners.push({ fn })
        }),
      },
    },
  }
})

afterEach(() => {
  for (const { type, fn } of trackedWindowListeners) {
    window.removeEventListener(type, fn)
  }
  trackedWindowListeners.length = 0
  window.addEventListener = originalWindowAdd
  // Drop any sandbox iframes the test created (next test re-creates).
  document.querySelectorAll('#sandbox').forEach((el) => el.remove())
  delete (globalThis as unknown as { chrome?: unknown }).chrome
  vi.resetModules()
})

async function importOffscreen() {
  // sandbox iframe in jsdom — create a real iframe element so getSandboxWindow()
  // can return its contentWindow (jsdom gives iframes a real window).
  const iframe = document.createElement('iframe')
  iframe.id = 'sandbox'
  document.body.appendChild(iframe)
  // Importing offscreen.ts runs the bootstrap (registers chrome.runtime
  // listener + window message listeners + logs ready line).
  return await import('./offscreen')
}

describe('offscreen — chrome.runtime IPC', () => {
  it('registers a chrome.runtime.onMessage listener on import', async () => {
    await importOffscreen()
    expect(runtimeListeners.length).toBe(1)
  })

  it('rejects messages whose sender.id mismatches chrome.runtime.id', async () => {
    await importOffscreen()
    const listener = runtimeListeners[0].fn
    const sendResponse = vi.fn()
    const result = listener(
      { kind: 'milton-translate-request', requestId: 'r1', url: 'u', html: 'h', translatorId: 't' },
      { id: 'other-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    )
    expect(result).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('ignores non-milton runtime messages', async () => {
    await importOffscreen()
    const listener = runtimeListeners[0].fn
    const sendResponse = vi.fn()
    const result = listener(
      { kind: 'unrelated-stuff' },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    )
    expect(result).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('returns true (keep channel open) for milton-translate-request', async () => {
    const mod = await importOffscreen()
    const listener = runtimeListeners[0].fn
    const sendResponse = vi.fn()
    const result = listener(
      { kind: 'milton-translate-request', requestId: 'r1', url: 'u', html: 'h', translatorId: 't' },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    )
    expect(result).toBe(true)
    // Cleanup: drain queue so other tests start clean
    mod._offscreenInternals.resetForTests()
  })

  it('queues two simultaneous requests and serializes dispatch (one in-flight)', async () => {
    const mod = await importOffscreen()
    const listener = runtimeListeners[0].fn
    const sr1 = vi.fn()
    const sr2 = vi.fn()
    listener(
      { kind: 'milton-translate-request', requestId: 'r1', url: 'u', html: 'h', translatorId: 't' },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      sr1,
    )
    listener(
      { kind: 'milton-translate-request', requestId: 'r2', url: 'u', html: 'h', translatorId: 't' },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      sr2,
    )
    // Microtask: pumpQueue picked up r1; r2 is still queued. r1's
    // dispatchTranslation posts to sandbox + awaits a reply that never comes
    // in this test (no sandbox script attached) — so inFlight stays r1.
    await Promise.resolve()
    expect(mod._offscreenInternals.getInFlightRequestId()).toBe('r1')
    expect(mod._offscreenInternals.pendingQueue.length).toBe(1)
    expect(mod._offscreenInternals.pendingQueue[0].msg.requestId).toBe('r2')
    mod._offscreenInternals.resetForTests()
  })

  it('rejects with OFFSCREEN_BUSY when queue cap exceeded', async () => {
    const mod = await importOffscreen()
    const listener = runtimeListeners[0].fn
    const sendResponses: ReturnType<typeof vi.fn>[] = []
    // Fire 6 requests: r1 goes in-flight, r2..r5 fill the queue (cap 4),
    // r6 should immediately get OFFSCREEN_BUSY.
    for (let i = 1; i <= 6; i++) {
      const sr = vi.fn()
      sendResponses.push(sr)
      listener(
        { kind: 'milton-translate-request', requestId: `r${i}`, url: 'u', html: 'h', translatorId: 't' },
        { id: 'test-extension-id' } as chrome.runtime.MessageSender,
        sr,
      )
    }
    await Promise.resolve()
    expect(sendResponses[5]).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'milton-translate-response',
        requestId: 'r6',
        error: expect.objectContaining({ code: 'OFFSCREEN_BUSY' }),
      }),
    )
    mod._offscreenInternals.resetForTests()
  })

  it('records cancel requestIds in the cancelled set', async () => {
    const mod = await importOffscreen()
    const listener = runtimeListeners[0].fn
    listener(
      { kind: 'milton-translate-cancel', requestId: 'rc' },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      vi.fn(),
    )
    expect(mod._offscreenInternals.cancelledRequestIds.has('rc')).toBe(true)
    mod._offscreenInternals.resetForTests()
  })
})

// ── BE-8-6 code-review M2 fix: tests for fetch-proxy + translator-load ────
// Both handlers were lifted from spike-page.ts as production code; the
// original lift had no tests in offscreen.test.ts. These tests prove the
// sandbox→offscreen postMessage round-trip works on both message kinds.

describe('offscreen — fetch-proxy handler (window.message)', () => {
  it('handles fetch-request: fetches URL + replies with fetch-response', async () => {
    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    // Mock fetch on the offscreen-side window (jsdom).
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response('payload-body', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock
    // Spy on the sandbox window's postMessage so we can capture the reply.
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    // Dispatch a fetch-request MessageEvent whose source is the sandbox iframe.
    const event = new MessageEvent('message', {
      data: {
        type: 'fetch-request',
        protocolVersion: 2,
        requestId: 'fp1',
        url: 'https://example.com/x',
        method: 'GET',
      },
      source: sandboxWin,
    })
    window.dispatchEvent(event)

    // Let microtasks settle so fetch + postMessage complete.
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/x',
      expect.objectContaining({ method: 'GET', credentials: 'omit' }),
    )
    expect(replySpy).toHaveBeenCalled()
    const reply = replySpy.mock.calls[0][0]
    expect(reply).toMatchObject({
      type: 'fetch-response',
      protocolVersion: 2,
      requestId: 'fp1',
      response: expect.objectContaining({ status: 200, responseText: 'payload-body' }),
    })
  })

  it('replies with FETCH_FAILED when fetch throws', async () => {
    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    const event = new MessageEvent('message', {
      data: {
        type: 'fetch-request',
        protocolVersion: 2,
        requestId: 'fp2',
        url: 'https://example.com/y',
        method: 'GET',
      },
      source: sandboxWin,
    })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))

    expect(replySpy).toHaveBeenCalled()
    const reply = replySpy.mock.calls[0][0]
    expect(reply).toMatchObject({
      type: 'fetch-response',
      requestId: 'fp2',
      error: expect.objectContaining({ code: 'FETCH_FAILED' }),
    })
  })

  it('ignores fetch-request not from the sandbox iframe (isFromExpectedSource gate)', async () => {
    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    const fetchMock = vi.fn()
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    // source is NOT the sandbox window → gate must reject.
    const event = new MessageEvent('message', {
      data: {
        type: 'fetch-request',
        protocolVersion: 2,
        requestId: 'fp3',
        url: 'https://example.com/z',
        method: 'GET',
      },
      source: window, // not the sandbox iframe's contentWindow
    })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(replySpy).not.toHaveBeenCalled()
  })
})

describe('offscreen — translator-load-request handler (window.message)', () => {
  it('handles translator-load-request: returns verified translator', async () => {
    const fetcherMod = await import('../translator-runtime/translator-fetcher')
    const mockFetch = vi.mocked(fetcherMod.fetchTranslatorFromCdn)
    mockFetch.mockResolvedValueOnce({
      metadata: { translatorID: 'abc-123', label: 'Test Translator' },
      source: 'function detectWeb() {}',
    } as never)

    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    const event = new MessageEvent('message', {
      data: {
        type: 'translator-load-request',
        protocolVersion: 2,
        requestId: 'tl1',
        translatorId: 'abc-123',
      },
      source: sandboxWin,
    })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))

    expect(mockFetch).toHaveBeenCalledWith('abc-123')
    expect(replySpy).toHaveBeenCalled()
    const reply = replySpy.mock.calls[0][0]
    expect(reply).toMatchObject({
      type: 'translator-load-response',
      protocolVersion: 2,
      requestId: 'tl1',
      translator: expect.objectContaining({ source: 'function detectWeb() {}' }),
    })
  })

  it('replies with NOT_IN_MANIFEST when CDN returns null', async () => {
    const fetcherMod = await import('../translator-runtime/translator-fetcher')
    const mockFetch = vi.mocked(fetcherMod.fetchTranslatorFromCdn)
    mockFetch.mockResolvedValueOnce(null as never)

    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    const event = new MessageEvent('message', {
      data: {
        type: 'translator-load-request',
        protocolVersion: 2,
        requestId: 'tl2',
        translatorId: 'missing',
      },
      source: sandboxWin,
    })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))

    expect(replySpy).toHaveBeenCalled()
    const reply = replySpy.mock.calls[0][0]
    expect(reply).toMatchObject({
      type: 'translator-load-response',
      requestId: 'tl2',
      error: expect.objectContaining({ code: 'NOT_IN_MANIFEST' }),
    })
  })

  it('replies with TranslatorFetcherError code when fetcher throws', async () => {
    const fetcherMod = await import('../translator-runtime/translator-fetcher')
    const mockFetch = vi.mocked(fetcherMod.fetchTranslatorFromCdn)
    mockFetch.mockRejectedValueOnce(
      new fetcherMod.TranslatorFetcherError('SIGNATURE_INVALID', 'bad sig'),
    )

    await importOffscreen()
    const sandboxIframe = document.getElementById('sandbox') as HTMLIFrameElement
    const sandboxWin = sandboxIframe.contentWindow as Window
    const replySpy = vi.spyOn(sandboxWin, 'postMessage').mockImplementation(() => undefined)

    const event = new MessageEvent('message', {
      data: {
        type: 'translator-load-request',
        protocolVersion: 2,
        requestId: 'tl3',
        translatorId: 'bad',
      },
      source: sandboxWin,
    })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))

    expect(replySpy).toHaveBeenCalled()
    const reply = replySpy.mock.calls[0][0]
    expect(reply).toMatchObject({
      type: 'translator-load-response',
      requestId: 'tl3',
      error: expect.objectContaining({ code: 'SIGNATURE_INVALID' }),
    })
  })
})
