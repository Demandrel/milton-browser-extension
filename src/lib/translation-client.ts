import type { ZoteroCslItem } from './types'

// Base URL of the translation-server proxy (Caddy in front of zotero/translation-server).
// Prod default: `https://translate.milton.so` — set when TS-5 ships.
// Local dev: set `VITE_TRANSLATE_BASE=http://localhost` in `.env.local` and run
// `docker compose up` in `tools/translation-server/` (CADDY_HOST=http://localhost).
const TRANSLATE_BASE: string =
  import.meta.env.VITE_TRANSLATE_BASE ?? 'https://translate.milton.so'

/**
 * Extract Zotero-flavored CSL-JSON metadata for a URL via Milton's translation
 * server. Returns an array (translation server semantics: 0 → extractor didn't
 * match; 2+ → multi-item page).
 *
 * AC5 atypicals: caller surfaces empty-array, multi-item, missing-key, and
 * server-error cases through the popup state machine.
 *
 * Auth: `X-Milton-Key` header — required by the Caddy proxy in BOTH local and
 * prod modes (see `tools/translation-server/Caddyfile`). Build-time env
 * (`.env.local`, gitignored). Per Story 18-6 design, this will move to per-user
 * keys once 18-6 ships (Supabase secrets table). For BE-1 a shared dev key is
 * fine — Pierre's local docker-compose key, or his prod key once translate.milton.so is live.
 */
export async function extractMetadata(url: string): Promise<ZoteroCslItem[]> {
  const key = import.meta.env.VITE_MILTON_KEY
  if (!key || key === 'your-translation-server-key-here') {
    throw new Error(
      '[milton-ext] VITE_MILTON_KEY missing or still the placeholder — paste a real key into .env.local and rebuild',
    )
  }

  const resp = await fetch(`${TRANSLATE_BASE}/web`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'X-Milton-Key': key,
    },
    body: url,
  })

  if (!resp.ok) {
    throw new Error(
      `[milton-ext] translation server returned HTTP ${resp.status} from ${TRANSLATE_BASE}/web`,
    )
  }

  const data: unknown = await resp.json()
  if (!Array.isArray(data)) {
    throw new Error('[milton-ext] translation server returned non-array body')
  }
  return data as ZoteroCslItem[]
}
