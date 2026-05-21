# Chrome Web Store — Permission Justifications

_For the Milton browser extension v0.2.0 listing under Demandrel ownership. The text below is intended to be pasted verbatim into the CWS "Privacy practices" form during submission (BE-8-10 Task 8.4). Kept in sync with the in-repo `PRIVACY.md` user-facing policy + the actual `manifest.config.ts` declarations._

---

## Single-purpose statement

Milton captures academic references (article metadata + optional PDF) from publisher pages in the user's tab and sends them to Milton's local desktop app at `127.0.0.1:7521`. The extension's single purpose is reference capture for personal research libraries.

---

## Per-permission justification

For each permission declared in `manifest.config.ts:27-48`:

### `activeTab`

Required so the extension can read the rendered page (HTML or PDF) only on the tab the user has explicitly clicked the Milton toolbar button on. Pairs with `scripting` (below) to give per-invocation, per-tab access without broad host_permissions across every website. Without this permission the extension would either need `<all_urls>` host permission (excessive) or could not capture anything (broken).

### `alarms`

Required for the periodic translator-update check. The extension's service worker uses `chrome.alarms.create` to schedule a 6-hour tick (`periodInMinutes: 360`, well clear of MV3 minimums) that polls the Milton translator-mirror CDN for updated translator scripts. Without this permission, bundled translators would stay frozen at the version that shipped with the extension — meaning when a publisher changes their HTML, capture would silently break until the next extension release. The 6-hour cadence closes that staleness gap.

### `storage`

Required for the translator cache. The extension uses `chrome.storage.local` to cache (a) the translator-mirror manifest (~1 hour TTL, re-verified on every read against the embedded Ed25519 public key), (b) lazy-fetched translator scripts for publishers not in the curated bundle (LRU-capped at 50 entries, 7-day TTL), and (c) the timestamp of the last successful refresh check. No personal data, no analytics, no browsing history. Without this permission the extension would re-download translators on every capture (latency + bandwidth penalty) or fail entirely when offline.

### `scripting`

Required for client-side capture (Class 3 in our coverage model). The extension uses `chrome.scripting.executeScript({target: {tabId}, ...})` to run its capture logic in the active tab's context — only when the user has clicked the Milton toolbar button. The injected code reads `document.documentElement.outerHTML` (or fetches the PDF for PDF pages) so the translator framework can extract metadata from the rendered DOM. The capture uses the user's existing tab session (cookies, authentication), which is why Milton works on cookie- and challenge-walled publishers that the user has already authenticated to.

### `offscreen`

Required for the translator runtime. MV3 service workers can't host arbitrary script evaluation (the translator framework uses `new Function()` / sandboxed `eval` to execute translator JS), and the extension popup window dies when the user clicks outside it. The `chrome.offscreen` API creates a hidden, headless document inside the extension that hosts the translator runtime in a sandbox iframe; the sandbox executes translator code (in a CSP-restricted context, per the `sandbox.pages` manifest declaration) and posts the structured result back to the popup. One offscreen document per extension, instantiated lazily on first capture.

---

## Host permission justification

For each `host_permissions` entry declared in `manifest.config.ts:55-66`:

### `https://translate.milton.so/*`

Milton's server-side translation gateway. Used only as a fallback when client-side capture (Class 3) returns zero items or errors out — for example, when the extension can't match a publisher's URL to any known translator. In that case the extension forwards the URL to `translate.milton.so` which runs server-side translation and returns CSL-JSON. No personal data is sent (only the URL the user explicitly asked to capture); a short-lived signed JWT minted by the user's own Milton-desktop install is presented for authentication.

### `https://translators.milton.so/*`

Milton's translator-mirror CDN. Hosts (a) `metadata` — a signed manifest of all available translator scripts; (b) `metadata.sig` — the Ed25519 signature of the manifest; (c) `code/{uuid}` — the JS bytes for each individual translator. The extension fetches these at install time and on the 6-hour `alarms` tick (see `alarms` above). All bytes are verified against the embedded Ed25519 public key (manifest signature) + per-translator SHA-256 hash (each translator's bytes) before any execution.

### `https://arxiv.org/*` and `https://export.arxiv.org/*`

The arXiv translator (one of the bundled translators) fetches arXiv abstract pages during capture. The pattern `https://arxiv.org/abs/<id>` returns the abstract HTML which the translator parses for title, authors, abstract, and arXiv-ID metadata. `export.arxiv.org` is arXiv's mirror used by translators for OAI-PMH-style queries. These hosts are explicitly listed so the translator's fetch (made from inside the sandbox iframe via the offscreen broker) is permitted by Chrome's same-origin policy.

