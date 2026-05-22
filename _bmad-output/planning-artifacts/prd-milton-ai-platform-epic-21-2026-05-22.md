---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
workflowStatus: 'complete'
completedDate: '2026-05-22'
classification:
  projectType: 'desktop_app + api_backend (brownfield; epic-21 adds a metered backend service to the Milton desktop app + browser extension)'
  domain: 'general — research-productivity software'
  complexity: 'medium'
  projectContext: 'brownfield'
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-milton-ai-platform-2026-05-22.md
  - _bmad-output/planning-artifacts/research/technical-milton-ai-strategy-research-2026-05-22.md
  - _bmad-output/planning-artifacts/charter-v2.md
  - _bmad-output/planning-artifacts/charter.md
documentCounts:
  briefs: 1
  research: 1
  brainstorming: 0
  projectDocs: 2
workflowType: 'prd'
project: 'Milton AI Platform (Epic-21)'
prdScope: 'MVP = Phase 1 (AI Foundation)'
author: Pierre
date: 2026-05-22
---

# Product Requirements Document - Milton AI Platform (Epic-21)

**Author:** Pierre
**Date:** 2026-05-22

> **Scope:** This PRD covers the **MVP = Phase 1 (AI Foundation)** of epic-21. Later phases (chat-with-PDF, monetization, multi-provider/BYOK/local, semantic search) appear as roadmap context only. Built on `product-brief-milton-ai-platform-2026-05-22.md` and `research/technical-milton-ai-strategy-research-2026-05-22.md`.
>
> **Classification:** brownfield · desktop_app + api_backend · domain general (research-productivity) · complexity medium (money-handling credit ledger + multi-provider LLM integration).

---

## Success Criteria

### User Success

MVP (Phase 1) user success centres on **AI metadata repair** delivering a felt win:

- A user runs metadata repair on imported references and gets correct title / authors / DOI / year / journal back — a messy library visibly cleaned in one action ("aha" moment).
- **Activation ≥ 60%** — users who try metadata repair complete a successful repair in session 1.
- **Repair accuracy ≥ 90%** on core bibliographic fields.
- The credits surface is legible — users understand "X repairs left" without confusion.

### Business Success

- **3-month (MVP era):** AI shipped to all users on a free allocation; the credit ledger reconciles cleanly; a measurable **demand signal** — users exhausting their free allocation — which is the go-signal for Phase 2 monetization.
- **12-month (post-MVP):** the Pro tier converts at a healthy rate; AI gross margin ≥ 52%. *(The north-star — realized after Phase 2.)*
- The MVP's business job is narrow and deliberate: **de-risk monetization cheaply** — prove users want the AI before building Stripe.

### Technical Success

- **Credit ledger correctness** — ~0 discrepancy between credits debited and provider-reported cost; append-only + idempotent + atomic debit verified under concurrency. *(The medium-complexity driver — it is money.)*
- **Estimate-then-settle holds** — no overspend past the free allocation under streaming/concurrent load.
- **Gateway** — metadata-repair calls succeed; structured output parses first-try; prompt caching engaged where applicable.
- **Latency** — a single-reference repair completes in an interactive window (target p95 < ~10 s); bulk repair runs async.
- **Clean cross-repo integration** — extension/desktop AI client ↔ Milton-server gateway over the EdDSA-JWT auth; no IPC-boundary violations (no direct Milton-desktop imports).

### Measurable Outcomes

| Outcome | Target |
|---|---|
| AI activation (first repair, session 1) | ≥ 60% |
| Metadata-repair accuracy (core fields) | ≥ 90% |
| Ledger discrepancy vs provider cost | ~0 |
| Single-reference repair p95 latency | < ~10 s |
| Free-allocation exhaustion rate | *measured — the demand signal* |

*(Product scope, the MVP boundary, and full phasing are defined in **Project Scoping & Phased Development** below — consolidated there during document polish to remove duplication.)*

---

## User Journeys

### Journey 1 — Maya cleans up a messy import *(primary success path)*

