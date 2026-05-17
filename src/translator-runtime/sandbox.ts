// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// MV3 sandbox page bootstrap for the zotero/translate runtime.
//
// Loads the upstream framework JS files (vendored at vendor/zotero-translate/
// — pinned by submodule SHA d08300c2) as a single dynamically-injected
// script element. Sandbox-page CSP permits eval/Function constructor; script
// element execution falls under the same allowance and gives us the same
// global-scope behavior the framework expects (the upstream example
// loads its files via <script src> tags in the same order).
//
// After the framework loads, installs Milton's adapters on the Zotero global:
//   - Zotero.HTTP        ← zotero-http.ts (fetch-based)
//   - Zotero.Translators ← zotero-translators.ts (in-memory registry)
//   - Zotero.Translate.ItemSaver ← zotero-translate.ts (collecting)
//   - Zotero.Schema.init / Zotero.Date.init from vendored JSON
//
// BE-8-4 deviation: translators are bundled at build time (see
// translator-bundle.ts), NOT fetched from a remote CDN at runtime. Upstream
// README explicitly recommends bundling.

import zoteroJs from '../../vendor/zotero-translate/src/zotero.js?raw'
import promiseJs from '../../vendor/zotero-translate/src/promise.js?raw'
import openurlJs from '../../vendor/zotero-translate/modules/utilities/openurl.js?raw'
import dateJs from '../../vendor/zotero-translate/modules/utilities/date.js?raw'
import xregexpAllJs from '../../vendor/zotero-translate/modules/utilities/xregexp-all.js?raw'
import xregexpUnicodeJs from '../../vendor/zotero-translate/modules/utilities/xregexp-unicode-zotero.js?raw'
import utilitiesJs from '../../vendor/zotero-translate/modules/utilities/utilities.js?raw'
import utilitiesItemJs from '../../vendor/zotero-translate/modules/utilities/utilities_item.js?raw'
import schemaJs from '../../vendor/zotero-translate/modules/utilities/schema.js?raw'
import zoteroTypeSchemaJs from '../../vendor/zotero-translate/modules/utilities/resource/zoteroTypeSchemaData.js?raw'
import cachedTypesJs from '../../vendor/zotero-translate/modules/utilities/cachedTypes.js?raw'
import utilitiesTranslateJs from '../../vendor/zotero-translate/src/utilities_translate.js?raw'
import debugJs from '../../vendor/zotero-translate/src/debug.js?raw'
import httpJs from '../../vendor/zotero-translate/src/http.js?raw'
import translatorJs from '../../vendor/zotero-translate/src/translator.js?raw'
import translatorsJs from '../../vendor/zotero-translate/src/translators.js?raw'
import repoJs from '../../vendor/zotero-translate/src/repo.js?raw'
import translateJs from '../../vendor/zotero-translate/src/translation/translate.js?raw'
import sandboxManagerJs from '../../vendor/zotero-translate/src/translation/sandboxManager.js?raw'
import translateItemJs from '../../vendor/zotero-translate/src/translation/translate_item.js?raw'

import schemaJson from '../../vendor/zotero-translate/modules/utilities/resource/schema/global/schema.json'
import dateFormatsJson from '../../vendor/zotero-translate/modules/utilities/resource/dateFormats.json'

import { installZoteroHttp } from './zotero-http'
import { installZoteroTranslators, registerTranslator } from './zotero-translators'
import { installZoteroItemSaver, translateWithTimeout, TranslatorTimeoutError } from './zotero-translate'
import {
  _setVerifiedSet,
  getBundledTranslator,
  listBundledTranslatorIDs,
  verifyAllBundleIntegrity,
} from './translator-bundle'
import {
  ARXIV_TRANSLATOR_ID,
  isFromExpectedSource,
  isTranslateRequest,
  makeTranslateResponse,
  PROTOCOL_VERSION,
} from './host-bridge'
import type { ZoteroGlobal, ZoteroItem } from './zotero-types'

