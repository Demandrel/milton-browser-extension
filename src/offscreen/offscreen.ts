// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-6: Offscreen-document broker. Production parent of the translator
// sandbox iframe. Bridges three IPC layers:
//
//   1. Popup ↔ Offscreen  — chrome.runtime.sendMessage envelopes:
//        `milton-translate-request {requestId, url, html, translatorId, timeoutMs}`
//        `milton-translate-response {requestId, items?, error?}`
//        `milton-translate-cancel {requestId}`
//
//   2. Offscreen ↔ Sandbox iframe — postMessage protocol v2 (BE-8-5):
//        translate-request / translate-response (BE-8-4)
//        translator-load-request / translator-load-response (BE-8-5)
//        fetch-request / fetch-response (BE-8-4)
//
//   3. Offscreen ↔ translators.milton.so CDN — fetchTranslatorFromCdn
//      (lifted from spike-page.ts, originally BE-8-5 SPIKE-ONLY).
//
// ── Translation queue (Zotero re-entrance hazard) ─────────────────────────
//
// The vendored zotero/translate framework was built for Zotero desktop
// (single-translation-at-a-time). Concurrent Translate.Web instances in
// the same sandbox share Zotero global state — parsers, sandbox manager,
// item collector. Two simultaneous translate-requests would interleave
// detectWeb/doWeb/saveItems with unpredictable corruption.
//
// Mitigation: SERIALIZE in this layer. `pendingQueue` holds requests
// while `inFlightRequestId !== null`. When the in-flight request resolves,
// we dequeue + dispatch. Queue capped at 4 pending; the 5th gets
// OFFSCREEN_BUSY → caller falls back to server.
//
// DO NOT remove this queue in future "optimization" passes — Zotero's
// translator runtime is the constraint, not the offscreen IPC layer.

import {
  generateRequestId,
  isFetchProxyRequest,
  isFromExpectedSource,
  isTranslateResponse,
  isTranslatorLoadRequest,
  makeTranslateRequest,
  makeTranslatorLoadResponse,
  PROTOCOL_VERSION,
} from '../translator-runtime/host-bridge'
import { fetchTranslatorFromCdn, TranslatorFetcherError } from '../translator-runtime/translator-fetcher'
import type { BundledTranslator, FetchProxyResponse, ZoteroItem } from '../translator-runtime/zotero-types'

// ─── Types ────────────────────────────────────────────────────────────────

export interface MiltonTranslateRequestMsg {
  kind: 'milton-translate-request'
  requestId: string
  url: string
  html: string
  translatorId: string
  timeoutMs?: number
  // BE-8-9: optional pre-resolved translator body. Popup pre-resolves via
  // getResolvedTranslator(uuid, manifest); when the cached-fresher entry
  // beats the build-time bundled pin, the resolved body is inlined here
  // and forwarded to the sandbox through the translate-request envelope.
  // Sandbox uses inline if present; else falls back to its own bundled
  // lookup (which has no chrome.storage access, so it can only see the
  // bundled version anyway).
  inlineTranslator?: BundledTranslator
}

export interface MiltonTranslateResponseMsg {
  kind: 'milton-translate-response'
  requestId: string
  items?: ZoteroItem[]
  error?: { code: string; message: string }
}

export interface MiltonTranslateCancelMsg {
  kind: 'milton-translate-cancel'
  requestId: string
}

type MiltonRuntimeMsg = MiltonTranslateRequestMsg | MiltonTranslateCancelMsg

// ─── Queue state ──────────────────────────────────────────────────────────

const MAX_PENDING_QUEUE = 4
const CANCELLED_GC_WINDOW_MS = 30_000

interface QueueEntry {
  msg: MiltonTranslateRequestMsg
  sendResponse: (response: MiltonTranslateResponseMsg) => void
}

const pendingQueue: QueueEntry[] = []
let inFlightRequestId: string | null = null
// requestId → timestamp added (for 30s GC eviction).
const cancelledRequestIds = new Map<string, number>()

function getSandboxWindow(): Window | null {
  const iframe = document.getElementById('sandbox') as HTMLIFrameElement | null
  return iframe?.contentWindow ?? null
}

function isCancelled(requestId: string): boolean {
  gcCancelled()
  return cancelledRequestIds.has(requestId)
}

