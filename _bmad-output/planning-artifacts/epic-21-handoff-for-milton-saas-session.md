---
title: 'Epic-21 Handoff — for the future Milton-saas dev session'
purpose: 'Self-contained primer that picks up epic-21 implementation with zero rediscovery.'
audience: 'Future Claude session running in Milton-saas (or Pierre, when he starts epic-21 dev there)'
date: '2026-05-25'
authored_from: 'milton-browser-extension'
---

# Epic-21 — Handoff for a Milton-saas Session

You (a future Claude session in Milton-saas, or Pierre paste-importing context) are starting epic-21 implementation. **Almost all of epic-21's code lands in Milton-saas, but the planning artifacts live in `milton-browser-extension`** (in this repo's sibling `_bmad-output/planning-artifacts/`). This document is the entry point — read it first, then dive into the source docs as needed.

## What epic-21 is

The **Milton AI Platform** — an app-wide AI capability built on an AI-credits system. The MVP ships **chat-with-PDF** as the marquee feature. A quick follow-up phase (1.5) adds **AI metadata repair** as a fallback on PDF imports. Later phases add credit-pack top-ups, multi-provider model choice + BYOK + local LLMs, and semantic search.

## Where the planning lives

All in **`~/web_dev/milton-browser-extension/_bmad-output/planning-artifacts/`** (a sibling clone). Read in this order:

1. **`epic-21-plan-overview-2026-05-22.md`** — the readable narrative summary; *start here*.
2. **`epics-milton-ai-platform-epic-21-2026-05-22.md`** — 4 epics, 21 stories with full Given/When/Then ACs. This is your work breakdown.
3. **`architecture-milton-ai-platform-epic-21-2026-05-22.md`** — decision register (AD-1→AD-9), verified Milton-saas stack, project structure, the canonical credit-ledger rules.
4. **`prd-milton-ai-platform-epic-21-2026-05-22.md`** — 45 FRs + 16 NFRs, API spec, journeys. *Carries banners noting two corrections passes — read the overview first to understand the current sequencing.*
5. **`product-brief-milton-ai-platform-2026-05-22.md`** — vision, personas, north-star.
6. **`research/technical-milton-ai-strategy-research-2026-05-22.md`** — fully-cited technical research; the "why" behind AD-1→AD-9.

> **Authoritative pecking order:** if anything contradicts, trust the **overview** (latest), then the **epics doc** and **architecture**, then the **PRD** (body text is a historical record; banners say so).

## Key decisions already taken (don't re-litigate)

- **Server stack** confirmed by repo inspection: **TypeScript on Bun + Supabase Postgres + Polar billing + PostHog**. The auth-proxy at `tools/translation-server/auth-proxy/` is the architectural sibling to the new `ai-gateway` you'll build.
- **AD-3 — Anthropic TS SDK directly, behind a `ProviderPort` interface.** No LiteLLM. Phase-3 multi-provider will use the Vercel AI SDK server-side.
- **Credit ledger** = a new Supabase migration, modeled on the existing `pdf_analysis_usage` pattern (append-only, service-role RLS, idempotency keys, atomic `SELECT … FOR UPDATE` debit, estimate-then-settle).
- **Reuse, don't rebuild:** the auth-proxy ships `jwt-verifier`, `tier-verifier`, `rate-limiter`, `posthog`, `confidence-score`, `doi-resolve`, `crossref-title-search`, `safe-fetch`. The desktop ships `lib/features/freemium` (`enforce-limit`, `limit-reached-modal`) + `lib/features/settings` (`plan-billing-form`, `settings-modal`, `checkout.ts`). Epic-21 plugs into these — *do not invent new UI surfaces*.
- **Phase 1 = chat-with-PDF (not metadata repair).** Metadata repair = Phase 1.5. (Sequencing was swapped 2026-05-25.)
- **Tiers already exist** — `plan_tier` in Supabase `app_metadata` (free / monthly / yearly / lifetime / founder). Don't introduce a new tier system; *consume* the existing one.

## Where the new code lands in Milton-saas

