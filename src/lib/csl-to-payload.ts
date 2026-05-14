import type {
  ConnectorAuthor,
  ConnectorReferencePayload,
  ConnectorReferenceType,
  ZoteroCreator,
  ZoteroCslItem,
} from './types'

const ITEM_TYPE_MAP: Record<string, ConnectorReferenceType> = {
  journalArticle: 'article',
  book: 'book',
  bookSection: 'chapter',
  conferencePaper: 'conferencePaper',
  thesis: 'thesis',
  preprint: 'preprint',
  report: 'report',
  webpage: 'website',
}

/**
 * Map a Zotero-flavored CSL-JSON item (as returned by translate.milton.so/web)
 * to Milton's ConnectorReferencePayload wire shape.
 *
 * Rules — see Story BE-1 AC5 + docs/integrations/browser-extension-protocol.mdx:
 *  - title → title
 *  - creators → authors (rename + per-entry shape preserved)
 *  - date → year (parse first 4 digits; non-numeric → omit)
 *  - DOI → doi
 *  - abstractNote → abstract (rename)
 *  - url → url
 *  - itemType → type (enum-map; unknown OMITTED → server falls back to 'article')
 *
 * AC7 forward-compat: ALWAYS emits empty tagIds/newTagNames/projectIds/
 * collectionIds so BE-2 layers UI without changing the wire envelope.
 */
export function mapCslToConnectorPayload(
  csl: ZoteroCslItem,
): ConnectorReferencePayload {
  const payload: ConnectorReferencePayload = {
    title: csl.title ?? '',
    authors: mapCreators(csl.creators ?? []),
    tagIds: [],
    newTagNames: [],
    projectIds: [],
    collectionIds: [],
  }

  const year = parseYear(csl.date)
  if (year !== undefined) payload.year = year

  if (csl.DOI) payload.doi = csl.DOI
  if (csl.abstractNote) payload.abstract = csl.abstractNote
  if (csl.url) payload.url = csl.url

  const type = mapItemType(csl.itemType)
  if (type !== undefined) payload.type = type

  return payload
}

function mapCreators(creators: ZoteroCreator[]): ConnectorAuthor[] {
  const result: ConnectorAuthor[] = []
  for (const c of creators) {
    if ('firstName' in c || 'lastName' in c) {
      const firstName = ('firstName' in c ? c.firstName : undefined) ?? ''
      const lastName = ('lastName' in c ? c.lastName : undefined) ?? ''
      if (firstName || lastName) {
        result.push({ firstName, lastName })
      }
    } else if ('name' in c && c.name) {
      result.push({ fullName: c.name })
    }
  }
  return result
}

function parseYear(date?: string): number | undefined {
  if (!date) return undefined
  const match = /^(\d{4})/.exec(date)
  if (!match) return undefined
  return Number.parseInt(match[1], 10)
}

function mapItemType(itemType?: string): ConnectorReferenceType | undefined {
  if (!itemType) return undefined
  return ITEM_TYPE_MAP[itemType]
}