function gcCancelled(): void {
  const cutoff = Date.now() - CANCELLED_GC_WINDOW_MS
  for (const [id, ts] of cancelledRequestIds) {
    if (ts < cutoff) cancelledRequestIds.delete(id)
  }
}

// ─── Sandbox postMessage round-trip ───────────────────────────────────────

function waitForTranslateResponse(
  requestId: string,
  sandboxWindow: Window,
  timeoutMs: number,
): Promise<{ items?: ZoteroItem[]; error?: { code: string; message: string } }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve({ error: { code: 'OFFSCREEN_TIMEOUT', message: `sandbox did not reply within ${timeoutMs}ms` } })
    }, timeoutMs)
    const handler = (event: MessageEvent): void => {
      if (!isFromExpectedSource(event, [sandboxWindow])) return
      if (!isTranslateResponse(event.data)) return
      if (event.data.requestId !== requestId) return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      resolve({ items: event.data.items, error: event.data.error })
    }
    window.addEventListener('message', handler)
  })
}

async function dispatchTranslation(entry: QueueEntry): Promise<void> {
  const sandboxWindow = getSandboxWindow()
  if (sandboxWindow === null) {
    entry.sendResponse({
      kind: 'milton-translate-response',
      requestId: entry.msg.requestId,
      error: { code: 'SANDBOX_UNAVAILABLE', message: 'sandbox iframe not present in offscreen DOM' },
    })
    return
  }
  // Sandbox-side default is 10s (zotero-translate translateWithTimeout default).
  // Offscreen-side wait gives the sandbox 1s of slack so the sandbox-side
  // timeout fires FIRST under normal load (cleaner error code).
  const sandboxTimeoutMs = entry.msg.timeoutMs ?? 10_000
  const offscreenWaitMs = sandboxTimeoutMs + 1_000

  const translateRequest = makeTranslateRequest({
    requestId: entry.msg.requestId,
    url: entry.msg.url,
    translatorId: entry.msg.translatorId,
    html: entry.msg.html,
    timeoutMs: sandboxTimeoutMs,
    inlineTranslator: entry.msg.inlineTranslator,
  })
  sandboxWindow.postMessage(translateRequest, '*')
  const reply = await waitForTranslateResponse(entry.msg.requestId, sandboxWindow, offscreenWaitMs)

  // If popup-side cancel arrived while we were awaiting, drop the reply.
  // The popup's sendResponse channel is already dead from beforeunload;
  // calling it would no-op (in some Chrome versions, log a warning).
  if (isCancelled(entry.msg.requestId)) {
    cancelledRequestIds.delete(entry.msg.requestId)
    return
  }
  entry.sendResponse({
    kind: 'milton-translate-response',
    requestId: entry.msg.requestId,
    items: reply.items,
    error: reply.error,
  })
}

async function pumpQueue(): Promise<void> {
  while (pendingQueue.length > 0 && inFlightRequestId === null) {
    const next = pendingQueue.shift()
    if (next === undefined) return
    inFlightRequestId = next.msg.requestId
    try {
      await dispatchTranslation(next)
    } finally {
      inFlightRequestId = null
    }
  }
}

function enqueueOrReject(
  msg: MiltonTranslateRequestMsg,
  sendResponse: (r: MiltonTranslateResponseMsg) => void,
): void {
  if (pendingQueue.length >= MAX_PENDING_QUEUE) {
    sendResponse({
      kind: 'milton-translate-response',
      requestId: msg.requestId,
      error: { code: 'OFFSCREEN_BUSY', message: 'translator queue full; fall back to server' },
    })
    return
  }
  pendingQueue.push({ msg, sendResponse })
  void pumpQueue()
}

// ─── chrome.runtime.onMessage dispatcher ──────────────────────────────────

function isMiltonRuntimeMsg(m: unknown): m is MiltonRuntimeMsg {
  if (typeof m !== 'object' || m === null) return false
  const k = (m as { kind?: unknown }).kind
  return k === 'milton-translate-request' || k === 'milton-translate-cancel'
}

export function registerRuntimeListener(): void {
  chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
    // Reject messages from any other extension on the runtime bus.
    if (sender.id !== chrome.runtime.id) return false
    if (!isMiltonRuntimeMsg(rawMsg)) return false

    if (rawMsg.kind === 'milton-translate-cancel') {
      cancelledRequestIds.set(rawMsg.requestId, Date.now())
      // Cancel is fire-and-forget; no response needed.
      return false
    }
    // milton-translate-request → enqueue; reply async.
    enqueueOrReject(rawMsg, sendResponse as (r: MiltonTranslateResponseMsg) => void)
    return true // keep the channel open for the async sendResponse
  })
}