Maya bulk-imports 60 references from an old EndNote export. Half have garbled titles, missing DOIs, "Anonymous" authors — she is *not* going to hand-fix 60 entries. She spots a **"Repair metadata with AI"** action; a banner shows she has free AI credits. She selects the messy references and runs it — a progress indicator, credits ticking down in human terms ("48 repairs left"). **Climax:** the references come back correct — titles, authors, DOIs, journals, years — each repaired field subtly marked so she can glance-verify. Her library is clean in under a minute; she trusts Milton's AI and wonders what else it can do.
→ *Reveals:* bulk-select + repair action (desktop + extension), the gateway→extraction pipeline, structured-output field mapping, a credits surface, per-field "AI-repaired" marking, the free-tier grant.

### Journey 2 — Maya hits a limit and a low-confidence case *(edge case / recovery)*

Weeks later, mid deadline-crunch, Maya runs repair on another big import. Partway through, her free monthly allocation runs out — the run **pauses, doesn't crash**: "You've used this month's free AI credits — they reset on [date]." (No Pro tier at MVP, so the message is honest — a reset date, not an upsell.) One reference is a preprint with almost no metadata — the AI returns **low confidence and flags it rather than guessing**. **Climax:** instead of silent wrong data, Maya sees exactly what happened — repaired, skipped, limit-reached. She finishes what she can, knows when credits return, and the flagged reference is left untouched.
→ *Reveals:* graceful allocation-exhaustion (pause not fail), clear reset messaging, low-confidence handling (flag, never guess), partial-run reporting, estimate-then-settle (no mid-run overspend).

### Journey 3 — Daniel, the power user, MVP-constrained

Daniel installs the update and runs repair on his *published, public* references — works well, he's impressed. But he has a folder tied to an unpublished collaboration; at MVP it's Claude-only via Milton's gateway — no BYOK, no local. **Climax:** Daniel deliberately does *not* run AI on the sensitive folder — and Milton is **honest about it** (settings/docs signpost "coming: your own key, local models"). He gets real value on public references, and becomes a waiting, motivated Phase-3 prospect — the MVP earned trust without overpromising.
→ *Reveals:* the MVP must not over-claim privacy; an honest "coming soon" signpost for BYOK/local; the same pipeline serves him; confirms Phase-3 demand.

### Journey 4 — Operator (Pierre) watches the ledger and the demand signal

Epic-21 is live; every user is on a free allocation; Pierre pays Anthropic for all of it. He checks an **operator view**: credits debited vs Anthropic's reported cost reconcile to ~zero; free-tier COGS is within envelope; no runaway usage. **Climax:** over weeks he watches the **demand signal** — the share of active AI users exhausting their free allocation climbs. The ledger is provably correct *and* a real fraction of users want more — the evidenced go-signal to build Phase 2.
→ *Reveals:* an operator view of the ledger, cost-reconciliation tooling, free-tier COGS monitoring, the demand-signal metric, abuse/anomaly alerting.

*(No API-consumer journey — epic-21 exposes no public API; the only integration is the internal extension/desktop ↔ gateway path, handled as a technical concern.)*

### Journey Requirements Summary

| Capability area | Revealed by |
|---|---|
| Metadata repair — bulk-select + run, per-field "AI-repaired" marking, low-confidence flagging | J1, J2, J3 |
| Credits — free monthly grant, human-readable surface, estimate-then-settle, graceful exhaustion | J1, J2 |
| Credit ledger — append-only, idempotent, atomic debit, cost reconciliation, operator view | J2, J4 |
| Trust/honesty — no privacy over-claim, "coming soon" BYOK/local signpost | J3 |
| Ops — demand-signal metric, COGS monitoring, abuse/anomaly alerting | J4 |

---

## Domain-Specific Requirements

Milton is a **non-regulated domain** (research-productivity software) — no HIPAA / PCI-DSS / DO-178C-class compliance. The "medium" complexity is technical (money-handling ledger, multi-provider integration), not regulatory. Two domain concerns are genuinely relevant to the MVP:

### Compliance & Regulatory

- **GDPR / data protection** — epic-21 introduces a new data flow: AI metadata repair sends reference metadata to a third-party LLM provider (Anthropic). The MVP must (a) disclose this AI processing in the privacy policy — the existing `PRIVACY.md` (from BE-8-10) needs an AI-processing addendum; (b) establish a lawful basis; (c) cite Anthropic's API terms (no training on API inputs) as a processing safeguard.
- **Payments** — out of MVP scope (Stripe arrives Phase 2). When it lands, card data stays in Stripe's PCI scope — Milton never handles raw card data.
- The credit ledger stores per-user usage + balance (personal data tied to an account) — standard GDPR handling: user access and deletion.

