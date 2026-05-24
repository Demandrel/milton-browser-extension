---
stepsCompleted: [1, 2, 3, 4, 5, 6]
workflowStatus: 'complete'
completedDate: '2026-05-22'
inputDocuments:
  - _bmad-output/planning-artifacts/research/technical-milton-ai-strategy-research-2026-05-22.md
  - _bmad-output/planning-artifacts/charter-v2.md
  - _bmad-output/planning-artifacts/charter.md
date: 2026-05-22
author: Pierre
workflowType: 'create-product-brief'
project: 'Milton AI Platform (Epic-21)'
---

# Product Brief: Milton AI Platform (Epic-21)

> **⚠ Correction note (added 2026-05-22, after the architecture workflow inspected the Milton-saas repo).** Three statements in this document were written on unverified assumptions and are **superseded**: (1) billing is **Polar**, not Stripe; (2) Milton **already has paid tiers** (`plan_tier` = free/monthly/yearly/lifetime/founder) — epic-21 is the AI *upgrade driver* for existing plans, not Milton's first paid tier; (3) AI metadata repair and usage metering are **not greenfield** — they evolve Milton's existing GROBID PDF-analysis and the `pdf_analysis_usage` quota. Full detail: the *Corrections to Upstream Documents* section of `architecture-milton-ai-platform-epic-21-2026-05-22.md`.

## Executive Summary

Milton — a reference manager spanning a Tauri desktop app and a Chromium browser extension — has no AI. As of early 2026, AI is table stakes in this category: Mendeley, EndNote, ReadCube, and SciSpace all shipped chat-with-PDF, summarization, and library search. Epic-21 closes that gap and builds Milton's first paid tier.

Epic-21 is an **app-wide AI platform** built on an **AI-credits system** that meters every AI task in one unit — the only design that can price model choice when models cost 30× differently. Its defining bet, which no hosted reference manager offers: **choice** — paid users pick their model across providers (Claude, OpenAI, Mistral, DeepSeek), bring their own API key, or download a local LLM that runs fully offline.

The monetization model, stated honestly: **the paid subscription is the revenue engine** (it unlocks model choice, larger allocations, BYOK, local models); credits meter usage and cap cost-of-goods; **BYOK and local reduce Milton's per-user cost to ~zero, so they de-risk the Pro tier rather than cannibalize it.**

First AI features: **AI metadata repair** (Phase 1 — fixes the bad metadata on bulk imports, a real pain no competitor solves well) → chat-with-PDF → semantic search, delivered across four phases. Parity is the floor; the credits-and-choice platform is the strategy. **North-star: a converting Pro tier. Hard constraint: this is a solo build — the "platform" is an incremental end-state, not a v1; each phase ships standalone and is independently abandonable.**

---

## Core Vision

### Problem Statement

Two problems, stacked. **(1) The parity floor** — researchers now expect AI inside their reference manager (summarize a paper, chat with a PDF, search a library by meaning); competitors shipped it in 2025–26, Milton has none. Catching up is itself substantial work, not a quick patch — which is why Milton matches the *core* table stakes (chat-with-PDF, metadata, semantic search) and deliberately skips the long tail (systematic-review automation, citation graphs). **(2) The strategic gap (the real bet)** — every hosted reference manager with AI locks the user into one vendor's cloud model: one provider, opaque per-action quotas, no cost control, no offline option. Researchers with IP-sensitive work, cost sensitivity, or a model preference have nowhere good to go.

### Problem Impact

- **Competitive erosion** — AI is now a default comparison checkbox; without it Milton loses prospects at evaluation and risks churn to AI-equipped competitors.
- **No revenue engine** — Milton has shipped capability (capture parity, CWS launch) but has no paid tier. Epic-21 is Milton's monetization surface — which is why the north-star is a *converting* Pro tier, not just "AI works."
- **A narrowing window** — competitors' AI improves each release; and because catch-up is multi-phase, the window to take the choice-and-credits position before incumbents copy it is open *now*, but not indefinitely.

