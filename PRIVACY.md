# Privacy Policy — Milton browser extension

_Last updated: 2026-05-19 (v0.2.0)_

This is the privacy policy for the **Milton browser extension** (Chromium MV3), published by Demandrel on the Chrome Web Store and at <https://github.com/Demandrel/milton-browser-extension>.

The short version: **the extension does not collect, store, or transmit anything about you except the references you explicitly choose to capture, and those go to your own copy of Milton running on your computer.** There is no Milton-side server that sees your browsing.

---

## What data does the extension handle?

The extension handles the following data, and only the following data:

- **Pages you explicitly capture.** When you click the Milton toolbar button on a publisher article page or PDF, the extension reads the page's rendered HTML (or fetches the PDF bytes) inside your browser's tab context. This data is sent to **your own copy of Milton running on `127.0.0.1:7521`** (a localhost address; the data never leaves your machine for this step). Milton stores the reference in its own local library.
- **Translator code and metadata.** To know how to extract a reference from a given publisher (e.g., arXiv vs ScienceDirect), the extension uses a curated bundle of "translator" scripts that ship with the extension itself, plus periodic updates fetched from the Milton translator-mirror CDN at `https://translators.milton.so/repo/`. The extension downloads (a) a signed manifest of available translator scripts and (b) the script bytes themselves. The mirror logs only the request (URL, IP, user-agent) at the CDN-edge level — same as any HTTPS GET. No identifying data is sent in these requests.
- **Authentication tokens.** When you save a reference, Milton (your local copy) mints a short-lived signed token and the extension presents it to `https://translate.milton.so` (a server-side fallback that runs when client-side capture fails). The token does not contain personal data; it's a device-scoped JWT signed by your Milton install.

**The extension does NOT:**

- collect your browsing history (it only sees a page when you click the toolbar button on it),
- send analytics or telemetry events to any server,
- read or transmit any of your cookies (the extension uses your existing browser session inside the tab context, but never reads, exports, or forwards the cookie values),
- contain advertising trackers, fingerprinters, or third-party SDKs,
- run any code outside of the declared sandbox page (translator JS, verified Ed25519 + SHA-256, runs only in the sandbox).

---

## Which third-party services does the extension contact?

The extension contacts the following hosts (declared in `host_permissions` in the extension's manifest; visible in the Chrome Web Store listing):

| Host | Purpose | When |
|---|---|---|
| `127.0.0.1:7521` (your own machine) | Your local Milton-desktop connector — receives reference data on save | On capture |
| `https://translators.milton.so/*` | Milton's translator-mirror CDN — bundled translators are pinned at build, occasional updates fetched from here | On install + every ~6h |
| `https://translate.milton.so/*` | Milton's server-side translation fallback — only invoked when client-side translator returns no items | Rare fallback |
| `https://arxiv.org/*` + `https://export.arxiv.org/*` | arXiv abstract pages — fetched by the arXiv translator when capturing an arXiv reference | On capture of arXiv URLs |

You can review the extension's exact network surface in the source code: <https://github.com/Demandrel/milton-browser-extension>.

---

## Which Chrome permissions does the extension request, and why?

For each permission declared by the extension, here is what it's used for. The extension's `manifest.json` declares the permissions; this list mirrors the per-permission justifications in `store-assets/cws/permissions.md` (kept in sync as part of every release).

- **`activeTab`** — grants the extension per-invocation access to the active tab when you click the Milton toolbar button. Combined with `scripting` below, this is how the extension reads the current page without needing broad host_permissions on every website.
- **`alarms`** — schedules a 6-hour periodic check for translator updates, so bundled translators stay current with upstream publisher changes.
- **`storage`** — caches the translator-mirror manifest + lazy-fetched translator scripts in your browser's local extension storage. Capped at ~50 entries with a 7-day TTL. No personal data is stored here.
- **`scripting`** — runs the extension's own code in the active tab's context (only when you've clicked the toolbar button) to read the rendered HTML for capture.
- **`offscreen`** — creates a hidden, headless document inside the extension to host the translator runtime sandbox. The sandbox runs translator code and posts the result back to the popup. Required because the translator framework needs evaluation primitives that are only allowed inside a sandbox page.
- **`host_permissions`** for `translate.milton.so`, `translators.milton.so`, `arxiv.org`, `export.arxiv.org` — see the third-party services table above.

---

## Open source

Milton's browser extension is **open source** under the **GNU Affero General Public License v3** (AGPL-3.0-or-later). The full license text is at <https://github.com/Demandrel/milton-browser-extension/blob/main/COPYING>.

**What AGPL means for you, in plain English:** you can read, modify, redistribute, and self-host the source code. If you publish a modified version (for example, hosting it on a network or shipping a fork), you must share your modifications under the same license. For most users — people who install the extension to capture references for themselves — this is no different from a typical open-source project: you can use it, look under the hood, and trust that the code you're running matches what's published.

The full source code at <https://github.com/Demandrel/milton-browser-extension> is what gets built and shipped to the Chrome Web Store. No additional code or scripts are injected at packaging time.

---

## Changes to this policy

This policy may be updated when the extension's behavior changes (for example, if a new permission is added, or a new third-party service is contacted). The change is recorded in the Git history of this file at <https://github.com/Demandrel/milton-browser-extension/blob/main/PRIVACY.md>.

For the Chrome Web Store listing, every meaningful policy change is paired with an extension version bump so reviewers + users can correlate "what's new" against the policy diff.

---

## Contact

If you have a question, concern, or want to report a privacy issue:

- **Preferred:** open an issue at <https://github.com/Demandrel/milton-browser-extension/issues> — visible to other users, fastest response, fits the open-source workflow.
- **Email:** <support@milton.so> — for questions you'd rather not raise in a public issue.

We aim to respond within a reasonable time but make no enterprise-grade SLA commitments at this stage.