### Technical Constraints

- **Ledger security & correctness** — money-adjacent; append-only, idempotent, atomic debit (the medium-complexity driver).
- **Auth** — reuse the EdDSA-JWT broker; the gateway verifies every call.
- **Secret handling** — Milton's Anthropic API key is server-side only, never in a client bundle.
- **Data minimization** — send the provider only what a repair needs (the existing/garbled metadata + minimal context), never the user's whole library.

### Integration Requirements

- MVP is internal-only: extension/desktop AI client ↔ Milton-server gateway (over JWT); gateway ↔ Anthropic API. No public/external API.

### Risk Mitigations

- Third-party LLM data exposure → privacy-policy disclosure + Anthropic no-training API terms + data minimization.
- Credit-drain via prompt injection in garbled metadata → per-call credit hold + hard balance enforcement.
- Ledger correctness → payment-grade transactional testing.

---

## Backend & Platform Specific Requirements

### Project-Type Overview

Epic-21's MVP is dominantly an **api_backend** build: the AI gateway + credit ledger on Milton-server, with thin first-party clients on the Tauri desktop app and the browser extension. The API is **internal-only** (no public/third-party consumers) — but it must still be specced with API rigor: it is the contract between two repos (Milton-saas server ↔ milton-browser-extension client) and it handles money.

### Technical Architecture Considerations

- Hexagonal gateway core on Milton-server; provider adapters (Claude for MVP) behind one interface; embeds LiteLLM for routing + pricing tables (AD-3).
- Append-only credit ledger in PostgreSQL; stateless gateway → horizontally scalable; the `FOR UPDATE`-locked ledger row is the consistency point.
- Reuses the existing EdDSA-JWT broker (BE-4).

### API Endpoints