### Why Existing Solutions Fall Short

- **Hosted reference managers** (Mendeley, ReadCube, SciSpace, EndNote) — AI is single-vendor, cloud-only, metered by opaque per-feature quotas ("5 questions/month"). No model choice, no BYOK, no local/offline.
- **Research tools** (Elicit, Consensus, Undermind) — powerful, but they search *public corpora*; not personal-library tools, not reference managers.
- **Zotero plugins** (Beaver, ZotAI, Aria) — the *only* place choice exists today; *signals latent demand* for BYOK/local, but delivered as a fragmented install-it-yourself patchwork, not a first-class product. *(Assumption to validate: that this latent demand is large enough to convert, not just a vocal minority — see Risks.)*

No hosted reference manager offers multi-provider choice, BYOK, or local models. That gap is Milton's opening.

### Proposed Solution

An app-wide **AI platform** with three layers:

1. **The credits spine** — a dollar-normalized credit meters every AI task. Chosen not as a "transparency" slogan but because it is the *only* unit that can price model choice (a fast model and a reasoning model cost 30× differently — a fixed "5 questions/month" quota cannot span that). Credits are surfaced to users in human terms ("~200 PDF chats left"), not raw numbers. Free tier gets a monthly allocation; paid tiers grant more; one-time packs top up.
2. **Choice** — paid users pick provider + model tier (fast vs reasoning) across Claude / OpenAI / Mistral / DeepSeek; or bring their own API key (no credits consumed); or download a local LLM that runs offline at zero cost.
3. **The features** — AI metadata repair first (proves the pipeline on a real, felt pain), then chat-with-PDF (the marquee), then semantic search across the library.

**Privacy, stated precisely** (not over-claimed): Milton's servers never store your library, embeddings, or chat history — those stay on-device. A *metered cloud call* still sends that specific document to the chosen provider, exactly as any cloud AI tool does. The **local-LLM path is the only genuinely zero-egress option** — and Milton is the only hosted reference manager that offers it.

Delivered in four phases (Foundation → Chat + Monetization → Differentiators → Corpus Intelligence) so a solo build stays survivable and each phase ships standalone value.

### Key Differentiators

1. **The only hosted reference manager with model choice + BYOK + local LLM** — a position to *take now*. It is not a permanent moat (an incumbent could copy it), but it is unclaimed today and executing it first builds the association.
2. **Credits enable choice** — one unit makes "pick any model" possible; competitors' fixed quotas cannot. Surfaced in human terms.
3. **Genuine offline privacy via local LLM** — for IP-sensitive research, the only path where nothing leaves the machine. (The cloud paths are private *of Milton*, not private *of the provider* — stated honestly.)
4. **The differentiator de-risks the business model** — BYOK and local cost Milton ~€0 per call, so they cap cost-of-goods while still being reasons to buy the paid tier. The subscription is the revenue engine; choice is what makes it worth buying.

---

## Target Users

### Primary Users

Epic-21 has **two co-primary personas**, reflecting the two conversion paths into the Pro tier.

**Maya — the mainstream researcher** *(convenience-driven; credit-revenue path)*
A 2nd-year molecular-biology PhD student. Reads 8–12 papers a week; found Milton through the browser extension and uses it to capture and organize references. **Pain:** drowning in papers — she opens ChatGPT in a separate tab, pastes chunks of a PDF for the gist, loses the figures and cross-references, and juggles tabs. She also can't re-find "that paper I read three months ago." **Goal:** understand papers faster and search her own library by meaning. **Success looks like:** "I can ask my library a question and get a real answer with the source attached." **Converts to Pro** when she hits the free credit limit mid-deadline-crunch — convenience under pressure.

