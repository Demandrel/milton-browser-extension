// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import {
  ARXIV_TRANSLATOR_ID,
  generateRequestId,
  isFetchProxyRequest,
  isFetchProxyResponse,
  isFromExpectedSource,
  isTranslateRequest,
  isTranslateResponse,
  makeTranslateRequest,
  makeTranslateResponse,
  PROTOCOL_VERSION,
} from './host-bridge'

describe('host-bridge protocol guards', () => {
  it('makeTranslateRequest produces a valid translate-request', () => {
    const req = makeTranslateRequest({ requestId: 'r1', url: 'https://x', translatorId: 'tid' })
    expect(isTranslateRequest(req)).toBe(true)
    expect(req.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('makeTranslateResponse produces a valid translate-response', () => {
    const resp = makeTranslateResponse({ requestId: 'r1', items: [] })
    expect(isTranslateResponse(resp)).toBe(true)
  })

  it('isTranslateRequest rejects wrong type', () => {
    expect(isTranslateRequest({ type: 'fetch-request', protocolVersion: 1, requestId: 'r1' })).toBe(false)
    expect(isTranslateRequest(null)).toBe(false)
    expect(isTranslateRequest({})).toBe(false)
  })

  it('isTranslateRequest rejects mismatched protocolVersion', () => {
    expect(isTranslateRequest({ type: 'translate-request', protocolVersion: 99, requestId: 'r1' })).toBe(false)
  })

  it('fetch-proxy guards work for both directions', () => {
    expect(
      isFetchProxyRequest({
        type: 'fetch-request',
        protocolVersion: 1,
        requestId: 'x',
        method: 'GET',
        url: 'https://y',
      }),
    ).toBe(true)
    expect(
      isFetchProxyResponse({
        type: 'fetch-response',
        protocolVersion: 1,
        requestId: 'x',
      }),
    ).toBe(true)
  })

  it('generateRequestId returns a non-empty unique-ish id each call', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })

  it('exports ARXIV_TRANSLATOR_ID matching the vendored arXiv translator metadata', () => {
    expect(ARXIV_TRANSLATOR_ID).toBe('ecddda2e-4fc6-4aea-9f17-ef3b56d7377a')
  })
})

describe('isFromExpectedSource', () => {
  // Build a minimal MessageEvent-like with a specific source. Real Window
  // references aren't available in `vitest environment: node`, so we use
  // sentinel objects cast to Window — identity comparison is what we test.
  function ev(source: unknown): MessageEvent {
    return { source } as unknown as MessageEvent
  }
  const A = {} as Window
  const B = {} as Window

  it('accepts when source matches one of the allowed windows', () => {
    expect(isFromExpectedSource(ev(A), [A])).toBe(true)
    expect(isFromExpectedSource(ev(A), [B, A])).toBe(true)
  })

  it('rejects when source does not match any allowed window', () => {
    expect(isFromExpectedSource(ev(A), [B])).toBe(false)
    expect(isFromExpectedSource(ev({}), [A, B])).toBe(false)
  })

  it('rejects null source', () => {
    expect(isFromExpectedSource(ev(null), [A])).toBe(false)
  })

  it('rejects when no expected sources are provided (defensive default)', () => {
    expect(isFromExpectedSource(ev(A), [])).toBe(false)
  })

  it('skips null entries in the expected list (e.g., iframe not yet mounted)', () => {
    expect(isFromExpectedSource(ev(A), [null, A])).toBe(true)
    expect(isFromExpectedSource(ev(A), [null])).toBe(false)
  })
})

describe('translate-request round-trip (AC7 — postMessage protocol)', () => {
  // Simulate the round-trip without a real Window: serialize request, decode
  // on the other end with type guards, build response, serialize back. This
  // catches protocol drift (field renames, version bumps) the existing
  // per-helper tests miss.
  it('translate-request survives JSON round-trip and is recognized by the guard', () => {
    const req = makeTranslateRequest({
      requestId: 'rt-1',
      url: 'https://arxiv.org/abs/2303.08774',
      translatorId: ARXIV_TRANSLATOR_ID,
      html: '<html></html>',
      timeoutMs: 5000,
    })
    const serialized = JSON.parse(JSON.stringify(req))
    expect(isTranslateRequest(serialized)).toBe(true)
    expect(serialized.requestId).toBe('rt-1')
    expect(serialized.translatorId).toBe(ARXIV_TRANSLATOR_ID)
    expect(serialized.timeoutMs).toBe(5000)
  })

  it('translate-response (success) preserves items + requestId', () => {
    const resp = makeTranslateResponse({
      requestId: 'rt-1',
      items: [{ itemType: 'preprint', title: 'GPT-4 Technical Report' }],
    })
    const serialized = JSON.parse(JSON.stringify(resp))
    expect(isTranslateResponse(serialized)).toBe(true)
    expect(serialized.items).toHaveLength(1)
    expect(serialized.items?.[0].title).toBe('GPT-4 Technical Report')
  })

  it('translate-response (error) preserves error envelope', () => {
    const resp = makeTranslateResponse({
      requestId: 'rt-2',
      error: { code: 'TIMEOUT', message: 'did not resolve within 10000ms' },
    })
    const serialized = JSON.parse(JSON.stringify(resp))
    expect(isTranslateResponse(serialized)).toBe(true)
    expect(serialized.error?.code).toBe('TIMEOUT')
  })

  it('mismatched requestId rejected by sender correlation (caller checks)', () => {
    // The protocol guards don't enforce requestId match — receivers do.
    // This documents the contract by example.
    const out = makeTranslateRequest({ requestId: 'a', url: 'x', translatorId: 't' })
    const incoming = makeTranslateResponse({ requestId: 'b', items: [] })
    expect(out.requestId).not.toBe(incoming.requestId)
  })
})
