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

import type { ZoteroGlobal, ZoteroHttpRequestOptions, ZoteroHttpResponse } from './zotero-types'

const FETCH_TIMEOUT_DEFAULT_MS = 30000

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
 * Translators expect a `Zotero.HTTP.request` returning
 * `{status, responseText, responseHeaders, responseURL}`. responseType drives
 * additional parsing (`text` default, `document` parses via DOMParser, `json`
 * parses JSON). Errors throw typed `ZoteroHttpError`.
 */
export async function zoteroHttpRequest(
  method: string,
  url: string,
  options: ZoteroHttpRequestOptions = {},
): Promise<ZoteroHttpResponse> {
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
    let response: unknown = undefined
    if (options.responseType === 'document') {
      response = new DOMParser().parseFromString(responseText, 'text/html')
    } else if (options.responseType === 'json') {
      response = responseText.length > 0 ? JSON.parse(responseText) : null
    } else if (options.responseType !== undefined && options.responseType !== 'text') {
      throw new ZoteroHttpError(url, `unsupported responseType: ${options.responseType}`)
    }

    return {
      status: resp.status,
      responseText,
      response,
      responseHeaders: serializeHeaders(resp.headers),
      responseURL: resp.url,
    }
  } catch (err) {
    if (err instanceof ZoteroHttpError) throw err
    throw new ZoteroHttpError(url, err)
  } finally {
    clearTimeout(t)
  }
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
