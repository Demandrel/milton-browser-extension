// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContextError, scrapeActiveTabHtml } from './page-context'

interface MockExecuteResult {
  result?: { html: string; finalUrl: string } | undefined
}

function installChromeStub(executeScript: ReturnType<typeof vi.fn>): void {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: { executeScript },
  }
}

describe('scrapeActiveTabHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  it('returns html + finalUrl on the happy path', async () => {
    const exec = vi.fn().mockResolvedValue([
      { result: { html: '<html><body>hi</body></html>', finalUrl: 'https://x.example/a' } },
    ] as MockExecuteResult[])
    installChromeStub(exec)

    const out = await scrapeActiveTabHtml(42, 'https://x.example/a')

    expect(out.html).toContain('<html>')
    expect(out.finalUrl).toBe('https://x.example/a')
    expect(exec).toHaveBeenCalledOnce()
    const args = exec.mock.calls[0][0]
    expect(args.target).toEqual({ tabId: 42 })
    expect(typeof args.func).toBe('function')
  })

  it('rejects restricted-URL schemes without calling chrome.scripting', async () => {
    const exec = vi.fn()
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'chrome://extensions/')).rejects.toMatchObject({
      name: 'PageContextError',
      code: 'RESTRICTED_URL',
    })
    expect(exec).not.toHaveBeenCalled()
  })

  it('classifies "No tab with id" errors as TAB_GONE', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('No tab with id: 99'))
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(99, 'https://x.example')).rejects.toMatchObject({
      code: 'TAB_GONE',
    })
  })

  it('classifies "Cannot access" leaks as RESTRICTED_URL', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('Cannot access a chrome:// URL'))
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'https://normal-looking-but-redirected')).rejects.toMatchObject({
      code: 'RESTRICTED_URL',
    })
  })

  it('classifies unknown failures as SCRIPTING_FAILED', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('weird internal chromium thing'))
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'https://x.example')).rejects.toMatchObject({
      code: 'SCRIPTING_FAILED',
    })
  })

  it('rejects NO_RESULT when executeScript returns no frames', async () => {
    const exec = vi.fn().mockResolvedValue([] as MockExecuteResult[])
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'https://x.example')).rejects.toMatchObject({
      code: 'NO_RESULT',
    })
  })

  it('rejects NO_RESULT when frame result is undefined', async () => {
    const exec = vi.fn().mockResolvedValue([{ result: undefined }] as MockExecuteResult[])
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'https://x.example')).rejects.toMatchObject({
      code: 'NO_RESULT',
    })
  })

  it('rejects HTML_TOO_LARGE for 3 MiB HTML', async () => {
    const huge = 'a'.repeat(3 * 1024 * 1024)
    const exec = vi.fn().mockResolvedValue([
      { result: { html: huge, finalUrl: 'https://x.example/a' } },
    ] as MockExecuteResult[])
    installChromeStub(exec)

    await expect(scrapeActiveTabHtml(1, 'https://x.example/a')).rejects.toMatchObject({
      code: 'HTML_TOO_LARGE',
    })
  })

  it('PageContextError preserves the typed code', () => {
    const err = new PageContextError('TAB_GONE', 'gone')
    expect(err.name).toBe('PageContextError')
    expect(err.code).toBe('TAB_GONE')
    expect(err.message).toMatch(/^\[TAB_GONE\]/)
  })
})
