// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import {
  extractPdfAttachmentUrl,
  mapZoteroItemToPayload,
  mapZoteroItemTypeToConnector,
  parseYearFromDateString,
} from './zotero-item-to-payload'

describe('parseYearFromDateString', () => {
  it('extracts a 4-digit year from "2024"', () => {
    expect(parseYearFromDateString('2024')).toBe(2024)
  })
  it('extracts year from ISO date "2024-03-15"', () => {
    expect(parseYearFromDateString('2024-03-15')).toBe(2024)
  })
  it('extracts year from "March 2024"', () => {
    expect(parseYearFromDateString('March 2024')).toBe(2024)
  })
  it('returns 0 for "in press" (no year)', () => {
    expect(parseYearFromDateString('in press')).toBe(0)
  })
  it('returns 0 for empty / undefined', () => {
    expect(parseYearFromDateString('')).toBe(0)
    expect(parseYearFromDateString(undefined)).toBe(0)
  })
  it('rejects out-of-range years', () => {
    expect(parseYearFromDateString('1200')).toBe(0)
    expect(parseYearFromDateString('3000')).toBe(0)
  })
})

describe('mapZoteroItemTypeToConnector — itemType branches', () => {
  it('journalArticle → article', () => {
    expect(mapZoteroItemTypeToConnector('journalArticle')).toBe('article')
  })
  it('magazineArticle → article', () => {
    expect(mapZoteroItemTypeToConnector('magazineArticle')).toBe('article')
  })
  it('conferencePaper → conferencePaper', () => {
    expect(mapZoteroItemTypeToConnector('conferencePaper')).toBe('conferencePaper')
  })
  it('preprint → preprint', () => {
    expect(mapZoteroItemTypeToConnector('preprint')).toBe('preprint')
  })
  it('manuscript → preprint', () => {
    expect(mapZoteroItemTypeToConnector('manuscript')).toBe('preprint')
  })
  it('book → book', () => {
    expect(mapZoteroItemTypeToConnector('book')).toBe('book')
  })
  it('bookSection → chapter', () => {
    expect(mapZoteroItemTypeToConnector('bookSection')).toBe('chapter')
  })
  it('thesis → thesis', () => {
    expect(mapZoteroItemTypeToConnector('thesis')).toBe('thesis')
  })
  it('report → report', () => {
    expect(mapZoteroItemTypeToConnector('report')).toBe('report')
  })
  it('webpage → website', () => {
    expect(mapZoteroItemTypeToConnector('webpage')).toBe('website')
  })
  it('unknown type → other', () => {
    expect(mapZoteroItemTypeToConnector('audioRecording')).toBe('other')
  })
  it('undefined → other', () => {
    expect(mapZoteroItemTypeToConnector(undefined)).toBe('other')
  })
})

describe('mapZoteroItemToPayload', () => {
  it('maps full journal article', () => {
    const item = {
      itemType: 'journalArticle',
      title: 'Attention Is All You Need',
      creators: [
        { firstName: 'Ashish', lastName: 'Vaswani', creatorType: 'author' },
        { firstName: 'Noam', lastName: 'Shazeer', creatorType: 'author' },
      ],
      date: '2017-06-12',
      DOI: '10.48550/arXiv.1706.03762',
      abstractNote: 'The dominant sequence transduction models...',
      url: 'https://arxiv.org/abs/1706.03762',
      publicationTitle: 'NeurIPS',
    }
    const payload = mapZoteroItemToPayload(item, 'https://fallback.example')
    expect(payload.title).toBe('Attention Is All You Need')
    expect(payload.authors).toEqual([
      { firstName: 'Ashish', lastName: 'Vaswani' },
      { firstName: 'Noam', lastName: 'Shazeer' },
    ])
    expect(payload.year).toBe(2017)
    expect(payload.doi).toBe('10.48550/arXiv.1706.03762')
    expect(payload.abstract).toContain('dominant sequence')
    expect(payload.url).toBe('https://arxiv.org/abs/1706.03762')
    expect(payload.type).toBe('article')
    expect(payload.tagIds).toEqual([])
    expect(payload.newTagNames).toEqual([])
    expect(payload.projectIds).toEqual([])
    expect(payload.collectionIds).toEqual([])
  })

  it('filters non-author creators (editors, translators)', () => {
    const item = {
      itemType: 'journalArticle',
      title: 't',
      creators: [
        { firstName: 'A', lastName: 'Author', creatorType: 'author' },
        { firstName: 'E', lastName: 'Editor', creatorType: 'editor' },
        { firstName: 'T', lastName: 'Translator', creatorType: 'translator' },
      ],
    }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.authors).toEqual([{ firstName: 'A', lastName: 'Author' }])
  })

  it('handles fullName-only creators (no firstName/lastName split)', () => {
    const item = {
      itemType: 'journalArticle',
      title: 't',
      creators: [{ name: 'Plato', creatorType: 'author' }],
    }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.authors).toEqual([{ fullName: 'Plato' }])
  })

  it('passes DOI verbatim (no normalization, mirrors BE-4)', () => {
    const item = {
      itemType: 'journalArticle',
      title: 't',
      DOI: 'https://doi.org/10.1000/xyz',
    }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.doi).toBe('https://doi.org/10.1000/xyz')
  })

  it('uses fallbackUrl when item has no url', () => {
    const item = { itemType: 'journalArticle', title: 't' }
    const payload = mapZoteroItemToPayload(item, 'https://fallback.example/a')
    expect(payload.url).toBe('https://fallback.example/a')
  })

  it('item url wins over fallbackUrl', () => {
    const item = {
      itemType: 'journalArticle',
      title: 't',
      url: 'https://canonical.example/x',
    }
    const payload = mapZoteroItemToPayload(item, 'https://fallback.example/a')
    expect(payload.url).toBe('https://canonical.example/x')
  })

  it('omits year when date is unparseable', () => {
    const item = { itemType: 'journalArticle', title: 't', date: 'in press' }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.year).toBeUndefined()
  })

  it('omits abstract when missing', () => {
    const item = { itemType: 'journalArticle', title: 't' }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.abstract).toBeUndefined()
  })

  it('emits type=other when itemType is undefined and itemType field omitted entirely', () => {
    const item = { title: 't' }
    const payload = mapZoteroItemToPayload(item, 'url')
    // itemType undefined → mapper omits `type` (connector defaults to 'article').
    expect(payload.type).toBeUndefined()
  })

  it('emits type=other when itemType is unknown string', () => {
    const item = { itemType: 'audioRecording', title: 't' }
    const payload = mapZoteroItemToPayload(item, 'url')
    expect(payload.type).toBe('other')
  })
})

