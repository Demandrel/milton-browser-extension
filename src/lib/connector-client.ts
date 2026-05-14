import type {
  ConnectorReferencePayload,
  CreateReferenceResult,
  HealthResponse,
  HealthResult,
} from './types'

// SINGLE source of truth for the connector base URL — story BE-1 AC1 + Pre-Review check.
// Per docs/integrations/browser-extension-protocol.mdx the port is part of the contract;
// the extension hardcodes it.
const CONNECTOR_BASE = 'http://127.0.0.1:7521'
const HEALTH_TIMEOUT_MS = 2000
const MAX_BODY_BYTES = 64 * 1024 // matches connector/server.rs MAX_BODY_BYTES

/**
 * Probe Milton's local connector for liveness.
 * 200 OK + valid JSON shape → ok; refusal / timeout / shape mismatch → !ok with reason.
 *
 * Per protocol doc: GET /health returns 200 unconditionally when the server runs.
 * Used by the popup to gate the Save UI BEFORE allowing AC5 → AC6 flow.
 */
export async function health(): Promise<HealthResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
  try {
    const resp = await fetch(`${CONNECTOR_BASE}/health`, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!resp.ok) return { ok: false, reason: 'shape' }
    const body = (await resp.json()) as HealthResponse
    if (typeof body.app !== 'string' || typeof body.version !== 'string') {
      return { ok: false, reason: 'shape' }
    }
    if (body.app !== 'milton') {
      // AC3 atypical: log + proceed (forward-compat).
      console.warn(
        `[milton-ext] connector returned unexpected app: "${body.app}" (proceeding)`,
      )
    }
    return { ok: true, body }
  } catch (e) {
    clearTimeout(t)
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' }
    }
    return { ok: false, reason: 'refused' }
  }
}

/**
 * POST a reference to Milton's connector.
 *
 * AC6 atypical: pre-checks body size against the 64 KB connector limit and
 * surfaces a friendly error rather than letting axum reject it.
 *
 * AC7 forward-compat: caller must pass the 4 organization arrays. The mapper
 * (`csl-to-payload.ts`) populates them as empty defaults so the wire shape
 * stays locked.
 */
export async function createReference(
  payload: ConnectorReferencePayload,
): Promise<CreateReferenceResult> {
  const body = JSON.stringify(payload)
  if (body.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 'payload-too-large',
      message: 'Page metadata too large to capture',
    }
  }

  let resp: Response
  try {
    resp = await fetch(`${CONNECTOR_BASE}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  } catch (e) {
    return {
      ok: false,
      status: 'network-error',
      message: e instanceof Error ? e.message : 'Network error',
    }
  }

  // Decode body once. Many error responses share { message, detail? }.
  let parsed: unknown
  try {
    parsed = await resp.json()
  } catch {
    parsed = {}
  }
  const data = (typeof parsed === 'object' && parsed !== null
    ? parsed
    : {}) as Record<string, unknown>

  switch (resp.status) {
    case 201:
      return { ok: true, status: 201, id: String(data.id ?? '') }
    case 400:
      return {
        ok: false,
        status: 400,
        message: String(data.message ?? 'Invalid request'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    case 403:
      return {
        ok: false,
        status: 403,
        message: String(data.message ?? 'Forbidden'),
      }
    case 409:
      return {
        ok: false,
        status: 409,
        id: String(data.id ?? ''),
        matchedBy: String(data.matchedBy ?? ''),
        message: String(data.message ?? 'Already in your library'),
      }
    case 503:
      return {
        ok: false,
        status: 503,
        message: String(data.message ?? 'Milton is not signed in'),
        detail: data.detail !== undefined ? String(data.detail) : undefined,
      }
    default:
      return {
        ok: false,
        status: 'network-error',
        message: `Unexpected response: ${resp.status}`,
      }
  }
}
