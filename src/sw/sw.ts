// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-9: MV3 service worker entry point. Thin glue layer — all business
// logic lives in `./sw-handlers.ts` so it's unit-testable. The SW must
// register its event listeners at the top level (Chrome wakes the SW on
// each event by re-running this script), so we can't move registrations
// behind a function call.
//
// MV3 SW lifetime caveat: workers are unloaded after ~30s of inactivity.
// Every async chain spawned from a handler MUST run to completion before
// the SW is allowed to unload. The `void (async () => { ... })()` pattern
// is fine because the awaited work happens INSIDE the IIFE; Chrome
// considers the SW busy until the promise settles.

import { handleAlarm, handleInstalled, handleStartup } from './sw-handlers'

chrome.runtime.onInstalled.addListener((details) => {
  void handleInstalled(details.reason)
})

chrome.runtime.onStartup.addListener(() => {
  void handleStartup()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleAlarm(alarm.name)
})

console.log('[milton-sw] booted')
