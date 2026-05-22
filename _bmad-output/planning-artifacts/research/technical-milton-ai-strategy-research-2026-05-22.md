---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments: ['_bmad-output/planning-artifacts/charter-v2.md', '_bmad-output/implementation-artifacts/sprint-status.yaml']
workflowType: 'research'
lastStep: 5
workflowStatus: 'complete'
completedDate: '2026-05-22'
phase_1_feature_decision: 'metadata-extraction first (confirmed by Pierre 2026-05-22)'
research_type: 'technical'
research_topic: 'Milton AI platform (epic-21) — credits system, multi-provider, BYO keys, local LLM, chat-with-PDF, semantic search'
research_goals: 'Plan epic-21 — the AI/IA features epic. Produce the technical backbone for an app-wide AI platform: (1) an AI-credits system metering all AI tasks (metadata extraction, chat-with-PDF, semantic search, future features) across free vs paid tiers; (2) multi-provider model choice for paid users (Claude, OpenAI, Mistral, DeepSeek; fast vs reasoning tiers); (3) bring-your-own API keys; (4) purchasable credit packs; (5) downloadable local LLMs to avoid hosted cost; (6) chat-with-PDF; plus the original BE-8-8 LLM metadata extraction + GROBID retirement. Cross-cutting concerns: execution topology (extension vs Milton-desktop vs Milton-server), cost modeling / Pro-tier economics, secure key storage. Output feeds epic-21 planning. Epic 21 is fully independent of epic 20.'
user_name: 'Pierre'
date: '2026-05-22'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-05-22
**Author:** Pierre
**Research Type:** technical

---

## Research Overview

**Purpose.** This document is the technical research backbone for **epic-21 — the Milton AI platform.** Milton (a reference manager: a Tauri desktop app + a Chromium MV3 browser extension + a thin server at `translate.milton.so` + a local connector at `127.0.0.1:7521`) is adding AI as a first-class, app-wide capability. Epic-21 is not a single feature — it is a *platform*: an AI-credits system that meters every AI task, multi-provider model choice, bring-your-own-key (BYOK), purchasable credit packs, downloadable local LLMs, and the first wave of AI features (metadata extraction, chat-with-PDF, corpus semantic search).

**Methodology.** Web-verified research (May 2026) across five parallel investigations: (1) hosted LLM providers; (2) AI orchestration SDKs; (3) local LLM runtimes; (4) RAG / vector / PDF architecture; (5) AI monetization & metering patterns. Every factual claim carries a source URL and a `[High/Medium/Low Confidence]` flag. Facts (from sources), analysis (interpretation), and speculation are kept distinct.

**Source inputs.** `_bmad-output/planning-artifacts/charter-v2.md`; `_bmad-output/implementation-artifacts/sprint-status.yaml` (the deferred BE-8-8 LLM-fallback scope is the seed of this epic); user-stated epic-21 product direction (2026-05-22).

**Scope note.** Epic-21 is independent of epic-20. Because the scope is large (7 distinct capabilities), this research recommends a v1/v2 sequencing rather than treating all features as one release.

---

## Technology Stack Analysis

> Step 2 establishes the *technology landscape* — providers, runtimes, SDKs, storage, document tooling, and metering patterns. Architectural decisions (RAG vs long-context, execution topology, credit-unit design) are resolved in Steps 3–5. Where this section states a fact relevant to a later decision, it is tagged accordingly.

### A. Hosted LLM Provider Stack

The four providers in scope, with a "fast/cheap" tier and a "deep reasoning" tier each (USD per million tokens, May 2026):

| Provider | Fast tier | Fast in/out | Reasoning tier | Reasoning in/out | Native PDF | Cache read | Batch API |
|---|---|---|---|---|---|---|---|
| **Anthropic** | `claude-haiku-4-5` | $1.00 / $5.00 | `claude-opus-4-7` | $5.00 / $25.00 | ✅ 600 pp / 32 MB | **0.1×** (90% off) | ✅ 50% off |
| **OpenAI** | `gpt-4o-mini` | $0.15 / $0.60 | `gpt-5.4` | $2.50 / $15.00 | ✅ ~100 pp / 50 MB | 0.5× (50% off) | ✅ 50% off |
| **Mistral** | `mistral-small-3.2` | $0.075 / $0.20 | `mistral-large-3` | ~$0.50 / $1.50 | ⚠️ via OCR API | ~0.1× (unconfirmed) | ✅ 50% off |
| **DeepSeek** | `deepseek-v4-flash` | $0.14 / $0.28 | `deepseek-v4-pro` | $1.74 / $3.48 | ❌ text only | **~0.02×** (98% off) | ❌ none |

**Key findings:**

- **PDF tokenization is the load-bearing cost fact.** Both Anthropic and OpenAI process each PDF page as **text tokens *plus* image tokens** — a page costs ~1,500–3,000 text tokens *and* a vision render (~hundreds to ~1,000+ tokens). A 40-page paper sent as a *native PDF* is therefore far heavier than the same paper sent as *extracted text* (~10–15k tokens total). This directly contradicts the "just send the raw PDF, it's cheap" framing. `[High Confidence]` — https://platform.claude.com/docs/en/build-with-claude/pdf-support , https://developers.openai.com/api/docs/guides/file-inputs
- **Native PDF support does not generalize.** Claude and GPT accept PDFs directly; **Mistral routes documents through a separate OCR API** (`mistral-ocr`, $2/1k pages, $1 batch) that returns markdown — not a chat call; **DeepSeek has no file input at all** — the caller must extract text. `[High Confidence]` — https://mistral.ai/news/mistral-ocr-3 , https://api-docs.deepseek.com/
- **Caching mechanics differ per provider and matter for credit pricing.** Anthropic = explicit `cache_control` breakpoints, 5-min (write 1.25×) or 1-hr (write 2.0×) TTL, read at 0.1×. OpenAI/DeepSeek = automatic, no write cost. DeepSeek's 98% cache-read discount is the cheapest repeat-context economics of the four. `[High Confidence]` — https://platform.claude.com/docs/en/build-with-claude/prompt-caching , https://api-docs.deepseek.com/guides/kv_cache
- **All four support structured output / tool use** (JSON schema / JSON mode) — viable for metadata extraction on any provider. `[High Confidence]`
- **Anthropic Opus 4.7 tokenizer note:** the new tokenizer can consume up to ~35% more tokens for the same text vs prior Opus — affects effective cost per request. `[Medium Confidence]` — Anthropic pricing docs.

### B. Local Inference Stack

For the "download a local LLM to avoid paying" requirement. This is a **Milton-desktop-only** capability — a browser extension cannot host local inference at usable quality.

**Runtimes & Tauri integration** (verdict: sidecar pattern, not Rust-native embedding):

| Runtime | Integration with Tauri | Verdict |
|---|---|---|
| **Ollama** | User-installed (HTTP `:11434`) **or** bundled sidecar via `externalBin` | ✅ **Recommended** — proven Tauri+Ollama apps exist; simplest path |
| **llama.cpp** (`llama-server`) | Sidecar binary, or `llama-cpp-2` Rust crate in-process | ⚠️ Works; binary/platform matrix called "very hacky"; in-process crash kills UI |
| **LM Studio** | User-installed only (OpenAI-compatible `:1234`) | ⚠️ Optional detected backend — best MLX perf on Apple Silicon |
| **mistral.rs / Candle** | Pure-Rust, embeddable in Tauri backend | ❌ No production Tauri precedent; high build complexity |