**Daniel — the privacy/cost-conscious power researcher** *(choice-driven; subscription-revenue path)*
A senior R&D scientist at a biotech (or a methodologically careful independent academic). Works with unpublished data and confidential drafts; institutional policy and personal principle forbid pasting that into a hosted AI. He already runs his own Claude API key for other work and is price-aware. **Pain:** every hosted AI tool wants his documents on its cloud with no control — so he won't use them on sensitive work, and does it manually or not at all. **Goal:** AI on *his* terms — his key, or fully local, or at minimum his choice of model. **Success looks like:** "I ran chat-with-PDF on a confidential manuscript and *know* it never left my laptop." **Converts to Pro** for access to BYOK + local + model choice — he pays for *control*.

### Secondary Users

**The PI / lab lead** — doesn't use epic-21's features hands-on, but influences whether a lab standardizes on Milton. A multiplier, not a target; light-touch consideration only. Milton remains a single-user product.

### User Journey

| Stage | Maya (mainstream) | Daniel (power) |
|---|---|---|
| **Discovery** | Existing Milton user — AI announced in-app | Existing user, or finds Milton via CWS where AI choice is now part of the pitch |
| **Onboarding** | Free credits, zero setup — runs **AI metadata repair** on a messy bulk import → immediate visible win | Goes to settings *first* — plugs in his API key or downloads a local model before any cloud call |
| **Core usage** | Chat-with-PDF on the paper she's reading, daily; semantic search to re-find papers | Same features — but on his chosen model / BYOK / local |
| **Success moment** | Asks a question across her library, gets a sourced answer | Runs chat on a confidential draft, confirms it went to his own key / stayed on-device |
| **Long-term** | Hits the free allocation in crunch → upgrades to Pro | Upgrades to Pro for BYOK/local access. AI becomes the daily entry point to Milton — not just a capture tool |

---

## Success Metrics

### User Success Metrics

"This was worth it," expressed as observable behavior:

- **Activation** — a new AI user completes a first successful AI action (metadata repair, a PDF chat, or a search) in their first session. Target ≥ 60%.
- **Maya (habit)** — repeat chat-with-PDF use, ≥ 3 AI actions/week for an active AI user; "sourced answer" success — a library question returns an answer with a citation the user keeps or acts on.
- **Daniel (trust)** — a measurable share of AI usage flows through BYOK or local, proving the privacy promise is *used*, not just advertised.
- **Retention signal** — AI-adopting users retained materially better than non-AI users (tracked as a hypothesis, even though it is not the north-star).

### Business Objectives

- **3 months** (post Phase 1–2) — the Pro tier exists and is purchasable; first paying users; the credit ledger reconciles cleanly (correctness before scale). Objective: validate that *anyone* converts.
- **12 months** — healthy, growing free→paid conversion; AI gross margin holding ≥ ~52% (2026 AI-product benchmark); credit-pack attach as a secondary revenue line; epic-21 is Milton's primary monetization engine.
- **Strategic** — Milton recognized as "the reference manager with AI on your terms" — the only one with model choice + BYOK + local.

### Key Performance Indicators

| KPI | Measures | Target |
|---|---|---|
| **Free→Paid conversion** | % of free AI users upgrading to Pro | `[set in PRD]`; freemium benchmark ~2–5% |
| **AI-feature gross margin** | revenue − inference cost on metered usage | ≥ 52% |
| **AI activation rate** | % completing a first AI action in session 1 | ≥ 60% |
| **AI repeat use** | AI actions/week per active AI user | ≥ 3 |
| **BYOK/local adoption** | % of Pro users on BYOK or local within 30 days | ≥ 25% (validates the differentiator) |
| **Credit-pack attach** | % of paid users buying a top-up per quarter | `[set in PRD]` |
| **Prompt-cache hit rate** | cache hits on metered cloud calls | ≥ 70% (the margin lever) |
| **Metadata-repair accuracy** | accuracy on core bibliographic fields | ≥ 90% |
| **Ledger correctness** | credit-debit vs provider-reported cost discrepancy | ~0 (it is money) |
| **p95 latency** | per AI feature | chat first-token < ~3 s |

*Leading indicators:* activation rate + repeat use predict conversion; cache-hit rate + extraction accuracy predict margin and quality.

---

## MVP Scope

### Core Features

