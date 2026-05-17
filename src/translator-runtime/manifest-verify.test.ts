// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bytesToHex,
  hexToBytes,
  verifyManifestSignature,
} from './manifest-verify'
import {
  MANIFEST_SIGNING_PUBKEY,
  MANIFEST_SIGNING_PUBKEY_HEX,
} from './manifest-signing-pubkey'

// Fixtures pinned to upstreamCommit=85dfb399fdc2a73d9755b7cab394af7826af6297
// (fetched from translators.milton.so/repo/{metadata,metadata.sig} on
// 2026-05-17). If signing key rotates per BE-8-1 AC9 runbook, regenerate
// via:
//   curl -s https://translators.milton.so/repo/metadata     > src/translator-runtime/__fixtures__/manifest.fixture.json
//   curl -s https://translators.milton.so/repo/metadata.sig > src/translator-runtime/__fixtures__/manifest.fixture.sig
// Tests verify offline against this frozen fixture — never hit the live
// CDN. Updating the pubkey constant alone is not sufficient (signature
// must match too).

const FIXTURE_DIR = resolve(__dirname, '__fixtures__')
const MANIFEST_BYTES = new Uint8Array(
  readFileSync(resolve(FIXTURE_DIR, 'manifest.fixture.json')),
)
const SIGNATURE_HEX = readFileSync(
  resolve(FIXTURE_DIR, 'manifest.fixture.sig'),
  'utf-8',
).trim()
const SIGNATURE_BYTES = hexToBytes(SIGNATURE_HEX)!

describe('verifyManifestSignature', () => {
  it('verifies the frozen fixture against the embedded production pubkey', async () => {
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      SIGNATURE_BYTES,
      MANIFEST_SIGNING_PUBKEY,
    )
    expect(ok).toBe(true)
  })

  it('rejects a tampered manifest (one byte flipped)', async () => {
    const tampered = new Uint8Array(MANIFEST_BYTES)
    tampered[0] ^= 0x01 // flip lowest bit of first byte
    const ok = await verifyManifestSignature(
      tampered,
      SIGNATURE_BYTES,
      MANIFEST_SIGNING_PUBKEY,
    )
    expect(ok).toBe(false)
  })

  it('rejects a tampered signature (one byte flipped)', async () => {
    const tampered = new Uint8Array(SIGNATURE_BYTES)
    tampered[0] ^= 0x01
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      tampered,
      MANIFEST_SIGNING_PUBKEY,
    )
    expect(ok).toBe(false)
  })

  it('rejects a wrong public key (random 32-byte key)', async () => {
    const wrongKey = new Uint8Array(32)
    for (let i = 0; i < 32; i++) wrongKey[i] = i ^ 0x42
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      SIGNATURE_BYTES,
      wrongKey,
    )
    expect(ok).toBe(false)
  })

  it('returns false on wrong-length signature (not 64 bytes)', async () => {
    const truncated = SIGNATURE_BYTES.slice(0, 63)
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      truncated,
      MANIFEST_SIGNING_PUBKEY,
    )
    expect(ok).toBe(false)
  })

  it('returns false on wrong-length pubkey (not 32 bytes)', async () => {
    const truncatedPub = MANIFEST_SIGNING_PUBKEY.slice(0, 31)
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      SIGNATURE_BYTES,
      truncatedPub,
    )
    expect(ok).toBe(false)
  })

  it('returns false on malformed-curve-point pubkey (32 zero bytes)', async () => {
    const allZeros = new Uint8Array(32)
    const ok = await verifyManifestSignature(
      MANIFEST_BYTES,
      SIGNATURE_BYTES,
      allZeros,
    )
    // 32 zero bytes is technically a valid pubkey length but represents an
    // invalid curve point; @noble/ed25519 may either return false or throw.
    // verifyManifestSignature catches the throw and returns false either way.
    expect(ok).toBe(false)
  })
})

describe('hexToBytes', () => {
  it('decodes well-formed lowercase hex', () => {
    const bytes = hexToBytes('deadbeef')
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('decodes well-formed uppercase hex', () => {
    const bytes = hexToBytes('DEADBEEF')
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('trims surrounding whitespace', () => {
    const bytes = hexToBytes('  deadbeef\n')
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('returns null on odd length', () => {
    expect(hexToBytes('abc')).toBeNull()
  })

  it('returns null on non-hex characters', () => {
    expect(hexToBytes('zzzz')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(hexToBytes('')).toBeNull()
    expect(hexToBytes('   ')).toBeNull()
  })

  it('round-trips through bytesToHex', () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0xff, 0x42])
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
  })
})

describe('MANIFEST_SIGNING_PUBKEY constant', () => {
  it('is exactly 32 bytes (Ed25519 pubkey size)', () => {
    expect(MANIFEST_SIGNING_PUBKEY.length).toBe(32)
  })

  it('matches the documented hex constant', () => {
    expect(bytesToHex(MANIFEST_SIGNING_PUBKEY)).toBe(
      MANIFEST_SIGNING_PUBKEY_HEX,
    )
  })

  it('is the production pubkey from Milton-saas (canonical hash check)', () => {
    // Cross-repo audit: if this changes, BE-8-1 AC9 rotation happened and
    // this assertion + the fixture files MUST be updated together.
    expect(MANIFEST_SIGNING_PUBKEY_HEX).toBe(
      '7ac3571fa3686b0d3814dbf951800fe69fcf3a4d2e3e82dde68f4c6c64b414b6',
    )
  })
})
