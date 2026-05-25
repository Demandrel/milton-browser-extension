---
title: 'Epic-21 — The Milton AI Platform — Plan Overview'
purpose: 'A single readable consolidation of the epic-21 planning chain, for Pierre to review.'
date: '2026-05-22'
revised: '2026-05-25'
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

This document is the single readable consolidation of the epic-21 planning chain. The five source documents (research, brief, PRD, architecture, epics & stories) carry the depth; this is the *narrative* for review.

> **Current as of 2026-05-25 (after two review passes).** Material decisions taken via review:
>
> 1. **AI metadata repair triggers as a fallback** — auto on PDF-ingestion paths only when deterministic capture (DOI/Crossref/translator) returned incomplete metadata, plus a manual info-panel button. Never on already-clean refs or refs without a PDF. Opt-out toggle in settings.
> 2. **Reuse Milton-desktop's existing `freemium` + `settings` modules** — Milton already ships `enforce-limit`, `limit-reached-modal`, `plan-billing-form`, `settings-modal`, and a Polar `checkout.ts`. Epic-21 plugs into them; no new UI surfaces invented.
> 3. **Chat-with-PDF is the Phase-1 marquee, not metadata repair.** Pierre's call (2026-05-25 evening) — chat is the more user-important AI feature; metadata repair is PDF-context-only and narrower. Phase 1 = chat-with-PDF + foundation; metadata repair drops to **Phase 1.5**.
>
> The PRD and architecture carry correction banners pointing here; this overview is the current view.

---

## 1. What epic-21 is — in one paragraph

Epic-21 turns Milton's AI from a single deferred feature into an **app-wide AI platform** built on an **AI-credits system** that meters every AI task in one simple unit. The MVP ships **chat-with-PDF** — the marquee feature users expect — on a free credit allocation, with the credit ledger + gateway proven on the marquee. A quick follow-up (Phase 1.5) adds **AI metadata repair** as an automatic fallback on PDF-ingestion paths. Later phases add credit-pack top-ups (Phase 2), multi-provider model choice + BYOK + local LLMs (Phase 3), and semantic search (Phase 4).

---

## 2. The idea and the bet

### The problem (two layers)

1. **The parity gap.** Researchers now expect AI inside their reference manager — chat-with-PDF, summarize, search. Competitors shipped it in 2025–26 (Mendeley, EndNote, ReadCube, SciSpace). Milton has none.
2. **The strategic gap — the real bet.** Every hosted reference manager that *has* AI locks the user into one vendor's cloud model — one provider, opaque quotas, no cost control, no offline option. No hosted reference manager offers model choice, BYOK, or local models — only Zotero *plugins* do, as a fragmented patchwork.

### The bet

Milton becomes **the reference manager with AI on your terms** — eventually the only hosted one where you pick your model, bring your own key, or run a local model. Parity is the floor; the credits-and-choice platform is the strategy.

### North-star

**AI measurably drives upgrades to Milton's paid plans.** (Milton already has paid tiers — plan_tier: free/monthly/yearly/lifetime/founder; epic-21's role is to give them an AI reason-to-upgrade.)

> Detail: `product-brief-milton-ai-platform-2026-05-22.md`

---

## 3. Who it's for

Two co-primary users, reflecting two ways people end up paying:

- **Maya — the mainstream researcher.** A PhD student who reads many papers. She wants to *understand* papers faster — pulls one open, asks "what does this methods section mean," gets a streaming answer grounded in the paper. She converts to paid when she hits the free chat allowance during a deadline crunch.
- **Daniel — the privacy/cost-conscious power researcher.** Works with confidential, unpublished material; won't paste it into a hosted AI. He uses chat-with-PDF on published material at MVP, but waits for Phase 3's BYOK/local before chatting with confidential drafts. He pays for *control*.

A secondary actor: **the operator (you)** — runs the platform safely (watch costs, verify the ledger, see whether users want more).

---

## 4. How it works

### The big picture

