---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-05-22'
inputDocuments:
  - _bmad-output/planning-artifacts/prd-milton-ai-platform-epic-21-2026-05-22.md
  - _bmad-output/planning-artifacts/product-brief-milton-ai-platform-2026-05-22.md
  - _bmad-output/planning-artifacts/research/technical-milton-ai-strategy-research-2026-05-22.md
  - _bmad-output/planning-artifacts/charter-v2.md
  - _bmad-output/planning-artifacts/charter.md
workflowType: 'architecture'
project_name: 'Milton AI Platform (Epic-21)'
user_name: 'Pierre'
date: '2026-05-22'
scope: 'MVP = Phase 1 (AI Foundation)'
---

# Architecture Decision Document — Milton AI Platform (Epic-21)

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

> **Scope:** epic-21 MVP = Phase 1 (AI Foundation). Ratifies and formalizes decision register **AD-1→AD-9** from `research/technical-milton-ai-strategy-research-2026-05-22.md`. Built on the PRD (`prd-milton-ai-platform-epic-21-2026-05-22.md`) and product brief.

## Project Context Analysis

### Requirements Overview

**Functional Requirements** — 34 FRs across 6 capability areas, clustering into architectural subsystems:

- Credit ledger & metering (FR1–6) → a transactional data subsystem — the architectural keystone (it is money)
- AI gateway & provider integration (FR7–11) → an outbound integration subsystem with a pluggable provider adapter
- AI metadata repair (FR12–19) → the one user-facing feature — sync request/response + async-batch, consuming the gateway
- Credits & usage experience (FR20–24) → thin client UI on two surfaces (desktop + extension)
- Auth & authz (FR25–27) → extends the existing EdDSA-JWT broker
- Ops, monitoring & trust (FR28–34) → an operator observability surface + disclosure artifacts

**Non-Functional Requirements** — the architecture-shaping ones:

- **Ledger correctness** (NFR8, 11–14) — the *dominant* driver; mandates append-only ledger + idempotency keys + atomic row-locked debit + estimate-then-settle.
- **Security** (NFR5–7, 9–10) — server-side secret vault, TLS, signed tokens, data minimization.
- **Performance** (NFR1–4) — interactive single-repair latency, async bulk, metering off the critical path.
- **Scalability** (NFR15) — stateless gateway, Postgres ledger as the consistency point.

**Scale & Complexity:**

- Primary domain: **backend service (api_backend)** + thin desktop/extension clients.
- Complexity level: **medium** — driven by the money-handling ledger and AI integration, not by scale or regulation.
- Estimated architectural components (MVP): **~5** — AI gateway · credit ledger · metadata-repair feature module · auth extension · thin client modules (desktop + extension).

### Technical Constraints & Dependencies

- **Two repos** — gateway + ledger in Milton-saas (private); AI client in milton-browser-extension (this repo). The contract between them is the internal `/v1/ai/...` API.
- **Tauri topology** — Milton-desktop ships SvelteKit static (no in-app Node server); AI calls route via the Rust loopback to the server gateway (AD-4, AD-9).
- **IPC boundary** — the extension must never import Milton-desktop code; HTTP-only (charter standing rule).
- **Reused assets** — the EdDSA-JWT broker (BE-4), the connector loopback at `127.0.0.1:7521`, the extension's CI.
- **External dependencies** — Anthropic API (only provider at MVP); a PostgreSQL instance on Milton-server. Stripe is *not* a dependency at MVP.
- **Decision register** — AD-1→AD-9 from the research are inputs to **ratify**, not re-open.

### Cross-Cutting Concerns Identified

- **Metering** — every AI call metered + debited; spans gateway and every feature.
- **Auth** — every request authenticated + attributed; spans all endpoints.
- **Idempotency** — every credit-affecting event and every retryable client call.
- **Observability** — traces, cost, cache-hit rate; spans gateway + ledger.
- **Error taxonomy** — the typed contract (401/402/422/429/503) shared by all endpoints and both clients.
- **Cross-repo contract** — the OpenAPI spec is a shared artifact both repos depend on.

## Starter Template Evaluation

### Primary Technology Domain

Epic-21 is **brownfield** — it adds modules to two existing repositories, not a new project. There is **no starter template to scaffold**; the technology stack is *inherited*, and that inheritance is itself an architectural constraint.

