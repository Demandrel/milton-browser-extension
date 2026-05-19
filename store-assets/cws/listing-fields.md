# Chrome Web Store — Listing Form Field Index

_Per BE-8-10 AC4. This document maps each Chrome Web Store submission form field to the source asset in this repo. Use it during AC8 / Task 8.3 to fill the form deterministically; reviewer cycles update individual fields without losing track of the canonical source._

---

## Item Information

| CWS Form Field | Source | Notes |
|---|---|---|
| **Title** | (inline) | `Milton — academic reference capture` (≤45 chars) |
| **Summary** (short description, ≤132 chars) | `store-assets/cws/description-short.txt` | Pasted verbatim |
| **Description** (long, ≤16,384 chars) | `store-assets/cws/description-long.md` | Pasted verbatim. CWS supports basic line breaks but no markdown rendering — review formatting in the preview before submission. |
| **Category** | (inline) | **Productivity** |
| **Language** | (inline) | English |

---

## Graphic Assets

| CWS Form Field | Source | Notes |
|---|---|---|
| **Store icon (128×128)** | `src/assets/icons/128.png` | Reuses the existing extension icon (sideload path). No new asset required. |
| **Small promo tile (440×280)** | `store-assets/cws/promo-tile.png` | **Pierre-execution** — design + drop in. Required for CWS featuring eligibility; recommended even if not applying for featuring (shows in search-result previews). Milton wordmark + tagline; simple is fine. |
| **Marquee promo tile (1400×560)** | `store-assets/cws/marquee.png` | **OPTIONAL** — only required if applying for the CWS featured collection. Skip in v0.2.0 if running short; can be added in a v0.3 listing update without re-review. |
| **Screenshots (3-5, each 1280×800 or 640×400)** | `store-assets/cws/screenshots/*.png` | **Pierre-execution** — captured from a fresh Chromium profile with Milton sideloaded + Milton-desktop running. Order matters; CWS displays them in filename order. Suggested order: (1) popup with metadata preview on arXiv, (2) tags + projects + collections selectors, (3) signed-out state, (4) translator-fallback on a Cloudflare-protected site. |

---

## Privacy & Compliance

| CWS Form Field | Source | Notes |
|---|---|---|
| **Privacy policy URL** | `https://demandrel.github.io/milton-browser-extension/PRIVACY` | Backed by `PRIVACY.md` at repo root + GitHub Pages enabled on the repo. Verified responsive via curl + browser before submission (BE-8-10 Task 3.3). |
| **Single purpose statement** | First section of `permissions.md` | "Milton captures academic references (article metadata + optional PDF) from publisher pages..." Pasted verbatim. |
| **Per-permission justifications** | `store-assets/cws/permissions.md` — "Per-permission justification" section | One paragraph per permission. Paste each into the corresponding CWS form field exactly. CWS lists: `activeTab`, `alarms`, `storage`, `scripting`, `offscreen`. |
| **Host permission justifications** | `store-assets/cws/permissions.md` — "Host permission justification" section | One paragraph per `host_permissions` entry. CWS lists: `translate.milton.so/*`, `translators.milton.so/*`, `arxiv.org/*`, `export.arxiv.org/*`. |
| **Remote code disclosure** | `store-assets/cws/permissions.md` — "Use of remote code disclosure" section | Pasted into the CWS Privacy Practices form's "Are you using remote code?" follow-up. Cites Zotero Connector precedent + the Ed25519 + SHA-256 verification chain. |

---

## Distribution

| CWS Form Field | Source | Notes |
|---|---|---|
| **Visibility** | (inline) | **Public** — per Pierre's pre-draft batch decision 2026-05-19. Public from day 1; bot-protected-publisher caveat handled honestly in the long description. |
| **Pricing** | (inline) | Free |
| **Regions** | (inline) | All regions |
| **In-app purchases** | (inline) | No (v0.2.0 has no Pro-tier surface; epic-21 territory) |

---

## Support

| CWS Form Field | Source | Notes |
|---|---|---|
| **Support URL** | `https://github.com/Demandrel/milton-browser-extension/issues` | GitHub Issues — primary support channel for OSS extension. |
| **Homepage URL** | `https://github.com/Demandrel/milton-browser-extension` | The public AGPL repo. |

---

## Upload artifact

| CWS Form Field | Source | Notes |
|---|---|---|
| **Package (.zip)** | `milton-extension-v0.2.0.zip` | Produced by Task 7.2 (`cd dist && zip -r ../milton-extension-v0.2.0.zip .`). NOT committed (gitignored per Task 7.2). Reproducible from `pnpm build` on any checkout. |
| **Manifest version** | (verified) | `0.2.0` — produced by `package.json` version field + CRXJS rewrite at build time. Verify before upload: `jq -r .version dist/manifest.json` |

---

## Submission preview snapshot

| Field | Source |
|---|---|
| **Pre-submit screenshot** | `store-assets/cws/submission-preview-screenshot.png` | Captured BEFORE clicking Submit per Task 8.5. Posterity if the form gets reset OR for diff against future v0.3 updates. |

---

## Post-submit captures

After clicking Submit (Task 8.6), record into Completion Notes of the BE-8-10 story file:

- Submission timestamp (UTC, ISO 8601)
- Reviewer-assigned listing ID (the URL slug in the CWS dashboard)
- Listing status at submit (e.g., "Pending review")
