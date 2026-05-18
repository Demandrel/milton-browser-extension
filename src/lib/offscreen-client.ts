// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-6: Popup-side wrapper around the offscreen document. Exposes:
//
//   - `ensureOffscreenDocument()` — idempotent; creates the offscreen doc
//      via chrome.offscreen.createDocument if one isn't already present.
//      Run in parallel with health() at popup boot to hide the ~500-1500ms
//      cold-start latency behind the localhost health probe.
//
//   - `requestClientTranslation()` — fires a `milton-translate-request` via
//      chrome.runtime.sendMessage; awaits the response envelope. Wraps the
//      sendMessage Promise in a Promise.race against an AbortSignal so the
//      popup can give up after 15s if the offscreen never replies (e.g.,
//      offscreen doc crashed). chrome.runtime.sendMessage does NOT accept
//      AbortSignal natively — aborting only rejects the local Promise; the
//      underlying messaging continues but the eventual reply is silently
//      discarded.
//
//   - `cancelClientTranslation()` — fires a `milton-translate-cancel` to
//      tell the offscreen to drop the eventual reply (cleaner than leaking
//      a sendResponse on a dead channel). Fully best-effort — popup's
//      beforeunload may not actually deliver this.

import type {
  MiltonTranslateRequestMsg,
  MiltonTranslateResponseMsg,
} from '../offscreen/offscreen'
import type { BundledTranslator, ZoteroItem } from '../translator-runtime/zotero-types'

const OFFSCREEN_DOC_URL = 'src/offscreen/offscreen.html'
const DEFAULT_POPUP_TIMEOUT_MS = 15_000

export class OffscreenClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'OffscreenClientError'
    this.code = code
  }
}

/**
 * Idempotent — checks chrome.offscreen.hasDocument() before calling
 * createDocument. Safe to call multiple times in a session.
 *
 * `reasons: [IFRAME_SCRIPTING]` because the offscreen doc hosts an
 * iframe (sandbox.html) that runs scripts the service-worker can't
 * access. Justification string per Chrome's policy requirement.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || chrome.offscreen === undefined) {
    throw new OffscreenClientError('OFFSCREEN_UNAVAILABLE', 'chrome.offscreen API not present (permission missing?)')
  }
  const exists = await chrome.offscreen.hasDocument()
  if (exists) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOC_URL,
    reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING],
    justification: 'Hosts translator-runtime sandbox iframe + translator-load fetch-proxy (BE-8-6)',
  })
}

export interface RequestClientTranslationArgs {
  url: string
  html: string
  translatorId: string
  /** Override default 15s popup-side timeout (production: leave undefined). */
  timeoutMs?: number
  /** Per-request requestId — caller may pass to enable cancellation. Default: crypto.randomUUID(). */
  requestId?: string
  /** AbortSignal lets the popup cancel mid-flight (e.g., user closed popup, state moved on). */
  signal?: AbortSignal
  /**
   * BE-8-9: pre-resolved cached-fresher translator body. Popup populates
   * via getResolvedTranslator(uuid, manifest) when the SW's auto-refresh
   * has cached a newer version than the build-time pin. Forwarded through
   * to the sandbox; sandbox uses inline if present, else its own bundled
   * lookup (which can never see cached entries — opaque origin + no
   * chrome.storage access).
   */
  inlineTranslator?: BundledTranslator
}

/**
 * Send a translation request to the offscreen document and await the
 * structured response. Resolves with `items` on success; rejects with
 * `OffscreenClientError` on the typed-error envelope or local timeout/abort.
 *
 * The offscreen-side dispatcher has its own 10s+1s timeout per AC7; this
 * popup-side timeout is a belt-and-suspenders for "offscreen never replied
 * at all" failure modes.
 */
export async function requestClientTranslation(
  args: RequestClientTranslationArgs,
): Promise<ZoteroItem[]> {
  const requestId = args.requestId ?? generateRequestId()
  const timeoutMs = args.timeoutMs ?? DEFAULT_POPUP_TIMEOUT_MS
  const msg: MiltonTranslateRequestMsg = {
    kind: 'milton-translate-request',
    requestId,
    url: args.url,
    html: args.html,
    translatorId: args.translatorId,
    timeoutMs: args.timeoutMs,
    inlineTranslator: args.inlineTranslator,
  }

  const sendPromise = chrome.runtime.sendMessage(msg) as Promise<MiltonTranslateResponseMsg | undefined>
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OffscreenClientError('POPUP_TIMEOUT', `offscreen did not reply within ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const abortPromise = args.signal
    ? new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          reject(new OffscreenClientError('POPUP_ABORTED', 'caller aborted before reply'))
        }
        if (args.signal!.aborted) onAbort()
        else args.signal!.addEventListener('abort', onAbort, { once: true })
      })
    : null

  try {
    const racers: Promise<MiltonTranslateResponseMsg | undefined>[] = [sendPromise, timeoutPromise]
    if (abortPromise !== null) racers.push(abortPromise)
    const reply = await Promise.race(racers)
    if (reply === undefined) {
      throw new OffscreenClientError('NO_REPLY', 'offscreen sendResponse channel closed without a payload')
    }
    if (reply.error !== undefined) {
      throw new OffscreenClientError(reply.error.code, reply.error.message)
    }
    return reply.items ?? []
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function cancelClientTranslation(requestId: string): void {
  if (typeof chrome === 'undefined' || chrome.runtime?.sendMessage === undefined) return
  try {
    void chrome.runtime.sendMessage({ kind: 'milton-translate-cancel', requestId })
  } catch {
    // Best-effort; popup may already be torn down.
  }
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
