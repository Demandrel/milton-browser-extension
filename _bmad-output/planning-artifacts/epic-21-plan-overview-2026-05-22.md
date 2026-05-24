---
title: 'Epic-21 — The Milton AI Platform — Plan Overview'
purpose: 'A single readable consolidation of the epic-21 planning chain, for Pierre to review.'
date: '2026-05-22'
status: 'for review'
consolidates:
  - research/technical-milton-ai-strategy-research-2026-05-22.md
  - product-brief-milton-ai-platform-2026-05-22.md
  - prd-milton-ai-platform-epic-21-2026-05-22.md
  - architecture-milton-ai-platform-epic-21-2026-05-22.md
  - epics-milton-ai-platform-epic-21-2026-05-22.md
---

# Epic-21 — The Milton AI Platform
## Plan Overview (for review)

This document consolidates the full epic-21 planning chain — research, product brief, PRD, architecture, and epic/story breakdown — into one readable narrative so you can review the whole plan in one place. Each section points to the detailed document if you want to go deeper.

> **Updated 2026-05-25 after Pierre's first review.** Three review-driven changes are folded in: (1) **trigger model corrected** — AI metadata repair is a *fallback* on PDF-ingestion paths + a manual info-panel button, never an auto-bulk operation (see §4); (2) **freemium reuse** — Milton-desktop already ships `features/freemium` + `features/settings` (`limit-reached-modal`, `plan-billing-form`, Polar `checkout.ts`) — epic-21 plugs into the existing surfaces rather than inventing new UI; (3) **Phase 2 stories drafted** — chat-with-PDF (Epic 3) and credit packs (Epic 4) now have stories, since the freemium discovery shrinks Phase-2 scope enough to plan now. Original commits unchanged; corrections live in the updated docs.

---

## 1. What epic-21 is — in one paragraph

Epic-21 turns Milton's AI from a single deferred feature (the old BE-8-8 "LLM-fallback" row) into an **app-wide AI platform**. At its core is an **AI-credits system** that meters every AI task in one simple unit. The MVP ships one feature — **AI metadata repair** (AI fixes the bad/missing metadata on imported references) — on a **free credit allocation**, deliberately *before* any paid mechanics, to prove two things cheaply: that the metering pipeline is correct, and that users actually want the AI. Later phases add chat-with-PDF, paid upgrades, multi-provider model choice, bring-your-own-key, local LLMs, and semantic search.

---

## 2. The idea and the bet

### The problem (two layers)

1. **The parity gap.** Researchers now expect AI inside their reference manager — summarize, chat-with-PDF, search. Competitors shipped it in 2025–26 (Mendeley, EndNote, ReadCube, SciSpace). Milton has none.
2. **The strategic gap — the real bet.** Every hosted reference manager that *has* AI locks the user into one vendor's cloud model: one provider, opaque quotas, no cost control, no offline option. No hosted reference manager offers model choice, bring-your-own-key, or local models — only Zotero *plugins* do, as a fragmented patchwork.

### The bet

Milton becomes **the reference manager with AI on your terms** — eventually the only hosted one where you pick your model, bring your own key, or run a local model. Parity is the floor; the credits-and-choice platform is the strategy.

### North-star

**AI measurably drives upgrades to Milton's paid plans.** (Originally framed as "a converting Pro tier" — corrected once we found Milton *already* has paid plans; see §9.)

> Detail: `product-brief-milton-ai-platform-2026-05-22.md`

---

## 3. Who it's for

Two co-primary users, reflecting two ways people end up paying:

- **Maya — the mainstream researcher.** A PhD student drowning in papers. Today she pastes PDF text into a separate ChatGPT tab and loses context. She wants AI *inside* Milton — convenience. She converts to paid when she hits the free limit during a deadline crunch.
- **Daniel — the privacy/cost-conscious power researcher.** Works with unpublished, confidential material; won't paste it into a hosted AI. He wants control — his own model, his own API key, or fully local. He pays for *control*.

A secondary actor: **the operator (you)** — who needs to run the platform safely (watch costs, verify the ledger, see whether users want more).

> Detail: PRD §User Journeys.

---

## 4. How it works

### The big picture

