import { createReference, health } from '../lib/connector-client'
import { mapMetadataToPayload } from '../lib/metadata-to-payload'
import { extractMetadata } from '../lib/translation-client'
import type {
  ConnectorReferencePayload,
  CreateReferenceResult,
  TokenFetchResult,
  TranslateError,
} from '../lib/types'

type TokenFailure = Exclude<TokenFetchResult, { ok: true; token: string }>

type State =
  | { kind: 'loading-tab' }
  | { kind: 'loading-health' }
  | { kind: 'cannot-capture'; reason: 'restricted-url' | 'no-url' }
  | { kind: 'milton-not-running' }
  | { kind: 'ready-to-save'; url: string }
  | { kind: 'extracting' }
  | { kind: 'posting'; payload: ConnectorReferencePayload }
  | { kind: 'success'; id: string }
  | { kind: 'signed-out' }
  | { kind: 'error-no-metadata' }
  | { kind: 'error-too-large' }
  | { kind: 'error-409-duplicate'; existingId: string }
  | { kind: 'error-400-validation'; message: string; detail?: string }
  | { kind: 'error-network'; message: string }
  // BE-4 — auth-flow + tier/quota errors from translate.milton.so.
  | { kind: 'error-auth-failed'; detail: string }
  | { kind: 'error-rate-limited'; retryAfterSeconds: number }
  | { kind: 'error-quota-exceeded'; nextResetSeconds: number; upgradeUrl: string }
  | { kind: 'error-tier-required'; requiredTiers: string[]; upgradeUrl: string }
  | { kind: 'error-service-unavailable'; retryAfterSeconds?: number }

const root = document.getElementById('root') as HTMLDivElement
let state: State = { kind: 'loading-tab' }
let currentUrl: string | undefined

void boot()

async function boot() {
  // AC2 — read current tab URL.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tabs[0]?.url
  if (!url || url === 'about:blank') {
    setState({ kind: 'cannot-capture', reason: 'no-url' })
    return
  }
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://')
  ) {
    setState({ kind: 'cannot-capture', reason: 'restricted-url' })
    return
  }
  currentUrl = url

  // AC3 — health probe gates the Save UI.
  setState({ kind: 'loading-health' })
  const h = await health()
  if (!h.ok) {
    setState({ kind: 'milton-not-running' })
    return
  }
  setState({ kind: 'ready-to-save', url })
}

function setState(next: State): void {
  state = next
  render()
}