Internal API, versioned `/v1/ai/...`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/ai/balance` | GET | current credit balance, tier, allocation reset date |
| `/v1/ai/metadata-repair` | POST | submit reference(s) for repair; returns repaired structured metadata + per-field confidence; debits credits via internal reserve→settle |
| `/v1/ai/usage` | GET | per-user usage history (feeds the credits/usage UI) |

Single-reference repair is synchronous; bulk repair accepts a batch and runs **async** (job id + poll). Reserve→call→settle is internal to the gateway for the MVP's single-feature shape — the research's standalone `/reserve` + `/settle` endpoints become relevant when Phase 2's streaming chat arrives.

### Authentication Model

EdDSA JWT from the connector's `/auth/issue-token` (BE-4 pattern), extended with a `tier` claim (`free` for MVP). The gateway verifies the signature, attributes usage to the JWT subject, debits that user's ledger. Short TTL. Milton's Anthropic key lives in a server-side secret vault only.

### Data Schemas

- **Ledger entry** (append-only): `event_id` (unique idempotency key), `user_id`, `amount` (signed credits), `type` (grant｜debit｜reservation｜release｜correction), `model`, `tokens_in/out`, `provider_cost_usd`, `created_at`. Balance = `SUM(amount)`.
- **Repair request**: array of references — each with current (garbled) fields + a stable reference id.
- **Repair response**: per reference — repaired fields, per-field confidence, per-field `ai_repaired` flag, `low_confidence` flag; plus credits debited.

### Error Codes

| Code | Meaning | Client behavior |
|---|---|---|
| 401 | invalid/expired JWT | re-issue token |
| 402 | insufficient credits | "free credits used, resets [date]"; pause bulk run |
| 422 | unrepairable / too little metadata | flag reference low-confidence, leave untouched |
| 429 | rate limited | back off + retry |
| 503 | provider unavailable | retry (Phase 3 adds failover) |

### Rate Limits

Primary throttle is the **credit balance check** (no credits → no call). Plus token-based per-user RPM/TPM at the gateway (sliding window) + anomaly alerting on usage spikes.

### API Documentation

Internal API — maintain an **OpenAPI spec** as the cross-repo contract. No public developer docs (no external consumers).

### Client Surface (desktop_app side — thin)

Desktop (Tauri/Svelte) + extension: the "Repair metadata with AI" action and a minimal credits/usage view. Inherits Milton's existing platform matrix; no new offline/auto-update concerns at MVP. UI is deliberately minimal — full UI design (Figma) happens at story time per CLAUDE.md Rule 1.

### Implementation Considerations

Cross-repo coordination (server in Milton-saas, client triggers here) via the OpenAPI contract as the shared artifact · payment-grade tests on the ledger · versioned API (`/v1/`) from day one so Phases 2–4 extend without breaking.

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** a **validated-learning + platform-foundation** MVP. Phase 1 deliberately builds the full credits/metering spine but ships only *one* user-facing feature (metadata repair) on a *free* allocation — no monetization. The rationale: prove the two riskiest things cheaply before investing in Stripe and a paid tier — (1) the credit ledger is **correct** (it is money), and (2) users genuinely **want** the AI (the demand signal). It is not a revenue MVP; it is the de-risking step that makes the Phase-2 revenue MVP safe to build.

**Resource Requirements:** solo build. The MVP is scoped to be survivable solo — one feature, one provider, no billing. Skills: Rust (gateway/ledger), TS/Svelte (thin client), prompt engineering + evals.

### MVP Feature Set (Phase 1)

**Core journeys supported:** J1 (Maya success), J2 (Maya edge case), J4 (operator) — fully; J3 (Daniel) — partially (public references only; full value is Phase 3).

**Must-have capabilities:**

1. Server-side append-only credit ledger + metering (idempotent, atomic, estimate-then-settle).
2. AI gateway, Claude-only, embedding LiteLLM for routing/pricing.
3. EdDSA-JWT auth extended with a `tier` claim.
4. Free-tier monthly credit grant + graceful exhaustion.
5. AI metadata repair — bulk-select, structured output, per-field confidence + low-confidence flagging.
6. Minimal credits/usage UI (desktop + extension) + an operator ledger/cost view.
7. Privacy-policy AI-processing addendum; honest "coming soon" signpost for BYOK/local.

### Post-MVP Features

- **Phase 2 (Growth — monetization):** chat-with-PDF (streaming, long-context + caching); Stripe; Pro tier (~€5–8/mo); credit packs; standalone reserve/settle endpoints for streaming billing.
- **Phase 3 (Expansion — differentiators):** multi-provider model choice (OpenAI/Mistral/DeepSeek); BYOK (desktop, OS keychain); local LLM (Ollama). The category position.
- **Phase 4 (Vision):** local-first semantic search; then the credits platform extends to any AI task.

### Risk Mitigation Strategy

- **Technical risks:** the ledger is the riskiest part (money) → payment-grade transactional tests, idempotency, atomic debit; ship simple (Claude-only, no streaming) to keep the MVP surface small; multi-provider complexity deferred entirely to Phase 3.
- **Market risks:** the biggest — does anyone want/pay for this? → the MVP *is* the mitigation: it ships free and measures the demand signal (free-allocation exhaustion) before a cent is spent on Stripe. Weak signal → Phase 2 is not built — a cheap failure.
- **Resource risks:** solo capacity vs platform scope → strict phasing, each phase independently shippable *and* abandonable; bias to buy/embed (LiteLLM, Stripe primitives, Langfuse, Ollama). If resources tighten, the MVP stands alone as a useful free feature.

---

## Functional Requirements

> The binding **capability contract** for the MVP. UX, architecture, and stories build only what is listed here.

### Credit Ledger & Metering

- **FR1:** The system records every credit-affecting event (grant, debit, reservation, release, correction) as an immutable, individually auditable entry — no in-place mutation of balances.
- **FR2:** The system computes a user's credit balance as the sum of their ledger entries.
- **FR3:** The system rejects any credit-affecting event whose idempotency key was already recorded (no double-charge on retry).
- **FR4:** The system reserves an estimated credit amount before an AI call and settles it to the actual cost after the call completes.
- **FR5:** The system prevents a balance from going negative — a call is refused if estimated cost exceeds available balance.
- **FR6:** The system grants every user a recurring free-tier credit allocation that resets on a fixed monthly cycle.

### AI Gateway & Provider Integration

- **FR7:** The system routes AI requests to an LLM provider (Claude for MVP) and returns the result to the caller.
- **FR8:** The system meters the token usage of each AI call and converts it to a credit cost.
- **FR9:** The system reuses cacheable prompt content across AI calls to minimize cost.
- **FR10:** The system records, per AI call, the model used, tokens consumed, and provider cost, linked to the originating user.
- **FR11:** The system surfaces a clear, typed error when a provider call fails.

### AI Metadata Repair

- **FR12:** A user can select one or more references and request AI metadata repair.
- **FR13:** The system returns repaired bibliographic fields (title, authors, DOI, year, journal, …) for each submitted reference.
- **FR14:** The system marks which fields were AI-repaired, distinguishing them from original data.
- **FR15:** The system reports a confidence level for each repaired reference.
- **FR16:** The system flags — rather than guesses — references it cannot confidently repair, leaving their data unchanged.
- **FR17:** A user can identify and revert AI-repaired fields after a repair (original values are preserved).
- **FR18:** The system processes bulk repair requests asynchronously and reports progress.
- **FR19:** The system produces a per-run summary of what was repaired, skipped, flagged, or blocked by limits.

### Credits & Usage Experience

- **FR20:** A user can see their current credit balance in human-readable terms.
- **FR21:** A user can see when their free allocation next resets.
- **FR22:** A user can view a history of their AI usage.
- **FR23:** The system informs the user of the credit cost/consumption of an AI action.
- **FR24:** When an allocation is exhausted mid-run, the system pauses gracefully and explains the reset timing.

### Authentication & Authorization

- **FR25:** The system authenticates every AI request via a signed per-user token.
- **FR26:** The system attributes AI usage and credit debits to the authenticated user.
- **FR27:** The system enforces tier-based access rules carried in the user's token.

### Operations, Monitoring & Trust

- **FR28:** An operator can view the credit ledger and reconcile credits debited against provider-reported cost.
- **FR29:** An operator can monitor aggregate free-tier cost (COGS).
- **FR30:** An operator can observe the demand signal — the share of active AI users exhausting their free allocation.
- **FR31:** The system detects and alerts on anomalous per-user usage spikes.
- **FR32:** The system enforces per-user rate limits on AI requests.
- **FR33:** The system discloses, in the privacy policy, that AI features send data to a third-party LLM provider.
- **FR34:** The product signposts that bring-your-own-key and local-model options are planned, without over-claiming current privacy.

---

## Non-Functional Requirements

### Performance

- **NFR1:** Single-reference metadata repair completes within ~10 s p95 (interactive).
- **NFR2:** Bulk repair runs asynchronously — the UI stays responsive and shows progress; a 100-reference batch completes within a few minutes.
- **NFR3:** The credits balance / usage view loads within ~1 s.
- **NFR4:** Credit metering (ledger settle) happens off the user's critical path — it never adds perceptible latency to the AI result.

### Security

- **NFR5:** Milton's LLM-provider API key is stored server-side in a secret vault — never transmitted to or stored on any client.
- **NFR6:** All AI traffic (client↔gateway, gateway↔provider) is encrypted in transit (TLS).
- **NFR7:** Every AI request is authenticated with a signed, short-TTL per-user token; unauthenticated requests are rejected.
- **NFR8:** The credit ledger is correct under concurrency — concurrent debits on the same balance cannot both succeed past the available balance (test-verified).
- **NFR9:** AI request payloads sent to the provider are minimized to the data the task requires — never the user's whole library.
- **NFR10:** GDPR — users can access and delete their AI usage data; the privacy policy discloses third-party AI processing.

### Reliability

- **NFR11:** The credit ledger reconciles to ~0 discrepancy between credits debited and provider-reported cost.
- **NFR12:** A provider outage/error degrades gracefully — the user sees a clear error and no credits are debited for a failed call (reservations released).
- **NFR13:** A client disconnect or retry mid-operation never double-charges (idempotency) and never silently loses a debit.
- **NFR14:** A partial bulk run is recoverable — completed repairs persist and the run reports exactly what remains.

### Scalability

- **NFR15:** The gateway is stateless and horizontally scalable; the credit ledger (PostgreSQL) handles Milton's projected user base with headroom — the row-locked debit is the consistency point, adequate well past current scale.

### Accessibility

- **NFR16:** The new AI UI surfaces (repair action, credits/usage view) meet Milton's existing accessibility baseline — keyboard-navigable, screen-reader-labelled — no regression from the standard the app already holds.