// ─── Fetch-proxy handler (lifted from spike-page.ts) ──────────────────────
//
// Sandbox iframe runs at opaque origin → cannot make cross-origin fetches
// even with manifest host_permissions. Sandbox posts a fetch-request to
// us; we perform the fetch (host_permissions apply here at extension
// origin) and post a fetch-response back.

function serializeHeaders(headers: Headers): string {
  const lines: string[] = []
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`)
  })
  return lines.join('\r\n')
}

export function registerFetchProxyHandler(): void {
  window.addEventListener('message', async (event: MessageEvent) => {
    const sandboxWindow = getSandboxWindow()
    if (!isFromExpectedSource(event, [sandboxWindow])) return
    if (!isFetchProxyRequest(event.data)) return
    const req = event.data
    const source = event.source as Window | null
    if (source === null) return
    try {
      const resp = await fetch(req.url, {
        method: req.method.toUpperCase(),
        headers: req.options?.headers,
        body: req.options?.body,
        credentials: 'omit',
      })
      const responseText = await resp.text()
      const reply: FetchProxyResponse = {
        type: 'fetch-response',
        protocolVersion: PROTOCOL_VERSION,
        requestId: req.requestId,
        response: {
          status: resp.status,
          responseText,
          responseHeaders: serializeHeaders(resp.headers),
          responseURL: resp.url,
        },
      }
      source.postMessage(reply, { targetOrigin: '*' })
    } catch (err) {
      const reply: FetchProxyResponse = {
        type: 'fetch-response',
        protocolVersion: PROTOCOL_VERSION,
        requestId: req.requestId,
        error: {
          code: 'FETCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      }
      source.postMessage(reply, { targetOrigin: '*' })
    }
  })
}

// ─── translator-load-request handler (lifted from spike-page.ts) ──────────
//
// Sandbox posts this when getBundledTranslator(uuid) returns null (UUID
// not in the curated bundle). We hit the translator-fetcher (Ed25519 sig
// verify + per-translator sha256 verify against the live manifest at
// translators.milton.so/repo) and reply with the verified translator bytes.

export function registerTranslatorLoadHandler(): void {
  window.addEventListener('message', async (event: MessageEvent) => {
    const sandboxWindow = getSandboxWindow()
    if (!isFromExpectedSource(event, [sandboxWindow])) return
    if (!isTranslatorLoadRequest(event.data)) return
    const req = event.data
    const source = event.source as Window | null
    if (source === null) return
    try {
      const translator = await fetchTranslatorFromCdn(req.translatorId)
      if (translator === null) {
        const reply = makeTranslatorLoadResponse({
          requestId: req.requestId,
          error: { code: 'NOT_IN_MANIFEST', message: `translator ${req.translatorId} not in mirror manifest` },
        })
        source.postMessage(reply, { targetOrigin: '*' })
        return
      }
      const reply = makeTranslatorLoadResponse({ requestId: req.requestId, translator })
      source.postMessage(reply, { targetOrigin: '*' })
    } catch (err) {
      const code = err instanceof TranslatorFetcherError ? err.code : 'UNKNOWN'
      const reply = makeTranslatorLoadResponse({
        requestId: req.requestId,
        error: { code, message: err instanceof Error ? err.message : String(err) },
      })
      source.postMessage(reply, { targetOrigin: '*' })
    }
  })
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

registerRuntimeListener()
registerFetchProxyHandler()
registerTranslatorLoadHandler()

console.log(
  `[milton-offscreen] ready (protocol v${PROTOCOL_VERSION}). Queue cap ${MAX_PENDING_QUEUE}.`,
)

// ─── Test seam ────────────────────────────────────────────────────────────

export const _offscreenInternals = {
  pendingQueue,
  cancelledRequestIds,
  resetForTests(): void {
    pendingQueue.length = 0
    cancelledRequestIds.clear()
    inFlightRequestId = null
  },
  getInFlightRequestId(): string | null {
    return inFlightRequestId
  },
  // Suppress unused-var warning for the imported constant in tests.
  _generateRequestId: generateRequestId,
} as const