function render(): void {
  root.innerHTML = ''
  switch (state.kind) {
    case 'loading-tab':
    case 'loading-health':
      root.innerHTML = `<p class="milton-popup-loading">Checking Milton…</p>`
      break

    case 'cannot-capture':
      root.innerHTML = `
        <p class="milton-popup-header">Save to Milton</p>
        <button class="milton-popup-button" disabled>Save</button>
        <p class="milton-popup-helper">${
          state.reason === 'restricted-url'
            ? "This page can't be captured (restricted URL)."
            : 'No URL to save.'
        }</p>
      `
      break

    case 'milton-not-running':
      root.innerHTML = `
        <p class="milton-popup-header">Milton isn't running</p>
        <p class="milton-popup-helper">Open the desktop app to receive references from your browser.</p>
        <button class="milton-popup-button" id="open-milton">Open Milton</button>
        <p class="milton-popup-footnote">Don't have Milton? <a href="https://milton.so" target="_blank">Get it here</a>.</p>
      `
      bind('open-milton', openMilton)
      break

    case 'ready-to-save':
      root.innerHTML = `
        <p class="milton-popup-header">Save to Milton</p>
        <p class="milton-popup-url">${escapeHtml(state.url)}</p>
        <button class="milton-popup-button" id="save-btn">Save</button>
      `
      bind('save-btn', () => save())
      break

    case 'extracting':
      root.innerHTML = `<p class="milton-popup-loading">Extracting metadata…</p>`
      break

    case 'posting':
      root.innerHTML = `<p class="milton-popup-loading">Saving to Milton…</p>`
      break

    case 'success':
      root.innerHTML = `<p class="milton-popup-success">Saved to Milton ✓</p>`
      window.setTimeout(() => window.close(), 1500)
      break

    case 'signed-out':
      root.innerHTML = `
        <p class="milton-popup-header">Sign in to Milton</p>
        <p class="milton-popup-helper">Milton needs you to sign in before it can save references.</p>
        <button class="milton-popup-button" id="open-milton">Open Milton</button>
      `
      bind('open-milton', openMilton)
      break

    case 'error-no-metadata':
      root.innerHTML = `
        <p class="milton-popup-header">Couldn't extract metadata</p>
        <p class="milton-popup-error">No reference data could be extracted from this page.</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-too-large':
      root.innerHTML = `
        <p class="milton-popup-header">Page metadata too large</p>
        <p class="milton-popup-error">The metadata for this page is over 64 KB and can't be captured.</p>
      `
      break

    case 'error-409-duplicate':
      root.innerHTML = `
        <p class="milton-popup-header">Already in your library</p>
        <p class="milton-popup-helper">This reference is already saved in Milton.</p>
        <p class="milton-popup-error-detail">id: ${escapeHtml(state.existingId)}</p>
      `
      break

    case 'error-400-validation':
      root.innerHTML = `
        <p class="milton-popup-header">Couldn't save</p>
        <p class="milton-popup-error">${escapeHtml(state.message)}${
          state.detail
            ? `<span class="milton-popup-error-detail">${escapeHtml(state.detail)}</span>`
            : ''
        }</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-network':
      root.innerHTML = `
        <p class="milton-popup-header">Connection error</p>
        <p class="milton-popup-error">${escapeHtml(state.message)}</p>
        <button class="milton-popup-button" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-auth-failed':
      root.innerHTML = `
        <p class="milton-popup-header">Authentication failed</p>
        <p class="milton-popup-error">${escapeHtml(state.detail)}</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-rate-limited':
      root.innerHTML = `
        <p class="milton-popup-header">Too many requests</p>
        <p class="milton-popup-error">Try again in ${humanizeSeconds(state.retryAfterSeconds)}.</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break

    case 'error-quota-exceeded':
      root.innerHTML = `
        <p class="milton-popup-header">Free quota reached</p>
        <p class="milton-popup-error">Next slot in ${humanizeSeconds(state.nextResetSeconds)}, or upgrade for unlimited.</p>
        <a class="milton-popup-button" href="${escapeAttr(state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade Milton</a>
      `
      break

    case 'error-tier-required': {
      const tier = state.requiredTiers[0] ?? 'paid'
      root.innerHTML = `
        <p class="milton-popup-header">Paid plan required</p>
        <p class="milton-popup-error">This feature requires the ${escapeHtml(tier)} plan or higher.</p>
        <a class="milton-popup-button" href="${escapeAttr(state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade Milton</a>
      `
      break
    }

    case 'error-service-unavailable':
      root.innerHTML = `
        <p class="milton-popup-header">Translation service unavailable</p>
        <p class="milton-popup-error">${
          state.retryAfterSeconds
            ? `Try again in ${humanizeSeconds(state.retryAfterSeconds)}.`
            : 'Try again in a moment.'
        }</p>
        <button class="milton-popup-button milton-popup-button-secondary" id="retry">Try again</button>
      `
      bind('retry', retry)
      break
  }
}

async function save(): Promise<void> {
  if (!currentUrl) return

  // AC3+AC5 — fetch translation metadata (auth-client mints a fresh JWT internally).
  setState({ kind: 'extracting' })
  const result = await extractMetadata(currentUrl)

  if (!result.ok) {
    if (result.via === 'token-mint') {
      dispatchTokenMintError(result.error)
    } else {
      dispatchTranslateServerError(result.error)
    }
    return
  }

  const payload = mapMetadataToPayload(result.primary, currentUrl)
  if (!payload.title) {
    setState({ kind: 'error-no-metadata' })
    return
  }

  // AC6 — POST to connector + result-aware states.
  setState({ kind: 'posting', payload })
  const postResult = await createReference(payload)
  dispatchCreateReferenceResult(postResult)
}

function dispatchTokenMintError(err: TokenFailure): void {
  switch (err.reason) {
    case 'signed-out':
      setState({ kind: 'signed-out' })
      break
    case 'origin-rejected':
      setState({
        kind: 'error-auth-failed',
        detail: 'This extension is not authorized by your Milton install.',
      })
      break
    case 'rate-limited':
      setState({ kind: 'error-rate-limited', retryAfterSeconds: err.retryAfterSeconds })
      break
    case 'network-error':
      // Connector became unreachable between health probe and token mint.
      setState({ kind: 'milton-not-running' })
      break
    case 'unexpected':
      setState({ kind: 'error-network', message: err.message })
      break
  }
}

function dispatchTranslateServerError(err: TranslateError): void {
  switch (err.kind) {
    case 'no-metadata':
      setState({ kind: 'error-no-metadata' })
      break
    case 'token-expired':
    case 'token-invalid':
    case 'wrong-audience':
    case 'device-owner-mismatch':
      setState({ kind: 'error-auth-failed', detail: 'Authentication failed, try again.' })
      break
    case 'device-not-registered':
      setState({
        kind: 'error-auth-failed',
        detail: 'Sign out and back in to Milton to re-register this device.',
      })
      break
    case 'tier-required':
      setState({
        kind: 'error-tier-required',
        requiredTiers: err.requiredTiers,
        upgradeUrl: err.upgradeUrl,
      })
      break
    case 'tier-revoked':
      setState({
        kind: 'error-tier-required',
        requiredTiers: [err.dbTier || 'paid'],
        upgradeUrl: err.upgradeUrl,
      })
      break
    case 'quota-exceeded':
      setState({
        kind: 'error-quota-exceeded',
        nextResetSeconds: err.nextResetSeconds,
        upgradeUrl: 'https://milton.so/upgrade',
      })
      break
    case 'rate-limited':
      setState({ kind: 'error-rate-limited', retryAfterSeconds: err.retryAfterSeconds })
      break
    case 'key-lookup-unavailable':
    case 'service-unavailable':
      setState({
        kind: 'error-service-unavailable',
        retryAfterSeconds: err.retryAfterSeconds,
      })
      break
    case 'payload-too-large':
      setState({ kind: 'error-too-large' })
      break
    case 'bad-gateway':
    case 'method-not-allowed':
    case 'not-found':
      setState({ kind: 'error-network', message: 'Translation service returned an unexpected response.' })
      break
    case 'unexpected':
      setState({ kind: 'error-network', message: err.message })
      break
    case 'network-error':
      setState({ kind: 'error-network', message: err.message })
      break
  }
}

function dispatchCreateReferenceResult(result: CreateReferenceResult): void {
  if (result.ok) {
    setState({ kind: 'success', id: result.id })
    return
  }
  switch (result.status) {
    case 503:
      setState({ kind: 'signed-out' })
      break
    case 409:
      setState({ kind: 'error-409-duplicate', existingId: result.id })
      break
    case 400:
      setState({
        kind: 'error-400-validation',
        message: result.message,
        detail: result.detail,
      })
      break
    case 'payload-too-large':
      setState({ kind: 'error-too-large' })
      break
    case 403:
    case 'network-error':
    default:
      setState({ kind: 'error-network', message: result.message })
      break
  }
}

function retry(): void {
  if (currentUrl) {
    setState({ kind: 'ready-to-save', url: currentUrl })
  } else {
    setState({ kind: 'loading-tab' })
    void boot()
  }
}

function openMilton(): void {
  void chrome.tabs.create({ url: 'milton://' })
  window.close()
}

function bind(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', handler)
}

function humanizeSeconds(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return 'a moment'
  if (secs < 60) return `${Math.round(secs)} seconds`
  if (secs < 3600) return `${Math.round(secs / 60)} minutes`
  if (secs < 86400) return `${Math.round(secs / 3600)} hours`
  return `${Math.round(secs / 86400)} days`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}

// Force initial render so the DOM matches `state` from the very first frame.
render()
