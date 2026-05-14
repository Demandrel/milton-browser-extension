import { fetchTranslationToken } from './auth-client'
import type {
  MetadataPrimary,
  MetadataResponse,
  TokenFetchResult,
  TranslateError,
} from './types'

// Translate-server base URL. Production default = translate.milton.so.
// Override via `VITE_TRANSLATE_BASE` in `.env.local` for local docker-compose.
const TRANSLATE_BASE: string =
  import.meta.env.VITE_TRANSLATE_BASE ?? 'https://translate.milton.so'

const DEFAULT_KEY_LOOKUP_RETRY = 30
const DEFAULT_RATE_LIMIT_RETRY = 60

type TokenFailure = Exclude<TokenFetchResult, { ok: true; token: string }>

export type ExtractMetadataResult =
  | { ok: true; primary: MetadataPrimary; sourceTier: string }
  | { ok: false; via: 'token-mint'; error: TokenFailure }
  | { ok: false; via: 'translate-server'; error: TranslateError }

/**
 * Extract reference metadata for a URL via `POST translate.milton.so/metadata`.
 *
 * Flow:
 *   1. Mint a JWT via Milton's local connector (`auth-client.fetchTranslationToken`).
 *   2. POST the URL (text/plain) with `Authorization: Bearer <jwt>`.
 *   3. Parse the envelope (success) or dispatch on the error wire shape.
 *
 * Retry-once rule (AC3): if the server returns 401 `expired`, mint a fresh
 * token and retry. Other 401 reasons surface to the caller — they won't be
 * fixed by a retry (bad signature, missing kid, owner mismatch).
 *
 * Story BE-4 — replaces BE-1's `X-Milton-Key` + `/web` flow (TS-14 retired
 * `/web` on 2026-05-12 in favour of the `/metadata` orchestrator envelope).
 */
export async function extractMetadata(url: string): Promise<ExtractMetadataResult> {
  const first = await postMetadata(url)
  if (first.ok) return first

  // Retry-once on token-expired (silent — popup never sees the stale attempt).
  if (first.via === 'translate-server' && first.error.kind === 'token-expired') {
    return postMetadata(url)
  }

  return first
}

async function postMetadata(url: string): Promise<ExtractMetadataResult> {
  const tok = await fetchTranslationToken()
  if (!tok.ok) {
    return { ok: false, via: 'token-mint', error: tok }
  }

  let resp: Response
  try {
    resp = await fetch(`${TRANSLATE_BASE}/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${tok.token}`,
      },
      body: url,
    })
  } catch (e) {
    return {
      ok: false,
      via: 'translate-server',
      error: {
        kind: 'network-error',
        message: e instanceof Error ? e.message : 'Network error',
      },
    }
  }

  return parseResponse(resp)
}

async function parseResponse(resp: Response): Promise<ExtractMetadataResult> {
  if (resp.status === 200) {
    let body: MetadataResponse
    try {
      body = (await resp.json()) as MetadataResponse
    } catch {
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'unexpected', status: 200, message: 'Malformed JSON body' },
      }
    }
    if (body.source_tier === 'empty' || !body.primary) {
      return { ok: false, via: 'translate-server', error: { kind: 'no-metadata' } }
    }
    return { ok: true, primary: body.primary, sourceTier: body.source_tier }
  }

  let bodyJson: Record<string, unknown> = {}
  try {
    bodyJson = (await resp.json()) as Record<string, unknown>
  } catch {
    bodyJson = {}
  }
  // Auth-proxy wire shape:
  //   401 / 503 → { error: "unauthorized" | "service_unavailable", reason: "<kind>" }
  //   402       → { error: "<kind>", ...kind-specific fields }
  // So 401/503 dispatch on `reason`, 402 on `error`.
  const errorStr = typeof bodyJson.error === 'string' ? bodyJson.error : undefined
  const reasonStr = typeof bodyJson.reason === 'string' ? bodyJson.reason : undefined

  switch (resp.status) {
    case 401:
      return {
        ok: false,
        via: 'translate-server',
        error: parse401(reasonStr),
      }
    case 402:
      return {
        ok: false,
        via: 'translate-server',
        error: parse402(errorStr, bodyJson),
      }
    case 404:
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'not-found' },
      }
    case 405:
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'method-not-allowed' },
      }
    case 413:
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'payload-too-large' },
      }
    case 429:
      return {
        ok: false,
        via: 'translate-server',
        error: {
          kind: 'rate-limited',
          retryAfterSeconds: parseRetryAfter(resp, DEFAULT_RATE_LIMIT_RETRY),
        },
      }
    case 502:
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'bad-gateway' },
      }
    case 503: {
      // Auth-proxy wire shape: { error: "service_unavailable", reason: "<kind>" }
      // where `reason: "key_lookup_unavailable"` distinguishes the
      // Supabase-unreachable case from generic upstream-down.
      if (reasonStr === 'key_lookup_unavailable') {
        return {
          ok: false,
          via: 'translate-server',
          error: {
            kind: 'key-lookup-unavailable',
            retryAfterSeconds: parseRetryAfter(resp, DEFAULT_KEY_LOOKUP_RETRY),
          },
        }
      }
      const retryHeader = resp.headers.get('Retry-After')
      const parsed = retryHeader ? Number.parseInt(retryHeader, 10) : NaN
      const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
      return {
        ok: false,
        via: 'translate-server',
        error: { kind: 'service-unavailable', retryAfterSeconds },
      }
    }
    default:
      return {
        ok: false,
        via: 'translate-server',
        error: {
          kind: 'unexpected',
          status: resp.status,
          message: `Unexpected status ${resp.status}`,
        },
      }
  }
}

function parse401(reasonStr: string | undefined): TranslateError {
  switch (reasonStr) {
    case 'expired':
      return { kind: 'token-expired' }
    case 'wrong_audience':
      return { kind: 'wrong-audience' }
    case 'device_not_registered':
      return { kind: 'device-not-registered' }
    case 'device_owner_mismatch':
      return { kind: 'device-owner-mismatch' }
    case 'token_invalid':
    default:
      return { kind: 'token-invalid' }
  }
}

function parse402(
  errorStr: string | undefined,
  body: Record<string, unknown>,
): TranslateError {
  if (errorStr === 'tier_required') {
    return {
      kind: 'tier-required',
      yourTier: typeof body.your_tier === 'string' ? body.your_tier : 'free',
      requiredTiers: Array.isArray(body.required_tiers)
        ? (body.required_tiers as string[])
        : [],
      upgradeUrl:
        typeof body.upgrade_url === 'string'
          ? body.upgrade_url
          : 'https://milton.so/upgrade',
    }
  }
  if (errorStr === 'tier_revoked') {
    return {
      kind: 'tier-revoked',
      jwtTier: typeof body.jwt_tier === 'string' ? body.jwt_tier : '',
      dbTier: typeof body.db_tier === 'string' ? body.db_tier : '',
      upgradeUrl:
        typeof body.upgrade_url === 'string'
          ? body.upgrade_url
          : 'https://milton.so/upgrade',
    }
  }
  return {
    kind: 'quota-exceeded',
    tier: typeof body.tier === 'string' ? body.tier : 'free',
    limit: typeof body.limit === 'number' ? body.limit : 350,
    windowDays: typeof body.window_days === 'number' ? body.window_days : 7,
    nextResetSeconds:
      typeof body.next_reset_seconds === 'number' ? body.next_reset_seconds : 0,
  }
}

function parseRetryAfter(resp: Response, fallbackSeconds: number): number {
  const header = resp.headers.get('Retry-After')
  if (!header) return fallbackSeconds
  const parsed = Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds
}
