// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Zotero.HTTP adapter — replaces the upstream framework's http.js with a
// fetch()-based implementation that matches the response shape translators
// inspect. Designed to run inside the MV3 sandbox page where extension
// host_permissions extend to declared origins.
//
// API surface verified against:
//  - vendor/zotero-translate/src/http.js (the upstream we replace)
//  - vendor/zotero-translate/src/translator.js + translation/translate.js
//    callsites (what consumers actually pass and read)

import type {
  FetchProxyRequest,
  FetchProxyResponse,
  ZoteroGlobal,
  ZoteroHttpRequestOptions,
  ZoteroHttpResponse,
} from './zotero-types'
import { generateRequestId, isFetchProxyResponse, PROTOCOL_VERSION } from './host-bridge'

const FETCH_TIMEOUT_DEFAULT_MS = 30000
const PROXY_TIMEOUT_MS = 30000

export class ZoteroHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly cause: unknown,
  ) {
    super(`Zotero.HTTP request to ${url} failed: ${String(cause)}`)
    this.name = 'ZoteroHttpError'
  }
}

/**
 * Translators expect `Zotero.HTTP.request` returning
 * `{status, responseText, responseHeaders, responseURL, response?}`.
 *
 * When running in the MV3 sandbox iframe (window.parent !== window), the
 * sandbox runs at opaque "null" origin so direct cross-origin fetches are
 * CORS-blocked even with manifest host_permissions. We proxy via the
 * parent (extension-origin) page through the fetch-proxy postMessage
 * protocol defined in host-bridge.ts. Direct fetch is the test/node path.
 *
 * responseType drives additional parsing (`text` default, `document` →
 * DOMParser, `json` → JSON.parse). Errors throw typed `ZoteroHttpError`.
 */
export async function zoteroHttpRequest(
  method: string,
  url: string,
  options: ZoteroHttpRequestOptions = {},
): Promise<ZoteroHttpResponse> {
  let raw: { status: number; responseText: string; responseHeaders: string; responseURL: string }
  const inSandbox = typeof window !== 'undefined' && window.parent !== window
  console.log('[milton-sandbox] Zotero.HTTP.request', { method, url, inSandbox })
  try {
    if (inSandbox) {
      raw = await fetchViaProxy(method, url, options)
    } else {
      raw = await fetchDirect(method, url, options)
    }
  } catch (err) {
    console.error('[milton-sandbox] Zotero.HTTP.request failed', url, err)
    if (err instanceof ZoteroHttpError) throw err
    throw new ZoteroHttpError(url, err)
  }
  console.log('[milton-sandbox] Zotero.HTTP.request resolved', { url, status: raw.status })

  let response: unknown
  if (options.responseType === 'document') {
    response = new DOMParser().parseFromString(raw.responseText, 'text/html')
  } else if (options.responseType === 'json') {
    response = raw.responseText.length > 0 ? JSON.parse(raw.responseText) : null
  } else if (options.responseType === undefined || options.responseType === 'text') {
    // XHR convention: when responseType is unset / 'text', xhr.response === xhr.responseText
    response = raw.responseText
  } else {
    throw new ZoteroHttpError(url, `unsupported responseType: ${options.responseType}`)
  }

  // Framework's Zotero.Utilities.Translate.request calls
  // xhr.getAllResponseHeaders() (XHR method). Provide an XHR-shaped surface
  // so it doesn't crash with `is not a function`.
  const responseHeadersString = raw.responseHeaders
  return {
    ...raw,
    response,
    getAllResponseHeaders: (): string => responseHeadersString,
  } as ZoteroHttpResponse
}

async function fetchDirect(
  method: string,
  url: string,
  options: ZoteroHttpRequestOptions,
): Promise<{ status: number; responseText: string; responseHeaders: string; responseURL: string }> {
  const ctrl = new AbortController()
  const timeoutMs = options.timeout ?? FETCH_TIMEOUT_DEFAULT_MS
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers: options.headers,
      body: options.body,
      signal: ctrl.signal,
      credentials: 'omit',
    })
    const responseText = await resp.text()
    return {
      status: resp.status,
      responseText,
      responseHeaders: serializeHeaders(resp.headers),
      responseURL: resp.url,
    }
  } finally {
    clearTimeout(t)
  }
}

async function fetchViaProxy(
  method: string,
  url: string,
  options: ZoteroHttpRequestOptions,
): Promise<{ status: number; responseText: string; responseHeaders: string; responseURL: string }> {
  const requestId = generateRequestId()
  const msg: FetchProxyRequest = {
    type: 'fetch-request',
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    method,
    url,
    options,
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new ZoteroHttpError(url, `fetch-proxy timeout after ${PROXY_TIMEOUT_MS}ms`))
    }, PROXY_TIMEOUT_MS)
    const handler = (event: MessageEvent): void => {
      if (!isFetchProxyResponse(event.data)) return
      const resp = event.data as FetchProxyResponse
      if (resp.requestId !== requestId) return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      if (resp.error !== undefined) {
        reject(new ZoteroHttpError(url, `proxy error [${resp.error.code}]: ${resp.error.message}`))
        return
      }
      if (resp.response === undefined) {
        reject(new ZoteroHttpError(url, 'fetch-response had neither response nor error'))
        return
      }
      resolve(resp.response)
    }
    window.addEventListener('message', handler)
    window.parent.postMessage(msg, '*')
  })
}

function serializeHeaders(headers: Headers): string {
  const lines: string[] = []
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`)
  })
  return lines.join('\r\n')
}

/**
 * Install our Zotero.HTTP onto the framework-provided Zotero global,
 * replacing upstream's http.js implementation. Call AFTER the framework
 * scripts have loaded.
 */
export function installZoteroHttp(zotero: ZoteroGlobal): void {
  zotero.HTTP = { request: zoteroHttpRequest }
}
