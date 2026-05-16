// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Local type augmentation for the `chrome` namespace.
//
// Chrome surfaces `mimeType` on `chrome.tabs.Tab` for tabs hosting documents
// the built-in PDF viewer renders (`mimeType: 'application/pdf'`) — used by
// BE-7 in `popup.ts` to detect PDF pages. The current `@types/chrome` pin
// doesn't declare the field, so we add it here (rather than scattering
// `as chrome.tabs.Tab & { mimeType?: string }` casts at every call site).
//
// `?:` keeps it optional — non-PDF tabs in some Chromium builds omit the
// field, and Firefox / Edge / Brave don't surface it at all.

declare namespace chrome.tabs {
  interface Tab {
    mimeType?: string
  }
}