const FRAMEWORK_SOURCES: ReadonlyArray<[string, string]> = [
  ['src/zotero.js', zoteroJs],
  ['src/promise.js', promiseJs],
  ['modules/utilities/openurl.js', openurlJs],
  ['modules/utilities/date.js', dateJs],
  ['modules/utilities/xregexp-all.js', xregexpAllJs],
  ['modules/utilities/xregexp-unicode-zotero.js', xregexpUnicodeJs],
  ['modules/utilities/utilities.js', utilitiesJs],
  ['modules/utilities/utilities_item.js', utilitiesItemJs],
  ['modules/utilities/schema.js', schemaJs],
  ['modules/utilities/resource/zoteroTypeSchemaData.js', zoteroTypeSchemaJs],
  ['modules/utilities/cachedTypes.js', cachedTypesJs],
  ['src/utilities_translate.js', utilitiesTranslateJs],
  ['src/debug.js', debugJs],
  ['src/http.js', httpJs],
  ['src/translator.js', translatorJs],
  ['src/translators.js', translatorsJs],
  ['src/repo.js', repoJs],
  ['src/translation/translate.js', translateJs],
  ['src/translation/sandboxManager.js', sandboxManagerJs],
  ['src/translation/translate_item.js', translateItemJs],
]

function loadFrameworkSync(): void {
  // Concatenate all framework files with file-path markers (for stack traces
  // when something throws) and execute as a single script. Script-element
  // injection mimics the upstream example/index.html loading model and gives
  // us global-scope evaluation (top-level var declarations leak to window),
  // which the framework expects.
  const combined = FRAMEWORK_SOURCES
    .map(([path, source]) => `\n/* ===== ${path} ===== */\n${source}`)
    .join('\n')
  const script = document.createElement('script')
  script.textContent = combined
  document.head.appendChild(script)
}

function getZotero(): ZoteroGlobal {
  const z = (window as Window & { Zotero?: ZoteroGlobal }).Zotero
  if (z === undefined) {
    throw new Error('Zotero global not present after framework load — framework script tag failed silently?')
  }
  return z
}

function bootstrap(): void {
  loadFrameworkSync()
  const Zotero = getZotero()

  // Replace upstream stubs with Milton's adapters.
  installZoteroHttp(Zotero)
  installZoteroTranslators(Zotero)
  installZoteroItemSaver(Zotero)

  // Initialize schema + date formats per upstream README requirement.
  if (Zotero.Schema?.init !== undefined) {
    Zotero.Schema.init(schemaJson)
  }
  if (Zotero.Date?.init !== undefined) {
    Zotero.Date.init(dateFormatsJson)
  }

  // Surface framework debug logs to console so we can see translator
  // progress (BE-8-4 instrumentation; can be silenced later).
  ;(Zotero as unknown as { debug: (...a: unknown[]) => void }).debug = (...a: unknown[]) => {
    console.log('[zotero.debug]', ...a)
  }

  // Patch Zotero.Translate.Web.setDocument to handle DOMParser-parsed docs
  // (their doc.location can be null per HTML spec [Unforgeable] when our
  // parseHtmlAsDocument override fails to apply). Original implementation
  // does `this.setLocation(doc.location.href, this.rootDocument.location.href)`
  // which crashes on null. We skip the inner setLocation call when
  // _miltonFallbackUrl is set; caller is responsible for setLocation BEFORE
  // setDocument.
  const TranslateWebProto = (Zotero.Translate as unknown as { Web: { prototype: Record<string, unknown> } }).Web.prototype
  const origSetDocument = TranslateWebProto.setDocument as (this: unknown, doc: Document) => void
  TranslateWebProto.setDocument = function (this: { document?: Document; rootDocument?: Document; _miltonFallbackUrl?: string; setLocation: (loc: string, root: string) => void }, doc: Document): void {
    if (doc.location === null && typeof this._miltonFallbackUrl === 'string') {
      this.document = doc
      if (this.rootDocument === undefined) {
        this.rootDocument = doc
      }
      this.setLocation(this._miltonFallbackUrl, this._miltonFallbackUrl)
    } else {
      origSetDocument.call(this, doc)
    }
  } as unknown as (typeof TranslateWebProto.setDocument)

  console.log('[milton-sandbox] zotero/translate runtime loaded; adapters installed + setDocument patched')
}

