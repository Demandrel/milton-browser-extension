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
import {
  generateRequestId,
  isFetchProxyResponse,
  isFromExpectedSource,
  PROTOCOL_VERSION,
} from './host-bridge'

const FETCH_TIMEOUT_DEFAULT_MS = 30000
const PROXY_TIMEOUT_DEFAULT_MS = 30000

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
 * BE-8-6 (also fixes BE-8-4 issue #7): minimal stub matching the upstream
 * `Zotero.HTTP.UnexpectedStatusException` shape referenced by
 * `vendor/zotero-translate/src/utilities_translate.js:341` for bot-challenge
 * retry detection. We don't actually raise the bot-challenge retry path
 * (no Zotero.BrowserRequest registered) so this exists primarily to make
 * `instanceof Zotero.HTTP.UnexpectedStatusException` evaluate to false
 * without crashing the lookup.
 */
export class UnexpectedStatusException extends Error {
  readonly status: number
  readonly xmlhttp: unknown
  constructor(xmlhttp: unknown, message: string, status: number) {
    super(message)
    this.name = 'UnexpectedStatusException'
    this.status = status
    this.xmlhttp = xmlhttp
  }
}

/**
 * BE-8-6: wrap a DOMParser-produced Document with a Proxy that fakes
 * `.location` (DOMParser docs have location === null per HTML spec) and
 * unwraps itself when passed as a method-call argument (e.g.,
 * `doc.evaluate(xpath, doc, ...)` — platform's evaluate rejects Proxies
 * via internal-slot type check). Extracted from sandbox.ts:parseHtmlAsDocument
 * so the same wrap can be reused by `processDocuments` below.
 */
export function wrapDocument(doc: Document, url: string): Document {
  // Inject <base> so doc.baseURI returns the original URL.
  const head = doc.querySelector('head') ?? doc.documentElement
  if (head !== null && head.querySelector('base') === null) {
    const baseEl = doc.createElement('base')
    baseEl.href = url
    head.insertBefore(baseEl, head.firstChild)
  }
  const urlObj = new URL(url)
  const fakeLocation = {
    href: urlObj.href,
    origin: urlObj.origin,
    protocol: urlObj.protocol,
    host: urlObj.host,
    hostname: urlObj.hostname,
    port: urlObj.port,
    pathname: urlObj.pathname,
    search: urlObj.search,
    hash: urlObj.hash,
    toString: () => urlObj.href,
  }
  let proxy: Document
  proxy = new Proxy(doc, {
    get(target: Document, prop: string | symbol): unknown {
      if (prop === 'location') {
        return fakeLocation
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value === 'function') {
        const fn = value as (...a: unknown[]) => unknown
        return function (this: unknown, ...args: unknown[]) {
          const unwrapped = args.map((a) => (a === proxy ? target : a))
          return fn.apply(target, unwrapped)
        }
      }
      return value
    },
  }) as Document
  return proxy
}

/**
 * BE-8-6: fetch each URL, parse as HTML, wrap with fake-location Proxy,
 * pass to processor(doc). Returns the processor results array. Mirrors
 * upstream's `Zotero.HTTP.processDocuments` shape — translators rely on
 * it for follow-up fetches (e.g., DBLP's "selectItems then fetch each
 * record page").
 *
 * Sequential (not parallel) to keep memory bounded — a translator
 * resolving 100 search hits at once would otherwise spawn 100 concurrent
 * fetches + 100 concurrent DOMParsers + 100 in-flight Proxy docs. Most
 * translators select a small handful via Zotero.selectItems, so the
 * sequential cost is acceptable.
 */
export async function zoteroHttpProcessDocuments(
  urls: string[] | string,
  processor: (doc: Document) => unknown | Promise<unknown>,
): Promise<unknown[]> {
  const urlList = typeof urls === 'string' ? [urls] : urls
  const results: unknown[] = []
  for (const url of urlList) {
    const resp = await zoteroHttpRequest('GET', url, { responseType: 'document' })
    let doc = resp.response as Document
    if (doc !== null && doc.location === null) {
      doc = wrapDocument(doc, resp.responseURL || url)
    }
    const result = await processor(doc)
    results.push(result)
  }
  return results
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
  const timeoutMs = options.timeout ?? PROXY_TIMEOUT_DEFAULT_MS
  const msg: FetchProxyRequest = {
    type: 'fetch-request',
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    method,
    url,
    options,
  }
  // Only the parent window (spike-page / BE-8-6 offscreen doc) is allowed to
  // reply with a fetch-response. Capture the reference at call time so a
  // later reparent doesn't widen the trust boundary.
  const allowedSources: ReadonlyArray<Window | null> = [window.parent]
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new ZoteroHttpError(url, `fetch-proxy timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (event: MessageEvent): void => {
      if (!isFromExpectedSource(event, allowedSources)) return
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
  zotero.HTTP = {
    request: zoteroHttpRequest,
    // BE-8-6: framework + many translators (DBLP, etc.) call these.
    // processDocuments fetches multiple URLs + invokes processor per doc.
    // wrapDocument injects fake-location Proxy so doc.location.href works.
    // UnexpectedStatusException is referenced by utilities_translate.js's
    // bot-challenge retry catch — instanceof check must not throw.
    processDocuments: zoteroHttpProcessDocuments,
    wrapDocument,
    UnexpectedStatusException,
  } as unknown as ZoteroGlobal['HTTP']
}
