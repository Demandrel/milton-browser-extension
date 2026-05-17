// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// AC9 — sandbox's lazy-load fallback. Extracted from sandbox.ts so the
// postMessage round-trip can be unit-tested in isolation (sandbox.ts
// itself runs only in the MV3 sandbox-iframe DOM context). The extracted
// helper takes its postMessage target + listener-host as explicit
// parameters; sandbox.ts wires them as window.parent + window.

import {
  generateRequestId,
  isFromExpectedSource,
  isTranslatorLoadResponse,
  makeTranslatorLoadRequest,
} from './host-bridge'
import type { BundledTranslator } from './zotero-types'

export const TRANSLATOR_LOAD_TIMEOUT_MS = 10_000

export class TranslatorLoadTimeoutError extends Error {
  readonly translatorId: string
  constructor(translatorId: string) {
    super(`translator-load-request for ${translatorId} did not resolve within ${TRANSLATOR_LOAD_TIMEOUT_MS}ms`)
    this.name = 'TranslatorLoadTimeoutError'
    this.translatorId = translatorId
  }
}

export class TranslatorUnavailableError extends Error {
  readonly translatorId: string
  readonly upstreamCode: string
  constructor(translatorId: string, upstreamCode: string, upstreamMessage: string) {
    super(`[TRANSLATOR_UNAVAILABLE] ${translatorId}: ${upstreamCode} — ${upstreamMessage}`)
    this.name = 'TranslatorUnavailableError'
    this.translatorId = translatorId
    this.upstreamCode = upstreamCode
  }
}

export interface LoadTranslatorOpts {
  /** Target window the request gets posted to (production: window.parent). */
  postTarget: Window
  /** Listener host that hears the reply (production: window). */
  listenerHost: Window
  /** Translator UUID being requested. */
  translatorId: string
  /** Override timeout (tests; production uses TRANSLATOR_LOAD_TIMEOUT_MS). */
  timeoutMs?: number
}

/**
 * Post a translator-load-request to the parent and await a matching
 * translator-load-response. Times out after TRANSLATOR_LOAD_TIMEOUT_MS
 * with TranslatorLoadTimeoutError. Rejects with TranslatorUnavailableError
 * if the parent returns an error envelope, OR a generic Error if the
 * parent returns neither translator nor error (malformed reply).
 *
 * Source validation: only accepts replies whose event.source matches the
 * postTarget (BE-8-4 H2 hardening pattern — never trust by origin string).
 */
export function loadTranslatorFromParent(opts: LoadTranslatorOpts): Promise<BundledTranslator> {
  const requestId = generateRequestId()
  const msg = makeTranslatorLoadRequest({ requestId, translatorId: opts.translatorId })
  const timeoutMs = opts.timeoutMs ?? TRANSLATOR_LOAD_TIMEOUT_MS

  return new Promise<BundledTranslator>((resolve, reject) => {
    const timer = setTimeout(() => {
      opts.listenerHost.removeEventListener('message', handler)
      reject(new TranslatorLoadTimeoutError(opts.translatorId))
    }, timeoutMs)
    const handler = (event: MessageEvent): void => {
      if (!isFromExpectedSource(event, [opts.postTarget])) return
      if (!isTranslatorLoadResponse(event.data)) return
      if (event.data.requestId !== requestId) return
      clearTimeout(timer)
      opts.listenerHost.removeEventListener('message', handler)
      if (event.data.error !== undefined) {
        reject(
          new TranslatorUnavailableError(
            opts.translatorId,
            event.data.error.code,
            event.data.error.message,
          ),
        )
        return
      }
      if (event.data.translator === undefined) {
        reject(new Error(`[TRANSLATOR_UNAVAILABLE] ${opts.translatorId}: parent reply had neither translator nor error envelope`))
        return
      }
      resolve(event.data.translator)
    }
    opts.listenerHost.addEventListener('message', handler)
    opts.postTarget.postMessage(msg, '*')
  })
}