```
   ┌─ Browser extension ─┐     ┌─ Milton desktop app ─┐
   │  "Repair metadata   │     │  "Repair metadata    │
   │   with AI" button   │     │   with AI" button    │
   └──────────┬──────────┘     └──────────┬───────────┘
              │  (your identity token / JWT)           │
              └───────────────┬────────────────────────┘
                              ▼
              ┌──────── Milton server ─────────┐
              │  AI Gateway                    │
              │   · checks who you are + tier  │
              │   · checks / reserves credits  │
              │   · calls Claude               │
              │   · meters the real cost       │
              │  Credit Ledger (Supabase DB)   │
              │   · append-only record of      │
              │     every credit movement      │
              └───────────────┬────────────────┘
                              ▼
                        Anthropic (Claude)
```

Everything AI-related funnels through **one gateway on Milton's server**. That's deliberate: it's the only place metering can be trusted, and it's the only place the Anthropic API key lives (never on your computer or in the browser extension).

### The credit system, plainly

- AI costs real money — Milton pays Anthropic per use. **Credits** are a simple unit so that cost is visible and manageable. Think **1 credit ≈ $0.01 of AI cost**.
- **Free users** get a monthly credit allowance. **Paid users** get more. Credits reset each month.
- Every AI action **debits credits** based on how much AI work it actually did.
- The **ledger** is an *append-only* record — like a bank statement, never edited, only added to. The balance is the sum of all entries. This makes it always auditable and impossible to silently corrupt. Because it handles money, it's built with payment-grade care (idempotency so retries never double-charge; atomic updates so two simultaneous actions can't both overspend).
- **"Estimate-then-settle":** before an AI call the gateway sets aside an *estimated* cost; after the call it adjusts to the *real* cost. You can therefore never overspend, even mid-action.

### What happens when you import a reference (the core flow)

**AI metadata repair is a fallback, not a default.** Deterministic methods (DOI / Crossref / translators) always run first; AI fires only when (a) those failed *and* there's a PDF involved, or (b) you click the info-panel button. It is never invoked on already-clean refs or on refs without a PDF.

