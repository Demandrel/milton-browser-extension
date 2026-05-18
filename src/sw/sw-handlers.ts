// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// BE-8-9: testable SW handler logic. sw.ts registers chrome event
// listeners that delegate here. Splitting the logic out keeps the
// top-level SW file free of business code (which is hard to unit-test
// because top-level addListener calls run on import) — handlers are
// plain async functions you can call from a Vitest test with chrome.*
// mocks installed.

import {
  REFRESH_ALARM_NAME,
  REFRESH_PERIOD_MINUTES,
  REFRESH_PERIOD_MS,
  readRefreshState,
  refreshBundledTranslators,
} from '../translator-runtime/translator-refresh'

const LOG_PREFIX = '[milton-sw]'

/**
 * Idempotent: only creates the alarm if `chrome.alarms.get` reports no
 * existing instance. Re-install / browser-restart MUST NOT create a
 * duplicate, so the get-then-create pattern is load-bearing (AC2).
 */
export async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(REFRESH_ALARM_NAME)
  if (existing !== undefined) return
  await chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES })
  console.log(`${LOG_PREFIX} alarm ${REFRESH_ALARM_NAME} created (period=${REFRESH_PERIOD_MINUTES}min)`)
}

async function refreshSafely(triggerLabel: string): Promise<void> {
  console.log(`${LOG_PREFIX} refresh trigger=${triggerLabel}`)
  try {
    const result = await refreshBundledTranslators()
    console.log(
      `${LOG_PREFIX} refresh result=${result.lastRefreshResult} updatedCount=${result.updatedCount} durationMs=${result.durationMs}`,
    )
  } catch (err) {
    // refreshBundledTranslators is designed to catch its own per-translator
    // and storage failures (AC7 contract) and return a RefreshResult rather
    // than throwing. This catch is a final safety net for genuinely
    // unexpected throws (refactor bugs, an unhandled error path) so the
    // chrome.runtime listener never crashes — which would mark the SW
    // "errored" in chrome://serviceworker-internals and break alarm dispatch.
    console.error(`${LOG_PREFIX} refresh threw unexpectedly:`, err)
  }
}

/**
 * onInstalled — always ensures the alarm + triggers an immediate refresh
 * so the user doesn't wait up to 6h after install/update for the first
 * refresh. `reason` is preserved in logs for debugging install vs update
 * vs Chrome-update flows.
 */
export async function handleInstalled(reason: string): Promise<void> {
  try {
    await ensureAlarm()
    await refreshSafely(`onInstalled:${reason}`)
  } catch (err) {
    console.error(`${LOG_PREFIX} onInstalled handler threw:`, err)
  }
}

/**
 * onStartup — ensures the alarm AND, if the last refresh ran more than
 * `REFRESH_PERIOD_MS` ago (or never), triggers an immediate refresh.
 * Catches the "browser was off for a week and the alarm queue dropped"
 * case (AC2).
 */
export async function handleStartup(): Promise<void> {
  try {
    await ensureAlarm()
    const state = await readRefreshState()
    const overdueByMs = state === null ? Number.POSITIVE_INFINITY : Date.now() - state.lastRefreshAt
    if (overdueByMs >= REFRESH_PERIOD_MS) {
      await refreshSafely(
        `onStartup:overdueBy=${Number.isFinite(overdueByMs) ? Math.floor(overdueByMs / 1000) + 's' : 'never-ran'}`,
      )
    } else {
      console.log(
        `${LOG_PREFIX} onStartup: refresh not overdue (last ran ${Math.floor(overdueByMs / 1000)}s ago)`,
      )
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} onStartup handler threw:`, err)
  }
}

/**
 * onAlarm — fires on every chrome.alarms tick. We listen on every alarm
 * to keep the registration generic, but only refresh when the alarm name
 * is ours; other alarms (if any are added later) get a debug log + no-op.
 */
export async function handleAlarm(alarmName: string): Promise<void> {
  if (alarmName !== REFRESH_ALARM_NAME) return
  try {
    await refreshSafely(`onAlarm:${alarmName}`)
  } catch (err) {
    console.error(`${LOG_PREFIX} onAlarm handler threw:`, err)
  }
}
