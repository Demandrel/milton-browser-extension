#!/usr/bin/env bash
# Add SPDX AGPL-3.0-or-later headers to first-party source files.
# Idempotent: skips files whose first 200 bytes already contain SPDX-License-Identifier.
# Usage: scripts/add-spdx-headers.sh [target-dir]    (default: src)
# Env overrides: YEAR (default: current year), AUTHOR (default: "Pierre Jacquel")
set -euo pipefail

TARGET="${1:-src}"
YEAR="${YEAR:-$(date +%Y)}"
AUTHOR="${AUTHOR:-Pierre Jacquel}"

if [ ! -d "$TARGET" ]; then
  echo "error: target directory '$TARGET' not found" >&2
  exit 1
fi

HEADER_TS="// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) $YEAR  $AUTHOR
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

"

HEADER_CSS="/* SPDX-License-Identifier: AGPL-3.0-or-later
 * Copyright (C) $YEAR  $AUTHOR
 *
 * This file is part of milton-browser-extension.
 * See COPYING for license terms.
 */

"

HEADER_HTML="<!-- SPDX-License-Identifier: AGPL-3.0-or-later
     Copyright (C) $YEAR  $AUTHOR

     This file is part of milton-browser-extension.
     See COPYING for license terms. -->

"

added=0
skipped=0

while IFS= read -r -d '' file; do
  # Idempotency: skip files whose first 200 bytes mention SPDX-License-Identifier
  if head -c 200 "$file" | grep -q "SPDX-License-Identifier"; then
    skipped=$((skipped + 1))
    continue
  fi
  case "$file" in
    *.ts) HEADER="$HEADER_TS" ;;
    *.css) HEADER="$HEADER_CSS" ;;
    *.html) HEADER="$HEADER_HTML" ;;
    *) continue ;;
  esac
  printf '%s' "$HEADER" | cat - "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  added=$((added + 1))
done < <(find "$TARGET" -type f \( -name '*.ts' -o -name '*.css' -o -name '*.html' \) -print0)

echo "SPDX headers added: $added files"
echo "SPDX headers skipped (already present): $skipped files"
