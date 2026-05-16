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
// Origin validation: sandbox pages run at opaque origin ("null"), so we
// rely on `event.source` identity rather than `event.origin` string match.

import type {
  FetchProxyRequest,
  FetchProxyResponse,
  TranslateRequest,
  TranslateResponse,
} from './zotero-types'

export const PROTOCOL_VERSION = 1 as const

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
