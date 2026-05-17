// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Ed25519 signature verification for translator-mirror manifests
// (BE-8-5 AC1/AC3/AC7). Wraps @noble/ed25519@^1 so callers don't depend on
// the library API directly. Used by both:
//   - scripts/refresh-translator-bundle.ts (Node, build-time)
//   - src/translator-runtime/translator-fetcher.ts (browser, runtime)
// Both contexts share the same primitive — keep the API surface minimal so
// the trust-anchor logic stays auditable.

import * as ed from '@noble/ed25519'

/**
 * Verify an Ed25519 signature over arbitrary bytes.
 *
 * Returns true iff the signature is valid for the given message under the
 * given public key. Returns false on every failure mode — malformed bytes,
 * wrong-length inputs, wrong key, tampered message, anything. NEVER throws
 * for cryptographic reasons; only synchronously throws on programmer error
 * (non-Uint8Array inputs would TypeError before reaching us — but we coerce
 * defensively at the boundary).
 *
 * The caller decides what to do on failure (reject manifest, log + skip,
 * etc.) — this primitive is policy-free.
 */
export async function verifyManifestSignature(
  manifestBytes: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  // Defensive: @noble/ed25519@1.x's verify rejects asynchronously when
  // signature/key lengths are wrong, but only after some computation. Pre-
  // check the lengths so we fail-fast (faster + simpler error surface).
  if (signature.length !== 64) return false
  if (publicKey.length !== 32) return false

  try {
    return await ed.verify(signature, manifestBytes, publicKey)
  } catch {
    // Catches malformed-curve-point errors and any other cryptographic
    // exceptions. Treat as verification-failed; don't leak crypto error
    // details to callers.
    return false
  }
}

/**
 * Parse a hex string into a Uint8Array. Trims surrounding whitespace.
 * Returns null on non-hex input or odd length — the signature file format
 * is `<128 hex chars>\n` per the translator-mirror serving contract; any
 * deviation is a corruption signal we want to surface to callers.
 */
export function hexToBytes(hex: string): Uint8Array | null {
  const cleaned = hex.trim()
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Format a Uint8Array as lower-case hex (no separators). Inverse of
 * `hexToBytes`. Used for serializing manifest pubkeys + per-translator
 * sha256 values into committed artifacts (translator-bundle-pin.json).
 */
export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0')
  }
  return s
}