| Component | Path | What |
|---|---|---|
| AI gateway | `tools/translation-server/ai-gateway/src/` *(new sibling to `auth-proxy`)* | Bun/TS service; flat `src/*.ts` + co-located `*.test.ts`. Entry: `server.ts`. Modules: `ledger.ts`, `provider-port.ts`, `anthropic-adapter.ts`, `chat.ts`, `metadata-repair.ts`, `credit-cost.ts`, `types.ts` |
| Credit ledger | `milton/supabase/migrations/<YYYYMMDDHHMMSS>_create_ai_credit_ledger.sql` | Modeled on `pdf_analysis_usage` (same migration style) |
| Desktop chat-with-PDF | `milton/src/lib/features/ai-chat/` *(new module)* | SvelteKit; the chat panel beside the PDF viewer; uses `@ai-sdk/svelte`'s `Chat` class targeting the Rust loopback |
| Desktop credits view | `milton/src/lib/features/settings/components/` *(new component inside existing `settings-modal`)* | Slots next to `plan-billing-form.svelte` |
| AI-credits limit-reached | `milton/src/lib/features/freemium/components/limit-reached-modal.svelte` *(extend)* | Reuse, recognize AI credits as the limited resource |
| Anthropic API key | server-side env (same pattern as auth-proxy's keys) | Never on a client |

The **extension** in `milton-browser-extension` only adds the AI repair fallback at Phase 1.5 (no AI in Phase 1). Coordination: the OpenAPI spec of `/v1/ai/...` is the cross-repo contract, authored in Milton-saas.

## The first dev story

**Story 1.1 — Credit ledger foundation** (epics doc §Epic 1). The Supabase migration that creates `ai_credit_ledger`. Builds nothing user-visible; it's the foundation. Follow the `pdf_analysis_usage` migration as a stylistic template.

After 1.1, the chain is: 1.2 (reserve/settle) → 1.3 (free-tier grant) → 1.4 (gateway skeleton + balance endpoint) → 1.5 (Anthropic adapter + metering) → 1.6 (streaming chat endpoint) → 1.7 (PDF input pipeline) → 1.8 (desktop chat UI — needs Figma) → 1.9 (conversation persistence) → 1.10 (mid-stream credit handling) → 1.11 (credits view in settings — needs Figma). Then Epic 2 stories in any order.

## Open items at handoff (not blockers)

- **Pricing calibration** — exact free-tier credit count + the credits-per-action mapping — calibrated against measured per-feature cost once Story 1.5 (metering) is in place.
- **Figma designs** for the desktop chat-with-PDF UI (Story 1.8) and the credits view (Story 1.11). CLAUDE.md Rule 1 — Figma before UI build.
- **Sprint-status** — `milton-browser-extension`'s `sprint-status.yaml` mentions epic-21 as future; Milton-saas's sprint-status doesn't have it yet. Adding an epic-21 row in Milton-saas's sprint-status with story keys (21-1, 21-2, …) is a sensible first sprint-planning step.

## Suggested first prompt to start a Milton-saas Claude session

Paste something like:

> Epic-21 is fully planned in our sibling repo at `~/web_dev/milton-browser-extension/_bmad-output/planning-artifacts/`. Start by reading `epic-21-handoff-for-milton-saas-session.md`, then `epic-21-plan-overview-2026-05-22.md`, then `epics-milton-ai-platform-epic-21-2026-05-22.md`. After that, I want to start `/bmad_bmm_dev-story` on Story 1.1 — the credit-ledger Supabase migration.

That's enough — the session will pick up everything from there.

## A note on memory

Memories I wrote from the milton-browser-extension session live at `~/.claude/projects/-Users-pierrejacquel-web-dev-milton-browser-extension/memory/`. They include:

- `project_epic_21_ai_platform.md` — full epic-21 context (the same content distilled here)
- `feedback_check_sibling_repos_yourself.md` — Pierre's instruction to inspect repos directly, including Milton-saas at `~/web_dev/Milton`

A Milton-saas session has its **own** memory dir (different repo path → different slug) — those memories don't auto-cross-pollinate. **That's why this handoff doc exists.** When you start the Milton-saas session, consider writing analogous memories in *its* memory dir so the same context persists across sessions there.

---

*If anything in the planning artifacts looks stale or wrong on first reading, surface it to Pierre — the corrections-passes that landed in this plan all came from him noticing things on review.*
