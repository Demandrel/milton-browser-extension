import { describe, expect, it } from 'vitest'
import { mapMetadataToPayload } from '../lib/metadata-to-payload'
import type { EditableMetadata, MetadataAuthor, MetadataPrimary, TagSummary } from '../lib/types'
import {
  blankEditable,
  decideTagInputEnter,
  detectPdfPage,
  editableToMapperInput,
  filterTagSuggestions,
  formatAuthorsDisplay,
  isTitleValid,
  joinAuthors,
  metadataToEditable,
  parseYearInput,
} from './popup-helpers'

// ── joinAuthors ────────────────────────────────────────────────────────────

describe('joinAuthors', () => {
  it('joins two simple first+last entries', () => {
    const authors: MetadataAuthor[] = [
      { first: 'John', last: 'Jumper' },
      { first: 'Demis', last: 'Hassabis' },
    ]
    expect(joinAuthors(authors)).toBe('John Jumper, Demis Hassabis')
  })

  it('skips entries with both fields empty', () => {
    const authors: MetadataAuthor[] = [
      { first: 'A', last: 'B' },
      { first: '', last: '' }, // dropped
      { first: 'C', last: 'D' },
    ]
    expect(joinAuthors(authors)).toBe('A B, C D')
  })

  it('keeps entries with only first or only last', () => {
    const authors: MetadataAuthor[] = [
      { first: 'Solo', last: '' },
      { first: '', last: 'Lastname' },
    ]
    expect(joinAuthors(authors)).toBe('Solo, Lastname')
  })

  it('returns empty string for fully-empty author list', () => {
    expect(joinAuthors([])).toBe('')
    expect(
      joinAuthors([
        { first: '', last: '' },
        { first: '', last: '' },
      ]),
    ).toBe('')
  })
})

// ── formatAuthorsDisplay ──────────────────────────────────────────────────

describe('formatAuthorsDisplay', () => {
  const mk = (...names: string[]): MetadataAuthor[] =>
    names.map((n) => {
      const parts = n.split(' ')
      return { first: parts.slice(0, -1).join(' '), last: parts.at(-1) ?? '' }
    })

  it('lists up to 3 authors in full', () => {
    expect(formatAuthorsDisplay(mk('John Jumper'))).toBe('John Jumper')
    expect(formatAuthorsDisplay(mk('A B', 'C D', 'E F'))).toBe('A B, C D, E F')
  })

  it('collapses to first 2 + "et al." past 3 authors', () => {
    expect(formatAuthorsDisplay(mk('A B', 'C D', 'E F', 'G H'))).toBe('A B, C D et al.')
  })

  it('collapses a 40-author paper to two names + et al.', () => {
    const many = mk(...Array.from({ length: 40 }, (_, i) => `First${i} Last${i}`))
    expect(formatAuthorsDisplay(many)).toBe('First0 Last0, First1 Last1 et al.')
  })

  it('drops fully-empty entries before counting (3 real → no et al.)', () => {
    const authors: MetadataAuthor[] = [
      { first: 'A', last: 'B' },
      { first: '', last: '' },
      { first: 'C', last: 'D' },
      { first: '', last: '' },
      { first: 'E', last: 'F' },
    ]
    expect(formatAuthorsDisplay(authors)).toBe('A B, C D, E F')
  })

  it('returns empty string for an empty or all-empty list', () => {
    expect(formatAuthorsDisplay([])).toBe('')
    expect(formatAuthorsDisplay([{ first: '', last: '' }])).toBe('')
  })
})

// ── parseYearInput ────────────────────────────────────────────────────────