```
   ┌─ Browser extension ─┐     ┌─ Milton desktop app ─────────┐
   │  (Phase 1.5 — gets  │     │  Phase 1: chat-with-PDF panel │
   │   AI repair fallback│     │  Phase 1.5: AI repair on imports
   │   on capture)       │     │  Phase 3: BYOK + local        │
   └──────────┬──────────┘     └──────────┬───────────────────┘
              │  (your identity token / JWT)
              └───────────────┬────────────────────────┐
                              ▼
              ┌──────── Milton server ─────────┐
              │  AI Gateway                    │
              │   · checks who you are + tier  │
              │   · checks / reserves credits  │
              │   · calls Claude (streaming    │
              │     SSE for chat)              │
              │   · meters the real cost       │
              │  Credit Ledger (Supabase DB)   │
              │   · append-only record of      │
              │     every credit movement      │
              └───────────────┬────────────────┘
                              ▼
                        Anthropic (Claude)
```

All AI traffic funnels through **one gateway on Milton's server**. That's deliberate: it's the only place metering can be trusted, and the only place the Anthropic API key lives.

### The credit system, plainly

- AI costs real money — Milton pays Anthropic per use. **Credits** are a simple unit so cost is visible and manageable. **1 credit ≈ $0.01** of AI cost.
- **Free users** get a monthly allowance; **paid users** get more; credits reset monthly.
- Every AI action debits credits based on actual token cost (a small markup goes to Milton).
- The **ledger** is append-only — like a bank statement, never edited. The balance is the sum of entries. Idempotency keys prevent double-charges on retry; atomic updates prevent two simultaneous calls from both overspending.
- **Estimate-then-settle:** before an AI call the gateway sets aside an estimate; after the call it adjusts to the real cost. You can never overspend, even mid-stream.

### Chat with PDF — the core MVP flow

1. You open a paper in Milton-desktop's PDF viewer.
2. You open the chat panel beside it.
3. You type a question. The desktop sends it to the gateway (via the Rust loopback) with your identity token.
4. The gateway checks tier + credits, **reserves** an estimate.
5. It sends the PDF + your message + chat history to Claude with **prompt caching** enabled (the PDF + system prompt are cached after turn 1, so turns 2+ are ~10× cheaper).
6. The response **streams back token-by-token** through the gateway via SSE.
7. When the stream ends, the gateway **meters** the real cost and **settles** your ledger (off the critical path — no perceptible latency added).
8. You ask a follow-up. The conversation persists locally on your device (Milton's servers don't store chat content).
9. If credits run out mid-conversation, the existing **`limit-reached-modal`** fires (the same one Milton already uses for the PDF-analysis quota) — your history is preserved.
10. You can cancel a streaming response anytime; the ledger settles only for what actually generated.

### AI metadata repair (Phase 1.5) — a fallback, never the default

AI metadata repair fires only when (a) you import a reference *with a PDF* AND the deterministic capture path (DOI/Crossref/translator) couldn't produce clean metadata, OR (b) you click the info-panel "Improve metadata with AI" button on any reference. Never on already-clean refs. Never on refs without a PDF.

**The triggers, precisely:**
- **Automatic fallback** — PDF-ingestion paths *with* a PDF *and* incomplete deterministic capture: desktop PDF-create-from-scratch, desktop direct-PDF-URL create, extension capture with a PDF, Zotero import for refs lacking author/title.
- **Manual** — an "Improve metadata with AI" button in the info panel of any reference.
- **Opt-out** — a settings toggle disables the automatic fallback (the manual button remains).

### Where things run

| Surface | Phase 1 (chat MVP) | Phase 1.5 (metadata repair) | Phase 3 (later) |
|---|---|---|---|
| Browser extension | (no AI — extension has no PDF viewer) | AI repair fallback on capture | — |
| Milton desktop | Chat-with-PDF panel; credits view in settings | AI repair on PDF/Zotero imports + info-panel button | BYOK + local LLM |
| Milton server | Gateway + ledger + Anthropic adapter (the trustworthy core) | + metadata-repair endpoint | + multi-provider routing |

### Built on what Milton already has

Pleasant discovery during planning: **epic-21 is not greenfield.** Milton already ships most of the supporting infrastructure:

- **Server (`tools/translation-server/auth-proxy`):** identity-token verification, tier checking, rate limiting, analytics (PostHog), confidence scoring, DOI / Crossref lookup, SSRF-safe fetch — all reusable. Plus an existing usage-metering table (`pdf_analysis_usage`) that the credit ledger generalizes.
- **Desktop (`milton/src/lib/features`):** the **`freemium` module** (`enforce-limit`, `limit-reached-modal`) — tier-limit enforcement + the "you hit the limit" modal, currently used for the PDF-analysis quota. The **`settings` module** (`plan-billing-form`, `settings-modal`, Polar `checkout.ts`) — the unified settings shell + Polar checkout.

→ Implication: epic-21's client-side credits surface is overwhelmingly *integration into existing modules*, not new UI. The MVP's credits view slots into `settings-modal` next to `plan-billing-form`; AI-credits-exhaustion fires the *same* `limit-reached-modal`; Phase 2 monetization shrinks to "credit-pack SKU + extend the existing checkout flow."

---

## 5. The money side

| Decision | Choice |
|---|---|
| Tier structure | Plans **already exist** (free / monthly / yearly / lifetime / founder). Epic-21 adds AI credits as a new metered resource within them. |
| Pro price | Milton's existing paid plans (calibration: AI usage may justify pricing adjustments, but no new tier is being introduced). |
| Credit value | 1 credit ≈ $0.01 of AI cost. |
| Credit markup | ~1.5–2× provider cost — modest margin on usage atop the subscription. |
| Free allocation | Moderate — enough to make AI a habit, runs out for heavy users. Exact number calibrated against measured chat + repair cost (still open — see §10). |
| Billing platform | **Polar** — already integrated (`features/settings/checkout.ts` + `polar-webhook` edge function). |
| Phase-2 new monetization | Just **credit packs** — a new Polar SKU + a CTA in the existing `limit-reached-modal`. |

---

## 6. What gets built

### Phase 1 (MVP)

| Epic | Stories | What it delivers |
|---|---|---|
| **Epic 1 — Chat with Your PDF on a Metered Credit Foundation** | **11** | The credit ledger + gateway + Anthropic adapter + chat-with-PDF feature + freemium-integrated credits view |
| **Epic 2 — Operator Visibility & Launch Trust** | **3** | Ledger reconciliation queries; PostHog events + demand-signal metric; privacy disclosure |

**14 stories total in Phase 1.**

Epic 1's order:
| # | Story | Repo |
|---|---|---|
| 1.1 | Credit ledger foundation | Milton-saas |
| 1.2 | Reserve, settle, overspend protection | Milton-saas |
| 1.3 | Free-tier credit allocation | Milton-saas |
| 1.4 | AI gateway skeleton, auth & balance endpoint | Milton-saas |
| 1.5 | Anthropic provider adapter & metering | Milton-saas |
| 1.6 | Streaming chat endpoint with prompt caching | Milton-saas |
| 1.7 | Tiered PDF input pipeline | Milton-saas |
| 1.8 | Desktop chat-with-PDF UI | Milton-saas |
| 1.9 | Conversation persistence (local-first) | Milton-saas |
| 1.10 | Mid-stream credit handling & graceful recovery | Milton-saas |
| 1.11 | Desktop credits view + freemium integration | Milton-saas |

Note: Phase 1 is **desktop-only on the AI side.** The extension has no AI in MVP — that arrives in Phase 1.5.

### Phase 1.5

**Epic 3 — AI Metadata Repair on PDF Imports** (4 stories). Adds the metadata-repair endpoint, extension fallback at capture, desktop fallback on PDF/Zotero import + info-panel button, and the auto-AI opt-out toggle. Brings AI to the extension. Builds on Phase 1 — small once the pipeline exists.

### Phase 2

**Epic 4 — Credit Packs** (3 stories). New Polar SKU + webhook → ledger grant + "Buy more credits" CTA in `limit-reached-modal`. No new billing infrastructure.

### Phase 3 (roadmap)

Multi-provider model choice (OpenAI / Mistral / DeepSeek); BYOK; downloadable local LLMs. The category position — the only hosted reference manager with AI on your terms.

### Phase 4 (roadmap)

Local-first semantic search across the whole library.

### How we'll know the MVP worked

