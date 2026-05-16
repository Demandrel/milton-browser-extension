// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroHttpError, zoteroHttpRequest } from './zotero-http'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(response: Response): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
}

describe('zoteroHttpRequest', () => {
  it('returns text response with status + responseURL', async () => {
    mockFetchOnce(
      new Response('hello body', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const result = await zoteroHttpRequest('GET', 'https://example.com/x')
    expect(result.status).toBe(200)
    expect(result.responseText).toBe('hello body')
    expect(result.responseHeaders).toContain('content-type: text/plain')
  })

  it('parses document responseType via DOMParser', async () => {
    mockFetchOnce(
      new Response('<html><body><h1>title</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const result = await zoteroHttpRequest('GET', 'https://example.com/x', { responseType: 'document' })
    const doc = result.response as Document
    expect(doc.querySelector('h1')?.textContent).toBe('title')
  })

  it('parses json responseType', async () => {
    mockFetchOnce(new Response('{"a":1}', { status: 200 }))
    const result = await zoteroHttpRequest('GET', 'https://example.com/x', { responseType: 'json' })
    expect(result.response).toEqual({ a: 1 })
  })

  it('throws ZoteroHttpError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network down'))
    await expect(zoteroHttpRequest('GET', 'https://example.com/x')).rejects.toBeInstanceOf(ZoteroHttpError)
  })

  it('throws on unsupported responseType', async () => {
    mockFetchOnce(new Response('', { status: 200 }))
    await expect(
      zoteroHttpRequest('GET', 'https://example.com/x', { responseType: 'arraybuffer' as never }),
    ).rejects.toBeInstanceOf(ZoteroHttpError)
  })
})
