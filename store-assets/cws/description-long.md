**Milton requires the Milton desktop app running on your computer.** The extension talks to your local Milton install at `127.0.0.1:7521` — this is NOT a hosted service. Without the desktop app, the extension can't save anything. Get Milton at https://milton.so.

---

**Capture academic references from any page you can already read.**

Milton works the way you'd want a reference manager to work: you're on a publisher article page or PDF, you click the Milton toolbar, the metadata + (when available) the PDF show up in your local Milton library a moment later. That's it.

The capture runs entirely client-side, in your browser tab's context, using your existing session. So if you can read the article in your browser — including on cookie-walled, Cloudflare-protected, or Anubis-protected publishers where you've already authenticated — Milton can capture it. There's no Milton server reading the page over your shoulder; the only thing leaving your tab is the structured metadata + optional PDF, which goes to YOUR Milton-desktop on `127.0.0.1` (localhost).

---

**Coverage**

Out of the box, Milton supports the academic publisher catalog Zotero's translator project covers — including arXiv, PubMed, IEEE Xplore, ACM Digital Library, Springer, Wiley, Elsevier (ScienceDirect), Nature, Cell Press, Cambridge, Oxford, JSTOR, SSRN, RePEc, Project MUSE, bioRxiv, medRxiv, and many more. The full list of ~34 bundled translators ships with the extension; long-tail publishers are fetched on-demand from Milton's verified translator mirror.

For PDF pages: Milton captures the PDF bytes directly from your browser session and uploads them to your local Milton-desktop alongside the metadata.

For sites where automatic detection doesn't fire (rare on academic publishers), Milton falls back to a server-side translation path. Some heavily bot-protected publishers may behave less well on that fallback path until our partner's anti-captcha integration ships in v0.3 (weeks away). The common capture path is unaffected — if you're reading the page in your tab, the extension uses your session and works.

---

**Privacy + how it works**

Milton's browser extension does NOT collect, transmit, or store anything about your browsing. It only sees a page when you explicitly click the toolbar button on it, and only sends data to (a) your own local Milton-desktop and (b) Milton's translator-mirror CDN to fetch verified translator scripts. There are no analytics, no telemetry, no third-party trackers.

Full privacy policy: https://demandrel.github.io/milton-browser-extension/PRIVACY

The extension is **open source** under the GNU AGPL v3 license. Every line of code that gets bundled into this listing is published at:

  https://github.com/Demandrel/milton-browser-extension

Translator scripts (the only "remote code" Milton fetches at runtime) are cryptographically verified before execution: Ed25519-signed manifest + per-translator SHA-256. Same model Zotero Connector uses.

---

**Status**

This is v0.2.0 — the first public Chrome Web Store release. Milton-desktop is also in active development. Things that work today:

- Client-side capture on academic publishers (HTML + PDF)
- Tags / projects / collections selection in the popup
- Auto-attach the PDF when saving from a PDF page
- Periodic refresh of bundled translators (no need to wait for extension updates)

Things explicitly coming in v0.3+ (weeks away):

- Stronger anti-captcha integration for the rare server-fallback path
- Continued expansion of the bundled translator set
- Per-publisher refinement based on what real users hit

---

**Support**

- File issues, request publishers, or report bugs: https://github.com/Demandrel/milton-browser-extension/issues
- Source code (AGPL): https://github.com/Demandrel/milton-browser-extension
- Privacy policy: https://demandrel.github.io/milton-browser-extension/PRIVACY
- Milton desktop app: https://milton.so

Best-effort response on issues; this is an open-source project, not an enterprise product.
