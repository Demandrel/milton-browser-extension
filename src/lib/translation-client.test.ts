// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractMetadata } from './translation-client'
import * as authClient from './auth-client'
import type { MetadataResponse } from './types'

const fixturePrimary = {
  title: 'GPT-4 Technical Report',
  authors: [{ first: 'OpenAI', last: '' }],
  doi: '10.48550/arXiv.2303.08774',
  journal: '',
  year: 2023,
  issued_date: '2023-03-15',
  abstract: 'We report...',
  arxiv_id: '2303.08774',
  issn: '',
  volume: '',
  issue: '',
  pages: '',
}

const fixtureEnvelope: MetadataResponse = {
  source_tier: 'translator_registry',
  extracted_from: 'url',
  primary: fixturePrimary,
  candidates: [],
}

describe('extractMetadata', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.spyOn(authClient, 'fetchTranslationToken').mockResolvedValue({
      ok: true,
      token: 'header.payload.signature',
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns ok with primary on 200 success envelope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixtureEnvelope), { status: 200 }),
    )
    const result = await extractMetadata('https://arxiv.org/abs/2303.08774')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.primary).toEqual(fixturePrimary)
      expect(result.sourceTier).toBe('translator_registry')
    }
  })

  it('sends Authorization: Bearer header with the minted token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixtureEnvelope), { status: 200 }),
    )
    globalThis.fetch = fetchSpy
    await extractMetadata('https://arxiv.org/abs/x')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer header.payload.signature')
    expect(headers['Content-Type']).toBe('text/plain')
    expect(init.body).toBe('https://arxiv.org/abs/x')
  })

  it('hits /metadata, not /web (TS-14 endpoint migration)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixtureEnvelope), { status: 200 }),
    )
    globalThis.fetch = fetchSpy
    await extractMetadata('https://example.com')
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toMatch(/\/metadata$/)
    expect(calledUrl).not.toMatch(/\/web$/)
  })

  it('surfaces no-metadata when source_tier === "empty"', async () => {
    const emptyEnvelope: MetadataResponse = {
      source_tier: 'empty',
      extracted_from: 'url',
      primary: null,
      candidates: [],
    }
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(emptyEnvelope), { status: 200 }),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'no-metadata' },
    })
  })

  it('surfaces no-metadata when primary is null (defensive vs. source_tier mismatch)', async () => {
    const malformed = {
      source_tier: 'doi_resolved',
      extracted_from: 'url',
      primary: null,
      candidates: [],
    }
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(malformed), { status: 200 }),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'no-metadata' },
    })
  })

  it('propagates token-mint signed-out failure (via:token-mint)', async () => {
    vi.mocked(authClient.fetchTranslationToken).mockResolvedValue({
      ok: false,
      reason: 'signed-out',
    })
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'token-mint',
      error: { ok: false, reason: 'signed-out' },
    })
  })

  it('propagates token-mint rate-limited failure with retryAfter', async () => {
    vi.mocked(authClient.fetchTranslationToken).mockResolvedValue({
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: 30,
    })
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'token-mint',
      error: { ok: false, reason: 'rate-limited', retryAfterSeconds: 30 },
    })
  })

  it('retries ONCE on 401 expired and succeeds with fresh token', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unauthorized', reason: 'expired' }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixtureEnvelope), { status: 200 }),
      )
    const result = await extractMetadata('https://example.com')
    expect(result.ok).toBe(true)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    // Token mint was called TWICE (one per attempt, no caching).
    expect(authClient.fetchTranslationToken).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry more than once if second attempt also returns 401 expired', async () => {
    // Use mockImplementation so each call gets a fresh Response (body streams can only be read once).
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'unauthorized', reason: 'expired' }), {
            status: 401,
          }),
        ),
      )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'token-expired' },
    })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('does NOT retry on 401 token_invalid (signature failure won\'t fix on retry)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'unauthorized', reason: 'token_invalid' }),
          { status: 401 },
        ),
      )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'token-invalid' },
    })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('dispatches 401 device_not_registered to a distinct error kind', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'unauthorized', reason: 'device_not_registered' }),
        { status: 401 },
      ),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'device-not-registered' },
    })
  })

  it('parses 402 quota_exceeded with next_reset_seconds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'quota_exceeded',
          tier: 'free',
          limit: 350,
          window_days: 7,
          next_reset_seconds: 3600,
        }),
        { status: 402 },
      ),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: {
        kind: 'quota-exceeded',
        tier: 'free',
        limit: 350,
        windowDays: 7,
        nextResetSeconds: 3600,
      },
    })
  })

  it('parses 402 tier_required with required_tiers array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'tier_required',
          your_tier: 'free',
          required_tiers: ['monthly', 'yearly', 'lifetime'],
          upgrade_url: 'https://milton.so/upgrade',
        }),
        { status: 402 },
      ),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: {
        kind: 'tier-required',
        yourTier: 'free',
        requiredTiers: ['monthly', 'yearly', 'lifetime'],
        upgradeUrl: 'https://milton.so/upgrade',
      },
    })
  })

  it('parses 503 key_lookup_unavailable with Retry-After', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'service_unavailable',
          reason: 'key_lookup_unavailable',
        }),
        {
          status: 503,
          headers: { 'Retry-After': '30' },
        },
      ),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'key-lookup-unavailable', retryAfterSeconds: 30 },
    })
  })

  it('parses 503 service_unavailable (generic — no `reason` field)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'service_unavailable' }), { status: 503 }),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'service-unavailable' },
    })
  })

  it('returns 404 not_found on TS-14 endpoint mismatch (e.g. server reverted)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'not-found' },
    })
  })

  it('returns network-error when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'network-error', message: 'Failed to fetch' },
    })
  })

  it('returns rate-limited with Retry-After on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 429,
        headers: { 'Retry-After': '120' },
      }),
    )
    const result = await extractMetadata('https://example.com')
    expect(result).toMatchObject({
      ok: false,
      via: 'translate-server',
      error: { kind: 'rate-limited', retryAfterSeconds: 120 },
    })
  })
})
