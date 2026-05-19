#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026  Pierre Jacquel
#
# This file is part of milton-browser-extension.
# See COPYING for license terms.
#
# BE-8-10 AC1 / AC11 — production-build hardening guardrail.
#
# Verifies that `pnpm build` produces a `dist/` free of DEV-only spike hooks
# and BE-8-4 spike-harness artifacts. Run by CI on every PR (.github/workflows/ci.yml).
#
# What this catches (and why it matters):
#
#   1. JS code that exposes `window.miltonPopupSpike` or `window.miltonRuntimeSpike`.
#      These are DEV-internal console hooks used by Pierre during smoke testing
#      (see popup.ts:715, sandbox.ts wireSpikeTrigger). They MUST be gated by
#      `import.meta.env.DEV` so Vite strips them at production build. A regression
#      that drops the gate would ship a console-callable internal hook into the
#      Chrome Web Store artifact.
#
#   2. spike-page.html / spike-page.ts / any file with "spike" in the name shipped
#      to dist/. These are BE-8-4 integration-spike artifacts (extension-origin
#      wrapper page for direct sandbox testing). vite.config.ts conditionally
#      includes them only when `mode === 'development'`. A regression that re-adds
#      spike-page to the production rollupOptions.input would ship the entire
#      dev harness as user-installable code.
#
#   3. spike-page references in `dist/manifest.json`. Even if the spike-page
#      files aren't bundled, a stale manifest entry could land us in CWS review
#      hell ("why does your extension declare a page nobody can access?"). We
#      currently don't declare spike-page in manifest.config.ts, but a future
#      refactor might; this check is defense-in-depth.
#
# What this does NOT catch:
#   - HTML comments mentioning "spike-page.ts" as historical context (e.g.,
#     offscreen.html line 15). Those are informational; the checks below scope
#     to *.js files + manifest.json so comments don't false-positive.
#   - Symbols inside test files (we only scan dist/, never src/).
#
# Exit codes:
#   0 — production bundle is clean
#   1 — build failed OR a leak was detected (CI fails the job)
#
# To verify the script catches regressions, run:
#   1. Edit src/popup/popup.ts; insert `window.miltonPopupSpike = async () => []`
#      OUTSIDE the `if (import.meta.env.DEV)` block.
#   2. Run this script. Expect exit 1 with a "spike-trigger symbols" message.
#   3. Revert the edit.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "[verify-production-bundle] pnpm build (production mode)..."
if ! pnpm run build > /tmp/verify-prod-build.log 2>&1; then
  echo "❌ pnpm build failed. Log:"
  cat /tmp/verify-prod-build.log
  exit 1
fi
echo "[verify-production-bundle] build complete; running leak checks..."

# ────────────────────────────────────────────────────────────────────────
# Check 1: any file named *spike* in dist/ is a leak
# ────────────────────────────────────────────────────────────────────────
spike_files=$(find dist -name '*spike*' 2>/dev/null || true)
if [ -n "$spike_files" ]; then
  echo "❌ Production bundle contains spike-page files (BE-8-4 dev artifacts must not ship):"
  echo "$spike_files" | sed 's/^/  /'
  echo ""
  echo "Fix: ensure vite.config.ts excludes spike-page from rollupOptions.input"
  echo "     when mode === 'production' (BE-8-10 enforced this gate)."
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────
# Check 2: spike-trigger symbols in compiled JS = DEV gate regression
# ────────────────────────────────────────────────────────────────────────
spike_symbols=$(grep -rE 'miltonPopupSpike|miltonRuntimeSpike' dist/ --include='*.js' 2>/dev/null || true)
if [ -n "$spike_symbols" ]; then
  echo "❌ Production bundle exposes DEV-only spike-trigger symbols on window:"
  echo "$spike_symbols" | sed 's/^/  /'
  echo ""
  echo "Fix: wrap the offending call site in 'if (import.meta.env.DEV) { ... }'"
  echo "     (see popup.ts:715 and sandbox.ts bootstrapAll for the canonical pattern)."
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────
# Check 3: spike-page references in manifest.json
# ────────────────────────────────────────────────────────────────────────
if [ -f dist/manifest.json ]; then
  manifest_spike=$(grep -E 'spike-page' dist/manifest.json 2>/dev/null || true)
  if [ -n "$manifest_spike" ]; then
    echo "❌ Production manifest.json references spike-page:"
    echo "$manifest_spike" | sed 's/^/  /'
    exit 1
  fi
fi

echo "✅ Production bundle clean — no DEV-only hooks, no spike-page artifacts, no manifest leaks."
exit 0
