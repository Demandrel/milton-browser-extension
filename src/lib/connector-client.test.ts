// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPdfBytes, createReference, listSelectors, MAX_PDF_BYTES } from './connector-client'
import type { ConnectorReferencePayload } from './types'

// ── fetch mock helpers ─────────────────────────────────────────────────────
//
// listSelectors fires three concurrent GETs (Promise.allSettled equivalent
// via Promise.all). The test mocks `globalThis.fetch` with a router that
// inspects the URL path and returns the configured Response per path.

type Route = {
  status?: number
  body?: unknown
  /** Throw a network-error instead of resolving. */
  throwError?: boolean
  /** Resolve with a Response object whose .json() throws. */
  malformedJson?: boolean
}

function installFetchMock(routes: Record<string, Route>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = new URL(url as string).pathname
    const route = routes[path]
    if (!route) {
      throw new Error(`test bug: no route registered for ${path}`)
    }
    if (route.throwError) {
      throw new Error('simulated network error')
    }
    return new Response(
      route.malformedJson ? 'not valid json {{{' : JSON.stringify(route.body ?? []),
      {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listSelectors — happy path', () => {
  it('returns ok with all three arrays when all 200', async () => {
    installFetchMock({
      '/tags': { body: [{ id: 't1', name: 'Quantum' }, { id: 't2', name: 'NLP' }] },
      '/projects': {
        body: [
          { id: 'p1', title: 'Thesis', status: 'wip' },
          { id: 'p2', title: 'Backlog', status: 'idea' },
        ],
      },
      '/collections': { body: [{ id: 'c1', name: 'Reading List' }] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.tags).toHaveLength(2)
    expect(r.tags[0]).toEqual({ id: 't1', name: 'Quantum' })
    expect(r.projects).toHaveLength(2)
    // The connector still sends `status` on the wire; the popup dropped the
    // status badge in the Figma redesign so it's parsed away as an extra field.
    expect(r.projects[0]).toEqual({ id: 'p1', title: 'Thesis' })
    expect(r.collections).toHaveLength(1)
  })

  it('returns empty arrays when server returns empty arrays', async () => {
    installFetchMock({
      '/tags': { body: [] },
      '/projects': { body: [] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.tags).toEqual([])
    expect(r.projects).toEqual([])
    expect(r.collections).toEqual([])
  })
})

describe('listSelectors — signed-out collapses to one reason', () => {
  it('returns signed-out when /tags is 503', async () => {
    installFetchMock({
      '/tags': { status: 503, body: { message: 'Milton is not signed in' } },
      '/projects': { body: [] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.reason).toBe('signed-out')
  })

  it('returns signed-out when /projects is 503', async () => {
    installFetchMock({
      '/tags': { body: [] },
      '/projects': { status: 503, body: { message: 'Milton is not signed in' } },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.reason).toBe('signed-out')
  })

  it('returns signed-out when all three are 503', async () => {
    installFetchMock({
      '/tags': { status: 503, body: { message: 'Milton is not signed in' } },
      '/projects': { status: 503, body: { message: 'Milton is not signed in' } },
      '/collections': { status: 503, body: { message: 'Milton is not signed in' } },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.reason).toBe('signed-out')
  })
})

describe('listSelectors — partial-failure', () => {
  it('reports null for projects on network-error, ok for tags + collections', async () => {
    installFetchMock({
      '/tags': { body: [{ id: 't1', name: 'A' }] },
      '/projects': { throwError: true },
      '/collections': { body: [{ id: 'c1', name: 'X' }] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.reason).toBe('partial-failure')
    if (r.reason !== 'partial-failure') throw new Error('expected partial-failure')
    expect(r.tags).toHaveLength(1)
    expect(r.projects).toBeNull()
    expect(r.collections).toHaveLength(1)
  })

  it('reports null for tags on 500, ok for projects + collections', async () => {
    installFetchMock({
      '/tags': { status: 500, body: { message: 'oops' } },
      '/projects': { body: [{ id: 'p1', title: 'T', status: 'wip' }] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'partial-failure') throw new Error('expected partial-failure')
    expect(r.tags).toBeNull()
    expect(r.projects).toHaveLength(1)
    expect(r.collections).toEqual([])
  })

  it('reports null for collections on malformed JSON', async () => {
    installFetchMock({
      '/tags': { body: [] },
      '/projects': { body: [] },
      '/collections': { malformedJson: true },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'partial-failure') throw new Error('expected partial-failure')
    expect(r.tags).toEqual([])
    expect(r.projects).toEqual([])
    expect(r.collections).toBeNull()
  })

  it('reports null for tags when response is not an array', async () => {
    installFetchMock({
      '/tags': { body: { not: 'an array' } },
      '/projects': { body: [] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'partial-failure') throw new Error('expected partial-failure')
    expect(r.tags).toBeNull()
  })
})

describe('listSelectors — malformed-entry tolerance', () => {
  it('drops a tag entry missing `name` but keeps the rest', async () => {
    installFetchMock({
      '/tags': {
        body: [
          { id: 't1', name: 'OK' },
          { id: 't2' }, // missing name → dropped
          { id: 't3', name: 'Also OK' },
        ],
      },
      '/projects': { body: [] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.tags).toHaveLength(2)
    expect(r.tags.map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('ignores the project `status` field entirely (no longer part of the wire shape)', async () => {
    // The status badge was cut in the Figma redesign (AC4 reconciled), so the
    // parser keeps only { id, title } — any `status` value, or its absence, is
    // tolerated as a forward-compat extra field rather than dropping the entry.
    installFetchMock({
      '/tags': { body: [] },
      '/projects': {
        body: [
          { id: 'p1', title: 'T1', status: 'wip' },
          { id: 'p2', title: 'T2', status: 'archived' }, // any value — ignored
          { id: 'p3', title: 'T3' }, // status absent — also fine
        ],
      },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.projects).toHaveLength(3)
    expect(r.projects.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect((r.projects[0] as unknown as Record<string, unknown>).status).toBeUndefined()
  })

  it('ignores extra unknown fields on the wire (forward-compat)', async () => {
    installFetchMock({
      '/tags': {
        body: [{ id: 't1', name: 'OK', extraFutureField: 'ignored', color: 'should-not-appear' }],
      },
      '/projects': { body: [] },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.tags[0]).toEqual({ id: 't1', name: 'OK' })
    // No `color` field leaks into the parsed result — memory rule defended in code.
    expect((r.tags[0] as unknown as Record<string, unknown>).color).toBeUndefined()
  })
})

// ── createReference: BE-7 pdfUrl payload ───────────────────────────────────

describe('createReference — pdfUrl payload (BE-7)', () => {
  // Capture the actual JSON body the extension sends so we can assert pdfUrl
  // round-trips through createReference unchanged.
  function captureBody(): {
    capture: { body: unknown }
    install: () => void
  } {
    const capture: { body: unknown } = { body: undefined }
    const install = () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const raw = (init?.body as string | undefined) ?? '{}'
        capture.body = JSON.parse(raw)
        return new Response(JSON.stringify({ id: 'ref-abc' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    }
    return { capture, install }
  }

  it('sends pdfUrl when the popup sets it (PDF page scenario)', async () => {
    const { capture, install } = captureBody()
    install()
    const payload: ConnectorReferencePayload = {
      title: 'Working Paper',
      authors: [],
      url: 'https://www.econstor.eu/.../623739976.pdf',
      pdfUrl: 'https://www.econstor.eu/.../623739976.pdf',
      tagIds: [],
      newTagNames: [],
      projectIds: [],
      collectionIds: [],
    }
    const r = await createReference(payload)
    expect(r.ok).toBe(true)
    const body = capture.body as Record<string, unknown>
    expect(body.pdfUrl).toBe('https://www.econstor.eu/.../623739976.pdf')
    expect(body.url).toBe('https://www.econstor.eu/.../623739976.pdf')
  })

  it('omits pdfUrl when popup did not set it (HTML article scenario)', async () => {
    const { capture, install } = captureBody()
    install()
    const payload: ConnectorReferencePayload = {
      title: 'Article',
      authors: [],
      url: 'https://www.nature.com/articles/s41586-021-03819-2',
      tagIds: [],
      newTagNames: [],
      projectIds: [],
      collectionIds: [],
    }
    await createReference(payload)
    const body = capture.body as Record<string, unknown>
    expect('pdfUrl' in body).toBe(false)
  })
})

describe('listSelectors — preserves server-side ordering', () => {
  it('does not re-sort projects (server returns updated_at DESC)', async () => {
    installFetchMock({
      '/tags': { body: [] },
      '/projects': {
        body: [
          { id: 'p-recent', title: 'Z Most Recent', status: 'wip' },
          { id: 'p-mid', title: 'M Middle', status: 'wip' },
          { id: 'p-old', title: 'A Oldest', status: 'idea' },
        ],
      },
      '/collections': { body: [] },
    })
    const r = await listSelectors()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.projects.map((p) => p.id)).toEqual(['p-recent', 'p-mid', 'p-old'])
  })
})

// ── BE-8-7: attachPdfBytes ─────────────────────────────────────────────────
//
// Single fetch-based implementation. (The original spec included an XHR
// branch for upload progress, but Pierre's Task 6 scope cut dropped the
// progress UI; H3 from BE-8-7 code-review removed the dead XHR branch.)

function pdfBuffer(byteCount: number): ArrayBuffer {
  const u8 = new Uint8Array(byteCount)
  u8[0] = 0x25
  u8[1] = 0x50
  u8[2] = 0x44
  u8[3] = 0x46
  u8[4] = 0x2d
  return u8.buffer
}

function attachRoute(status: number, body?: unknown): Route {
  return { status, body: body ?? {} }
}

describe('attachPdfBytes', () => {
  it('returns ok+attached on 200 {status:"attached"}', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(200, { status: 'attached', referenceId: 'abc-123' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toEqual({ ok: true, status: 'attached', referenceId: 'abc-123' })
  })

  it('returns ok+already_attached on 200 {status:"already_attached"}', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(200, {
        status: 'already_attached',
        referenceId: 'abc-123',
      }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toEqual({ ok: true, status: 'already_attached', referenceId: 'abc-123' })
  })

  it('returns 400 with message on bad request', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(400, {
        message: 'body is not a PDF (missing %PDF- magic)',
      }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 400 })
    if (r.ok || typeof r.status !== 'number') throw new Error('expected typed error')
    expect(r.message).toMatch(/PDF/)
  })

  it('returns 403 on reference-not-owned', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(403, { message: 'reference not owned by active user' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('returns 404 on reference-not-found', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(404, { message: 'reference not found' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 408 on server-side timeout (distinct from local timeout)', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(408, { message: 'request timeout' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 408 })
  })

  it('returns 413 on server-side oversize', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(413, { message: 'payload too large' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 413 })
  })

  it('returns 503 on signed-out', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': attachRoute(503, { message: 'Milton is not signed in' }),
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 503 })
  })

  it('returns network-error when fetch rejects', async () => {
    installFetchMock({
      '/references/abc-123/pdf-bytes': { throwError: true },
    })
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(r).toMatchObject({ ok: false, status: 'network-error' })
  })

  it('returns 413 client-side WITHOUT issuing POST when bytes exceed cap', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const oversize = MAX_PDF_BYTES + 1
    const r = await attachPdfBytes('abc-123', pdfBuffer(oversize))
    expect(r).toMatchObject({ ok: false, status: 413 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 400 client-side WITHOUT issuing POST when bytes is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const r = await attachPdfBytes('abc-123', new ArrayBuffer(0))
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Content-Type is application/pdf (verifies AC2)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'attached', referenceId: 'abc-123' }), { status: 200 }),
    )
    await attachPdfBytes('abc-123', pdfBuffer(2048))
    expect(fetchSpy).toHaveBeenCalledOnce()
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/pdf')
    expect(init.method).toBe('POST')
  })

  it('returns timeout when internal AbortController fires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          ;(init?.signal as AbortSignal).addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048), { timeoutMs: 5 })
    expect(r).toMatchObject({ ok: false, status: 'timeout' })
  })

  it('encodeURIComponent is applied to the reference id (single-encoded)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'attached', referenceId: 'a/b' }), { status: 200 }),
    )
    await attachPdfBytes('a/b', pdfBuffer(1024))
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('/references/a%2Fb/pdf-bytes')
    // NOT double-encoded:
    expect(url).not.toContain('%252F')
  })

  it('returns network-error (not timeout) when external signal aborts mid-flight', async () => {
    // M6 from BE-8-7 code-review: caller-cancel and local-timeout must surface
    // with different `status` values — 'network-error' for cancel, 'timeout'
    // for the internal setTimeout trip. Same Promise reject path, two
    // statuses, so the popup can render the right copy.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          ;(init?.signal as AbortSignal).addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )
    const externalCtrl = new AbortController()
    const promise = attachPdfBytes('abc-123', pdfBuffer(2048), {
      timeoutMs: 60_000, // long enough to NOT fire — we want the external abort to win
      signal: externalCtrl.signal,
    })
    // Wait a microtask so the fetch is in-flight + listening on the signal.
    await Promise.resolve()
    externalCtrl.abort()
    const r = await promise
    expect(r).toMatchObject({ ok: false, status: 'network-error', message: 'aborted' })
  })

  it('returns network-error when external signal was already aborted on entry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          ;(init?.signal as AbortSignal).addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
          // If the signal is already aborted, the listener fires synchronously
          // on add, but to be safe also check here:
          if ((init?.signal as AbortSignal).aborted) {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          }
        }),
    )
    const externalCtrl = new AbortController()
    externalCtrl.abort()
    const r = await attachPdfBytes('abc-123', pdfBuffer(2048), {
      signal: externalCtrl.signal,
    })
    expect(r).toMatchObject({ ok: false, status: 'network-error', message: 'aborted' })
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