`[High Confidence]` — https://v2.tauri.app/develop/sidecar/ , https://github.com/dillondesilva/tauri-local-lm , https://crates.io/crates/llama-cpp-2

**Model families (2026, GGUF + Q4_K_M quantization):**

| Model | Params | Disk (Q4) | RAM/VRAM | Context |
|---|---|---|---|---|
| Phi-4-mini | 3.8B | ~2.5 GB | 3 GB | 128K |
| Gemma 3 4B / Qwen3 4B | 4B | ~3 GB | 3 GB | 128K / 32K |
| Qwen3 8B / Llama 3.3 8B | 8B | ~5–6 GB | 6–8 GB | 32K / 128K |
| Gemma 3 12B | 12B | ~8 GB | 8 GB | 128K |
| Mistral Small 3 | 22B | ~14 GB | 14–16 GB | 128K |

`[High Confidence]` — https://www.promptquorum.com/local-llms , https://localaimaster.com/blog/small-language-models-guide-2026

**Local capability reality check** `[High/Medium Confidence]`:
- **Metadata extraction:** an 8–14B local model with JSON-constrained decoding likely hits **80–90%+ on core bibliographic fields** (title, authors, DOI, year, journal). The MOLE benchmark (EMNLP 2025) showed only a ~7-point spread between a 27B local-class model (Gemma 3 27B, 60.3%) and frontier models (Gemini 2.5 Pro, 67.4%) across ~30 metadata attributes. — https://arxiv.org/html/2505.19800v1
- **Vision/PDF:** local models **do not accept PDFs natively**; even local VLMs (Qwen2.5-VL) need a `PDF → images → VLM` pipeline. For born-digital academic PDFs, local text extraction (Marker-PDF, Docling) is the practical path.
- **Local embeddings** are mature and cheap: `nomic-embed-text v1.5` (274 MB, 768-dim, 8K context) is the consensus default; `mxbai-embed-large` (670 MB) for higher retrieval quality. — https://www.morphllm.com/ollama-embedding-models

### C. Orchestration & SDK Layer

- **Vercel AI SDK is at v6** (May 2026). v5 (Jul 2025) moved streaming to standard **SSE** and split `UIMessage`/`ModelMessage`; v6 added a first-class `Agent` class and stable MCP support. `@ai-sdk/svelte` exposes a `Chat` class built on Svelte 5 runes (`$state`). The French discussion cited "AI SDK 4.0" — **two major versions stale.** `[High Confidence]` — https://vercel.com/blog/ai-sdk-5 , https://vercel.com/blog/ai-sdk-6
- **Provider-switching abstraction is real but leaky.** Basic text/tool/object generation = swap one model reference. **What leaks via `providerOptions`:** Anthropic prompt caching (explicit `cacheControl` markers; *silently* dropped when switching providers), native PDF support (backend varies), reasoning/thinking params. Notably, the `UIMessage` type produced by `Chat`/`useChat` **does not carry `providerOptions`** — you must `convertToModelMessages()` first to apply Anthropic caching. **Mitigation:** wrap all `providerOptions.anthropic` usage in one internal `buildAnthropicMessages()` utility. `[High Confidence]` — https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
- **Tauri topology constraint (critical).** A Tauri app ships SvelteKit via `adapter-static` — **no Node server runs inside the app, so SvelteKit `+server.ts` routes do not exist at runtime.** `streamText`/`generateText` cannot run in the WebView (API-key exposure). The LLM-calling code must live in: **(A)** Rust Tauri commands (`reqwest`), **(B)** a Rust loopback HTTP server, **(C)** a Node sidecar, or **(D)** a remote server. **Option B is the architectural sweet spot for Milton** — the connector *already* runs a Rust loopback on `127.0.0.1:7521`; the `Chat` class points at `…/api/chat`, Rust streams SSE back, API keys stay in Rust. This confirms the earlier challenge: the French "`+server.ts` is incontournable" advice assumed a web app and does not hold for Milton-desktop. `[High Confidence]` — https://v2.tauri.app/start/frontend/sveltekit/ , https://v2.tauri.app/learn/sidecar-nodejs/
- **LangChain.js / LlamaIndex.TS** are *not* needed for v1 (and LangChain.js does not run in browser/edge bundles — disqualifying for the extension). LlamaIndex.TS becomes relevant only if/when a heavy RAG knowledge-base feature is built. `[High Confidence]` — https://freeacademy.ai/blog/langchain-vs-llamaindex-vs-vercel-ai-sdk-comparison-2026

### D. Embeddings & Vector Storage

**Embedding models** (MTEB / price per 1M tokens, April 2026):

| Model | Dim | $/1M | Max tokens | MTEB | Note |
|---|---|---|---|---|---|
| voyage-3-large | 1024 | $0.18 | 32,000 | 67.1 | Best quality; long context for paper chunks |
| jina-embeddings-v3 | 1024 | $0.02 | 8,192 | 65.5 | Best value (hosted) |
| text-embedding-3-small | 1536 | $0.02 | 8,191 | 62.3 | OpenAI baseline |
| GTE-large-en-v1.5 (OSS) | 1024 | free | 8,192 | 65.4 | Best self-hosted |
| nomic-embed-text v1.5 (OSS) | 768 | free | 8,192 | 62.3 | Local desktop default |

`[High Confidence]` — https://pecollective.com/tools/text-embedding-models-compared/

**Vector stores** — two deployment targets:

- **Local desktop (embedded):** `sqlite-vec` (zero-dependency SQLite extension; brute-force KNN fine to ~100k vectors — Milton-desktop almost certainly already uses SQLite) or `LanceDB` (file-based, HNSW, scales to millions). `[High Confidence]`
- **Server:** `Qdrant` (Rust, ~4ms p50 @ 1M vectors, best raw perf) or `pgvector` (if a Postgres instance already exists and SQL joins across relational metadata + vectors are wanted). `[High Confidence]` — https://callsphere.ai/blog/vector-database-benchmarks-2026-pgvector-qdrant-weaviate-milvus-lancedb

### E. PDF & Document Processing

- **`pdf.js getTextContent()` is inadequate as the sole extraction path for academic papers.** Documented, unresolved failures: reading-order corruption on **two-column layouts** (interleaves columns — i.e., most journal PDFs), no equation extraction, silent empty-text failures. `[High Confidence]` — https://github.com/mozilla/pdf.js/issues/17191
- **Tiered extraction is the answer:** native API PDF upload (Claude/GPT) for complex layouts → **Marker-PDF** (local OSS, layout-aware, equation support, low hallucination) → **Mistral OCR 3** (cloud, $1/1k pages batch, LaTeX equations, multi-column, 93–97% cheaper than AWS/Google Document AI). `[High Confidence]` — https://www.firecrawl.dev/blog/best-pdf-parsers , https://pyimagesearch.com/2025/12/23/mistral-ocr-3-technical-review-sota-document-parsing-at-commodity-pricing/

### F. Monetization & Metering Patterns

How comparable AI products meter and price (May 2026):

| Product | Metering model | Free tier | Paid entry | BYOK |
|---|---|---|---|---|
| **Cursor** | Dollar-denominated credit pool (1 credit = $0.01) | 50 slow req | $20 → $20 credits | — |
| **GitHub Copilot** | Token-based "AI Credits" (June 2026) | 2,000 completions + 50 premium req | $10 → $10 credits | — |
| **Perplexity** | Daily action caps | 3 Pro searches/day | $20/mo → unlimited | — |
| **Notion AI** | Bundled + metered agent credits | 20 responses once | $20/user; agents $10/1,000 credits | — |
| **Raycast** | Request-count + **zero-fee BYOK** | 50 msgs, or unlimited via BYOK | $8/mo + $8 AI add-on | ✅ free, no platform fee |
| **ChatGPT** | Per-model rolling-window caps | limited | $20/mo | — |