A typical capture (Maya's path):

1. You click the extension's capture button on a paper — or in the desktop, you create a reference from scratch with a PDF, or paste a direct PDF URL.
2. The client tries the **deterministic capture** path first — DOI lookup, Crossref, the appropriate translator.
3. **If that returned clean metadata,** the reference saves as today — no AI call, no credits consumed.
4. **If that returned incomplete metadata AND a PDF is involved,** the client falls back to AI: it sends what it has to the gateway with your identity token.
5. The gateway checks your identity + tier, confirms you have enough credits, and **reserves** an estimate.
6. It sends the bad metadata (+ context from the PDF) to **Claude**, asking for corrected fields as structured data.
7. Claude returns corrected title / authors / DOI / year / journal, plus a **confidence level**.
8. The gateway **cross-checks** the result against Crossref / DOI where possible (reusing tools Milton already has).
9. It **meters** exactly what Claude cost, converts to credits, and **settles** your ledger.
10. Corrected metadata returns to the client; AI-fixed fields are **marked** so you can glance-verify, and the originals are kept so you can **revert**.
11. If a reference can't be confidently fixed, it's **flagged — not guessed.**
12. If you've run out of credits, the existing **`limit-reached-modal`** (already used for the PDF-analysis quota) fires; the reference still saves with whatever the deterministic path produced.

**The triggers, precisely:**

- **Automatic fallback** — PDF-ingestion paths *with* a PDF *and* incomplete deterministic capture: desktop PDF-create-from-scratch, desktop direct-PDF-URL create, extension capture with a PDF, Zotero import for refs lacking author/title.
- **Manual** — an "Improve metadata with AI" button in the info panel of any reference (any source).
- **Never** — refs already cleanly captured by deterministic methods; refs without an associated PDF (the manual button is still available on those).
- **Opt-out** — a settings toggle disables the automatic fallback (the manual button still works).

### Where things run

| Surface | Role |
|---|---|
| **Browser extension** | A thin AI client — a button + a credits display. Always talks to the gateway. |
| **Milton desktop app** | A thin AI client too. Later (Phase 3) it also hosts bring-your-own-key and local models. |
| **Milton server** | The AI gateway + the credit ledger + the money. The trustworthy core. |

### Built on what Milton already has

A pleasant discovery during planning: epic-21 is **not greenfield**. Milton already ships most of the supporting infrastructure:

- **Server (`tools/translation-server/auth-proxy`):** identity-token verification, tier checking, rate limiting, analytics, confidence scoring, DOI / Crossref lookup, SSRF-safe fetch — all reusable. Plus an *existing* usage-metering table (`pdf_analysis_usage`) that the credit ledger simply **generalizes**.
- **Desktop (`milton/src/lib/features`):** the **`freemium` module** (`enforce-limit.ts`, `limit-reached-modal.svelte`) — tier-limit enforcement and the "you hit the limit" modal, currently used for the PDF-analysis quota. The **`settings` module** (`plan-billing-form.svelte`, `settings-modal.svelte`, `checkout.ts`) — the unified settings shell + Polar checkout.

The implication: epic-21's client-side credits surface is overwhelmingly *integration into existing modules*, not new UI. The MVP client stories extend `freemium` + `settings` rather than invent new surfaces; the AI-credits-exhaustion UX **reuses the same `limit-reached-modal`** that already exists for PDF-analysis. Phase 2 monetization shrinks to "credit-pack SKU + extend the existing checkout flow."

> Detail: `architecture-milton-ai-platform-epic-21-2026-05-22.md`

---

## 5. The money side

| Decision | Choice |
|---|---|
| Tier structure | **Free + Pro** (one paid tier). Power users top up with credit packs. |
| Pro price | **~€5–8/month** (acquisition-focused). |
| Credit value | 1 credit ≈ $0.01 of AI cost. |
| Credit markup | **~1.5–2×** provider cost — a modest margin on usage on top of the subscription. |
| Free allocation | **Moderate** — enough to make AI a habit, runs out for heavy users. Exact number still to be calibrated (see §10). |
| Billing platform | **Polar** (already integrated in Milton — *not* Stripe; see §9). |

*Note:* the MVP ships **free-only** — no paid tier, no billing. Pricing is decided now so the plan is coherent, but the paid mechanics arrive in Phase 2.

---

## 6. What gets built first — the MVP (Phase 1)

### In scope

The credit ledger + metering, the AI gateway (Claude only), the free-tier allocation, **AI metadata repair**, and a minimal credits/usage display — across the browser extension and the desktop app.

### Out of scope (deliberately deferred)

Chat-with-PDF, the Pro tier + Polar billing + credit packs, multi-provider model choice, bring-your-own-key, local LLMs, semantic search. Each is a later phase.

### The 12 stories

Epic-21's MVP breaks into **2 epics, 12 stories**. They're sequenced so each depends only on earlier ones.

**Epic 1 — AI Metadata Repair on a Metered Credit Foundation** (the user feature):

| Story | What it delivers | Repo |
|---|---|---|
| 1.1 | Credit ledger foundation — the append-only ledger table + balance | Milton-saas |
| 1.2 | Reserve, settle & overspend protection — estimate-then-settle | Milton-saas |
| 1.3 | Free-tier credit allocation — the monthly grant | Milton-saas |
| 1.4 | AI gateway skeleton, auth & balance endpoint | Milton-saas |
| 1.5 | Anthropic provider adapter & metering | Milton-saas |
| 1.6 | AI metadata-repair endpoint | Milton-saas |
| 1.7 | Extension — AI repair as a capture fallback | milton-browser-extension |
| 1.8 | Desktop — AI repair on PDF/Zotero import + info-panel button | Milton-saas |
| 1.9 | Desktop settings — opt-out toggle, freemium integration, credits view | Milton-saas |

**Epic 2 — Operator Visibility & Launch Trust** (running it safely + an honest launch):

| Story | What it delivers | Repo |
|---|---|---|
| 2.1 | Operator ledger reconciliation & cost monitoring | Milton-saas |
| 2.2 | Demand-signal & anomaly monitoring | Milton-saas |
| 2.3 | Privacy disclosure & BYOK/local signposting | Milton-saas |

The first thing built is **Story 1.1 — the credit-ledger database migration.** From there the chain runs to the two client apps.

### How we'll know the MVP worked

It can't prove the north-star (no paid tier yet) — its job is to *de-risk*. Go-signals to build Phase 2:
- The ledger reconciles correctly (it's money — must be exact).
- Users value it — ~60%+ of people who try repair succeed in their first session; ~90%+ field accuracy.
- **The demand signal** — a real share of users exhaust their free allocation and want more. That's the evidence a paid tier will convert.

> Detail: `epics-milton-ai-platform-epic-21-2026-05-22.md`

---

## 7. The roadmap beyond the MVP

Epic-21 is delivered in four phases — each ships standalone value, and (important for a solo build) each can be paused or abandoned without stranding half-built work.

| Phase | What it adds | Status |
|---|---|---|
| **Phase 1 — AI Foundation** *(the MVP)* | Credit ledger + gateway + free tier + AI metadata repair | **Storied** (Epic 1 + 2, 12 stories) |
| **Phase 2 — Chat + Credit Packs** | Chat-with-PDF (streaming, long-context + caching); credit packs as a new Polar SKU (paid tiers + Polar checkout already exist) | **Storied** (Epic 3 + 4, 8 stories) |
| **Phase 3 — The Differentiators** | Multi-provider model choice (OpenAI/Mistral/DeepSeek); bring-your-own-key; downloadable local LLMs | Roadmap only |
| **Phase 4 — Corpus Intelligence** | Semantic search across your whole library | Roadmap only |

Phase 3 is the category-defining one — the trio (model choice + BYOK + local) that no hosted reference manager offers. Phase 2 is materially smaller than the original plan thought — Polar checkout and tiered plans already exist; only credit packs (a new SKU) and the chat-with-PDF feature itself are net-new.

---

## 8. Key decisions to review

The architecture rests on a decision register (AD-1→AD-9). In plain terms:

- **AD-1 — A credit = a normalized dollar unit.** The only design that can fairly price models that cost wildly different amounts.
- **AD-2 — The credit ledger is append-only**, with Milton's own real-time balance enforcement; Polar handles invoicing separately.
- **AD-3 — The AI gateway is a small custom module on Milton's server.** For the MVP it calls Claude directly via Anthropic's TypeScript SDK, behind a "provider-port" so Phase 3 can add more providers cleanly. *(Earlier research suggested LiteLLM — dropped once we confirmed the server is TypeScript, not Python.)*
- **AD-4 — Where AI runs is forced by the surface:** the extension must always go through the gateway; the desktop can also do bring-your-own-key and local later; the server owns the money.
- **AD-5/6 — Chat-with-PDF (Phase 2) will use long-context, not RAG; semantic search (Phase 4) uses RAG.** They're different tools for different jobs.
- **AD-7/8 — BYOK and local LLMs are desktop-only** (the extension can't safely hold keys or run models).
- **AD-9 — A prior charter decision was overturned:** metered AI must execute on the server, not in the desktop app — because metering is only trustworthy server-side.

> Detail: architecture doc §Core Architectural Decisions.

---

## 9. Corrections we caught during planning

Mid-planning, inspecting the actual Milton-saas codebase caught **three wrong assumptions** that the early documents had made without checking. Catching them now — in planning, not in code — is a large part of the value of preparing ahead.

1. **Billing is Polar, not Stripe.** Milton already has a live Polar integration. Every "Stripe" reference in the early docs was wrong.
2. **Milton already has paid tiers.** Free / monthly / yearly / lifetime / founder plans already exist. So epic-21 is *not* Milton's "first paid tier" — it's the AI feature that drives upgrades to the plans that already exist.
3. **Metadata repair and the credit ledger are not greenfield.** Milton already does (non-LLM, GROBID-based) PDF metadata analysis and already meters it. Epic-21 is the AI evolution of a working feature.

The research, brief, and PRD carry correction banners pointing to the architecture doc, which has the full detail.

---

## 10. What's still open — needs your input

Nothing blocks the start of implementation, but two things need real-world data or a decision before the relevant story is built:

1. **The exact free-tier credit amount** and the **precise Pro price** — both should be calibrated against *measured* per-repair cost once Story 1.5 (metering) exists. The plan fixes the *model*; the *numbers* are intentionally left for calibration.
2. **Figma designs** for the two client UIs (Stories 1.7 / 1.8) — required before those stories are built, per the project's Figma-first rule. The credits display, the repair action, and the results view all need design.

---

## 11. The detailed documents

If you want to go deeper than this overview, the five source documents (all in `_bmad-output/planning-artifacts/`):

| Document | What it covers |
|---|---|
| `research/technical-milton-ai-strategy-research-2026-05-22.md` | The full technical research — providers, costs, local LLMs, RAG vs long-context, gateways, ~11 web-researched topics, cited |
| `product-brief-milton-ai-platform-2026-05-22.md` | Vision, personas, success metrics, pricing, scope |
| `prd-milton-ai-platform-epic-21-2026-05-22.md` | 34 functional + 16 non-functional requirements, the API spec, user journeys |
| `architecture-milton-ai-platform-epic-21-2026-05-22.md` | The decision register, verified stack, project structure, the corrections |
| `epics-milton-ai-platform-epic-21-2026-05-22.md` | 4 epics, 20 stories (12 MVP + 8 Phase 2), each with full acceptance criteria |

---

*This overview is a consolidation for review — if anything here looks wrong or you want to change direction, the underlying documents can be updated to match.*
