// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub chrome.runtime BEFORE importing offscreen.ts so its top-level
// `chrome.runtime.onMessage.addListener` call hits our spy.

interface StoredListener {
  fn: (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => boolean | undefined | void
}

const runtimeListeners: StoredListener[] = []

beforeEach(() => {
  runtimeListeners.length = 0
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
