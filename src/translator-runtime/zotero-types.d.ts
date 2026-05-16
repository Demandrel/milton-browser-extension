// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Ambient typings for the upstream zotero/translate framework + Milton's
// adapter surface. Upstream ships no TypeScript types; types here are
// LOAD-BEARING — verify against vendor/zotero-translate/ source before
// changing. Treat anything beyond what we actually call as best-effort.

declare global {
  interface Window {
    Zotero?: ZoteroGlobal
    miltonRuntimeSpike?: (url: string) => Promise<unknown>
  }
}

export interface ZoteroItemCreator {
  firstName?: string
  lastName?: string
  name?: string
  creatorType: string
}

export interface ZoteroItem {
  itemType: string
  title?: string
  creators?: ZoteroItemCreator[]
  date?: string
  abstractNote?: string
  DOI?: string
  url?: string
  publicationTitle?: string
  // arXiv translator emits extra fields (archiveID, libraryCatalog, etc.)
  // Index signature kept open since translators set arbitrary fields.
  [key: string]: unknown
}

export interface TranslatorMetadata {
  translatorID: string
  label: string
  creator?: string
  target?: string
  minVersion?: string
  maxVersion?: string
  priority?: number
  inRepository?: boolean
  translatorType?: number
  browserSupport?: string
  lastUpdated?: string
}

export interface BundledTranslator {
  metadata: TranslatorMetadata
  body: string
}

export interface ZoteroHttpRequestOptions {
  responseType?: 'text' | 'document' | 'json'
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

export interface ZoteroHttpResponse {
  status: number
  responseText: string
  response?: unknown
  responseHeaders: string
  responseURL: string
}

export interface ZoteroHttp {
  request: (
    method: string,
    url: string,
    options?: ZoteroHttpRequestOptions,
  ) => Promise<ZoteroHttpResponse>
}

export interface ZoteroTranslatorsRegistry {
  get: (translatorID: string) => unknown | null
  getWebTranslators: (url: string, rootUrl?: string) => Promise<[unknown[], unknown[]]>
}

export interface ZoteroItemSaverInstance {
  saveItems: (items: ZoteroItem[], callback: (success: boolean, items: ZoteroItem[]) => void) => void
}

export interface ZoteroGlobal {
  Translators?: ZoteroTranslatorsRegistry
  HTTP?: ZoteroHttp
  Schema?: { init: (data: unknown) => void; [k: string]: unknown }
  Date?: { init: (data: unknown) => void; [k: string]: unknown }
  Translate?: {
    Web: new () => ZoteroTranslateWebInstance
    ItemSaver?: new (...args: unknown[]) => ZoteroItemSaverInstance
    [k: string]: unknown
  }
  debug?: (msg: string, level?: number) => void
  [k: string]: unknown
}

export interface ZoteroTranslateWebInstance {
  setTranslator: (translator: unknown) => void
  setDocument: (doc: Document) => void
  setString: (html: string) => void
  setHandler: (event: string, handler: (...args: unknown[]) => void) => void
  setLocation: (location: string, rootLocation?: string) => void
  getTranslators: () => Promise<unknown[]>
  translate: (options?: { libraryID?: number; saveAttachments?: boolean }) => Promise<unknown>
}

export type TranslateRequest = {
  type: 'translate-request'
  protocolVersion: 1
  requestId: string
  url: string
  translatorId: string
  html?: string
  timeoutMs?: number
}

export type TranslateResponse = {
  type: 'translate-response'
  protocolVersion: 1
  requestId: string
  items?: ZoteroItem[]
  error?: { code: string; message: string; cause?: string }
}

export type FetchProxyRequest = {
  type: 'fetch-request'
  protocolVersion: 1
  requestId: string
  method: string
  url: string
  options?: ZoteroHttpRequestOptions
}

export type FetchProxyResponse = {
  type: 'fetch-response'
  protocolVersion: 1
  requestId: string
  response?: ZoteroHttpResponse
  error?: { code: string; message: string }
}