---

## Use of remote code disclosure (CWS-policy-mandated)

The Chrome Web Store Developer Program Policies on [Use of Remote Code](https://developer.chrome.com/docs/webstore/program-policies/use-of-remote-code/) require explicit disclosure when an extension fetches and executes JavaScript at runtime. Milton does this for translator code — here's how, and why it's safe:

### What we fetch

The extension fetches translator JavaScript files (one per supported publisher) from `https://translators.milton.so/repo/code/{uuid}`. These translators are derived from the public, open-source `zotero/translators` repository (the same translator corpus used by Zotero's own Chrome extension, **Zotero Connector** — see <https://chromewebstore.google.com/detail/zotero-connector/ekhagklcjbdpajgpjgmbionohlpdbjgc> — which has been published on CWS for years under the identical fetch-and-evaluate model). Our mirror serves a curated subset (~34 publishers in v0.2.0) plus on-demand long-tail.

### Two-layer cryptographic verification before execution

1. **Manifest signature (Ed25519).** Before any translator is fetched, the extension downloads `translators.milton.so/repo/metadata` (the canonical list of available translators + their SHA-256 hashes) and `translators.milton.so/repo/metadata.sig` (the Ed25519 signature of the manifest). The signature is verified against a public key compiled into the extension at build time (`src/translator-runtime/manifest-signing-pubkey.ts`). Signature failure aborts the refresh entirely. Source: [`src/translator-runtime/translator-fetcher.ts:244-249`](https://github.com/Demandrel/milton-browser-extension/blob/main/src/translator-runtime/translator-fetcher.ts#L244-L249).

2. **Per-translator SHA-256.** Each individual translator's bytes are hashed and compared against the SHA-256 listed in the (signature-verified) manifest entry. Hash mismatch throws `HASH_MISMATCH` and aborts. Source: [`src/translator-runtime/translator-fetcher.ts:354-359`](https://github.com/Demandrel/milton-browser-extension/blob/main/src/translator-runtime/translator-fetcher.ts#L354-L359).

A translator can only execute if BOTH layers pass: the manifest must be signed by Demandrel's key AND the translator's bytes must hash to the expected value in the signed manifest.

### Restricted execution context

Translators are not executed in the extension's privileged service-worker or popup context. They are executed inside the declared sandbox page (`src/translator-runtime/sandbox.html`, declared in `manifest.config.ts:70-72`) which runs at opaque origin with `'unsafe-eval'` CSP scoped strictly to that page. The sandbox has no `chrome.*` API access and no direct network access; it communicates with the rest of the extension only via `postMessage`. A malicious translator (even if it somehow bypassed both verification layers) could not exfiltrate user data, access cookies, or make outbound network requests — its only capability is to parse the HTML it was given and return structured metadata fields.

### Why this model and not a static bundle

Publishers change their HTML several times a year. A static bundle pinned at extension build time would mean: every publisher HTML change → broken capture → wait for a new extension release → users on the old extension stay broken. Milton's sideload-first distribution model (alongside CWS) means many users won't auto-update on a tight cadence. The fetch-and-verify model lets translator fixes propagate to users within hours of a publisher change, without compromising trust (the cryptographic chain guarantees only Demandrel-signed translators execute).

This is the same model Zotero Connector has used in the Chrome Web Store since long before MV3.

---

## Data handling summary

| Category | Collected? | Where stored? |
|---|---|---|
| Pages you capture | Only when you click the toolbar button | Sent to your own `127.0.0.1:7521` Milton-desktop; never to a Milton server |
| Page contents (HTML / PDF bytes) | Only the specific page you're capturing | Sent to your local Milton-desktop; never to a Milton server |
| Browsing history | No | N/A |
| Cookies / authentication tokens (for publisher sites) | No (uses your existing tab session but never reads or exports cookie values) | N/A |
| User analytics / telemetry | No | N/A |
| Third-party trackers | None | N/A |
| Crash reports | No | N/A |

For the full user-facing privacy policy, see [PRIVACY.md](https://github.com/Demandrel/milton-browser-extension/blob/main/PRIVACY.md) (also rendered at <https://demandrel.github.io/milton-browser-extension/PRIVACY> for the CWS form's privacy policy URL field).