### Inherited Stacks (no starter selected)

| Surface | Repo | Existing stack |
|---|---|---|
| AI client (extension) | milton-browser-extension | Vite 7 + CRXJS 2 + TypeScript 5.9 + Vitest 4 (MV3) |
| AI client (desktop) | Milton-saas | Tauri (Rust) + SvelteKit frontend |
| AI gateway + credit ledger *(new)* | Milton-saas (server component) | inherits Milton-server's existing stack |

### What this means for epic-21

- **No `create-*` scaffold command** — epic-21 is new modules inside established codebases, following each repo's existing conventions, linting, and CI.
- The genuinely new technology choices are **library/component choices for the server-side gateway and ledger** — these are architectural *decisions* (Step 4), made against the AD-1→AD-9 register, not starter-template selections.
- The clients add one thin feature module each, in TypeScript, reusing existing extension/desktop patterns.

### Flagged for Step 4 — an open question

AD-3 (research) recommends "embed **LiteLLM** as a library/router." LiteLLM is a **Python** library — embedding it works only if Milton-server is Python. If Milton-server is Rust/Node/other, the options become: (a) run **LiteLLM as a standalone proxy service** the gateway calls, or (b) self-build the provider adapter + pricing tables in the server's native language. **Milton-server's actual stack must be confirmed** before AD-3's concrete shape is finalized — recorded as a Step-4 decision with the dependency explicit.

**Conclusion:** starter-template evaluation is **N/A** for this brownfield epic. The "first implementation story" is not a scaffold command — it is the credit-ledger schema + gateway skeleton inside Milton-saas.

## Core Architectural Decisions

> **Repo-verified.** This section was written after inspecting the actual Milton-saas repo (`~/web_dev/Milton`). It corrects three assumptions carried in the brief/PRD/research — see *Corrections to upstream documents* at the end.

### Verified Milton-saas Stack (the inheritance)

| Component | Reality (from the repo) |
|---|---|
| Server runtime | **TypeScript on Bun** — the existing auth-proxy (`tools/translation-server/auth-proxy`) runs `bun run src/server.ts` |
| Database | **Supabase (managed PostgreSQL)** — RLS, migrations, `auth.users` |
| Edge functions | **Supabase Edge Functions (Deno)** — e.g. the `polar-webhook` |
| Desktop | Tauri (Rust `src-tauri`) + SvelteKit |
| Billing | **Polar (polar.sh)** — a live `polar-webhook` edge function (Standard Webhooks) |
| Analytics | PostHog (`posthog-node`) |
| Translation server | Dockerized self-hosted Zotero translation-server behind Caddy |

### Decision Priority Analysis

- **Critical (block implementation):** credit-ledger schema (Supabase migration) · AI gateway service shape · auth + tier integration · provider integration approach.
- **Important:** error taxonomy · token-based rate limiting · observability events.
- **Deferred (post-MVP):** Polar billing integration (Phase 2) · multi-provider via Vercel AI SDK (Phase 3) · streaming reserve/settle endpoints (Phase 2).

### Ratification of AD-1 → AD-9 (research decision register)

All nine decisions from the research are **ratified**, two refined against the verified repo:

- AD-1, AD-2, AD-4, AD-5/6, AD-7/8, AD-9 — ratified unchanged.
- **AD-3 refined.** "Embed LiteLLM" presumed a Python server. Milton-server is **TypeScript/Bun**. For the MVP the gateway calls the **Anthropic TypeScript SDK directly behind a provider-port interface** (Pierre's decision). Phase-3 multi-provider will use the **Vercel AI SDK server-side** (native TS, multi-provider) — **LiteLLM drops out of the architecture entirely.**
- **AD-2 refined** — the ledger is not greenfield; see Data Architecture.

### Data Architecture

- **Database: Supabase PostgreSQL** — inherited, no decision needed.
- **Credit ledger = a new append-only table modeled on the proven `pdf_analysis_usage` pattern.** Milton *already* runs an append-only, tier-gated usage ledger: `pdf_analysis_usage` (migration TS-16) — "7 PDF analyses per rolling 7 days, free tier; paid users bypass," enforced by the auth-proxy, service-role RLS, never read by clients. The epic-21 credit ledger **generalizes this exact pattern**: rows carry signed credit amounts (`grant｜debit｜reservation｜release｜correction`), balance = `SUM(amount)`, with an idempotency-key column and an atomic `SELECT … FOR UPDATE` debit. Same RLS posture (service-role only). **Major de-risk — the pattern is proven in production.**
- **`pdf_analysis_usage` is superseded** by the credit ledger once AI metadata repair ships: the GROBID-based "PDF analysis" it meters is itself replaced by LLM metadata repair (ties into GROBID retirement, originally BE-8-9 scope). Epic-21 sequences the transition (rolling-7-day quota → credit allocation).
- Delivered as a Supabase migration (`milton/supabase/migrations/`).

### Authentication & Security

- **Auth:** reuse the existing **EdDSA-JWT** minted by the connector (story 18-15), verified by the auth-proxy. The AI gateway verifies the same way — no new auth.
- **Tiers already exist.** `plan_tier` lives in Supabase user `app_metadata` (`free` + `monthly｜yearly｜lifetime｜founder`). **Correction to the PRD:** epic-21 does *not* introduce a tier system or "extend the JWT with a tier claim" from scratch — it *consumes* the existing `plan_tier`. At story time, confirm whether the EdDSA-JWT already carries `plan_tier`; if not, the gateway reads it from Supabase. FR27 stands, satisfied by existing infrastructure.
- **Secrets:** the Anthropic API key in server-side env (same posture as the auth-proxy's keys).
- **RLS:** the credit-ledger table is service-role-only; clients reach it only through gateway endpoints.

### API & Communication Patterns

- **The AI gateway is a new module on the TypeScript/Bun server**, architecturally a sibling of the existing auth-proxy (which already does per-user quota enforcement + upstream forwarding — the gateway is the same shape). Recommend a **sibling module** sharing the auth-proxy's patterns, over extending the auth-proxy itself (keeps the auth-proxy focused on translation-server proxying).
- Internal REST, versioned `/v1/ai/...`, JSON; the PRD's error taxonomy (401/402/422/429/503).
- **Provider integration:** Anthropic **TypeScript SDK** directly, behind a `ProviderPort` interface. Single-reference repair synchronous; bulk asynchronous.

### Frontend Architecture

- Thin clients: extension (Vite/CRXJS/TS) + desktop (SvelteKit). MVP metadata repair = a plain authenticated HTTP call + a results UI — **no streaming**.
- **No Vercel AI SDK at the MVP** — it earns its place at Phase 2 (streaming chat). The MVP client is a plain `fetch` + repair-results UI, reusing each repo's existing patterns.
- Visual design (repair action, credits/usage view) → Figma at story time (CLAUDE.md Rule 1).

### Infrastructure & Deployment

- **Gateway** deploys with the existing server infrastructure (the translation-server stack is Dockerized behind Caddy; the auth-proxy runs there) — the AI gateway joins that deployment unit. No new hosting decision.
- **Ledger** = a Supabase migration — no new infra.
- **Observability:** PostHog is already in use — reuse it for AI events (repair usage, credit debits). Langfuse (research suggestion) is a Phase-2+ nice-to-have, not MVP-critical.
- **The MVP adds exactly one new external dependency: the Anthropic API.** (Polar already exists; Stripe is not adopted.)

### Decision Impact Analysis

**Implementation sequence:** (1) credit-ledger Supabase migration + balance/reserve/settle logic; (2) gateway skeleton + `ProviderPort` + Anthropic adapter + metering; (3) `/v1/ai/metadata-repair` + `/balance` + `/usage` endpoints; (4) thin clients (extension + desktop) + minimal credits UI; (5) operator view + PostHog events.

**Cross-component dependencies:** the ledger blocks the gateway; the gateway blocks the endpoints; the endpoints block the clients. The `pdf_analysis_usage` → credit-ledger transition must be sequenced so the existing GROBID PDF-analysis quota keeps working until LLM repair replaces it.

### Corrections to Upstream Documents (brief / PRD / research)

Inspecting the repo surfaced three errors in the already-committed planning docs — they assumed rather than verified:

1. **Billing: Polar, not Stripe.** The brief, PRD, and research all name Stripe. Milton already uses **Polar** (live `polar-webhook` edge function). Phase-2 billing = Polar.
2. **Milton already has paid tiers.** `plan_tier` (free + monthly/yearly/lifetime/founder) exists. The brief's "Milton has no paid tier / epic-21 is the first revenue engine" is **false**. Reframed: epic-21's role is **AI as the upgrade driver for Milton's existing paid plans**; the north-star becomes "AI measurably drives upgrades to the existing plans."
3. **Metadata repair + the credit ledger are not greenfield.** Milton already does GROBID-based PDF metadata analysis, already meters it (`pdf_analysis_usage`), already tier-gates it. Epic-21 is the **LLM-based evolution** of a working feature, not a from-scratch build.

→ These three corrections should be back-ported into the brief, PRD, and research doc in a single correction pass after this architecture workflow completes.

## Implementation Patterns & Consistency Rules

### Governing Principle — Match Existing Conventions

Epic-21 is brownfield across two established repos. **The overriding rule: new code matches the existing conventions of the repo it lands in** — agents adopt, not invent. The patterns below are either inherited conventions made explicit, or genuinely new rules for the credit-ledger surface (which has no precedent).

### Naming Patterns

- **Database (Supabase Postgres)** — match the `pdf_analysis_usage` / migration style verbatim: `snake_case` tables & columns (`ai_credit_ledger`, `event_id`, `user_id`); migration files `YYYYMMDDHHMMSS_description.sql` in `milton/supabase/migrations/`; idempotent DDL (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`→`CREATE`); RLS enabled with service-role policies; FK `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`; indexes `<table>_<cols>_idx`.
- **API** — `/v1/ai/<resource>`, JSON; match the auth-proxy's request/response shape.
- **Code** — TypeScript per each repo's existing eslint config (the extension has `eslint-plugin-milton`); camelCase in TS, snake_case only at the DB/JSON boundary if the existing API already does.
- **PostHog events** — `ai_<noun>_<verb>` (e.g. `ai_metadata_repair_completed`, `ai_credit_debited`), matching existing event naming.

### Structure Patterns

- AI gateway — a new module under the translation-server tooling, **sibling to `auth-proxy`**, mirroring its layout (`src/server.ts` entry, Bun).
- Ledger — a migration in `milton/supabase/migrations/`.
- Extension AI client — a new feature module under `src/`, following existing module structure + SPDX/AGPL headers.
- Tests — match each repo's placement (`bun test` server-side; Vitest in the extension).

### Format Patterns

- **API responses** — match the auth-proxy's existing convention (confirm at story time; don't impose a new wrapper). Errors use the PRD's typed taxonomy.
- **Dates** — `TIMESTAMPTZ` in Postgres; ISO-8601 on the wire.
- **Money** — credits are **integers** (1 credit = $0.01), never floats; `provider_cost_usd` stored as exact `numeric`, never float.

### Communication Patterns — Credit Ledger Canonical Rules *(new — agents MUST follow exactly)*

- Ledger rows are **append-only** — never `UPDATE`, never `DELETE` (except a lazy-retention sweep, matching `pdf_analysis_usage`).
- `event_type` ∈ `{grant, debit, reservation, release, correction}` — exactly these strings.
- `amount` is a **signed integer**: grants/releases positive, debits/reservations negative; balance = `SUM(amount)`.
- Every row carries a unique `event_id` (idempotency key); the gateway dedupes on it before insert.
- A debit is `BEGIN; SELECT … FOR UPDATE; check; INSERT; COMMIT;` — never a read-modify-write outside a transaction.
- Estimate-then-settle: a `reservation` on call start → `release` (unused) + `debit` (actual) on settle, or a `correction` if actual exceeds the reservation.

### Process Patterns

- **Errors** — the gateway maps every failure to a PRD typed code; clients branch on the code, never on message text.
- **Idempotency** — every retryable client→gateway call carries an idempotency key; the gateway is safe to call twice.
- **Auth** — reuse the auth-proxy's EdDSA-JWT verification; don't reimplement.
- **No secrets in clients** — the Anthropic key never leaves the server.

### Enforcement Guidelines

**All agents/devs MUST:** match the host repo's conventions (read a neighbouring file when unsure); treat the ledger as append-only; route every AI call through the gateway; reuse the JWT verification + the `pdf_analysis_usage` migration style.
**Anti-patterns:** mutable balance column · float money · provider keys in client code · bypassing the ledger · a divergent API-response wrapper.

## Project Structure & Boundaries

### The Two-Repo Layout

Epic-21 adds modules to two existing repos — no new repo, no restructure.

**Milton-saas** (`~/web_dev/Milton`, private) — server + ledger + desktop client:

```
Milton/
├── tools/translation-server/
│   ├── auth-proxy/            # EXISTING — Bun/TS. Reuse: jwt-verifier, tier-verifier,
│   │   └── src/               #   rate-limiter, posthog, confidence-score, doi-resolve,
│   │                          #   crossref-title-search, safe-fetch
│   └── ai-gateway/            # NEW — epic-21 AI gateway (sibling; Bun/TS; flat src/)
│       └── src/
│           ├── server.ts                      # Bun entry
│           ├── ledger.ts          (+ .test)   # append-only ledger: reserve/settle/debit
│           ├── provider-port.ts               # the ProviderPort interface
│           ├── anthropic-adapter.ts (+ .test) # Claude adapter (Anthropic TS SDK)
│           ├── metadata-repair.ts  (+ .test)  # the repair feature handler
│           ├── credit-cost.ts      (+ .test)  # token usage -> credits mapping
│           └── types.ts
├── milton/
│   ├── supabase/migrations/
│   │   └── 2026XXXX_create_ai_credit_ledger.sql   # NEW — the ledger table
│   └── src/lib/ai/            # NEW — desktop AI client (SvelteKit)
│       ├── ai-client.ts                   # HTTP client -> gateway
│       ├── credits-store.svelte.ts        # balance/usage state (runes)
│       └── components/                    # repair action, credits view
```

**milton-browser-extension** (this repo, public/AGPL):

```
milton-browser-extension/src/
├── ai/                        # NEW — extension AI client
│   ├── ai-client.ts    (+ .test)    # HTTP client -> gateway (JWT)
│   └── metadata-repair.ts (+ .test) # repair trigger + result handling
├── popup/                     # EXISTING — add repair action + credits surface
└── ...
```

### Architectural Boundaries

- **API boundary** — the internal `/v1/ai/...` REST API is the *only* way clients reach AI; the OpenAPI spec is the shared cross-repo contract.
- **Repo boundary** — Milton-saas owns gateway + ledger + desktop client; this repo owns the extension client. They meet only at the HTTP API; the extension never imports Milton-saas code (charter rule).
- **Data boundary** — the credit ledger lives in Supabase, service-role-only RLS; only the gateway touches it.
- **Trust boundary** — the Anthropic key stays inside the gateway; clients hold only the EdDSA-JWT.

### Requirements → Structure Mapping

| FR group | Lands in |
|---|---|
| FR1–6 Credit ledger & metering | `ai-gateway/src/ledger.ts`, `credit-cost.ts` + the Supabase migration |
| FR7–11 AI gateway & provider | `ai-gateway/src/server.ts`, `provider-port.ts`, `anthropic-adapter.ts` |
| FR12–19 AI metadata repair | `ai-gateway/src/metadata-repair.ts` + clients' `metadata-repair.ts` |
| FR20–24 Credits & usage UX | clients: `credits-store`, credits view components |
| FR25–27 Auth & authz | **reused** `jwt-verifier.ts`, existing `tier-verifier.ts` |
| FR28–34 Ops, monitoring, trust | `posthog` events, an operator query/view, privacy-policy edit |

### Reuse, Don't Rebuild

The auth-proxy already ships `jwt-verifier`, `tier-verifier`, `rate-limiter`, `posthog`, `confidence-score`, `doi-resolve`, `crossref-title-search`, `safe-fetch`. **Recommendation:** extract the genuinely shared ones (`jwt-verifier`, `tier-verifier`, `rate-limiter`, `posthog`) into a small shared package both the auth-proxy and `ai-gateway` import — not copy-paste. Notably, `confidence-score` + `doi-resolve` + `crossref-title-search` are directly useful for **validating AI-repaired metadata against Crossref/DOI** — a quality lever the metadata-repair handler should exploit.

### Integration Points

- **Internal:** clients → gateway (HTTPS + JWT); gateway → Supabase (service role); gateway → Anthropic API.
- **External:** the Anthropic API — the only new external dependency.
- **File organization:** server = flat `src/*.ts` + co-located `*.test.ts` (match auth-proxy); migration timestamped; extension `src/ai/` + SPDX headers; desktop `milton/src/lib/ai/`.

## Architecture Validation Results

### Coherence Validation ✅

All decisions cohere: a TypeScript/Bun gateway + Supabase Postgres + the Anthropic TS SDK + reuse of the auth-proxy's modules form one consistent stack. The `ProviderPort` interface keeps Phase-3 multi-provider contained. No contradictory decisions. The step-3 LiteLLM question is **resolved** (server is TS/Bun → AD-3 refined, LiteLLM dropped).

### Requirements Coverage Validation ✅

- **FR1–6** (ledger) → Data Architecture + `ledger.ts` + migration.
- **FR7–11** (gateway) → `server.ts`, `provider-port.ts`, `anthropic-adapter.ts`, `credit-cost.ts`.
- **FR12–19** (metadata repair) → `metadata-repair.ts` + clients; FR16 low-confidence flagging served by reusing `confidence-score`.
- **FR20–24** (credits UX) → client `credits-store` + components.
- **FR25–27** (auth) → reused `jwt-verifier` + existing `tier-verifier`.
- **FR28–34** (ops/trust) → PostHog events + operator view + privacy edit *(operator surface lightly specified — see gaps)*.
- **NFR1–16** — performance, security, reliability, scalability, accessibility — all architecturally addressed.

### Implementation Readiness Validation ✅

Decisions documented against the verified stack; patterns comprehensive (incl. the credit-ledger canonical rules); structure concrete (real file tree mapped to FR groups). AI agents can implement consistently.

### Gap Analysis

No **critical** (implementation-blocking) gaps. Five important/minor items, each with a resolution:

| # | Gap | Priority | Resolution |
|---|---|---|---|
| 1 | Operator surface (FR28–31) lightly specified | Important | MVP needs no custom operator UI — use Supabase SQL queries + PostHog dashboards for reconciliation / COGS / demand-signal. |
| 2 | `pdf_analysis_usage` → credit-ledger transition not detailed | Important | A required transition story in epic breakdown — the rolling-7-day PDF quota and the credit ledger coexist until LLM repair replaces GROBID PDF-analysis. |
| 3 | Shared-package extraction touches working auth-proxy code | Minor | Optional: the gateway may import auth-proxy modules directly first, extract the shared package later. |
| 4 | OpenAPI contract authoring location undecided | Minor | Authored + versioned in Milton-saas (with the gateway); the extension consumes it. |
| 5 | FR17 (revert AI-repaired fields) client-side data handling | Minor | Clients preserve pre-repair field values until the user accepts the repair — a client story-level concern. |

### Architecture Completeness Checklist

- ✅ **Requirements Analysis** — context, scale, constraints, cross-cutting concerns mapped
- ✅ **Architectural Decisions** — AD-1→AD-9 ratified against the verified repo; stack confirmed
- ✅ **Implementation Patterns** — naming, structure, format, ledger canonical rules, process
- ✅ **Project Structure** — concrete two-repo tree mapped to FR groups

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION** · **Confidence: HIGH**

**Key strengths:** the credit ledger generalizes a proven-in-prod pattern (`pdf_analysis_usage`); heavy reuse of the auth-proxy lowers build cost; the stack is verified, not assumed; the MVP adds exactly one external dependency.

**Areas for future enhancement:** the operator surface graduates to a real UI post-MVP; the shared package gets properly extracted; Phase 2+ adds Langfuse-grade observability.

### Implementation Handoff

**First implementation priority:** the credit-ledger Supabase migration + the gateway skeleton (`ai-gateway/src/server.ts` + `ledger.ts`) — not a scaffold command (brownfield).

AI agents implementing epic-21 must: follow AD-1→AD-9 and the ledger canonical rules exactly; reuse the auth-proxy's modules rather than reinventing; respect the two-repo boundary (extension never imports Milton-saas code); refer to this document for all architectural questions.