// ── BE-8-7: extractPdfAttachmentUrl ────────────────────────────────────────

describe('extractPdfAttachmentUrl', () => {
  it('returns the first PDF attachment URL', () => {
    const item = {
      attachments: [
        { url: 'https://x.example/paper.pdf', mimeType: 'application/pdf', title: 'Full Text' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('returns the FIRST PDF among multiple PDFs (first-match wins)', () => {
    const item = {
      attachments: [
        { url: 'https://x.example/first.pdf', mimeType: 'application/pdf' },
        { url: 'https://x.example/second.pdf', mimeType: 'application/pdf' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/first.pdf')
  })

  it('skips HTML attachments to find a PDF further down', () => {
    const item = {
      attachments: [
        { url: 'https://x.example/snapshot.html', mimeType: 'text/html' },
        { url: 'https://x.example/paper.pdf', mimeType: 'application/pdf' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('returns null when attachments is missing', () => {
    expect(extractPdfAttachmentUrl({})).toBeNull()
  })

  it('returns null when attachments is empty', () => {
    expect(extractPdfAttachmentUrl({ attachments: [] })).toBeNull()
  })

  it('returns null when no attachment has application/pdf mimeType', () => {
    const item = {
      attachments: [
        { url: 'https://x.example/snapshot.html', mimeType: 'text/html' },
        { url: 'https://x.example/data.json', mimeType: 'application/json' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBeNull()
  })

  it('matches case-insensitively (APPLICATION/PDF)', () => {
    const item = {
      attachments: [{ url: 'https://x.example/paper.pdf', mimeType: 'APPLICATION/PDF' }],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('skips attachments missing mimeType (BT10 defensive — does NOT throw)', () => {
    const item = {
      attachments: [
        { url: 'https://x.example/some.file', title: 'Supplementary' }, // no mimeType
        { url: 'https://x.example/paper.pdf', mimeType: 'application/pdf' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('skips attachments missing url', () => {
    const item = {
      attachments: [
        { mimeType: 'application/pdf' }, // no url
        { url: 'https://x.example/paper.pdf', mimeType: 'application/pdf' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('skips attachments with empty-string url', () => {
    const item = {
      attachments: [
        { url: '', mimeType: 'application/pdf' },
        { url: 'https://x.example/paper.pdf', mimeType: 'application/pdf' },
      ],
    }
    expect(extractPdfAttachmentUrl(item)).toBe('https://x.example/paper.pdf')
  })

  it('returns null when attachments is not an array (defensive)', () => {
    const item = { attachments: 'not-an-array' as unknown as unknown[] }
    expect(extractPdfAttachmentUrl(item)).toBeNull()
  })

  it('returns null for undefined / null item (defensive)', () => {
    expect(extractPdfAttachmentUrl(undefined)).toBeNull()
    expect(extractPdfAttachmentUrl(null)).toBeNull()
  })
})
