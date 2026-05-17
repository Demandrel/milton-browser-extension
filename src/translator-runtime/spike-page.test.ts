// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

// Code-review follow-up (M4): spike-page.ts hosts a SPIKE-ONLY
// translator-load-request handler that the AC16 S2 smoke exercises end-to-end
// but no unit test covered. This file pins the postMessage round-trip:
//   - isFromExpectedSource gating (BE-8-4 H2 pattern; spoofed source rejected)
//   - happy path → reply carries translator
//   - fetcher returns null (UUID not in manifest) → reply carries NOT_IN_MANIFEST
//   - fetcher throws TranslatorFetcherError → reply carries typed code
//   - fetcher throws non-typed Error → reply carries UNKNOWN
//
// BE-8-6 will move this handler to popup/SW context; the test file can
// migrate with it.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslatorLoadRequest } from './host-bridge'
import type { TranslatorLoadResponse } from './zotero-types'

// Mock translator-fetcher BEFORE importing spike-page so the listener
// binds against the mocked function. Re-exported types are kept real so
// instanceof checks in the handler still work.
vi.mock('./translator-fetcher', async () => {
  return {
    fetchTranslatorFromCdn: vi.fn(),
    TranslatorFetcherError: class TranslatorFetcherError extends Error {
      readonly code: string
      constructor(code: string, message: string) {
        super(`[${code}] ${message}`)
        this.name = 'TranslatorFetcherError'
        this.code = code
      }
    },
  }
})

const FAKE_UUID = '22222222-3333-4444-5555-666666666666'

async function flushMicrotasks(): Promise<void> {
  // Two ticks: one for the message handler to run, one for its inner await chain.
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

let iframeContentWindow: Window
let postedReplies: unknown[] = []
let fetcher: typeof import('./translator-fetcher')

describe('spike-page translator-load-request handler (M4 follow-up)', () => {
  // Import spike-page exactly ONCE — its top-level addEventListener calls
  // would otherwise accumulate listeners across tests (jsdom's window is
  // shared across resetModules cycles). One install, then mock state is
  // reset per test.
  beforeAll(async () => {
    document.body.innerHTML = '<iframe id="sandbox"></iframe>'
    const iframe = document.getElementById('sandbox') as HTMLIFrameElement
    iframeContentWindow = iframe.contentWindow as Window
    Object.defineProperty(iframeContentWindow, 'postMessage', {
      configurable: true,
      writable: true,
      value: vi.fn((msg: unknown) => {
        postedReplies.push(msg)
      }),
    })

    // chrome.* stub for any incidental access. translator-fetcher itself is mocked.
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: { lastError: undefined },
    }

    fetcher = await import('./translator-fetcher')
    await import('./spike-page')
  })

  afterAll(() => {
    delete (globalThis as { chrome?: unknown }).chrome
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    postedReplies = []
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockReset()
    vi.mocked(iframeContentWindow.postMessage).mockClear()
  })

  it('replies with translator on successful fetcher resolution', async () => {
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockResolvedValueOnce({
      metadata: { translatorID: FAKE_UUID, label: 'Mock Publisher' },
      body: '/* mock translator source */',
    })

    const req = makeTranslatorLoadRequest({ requestId: 'r1', translatorId: FAKE_UUID })
    window.dispatchEvent(new MessageEvent('message', { data: req, source: iframeContentWindow }))
    await flushMicrotasks()

    expect(postedReplies.length).toBe(1)
    const reply = postedReplies[0] as TranslatorLoadResponse
    expect(reply.type).toBe('translator-load-response')
    expect(reply.requestId).toBe('r1')
    expect(reply.translator?.metadata.label).toBe('Mock Publisher')
    expect(reply.error).toBeUndefined()
  })

  it('replies with NOT_IN_MANIFEST when fetcher returns null', async () => {
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockResolvedValueOnce(null)

    const req = makeTranslatorLoadRequest({ requestId: 'r-null', translatorId: FAKE_UUID })
    window.dispatchEvent(new MessageEvent('message', { data: req, source: iframeContentWindow }))
    await flushMicrotasks()

    expect(postedReplies.length).toBe(1)
    const reply = postedReplies[0] as TranslatorLoadResponse
    expect(reply.error?.code).toBe('NOT_IN_MANIFEST')
    expect(reply.translator).toBeUndefined()
  })

  it('replies with the typed error code when fetcher throws TranslatorFetcherError', async () => {
    const { TranslatorFetcherError } = fetcher
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockRejectedValueOnce(
      new TranslatorFetcherError('HASH_MISMATCH', 'bytes differ from manifest sha256'),
    )

    const req = makeTranslatorLoadRequest({ requestId: 'r-hash', translatorId: FAKE_UUID })
    window.dispatchEvent(new MessageEvent('message', { data: req, source: iframeContentWindow }))
    await flushMicrotasks()

    expect(postedReplies.length).toBe(1)
    const reply = postedReplies[0] as TranslatorLoadResponse
    expect(reply.error?.code).toBe('HASH_MISMATCH')
    expect(reply.error?.message).toContain('bytes differ')
  })

  it('replies with UNKNOWN code when fetcher throws a non-typed Error', async () => {
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockRejectedValueOnce(new Error('unexpected'))

    const req = makeTranslatorLoadRequest({ requestId: 'r-other', translatorId: FAKE_UUID })
    window.dispatchEvent(new MessageEvent('message', { data: req, source: iframeContentWindow }))
    await flushMicrotasks()

    expect(postedReplies.length).toBe(1)
    const reply = postedReplies[0] as TranslatorLoadResponse
    expect(reply.error?.code).toBe('UNKNOWN')
  })

  it('IGNORES translator-load-request from a source that is NOT the sandbox iframe (BE-8-4 H2 gating)', async () => {
    vi.mocked(fetcher.fetchTranslatorFromCdn).mockResolvedValueOnce({
      metadata: { translatorID: FAKE_UUID, label: 'PWNED' },
      body: '/* attacker payload */',
    })
    // Hostile source: a different Window-like sentinel (not the iframe).
    const hostile = { postMessage: vi.fn() } as unknown as Window

    const req = makeTranslatorLoadRequest({ requestId: 'r-spoof', translatorId: FAKE_UUID })
    window.dispatchEvent(new MessageEvent('message', { data: req, source: hostile }))
    await flushMicrotasks()

    // Handler must have rejected the spoofed source: no reply posted, fetcher never invoked.
    expect(postedReplies.length).toBe(0)
    expect(vi.mocked(fetcher.fetchTranslatorFromCdn)).not.toHaveBeenCalled()
  })

  it('IGNORES non-translator-load-request messages on the same channel', async () => {
    const noise = {
      type: 'translate-request',
      protocolVersion: 2,
      requestId: 'noise',
      url: 'https://x',
      translatorId: FAKE_UUID,
    }
    window.dispatchEvent(new MessageEvent('message', { data: noise, source: iframeContentWindow }))
    await flushMicrotasks()
    const loadResponses = postedReplies.filter(
      (m) => typeof m === 'object' && m !== null && (m as { type?: string }).type === 'translator-load-response',
    )
    expect(loadResponses.length).toBe(0)
    expect(vi.mocked(fetcher.fetchTranslatorFromCdn)).not.toHaveBeenCalled()
  })
})
