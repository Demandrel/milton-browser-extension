// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Extension-origin wrapper page that hosts the sandbox iframe + exposes
// window.miltonRuntimeSpike. The wrapper pre-fetches the target URL (this
// page runs at extension origin so manifest host_permissions apply → no
// CORS) and posts the HTML into the sandbox via the existing postMessage
// translate-request protocol. Sandbox runs translator and posts items back.
//
// Architecturally this is the BE-8-4 spike harness only. BE-8-6 will
// generalize this via an offscreen document + background SW so the popup
// state machine can drive translation without the user opening a special
// page.

import {
  ARXIV_TRANSLATOR_ID,
  generateRequestId,
  isFetchProxyRequest,
  isFromExpectedSource,
  isTranslateResponse,
  makeTranslateRequest,
  PROTOCOL_VERSION,
} from './host-bridge'
import type { FetchProxyResponse, ZoteroItem } from './zotero-types'

const SPIKE_TIMEOUT_MS = 30_000

function getSandboxWindow(): Window {
  const iframe = document.getElementById('sandbox') as HTMLIFrameElement | null
  if (iframe === null || iframe.contentWindow === null) {
    throw new Error('Sandbox iframe not present in spike-page DOM')
  }
  return iframe.contentWindow
}

function waitForResponse(requestId: string, sandboxWindow: Window): Promise<ZoteroItem[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error(`Sandbox did not reply within ${SPIKE_TIMEOUT_MS}ms (requestId ${requestId})`))
    }, SPIKE_TIMEOUT_MS)

    const handler = (event: MessageEvent): void => {
      // Replies are only legitimate from the sandbox iframe we asked.
      if (!isFromExpectedSource(event, [sandboxWindow])) return
      if (!isTranslateResponse(event.data)) return
      if (event.data.requestId !== requestId) return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      if (event.data.error !== undefined) {
        reject(new Error(`sandbox error [${event.data.error.code}]: ${event.data.error.message}`))
        return
      }
      resolve(event.data.items ?? [])
    }
    window.addEventListener('message', handler)
  })
}

async function spike(url: string): Promise<ZoteroItem[]> {
  // Pre-fetch the target HTML from extension origin — manifest's
  // host_permissions cover arxiv.org / export.arxiv.org, so CORS is not
  // an obstacle here (unlike the sandbox, which is opaque-origin).
  const resp = await fetch(url, { credentials: 'omit' })
  if (!resp.ok) {
    throw new Error(`Pre-fetch of ${url} failed: HTTP ${resp.status}`)
  }
  const html = await resp.text()

  const requestId = generateRequestId()
  const msg = makeTranslateRequest({
    requestId,
    url,
    translatorId: ARXIV_TRANSLATOR_ID,
    html,
  })

  // Wait for sandbox iframe to be ready (loads framework synchronously,
  // but iframe contentWindow may not have run scripts yet on initial nav).
  // Tiny retry: if first postMessage doesn't elicit a reply within a few
  // hundred ms we'll have already failed the response promise's timeout.
  const sandboxWindow = getSandboxWindow()
  const responsePromise = waitForResponse(requestId, sandboxWindow)
  sandboxWindow.postMessage(msg, '*')
  return await responsePromise
}

;(window as Window & { miltonRuntimeSpike?: typeof spike }).miltonRuntimeSpike = spike

// Fetch-proxy handler — sandbox iframe runs at opaque origin and CANNOT
// make cross-origin fetches even with manifest host_permissions. Sandbox
// posts a fetch-request to us (spike-page = extension origin); we perform
// the fetch (host_permissions apply here) and post a fetch-response back.
function serializeHeaders(headers: Headers): string {
  const lines: string[] = []
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`)
  })
  return lines.join('\r\n')
}

// fetch-proxy requests are only legitimate from the sandbox iframe we host.
// Compute the allowed window lazily inside the listener so it's resolved
// after the iframe loads.
window.addEventListener('message', async (event: MessageEvent) => {
  const iframe = document.getElementById('sandbox') as HTMLIFrameElement | null
  const allowedSources: ReadonlyArray<Window | null> = [iframe?.contentWindow ?? null]
  if (!isFromExpectedSource(event, allowedSources)) return
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

console.log(
  `[milton-spike-page] ready (protocol v${PROTOCOL_VERSION}). Call: await miltonRuntimeSpike('https://arxiv.org/abs/...')`,
)