**Key findings:**

- **Credit normalization — the Cursor model is the clearest precedent.** The credit pool is **dollar-denominated**; different models simply debit different amounts (~$0.03/Sonnet-class request, ~$0.10/Opus-class request). This solves the "how can one credit cover both a cheap and an expensive model" problem cleanly. The "Auto mode = unlimited, manual model pick = credit drawdown" pattern lets users feel unlimited while heavy frontier-model users self-select into higher spend. `[High Confidence on model; Medium on exact figures]`
- **BYOK precedent — Raycast (June 2025)** introduced zero-subscription, no-platform-fee BYOK; most others (JetBrains, CodeGPT) require a base subscription. Key storage best practice: **OS keychain on-device**, or encrypted server-side with per-workspace key wrapping; **plaintext storage is the documented failure mode.** `[High Confidence]`
- **Top-up:** auto-reload is now the dominant replenishment mechanic (Anthropic "Auto-Reload", OpenAI "Automatic Reload", Perplexity "Auto-Refill"). One-time credit packs exist but are secondary. `[High Confidence]`
- **Economics:** ICONIQ's Jan 2026 State of AI report — average AI-product gross margin **52%** (vs 80% traditional SaaS); inference ≈ 23% of revenue at scale. Early-stage markup target **2–4× raw API cost** (70–75% GM floor). LLM API prices fell ~80% between early-2025 and early-2026. Prompt caching is the single highest-leverage margin lever for repetitive-context workloads like reference management. `[High Confidence]` — ICONIQ via SaaStr.

### G. Cross-Stack Synthesis — Patterns That Connect the Decisions

Five patterns emerge that shape every later architectural decision:

1. **Capability-tiered provider routing is unavoidable.** Because native PDF, caching, and batch support are *not* uniform across Claude / GPT / Mistral / DeepSeek / local, the platform needs a normalization layer: a per-provider capability matrix that the router consults. "Send the raw PDF" is a Claude/GPT path only.
2. **RAG and long-context are different tools for different features, not competitors.** 2025–26 consensus: **long-context (whole document in context) + prompt caching wins for single-paper chat**; **RAG is mandatory for corpus search** across a whole library. Milton needs both — they share infrastructure (embedding model, vector store) but serve different features. (Resolved in Step 4.)
3. **Execution topology is forced by the surface, not chosen freely.** Extension → must call through a server broker (no secrets in the bundle). Desktop → Rust loopback owns hosted-API keys *and* local inference. Server → key broker + credit ledger + (optionally) corpus embeddings. This generalizes the old Charter Decision #3. (Resolved in Steps 3–4.)
4. **The credit must be a dollar-denominated normalized unit.** It is the only design that survives a matrix of providers/models with 30×+ cost spread plus a free local-inference option. (Resolved in Step 5.)
5. **Prompt caching is not optional — it is the business model.** Both the cost model (52% GM ceiling) and the chat-with-PDF UX depend on it. Cache strategy must be designed per-provider, not assumed uniform.

**Adoption-trend reading:** the market has converged on (a) dollar-denominated credit pools over opaque "credits", (b) BYOK as a retention/cost-relief feature, (c) hybrid RAG-plus-long-context, and (d) caching as the margin lever. Milton's epic-21 design is well-aligned with where comparable products landed in 2026 — it is not contrarian.

### Technology Stack — Source URLs

Anthropic pricing/PDF/caching: https://platform.claude.com/docs/en/about-claude/pricing · https://platform.claude.com/docs/en/build-with-claude/pdf-support · https://platform.claude.com/docs/en/build-with-claude/prompt-caching — OpenAI: https://developers.openai.com/api/docs/models/gpt-5.4 · https://developers.openai.com/api/docs/guides/file-inputs · https://developers.openai.com/api/docs/guides/batch — Mistral: https://mistral.ai/news/mistral-ocr-3 · https://aiproductivity.ai/pricing/mistral-ocr/ · https://docs.mistral.ai/studio-api/batch-processing — DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/ · https://api-docs.deepseek.com/guides/kv_cache — AI SDK: https://vercel.com/blog/ai-sdk-5 · https://vercel.com/blog/ai-sdk-6 · https://ai-sdk.dev/providers/ai-sdk-providers/anthropic — Tauri: https://v2.tauri.app/start/frontend/sveltekit/ · https://v2.tauri.app/learn/sidecar-nodejs/ — Local LLM: https://v2.tauri.app/develop/sidecar/ · https://github.com/dillondesilva/tauri-local-lm · https://www.promptquorum.com/local-llms · https://arxiv.org/html/2505.19800v1 · https://www.morphllm.com/ollama-embedding-models — RAG/PDF/vectors: https://tianpan.co/blog/2026-04-09-long-context-vs-rag-production-decision-framework · https://github.com/mozilla/pdf.js/issues/17191 · https://www.firecrawl.dev/blog/best-pdf-parsers · https://pecollective.com/tools/text-embedding-models-compared/ · https://callsphere.ai/blog/vector-database-benchmarks-2026-pgvector-qdrant-weaviate-milvus-lancedb — Monetization: https://freeacademy.ai/blog/langchain-vs-llamaindex-vs-vercel-ai-sdk-comparison-2026

## Integration Patterns Analysis

> Step 3 covers *how the pieces talk*: the execution topology, the AI-gateway layer, the credit-ledger API, streaming + metering, BYOK flow, auth, and Stripe. The binding *decisions* (which topology, build-vs-buy, credit-unit design) are made in Step 4.

### Existing Milton integration surface (the baseline epic-21 extends)

Epic-21 does not start from zero. The relevant pre-existing contracts:

- **Local connector** — Rust loopback at `127.0.0.1:7521` (part of Milton-desktop): `/health`, `/references`, `/references/{id}/pdf-bytes` (BE-8-2), `/auth/issue-token` (BE-4 / story 18-15), `/tags`, `/projects`, `/collections`.
- **Milton-server** — `translate.milton.so`: translation orchestration + the **EdDSA JWT key broker** (story TS-6). BE-4 established the auth flow: the connector mints a short-lived **EdDSA JWT**, the client sends `Authorization: Bearer …`, the server verifies it.
- **CDN** — `translators.milton.so` serves translator bytes (Ed25519-signed manifest + per-file SHA-256).

**The key reusable asset:** the EdDSA-JWT broker pattern (BE-4) is exactly the trust primitive an AI gateway needs — a verifiable per-user identity token that a server-side meter can attribute usage to. Epic-21 extends it rather than inventing new auth.

### A. Execution Topology — Where AI Calls Run

AI calls cannot all run in one place; the *surface* forces the integration path. Three surfaces, three constraints:

| Surface | Constraint | AI integration path |
|---|---|---|
| **Browser extension** | No secrets in the bundle; no local inference at quality | **Must** route through the server-side AI gateway. Always. |
| **Milton-desktop** (Tauri) | `adapter-static` → no `+server.ts`; Rust side can hold secrets + spawn local inference | Rust loopback owns: (a) calls to the server gateway, (b) BYOK direct-to-provider calls, (c) local-LLM inference via Ollama |
| **Milton-server** | The only trustworthy metering point | Hosts the AI gateway + credit ledger; holds Milton-owned provider keys |

**Consequence:** the credit ledger and the Milton-keyed provider calls are **server-side, non-negotiably** — client-side metering is unauditable. This is the integration-level confirmation of the topology; Step 4 assigns each *feature* to a surface. `[High Confidence]` — derived from Step 2 SDK/Tauri findings.