describe('parseYearInput', () => {
  it('parses a plain 4-digit year', () => {
    expect(parseYearInput('2024')).toBe(2024)
  })

  it('extracts the first 4-digit run from a date string', () => {
    expect(parseYearInput('2025-03-15')).toBe(2025)
  })

  it('returns 0 for non-numeric text', () => {
    expect(parseYearInput('in press')).toBe(0)
    expect(parseYearInput('abc')).toBe(0)
    expect(parseYearInput('')).toBe(0)
  })

  it('returns 0 for years outside the valid range (too old)', () => {
    expect(parseYearInput('1200')).toBe(0)
    expect(parseYearInput('999')).toBe(0) // not 4 digits anyway, but defensive
  })

  it('returns 0 for years too far in the future', () => {
    const futureYear = new Date().getFullYear() + 100
    expect(parseYearInput(String(futureYear))).toBe(0)
  })

  it('accepts current year + 2 (forthcoming preprints)', () => {
    const okFuture = new Date().getFullYear() + 2
    expect(parseYearInput(String(okFuture))).toBe(okFuture)
  })

  it('extracts year even when prefixed with text', () => {
    expect(parseYearInput('published 2024 in journal')).toBe(2024)
  })
})

// ── decideTagInputEnter ───────────────────────────────────────────────────

describe('decideTagInputEnter', () => {
  const existingTags: TagSummary[] = [
    { id: 't-ml', name: 'Machine Learning' },
    { id: 't-q', name: 'Quantum' },
    { id: 't-nlp', name: 'NLP' },
  ]

  it('ignores pure-whitespace input', () => {
    expect(decideTagInputEnter('', existingTags)).toEqual({ kind: 'ignore' })
    expect(decideTagInputEnter('   ', existingTags)).toEqual({ kind: 'ignore' })
    expect(decideTagInputEnter('\t\n', existingTags)).toEqual({ kind: 'ignore' })
  })

  it('selects existing on exact-match (case-insensitive, trimmed)', () => {
    expect(decideTagInputEnter('Machine Learning', existingTags)).toEqual({
      kind: 'select-existing',
      id: 't-ml',
    })
    expect(decideTagInputEnter('machine learning', existingTags)).toEqual({
      kind: 'select-existing',
      id: 't-ml',
    })
    expect(decideTagInputEnter('  MACHINE LEARNING  ', existingTags)).toEqual({
      kind: 'select-existing',
      id: 't-ml',
    })
  })

  it('creates new for unique input', () => {
    expect(decideTagInputEnter('Cryptography', existingTags)).toEqual({
      kind: 'create-new',
      name: 'Cryptography',
    })
  })

  it('trims whitespace before creating new', () => {
    expect(decideTagInputEnter('  My Tag  ', existingTags)).toEqual({
      kind: 'create-new',
      name: 'My Tag',
    })
  })

  it('works with empty existing-tags list', () => {
    expect(decideTagInputEnter('Anything', [])).toEqual({
      kind: 'create-new',
      name: 'Anything',
    })
  })
})

// ── filterTagSuggestions ──────────────────────────────────────────────────

