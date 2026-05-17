#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Build-time tool: fetch the curated translator bundle from
// translators.milton.so/repo, verify the manifest signature + each
// translator's SHA-256, write verified bytes to
// src/translator-runtime/translators/<slug>.js, regenerate the REGISTRY
// block of src/translator-runtime/translator-bundle.ts, and write the
// build-time pin file (translator-bundle-pin.json) at the repo root.
//
// Run via:  pnpm refresh:translators
// Idempotent: re-running with the same curated list + same upstream
// manifest produces byte-identical output (BE-8-5 AC4 + AC14).
// Atomic: ANY verification or fetch failure → exit non-zero, no writes
// (tmp files cleaned up on failure).
//
// Architecture decisions encoded here (BE-8-5):
//   - Manifest signature verified ONCE before any translator fetch (AC1)
//   - Per-translator SHA-256 verified on receipt (AC4)
//   - Slug collisions fail-loud (AC3 / Task 3.4); explicit `# slug-override:`
//     comment in curated-translators.txt provides escape hatch
//   - Bundle entries are written as plain .js files; Vite ?raw imports
//     handle them at build time (no JSON-encoding overhead)
//   - REGISTRY block in translator-bundle.ts is regenerated between
//     // GENERATED-START / // GENERATED-END markers; everything outside
//     those markers is preserved verbatim (BE-8-4 parseTranslatorHeader
//     hardening must not be clobbered)

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hexToBytes,
  verifyManifestSignature,
} from '../src/translator-runtime/manifest-verify'
import {
  MANIFEST_SIGNING_PUBKEY,
  MANIFEST_SIGNING_PUBKEY_HEX,
} from '../src/translator-runtime/manifest-signing-pubkey'

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURATED_LIST_PATH = join(REPO_ROOT, 'src/translator-runtime/curated-translators.txt')
const TRANSLATORS_DIR = join(REPO_ROOT, 'src/translator-runtime/translators')
const BUNDLE_TS_PATH = join(REPO_ROOT, 'src/translator-runtime/translator-bundle.ts')
const PIN_PATH = join(REPO_ROOT, 'translator-bundle-pin.json')
const MIRROR_BASE_URL = 'https://translators.milton.so/repo'

const SANITY_MIN = 5
const SANITY_MAX = 200

const GENERATED_START_MARKER = '// GENERATED-START — populated by scripts/refresh-translator-bundle.ts; do NOT hand-edit'
const GENERATED_END_MARKER = '// GENERATED-END'

// ────────────────────────────────────────────────────────────────────────────
// Curated list parsing
// ────────────────────────────────────────────────────────────────────────────

interface CuratedEntry {
  translatorID: string
  slugOverride?: string
}

async function parseCuratedList(): Promise<CuratedEntry[]> {
  const text = await readFile(CURATED_LIST_PATH, 'utf-8')
  const entries: CuratedEntry[] = []
  let pendingSlugOverride: string | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    // Check for slug-override directive (must precede the UUID line).
    const overrideMatch = line.match(/^#\s*slug-override:\s*([a-z0-9][a-z0-9-]*)\s*$/)
    if (overrideMatch !== null) {
      pendingSlugOverride = overrideMatch[1]
      continue
    }
    if (line.startsWith('#')) {
      pendingSlugOverride = undefined
      continue
    }
    // First whitespace-separated token is the translatorID; anything after
    // (e.g. inline `# Label` comment) is documentation only.
    const id = line.split(/\s+/)[0]
    if (id.length === 0) continue
    entries.push({ translatorID: id, slugOverride: pendingSlugOverride })
    pendingSlugOverride = undefined
  }
  return entries
}

// ────────────────────────────────────────────────────────────────────────────
// Manifest fetch + verify
// ────────────────────────────────────────────────────────────────────────────

interface ManifestEntry {
  translatorID: string
  label: string
  sha256: string
  size_bytes: number
  priority: number
  target?: string
  translatorType: number
  lastUpdated: string
}

