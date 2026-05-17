// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-7: Class 2 capture — client-side PDF bytes fetch primitive.
//
// Delegates a PDF fetch to the active tab's content-script world via
// chrome.scripting.executeScript. The content-script world inherits the
// tab's origin AND the tab's session cookies for same-origin fetches, so
// publishers behind Cloudflare/Anubis (which already cleared the bot check
// for the user's tab) are reachable — closing the Class 2 gap that BE-7's
// connector-side server fetch can't.
//
// Magic-byte (%PDF-) check runs INSIDE the content script so that an
// HTML-as-PDF challenge page (Cloudflare "Checking your browser…" returned
// with a misconfigured Content-Type: application/pdf header) is rejected
// BEFORE the 8 MiB challenge HTML is structured-cloned back across the wire.
// The 50 MiB size cap is also enforced inside the content script for the
// same reason.
//
// Memory: structured-clone is a COPY, not a transfer (chrome.scripting
// result-marshalling does NOT support Transferables). Peak memory is briefly
// 2× the bytes (content-script's buf + popup's clone). At the 50 MiB cap,
// that's 100 MiB peak per upload — acceptable for an extension that's
// user-paced (one capture at a time).
//
// Cancel honesty: chrome.scripting.executeScript has NO abort signal. If the
// popup closes mid-fetch, the executeScript-injected function runs to
// completion in the content script; the popup-side `await` is just
// abandoned. The popup-side `Promise.race` against `opts.timeoutMs` is a
// safety net only; the underlying executeScript keeps running and its result
// is silently discarded if the timeout already fired.
//
// Historical Chrome silent-truncation: pre-115ish Chrome had bugs where
// chrome.scripting.executeScript structured-clone results above ~32 MiB were
// silently truncated. BE-8-7 smoke matrix S2 explicitly exercises a 30-50
// MiB PDF to catch this; if NO_RESULT is observed only above some
// threshold, lower MAX_PDF_BYTES to match what round-trips reliably.

import { isRestrictedUrl } from '../popup/popup-helpers'
import { MAX_PDF_BYTES } from './connector-client'

export type PdfFetchInTabErrorCode =
  | 'RESTRICTED_URL'
  | 'TAB_GONE'
  | 'SCRIPTING_FAILED'
  | 'HTTP_ERROR'
  | 'NOT_PDF'
  | 'TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'NO_RESULT'

export class PdfFetchInTabError extends Error {
  readonly code: PdfFetchInTabErrorCode
  /** HTTP status when code === 'HTTP_ERROR'; otherwise undefined. */
  readonly httpStatus?: number
  constructor(code: PdfFetchInTabErrorCode, message: string, httpStatus?: number) {
    super(`[${code}] ${message}`)
    this.name = 'PdfFetchInTabError'
    this.code = code
    if (httpStatus !== undefined) this.httpStatus = httpStatus
  }
}

export interface PdfBytesResult {
  bytes: ArrayBuffer
  finalUrl: string
}

export interface FetchPdfBytesInTabOptions {
  /** Popup-side timeout (default 45_000 ms). Safety net only — see module header. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 45_000

/**
 * Shape of the structured-clone-able value returned by the in-tab function.
 * Discriminated union: success carries bytes; errors carry a typed code.
 */
type InTabResult =
  | { ok: true; bytes: ArrayBuffer; finalUrl: string }
  | { ok: false; code: 'HTTP_ERROR'; status: number }
  | { ok: false; code: 'NOT_PDF'; firstBytes: string }
  | { ok: false; code: 'TOO_LARGE'; size: number }
  | { ok: false; code: 'NETWORK_ERROR'; message: string }

/**
 * Inner function executed in the active tab's content-script world. Plays
 * three roles: (1) issues `fetch(url, {credentials:'include'})` so the
 * tab's session cookies travel; (2) magic-byte checks the response BEFORE
 * the popup pays the structured-clone cost for an HTML-as-PDF body; (3)
 * caps at MAX_PDF_BYTES (50 MiB) so oversized PDFs reject inline.
 *
 * The MAX value is passed via `args` so the cap stays in sync with
 * connector-client.MAX_PDF_BYTES without inlining the constant here (the
 * inner function is serialized to a string by chrome.scripting; bound
 * captures wouldn't survive serialization).
 */
async function fetchPdfInTab(url: string, maxBytes: number): Promise<InTabResult> {
  let resp: Response
  try {
    resp = await fetch(url, { credentials: 'include', redirect: 'follow' })
  } catch (e) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: e instanceof Error ? e.message : String(e),
    }
  }
  if (!resp.ok) {
    return { ok: false, code: 'HTTP_ERROR', status: resp.status }
  }
  let buf: ArrayBuffer | null
  try {
    buf = await resp.arrayBuffer()
  } catch (e) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: e instanceof Error ? e.message : String(e),
    }
  }

  // Magic-byte check: PDF spec mandates first 5 bytes are %PDF- (0x25, 0x50,
  // 0x44, 0x46, 0x2d). HTML challenge pages start with <, JSON with {, etc.
  if (buf.byteLength < 5) {
    const result: InTabResult = {
      ok: false,
      code: 'NOT_PDF',
      firstBytes: Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    }
    buf = null // BT7: explicit clear so V8 GC reclaims promptly
    return result
  }
  const head = new Uint8Array(buf, 0, 5)
  if (
    head[0] !== 0x25 ||
    head[1] !== 0x50 ||
    head[2] !== 0x44 ||
    head[3] !== 0x46 ||
    head[4] !== 0x2d
  ) {
    const firstBytes = Array.from(head)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    buf = null // BT7: avoid cloning 8 MiB of Cloudflare HTML on the way back
    return { ok: false, code: 'NOT_PDF', firstBytes }
  }

  if (buf.byteLength > maxBytes) {
    const size = buf.byteLength
    buf = null // BT7: do NOT clone oversized body across the wire
    return { ok: false, code: 'TOO_LARGE', size }
  }

  return { ok: true, bytes: buf, finalUrl: resp.url }
}

