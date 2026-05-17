// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-6: Active-tab rendered DOM extraction primitive. The popup invokes
// `scrapeActiveTabHtml` to capture the page the user is looking at —
// crucially, AFTER any client-side rendering AND past any
// Cloudflare/Anubis bot-check cookies the user has already cleared. This
// is the foundation of the Class 3 capture flow (Charter v2 architecture
// diagram line 88-92): translator runs against the user's session, not
// against a server-side fetch that the publisher rate-limits / blocks.
//
// Permissions: `activeTab` (declared) grants `chrome.scripting.executeScript`
// rights on the active tab WHEN the user invokes the action (popup click).
// `'scripting'` permission (declared in manifest.config.ts) makes the API
// callable. No broad host_permissions needed — `activeTab` IS the grant.
//
// Size guard: capped at 2 MiB (rough proxy via String.length under V8's
// UTF-16 storage; reject larger pages with HTML_TOO_LARGE → popup falls
// back to server flow which has its own bounded payload size). Heavy SPAs
// (e.g., academic papers with embedded MathJax + supplementary tables)
// can produce 5-10 MB `outerHTML` strings — passing those through
// chrome.scripting's structured-clone serializer + the sandbox postMessage
// is wasteful when the server-flow fallback exists.

import { isRestrictedUrl } from '../popup/popup-helpers'

const MAX_HTML_BYTES = 2 * 1024 * 1024 // 2 MiB

export type PageContextErrorCode =
  | 'SCRIPTING_FAILED'
  | 'NO_RESULT'
  | 'RESTRICTED_URL'
  | 'TAB_GONE'
  | 'HTML_TOO_LARGE'

export class PageContextError extends Error {
  readonly code: PageContextErrorCode
  constructor(code: PageContextErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'PageContextError'
    this.code = code
  }
}

export interface PageContext {
  html: string
  finalUrl: string
}

/**
 * Run `() => ({ html: document.documentElement.outerHTML, finalUrl: document.location.href })`
 * in the active tab via `chrome.scripting.executeScript`. Default `world: 'ISOLATED'`
 * is sufficient — we only read DOM properties that are exposed in the isolated
 * world (querying `documentElement` and `location` does NOT require MAIN world
 * access since extensions share the DOM, just not the page's JS context).
 *
 * The function passed to executeScript runs in the page's content-script context;
 * its return value is structured-cloned back to the caller. Plain objects with
 * string fields serialize cleanly.
 */
export async function scrapeActiveTabHtml(
  tabId: number,
  url: string,
): Promise<PageContext> {
  if (isRestrictedUrl(url)) {
    throw new PageContextError(
      'RESTRICTED_URL',
      `URL scheme not supported for scripting: ${url}`,
    )
  }
  let results: chrome.scripting.InjectionResult<PageContext>[]
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        html: document.documentElement.outerHTML,
        finalUrl: document.location.href,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Chrome surfaces tab-gone failures with messages like "No tab with id ..."
    // or "The tab was closed.". Restricted-URL leaks past our pre-check
    // surface as "Cannot access a chrome:// URL" / "Extension manifest must
    // request permission to access this host.".
    if (/no tab with id|tab was closed/i.test(msg)) {
      throw new PageContextError('TAB_GONE', msg)
    }
    if (/cannot access|must request permission/i.test(msg)) {
      throw new PageContextError('RESTRICTED_URL', msg)
    }
    throw new PageContextError('SCRIPTING_FAILED', msg)
  }
  if (results.length === 0 || results[0]?.result === undefined) {
    throw new PageContextError(
      'NO_RESULT',
      'chrome.scripting.executeScript returned no result frame',
    )
  }
  const { html, finalUrl } = results[0].result
  if (typeof html !== 'string' || typeof finalUrl !== 'string') {
    throw new PageContextError(
      'NO_RESULT',
      'executeScript result frame missing html/finalUrl strings',
    )
  }
  if (html.length > MAX_HTML_BYTES) {
    throw new PageContextError(
      'HTML_TOO_LARGE',
      `rendered HTML ${html.length} chars exceeds ${MAX_HTML_BYTES}-char cap`,
    )
  }
  return { html, finalUrl }
}

export const PAGE_CONTEXT_CONSTANTS = {
  MAX_HTML_BYTES,
} as const
