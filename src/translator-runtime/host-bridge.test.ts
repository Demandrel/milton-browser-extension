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
  isTranslatorLoadRequest,
  isTranslatorLoadResponse,
  makeTranslateRequest,
  makeTranslateResponse,
  makeTranslatorLoadRequest,
  makeTranslatorLoadResponse,
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

// ────────────────────────────────────────────────────────────────────────
// BE-8-9 / code-review M2: inlineTranslator field is the IPC seam for
// the cached-fresher resolver. It traverses popup → offscreen-client →
// chrome.runtime.sendMessage → offscreen → postMessage → sandbox, with
// optional-field forwarding at every hop. These tests pin the bridge end
// (where the field is born and where the wire protocol is defined) so a
// future rename / removal at the bridge surfaces immediately rather than
// silently dropping the cached-fresher win.
// ────────────────────────────────────────────────────────────────────────

describe('inlineTranslator IPC field (BE-8-9 / code-review M2)', () => {
  const fakeInline = {
    metadata: { translatorID: ARXIV_TRANSLATOR_ID, label: 'arXiv (cached fresher)' },
    body: '/* CACHED FRESHER BODY */',
  }

  it('makeTranslateRequest carries inlineTranslator through to the message envelope', () => {
    const req = makeTranslateRequest({
      requestId: 'r-inline',
      url: 'https://arxiv.org/abs/2303.08774',
      translatorId: ARXIV_TRANSLATOR_ID,
      inlineTranslator: fakeInline,
    })
    expect(req.inlineTranslator).toBeDefined()
    expect(req.inlineTranslator!.body).toBe('/* CACHED FRESHER BODY */')
    expect(req.inlineTranslator!.metadata.translatorID).toBe(ARXIV_TRANSLATOR_ID)
  })

  it('makeTranslateRequest leaves inlineTranslator undefined when not provided (common path)', () => {
    const req = makeTranslateRequest({
      requestId: 'r-noinline',
      url: 'https://arxiv.org/abs/2303.08774',
      translatorId: ARXIV_TRANSLATOR_ID,
    })
    expect(req.inlineTranslator).toBeUndefined()
  })

  it('inlineTranslator survives JSON round-trip (covers postMessage clone semantics)', () => {
    const req = makeTranslateRequest({
      requestId: 'r-rt',
      url: 'https://arxiv.org/abs/2303.08774',
      translatorId: ARXIV_TRANSLATOR_ID,
      inlineTranslator: fakeInline,
    })
    const serialized = JSON.parse(JSON.stringify(req))
    expect(isTranslateRequest(serialized)).toBe(true)
    expect(serialized.inlineTranslator).toBeDefined()
    expect(serialized.inlineTranslator.body).toBe('/* CACHED FRESHER BODY */')
    expect(serialized.inlineTranslator.metadata.label).toBe('arXiv (cached fresher)')
  })

  it('isTranslateRequest still accepts the envelope when inlineTranslator is present', () => {
    // Regression guard: a future type-guard change that tightened the shape
    // check could silently reject inline-bearing envelopes — that would
    // surface as cached-fresher entries never executing.
    const req = makeTranslateRequest({
      requestId: 'r-guard',
      url: 'https://arxiv.org/abs/2303.08774',
      translatorId: ARXIV_TRANSLATOR_ID,
      inlineTranslator: fakeInline,
    })
    expect(isTranslateRequest(req)).toBe(true)
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

// ─── BE-8-5 AC10: protocol v2 — translator-load delegation ─────────────
describe('protocol v2 — translator-load-request/response (AC10)', () => {
  it('PROTOCOL_VERSION is 2 after BE-8-5 bump', () => {
    expect(PROTOCOL_VERSION).toBe(2)
  })

  it('makeTranslatorLoadRequest produces a valid translator-load-request stamped at v2', () => {
    const req = makeTranslatorLoadRequest({ requestId: 'tl-1', translatorId: ARXIV_TRANSLATOR_ID })
    expect(isTranslatorLoadRequest(req)).toBe(true)
    expect(req.protocolVersion).toBe(2)
    expect(req.translatorId).toBe(ARXIV_TRANSLATOR_ID)
  })

  it('makeTranslatorLoadResponse (success) carries translator bundle', () => {
    const resp = makeTranslatorLoadResponse({
      requestId: 'tl-1',
      translator: {
        metadata: { translatorID: ARXIV_TRANSLATOR_ID, label: 'arXiv.org' },
        body: '/* source bytes */',
      },
    })
    expect(isTranslatorLoadResponse(resp)).toBe(true)
    expect(resp.translator?.metadata.label).toBe('arXiv.org')
  })

  it('makeTranslatorLoadResponse (error) carries error envelope', () => {
    const resp = makeTranslatorLoadResponse({
      requestId: 'tl-1',
      error: { code: 'NOT_IN_MANIFEST', message: 'translator UUID not in mirror manifest' },
    })
    expect(isTranslatorLoadResponse(resp)).toBe(true)
    expect(resp.error?.code).toBe('NOT_IN_MANIFEST')
  })

  it('translator-load-request survives JSON round-trip', () => {
    const req = makeTranslatorLoadRequest({ requestId: 'tl-rt', translatorId: 'uuid-x' })
    const serialized = JSON.parse(JSON.stringify(req))
    expect(isTranslatorLoadRequest(serialized)).toBe(true)
    expect(serialized.translatorId).toBe('uuid-x')
  })

  it('translator-load-response survives JSON round-trip (both success + error)', () => {
    const success = makeTranslatorLoadResponse({
      requestId: 'tl-rt',
      translator: { metadata: { translatorID: 'u', label: 'L' }, body: 'src' },
    })
    expect(isTranslatorLoadResponse(JSON.parse(JSON.stringify(success)))).toBe(true)
    const err = makeTranslatorLoadResponse({
      requestId: 'tl-rt',
      error: { code: 'CDN_5XX', message: 'upstream returned 503' },
    })
    expect(isTranslatorLoadResponse(JSON.parse(JSON.stringify(err)))).toBe(true)
  })

  it('isTranslatorLoadRequest rejects wrong type', () => {
    expect(isTranslatorLoadRequest({ type: 'translate-request', protocolVersion: 2, requestId: 'x' })).toBe(false)
    expect(isTranslatorLoadRequest(null)).toBe(false)
    expect(isTranslatorLoadRequest({})).toBe(false)
  })

  it('isTranslatorLoadResponse rejects mismatched protocolVersion (v3 not yet accepted)', () => {
    expect(
      isTranslatorLoadResponse({
        type: 'translator-load-response',
        protocolVersion: 3,
        requestId: 'x',
      }),
    ).toBe(false)
  })
})

// ─── BE-8-5 AC10: backward compatibility ────────────────────────────────
describe('protocol backward compat — v1 messages still accepted by v2 listeners', () => {
  // A v1 emitter (BE-8-4 build that didn't get re-pushed) sends messages
  // stamped with protocolVersion: 1. The v2 listener (post-BE-8-5 build)
  // must still accept them; otherwise a partial-upgrade in the wild would
  // brick the sandbox communication. ACCEPTED_VERSIONS = {1, 2} encodes this.

  it('isTranslateRequest accepts a v1 message', () => {
    expect(
      isTranslateRequest({
        type: 'translate-request',
        protocolVersion: 1,
        requestId: 'v1',
        url: 'https://x',
        translatorId: 't',
      }),
    ).toBe(true)
  })

  it('isTranslateResponse accepts a v1 message', () => {
    expect(
      isTranslateResponse({
        type: 'translate-response',
        protocolVersion: 1,
        requestId: 'v1',
        items: [],
      }),
    ).toBe(true)
  })

  it('isFetchProxyRequest accepts a v1 message', () => {
    expect(
      isFetchProxyRequest({
        type: 'fetch-request',
        protocolVersion: 1,
        requestId: 'v1',
        method: 'GET',
        url: 'https://x',
      }),
    ).toBe(true)
  })

  it('all guards reject v3 (unknown future version) — future bumps must extend ACCEPTED_VERSIONS', () => {
    expect(isTranslateRequest({ type: 'translate-request', protocolVersion: 3, requestId: 'x' })).toBe(false)
    expect(isTranslateResponse({ type: 'translate-response', protocolVersion: 3, requestId: 'x' })).toBe(false)
    expect(isFetchProxyRequest({ type: 'fetch-request', protocolVersion: 3, requestId: 'x' })).toBe(false)
    expect(isTranslatorLoadRequest({ type: 'translator-load-request', protocolVersion: 3, requestId: 'x' })).toBe(false)
  })
})