**Three distinct call paths** epic-21 must support:

1. **Milton-keyed (credits path):** client → `Authorization: Bearer <EdDSA JWT>` → server AI gateway → provider. Gateway meters tokens, debits the ledger. Used by extension always; desktop when the user hasn't chosen BYOK/local.
2. **BYOK path:** desktop Rust → provider directly, using the user's key from the OS keychain. No Milton cost, no server hop, no credit debit. (Extension cannot do BYOK safely — desktop-only feature.)
3. **Local path:** desktop Rust → Ollama on `127.0.0.1:11434`. Zero cost, fully offline, no credit debit. (Desktop-only.)

### B. The AI Gateway Layer — Build vs Buy

The server needs a layer that routes to Claude/OpenAI/Mistral/DeepSeek, holds keys, meters per-user tokens, supports fallback, and feeds the credit ledger. Options researched:

| Product | Self-host | Credit-metering backbone? | Verdict for Milton |
|---|---|---|---|
| **LiteLLM** | ✅ OSS | Yes — virtual keys, spend APIs, hard budget stops | Strongest buy option; ~20 h/mo + ~$2k/mo TCO at HA |
| **OpenRouter** | ❌ SaaS | Yes — provisioned-key-per-user + generation lookup | Fast start; 5.5% purchase fee compounds |
| **Cloudflare AI Gateway** | ❌ SaaS | ❌ No per-user attribution; streaming token bugs | Caching/rate-limit layer only |
| **Portkey** | ✅ OSS gateway (Mar 2026) | Partial — per-user spend API under-documented | POC-validate before betting on it |
| **Helicone** | ✅ OSS | ❌ Observability only | Optional cost-dashboard add-on |
| **Vercel AI Gateway** | ❌ SaaS | Partial — best per-generation data, but no user aggregation + Vercel lock-in | Lock-in disqualifies |

`[High Confidence]` — https://docs.litellm.ai/docs/proxy/cost_tracking , https://openrouter.ai/docs/guides/administration/usage-accounting , https://github.com/cloudflare/ai/issues/470

**Minimum viable self-built proxy** (the research notes ~500 LOC covers ~80% of gateway surface): per-provider key vault; SSE pass-through forwarding; final-chunk token extraction; cost calc against a maintained pricing table; atomic credit-debit on completion; BYOK header pass-through; fallback retry list. The main ongoing cost is keeping provider pricing tables current — LiteLLM's pricing repo can be referenced as the source of truth even in a self-built proxy. `[High Confidence]` — https://engineering.instawork.com/introducing-llm-proxy-3e6b05495d30 , https://www.truefoundry.com/blog/llm-proxy

**Analysis:** Milton's credit model is custom (dollar-normalized unit, free/paid/BYOK/local paths), and it already operates a server. That biases toward **a thin self-built proxy that embeds LiteLLM as a library/router, or a self-hosted LiteLLM with custom debit logic on its spend APIs** — not a SaaS gateway. Decision finalized in Step 4.

### C. Credit-Ledger & Metering API

The research is unambiguous on the ledger design `[High Confidence]` — https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v , https://www.stigg.io/blog-posts/weve-built-ai-credits-and-it-was-harder-than-we-expected , https://flexprice.io/blog/how-to-implement-credit-based-billing-for-ai-applications :

- **Append-only ledger, never a mutable balance.** Balance = sum of immutable rows. `UPDATE … SET balance = balance - N` is explicitly unsafe (a crash/race silently destroys or mints credits). Corrections are new opposite-sign rows.
- **Atomic debit:** `SELECT … FOR UPDATE` row lock + balance check + INSERT in one transaction; a `balance - debit ≥ 0` constraint rejects overspend. Without the row lock, two concurrent requests both pass the check and both debit.
- **Idempotency keys are mandatory.** Every usage event carries a unique `event_id`; a dedup table rejects replays. Usage pipelines are at-least-once by design — retries *will* double-charge without this.

**Proposed internal API contract** (server-side, JWT-authenticated):

| Endpoint | Purpose |
|---|---|
| `GET /ai/balance` | Current credit balance + tier + allocation reset date |
| `POST /ai/reserve` | Pre-call hold: returns a `reservation_id` for an estimated debit |
| `POST /ai/settle` | Post-call true-up: commits actual debit, releases the hold |
| `GET /ai/usage` | Per-user usage history (feeds an in-app usage view) |

### D. Streaming Protocol & Token Accounting

**Transport:** standard **SSE** end to end. The Vercel AI SDK v5+ emits standard SSE; the `Chat` class consumes it. In Milton-desktop the `Chat` class points at the Rust loopback (`127.0.0.1:7521/api/chat`), which proxies SSE from the server gateway; in the extension the `Chat` class targets the gateway via the connector or directly with the JWT.

**The streaming-billing problem** `[High Confidence]` — https://www.hypertrends.com/2025/08/why-streaming-ai-responses-break-token-tracking-and-how-to-fix-it-in-semantic-kernel/ : token usage is only known at stream end. Providers emit a final `usage` chunk when called with `stream_options: { include_usage: true }` (OpenAI/DeepSeek/Mistral) or in the message-delta (Anthropic). The proxy pattern:

```
1. Client opens SSE to gateway   2. Gateway opens SSE to provider (include_usage=true)
3. Gateway pipes chunks through unbuffered (zero added latency)
4. Gateway watches for the non-null usage chunk
5. On stream end: extract real token counts → cost → atomic ledger settle (async, off the stream path)
6. If the usage chunk never arrives (provider bug): fall back to a tiktoken/count_tokens estimate
```

This adds **zero latency** to the user experience while achieving exact accounting. `[High Confidence]`

**Estimate-then-true-up (hold-and-settle)** — the recommended pattern for any request that could be expensive (chat-with-PDF certainly qualifies): reserve estimated credits before the call (input tokens are *exact* pre-call; estimate output as `max_tokens × rate` or historical p75), let the call run, then settle to actuals and release the over-reservation. The Credyt risk matrix: post-debit is fine under ~$0.01/request; hold-and-settle becomes mandatory above ~$0.10. `[High Confidence]` — https://credyt.ai/blog/stripe-metered-billing-issues

**Token counting for the pre-call estimate:** Anthropic ships a free `POST /v1/messages/count_tokens` endpoint (separate rate limit, ~1–2% error) — the only exact method for Claude. `tiktoken` is exact for OpenAI but ~12% off for Claude. The `tokencost` library wraps multiple tokenizers + price tables for 400+ models. `[High Confidence]` — https://platform.claude.com/docs/en/docs/build-with-claude/token-counting , https://github.com/AgentOps-AI/tokencost

### E. BYOK Integration Flow

