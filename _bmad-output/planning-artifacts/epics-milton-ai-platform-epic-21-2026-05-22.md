---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: 'complete'
completedDate: '2026-05-22'
revisedDate: '2026-05-25'
inputDocuments:
  - _bmad-output/planning-artifacts/prd-milton-ai-platform-epic-21-2026-05-22.md
  - _bmad-output/planning-artifacts/architecture-milton-ai-platform-epic-21-2026-05-22.md
  - _bmad-output/planning-artifacts/product-brief-milton-ai-platform-2026-05-22.md
  - _bmad-output/planning-artifacts/research/technical-milton-ai-strategy-research-2026-05-22.md
workflowType: 'epics-and-stories'
project: 'Milton AI Platform (Epic-21)'
scope: 'MVP = Phase 1 (Chat with PDF on AI Foundation); Phase 1.5 = Metadata Repair; Phase 2 = Credit Packs'
date: '2026-05-22'
---

# Milton AI Platform (Epic-21) - Epic Breakdown

> **Re-sequenced 2026-05-25 (evening).** Chat-with-PDF promoted to the MVP marquee feature (Pierre's call: chat is the more important AI feature than metadata auto-completion). Metadata repair drops to **Phase 1.5** — the same auto-fallback model, just landing after the chat-headlined MVP. The foundation stories (ledger, gateway, metering) are unchanged. Story numbers were updated accordingly.

## Overview

This document provides the complete epic and story breakdown for the **Milton AI Platform (Epic-21)**:

- **Phase 1 (MVP)** = **Chat with Your PDF** on a metered credit foundation (Epic 1) + **Operator visibility & launch trust** (Epic 2)
- **Phase 1.5** = **AI Metadata Repair** (auto-fallback on PDF imports + manual info-panel button) (Epic 3)
- **Phase 2** = **Credit Packs** — one-time AI top-ups on the existing Polar checkout (Epic 4)

> **Cross-repo:** the AI gateway + credit ledger + desktop client live in **Milton-saas** (`~/web_dev/Milton`); the AI client lives in **milton-browser-extension** (this repo). Stories are tagged with their target repo.
>
> **Brownfield:** no scaffold/starter. The credit ledger generalizes the existing `pdf_analysis_usage` quota. Milton-desktop already ships `lib/features/freemium` + `lib/features/settings` (`limit-reached-modal`, `plan-billing-form`, Polar `checkout.ts`) — epic-21 reuses those rather than inventing new UI.

## Requirements Inventory

### Functional Requirements

**Credit Ledger & Metering**
- FR1: The system records every credit-affecting event (grant, debit, reservation, release, correction) as an immutable, individually auditable entry.
- FR2: The system computes a user's credit balance as the sum of their ledger entries.
- FR3: The system rejects any credit-affecting event whose idempotency key was already recorded.
- FR4: The system reserves an estimated credit amount before an AI call and settles it to the actual cost after.
- FR5: The system prevents a balance from going negative — a call is refused if estimated cost exceeds available balance.
- FR6: The system grants every user a recurring free-tier credit allocation that resets on a fixed monthly cycle.

**AI Gateway & Provider Integration**
- FR7: The system routes AI requests to an LLM provider (Claude for MVP) and returns the result.
- FR8: The system meters the token usage of each AI call and converts it to a credit cost.
- FR9: The system reuses cacheable prompt content across AI calls (Anthropic prompt caching) to minimize cost.
- FR10: The system records, per AI call, the model used, tokens consumed, and provider cost, linked to the user.
- FR11: The system surfaces a clear, typed error when a provider call fails.

**AI Metadata Repair** *(Phase 1.5 — see Epic 3)*
- FR12: AI metadata repair is invoked (a) **automatically as a fallback** during PDF-ingestion paths (desktop PDF-create-from-scratch, desktop direct-PDF-URL in create-ref, extension capture with a PDF, Zotero import for refs with a PDF lacking author/title) **when deterministic capture (DOI / Crossref / translator) returned incomplete metadata**; (b) **manually** via an "Improve metadata with AI" button in the info panel of any reference. It is **never** invoked automatically on references without an associated PDF, nor on references already cleanly captured by deterministic methods.
- FR13: The system returns repaired bibliographic fields for each submitted reference.
- FR14: The system marks which fields were AI-repaired, distinguishing them from original data.
- FR15: The system reports a confidence level for each repaired reference.
- FR16: The system flags — rather than guesses — references it cannot confidently repair, leaving their data unchanged.
- FR17: A user can identify and revert AI-repaired fields after a repair (original values preserved).
- FR18: The system processes bulk repair requests asynchronously and reports progress.
- FR19: The system produces a per-run summary of what was repaired, skipped, flagged, or blocked.

**Credits & Usage Experience**
- FR20: A user can see their current credit balance in human-readable terms.
- FR21: A user can see when their free allocation next resets.
- FR22: A user can view a history of their AI usage.
- FR23: The system informs the user of the credit cost/consumption of an AI action.
- FR24: When an allocation is exhausted mid-action, the system fires the existing `limit-reached-modal` (reused from the PDF-analysis quota).

**Authentication & Authorization**
- FR25: The system authenticates every AI request via a signed per-user token.
- FR26: The system attributes AI usage and credit debits to the authenticated user.
- FR27: The system enforces tier-based access rules carried in the user's token / `plan_tier`.

**Operations, Monitoring & Trust**
- FR28: An operator can view the credit ledger and reconcile credits debited against provider-reported cost.
- FR29: An operator can monitor aggregate free-tier cost (COGS).
- FR30: An operator can observe the demand signal — the share of active AI users exhausting their free allocation.
- FR31: The system detects and alerts on anomalous per-user usage spikes.
- FR32: The system enforces per-user rate limits on AI requests.
- FR33: The system discloses, in the privacy policy, that AI features send data to a third-party LLM provider.
- FR34: The product signposts that bring-your-own-key and local-model options are planned, without over-claiming current privacy.
- FR35: A user can disable automatic AI metadata repair in settings (the manual info-panel button remains available). Default: on. *(Phase 1.5)*

**Chat with Your PDF** *(Phase 1 — MVP marquee)*
- FR36: A user can open a chat panel beside a PDF and ask questions about it (desktop only at MVP — extension has no PDF viewer).
- FR37: The system streams chat responses token-by-token to the client.
- FR38: The system maintains conversation context across multiple turns within a session bound to a PDF.
- FR39: The system applies Anthropic prompt caching to the PDF + system prompt across turns.
- FR40: The system prepares each PDF using a tiered pipeline (text extraction for born-digital, native-PDF upload for complex layout, OCR fallback).
- FR41: A user can cancel a streaming response mid-stream; the ledger settles only for tokens actually generated.
- FR42: The system stores chat conversations locally on the user's device, not on Milton's servers.
- FR43: When the user removes a reference, its associated chat conversation is also removed.
- FR44: When credits would be exhausted by a chat call, the gateway returns 402 *before* opening the stream; the `limit-reached-modal` fires; conversation history is preserved.
- FR45: When a stream mid-flight exhausts the reservation, the stream terminates cleanly with a user-visible "response cut short — out of credits" message and the partial response is preserved.

### NonFunctional Requirements

- NFR1: A first chat-response token-to-first-byte completes within ~3 s p95.
- NFR2: A single-reference metadata repair completes within ~10 s p95; bulk repair runs asynchronously.
- NFR3: The credits balance / usage view loads within ~1 s.
- NFR4: Credit metering (ledger settle) happens off the user's critical path.
- NFR5: Milton's LLM-provider API key is stored server-side in a secret vault — never on a client.
- NFR6: All AI traffic is encrypted in transit (TLS).
- NFR7: Every AI request is authenticated with a signed, short-TTL per-user token.
- NFR8: The credit ledger is correct under concurrency (test-verified).
- NFR9: AI request payloads to the provider are minimized to the data the task requires.
- NFR10: GDPR — users can access and delete their AI usage data; privacy policy discloses third-party AI processing.
- NFR11: The credit ledger reconciles to ~0 discrepancy vs provider-reported cost.
- NFR12: A provider outage/error degrades gracefully — no credits debited for a failed call.
- NFR13: A client disconnect or retry mid-operation never double-charges and never silently loses a debit.
- NFR14: A partial bulk run is recoverable — completed repairs persist; the run reports what remains.
- NFR15: The gateway is stateless and horizontally scalable; the ledger (Postgres) is the consistency point.
- NFR16: New AI UI surfaces meet Milton's existing accessibility baseline.

### Additional Requirements

From the Architecture:

- **No starter/scaffold** — brownfield. First story = credit-ledger Supabase migration + gateway skeleton.
- **Two-repo delivery** — gateway + ledger + desktop client in Milton-saas; AI client in milton-browser-extension. Stories tagged by repo.
- **Credit ledger** as a Supabase migration modeled on the existing `pdf_analysis_usage` pattern (append-only, service-role RLS).
- **AI gateway** = new Bun/TS module under `tools/translation-server/ai-gateway/`, sibling to `auth-proxy`.
- **Provider integration** — Anthropic TypeScript SDK behind a `ProviderPort` interface (no LiteLLM at MVP).
- **Reuse, don't rebuild** — auth-proxy modules (`jwt-verifier`, `tier-verifier`, `rate-limiter`, `posthog`, `confidence-score`, `doi-resolve`, `crossref-title-search`, `safe-fetch`); desktop `features/freemium` (`enforce-limit`, `limit-reached-modal`) and `features/settings` (`plan-billing-form`, `settings-modal`, `checkout.ts`).
- **OpenAPI spec** authored in Milton-saas as the cross-repo contract.
- **Observability** — PostHog events (`ai_chat_message_sent`, `ai_metadata_repair_completed`, `ai_credit_debited`, etc.).
- **Privacy** — an AI-processing addendum to `PRIVACY.md`.

### FR Coverage Map

| FRs | Epic |
|---|---|
| FR1–6 (ledger), FR7–11 (gateway), FR20–24 (credits UX), FR25–27 (auth), FR32 (rate limits), **FR36–45 (chat-with-PDF)** | **Epic 1 (Phase 1)** |
| FR28–31 (operator monitoring), FR33 (privacy disclosure), FR34 (BYOK/local signposting) | **Epic 2 (Phase 1)** |
| FR12–19 (metadata repair), FR35 (auto-AI opt-out) | **Epic 3 (Phase 1.5)** |
| Forward-looking — capabilities documented in Epic-4 story ACs | **Epic 4 (Phase 2)** |

All 45 FRs mapped. Dependencies: Epic 2 depends on Epic 1's ledger; Epic 3 depends on Epic 1's gateway + ledger; Epic 4 depends on Epic 1 + Epic 3.

## Epic List

### Epic 1: Chat with Your PDF on a Metered Credit Foundation *(MVP — Phase 1)*

Milton's first AI feature, and the marquee: a desktop chat panel beside the PDF where users can ask multi-turn questions and get streaming answers grounded in the document. Long-context + Anthropic prompt caching (cheaper after turn ~2 than RAG, higher quality for single-document reasoning per AD-5). Built on the credit ledger + gateway + Anthropic adapter; reuses Milton-desktop's existing `freemium` + `settings` framework. Standalone: delivers Milton's first AI feature end-to-end, proving the credit-metering pipeline on the marquee feature.
**FRs covered:** FR1–FR11, FR20–FR27, FR32, FR36–FR45.

### Epic 2: Operator Visibility & Launch Trust *(MVP — Phase 1)*

The operator can run epic-21 safely in production — reconcile the credit ledger against provider cost, monitor free-tier COGS, watch the demand signal, catch abuse — and the launch is honest: the privacy policy discloses third-party AI processing and the product signposts planned BYOK/local options. Builds on Epic 1's ledger; delivers operator + trust value independently.
**FRs covered:** FR28–FR31, FR33, FR34.

### Epic 3: AI Metadata Repair on PDF Imports *(Phase 1.5)*

AI metadata repair fires automatically as a fallback during PDF-ingestion paths (PDF create-from-scratch, direct-PDF-URL create, extension capture with a PDF, Zotero import refs lacking author/title) **when deterministic capture (DOI / Crossref / translator) returned incomplete metadata**; or manually via an info-panel button on any reference. Never on already-clean refs, never on refs without a PDF. Small once Epic 1's pipeline + endpoint pattern exist — mostly client-side wiring + a new endpoint. Brings AI to the extension (previously AI-less at MVP).
**FRs covered:** FR12–FR19, FR35.

### Epic 4: Credit Packs — One-Time AI Top-Ups *(Phase 2)*

Lets users buy a one-time credit pack when their plan's allocation is exhausted. Plugs into Milton's *existing* `features/settings/checkout.ts` (Polar) and `polar-webhook` edge function — no new billing infrastructure, just a new SKU + redemption flow + a CTA in the existing `limit-reached-modal`.

---

## Epic 1: Chat with Your PDF on a Metered Credit Foundation *(Phase 1 — MVP)*

Stories 1.1–1.5 are the credit/gateway foundation in Milton-saas. Stories 1.6–1.10 build chat-with-PDF on top. Story 1.11 wires the credits view + freemium reuse on the desktop. Stories follow the architecture's implementation sequence — each is completable in a single dev session and depends only on earlier stories.

### Story 1.1: Credit ledger foundation

As the Milton platform,
I want an append-only `ai_credit_ledger` table with auditable balance computation,
So that every credit movement is traceable and balances cannot be silently corrupted.

**Acceptance Criteria:**

**Given** the migration is applied **When** the schema is inspected **Then** `ai_credit_ledger` exists with `event_id` (unique), `user_id` (FK `auth.users` ON DELETE CASCADE), `event_type`, `amount` (signed integer), `model`, `tokens_in`, `tokens_out`, `provider_cost_usd` (numeric), `created_at` (timestamptz) **And** service-role-only RLS and indexes modeled on `pdf_analysis_usage`.

**Given** ledger rows for a user **When** the balance is computed **Then** it equals `SUM(amount)` for that user.

**Given** an event whose `event_id` is already recorded **When** it is inserted again **Then** the insert is rejected and the balance is unchanged (idempotent — FR3).

**Given** the migration **When** re-run from any partial state **Then** it succeeds (idempotent DDL — `IF NOT EXISTS`, `DROP POLICY IF EXISTS`).

### Story 1.2: Reserve, settle, and overspend protection

As the Milton platform,
I want estimate-then-settle credit reservations with atomic debits,
So that AI calls never overspend a balance and concurrent calls cannot both pass the balance check.

**Acceptance Criteria:**

**Given** a user with balance B **When** a reservation for estimated cost E (E ≤ B) is requested **Then** a `reservation` row (−E) is written and the available balance becomes B−E.

**Given** an open reservation **When** the call completes with actual cost A **Then** a `release` (unused estimate) and a `debit` (−A) settle it; if A exceeds the reservation a `correction` is written.

**Given** a user with balance B **When** a reservation for E > B is requested **Then** it is refused and no row is written (FR5).

**Given** two concurrent reservations against the same balance **When** both run **Then** they are serialized by `SELECT … FOR UPDATE` and the balance never goes negative (NFR8 — test-verified).

**Given** a failed AI call **When** settle runs **Then** the reservation is fully released and no `debit` is recorded (NFR12).

### Story 1.3: Free-tier credit allocation

As a Milton user,
I want a monthly free allocation of AI credits,
So that I can use AI features without paying, up to a fair limit.

**Acceptance Criteria:**

**Given** a user **When** a new monthly cycle begins **Then** a `grant` row for the configured free allocation is written for that user.

**Given** a user mid-cycle **When** they query their balance **Then** it reflects the current cycle's grant minus consumption **And** the next reset date is derivable.

**Given** the free allocation amount **When** configured **Then** it is a single named constant, calibrated against measured chat + metadata-repair cost (per the PRD).

### Story 1.4: AI gateway skeleton, auth & balance endpoint

As a Milton user,
I want an authenticated AI gateway that knows who I am and my tier,
So that AI requests are securely attributed to me and my balance is queryable.

**Acceptance Criteria:**

**Given** the `ai-gateway` module **When** it starts **Then** it runs as a Bun service sibling to the auth-proxy.

**Given** a request with a valid EdDSA-JWT **When** the gateway verifies it (reusing the auth-proxy `jwt-verifier`) **Then** the request is attributed to the JWT subject; an invalid/expired token returns 401.

**Given** an authenticated request **When** the gateway resolves the user's tier **Then** it reads `plan_tier` (from the JWT if present, else Supabase `app_metadata`).

**Given** `GET /v1/ai/balance` **When** called by an authenticated user **Then** it returns the current balance, tier, and free-allocation reset date.

**Given** a user exceeding the per-user rate limit **When** they call the gateway **Then** they receive 429 (reusing the auth-proxy `rate-limiter` — FR32).

### Story 1.5: Anthropic provider adapter & metering

As a Milton user,
I want the gateway to call Claude and meter exactly what it costs,
So that my credits are debited accurately for the AI work done.

**Acceptance Criteria:**

**Given** a `ProviderPort` interface **When** the Anthropic adapter implements it **Then** every provider call goes through the port — no provider-specific code outside the adapter.

**Given** a completed Claude call **When** metering runs **Then** prompt + completion tokens and provider cost are captured and converted to a credit cost via the documented mapping (1 credit = $0.01, configured markup).

**Given** cacheable prompt content **When** repeated calls are made **Then** Anthropic prompt caching is applied (FR9).

**Given** any AI call **When** it completes **Then** a ledger-linked record captures model, tokens, and provider cost (FR10).

**Given** a provider error **When** it occurs **Then** the gateway returns a typed error and no credits are debited (FR11, NFR12).

### Story 1.6: Streaming chat endpoint with prompt caching

As a Milton user,
I want a streaming AI chat endpoint that understands a PDF and remembers our conversation,
So that I can ask multi-turn questions about a paper and get fast, grounded answers.

**Acceptance Criteria:**

**Given** `POST /v1/ai/chat` with a PDF reference + a user message + a conversation id **When** called **Then** the gateway opens an SSE stream to the client; streams Claude's response token-by-token; passes the PDF + chat history with Anthropic prompt caching enabled (FR37, FR38, FR39).

**Given** a multi-turn conversation **When** turn 2+ runs **Then** the static prefix (system prompt + PDF) is cache-read at ~10% of base cost (Anthropic 90% cache discount applied).

**Given** the stream completes **When** the final usage chunk arrives **Then** the gateway settles the ledger with the actual token cost (estimate-then-settle for streaming via standalone reserve/settle endpoints introduced in this story).

**Given** a stream in progress **When** the client disconnects **Then** the gateway captures partial-stream tokens and settles for what was actually generated — no double-charge on retry (idempotency key — FR41).

### Story 1.7: Tiered PDF input pipeline

As the Milton platform,
I want a tiered PDF-to-Claude pipeline that picks the cheapest sufficient approach per document,
So that simple PDFs cost less and complex layouts still get accurate handling.

**Acceptance Criteria:**

**Given** a born-digital, single-column PDF **When** prepared for chat **Then** text extraction (the existing PDF-text path or Marker-PDF locally) is used; extracted text is sent to Claude (FR40).

**Given** a complex-layout PDF (multi-column / heavy equations / scanned) **When** prepared for chat **Then** native PDF upload to Claude is used (vision tokens accepted for layout fidelity).

**Given** a scan that text-extraction fails on **When** prepared **Then** OCR via Mistral OCR (or local Marker-PDF) is the fallback (architecture AD-5).

**Given** any PDF **When** prepared once for a conversation **Then** the prepared form is reused across all turns — no re-prep per message.

### Story 1.8: Desktop chat-with-PDF UI

As a researcher reading a PDF in Milton-desktop,
I want a chat panel beside the PDF where I can ask questions about it,
So that I can quickly understand a paper without leaving the app.

**Acceptance Criteria:**

**Given** the PDF viewer is open on a reference **When** I open the chat panel **Then** a new chat session is started bound to that PDF (FR36).

**Given** the chat panel is open **When** I send a message **Then** the response streams in token-by-token via `@ai-sdk/svelte`'s `Chat` class targeting the Rust loopback (which proxies to `/v1/ai/chat`).

**Given** a streaming response in progress **When** I cancel **Then** the stream stops and the ledger settles for tokens actually generated (FR41).

**Given** the chat panel **When** open **Then** I see remaining credits and the model in use (Claude for Phase 1).

**Given** the new UI **When** reviewed **Then** visual design is per Figma; meets the existing accessibility baseline.

### Story 1.9: Conversation persistence (local-first)

As a researcher,
I want my chat conversations saved on my device alongside the PDF,
So that I can return to a conversation and the cloud doesn't store my interactions.

**Acceptance Criteria:**

**Given** a chat session **When** I send/receive messages **Then** the conversation is persisted locally in the desktop's SQLite (FR42).

**Given** a saved conversation **When** I reopen the PDF later **Then** I can resume in context.

**Given** a deleted reference **When** I remove it **Then** its associated conversation is also removed (FR43).

**Given** Milton's servers **When** inspected **Then** they do not store chat content (server logs only token counts/costs for metering — NFR9 data minimization).

### Story 1.10: Mid-stream credit handling & graceful recovery

As a Milton user,
I want chat to handle running out of credits mid-conversation gracefully,
So that I don't lose context and I know what's happening.

**Acceptance Criteria:**

**Given** I'm mid-conversation **When** my next message would put me over the available balance **Then** the gateway returns 402 *before* opening the stream; the existing `limit-reached-modal` fires; conversation history is preserved (FR44).

**Given** a long response that mid-stream exhausts the reservation **When** it happens **Then** the stream terminates cleanly with a user-visible "response cut short — out of credits" message; the partial response is preserved (FR45).

**Given** a provider error mid-stream **When** it happens **Then** the user sees a typed-error message; the ledger settles only for tokens actually generated (FR11, NFR12).

### Story 1.11: Desktop credits view + freemium integration

As a Milton user,
I want to see and manage my AI credits inside the existing settings surface,
So that credits feel like part of the app, not a bolt-on.

**Acceptance Criteria:**

**Given** I'm in `settings-modal` **When** I look at AI **Then** my credits view (balance, reset date, recent usage) is shown adjacent to `plan-billing-form` (FR20, FR21, FR22) — slotted into the existing settings shell, not a separate surface.

**Given** my free AI allocation is exhausted **When** any AI call would fire **Then** the existing `lib/features/freemium/components/limit-reached-modal.svelte` is reused — extended to recognize AI credits as the limited resource (FR24); no new exhaustion modal is built.

**Given** the integration **When** reviewed **Then** it reuses `lib/features/freemium/utils/enforce-limit.ts` for tier-limit logic rather than reimplementing.

---

## Epic 2: Operator Visibility & Launch Trust *(Phase 1 — MVP)*

Lets the operator run epic-21 safely and ships an honest launch. All three stories are Milton-saas. Builds on Epic 1's ledger and PostHog instrumentation.

### Story 2.1: Operator ledger reconciliation & cost monitoring

As the Milton operator,
I want to reconcile the credit ledger against provider cost and watch free-tier COGS,
So that I can trust the ledger and know what AI is costing.

**Acceptance Criteria:**

**Given** the ledger **When** I run the reconciliation query **Then** credits debited reconcile to ~0 discrepancy against recorded `provider_cost_usd` (NFR11 — FR28).

**Given** a time window **When** I query free-tier COGS **Then** aggregate provider cost for free-tier users is reported (FR29).

**Given** the MVP **When** the operator surface is delivered **Then** it is a documented set of Supabase SQL queries — no custom operator UI.

### Story 2.2: Demand-signal & anomaly monitoring

As the Milton operator,
I want PostHog events and a demand-signal metric,
So that I can see whether users want more than the free tier and catch abuse.

**Acceptance Criteria:**

**Given** an AI action **When** it completes **Then** a PostHog event (`ai_chat_message_sent`, `ai_credit_debited`, …) is emitted with the relevant properties.

**Given** a period **When** I check the demand signal **Then** the share of active AI users who exhausted their free allocation is reported (FR30).

**Given** anomalous per-user usage spikes **When** they occur **Then** an alert is raised (FR31).

### Story 2.3: Privacy disclosure & BYOK/local signposting

As a privacy-conscious researcher,
I want honest disclosure of how Milton's AI handles my data,
So that I can make an informed choice about using it.

**Acceptance Criteria:**

**Given** the privacy policy **When** epic-21 ships **Then** it includes an AI-processing addendum stating AI features send PDF content / reference data to a third-party LLM provider (Anthropic), citing Anthropic's no-training API terms (FR33).

**Given** the product **When** a user views the AI settings/docs **Then** it signposts that bring-your-own-key and local-model options are planned, without over-claiming current privacy (FR34).

**Given** the disclosure copy **When** written **Then** it does not claim metered cloud calls are private of the provider.

---

## Epic 3: AI Metadata Repair on PDF Imports *(Phase 1.5)*

Adds AI metadata repair as a fallback in ingestion paths (auto on PDF imports when deterministic capture failed) plus a manual info-panel button. Brings AI to the extension (which has no AI at MVP). Builds on Epic 1's gateway + ledger; only adds one endpoint and client-side wiring.

### Story 3.1: AI metadata-repair endpoint

As a Milton user,
I want to send references to the gateway and get corrected metadata back,
So that my bad bibliographic data is fixed by AI.

**Acceptance Criteria:**

**Given** `POST /v1/ai/metadata-repair` with one reference **When** called **Then** it runs synchronously (reserve → Claude structured-output repair → settle), returning repaired fields with a per-field `ai_repaired` marker and a per-reference confidence level.

**Given** a reference the model cannot confidently repair **When** processed **Then** it is flagged low-confidence and its data is returned unchanged — never a guess (FR16).

**Given** a bulk batch **When** submitted **Then** it processes asynchronously with a job id + progress, and a per-run summary reports repaired / skipped / flagged / limit-blocked counts (FR18, FR19).

**Given** repaired output **When** available **Then** it is validated against Crossref/DOI where possible (reusing `doi-resolve` / `crossref-title-search` / `confidence-score`).

**Given** `GET /v1/ai/usage` **When** called **Then** it returns the user's AI usage history (FR22).

**Given** a user with insufficient credits **When** they request repair **Then** they receive 402 and no provider call is made.

### Story 3.2: Extension — AI repair as a capture fallback

As a researcher using the Milton browser extension,
I want AI to silently fill in metadata when the deterministic capture path can't,
So that papers from unsupported sites still capture with clean references in one click.

**Acceptance Criteria:**

**Given** I trigger an extension capture **When** the deterministic path (translator / DOI / Crossref) returns complete metadata **Then** the capture saves as today — AI is **not** invoked (FR12 negative case).

**Given** I trigger an extension capture on a paper-with-PDF context **When** the deterministic path returns incomplete metadata **Then** the extension calls `/v1/ai/metadata-repair` as a fallback with what it has, then saves the reference with AI-marked fields (cases a + c — FR12).

**Given** a completed AI fallback **When** the ref is saved **Then** AI-repaired fields are visibly marked in the popup confirmation and the pre-fallback values are preserved (FR14, FR17).

**Given** the popup is open **When** I look at it **Then** my AI credit balance + reset date are shown (FR20, FR21, FR23).

**Given** my free allocation is exhausted **When** an AI fallback would fire **Then** the gateway returns 402; the extension surfaces a popup-appropriate exhaustion message (FR24); the reference still saves with whatever the deterministic path produced.

**Given** the new UI **When** reviewed **Then** it meets the existing extension accessibility baseline (NFR16) and carries SPDX/AGPL headers.

### Story 3.3: Desktop — AI repair on PDF/Zotero import + info-panel button

As a researcher using the Milton desktop app,
I want AI to silently improve metadata when I add a PDF or import a messy reference, and to be able to trigger it manually on any reference,
So that messy refs get cleaned without me thinking about it, and I always have an explicit fix-it option.

**Acceptance Criteria:**

**Given** I create a new reference from scratch with a PDF OR add a direct PDF URL in "create a ref" **When** the deterministic path returns incomplete metadata **Then** AI repair fires automatically, returning corrected fields with AI marks applied (FR12 — auto fallback).

**Given** I run a Zotero import **When** a reference has a PDF but lacks author/title **Then** AI repair fires automatically on that reference (case d — FR12); refs with clean metadata are not touched.

**Given** an existing reference (any source) **When** I open its info panel and click "Improve metadata with AI" **Then** the desktop calls `/v1/ai/metadata-repair` and applies/marks the result (case b — FR12 manual).

**Given** a PDF-ingestion context **When** the deterministic path produced clean metadata **Then** AI repair is **not** invoked (FR12 negative).

**Given** any AI repair completes **When** shown **Then** AI-repaired fields are marked and revertible (FR14, FR17); a per-run summary is shown for bulk imports (FR19).

**Given** the new UI surfaces **When** reviewed **Then** they meet Milton's existing accessibility baseline (NFR16) — visual design per Figma at story-build time.

### Story 3.4: Auto-AI-repair opt-out toggle

As a Milton user,
I want a settings toggle to disable automatic AI metadata repair,
So that I'm in control of my AI spend.

**Acceptance Criteria:**

**Given** `settings-modal` is open **When** I navigate to AI settings **Then** I see a toggle "Automatically improve metadata with AI on imports" (default on — FR35).

**Given** the toggle is OFF **When** I trigger an import that *would* have fired AI repair **Then** AI is not invoked; the reference saves with whatever deterministic data exists (the manual info-panel button still works regardless).

---

## Epic 4: Credit Packs — One-Time AI Top-Ups *(Phase 2 — forward-looking)*

Lets users buy a one-time top-up when their plan's allocation is exhausted. Plugs into Milton's *existing* `features/settings/checkout.ts` (Polar) and `polar-webhook` edge function — no new billing infrastructure, just a new SKU + the redemption flow + a CTA in the existing `limit-reached-modal`.

### Story 4.1: Credit-pack SKU + checkout flow

As a Milton user,
I want to buy a one-time credit pack when I need more AI than my plan includes,
So that I'm not blocked mid-task by an exhausted allocation.

**Acceptance Criteria:**

**Given** a credit-pack SKU is configured in Polar **When** the user picks a pack **Then** the desktop client redirects to Polar checkout via the existing `lib/features/settings/utils/checkout.ts` flow.

**Given** the existing checkout flow **When** extended for packs **Then** the only changes are (a) a new product type and (b) the success-callback variant — no parallel billing path.

**Given** several pack sizes (e.g. small / medium / large) **When** the user picks one **Then** the Polar checkout reflects the chosen pack's price (calibrated against measured per-feature cost).

### Story 4.2: Pack-purchase webhook → ledger grant

As the Milton platform,
I want a successful credit-pack purchase to immediately credit the user's ledger,
So that they can use their new credits within seconds of paying.

**Acceptance Criteria:**

**Given** the existing `polar-webhook` Supabase edge function **When** it receives a pack-purchase event **Then** it writes a `grant` row to `ai_credit_ledger` with a stable idempotency key derived from the Polar event id (no double-credit on webhook retry).

**Given** a purchase **When** the grant lands **Then** the user's next `/v1/ai/balance` reflects it.

**Given** a refund/chargeback **When** the webhook signals it **Then** a `correction` row is written (negative amount); the balance adjusts accordingly.

### Story 4.3: "Buy more credits" CTA in limit-reached-modal

As a Milton user who just hit my AI limit,
I want to buy more credits without leaving the modal,
So that I can keep working.

**Acceptance Criteria:**

**Given** the existing `limit-reached-modal` fires for AI credits **When** Polar credit packs are configured **Then** the modal shows a "Buy more credits" CTA alongside the existing "Upgrade plan" option.

**Given** I click "Buy more credits" **When** I complete checkout **Then** the modal updates to "Credits added" and dismisses; my original action (chat message / capture) can be retried.

**Given** a paid-tier user already at the highest plan **When** they hit the limit **Then** the modal offers credit packs prominently (since upgrade isn't an option).
