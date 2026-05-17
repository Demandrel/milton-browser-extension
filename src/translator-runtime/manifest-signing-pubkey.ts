// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Ed25519 public key for verifying translators.milton.so/repo/metadata
// signatures. The trust anchor for the lazy-CDN-fetch path (BE-8-5) AND
// the build-time refresh script (scripts/refresh-translator-bundle.ts).
//
// Source of truth: Milton-saas (private) at
// tools/translator-mirror/keys/manifest-signing.pub. The PUBLIC half is
// safe to commit here; the corresponding private key lives in operator
// custody (BE-8-1 AC9 runbook). Hash committed below for cross-repo audit:
// SHA-256 of the .pub file: ed5915b85e0798f86b270dfb4997a41e2a055c5349cde876b4904f5076ea2c98
//
// Rotation procedure (BE-8-1 AC9): if the key rotates, update this constant,
// regenerate the __fixtures__/manifest.fixture.* files, and ship a new
// extension release. Old extensions reject the new manifest signature and
// fall back to bundled translators only (graceful degradation).

import { hexToBytes } from './manifest-verify'

export const MANIFEST_SIGNING_PUBKEY_HEX =
  '7ac3571fa3686b0d3814dbf951800fe69fcf3a4d2e3e82dde68f4c6c64b414b6' as const

// Decoded once at module load. hexToBytes returns null on malformed input;
// the assertion encodes the contract that the constant above is well-formed.
// If it ever isn't, the runtime crashes at startup — loud failure on a
// tamper-or-typo, exactly what we want from the trust anchor.
export const MANIFEST_SIGNING_PUBKEY: Uint8Array = (() => {
  const bytes = hexToBytes(MANIFEST_SIGNING_PUBKEY_HEX)
  if (bytes === null || bytes.length !== 32) {
    throw new Error(
      'MANIFEST_SIGNING_PUBKEY_HEX is malformed (expected 64 hex chars / 32 raw bytes for Ed25519)',
    )
  }
  return bytes
})()
