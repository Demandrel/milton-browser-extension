import { describe, expect, it } from 'vitest'
import { mapMetadataToPayload } from './metadata-to-payload'
import type { MetadataPrimary } from './types'

function primary(overrides: Partial<MetadataPrimary> = {}): MetadataPrimary {
  return {
    title: 't',
    authors: [],
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
    ...overrides,
  }
}

describe('mapMetadataToPayload', () => {
  describe('author shape', () => {
    it('maps {first, last} → {firstName, lastName} directly', () => {
      const out = mapMetadataToPayload(
        primary({ authors: [{ first: 'John', last: 'Jumper' }] }),
        'https://example.com',
      )
      expect(out.authors).toEqual([{ firstName: 'John', lastName: 'Jumper' }])
    })

    it('preserves single-name authors with empty last (e.g. "OpenAI")', () => {
      const out = mapMetadataToPayload(
        primary({ authors: [{ first: 'OpenAI', last: '' }] }),
        'https://example.com',
      )
      expect(out.authors).toEqual([{ firstName: 'OpenAI', lastName: '' }])
    })

    it('filters out authors with both first and last empty (defensive)', () => {
      const out = mapMetadataToPayload(
        primary({
          authors: [
            { first: '', last: '' },
            { first: 'Demis', last: 'Hassabis' },
            { first: '', last: '' },
          ],
        }),
        'https://example.com',
      )
      expect(out.authors).toEqual([{ firstName: 'Demis', lastName: 'Hassabis' }])
    })

    it('keeps author with only last populated', () => {
      const out = mapMetadataToPayload(
        primary({ authors: [{ first: '', last: 'Madonna' }] }),
        'https://example.com',
      )
      expect(out.authors).toEqual([{ firstName: '', lastName: 'Madonna' }])
    })
  })

  describe('optional field omission', () => {
    it('omits year when 0 (the empty-string-when-absent convention from the envelope)', () => {
      const out = mapMetadataToPayload(primary({ year: 0 }), 'https://example.com')
      expect(out.year).toBeUndefined()
    })

    it('keeps year when present and positive', () => {
      const out = mapMetadataToPayload(primary({ year: 2024 }), 'https://example.com')
      expect(out.year).toBe(2024)
    })

    it('omits doi / abstract when empty string', () => {
      const out = mapMetadataToPayload(
        primary({ doi: '', abstract: '' }),
        'https://example.com',
      )
      expect(out.doi).toBeUndefined()
      expect(out.abstract).toBeUndefined()
    })

    it('keeps doi / abstract when populated', () => {
      const out = mapMetadataToPayload(
        primary({ doi: '10.1234/x', abstract: 'A long abstract.' }),
        'https://example.com',
      )
      expect(out.doi).toBe('10.1234/x')
      expect(out.abstract).toBe('A long abstract.')
    })

    it('never emits a `type` field (server falls back to article)', () => {
      const out = mapMetadataToPayload(primary(), 'https://example.com')
      expect(out.type).toBeUndefined()
    })

    it('always emits url from the caller (not from the response)', () => {
      const out = mapMetadataToPayload(primary(), 'https://arxiv.org/abs/x')
      expect(out.url).toBe('https://arxiv.org/abs/x')
    })
  })

  describe('AC7 forward-compat envelope', () => {
    it('emits 4 empty organization arrays for a minimal input', () => {
      const out = mapMetadataToPayload(primary(), 'https://example.com')
      expect(out.tagIds).toEqual([])
      expect(out.newTagNames).toEqual([])
      expect(out.projectIds).toEqual([])
      expect(out.collectionIds).toEqual([])
    })
  })

  describe('full snapshot — arXiv-style fixture', () => {
    it('produces canonical payload for an arXiv /metadata response', () => {
      const fixture: MetadataPrimary = {
        title: 'GPT-4 Technical Report',
        authors: [{ first: 'OpenAI', last: '' }],
        doi: '10.48550/arXiv.2303.08774',
        journal: '',
        year: 2023,
        issued_date: '2023-03-15',
        abstract: 'We report the development of GPT-4...',
        arxiv_id: '2303.08774',
        issn: '',
        volume: '',
        issue: '',
        pages: '',
      }

      expect(mapMetadataToPayload(fixture, 'https://arxiv.org/abs/2303.08774')).toEqual({
        title: 'GPT-4 Technical Report',
        authors: [{ firstName: 'OpenAI', lastName: '' }],
        year: 2023,
        doi: '10.48550/arXiv.2303.08774',
        abstract: 'We report the development of GPT-4...',
        url: 'https://arxiv.org/abs/2303.08774',
        tagIds: [],
        newTagNames: [],
        projectIds: [],
        collectionIds: [],
      })
    })
  })
})