/**
 * AC6 — Bundle integrity check. Runs ONCE at bootstrap, BEFORE any
 * translate-request handler arms. Hashes every REGISTRY entry's source
 * bytes via crypto.subtle.digest('SHA-256', ...) and compares against the
 * build-time pin (translator-bundle-pin.json). UUIDs that pass land in
 * `verifiedSet`; subsequent getBundledTranslator() calls gate on it.
 *
 * If verification fails for some translators, log a warning naming them
 * but DON'T crash — the lazy CDN-fetch path is the recovery and the
 * extension stays usable for the translators that did verify.
 */
async function bootstrapIntegrity(): Promise<void> {
  const total = listBundledTranslatorIDs().length
  const verified = await verifyAllBundleIntegrity()
  _setVerifiedSet(verified)
  if (verified.size === total) {
    console.log(`[milton-sandbox] bundle integrity: ${verified.size}/${total} translators verified`)
  } else {
    console.warn(
      `[milton-sandbox] bundle integrity: ${verified.size}/${total} translators verified — ` +
        `${total - verified.size} failed (see preceding warnings); ` +
        `failed translators fall back to lazy CDN-fetch (Task 5)`,
    )
  }
}

/**
 * DOMParser-produced documents have `location === null` (HTML spec — they
 * aren't associated with a Window). Document.location is `[Unforgeable]`
 * so we can't override the instance property directly. Instead, wrap the
 * doc in a Proxy that intercepts `.location` reads and returns a
 * Location-shaped object; methods are bound to the real target so DOM
 * methods (querySelector, etc.) keep working.
 *
 * Also injects a <base> element so doc.baseURI returns the original URL.
 */
function parseHtmlAsDocument(html: string, url: string): Document {
  const realDoc = new DOMParser().parseFromString(html, 'text/html')
  // Inject <base> so doc.baseURI returns the original URL.
  const head = realDoc.querySelector('head') ?? realDoc.documentElement
  const existingBase = head.querySelector('base')
  if (existingBase === null) {
    const baseEl = realDoc.createElement('base')
    baseEl.href = url
    head.insertBefore(baseEl, head.firstChild)
  }
  // Build a Location-shaped surface from the URL.
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
  // Proxy the doc: intercept `.location` reads, bind methods to the
  // real target so DOM internal-slot accesses (querySelector, etc.) work.
  const proxy = new Proxy(realDoc, {
    get(target: Document, prop: string | symbol): unknown {
      if (prop === 'location') {
        return fakeLocation
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value === 'function') {
        return value.bind(target)
      }
      return value
    },
  })
  return proxy as Document
}

interface RunTranslationArgs {
  url: string
  translatorId: string
  html?: string
  timeoutMs?: number
}

