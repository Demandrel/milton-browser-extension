// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPdfBytesInTab, PdfFetchInTabError } from './pdf-fetch-in-tab'

// We mock at the chrome.scripting.executeScript boundary (the inner function
// runs in a content-script context tests can't reach). The mock returns the
// structured-clone-shaped result the inner function would produce in real
// usage. This means BT7's "buf = null before return" defensive clears
// happen in production but are not directly observable from tests — we
// instead assert the typed-error mapping that the outer wrapper produces.

type InjectionResultShape = {
  result?:
    | { ok: true; bytes: ArrayBuffer; finalUrl: string }
    | { ok: false; code: 'HTTP_ERROR'; status: number }
    | { ok: false; code: 'NOT_PDF'; firstBytes: string }
    | { ok: false; code: 'TOO_LARGE'; size: number }
    | { ok: false; code: 'NETWORK_ERROR'; message: string }
    | undefined
}

function installChromeStub(executeScript: ReturnType<typeof vi.fn>): void {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: { executeScript },
  }
}

function pdfBytes(byteCount: number): ArrayBuffer {
  // First 5 bytes = %PDF- (0x25, 0x50, 0x44, 0x46, 0x2d), rest is zeros.
  const u8 = new Uint8Array(byteCount)
  u8[0] = 0x25
  u8[1] = 0x50
  u8[2] = 0x44
  u8[3] = 0x46
  u8[4] = 0x2d
  return u8.buffer
}

describe('fetchPdfBytesInTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
    vi.useRealTimers()
  })

  it('returns bytes + finalUrl on the happy path', async () => {
    const buf = pdfBytes(4 * 1024) // 4 KiB pseudo-PDF
    const exec = vi.fn().mockResolvedValue([
      { result: { ok: true, bytes: buf, finalUrl: 'https://x.example/paper.pdf' } },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    const out = await fetchPdfBytesInTab(42, 'https://x.example/paper.pdf')

    expect(out.bytes.byteLength).toBe(4 * 1024)
    expect(out.finalUrl).toBe('https://x.example/paper.pdf')
    expect(exec).toHaveBeenCalledOnce()
    const call = exec.mock.calls[0][0]
    expect(call.target).toEqual({ tabId: 42 })
    expect(call.args[0]).toBe('https://x.example/paper.pdf')
    // args[1] is MAX_PDF_BYTES — 50 MiB
    expect(call.args[1]).toBe(50 * 1024 * 1024)
    expect(typeof call.func).toBe('function')
  })

  it('rejects RESTRICTED_URL without calling chrome.scripting', async () => {
    const exec = vi.fn()
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'chrome://settings/'),
    ).rejects.toMatchObject({ name: 'PdfFetchInTabError', code: 'RESTRICTED_URL' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('classifies "No tab with id" rejections as TAB_GONE', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('No tab with id: 99'))
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(99, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'TAB_GONE' })
  })

  it('classifies "Cannot access" leaks as RESTRICTED_URL', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('Cannot access a chrome:// URL'))
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://redirected.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'RESTRICTED_URL' })
  })

  it('classifies unknown rejections as SCRIPTING_FAILED', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('weird internal chromium thing'))
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'SCRIPTING_FAILED' })
  })

  it('translates inner HTTP_ERROR into a typed PdfFetchInTabError with httpStatus', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: { ok: false, code: 'HTTP_ERROR', status: 403 } },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    const err = await fetchPdfBytesInTab(1, 'https://x.example/paper.pdf').catch((e) => e)
    expect(err).toBeInstanceOf(PdfFetchInTabError)
    expect(err.code).toBe('HTTP_ERROR')
    expect(err.httpStatus).toBe(403)
  })

  it('translates inner NOT_PDF into a typed PdfFetchInTabError', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: { ok: false, code: 'NOT_PDF', firstBytes: '3c21444f' } },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'NOT_PDF' })
  })

  it('translates inner TOO_LARGE into a typed PdfFetchInTabError', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: { ok: false, code: 'TOO_LARGE', size: 60 * 1024 * 1024 } },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('translates inner NETWORK_ERROR into a typed PdfFetchInTabError', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: { ok: false, code: 'NETWORK_ERROR', message: 'Failed to fetch' } },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('rejects NO_RESULT when executeScript returns an empty array', async () => {
    const exec = vi.fn().mockResolvedValue([] as InjectionResultShape[])
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'NO_RESULT' })
  })

  it('rejects NO_RESULT when the frame result is undefined', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: undefined },
    ] as InjectionResultShape[])
    installChromeStub(exec)

    await expect(
      fetchPdfBytesInTab(1, 'https://x.example/paper.pdf'),
    ).rejects.toMatchObject({ code: 'NO_RESULT' })
  })

  it('fires TIMEOUT when executeScript stalls past opts.timeoutMs', async () => {
    // executeScript never resolves; timeout wins. We give a tiny timeout
    // (10 ms) and a never-resolving Promise to make the test fast.
    const exec = vi.fn().mockImplementation(() => new Promise(() => {}))
    installChromeStub(exec)

    const err = await fetchPdfBytesInTab(1, 'https://x.example/paper.pdf', {
      timeoutMs: 10,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PdfFetchInTabError)
    expect(err.code).toBe('TIMEOUT')
  })

  it('PdfFetchInTabError preserves typed code + httpStatus when supplied', () => {
    const e1 = new PdfFetchInTabError('TAB_GONE', 'gone')
    expect(e1.name).toBe('PdfFetchInTabError')
    expect(e1.code).toBe('TAB_GONE')
    expect(e1.httpStatus).toBeUndefined()
    expect(e1.message).toMatch(/^\[TAB_GONE\]/)

    const e2 = new PdfFetchInTabError('HTTP_ERROR', 'forbidden', 403)
    expect(e2.code).toBe('HTTP_ERROR')
    expect(e2.httpStatus).toBe(403)
  })
})
