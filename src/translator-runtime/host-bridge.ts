// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// postMessage protocol between the sandbox iframe and the popup/SW caller.
// Version 1: translate-request/response + fetch-proxy-request/response.
// Version 2 (BE-8-5): adds translator-load-request/response for the lazy
// CDN-fetch delegation path. v1 messages remain accepted by v2 listeners
// (type guards check `protocolVersion === 1 || === 2`); new emitters stamp
// PROTOCOL_VERSION.
// BE-8-6 may bump to v3 when chrome.scripting.executeScript variants land.
//
// Origin validation: sandbox pages run at opaque origin ("null"), so receivers
// rely on `event.source` identity (a Window reference) rather than the
// `event.origin` string. Callers use isFromExpectedSource() to gate inbound
// messages before processing — see sandbox.ts / spike-page.ts / zotero-http.ts.

import type {
  BundledTranslator,
  FetchProxyRequest,
  FetchProxyResponse,
  ProtocolVersion,
  TranslateRequest,
  TranslateResponse,
  TranslatorLoadRequest,
  TranslatorLoadResponse,
} from './zotero-types'

export const PROTOCOL_VERSION = 2 as const

// Versions accepted by inbound type guards. Includes the current version
// plus all prior compatible versions; v1 emitters interop with v2 listeners.
const ACCEPTED_VERSIONS: ReadonlySet<ProtocolVersion> = new Set([1, 2])

function isAcceptedVersion(v: unknown): v is ProtocolVersion {
  return typeof v === 'number' && ACCEPTED_VERSIONS.has(v as ProtocolVersion)
}

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
  | TranslatorLoadRequest
  | TranslatorLoadResponse

function isTypedMessage(msg: unknown, expectedType: string): boolean {
  if (typeof msg !== 'object' || msg === null) return false
  const m = msg as { type?: string; protocolVersion?: unknown }
  if (m.type !== expectedType) return false
  if (!isAcceptedVersion(m.protocolVersion)) return false
  return true
}

export function isTranslateRequest(msg: unknown): msg is TranslateRequest {
  return isTypedMessage(msg, 'translate-request')
}

export function isTranslateResponse(msg: unknown): msg is TranslateResponse {
  return isTypedMessage(msg, 'translate-response')
}

export function isFetchProxyRequest(msg: unknown): msg is FetchProxyRequest {
  return isTypedMessage(msg, 'fetch-request')
}

export function isFetchProxyResponse(msg: unknown): msg is FetchProxyResponse {
  return isTypedMessage(msg, 'fetch-response')
}

export function isTranslatorLoadRequest(msg: unknown): msg is TranslatorLoadRequest {
  return isTypedMessage(msg, 'translator-load-request')
}

export function isTranslatorLoadResponse(msg: unknown): msg is TranslatorLoadResponse {
  return isTypedMessage(msg, 'translator-load-response')
}

export function makeTranslateRequest(args: {
  requestId: string
  url: string
  translatorId: string
  html?: string
  timeoutMs?: number
  inlineTranslator?: BundledTranslator
}): TranslateRequest {
  return {
    type: 'translate-request',
    protocolVersion: PROTOCOL_VERSION,
    requestId: args.requestId,
    url: args.url,
    translatorId: args.translatorId,
    html: args.html,
    timeoutMs: args.timeoutMs,
    inlineTranslator: args.inlineTranslator,
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

export function makeTranslatorLoadRequest(args: {
  requestId: string
  translatorId: string
}): TranslatorLoadRequest {
  return {
    type: 'translator-load-request',
    protocolVersion: PROTOCOL_VERSION,
    requestId: args.requestId,
    translatorId: args.translatorId,
  }
}

export function makeTranslatorLoadResponse(args: {
  requestId: string
  translator?: BundledTranslator
  error?: TranslatorLoadResponse['error']
}): TranslatorLoadResponse {
  return {
    type: 'translator-load-response',
    protocolVersion: PROTOCOL_VERSION,
    requestId: args.requestId,
    translator: args.translator,
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
