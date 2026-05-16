// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTranslationToken } from './auth-client'

describe('fetchTranslationToken', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns ok with token on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'abc.def.ghi', expires_in: 30 }), {
        status: 200,
      }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({ ok: true, token: 'abc.def.ghi' })
  })

  it('returns signed-out on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Milton is not signed in' }), {
        status: 401,
      }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({ ok: false, reason: 'signed-out' })
  })

  it('returns origin-rejected on 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({ ok: false, reason: 'origin-rejected' })
  })

  it('returns rate-limited with parsed Retry-After on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too many token requests' }), {
        status: 429,
        headers: { 'Retry-After': '42' },
      }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({ ok: false, reason: 'rate-limited', retryAfterSeconds: 42 })
  })

  it('defaults rate-limited retry to 60s when Retry-After header missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too many' }), { status: 429 }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: 60,
    })
  })

  it('returns network-error when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await fetchTranslationToken()
    expect(result).toEqual({
      ok: false,
      reason: 'network-error',
      message: 'Failed to fetch',
    })
  })

  it('returns unexpected for non-OK success-ish status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 502 }),
    )
    const result = await fetchTranslationToken()
    expect(result).toEqual({
      ok: false,
      reason: 'unexpected',
      status: 502,
      message: 'Unexpected token-mint status 502',
    })
  })

  it('returns unexpected when 200 body is malformed JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('not-json-at-all', { status: 200 }),
    )
    const result = await fetchTranslationToken()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unexpected')
    }
  })

  it('returns unexpected when 200 body is missing token field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ expires_in: 30 }), { status: 200 }),
    )
    const result = await fetchTranslationToken()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unexpected')
    }
  })
})
