// Wire shapes — reflect the contract documented in
// docs/integrations/browser-extension-protocol.mdx (Milton local connector) and
// docs/integrations/translate-milton-so-api.mdx (translate.milton.so).

// --- Connector /auth/issue-token (Story 18-15) ---------------------------

export interface IssueTokenResponse {
  token: string
  expires_in: number
}

export type TokenFetchResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'signed-out' }
  | { ok: false; reason: 'origin-rejected' }
  | { ok: false; reason: 'rate-limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'network-error'; message: string }
  | { ok: false; reason: 'unexpected'; status: number; message: string }

// --- Translation server /metadata response (TS-14 envelope) --------------

export type MetadataSourceTier =
  | 'translator_registry'
  | 'doi_resolved'
  | 'arxiv_dispatch'
  | 'grobid_title'
  | 'embedded_titlesearch'
  | 'empty'

export type MetadataExtractedFrom = 'url' | 'pdf_url' | 'pdf_binary'

export interface MetadataAuthor {
  first: string
  last: string
}

export interface MetadataPrimary {
  title: string
  authors: MetadataAuthor[]
  doi: string
  journal: string
  year: number
  issued_date: string
  abstract: string
  arxiv_id: string
  issn: string
  volume: string
  issue: string
  pages: string
  // Present only when source_tier === 'embedded_titlesearch'
  confidence?: number
}

export interface MetadataResponse {
  source_tier: MetadataSourceTier
  extracted_from: MetadataExtractedFrom
  primary: MetadataPrimary | null
  candidates: MetadataPrimary[]
}

// Translation-server error wire shape (Bearer-token era).
// Every JSON error response carries `error` at top level; clients dispatch on
// `error`, not on status alone. See translate-milton-so-api.mdx → Errors.
export type TranslateError =
  // 401 family — token verify failures.
  | { kind: 'token-invalid' } // 401 error:"token_invalid"
  | { kind: 'token-expired' } // 401 error:"expired"
  | { kind: 'wrong-audience' } // 401 error:"wrong_audience"
  | { kind: 'device-not-registered' } // 401 error:"device_not_registered"
  | { kind: 'device-owner-mismatch' } // 401 error:"device_owner_mismatch"
  // 402 family — payment / tier / quota.
  | {
      kind: 'tier-required'
      yourTier: string
      requiredTiers: string[]
      upgradeUrl: string
    }
  | {
      kind: 'quota-exceeded'
      tier: string
      limit: number
      windowDays: number
      nextResetSeconds: number
    }
  | { kind: 'tier-revoked'; jwtTier: string; dbTier: string; upgradeUrl: string }
  // Other.
  | { kind: 'not-found' } // 404 — typo'd path or removed route.
  | { kind: 'method-not-allowed' } // 405
  | { kind: 'payload-too-large' } // 413
  | { kind: 'rate-limited'; retryAfterSeconds: number } // 429 per-IP
  | { kind: 'bad-gateway' } // 502
  | { kind: 'key-lookup-unavailable'; retryAfterSeconds: number } // 503
  | { kind: 'service-unavailable'; retryAfterSeconds?: number } // 503 generic
  | { kind: 'no-metadata' } // 200 + source_tier:"empty" → degrade to error state
  | { kind: 'unexpected'; status: number; message: string }
  | { kind: 'network-error'; message: string }

// --- Connector POST /references payload (unchanged from BE-1) ------------

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

// --- Connector GET /health + POST /references (unchanged from BE-1) ------

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
