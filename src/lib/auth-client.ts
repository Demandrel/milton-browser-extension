// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import type { IssueTokenResponse, TokenFetchResult } from './types'

// SINGLE source of truth — mirrors connector-client.ts.
const CONNECTOR_BASE = 'http://127.0.0.1:7521'

const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60

/**
 * Mint a short-lived (30s TTL) per-device JWT from Milton's local connector
 * for the extension to present to translate.milton.so as a Bearer token.
 *
 * Story 18-15 + BE-4. The fetched token is NOT cached across calls — each
 * save fetches a fresh one. 30s TTL means caching adds nothing useful and
 * localhost round-trip is sub-millisecond. The browser sets the Origin
 * header automatically (chrome-extension://<id>); the connector validates it
 * against MILTON_EXTENSION_IDS (debug builds accept any chrome-extension://).
 */
export async function fetchTranslationToken(): Promise<TokenFetchResult> {
  let resp: Response
  try {
    resp = await fetch(`${CONNECTOR_BASE}/auth/issue-token`, {
      method: 'POST',
    })
  } catch (e) {
    return {
      ok: false,
      reason: 'network-error',
      message: e instanceof Error ? e.message : 'Network error',
    }
  }

  if (resp.status === 200) {
    let body: IssueTokenResponse
    try {
      body = (await resp.json()) as IssueTokenResponse
    } catch {
      return {
        ok: false,
        reason: 'unexpected',
        status: 200,
        message: 'Token response was not valid JSON',
      }
    }
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return {
        ok: false,
        reason: 'unexpected',
        status: 200,
        message: 'Token response missing `token` field',
      }
    }
    return { ok: true, token: body.token }
  }

  if (resp.status === 401) return { ok: false, reason: 'signed-out' }
  if (resp.status === 403) return { ok: false, reason: 'origin-rejected' }

  if (resp.status === 429) {
    return {
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: parseRetryAfter(resp, DEFAULT_RATE_LIMIT_RETRY_SECONDS),
    }
  }

  return {
    ok: false,
    reason: 'unexpected',
    status: resp.status,
    message: `Unexpected token-mint status ${resp.status}`,
  }
}

function parseRetryAfter(resp: Response, fallbackSeconds: number): number {
  const header = resp.headers.get('Retry-After')
  if (!header) return fallbackSeconds
  const parsed = Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds
}