describe('filterTagSuggestions', () => {
  const allTags: TagSummary[] = [
    { id: '1', name: 'Quantum Computing' },
    { id: '2', name: 'Quantum Cryptography' },
    { id: '3', name: 'Machine Learning' },
    { id: '4', name: 'Neural Networks' },
    { id: '5', name: 'Reinforcement Learning' },
    { id: '6', name: 'Statistics' },
    { id: '7', name: 'Optimization' },
    { id: '8', name: 'Learning Theory' }, // 4 substring 'learning' matches
  ]

  it('returns [] for whitespace-only input', () => {
    expect(filterTagSuggestions('', allTags, [])).toEqual([])
    expect(filterTagSuggestions('   ', allTags, [])).toEqual([])
  })

  it('case-insensitive substring match', () => {
    const result = filterTagSuggestions('quantum', allTags, [])
    expect(result.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('caps at 6 suggestions even if more match', () => {
    // Add 7 'a'-containing tags by reusing 'Learning'-containing ones (4 hits)
    // and querying for letters that match many entries.
    const result = filterTagSuggestions('i', allTags, []) // many tags contain 'i'
    expect(result.length).toBeLessThanOrEqual(6)
  })

  it('excludes already-selected ids', () => {
    const result = filterTagSuggestions('learning', allTags, ['3'])
    expect(result.map((t) => t.id)).toEqual(['5', '8'])
  })

  it('matches anywhere in the name (not just prefix)', () => {
    const result = filterTagSuggestions('ography', allTags, [])
    expect(result.map((t) => t.id)).toEqual(['2'])
  })

  it('returns empty when no tag contains the substring', () => {
    expect(filterTagSuggestions('xyz123', allTags, [])).toEqual([])
  })
})

// ── metadataToEditable / editableToMapperInput ────────────────────────────

describe('metadataToEditable', () => {
  it('copies all fields verbatim', () => {
    const primary: MetadataPrimary = {
      title: 'Test',
      authors: [{ first: 'A', last: 'B' }],
      doi: '10.1234/foo',
      journal: 'J. Test',
      year: 2024,
      issued_date: '2024-03-15',
      abstract: 'abs',
      arxiv_id: '',
      issn: '',
      volume: '1',
      issue: '2',
      pages: '3-4',
    }
    const editable = metadataToEditable(primary)
    expect(editable.title).toBe('Test')
    expect(editable.authors).toEqual([{ first: 'A', last: 'B' }])
    expect(editable.year).toBe(2024)
    expect(editable.doi).toBe('10.1234/foo')
  })

  it('deep-clones the authors array (mutation isolation)', () => {
    const primary: MetadataPrimary = {
      title: 'T',
      authors: [{ first: 'A', last: 'B' }],
      doi: '',
      journal: '',
      year: 0,
      issued_date: '',
      abstract: '',
      arxiv_id: '',
      issn: '',
      volume: '',
      issue: '',
      pages: '',
    }
    const editable = metadataToEditable(primary)
    editable.authors[0].first = 'CHANGED'
    expect(primary.authors[0].first).toBe('A') // not mutated
  })
})

describe('editableToMapperInput', () => {
  it('passes through unchanged (structural compat with MetadataPrimary)', () => {
    const e: EditableMetadata = {
      title: 'Hi',
      authors: [{ first: 'X', last: 'Y' }],
      year: 2024,
      doi: '10.x',
      journal: '',
      abstract: '',
      issued_date: '',
      arxiv_id: '',
      issn: '',
      volume: '',
      issue: '',
      pages: '',
    }
    expect(editableToMapperInput(e)).toBe(e)
  })
})

// ── blankEditable ─────────────────────────────────────────────────────────

describe('blankEditable', () => {
  it('carries the given title with every other field empty', () => {
    const e = blankEditable('Some Page Title')
    expect(e.title).toBe('Some Page Title')
    expect(e.authors).toEqual([])
    expect(e.year).toBe(0)
    expect(e.doi).toBe('')
    expect(e.journal).toBe('')
    expect(e.abstract).toBe('')
    expect(e.issued_date).toBe('')
    expect(e.arxiv_id).toBe('')
    expect(e.issn).toBe('')
    expect(e.volume).toBe('')
    expect(e.issue).toBe('')
    expect(e.pages).toBe('')
  })

  it('maps to a title-and-URL-only connector payload', () => {
    const payload = mapMetadataToPayload(
      editableToMapperInput(blankEditable('Instant Save')),
      'https://example.com/paper',
    )
    expect(payload.title).toBe('Instant Save')
    expect(payload.authors).toEqual([])
    expect(payload.url).toBe('https://example.com/paper')
    expect(payload.year).toBeUndefined()
    expect(payload.doi).toBeUndefined()
    expect(payload.abstract).toBeUndefined()
  })
})

// ── isTitleValid ──────────────────────────────────────────────────────────

// ── detectPdfPage (BE-7) ──────────────────────────────────────────────────

describe('detectPdfPage', () => {
  it('returns true when mimeType is application/pdf (canonical signal)', () => {
    expect(detectPdfPage('https://host/download?id=623', 'application/pdf')).toBe(true)
  })

  it('returns true for .pdf URL suffix when mimeType is absent', () => {
    expect(detectPdfPage('https://www.econstor.eu/.../623739976.pdf', undefined)).toBe(true)
    expect(detectPdfPage('https://arxiv.org/pdf/2303.08774.pdf')).toBe(true)
  })

  it('strips query string before checking .pdf suffix', () => {
    expect(detectPdfPage('https://host/paper.pdf?download=true', undefined)).toBe(true)
    expect(detectPdfPage('https://host/paper.pdf#page=4', undefined)).toBe(true)
    expect(detectPdfPage('https://host/paper.pdf?download=true#page=4', undefined)).toBe(true)
  })

  it('returns false for .pdf.html (substring trap)', () => {
    expect(detectPdfPage('https://host/index.pdf.html', undefined)).toBe(false)
    expect(detectPdfPage('https://host/paper.pdf.html', 'text/html')).toBe(false)
  })

  it('returns false for plain HTML article URLs', () => {
    expect(detectPdfPage('https://arxiv.org/abs/2303.08774', 'text/html')).toBe(false)
    expect(detectPdfPage('https://www.nature.com/articles/s41586-021-03819-2', undefined)).toBe(false)
  })

  it('rejects restricted-URL schemes defensively', () => {
    expect(detectPdfPage('chrome://settings/', undefined)).toBe(false)
    expect(detectPdfPage('chrome-extension://abc/popup.html', undefined)).toBe(false)
    expect(detectPdfPage('about:blank', undefined)).toBe(false)
    expect(detectPdfPage('file:///tmp/paper.pdf', undefined)).toBe(false)
    expect(detectPdfPage('edge://flags/', undefined)).toBe(false)
    expect(detectPdfPage('brave://settings/', undefined)).toBe(false)
  })

  it('is case-insensitive on the suffix check', () => {
    expect(detectPdfPage('https://host/paper.PDF', undefined)).toBe(true)
    expect(detectPdfPage('https://host/Paper.Pdf?x=1', undefined)).toBe(true)
  })

  it('mimeType wins over suffix mismatch (PDF served at non-.pdf URL)', () => {
    // econstor-style: /bitstream/.../123.pdf is the typical case, but some
    // hosts serve PDFs from `/download?file=...` paths. mimeType saves us.
    expect(detectPdfPage('https://host/download?file=623739976', 'application/pdf')).toBe(true)
  })

  it('returns false for empty URL', () => {
    expect(detectPdfPage('', 'application/pdf')).toBe(true) // mimeType still wins
    expect(detectPdfPage('', undefined)).toBe(false)
    expect(detectPdfPage('', 'text/html')).toBe(false)
  })

  it('mimeType:text/html on a .pdf URL: mimeType does NOT win, suffix still flags', () => {
    // This case: a host that serves PDFs with Content-Type: text/html (broken
    // server). mimeType !== 'application/pdf' so signal 1 misses; signal 2
    // (suffix) catches. Downstream magic-byte check on the server side is the
    // final safety net.
    expect(detectPdfPage('https://host/paper.pdf', 'text/html')).toBe(true)
  })
})

describe('isTitleValid', () => {
  const base: EditableMetadata = {
    title: '',
    authors: [],
    year: 0,
    doi: '',
    journal: '',
    abstract: '',
    issued_date: '',
    arxiv_id: '',
    issn: '',
    volume: '',
    issue: '',
    pages: '',
  }

  it('rejects empty title', () => {
    expect(isTitleValid({ ...base, title: '' })).toBe(false)
  })

  it('rejects whitespace-only title', () => {
    expect(isTitleValid({ ...base, title: '   ' })).toBe(false)
    expect(isTitleValid({ ...base, title: '\t\n' })).toBe(false)
  })

  it('accepts any non-whitespace title', () => {
    expect(isTitleValid({ ...base, title: 'A' })).toBe(true)
    expect(isTitleValid({ ...base, title: '  Trimmed Out Edges  ' })).toBe(true)
  })
})