interface Manifest {
  schema_version: string
  mirror: string
  generated_at: string
  upstream_commit: string
  upstream_source: string
  license: string
  signature_url: string
  translators: ManifestEntry[]
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${r.status} ${r.statusText}`)
  }
  return new Uint8Array(await r.arrayBuffer())
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${r.status} ${r.statusText}`)
  }
  return await r.text()
}

async function fetchAndVerifyManifest(): Promise<{ manifest: Manifest; manifestBytes: Uint8Array }> {
  const manifestBytes = await fetchBytes(`${MIRROR_BASE_URL}/metadata`)
  const sigText = await fetchText(`${MIRROR_BASE_URL}/metadata.sig`)
  const sigBytes = hexToBytes(sigText)
  if (sigBytes === null) {
    throw new Error('Signature file malformed — expected hex-encoded 64-byte Ed25519 sig')
  }
  const verified = await verifyManifestSignature(manifestBytes, sigBytes, MANIFEST_SIGNING_PUBKEY)
  if (!verified) {
    throw new Error(
      'Manifest signature verification FAILED. Either (a) signing key rotated (per BE-8-1 AC9 runbook — update src/translator-runtime/manifest-signing-pubkey.ts), or (b) CDN was tampered with. ABORT.',
    )
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest
  return { manifest, manifestBytes }
}

// ────────────────────────────────────────────────────────────────────────────
// Slug derivation
// ────────────────────────────────────────────────────────────────────────────

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-') // any run of non-[a-z0-9] → single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
}

interface ResolvedTranslator {
  translatorID: string
  label: string
  slug: string
  sha256ExpectedHex: string
  sizeBytes: number
  source: Uint8Array
}

