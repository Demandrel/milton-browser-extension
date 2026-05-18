// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../translator-runtime/translator-refresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../translator-runtime/translator-refresh')>()
  return {
    ...actual,
    refreshBundledTranslators: vi.fn(),
    readRefreshState: vi.fn(),
  }
})

import {
  REFRESH_ALARM_NAME,
  REFRESH_PERIOD_MINUTES,
  REFRESH_PERIOD_MS,
  readRefreshState,
  refreshBundledTranslators,
} from '../translator-runtime/translator-refresh'
import { ensureAlarm, handleAlarm, handleInstalled, handleStartup } from './sw-handlers'

// ────────────────────────────────────────────────────────────────────────
// chrome.alarms + chrome.runtime mock — minimal surface (no real SDK)
// ────────────────────────────────────────────────────────────────────────

interface AlarmRecord {
  name: string
  periodInMinutes: number
}

interface MockChrome {
  alarms: {
    create: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    onAlarm: { addListener: ReturnType<typeof vi.fn> }
  }
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn> }
    onStartup: { addListener: ReturnType<typeof vi.fn> }
  }
}

function installChromeMock(): { mock: MockChrome; alarms: Map<string, AlarmRecord> } {
  const alarms = new Map<string, AlarmRecord>()
  const mock: MockChrome = {
    alarms: {
      create: vi.fn(async (name: string, options: { periodInMinutes: number }) => {
        alarms.set(name, { name, periodInMinutes: options.periodInMinutes })
      }),
      get: vi.fn(async (name: string) => {
        return alarms.get(name)
      }),
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = mock
  return { mock, alarms }
}

function uninstallChromeMock(): void {
  delete (globalThis as { chrome?: unknown }).chrome
}

describe('ensureAlarm — idempotent alarm registration (AC2)', () => {
  let alarms: Map<string, AlarmRecord>
  let mock: MockChrome

  beforeEach(() => {
    ;({ mock, alarms } = installChromeMock())
  })

  afterEach(() => {
    uninstallChromeMock()
    vi.clearAllMocks()
  })

  it('creates the alarm with periodInMinutes=360 on first call', async () => {
    await ensureAlarm()
    expect(alarms.size).toBe(1)
    expect(alarms.get(REFRESH_ALARM_NAME)?.periodInMinutes).toBe(REFRESH_PERIOD_MINUTES)
    expect(mock.alarms.create).toHaveBeenCalledTimes(1)
  })

  it('does NOT recreate the alarm when one already exists', async () => {
    alarms.set(REFRESH_ALARM_NAME, { name: REFRESH_ALARM_NAME, periodInMinutes: REFRESH_PERIOD_MINUTES })
    await ensureAlarm()
    expect(mock.alarms.create).not.toHaveBeenCalled()
  })

  it('survives re-install: ensureAlarm called twice → still only one alarm', async () => {
    await ensureAlarm()
    await ensureAlarm()
    expect(alarms.size).toBe(1)
    expect(mock.alarms.create).toHaveBeenCalledTimes(1)
  })
})

describe('handleInstalled — ensures alarm + immediate refresh (AC2)', () => {
  beforeEach(() => {
    installChromeMock()
    vi.mocked(refreshBundledTranslators).mockResolvedValue({
      lastRefreshAt: Date.now(),
      lastRefreshResult: 'success',
      updatedCount: 0,
      durationMs: 10,
    })
  })

  afterEach(() => {
    uninstallChromeMock()
    vi.clearAllMocks()
  })

  it('creates the alarm and triggers refresh once', async () => {
    await handleInstalled('install')
    expect(vi.mocked(refreshBundledTranslators)).toHaveBeenCalledTimes(1)
  })

  it('swallows refresh errors (caller must not crash on a bad refresh)', async () => {
    vi.mocked(refreshBundledTranslators).mockRejectedValue(new Error('boom'))
    await expect(handleInstalled('install')).resolves.toBeUndefined()
  })
})

describe('handleStartup — overdue check (AC2)', () => {
  beforeEach(() => {
    installChromeMock()
    vi.mocked(refreshBundledTranslators).mockResolvedValue({
      lastRefreshAt: Date.now(),
      lastRefreshResult: 'success',
      updatedCount: 0,
      durationMs: 10,
    })
  })

  afterEach(() => {
    uninstallChromeMock()
    vi.clearAllMocks()
  })

  it('triggers refresh when last-refresh state is null (never ran)', async () => {
    vi.mocked(readRefreshState).mockResolvedValue(null)
    await handleStartup()
    expect(vi.mocked(refreshBundledTranslators)).toHaveBeenCalledTimes(1)
  })

  it('triggers refresh when last-refresh is older than the period (overdue)', async () => {
    vi.mocked(readRefreshState).mockResolvedValue({
      lastRefreshAt: Date.now() - REFRESH_PERIOD_MS - 1000,
      lastRefreshResult: 'success',
      updatedCount: 0,
      durationMs: 10,
    })
    await handleStartup()
    expect(vi.mocked(refreshBundledTranslators)).toHaveBeenCalledTimes(1)
  })

  it('does NOT trigger refresh when last-refresh is within the period', async () => {
    vi.mocked(readRefreshState).mockResolvedValue({
      lastRefreshAt: Date.now() - 1000,
      lastRefreshResult: 'success',
      updatedCount: 0,
      durationMs: 10,
    })
    await handleStartup()
    expect(vi.mocked(refreshBundledTranslators)).not.toHaveBeenCalled()
  })
})

describe('handleAlarm — name-gated refresh', () => {
  beforeEach(() => {
    installChromeMock()
    vi.mocked(refreshBundledTranslators).mockResolvedValue({
      lastRefreshAt: Date.now(),
      lastRefreshResult: 'success',
      updatedCount: 0,
      durationMs: 10,
    })
  })

  afterEach(() => {
    uninstallChromeMock()
    vi.clearAllMocks()
  })

  it('triggers refresh when alarm name matches', async () => {
    await handleAlarm(REFRESH_ALARM_NAME)
    expect(vi.mocked(refreshBundledTranslators)).toHaveBeenCalledTimes(1)
  })

  it('ignores alarms with other names (defense for any future alarms)', async () => {
    await handleAlarm('some-other-alarm')
    expect(vi.mocked(refreshBundledTranslators)).not.toHaveBeenCalled()
  })
})