/**
 * Fetch a PDF in the active tab's content-script context. Returns bytes +
 * the final URL after redirects. Rejects with PdfFetchInTabError on any
 * failure (restricted URL, tab gone, scripting failure, HTTP non-2xx, not a
 * PDF, oversized, network error, popup-side timeout, no result).
 */
export async function fetchPdfBytesInTab(
  tabId: number,
  url: string,
  opts?: FetchPdfBytesInTabOptions,
): Promise<PdfBytesResult> {
  if (isRestrictedUrl(url)) {
    throw new PdfFetchInTabError(
      'RESTRICTED_URL',
      `URL scheme not supported for in-tab fetch: ${url}`,
    )
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Popup-side timeout safety net. Underlying executeScript has no abort;
  // if the timeout wins, the in-tab fetch keeps running and the result is
  // silently discarded. Documented in module header.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new PdfFetchInTabError('TIMEOUT', `fetch did not complete within ${timeoutMs} ms`))
    }, timeoutMs)
  })

  let results: chrome.scripting.InjectionResult<InTabResult>[]
  try {
    results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        func: fetchPdfInTab,
        args: [url, MAX_PDF_BYTES],
      }),
      timeoutPromise,
    ])
  } catch (err) {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    if (err instanceof PdfFetchInTabError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    if (/no tab with id|tab was closed/i.test(msg)) {
      throw new PdfFetchInTabError('TAB_GONE', msg)
    }
    if (/cannot access|must request permission/i.test(msg)) {
      throw new PdfFetchInTabError('RESTRICTED_URL', msg)
    }
    throw new PdfFetchInTabError('SCRIPTING_FAILED', msg)
  }
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)

  if (results.length === 0 || results[0]?.result === undefined) {
    throw new PdfFetchInTabError(
      'NO_RESULT',
      'chrome.scripting.executeScript returned no result frame',
    )
  }
  const inTabResult = results[0].result
  if (inTabResult.ok === true) {
    return { bytes: inTabResult.bytes, finalUrl: inTabResult.finalUrl }
  }

  switch (inTabResult.code) {
    case 'HTTP_ERROR':
      throw new PdfFetchInTabError(
        'HTTP_ERROR',
        `publisher returned HTTP ${inTabResult.status}`,
        inTabResult.status,
      )
    case 'NOT_PDF':
      throw new PdfFetchInTabError(
        'NOT_PDF',
        `body is not a PDF (first bytes: ${inTabResult.firstBytes})`,
      )
    case 'TOO_LARGE':
      throw new PdfFetchInTabError(
        'TOO_LARGE',
        `PDF body ${inTabResult.size} bytes exceeds ${MAX_PDF_BYTES} cap`,
      )
    case 'NETWORK_ERROR':
      throw new PdfFetchInTabError('NETWORK_ERROR', inTabResult.message)
  }
}

export const PDF_FETCH_IN_TAB_CONSTANTS = {
  DEFAULT_TIMEOUT_MS,
} as const
