// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// postMessage protocol between the sandbox iframe and the popup/SW caller.
// Version 1: translate-request/response + fetch-proxy-request/response.
// BE-8-6 may extend the protocol for chrome.scripting.executeScript variants
// (carry protocolVersion forward; consumers MUST check before accepting).
//
// Origin validation: sandbox pages run at opaque origin ("null"), so receivers
// rely on `event.source` identity (a Window reference) rather than the
// `event.origin` string. Callers use isFromExpectedSource() to gate inbound
// messages before processing — see sandbox.ts / spike-page.ts / zotero-http.ts.

import type {
  FetchProxyRequest,
  FetchProxyResponse,
  TranslateRequest,
  TranslateResponse,
} from './zotero-types'

export const PROTOCOL_VERSION = 1 as const

// Centralized arXiv translator ID — sandbox.ts (spike trigger) and spike-page.ts
// (request builder) both reference it. Keep one source of truth.
export const ARXIV_TRANSLATOR_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'

/**
 * Validate that a postMessage event came from one of the expected source
 * windows. `event.source` is a Window reference, opaque-origin-safe (unlike
 * event.origin, which is the literal string "null" for sandbox pages).
 *
 * Pass an empty array to reject all (defensive default for handlers that
 * haven't wired their expected sources yet).
 */
export function isFromExpectedSource(
  event: MessageEvent,
  expected: ReadonlyArray<Window | null>,
): boolean {
  if (expected.length === 0) return false
  const src = event.source
  if (src === null) return false
  for (const w of expected) {
    if (w !== null && src === w) return true
  }
  return false
}

export type AnyMessage =
  | TranslateRequest
  | TranslateResponse
  | FetchProxyRequest
  | FetchProxyResponse

export function isTranslateRequest(msg: unknown): msg is TranslateRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'translate-request' &&
    (msg as { protocolVersion?: number }).protocolVersion === PROTOCOL_VERSION
  )
}

export function isTranslateResponse(msg: unknown): msg is TranslateResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'translate-response' &&
    (msg as { protocolVersion?: number }).protocolVersion === PROTOCOL_VERSION
  )
}

export function isFetchProxyRequest(msg: unknown): msg is FetchProxyRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'fetch-request' &&
    (msg as { protocolVersion?: number }).protocolVersion === PROTOCOL_VERSION
  )
}

export function isFetchProxyResponse(msg: unknown): msg is FetchProxyResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'fetch-response' &&
    (msg as { protocolVersion?: number }).protocolVersion === PROTOCOL_VERSION
  )
}

export function makeTranslateRequest(args: {
  requestId: string
  url: string
  translatorId: string
  html?: string
  timeoutMs?: number
}): TranslateRequest {
  return {
    type: 'translate-request',
    protocolVersion: PROTOCOL_VERSION,
    requestId: args.requestId,
    url: args.url,
    translatorId: args.translatorId,
    html: args.html,
    timeoutMs: args.timeoutMs,
  }
}

export function makeTranslateResponse(args: {
  requestId: string
  items?: TranslateResponse['items']
  error?: TranslateResponse['error']
}): TranslateResponse {
  return {
    type: 'translate-response',
    protocolVersion: PROTOCOL_VERSION,
    requestId: args.requestId,
    items: args.items,
    error: args.error,
  }
}

export function generateRequestId(): string {
  // Sandbox lacks crypto.randomUUID in some Chromium versions; fall back to timestamp + rand.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