- **Storage:** OS keychain on the desktop (Tauri Stronghold / OS keyring). Plaintext storage is *the* documented failure mode. The extension cannot securely store keys — **BYOK is a desktop-only capability.** `[High Confidence]`
- **Flow:** desktop Rust reads the user key from the keychain → calls the provider directly (or passes it through the gateway via a request-scoped header à la OpenRouter/Vercel BYOK). Direct-from-Rust keeps the key on-device and avoids a hop; gateway-passthrough centralizes observability but exposes the key to the server. Step 4 picks one.
- **Billing treatment:** BYOK calls consume **no credits** (per the user's clarified two-option model: top-up credits *or* bring your own key). The ledger may still record a zero-cost usage row for the in-app usage view.

### F. Authentication & Key-Broker

Extend BE-4, don't replace it. The connector's `/auth/issue-token` mints an EdDSA JWT; the AI gateway verifies it with the same public key the translation path already uses. The JWT's subject identifies the user → the gateway attributes usage and debits that user's ledger. New claim needed: the user's tier (free/paid) so the gateway can enforce model-access rules (paid-only model choice) without a DB round-trip. `[High Confidence — pattern reuse]`

### G. Stripe Billing Integration

`[High Confidence]` — https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits/implementation-guide , https://stripe.com/blog/introducing-credits-for-usage-based-billing :

- **Stripe Credit Grants** (`/v1/billing/credit_grants`) — native `paid` vs `promotional` credit categories, optional `expires_at`. Free-tier monthly allocation = a `promotional` grant with `expires_at` = period end. Credit-pack purchase = one-time invoice → `invoice.paid` webhook → create a `paid` grant.
- **Stripe Meters API** (not the legacy Usage Records API — credits only apply to Meters).
- **Critical limitation:** Stripe credit grants reconcile at **invoice time**, not request time. Stripe **cannot block a call when credits hit zero.** Therefore Milton needs **both**: its own append-only ledger as the real-time enforcement layer, and Stripe as the payment/invoice layer. This dual-system design is what serious AI SaaS products run. Note: Stripe acquired Metronome (Jan 2026) — its AI-metering stack is consolidating.
- Subscription tiers (flat fee for paid-plan access + model choice) bill separately from metered AI usage; credits offset only the metered portion.

### H. Local LLM Integration

Desktop Rust ↔ Ollama over HTTP on `127.0.0.1:11434` (user-installed) or a bundled sidecar (`externalBin`). The `Chat` UI is provider-agnostic — a local model is just another entry in the model picker. Local calls bypass the gateway and the ledger entirely (zero cost). Sidecar gotchas: macOS quarantine stripping, per-arch binary naming, log-buffer redirect. `[High Confidence]` — https://v2.tauri.app/develop/sidecar/

### I. Rate Limiting & Abuse Prevention

AI endpoints need **token-based** limiting, not request-count — one request can cost 100× another. Layered defense `[High Confidence]` — https://zuplo.com/learning-center/token-based-rate-limiting-ai-agents , https://www.microsoft.com/en-us/security/blog/2026/03/12/detecting-analyzing-prompt-abuse-in-ai-tools/ :

1. Pre-call balance check (the custom ledger — Stripe can't do this in real time).
2. Per-user RPM + TPM limits at the gateway (sliding-window; avoid fixed-window boundary exploit).
3. Spending caps (hard per-user/per-period ceiling).
4. Anomaly detection (usage spikes = leaked JWT / runaway agent / prompt-injection-driven credit exhaustion — OWASP #1 LLM risk).
5. Signup fraud filtering for the free tier (Stripe observed a 6.2× rise in abusive AI free-trial signups Nov 2025–Feb 2026).

**Note for chat-with-PDF:** prompt injection from PDF content is a *billing* attack vector — a malicious PDF can instruct the model into expensive loops. The per-call credit hold + balance enforcement is the backstop.

### J. Integration Synthesis

The integration architecture that falls out of the research:

```
┌─ Browser Extension ─┐     ┌─ Milton-desktop (Tauri) ──────────────┐
│  @ai-sdk/svelte Chat│     │  SvelteKit (static) — @ai-sdk Chat    │
└─────────┬───────────┘     │  Rust loopback :7521                  │
          │ JWT             │   ├─ keychain (BYOK keys)             │
          │                 │   └─ Ollama :11434 (local LLM)        │
          │                 └──────────┬────────────────────────────┘
          │                            │ JWT (Milton-keyed path only)
          ▼                            ▼
   ┌──────────────── Milton-server ──────────────────┐
   │  EdDSA JWT verify  →  AI Gateway (router +       │
   │  provider key vault + fallback + caching)        │
   │  Append-only credit ledger  ◀─ reserve/settle    │
   │  Stripe (grants + meters + packs)                │
   └──────┬───────────────────────────────────────────┘
          ▼  Claude · OpenAI · Mistral · DeepSeek
```

Three patterns govern every later decision:
1. **One metering point.** All Milton-keyed calls funnel through the server gateway; that is the only place a credit debit is trustworthy.
2. **The client surface dictates the path.** Extension → gateway only. Desktop → gateway *or* BYOK-direct *or* local. This is integration-forced, not a free choice.
3. **Two billing systems, two clocks.** Milton's own ledger runs at request time (enforcement); Stripe runs at invoice time (payment). Neither replaces the other.

### Integration Patterns — Source URLs

Gateways: https://docs.litellm.ai/docs/proxy/cost_tracking · https://openrouter.ai/docs/guides/administration/usage-accounting · https://developers.cloudflare.com/ai-gateway/ · https://github.com/cloudflare/ai/issues/470 · https://thenewstack.io/portkey-gateway-open-source/ · https://vercel.com/docs/ai-gateway/capabilities/usage · https://engineering.instawork.com/introducing-llm-proxy-3e6b05495d30 — Ledger/billing: https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v · https://www.stigg.io/blog-posts/weve-built-ai-credits-and-it-was-harder-than-we-expected · https://flexprice.io/blog/how-to-implement-credit-based-billing-for-ai-applications · https://credyt.ai/blog/stripe-metered-billing-issues — Stripe: https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits/implementation-guide · https://stripe.com/blog/introducing-credits-for-usage-based-billing · https://docs.stripe.com/billing/token-billing — Streaming/tokens: https://www.hypertrends.com/2025/08/why-streaming-ai-responses-break-token-tracking-and-how-to-fix-it-in-semantic-kernel/ · https://platform.claude.com/docs/en/docs/build-with-claude/token-counting · https://github.com/AgentOps-AI/tokencost — Rate limiting/abuse: https://zuplo.com/learning-center/token-based-rate-limiting-ai-agents · https://www.microsoft.com/en-us/security/blog/2026/03/12/detecting-analyzing-prompt-abuse-in-ai-tools/

## Architectural Patterns and Design

> Step 4 is the decision step. It resolves topology per feature, designs the credit unit, settles RAG-vs-long-context, finalizes build-vs-buy, and proposes the epic-21 roadmap. Decisions are marked **AD-n** and carry rationale; they are *recommendations* for the epic-21 PRD/architecture phase, not yet ratified.

### A. Competitive Positioning — What the Architecture Must Deliver

The competitor scan (Zotero+plugins, Mendeley, Paperpile, EndNote, ReadCube, SciSpace, Elicit, Consensus, Scite, ResearchRabbit) gives the architecture its targets:

- **Table stakes (must-have, no longer differentiating):** AI summarization, chat-with-PDF, semantic discovery. Mendeley shipped chat-with-PDF + library RAG in Dec 2025; EndNote, ReadCube, SciSpace all have AI assistants. Milton is currently *behind* here.
- **The decisive gap — and Milton's differentiator:** **no hosted SaaS reference manager offers BYOK, model choice, or local models.** Only the Zotero plugin ecosystem does. Milton's epic-21 (multi-provider choice + BYOK + downloadable local LLMs) would make it **the only hosted reference manager with a privacy-preserving, cost-controllable AI tier.** This is not parity work — it is a category position. `[High Confidence]` — competitor scan, see Step-4 sources.
- **Secondary gaps Milton is well-placed for:** AI-powered metadata *repair* on bulk imports (nobody does this well — and it is literally the BE-8-8 origin); local/offline AI for IP-sensitive research.

**Architectural implication:** the credits/gateway spine must be built so that BYOK and local are first-class paths, not bolt-ons. They are the differentiator; the architecture is designed around them from line one.

### B. Decision Register

| ID | Decision | Choice | Rationale |
|---|---|---|---|
| **AD-1** | Credit unit | **USD-denominated: 1 credit = $0.01** | Only design that absorbs a 30×+ model-cost spread + a free local option. Cursor-proven. Debit = `f(model, tokens)`. |
| **AD-2** | Balance enforcement | **Own append-only ledger (real-time) + Stripe (invoice-time)** | Stripe credit grants reconcile at invoice time and cannot block a call at zero balance. Both layers required. |
| **AD-3** | AI gateway | **Self-built thin proxy on Milton-server**, referencing LiteLLM pricing tables | Custom credit model + an already-operated server + avoiding SaaS fees/lock-in. ~500 LOC covers ~80%. |
| **AD-4** | Execution topology | Extension → gateway only. Desktop → gateway \| BYOK-direct \| local | Forced by surface capability, not chosen (Step 3). |
| **AD-5** | Chat-with-PDF | **Long-context + prompt caching, not RAG** | 2025–26 consensus; cheaper after ~2 turns; cross-section reasoning. |
| **AD-6** | Semantic search | **RAG, local-first** (local embeddings + `sqlite-vec`) | The library lives in the desktop's SQLite; local embeddings = free + private. |
| **AD-7** | BYOK | **Desktop-only, direct-to-provider, key in OS keychain** | Extension cannot hold secrets; direct call keeps the key on-device. |
| **AD-8** | Local LLM | **Desktop-only, Ollama (user-install → bundled sidecar)** | Proven Tauri pattern; extension cannot host inference. |
| **AD-9** | Charter v2 Decision #3 | **Superseded** | "LLM call in Milton-desktop Rust" → **server gateway** is the execution point for metered calls; desktop Rust is the home for BYOK/local only. The extension is now a first-class AI client (absent from the original #3). |

> **AD-9 note** — this is the contestable charter decision flagged in `sprint-status.yaml`. The research confirms it had to move: a metered credit system *requires* a server-side execution point. The "via Milton-server key broker" half of Decision #3 was always correct; the "in Milton-desktop" half is replaced.

### C. Execution Topology — Feature × Surface Matrix

| Feature | Extension | Milton-desktop | Milton-server | Credit cost |
|---|---|---|---|---|
| **Metadata extraction** | ✅ trigger → gateway | ✅ trigger → gateway / BYOK / local | gateway executes | Yes (gateway) / 0 (BYOK, local) |
| **Chat-with-PDF** | ✅ chat UI → gateway | ✅ chat UI → gateway / BYOK / local | gateway executes + caches | Yes / 0 |
| **Semantic search** | ❌ (no library on the extension) | ✅ local embeddings + `sqlite-vec` | optional hosted embeddings | 0 (local) / Yes (hosted embed) |
| **Credit ledger / billing** | — | — | ✅ authoritative | — |
| **Model picker / BYOK / local-model manager** | ❌ | ✅ desktop settings UI | — | — |

**Key reading:** the extension is a *thin* AI client (trigger + chat UI, gateway-only). The desktop is the *rich* surface — it owns model choice, BYOK, local inference, and the local-first semantic search. The server owns money and metering. This cleanly generalizes the old Decision #3 into a three-surface model.

### D. The Credit Unit (AD-1 detail)

- **1 credit = $0.01 USD of normalized AI cost.** The ledger stores integer credits; the gateway computes `credits_debited = ceil( actual_provider_cost_usd × markup / 0.01 )`.
- **`markup`** is a *business* parameter, not an architectural one. The research frames the envelope: AI-product GM ≈ 52%, healthy markup 2–4× raw cost. Recommendation: keep the credit debit close to raw cost (transparent "you spent ~what it cost") and let the **subscription fee** carry the margin — this matches how users perceive Cursor/Copilot. Final multiplier is a pricing decision for the epic-21 PRD.
- **BYOK and local debit 0 credits** (the gateway is bypassed). The ledger still records a zero-cost usage row so the in-app usage view is complete.
- **Free-tier allocation** = a Stripe `promotional` credit grant, `expires_at` = end of period, re-granted monthly. Competitor free tiers cluster at "~5–20 AI actions/month" — size the free credit grant to roughly that envelope (e.g. enough for ~20 metadata extractions or ~5 short PDF chats); exact number is a PRD calibration.
- **Paid tiers** = a flat subscription (unlocks model choice + larger monthly grant) + optional **credit packs** (one-time Stripe invoice → `invoice.paid` webhook → `paid` grant).

### E. RAG vs Long-Context — Resolved Per Feature

| Feature | Pattern | Why |
|---|---|---|
| **Chat-with-PDF** | Long-context: whole paper (extracted text, native-PDF only for complex layout) in context + prompt caching | Cross-section reasoning; cached turns ~$0.004; beats RAG after ~2 turns |
| **Semantic search** | RAG: chunk → embed → `sqlite-vec` retrieval | Library exceeds any context window; <20%-relevant queries need retrieval |
| **Metadata extraction** | Single-shot structured output (JSON schema / tool use), no retrieval | Bibliographic fields are concentrated at the document head |

They are **complementary layers sharing infrastructure**, not competitors: the embedding model + vector store built for semantic search are reused if a future "chat across my whole library" feature wants hybrid RAG→long-context. Chat-with-PDF itself never retrieves.

### F. Build vs Buy — The Gateway (AD-3 detail)

**Recommendation: self-built thin proxy**, hosted on the existing Milton-server, structured as a hexagonal core (provider adapters behind one interface). It must do: per-provider key vault · SSE pass-through · final-`usage`-chunk capture · cost calc against a maintained pricing table · atomic ledger debit · BYOK header pass-through · fallback retry list.

- **Why not SaaS:** Vercel AI Gateway = hard lock-in; OpenRouter's 5.5% purchase fee compounds; Cloudflare/Helicone can't do per-user metering. None model Milton's custom free/paid/BYOK/local credit logic.
- **Why not full self-hosted LiteLLM:** ~20 h/mo + ~$2k/mo TCO of operating it as a separate service; Milton already has a server.
- **The middle path (viable):** embed **LiteLLM as a library/router** inside the Milton-server process — get its 100+ provider adapters and (critically) its continuously-updated pricing tables for free, while keeping the credit-debit logic as Milton's own code. This is the recommended concrete shape of AD-3.

### G. BYOK Architecture (AD-7 detail)

- **Storage:** Tauri **Stronghold** plugin or the OS keychain (macOS Keychain / Windows Credential Manager / libsecret). Never plaintext, never synced to the server.
- **Flow:** desktop Rust reads the key from the keychain → calls the provider API **directly** via `reqwest`. No server hop; the key never transits Milton infrastructure.
- **Trade-off accepted:** BYOK calls bypass the gateway, so Milton has no server-side observability of them — acceptable, because a BYOK user has explicitly opted out of Milton-metered usage. The desktop still writes a local zero-cost usage row.
- **Validation:** on key entry, a cheap `count_tokens` / models-list call confirms the key works before it is saved.

### H. Data Architecture

| Data | Store | Location |
|---|---|---|
| Credit ledger (append-only) | PostgreSQL | Milton-server |
| Stripe customer / grants / meters | Stripe | external |
| Provider API keys (Milton-owned) | Secret vault / env | Milton-server |
| User BYOK keys | OS keychain / Stronghold | Milton-desktop only |
| Library embeddings (semantic search) | `sqlite-vec` extension | Milton-desktop (existing SQLite) |
| Chat-with-PDF conversations | SQLite | Milton-desktop (local — privacy default) |
| Local LLM model files (GGUF) | Filesystem | Milton-desktop, user-chosen dir |

**Principle:** money and metering are centralized server-side; *content* (library, embeddings, chats) stays local-first on the desktop. This matches the privacy positioning that makes BYOK/local meaningful.

### I. Security Architecture

- **Auth:** extend the BE-4 EdDSA-JWT broker — add a `tier` claim so the gateway enforces model-access (paid-only providers) without a DB hit. Short TTL, per-session issuance.
- **Key isolation:** Milton-owned keys never leave the server; user BYOK keys never leave the device. Two vaults, no overlap.
- **Prompt injection (OWASP #1 LLM risk):** a malicious PDF can drive expensive loops — the per-call credit *hold* + hard balance check is the billing backstop. Treat translator/PDF text as untrusted; the extraction/chat system prompts must be injection-resistant.
- **Abuse:** token-based (not request-based) rate limiting; sliding-window; signup-fraud filtering on the free tier (Stripe saw 6.2× abusive AI trial signups Nov 2025–Feb 2026).

### J. Scalability & Performance

- **Prompt caching is the scalability *and* margin lever** — chat-with-PDF is unaffordable without it; cache strategy is per-provider (Anthropic explicit breakpoints, others automatic).
- **Streaming adds zero metering latency** — ledger settle happens off the stream path (Step 3).
- **The gateway is stateless** behind the ledger DB — horizontally scalable; the Postgres ledger with `FOR UPDATE` row locks is the consistency point and the eventual bottleneck (fine well past Milton's scale).
- **Local-first semantic search scales for free** — embedding + retrieval run on the user's machine; no server cost as libraries grow.

### K. The Epic-21 Roadmap — Recommended Sequencing

7+ capabilities is too much for one release. Risk-staircase phasing (greenfield → integration → architectural), each phase independently shippable:

**Phase 1 — AI Foundation.** Server AI gateway (Claude only) · append-only credit ledger · EdDSA-JWT `tier` claim · free-tier credit grant · token metering + estimate-then-settle · **first feature: metadata extraction** (extends BE-8-8 — structured output, no streaming UI = lowest-risk consumer to prove the whole pipeline). Ships AI to all users on a free allocation.

**Phase 2 — Chat + Monetization.** **Chat-with-PDF** (long-context + caching; SSE; `@ai-sdk/svelte` `Chat`) — the table-stakes marquee feature · Stripe integration (subscription tiers + credit packs + paid-tier grant). Money starts flowing.

**Phase 3 — The Differentiators.** Multi-provider model choice (add OpenAI/Mistral/DeepSeek to the gateway) · BYOK (desktop, keychain) · local LLM (Ollama). This is the category-defining trio — highest complexity, depends on a proven Phase 1–2.

**Phase 4 — Corpus Intelligence.** Semantic search across the library (local embeddings + `sqlite-vec`). Local-first and credit-independent, so it can run as a **parallel track** from Phase 2 onward if a second developer is available.

**One open product decision** flagged for the user / the PRD: Phase 1's first feature. Recommended **metadata extraction** (lowest UI risk, proves metering). The alternative is leading with **chat-with-PDF** for faster marquee visibility, accepting the streaming-UI risk in v1.

### Architectural Patterns — Source URLs

Competitor AI landscape: https://papersflow.ai/blog/best-zotero-ai-plugins-2026 · https://blog.mendeley.com/2025/12/08/the-future-in-mendeley-ai-features-are-here/ · https://paperpile.com/blog/pdf-ai-assistant/ · https://endnote.com/blog/introducing-endnote-2025-ai-powered-reference-management/ · https://www.readcube.com/en/ai-assistant/ · https://elicit.com/pricing · https://scite.ai/pricing · https://consensus.app/pricing/ — Patterns build on the Step 2–3 sources (gateways, ledger, Stripe, Tauri, RAG/vector).

## Implementation Approaches and Technology Adoption

### Technology Adoption Strategy

Epic-21 is a multi-phase build, not a single feature — the adoption strategy *is* the 4-phase risk-staircase roadmap (§K), with **one provider first (Claude)** before the multi-provider matrix. Single-provider-first is deliberate: Phase 1 proves the ledger / metering / gateway against one well-documented provider (Claude has the best PDF + caching + `count_tokens` story) before absorbing provider-compatibility complexity in Phase 3.

**Cross-repo reality:** epic-21 spans two repositories. The AI gateway + credit ledger + Stripe integration live in **Milton-saas** (private server/desktop repo); the extension's AI client (chat trigger, metadata-extraction trigger, chat UI) lives in **milton-browser-extension** (this repo). AD-9 means the bulk of Phase 1 is server-side Milton-saas work. Epic-21 must be planned with that split explicit — likely a Milton-saas-led epic with cross-referenced milton-browser-extension stories, coordinated as BE-7 was. `[Planning-phase decision]`

### Development Workflows and Tooling

- **Externalize prompts into a registry from day one** — do not hard-code prompts; a credits platform tunes them constantly (per-feature, per-model). MLflow Prompt Registry (OSS, GUI, env aliases) or Langfuse (registry + observability bundled). Prompts version immutably (SemVer or content-hash); rollback = pointer swap, no redeploy. `[High Confidence]` — https://mlflow.org/prompt-registry , https://tianpan.co/blog/2026-03-13-prompt-versioning-change-management-production
- **Evals in CI from day one** (see Testing).
- **BMAD story flow unchanged** — epic-21 stories via the customized create-story flow; existing CI (typecheck/test/build) extended with an eval job.

### Testing and Quality Assurance

Two distinct disciplines, because epic-21 has two distinct risk surfaces:

1. **The credit ledger is money — test it like a payment system.** Concurrency tests on the `FOR UPDATE` debit path (two simultaneous requests must never both pass the balance check); idempotency-key replay tests; estimate-vs-settle reconciliation tests; Stripe webhook failure/retry tests. This is deterministic code — hard transactional testing, not eval.
2. **The AI features need LLM evals.** DeepEval + pytest is the lowest-friction CI path. Build a **golden dataset** (20–50 examples) per feature — metadata-extraction accuracy on known papers, chat-with-PDF faithfulness, semantic-search retrieval quality. Run on every PR *and* daily (daily catches silent provider model drift). LLM-as-judge (G-Eval) for subjective quality; gate deploys on thresholds. Promptfoo for multi-model comparison when evaluating a provider switch. Add every production failure to the golden dataset. `[High Confidence]` — https://www.confident-ai.com/knowledge-base/compare/best-ai-evaluation-tools-2026 , https://inference.net/content/llm-evaluation-tools-comparison/

### Deployment and Operations Practices

- **Observability:** Langfuse (self-hostable, MIT, framework-agnostic, prompt registry bundled) for traces + cost/latency/cache-hit dashboards; pair with existing infra monitoring. `[High Confidence]` — https://www.firecrawl.dev/blog/best-llm-observability-tools
- **Every AI feature ships with a kill switch** — a feature flag at 0% with a defined non-AI fallback (extraction → manual entry; chat → "unavailable"). Minimum viable safety net.
- **Canary** new model/prompt versions at 1–5% traffic with explicit rollback thresholds (hallucination rate, p95 latency, error rate).
- **Provider failover:** even single-provider Phase 1 should route through the gateway's fallback abstraction, so Phase 3 multi-provider failover is configuration, not a rewrite. OpenAI logged 294 documented outages since Jan 2025 — single-provider is an availability risk. `[High Confidence]` — https://portkey.ai/blog/failover-routing-strategies-for-llms-in-production/

### Team Organization and Skills

Milton is effectively a **solo build** (per project context, "Demandrel" is Pierre's handle, not a company; a partner handles the separate anti-captcha work). This is the single biggest planning constraint on epic-21:

- The 4-phase roadmap is **multi-month solo work.** Phasing is not a nicety — it is what makes epic-21 survivable: each phase ships standalone value, and the project can pause between phases without stranding half-built work.
- **Bias to buy / embed over build** wherever it does not compromise the custom credit logic — embed LiteLLM (AD-3), use Stripe credit-grant primitives, Langfuse off-the-shelf, Ollama for local inference. Build only the credit ledger and the metering glue — the parts no vendor does Milton's way.
- **Skill surface:** Rust/Tauri (gateway, BYOK, local inference), TS/Svelte (AI SDK chat UI), prompt engineering + evals, Stripe billing, LLM-ops. Broad — the phasing lets it be learned incrementally rather than all at once.

### Cost Optimization and Resource Management

Priority order (each tactic is already in the architecture; this ranks them by leverage):

1. **Prompt caching** — Anthropic prefix caching ≈ 90% off the static portion (the PDF, in chat-with-PDF). Non-negotiable; it *is* the margin.
2. **Model cascading** — Haiku/mini-class for metadata extraction and simple tasks; Sonnet-class for reasoning; Opus-class only for hard edge cases. A good cascade keeps the expensive tier near ~10% of calls.
3. **Batch APIs** — Anthropic and OpenAI both offer 50%-off batch endpoints; use them for non-interactive metadata-extraction pipelines (bulk re-extraction of an imported library).
4. **Output control** — structured output (JSON schema / tool use) eliminates retry loops and prose padding; explicit `max_tokens`.
5. **Semantic caching** — only if query-repetition is measurable; needs careful threshold tuning.

`[High Confidence]` — https://blog.premai.io/llm-cost-optimization-8-strategies-that-cut-api-spend-by-80-2026-guide/

### Risk Assessment and Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Credit-ledger bug mis-charges users | **High** | Append-only ledger + idempotency keys + `FOR UPDATE` + payment-grade transactional tests (AD-2) |
| Solo-dev capacity vs 4-phase scope | **High** | Strict phasing; buy/embed over build; every phase independently shippable |
| Cross-repo coordination (gateway in Milton-saas, client here) | Medium | Plan epic-21 with the repo split explicit; coordinate as BE-7 did |
| Multi-provider API churn | Medium | Embed LiteLLM — its provider adapters + pricing tables are maintained upstream |
| Prompt-injection credit drain (malicious PDF) | Medium | Per-call credit hold + hard balance check; injection-resistant system prompts |
| Local-LLM support burden (hardware variance) | Medium | Position local as "advanced/optional"; curated model list with RAM pre-checks |
| Provider outage | Medium | Gateway fallback abstraction from Phase 1; true multi-provider by Phase 3 |
| Stripe integration complexity | Medium | Use native credit-grant primitives; webhook idempotency + retry |
| Model drift silently degrades quality | Low–Med | Daily golden-dataset evals |
| CWS review flags extension AI features | Low | AI calls route through Milton-server — no new remote-code surface beyond BE-8-10's already-cleared translator path |

## Technical Research Recommendations

### Implementation Roadmap

Confirmed 4-phase sequencing (see §K for detail):

1. **Phase 1 — AI Foundation:** server AI gateway (Claude only) + append-only credit ledger + EdDSA-JWT `tier` claim + free-tier grant + metering/estimate-then-settle + **metadata extraction** (confirmed first feature — extends BE-8-8, lowest-risk pipeline proof).
2. **Phase 2 — Chat + Monetization:** chat-with-PDF (long-context + caching, SSE) + Stripe (subscription tiers, credit packs, paid grant).
3. **Phase 3 — Differentiators:** multi-provider model choice + BYOK + local LLM. The category-defining trio.
4. **Phase 4 — Corpus Intelligence:** local-first semantic search; parallel-track-capable from Phase 2 onward.

### Technology Stack Recommendations

| Layer | Recommendation |
|---|---|
| AI gateway | Self-built thin proxy on Milton-server, embedding LiteLLM as router + pricing tables |
| Orchestration SDK | Vercel AI SDK v6 — `@ai-sdk/svelte` `Chat` for UI; calls land on the Rust loopback `:7521` |
| Providers (Phase 1 → 3) | Claude (Haiku + Opus) → + OpenAI, Mistral, DeepSeek |
| Credit ledger | PostgreSQL, append-only, on Milton-server |
| Billing | Stripe — Meters API + Credit Grants + one-time invoices for packs |
| Chat-with-PDF | Long-context + Anthropic prefix caching; tiered PDF input (text extraction → native PDF → Mistral OCR) |
| Semantic search | Local: `nomic-embed-text` embeddings + `sqlite-vec` in the desktop's SQLite |
| Local LLM | Ollama (user-install → bundled sidecar); Qwen3 8B default, Phi-4-mini fallback |
| BYOK storage | Tauri Stronghold / OS keychain |
| Prompt management | MLflow Prompt Registry or Langfuse |
| Evals | DeepEval + pytest in CI; Promptfoo for model comparison |
| Observability | Langfuse (self-hosted) |

### Skill Development Requirements

New or deepening: prompt engineering + eval discipline; Stripe metered billing; LLM-ops (observability, caching, failover); Tauri sidecar / local inference. Already in hand: Rust, TS/Svelte, the extension/connector architecture. The phasing sequences the learning — Phase 1 forces ledger + prompt/eval basics; Phase 3 forces local-inference depth.

### Success Metrics and KPIs

- **Economic:** AI-feature gross margin (target ≥ 52%, the 2026 benchmark); free→paid conversion; credits consumed per active user; credit-pack attach rate.
- **Quality:** metadata-extraction accuracy on core fields (target ≥ 90%); chat-with-PDF faithfulness; hallucination rate; eval-suite pass rate in CI.
- **Performance / ops:** prompt-cache hit rate; p95 latency per feature; provider error/failover rate; kill-switch activations.
- **Adoption:** % of paid users on BYOK or local inference (validates the differentiator); AI-feature WAU; north-star — does AI move retention.

### Next Steps After This Research

This document feeds epic-21 planning. Recommended sequence: (1) a product brief / PRD for epic-21 confirming pricing (the credit `markup` multiplier, free-tier credit size, subscription tier prices); (2) `create-architecture` to ratify AD-1 → AD-9 and the repo split; (3) `create-epics-and-stories`. **CLAUDE.md Rule 1 applies** — every AI UI surface (chat panel, model picker, credits/usage view, local-model manager, BYOK settings) must trace to Figma before story-level implementation.

---

## Conclusion

Epic-21 turns Milton's AI from a single deferred feature (BE-8-8) into a platform. The research finds the direction sound and well-timed: the credits-platform shape matches where comparable 2026 products converged, and the **BYOK + multi-provider + local-LLM** trio is a genuine category position — no hosted reference manager offers it. The hard parts are not the AI features; they are the **credit ledger** (money — demands payment-grade rigor) and **solo-dev capacity** against a large scope (demands disciplined phasing). The architecture (AD-1 → AD-9), the 4-phase roadmap, and the buy-over-build bias are all aimed at making a platform-sized epic survivable for a solo builder. The contestable Charter Decision #3 is resolved (AD-9): metered AI executes server-side; the desktop owns only BYOK and local.

*Research workflow complete — 2026-05-22.*
