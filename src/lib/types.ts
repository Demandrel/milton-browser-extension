// Wire shapes — reflect the contract documented in
// docs/integrations/browser-extension-protocol.mdx (Milton repo) AND the
// Zotero-flavored CSL-JSON returned by translate.milton.so/web.

// --- Translation server response (Zotero CSL flavor) ----------------------

export interface ZoteroCslItem {
  title?: string
  creators?: ZoteroCreator[]
  date?: string
  DOI?: string
  abstractNote?: string
  url?: string
  itemType?: string
  // Forward-compat: ignore unknown fields
  [key: string]: unknown
}

export type ZoteroCreator =
  | { firstName?: string; lastName?: string }
  | { name?: string }

// --- Connector POST /references payload -----------------------------------

export interface ConnectorReferencePayload {
  title: string
  authors: ConnectorAuthor[]
  year?: number
  doi?: string
  abstract?: string
  url?: string
  type?: ConnectorReferenceType
  // Story 18-1 extended payload — AC7 forward-compat: always emitted
  tagIds: string[]
  newTagNames: string[]
  projectIds: string[]
  collectionIds: string[]
}

export type ConnectorAuthor =
  | { firstName: string; lastName: string }
  | { fullName: string }

export type ConnectorReferenceType =
  | 'article'
  | 'book'
  | 'chapter'
  | 'conferencePaper'
  | 'thesis'
  | 'preprint'
  | 'report'
  | 'website'
  | 'other'

// --- Connector responses --------------------------------------------------

export interface HealthResponse {
  app: string
  version: string
}

export type HealthResult =
  | { ok: true; body: HealthResponse }
  | { ok: false; reason: 'refused' | 'timeout' | 'shape' }

export type CreateReferenceResult =
  | { ok: true; status: 201; id: string }
  | { ok: false; status: 400; message: string; detail?: string }
  | { ok: false; status: 403; message: string }
  | { ok: false; status: 409; id: string; matchedBy: string; message: string }
  | { ok: false; status: 503; message: string; detail?: string }
  | { ok: false; status: 'network-error'; message: string }
  | { ok: false; status: 'payload-too-large'; message: string }