The MVP is **Phase 1 — AI Foundation**: the smallest release that proves AI value and the metering pipeline, deliberately shipped *before* monetization to learn cheaply.

1. **Credit ledger + metering** — server-side append-only ledger; the AI gateway (Claude-only for MVP) meters tokens and debits credits via estimate-then-settle. Invisible to users but the spine everything hangs on — and it is money, so it ships with payment-grade test coverage.
2. **Free-tier credit allocation** — every user gets a *moderate* monthly credit grant (exact number calibrated in the PRD against real metadata-repair cost). Surfaced in human terms ("X repairs left this month").
3. **AI metadata repair** — the first user-facing feature: AI fixes bad/missing metadata on imported references, especially messy bulk imports. Low-risk to build (structured output, no streaming UI), a genuine unsolved pain (competitor scan flagged it as a gap), and a complete end-to-end proof of gateway + ledger.
4. **Credits/usage surface** — a minimal in-app view of remaining credits and recent AI usage.

MVP is **Claude-only — no model choice, no BYOK, no local, no AI-paid mechanics yet** (Milton's general paid plans + Polar checkout already exist; the MVP just doesn't wire AI credits into them). Those are deliberately deferred.

### Out of Scope for MVP

- **Chat-with-PDF** — the marquee feature, but carries streaming-chat-UI risk; lands in Phase 2 on a metering pipeline the MVP already proved.
- **AI credit packs on Polar** — Phase 2 (Polar checkout + tiered plans already exist; only the credit-pack SKU + AI-credit grants are net-new). MVP ships free-only on purpose: validate users *want* the AI before wiring AI billing.
- **Multi-provider choice, BYOK, local LLM** — Phase 3. The category differentiators, but highest-complexity; need a proven Phase 1–2.
- **Semantic search** — Phase 4; a separable local-first sub-system.
- **Multi-seat / Team** — not on the roadmap; Milton stays single-user.

### MVP Success Criteria

The MVP cannot prove the north-star (no paid tier yet) — its job is to de-risk it. Go-signals to proceed to Phase 2:

- **Pipeline works** — credit ledger reconciles to ~0 discrepancy vs provider-reported cost; estimate-then-settle holds under concurrency.
- **Users value it** — AI activation ≥ 60%; metadata-repair accuracy ≥ 90% on core fields.
- **Demand signal for Pro** — a meaningful share of active AI users exhaust their moderate free allocation and/or explicitly ask for more. This is the evidence a Pro tier will convert.

If the ledger is correct and the demand signal is present → build Phase 2.

### Future Vision

Post-MVP, the four-phase roadmap (from the technical research):

- **Phase 2 — Chat + Credit Packs** — chat-with-PDF (long-context + caching); **credit-pack SKU on Polar** (Polar checkout and tiered plans already exist — net-new is the SKU + AI-credit grant logic + the "Buy more credits" CTA in the existing `limit-reached-modal`); **credits debit at a modest ~1.5–2× markup** over provider cost. This phase turns on the north-star (AI drives upgrades to existing plans + AI top-ups).
- **Phase 3 — The Differentiators** — multi-provider model choice (OpenAI, Mistral, DeepSeek added to the gateway); BYOK (desktop, OS keychain); downloadable local LLMs. The category position: the only hosted reference manager with AI on your terms.
- **Phase 4 — Corpus Intelligence** — local-first semantic search across the whole library; parallel-track-capable from Phase 2 onward.
- **Beyond** — the credits platform extends to any future AI task (summarization, writing assistance, literature-review tooling) without re-architecting.

**Pricing model locked by this brief:** Free + Pro (one paid tier) · Pro ~€5–8/mo · moderate free monthly allocation · credits debit at ~1.5–2× provider cost · power users scale via one-time credit packs. *Coherence note:* a low Pro price paired with a modest usage markup is internally consistent — the markup picks up the margin the low subscription leaves, keeping the ≥52% gross-margin KPI reachable. Exact credit counts and the precise Pro price calibrate in the PRD against measured per-feature cost.

<!-- Content will be appended sequentially through collaborative workflow steps -->
