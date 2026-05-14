import { describe, it, expect } from 'vitest'
import { mapCslToConnectorPayload } from './csl-to-payload'
import type { ZoteroCslItem } from './types'

describe('mapCslToConnectorPayload', () => {
  describe('itemType enum map', () => {
    const cases: Array<[string, string | undefined]> = [
      ['journalArticle', 'article'],
      ['book', 'book'],
      ['bookSection', 'chapter'],
      ['conferencePaper', 'conferencePaper'],
      ['thesis', 'thesis'],
      ['preprint', 'preprint'],
      ['report', 'report'],
      ['webpage', 'website'],
      ['musicalScore', undefined], // unknown → omit (server falls back to 'article')
    ]

    for (const [input, expected] of cases) {
      it(`maps "${input}" → ${expected ?? 'omitted'}`, () => {
        const result = mapCslToConnectorPayload({ title: 't', itemType: input })
        if (expected === undefined) {
          expect(result.type).toBeUndefined()
        } else {
          expect(result.type).toBe(expected)
        }
      })
    }
  })

  describe('author shape preservation', () => {
    it('preserves firstName / lastName variant', () => {
      const result = mapCslToConnectorPayload({
        title: 't',
        creators: [{ firstName: 'John', lastName: 'Jumper' }],
      })
      expect(result.authors).toEqual([{ firstName: 'John', lastName: 'Jumper' }])
    })

    it('maps single-string `name` → fullName variant', () => {
      const result = mapCslToConnectorPayload({
        title: 't',
        creators: [{ name: 'OpenAI' }],
      })
      expect(result.authors).toEqual([{ fullName: 'OpenAI' }])
    })

    it('handles a mixed array of author shapes', () => {
      const result = mapCslToConnectorPayload({
        title: 't',
        creators: [
          { firstName: 'Demis', lastName: 'Hassabis' },
          { name: 'DeepMind' },
          { firstName: '', lastName: 'Smith' },
        ],
      })
      expect(result.authors).toEqual([
        { firstName: 'Demis', lastName: 'Hassabis' },
        { fullName: 'DeepMind' },
        { firstName: '', lastName: 'Smith' },
      ])
    })

    it('skips creators with neither firstName/lastName nor name', () => {
      const result = mapCslToConnectorPayload({
        title: 't',
        creators: [{}, { firstName: 'A', lastName: 'B' }],
      })
      expect(result.authors).toEqual([{ firstName: 'A', lastName: 'B' }])
    })
  })

  describe('year parse', () => {
    it('parses ISO date "2024-03-15" → 2024', () => {
      expect(mapCslToConnectorPayload({ title: 't', date: '2024-03-15' }).year).toBe(2024)
    })

    it('parses bare year "2024" → 2024', () => {
      expect(mapCslToConnectorPayload({ title: 't', date: '2024' }).year).toBe(2024)
    })

    it('omits non-numeric "in press"', () => {
      expect(mapCslToConnectorPayload({ title: 't', date: 'in press' }).year).toBeUndefined()
    })

    it('omits when date is missing', () => {
      expect(mapCslToConnectorPayload({ title: 't' }).year).toBeUndefined()
    })
  })

  describe('AC7 envelope — 4 organization arrays always emitted', () => {
    it('emits empty tagIds / newTagNames / projectIds / collectionIds for a minimal item', () => {
      const result = mapCslToConnectorPayload({ title: 't' })
      expect(result.tagIds).toEqual([])
      expect(result.newTagNames).toEqual([])
      expect(result.projectIds).toEqual([])
      expect(result.collectionIds).toEqual([])
    })
  })

  describe('full snapshot — arXiv-style fixture', () => {
    it('produces canonical payload for an arXiv CSL response', () => {
      const fixture: ZoteroCslItem = {
        title: 'GPT-4 Technical Report',
        creators: [{ firstName: 'OpenAI', lastName: '' }],
        date: '2023-03-15',
        DOI: '10.48550/arXiv.2303.08774',
        abstractNote: 'We report the development of GPT-4...',
        url: 'https://arxiv.org/abs/2303.08774',
        itemType: 'preprint',
      }

      expect(mapCslToConnectorPayload(fixture)).toEqual({
        title: 'GPT-4 Technical Report',
        authors: [{ firstName: 'OpenAI', lastName: '' }],
        year: 2023,
        doi: '10.48550/arXiv.2303.08774',
        abstract: 'We report the development of GPT-4...',
        url: 'https://arxiv.org/abs/2303.08774',
        type: 'preprint',
        tagIds: [],
        newTagNames: [],
        projectIds: [],
        collectionIds: [],
      })
    })
  })
})