async function runTranslation(args: RunTranslationArgs): Promise<ZoteroItem[]> {
  console.log('[milton-sandbox] runTranslation start', { url: args.url, translatorId: args.translatorId, hasHtml: args.html !== undefined })
  const Zotero = getZotero()
  const bundled = getBundledTranslator(args.translatorId)
  if (bundled === null) {
    throw new Error(`Translator ${args.translatorId} not in bundle`)
  }
  registerTranslator(bundled)
  console.log('[milton-sandbox] translator registered', bundled.metadata.label)

  let html = args.html
  if (html === undefined) {
    if (Zotero.HTTP === undefined) {
      throw new Error('Zotero.HTTP not installed')
    }
    const resp = await Zotero.HTTP.request('GET', args.url, { responseType: 'text' })
    if (resp.status !== 200) {
      throw new Error(`Failed to fetch ${args.url}: HTTP ${resp.status}`)
    }
    html = resp.responseText
  }
  // After this branch html is guaranteed defined; assert for type-narrowing.
  const finalHtml: string = html

  const collected: ZoteroItem[] = []

  if (Zotero.Translate?.Web === undefined) {
    throw new Error('Zotero.Translate.Web missing — framework lift failed')
  }
  const translate = new Zotero.Translate.Web()
  ;(translate as unknown as { _miltonFallbackUrl: string })._miltonFallbackUrl = args.url
  translate.setLocation(args.url)
  console.log('[milton-sandbox] setLocation OK')
  const doc = parseHtmlAsDocument(finalHtml, args.url)
  translate.setDocument(doc)
  console.log('[milton-sandbox] setDocument OK')
  // runMode=1 (RUN_MODE_IN_BROWSER) — required by Translate.Web._translateTranslatorLoaded
  // to dispatch to in-browser detectWeb/doWeb (else branch falls through silently).
  translate.setTranslator({ ...bundled.metadata, code: bundled.body, runMode: 1 })
  console.log('[milton-sandbox] setTranslator OK; translator.runMode=1')
  translate.setHandler('itemDone', (...handlerArgs: unknown[]) => {
    console.log('[milton-sandbox] itemDone handler fired', handlerArgs[1])
    const item = handlerArgs[1] as ZoteroItem | undefined
    if (item !== undefined) collected.push(item)
  })
  translate.setHandler('error', (...handlerArgs: unknown[]) => {
    console.error('[milton-sandbox] translate error handler fired', handlerArgs)
  })
  translate.setHandler('done', (...handlerArgs: unknown[]) => {
    console.log('[milton-sandbox] translate done handler fired', handlerArgs)
  })
  console.log('[milton-sandbox] calling translate()')
  await translateWithTimeout(() => translate.translate(), args.translatorId, args.timeoutMs)
  console.log('[milton-sandbox] translate() resolved with', collected.length, 'items')
  return collected
}

function wirePostMessageListener(): void {
  // Translate-requests are accepted ONLY from window.parent. When the sandbox
  // is embedded as an iframe inside spike-page.html (BE-8-4 spike harness) or
  // BE-8-6's offscreen document, the parent is the legitimate sender. Direct
  // top-level navigation to sandbox.html has window.parent === window, which
  // would also be self-consistent.
  const allowedSources: ReadonlyArray<Window | null> = [window.parent]
  window.addEventListener('message', async (event: MessageEvent) => {
    if (!isFromExpectedSource(event, allowedSources)) return
    const msg = event.data
    if (!isTranslateRequest(msg)) return

    try {
      const items = await runTranslation({
        url: msg.url,
        translatorId: msg.translatorId,
        html: msg.html,
        timeoutMs: msg.timeoutMs,
      })
      const reply = makeTranslateResponse({ requestId: msg.requestId, items })
      ;(event.source as Window | null)?.postMessage(reply, { targetOrigin: '*' })
    } catch (err) {
      const reply = makeTranslateResponse({
        requestId: msg.requestId,
        error: {
          code: err instanceof TranslatorTimeoutError ? 'TIMEOUT' : 'RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      })
      ;(event.source as Window | null)?.postMessage(reply, { targetOrigin: '*' })
    }
  })
}

function wireSpikeTrigger(): void {
  // Dev-internal proof-of-life. Exposes a console-callable function on
  // sandbox `window`; returns the extracted items (or throws). Pierre uses
  // this for the Task 8 G17-1 smoke (AC10 scenarios 3-5).
  ;(window as Window & { miltonRuntimeSpike?: (url: string) => Promise<ZoteroItem[]> }).miltonRuntimeSpike =
    async (url: string) => runTranslation({ url, translatorId: ARXIV_TRANSLATOR_ID })
}

async function bootstrapAll(): Promise<void> {
  bootstrap()
  // Integrity verify BEFORE wiring listeners so a translate-request that
  // arrives during cold-start never sees an unverified-but-callable
  // getBundledTranslator (it returns null until _setVerifiedSet runs).
  await bootstrapIntegrity()
  wirePostMessageListener()
  wireSpikeTrigger()
  console.log(`[milton-sandbox] ready (protocol v${PROTOCOL_VERSION})`)
}

bootstrapAll().catch((err) => {
  console.error('[milton-sandbox] bootstrap failed:', err)
})