It can't prove the north-star (no AI-paid mechanics yet) — its job is to de-risk. Go-signals to proceed to Phase 1.5 / Phase 2:

- **Pipeline works** — credit ledger reconciles to ~0 discrepancy; estimate-then-settle holds under concurrency; streaming cancellation/disconnect handled cleanly.
- **Users value it** — meaningful share of active users open the chat panel and continue past turn 1.
- **Demand signal** — a meaningful share exhaust their free allocation and want more. The evidence Phase 2 (credit packs) will convert.

---

## 7. Key decisions to review

The architecture rests on a decision register (AD-1→AD-9):

- **AD-1** — A credit = a normalized dollar unit (~$0.01).
- **AD-2** — Append-only ledger, real-time enforcement; Polar handles invoicing.
- **AD-3** — AI gateway = small custom module on Milton's server. MVP calls Claude directly via Anthropic's **TypeScript SDK** behind a "provider-port" — *no LiteLLM* (the research's earlier suggestion was Python-only; Milton's server is TypeScript on Bun).
- **AD-4** — Where AI runs is forced by the surface: extension always through the gateway; desktop also does BYOK / local later; server owns the money.
- **AD-5 / 6** — Chat-with-PDF (Phase 1) uses long-context + prompt caching, **not** RAG. Semantic search (Phase 4) uses RAG.
- **AD-7 / 8** — BYOK and local LLMs are desktop-only (extension can't safely hold keys or run models).
- **AD-9** — A prior charter decision was overturned: metered AI must execute on the server, not in the desktop app — metering is only trustworthy server-side.

---

## 8. Corrections caught during planning

Mid-planning, inspecting the actual Milton-saas codebase caught **three wrong assumptions** the early documents had made:

1. **Billing is Polar, not Stripe.** Milton already has a live Polar webhook integration.
2. **Milton already has paid tiers.** `plan_tier` (free / monthly / yearly / lifetime / founder) exists. So epic-21 is *not* Milton's first paid tier — it's the AI feature that drives upgrades.
3. **Metadata repair + the credit ledger are not greenfield.** Milton already does GROBID-based PDF metadata analysis and already meters it via `pdf_analysis_usage`. Epic-21 is the AI evolution.

And the **Phase-1 swap** (2026-05-25): chat-with-PDF promoted to the MVP marquee; metadata repair drops to Phase 1.5.

---

## 9. Open items

Nothing blocks the start of implementation. Three things calibrate later:

1. **Free-tier credit allocation size and pricing markup** — calibrate against measured per-feature cost once Story 1.5 (metering) is in place.
2. **Figma designs** for the desktop chat-with-PDF UI (Story 1.8) and the settings credits view (Story 1.11), then later for the metadata-repair surfaces (Stories 3.2 / 3.3). CLAUDE.md Rule 1 — Figma before UI build.
3. **Cross-repo coordination** — the bulk of epic-21 lives in Milton-saas; a handoff doc (`epic-21-handoff-for-milton-saas-session.md`, alongside this overview) is the entry point for a future Milton-saas session.

---

## 10. The detailed documents

| Document | What it covers |
|---|---|
| `research/technical-milton-ai-strategy-research-2026-05-22.md` | Full technical research — providers, costs, local LLMs, RAG vs long-context, gateways, ~11 web-researched topics, cited |
| `product-brief-milton-ai-platform-2026-05-22.md` | Vision, personas, success metrics, pricing |
| `prd-milton-ai-platform-epic-21-2026-05-22.md` | 45 functional + 16 non-functional requirements, the API spec, user journeys |
| `architecture-milton-ai-platform-epic-21-2026-05-22.md` | The decision register, verified stack, project structure, the corrections |
| `epics-milton-ai-platform-epic-21-2026-05-22.md` | 4 epics, 21 stories (14 MVP + 4 Phase-1.5 + 3 Phase 2) with full acceptance criteria |
| `epic-21-handoff-for-milton-saas-session.md` | The prompt / breadcrumb for the future Milton-saas session that picks up implementation |

---

*This overview is the current authoritative summary. The PRD and architecture carry banners pointing here; their body text is a historical record of the planning workflow.*
