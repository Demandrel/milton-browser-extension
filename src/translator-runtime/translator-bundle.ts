// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Translator bundle — returns translators bundled at build time (BE-8-4).
// For BE-8-4 the bundle contains one entry (arXiv) used by the integration
// spike. BE-8-5 expands the bundle to the curated subset (~100 publishers)
// via a build-time pipeline; BE-8-5 also lands the CDN-fetch long-tail
// fallback that BE-8-4 originally planned (translator-fetcher.ts, deferred).
//
// Translator metadata header parsing: Zotero translator files start with a
// JSON-ish block followed by JS code. Header is parsed once on import;
// metadata is cached in-memory for the lifetime of the sandbox page.

import type { BundledTranslator, TranslatorMetadata } from './zotero-types'
import arxivSource from './translators/arXiv.org.js?raw'

interface BundleEntry {
  source: string
  parsed?: BundledTranslator
}

interface ParsedHeader {
  metadata: TranslatorMetadata
  bodyStart: number
}

function parseTranslatorHeader(source: string): ParsedHeader {
  // Header is the first balanced `{ ... }` block. Skip leading whitespace
  // and `//` line comments (the vendoring header we prepend at Task 6).
  // Find via brace counting; string literals may contain escaped braces.
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    break
  }
  if (source[i] !== '{') {
    throw new TranslatorMalformedError('header does not start with { after skipping comments + whitespace')
  }
  let depth = 0
  let end = -1
  for (let j = i; j < source.length; j++) {
    const c = source[j]
    if (c === '"') {
      // Skip string literal
      j++
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\') j++
        j++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = j + 1
        break
      }
    }
  }
  if (end === -1) {
    throw new TranslatorMalformedError('unbalanced braces in header')
  }
  const headerStr = source.slice(i, end)
  let metadata: TranslatorMetadata
  try {
    metadata = JSON.parse(headerStr) as TranslatorMetadata
  } catch (err) {
    throw new TranslatorMalformedError(`header JSON parse failed: ${String(err)}`)
  }
  if (typeof metadata.translatorID !== 'string' || metadata.translatorID.length === 0) {
    throw new TranslatorMalformedError('missing translatorID in header')
  }
  return { metadata, bodyStart: end }
}

export class TranslatorMalformedError extends Error {
  constructor(reason: string) {
    super(`Translator malformed: ${reason}`)
    this.name = 'TranslatorMalformedError'
  }
}

// Build-time registry: each entry sourced via Vite ?raw import.
// BE-8-5 generates a larger registry programmatically.
const REGISTRY: Record<string, BundleEntry> = {
  arxiv: { source: arxivSource },
}

let idIndex: Map<string, string> | null = null

function buildIdIndex(): Map<string, string> {
  const idx = new Map<string, string>()
  for (const [key, entry] of Object.entries(REGISTRY)) {
    const { metadata, bodyStart } = parseTranslatorHeader(entry.source)
    entry.parsed = { metadata, body: entry.source.slice(bodyStart) }
    idx.set(metadata.translatorID, key)
  }
  return idx
}

export function getBundledTranslator(translatorID: string): BundledTranslator | null {
  if (idIndex === null) {
    idIndex = buildIdIndex()
  }
  const key = idIndex.get(translatorID)
  if (key === undefined) return null
  const entry = REGISTRY[key]
  return entry.parsed ?? null
}

export function listBundledTranslatorIDs(): string[] {
  if (idIndex === null) {
    idIndex = buildIdIndex()
  }
  return [...idIndex.keys()]
}

// Test seam: reset the lazy index (called by tests that mutate REGISTRY).
export function _resetIdIndexForTests(): void {
  idIndex = null
}
