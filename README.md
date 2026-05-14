# Milton Browser Extension

**Status:** BE-1 scaffold shipped 2026-05-14. Auth flow superseded by BE-4 (see "Known limitations" below). BE-2 + BE-3 backlog.

## What this does

Chromium MV3 extension that captures academic-page metadata and creates references in Milton:

1. User clicks the toolbar button on any page
2. Extension POSTs the URL to `translate.milton.so/web` (self-hosted Zotero translation-server)
3. Receives Zotero-flavored CSL-JSON metadata
4. Popup shows preview (BE-1: minimal header + URL) + optional tag / project / collection selectors (BE-2)
5. User clicks Save → POST extended payload to `127.0.0.1:7521/references`
6. Milton creates the reference atomically + shows a toast

## Prerequisites — ALL MET

- Translation server validated + deployed at `translate.milton.so` (TS-2 / TS-3 / TS-5)
- Milton local connector at `127.0.0.1:7521` (Story 17-5)
- Connector extended payload (tags / projects / collections atomic transaction) + `GET /tags` + `GET /projects` + `GET /collections` (Story 18-1)

## Known limitations

**BE-1's auth flow is non-functional against the current production server.** Between BE-1 scoping (2026-05-04) and ship (2026-05-14), TS-6 deployed an auth-proxy in front of the translation-server that requires per-user EdDSA JWTs (`Authorization: Bearer …`) and rejects the legacy shared `X-Milton-Key` header. BE-1 ships the structural scaffold — popup state machine, CSL→ConnectorReferencePayload mapping, connector client, forward-compat envelope — but end-to-end smoke against `translate.milton.so` will return 401 until **BE-4** migrates the extension to fetch a per-save JWT from Milton's local connector `POST /auth/issue-token` (Story 18-15, shipped).

The 5-scenario smoke table below is BE-4's gate, not BE-1's.

## Sideload (developer mode)

Step-by-step to install the extension in Chrome / Edge / Brave:

1. **Install dependencies**
   ```bash
   cd tools/browser-extension
   pnpm install --ignore-workspace
   ```
   The `--ignore-workspace` flag keeps this self-contained — without it, pnpm 10 falls through to Milton's parent workspace. (The `.npmrc:ignore-workspace=true` setting in this directory is silently ignored by pnpm 10.28.2; only the CLI flag is honored. Tracked as tech-debt.)

2. **Set the env vars** — `cp .env.local.example .env.local`, then edit. Production defaults are baked in; you only need to paste a valid `VITE_MILTON_KEY` (currently shared, BE-4 will replace this).

3. **Build the extension**
   ```bash
   pnpm build
   ```
   Outputs to `dist/`. Rebuild after any source change OR any `.env.local` change.

4. **Sideload into Chromium**
   - Open `chrome://extensions/` (or `edge://extensions/` / `brave://extensions/`)
   - Toggle **Developer mode** ON (top-right)
   - Click **Load unpacked**
   - Select the `dist/` folder
   - The Milton toolbar icon appears

5. **Use it** (functional only after BE-4 ships)
   - Open any academic page (arXiv, PubMed, journal, etc.)
   - Click the Milton toolbar icon
   - Click **Save** in the popup
   - The reference appears in Milton with a "Reference added from browser" toast

## Smoke test (BE-4 gate)

| URL | Expected outcome |
|---|---|
| `https://arxiv.org/abs/2303.08774` | Saves reference; Milton toast |
| Recent PubMed article URL | Saves reference; Milton toast |
| Nature / Springer article URL with DOI | Saves reference; Milton toast |
| Same arXiv URL again | "Already in your library" 409 message |
| Sign out of Milton, then click Save | "Sign in to Milton" view + Open Milton deep-link works |

## Charter + sprint

- Charter: [`_bmad-output/planning-artifacts/charter.md`](_bmad-output/planning-artifacts/charter.md)
- Sprint status: [`_bmad-output/implementation-artifacts/sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml)
- BE-1 story: [`_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md`](_bmad-output/implementation-artifacts/BE-1-scaffold-connector-client-sideload.md)

## Tech stack

- Vite ^7.3 + `@crxjs/vite-plugin` ^2.4 + TypeScript ^5.9 (Manifest V3)
- Vitest ^4.1 for unit tests (csl-to-payload mapping coverage)
- Chromium-only for v1 (Chrome / Edge / Brave); Firefox is a separate sprint
- Distribution: sideload `dist/` (Load unpacked) for v1; Chrome Web Store packaging is a follow-up

## Scripts

```bash
pnpm install --ignore-workspace   # install deps (workspace flag required on pnpm 10+)
pnpm dev                          # Vite dev server with HMR (popup hot-reloads)
pnpm build                        # Production build → dist/
pnpm typecheck                    # tsc --noEmit
pnpm test                         # vitest run
```

## Story map

| ID | Title | Status |
|---|---|---|
| BE-1 | Scaffold + connector client + signed-out detection + sideload package | shipped (auth flow superseded by BE-4) |
| BE-4 | Auth migration — connector token + JWT to translation-server | ready-for-dev |
| BE-2 | Rich popup UX (metadata preview + tag / project / collection selectors) | backlog |
| BE-3 | Page-detection content script | backlog (deferred) |
