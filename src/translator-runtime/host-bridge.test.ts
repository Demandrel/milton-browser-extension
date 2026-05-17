// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import {
  generateRequestId,
  isFetchProxyRequest,
  isFetchProxyResponse,
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
})