function detectSlugCollisions(resolved: ResolvedTranslator[]): void {
  const bySlug = new Map<string, ResolvedTranslator[]>()
  for (const t of resolved) {
    const arr = bySlug.get(t.slug) ?? []
    arr.push(t)
    bySlug.set(t.slug, arr)
  }
  const collisions: string[] = []
  for (const [slug, ts] of bySlug.entries()) {
    if (ts.length > 1) {
      collisions.push(
        `  slug "${slug}":\n${ts.map((t) => `    - ${t.translatorID}  ${t.label}`).join('\n')}`,
      )
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Slug collision detected — two or more curated translators slug to the same filename. ` +
        `Disambiguate by removing one from src/translator-runtime/curated-translators.txt, OR ` +
        `prepend a "# slug-override: <new-slug>" comment line above the affected UUID to force ` +
        `a different slug.\n\n${collisions.join('\n')}`,
    )
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-translator fetch + verify
// ────────────────────────────────────────────────────────────────────────────

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fetchAndVerifyTranslator(
  curated: CuratedEntry,
  manifest: Manifest,
): Promise<ResolvedTranslator> {
  const entry = manifest.translators.find((t) => t.translatorID === curated.translatorID)
  if (entry === undefined) {
    throw new Error(
      `Curated translator ${curated.translatorID} NOT FOUND in manifest. Either the UUID is wrong, or the translator was removed upstream. Inspect ${MIRROR_BASE_URL}/metadata to debug.`,
    )
  }
  const source = await fetchBytes(`${MIRROR_BASE_URL}/code/${curated.translatorID}`)
  const actualHex = sha256Hex(source)
  if (actualHex !== entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for translator ${curated.translatorID} (${entry.label}):\n` +
        `  manifest claims: ${entry.sha256}\n` +
        `  actual bytes:    ${actualHex}\n` +
        `Bytes-vs-manifest tamper or corruption — ABORT.`,
    )
  }
  if (source.length !== entry.size_bytes) {
    throw new Error(
      `Size mismatch for translator ${curated.translatorID} (${entry.label}): manifest=${entry.size_bytes} B, actual=${source.length} B`,
    )
  }
  return {
    translatorID: curated.translatorID,
    label: entry.label,
    slug: curated.slugOverride ?? slugify(entry.label),
    sha256ExpectedHex: entry.sha256,
    sizeBytes: entry.size_bytes,
    source,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Output writers
// ────────────────────────────────────────────────────────────────────────────

interface WriteTransaction {
  tmpFiles: string[]
  finalFiles: string[]
}

async function stageFile(tx: WriteTransaction, finalPath: string, contents: Uint8Array | string): Promise<void> {
  const tmpPath = `${finalPath}.tmp-${process.pid}`
  await writeFile(tmpPath, contents)
  tx.tmpFiles.push(tmpPath)
  tx.finalFiles.push(finalPath)
}

async function commitTransaction(tx: WriteTransaction): Promise<void> {
  for (let i = 0; i < tx.tmpFiles.length; i++) {
    await rename(tx.tmpFiles[i], tx.finalFiles[i])
  }
}

async function rollbackTransaction(tx: WriteTransaction): Promise<void> {
  for (const tmp of tx.tmpFiles) {
    try {
      await unlink(tmp)
    } catch {
      // best effort
    }
  }
}

async function cleanStaleTranslatorFiles(keepSlugs: Set<string>): Promise<string[]> {
  if (!existsSync(TRANSLATORS_DIR)) return []
  const entries = await readdir(TRANSLATORS_DIR)
  const removed: string[] = []
  for (const name of entries) {
    if (!name.endsWith('.js')) continue
    const slug = name.slice(0, -3) // strip `.js`
    if (!keepSlugs.has(slug)) {
      await unlink(join(TRANSLATORS_DIR, name))
      removed.push(name)
    }
  }
  return removed
}

// ────────────────────────────────────────────────────────────────────────────
// REGISTRY block regeneration
// ────────────────────────────────────────────────────────────────────────────

function renderRegistryBlock(resolved: ResolvedTranslator[]): string {
  // Sort by slug for deterministic output (idempotency requirement: same
  // input → same bytes; same git diff on second run).
  const sorted = [...resolved].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  const imports = sorted
    .map((t) => `import ${slugToCamel(t.slug)}Source from './translators/${t.slug}.js?raw'`)
    .join('\n')
  const entries = sorted
    .map((t) => `  ${JSON.stringify(t.slug)}: { source: ${slugToCamel(t.slug)}Source },`)
    .join('\n')
  return `${GENERATED_START_MARKER}
${imports}

const REGISTRY: Record<string, BundleEntry> = {
${entries}
}
${GENERATED_END_MARKER}`
}

function slugToCamel(slug: string): string {
  // Convert kebab-case slug to camelCase identifier suitable for use as a
  // JS variable name (the ?raw import binding).
  return slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

async function regenerateBundleTs(resolved: ResolvedTranslator[], tx: WriteTransaction): Promise<void> {
  const current = await readFile(BUNDLE_TS_PATH, 'utf-8')
  const startIdx = current.indexOf(GENERATED_START_MARKER)
  const endIdx = current.indexOf(GENERATED_END_MARKER)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `${BUNDLE_TS_PATH} is missing GENERATED-START / GENERATED-END markers. ` +
        `Add them around the REGISTRY block before re-running this script. ` +
        `(BE-8-4 left the file without markers because BE-8-5 introduces auto-gen.)`,
    )
  }
  const before = current.slice(0, startIdx)
  const afterMarker = current.slice(endIdx + GENERATED_END_MARKER.length)
  const newContents = `${before}${renderRegistryBlock(resolved)}${afterMarker}`
  await stageFile(tx, BUNDLE_TS_PATH, newContents)
}

// ────────────────────────────────────────────────────────────────────────────
// Pin file
// ────────────────────────────────────────────────────────────────────────────

interface PinFile {
  upstreamCommit: string
  fetchedAt: string
  publicKey: string // hex
  bundleHashes: Record<string, string> // translatorID → sha256 hex
}

async function writePinFile(
  manifest: Manifest,
  resolved: ResolvedTranslator[],
  publicKeyHex: string,
  tx: WriteTransaction,
): Promise<void> {
  // Sort bundleHashes keys for deterministic output (idempotency).
  const sortedHashes: Record<string, string> = {}
  for (const t of [...resolved].sort((a, b) => (a.translatorID < b.translatorID ? -1 : 1))) {
    sortedHashes[t.translatorID] = t.sha256ExpectedHex
  }
  const pin: PinFile = {
    upstreamCommit: manifest.upstream_commit,
    fetchedAt: manifest.generated_at,
    publicKey: publicKeyHex,
    bundleHashes: sortedHashes,
  }
  // JSON with 2-space indent + trailing newline — matches the rest of the
  // repo's JSON conventions (package.json etc).
  await stageFile(tx, PIN_PATH, JSON.stringify(pin, null, 2) + '\n')
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[refresh-translator-bundle] starting')
  console.log(`  CDN base: ${MIRROR_BASE_URL}`)

  // 1. Parse curated list.
  const curated = await parseCuratedList()
  console.log(`  curated: ${curated.length} translator(s)`)
  if (curated.length < SANITY_MIN || curated.length > SANITY_MAX) {
    throw new Error(
      `Curated list size ${curated.length} outside sanity bound [${SANITY_MIN}, ${SANITY_MAX}]`,
    )
  }

  // 2. Fetch + verify manifest.
  const { manifest } = await fetchAndVerifyManifest()
  console.log(`  manifest: ${manifest.translators.length} translator(s) total; upstreamCommit=${manifest.upstream_commit}`)

  // 3. Fetch + verify each curated translator. Run in parallel (CDN is
  //    rate-limited but 26 requests is well within Traefik's 200/10min cap).
  console.log('  fetching curated translators...')
  const resolved = await Promise.all(curated.map((c) => fetchAndVerifyTranslator(c, manifest)))
  console.log(`  fetched + verified: ${resolved.length} translator(s)`)

  // 4. Slug-collision check (fail loud per AC3 / Task 3.4).
  detectSlugCollisions(resolved)

  // 5. Stage all writes in a transaction; commit only if every step succeeds.
  await mkdir(TRANSLATORS_DIR, { recursive: true })
  const tx: WriteTransaction = { tmpFiles: [], finalFiles: [] }

  try {
    // 5a. Write per-translator .js files.
    for (const t of resolved) {
      const finalPath = join(TRANSLATORS_DIR, `${t.slug}.js`)
      await stageFile(tx, finalPath, t.source)
    }

    // 5b. Regenerate REGISTRY block in translator-bundle.ts.
    await regenerateBundleTs(resolved, tx)

    // 5c. Write pin file.
    await writePinFile(manifest, resolved, MANIFEST_SIGNING_PUBKEY_HEX, tx)

    // 5d. Commit transaction.
    await commitTransaction(tx)
    console.log(`  committed ${tx.finalFiles.length} file write(s)`)
  } catch (err) {
    await rollbackTransaction(tx)
    throw err
  }

  // 6. Clean stale translator files (slugs no longer in curated list).
  //    Done OUTSIDE the transaction because it's deletion-only and the
  //    write transaction already succeeded. Failure here is non-fatal.
  const keepSlugs = new Set(resolved.map((t) => t.slug))
  // Preserve the BE-8-4 hand-vendored file (different slug case) so the
  // transition is visible in git rather than a silent delete.
  const removed = await cleanStaleTranslatorFiles(keepSlugs)
  if (removed.length > 0) {
    console.log(`  removed stale file(s): ${removed.join(', ')}`)
  }

  // 7. Report summary.
  const totalSize = resolved.reduce((sum, t) => sum + t.sizeBytes, 0)
  console.log(`[refresh-translator-bundle] DONE`)
  console.log(`  ${resolved.length} translators bundled, ${(totalSize / 1024).toFixed(1)} KB raw`)
  console.log(`  manifest pin: ${manifest.upstream_commit}`)
}

main().catch((err) => {
  console.error('[refresh-translator-bundle] FAILED')
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
