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
import { getBundledTranslator } from './translator-bundle'
import {
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

  console.log('[milton-sandbox] zotero/translate runtime loaded; adapters installed')
}

interface RunTranslationArgs {
  url: string
  translatorId: string
  html?: string
  timeoutMs?: number
}

async function runTranslation(args: RunTranslationArgs): Promise<ZoteroItem[]> {
  const Zotero = getZotero()
  const bundled = getBundledTranslator(args.translatorId)
  if (bundled === null) {
    throw new Error(`Translator ${args.translatorId} not in bundle`)
  }
  registerTranslator(bundled)

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
  translate.setLocation(args.url)
  const doc = new DOMParser().parseFromString(finalHtml, 'text/html')
  translate.setDocument(doc)
  translate.setTranslator({ ...bundled.metadata, code: bundled.body })
  translate.setHandler('itemDone', (...handlerArgs: unknown[]) => {
    // upstream signature: (translate, item) — we want the item
    const item = handlerArgs[1] as ZoteroItem | undefined
    if (item !== undefined) collected.push(item)
  })

  await translateWithTimeout(() => translate.translate(), args.translatorId, args.timeoutMs)
  return collected
}

function wirePostMessageListener(): void {
  window.addEventListener('message', async (event: MessageEvent) => {
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
    async (url: string) => {
      const ARXIV_TRANSLATOR_ID = 'ecddda2e-4fc6-4aea-9f17-ef3b56d7377a'
      return runTranslation({ url, translatorId: ARXIV_TRANSLATOR_ID })
    }
}

try {
  bootstrap()
  wirePostMessageListener()
  wireSpikeTrigger()
  console.log(`[milton-sandbox] ready (protocol v${PROTOCOL_VERSION})`)
} catch (err) {
  console.error('[milton-sandbox] bootstrap failed:', err)
}
