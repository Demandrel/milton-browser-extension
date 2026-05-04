# Milton Browser Extension — Planning

**Status: Not started — pending prerequisites**

## What this will do

A lightweight browser extension that:
1. Detects when the user is on an academic paper page (journal, PubMed, arXiv, etc.)
2. Sends the page URL to the self-hosted Zotero translation-server
3. Receives structured CSL-JSON metadata back
4. POSTs it to Milton's local HTTP import endpoint (`http://localhost:MILTON_PORT/import`)

## Prerequisites before building

1. **Translation-server validated** — test in `../translation-server/` first
2. **Milton local HTTP server** — Milton's Tauri app needs to expose a local import endpoint.
   This requires a new Tauri story: "local HTTP import server for browser extension".
   Until that story ships, the extension has nowhere to send data.

## Architecture

```
Browser page
    ↓ (page URL or HTML)
Browser Extension
    ↓ POST to hosted translation-server
Translation Server (self-hosted)
    ↓ returns CSL-JSON
Browser Extension
    ↓ POST to localhost:MILTON_PORT/import
Milton Desktop App
    → reference imported, toast shown
```

## Notes

- The extension does NOT need cloud/network access to Milton. Everything is localhost.
- This is the same model as Zotero's browser connector ↔ Zotero desktop (port 23119).
- Initial target: Chrome/Chromium (Manifest V3). Firefox later.
