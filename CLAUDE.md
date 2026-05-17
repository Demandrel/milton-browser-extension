# Claude Code Project Rules — milton-browser-extension

> **This file was ported from `Milton-saas/CLAUDE.md` (Milton-epic19 worktree version including Rule 0, 2026-05-16) at BE-8-3 close. Rules are NOT auto-synced between Milton-saas and this repo — keep an eye on the parent's CLAUDE.md when significant rules change.**

## ABSOLUTE RULES (NEVER VIOLATE)

### 1. FIGMA VERIFICATION FOR ALL UI WORK

**NEVER implement ANY UI component, design token, styling, or visual element without FIRST consulting the actual Figma design via MCP.**

Before implementing ANY UI-related task:
1. **HALT** and ASK the user to connect Figma via MCP
2. **WAIT** for Figma access to be provided
3. **VERIFY** all design values against the actual Figma file
4. **ONLY THEN** proceed with implementation

This applies to:
- Design tokens (colors, spacing, typography, radius, shadows, etc.)
- Component styling (buttons, inputs, forms, modals, etc.)
- Layout and spacing decisions
- Icons and visual assets
- Any visual/aesthetic implementation

**DO NOT** rely solely on:
- Story documentation
- Architecture docs
- Previous implementations
- Assumptions about design values

**ALWAYS** verify with the actual Figma file. The popup UI in this repo (`src/popup/`) is the primary UI surface — every spacing / color / radius / typography decision must trace back to a Figma node (currently Figma `1323:8984` "Browser extension").

---

## Git Workflow (ABSOLUTE — applies to every worktree, every session)

**Goal: ONE CI run per PR in the happy path. Two if a fix is needed. The pre-push hook is what makes this possible.**

Codified 2026-05-16 in Milton-saas after an audit found 80 CI runs / 995 minutes / 27.5% red rate over 12 days — most reds were format / typecheck / lint failures that a local hook catches in seconds. Same rule applies here.

### Rule 0 — Cut the feature branch BEFORE the first edit in `/bmad_bmm_dev-story`
- The instant `dev-story` resolves a story key from `sprint-status.yaml` (e.g. `BE-8-4-translator-runtime-lift`), verify the current branch matches `feat/<story-key>`. If on `main` or any other branch, **HALT** and run `git checkout -b feat/<story-key>` BEFORE any file write (no source edits, no story-file flip to `in-progress`, no codegen).
- The BMAD `dev-story` workflow does NOT have an explicit branch-creation step — the assumption is you handle git plumbing outside the workflow. Don't assume.
- Codified 2026-05-16 (in Milton-saas) after Story 19-9 was committed directly to local `main` (commit `b7cf23e3`); recovered non-destructively via `git branch feat/19-9-a11y-baseline` + `git reset --hard origin/main` + rebase. Cost: ~5 min recovery + process-confusion. Prevents trunk pollution + makes Rule 1's "feature branch push triggers CI" workable.
- Exception: `chore(N-N): mark done` commits on `main` after PR merge are legitimate (the established pattern across all closed stories — see `git log` for `chore(BE-8-3): mark done`).

### Rule 1 — Don't push until the story is done locally
- Commit as many times as you want locally; commits are free.
- A `git push` to a feature branch is what triggers CI. **Reserve push for "story is fully done"** — not "I'm going to bed", not "let me see if CI is happy with this WIP".
- If you need cloud backup of WIP, use a separate `wip/<slug>` branch that nobody opens a PR for; never push to a branch with an open PR mid-story.

### Rule 2 — The pre-push hook is the gate, not CI
- **Status in this repo: NOT YET WIRED UP.** BE-8-3 Task 6 deferred the hook because the extension has no `lint:reactive` script and the suite is fast (~309ms for tests + ~150ms for build). If the suite grows enough that a local gate matters, add a hook that runs `pnpm typecheck && pnpm test && pnpm build` (~10s on M2) and a matching `scripts/setup-hooks.sh`.
- Until the hook exists, CI is the gate. Push intentionally, expect one CI run per PR.
- Bypass-style discipline carries over: avoid `git push --no-verify` (when a hook exists) — only for genuine emergencies.

### Rule 3 — PR opens as non-draft from the start
- After the local push succeeds, `gh pr create --base main --head <branch>` opens the PR ready-for-review immediately. No draft-then-flip dance.
- CI fires once on PR open. That's the one CI run per story.
- If review wants a fix: commit it, push it, CI re-fires once. Accepted cost.

### Rule 4 — Docs-only PRs skip CI entirely
- `.github/workflows/ci.yml` `paths-ignore` filters out PRs that only touch `**/*.md`, `**/*.mdx`, `_bmad/**`, `_bmad-output/**`, `.gitignore`, `COPYING`. No action needed in those PRs.

### Rule 5 — One Claude session per worktree
- Two sessions in the same worktree directory will collide (shared HEAD, shared working tree). Never operate in a worktree directory another active session is using.
- This repo is small enough that worktrees may be overkill — typically one session, one repo clone is fine. If you start using worktrees (e.g., parallel BE-8-N stories), use the `milton-browser-extension/` (main) + `milton-browser-extension-be8-N/` pattern.

### Rule 6 — Branch model is trunk-based
- No `dev` branch. Feature branches off `main`, merged back to `main` (squash-merge convention from BE-8-3 onward).
- This repo has NO server / deploy pipeline — `main` is just the source of truth for the sideload-able extension. Distribution is sideload-first per charter v2 Decision 9 (Chrome Web Store packaging is a separate epic).

### Rule 7 — ALWAYS auto-watch CI in background after every push event
- Codified 2026-05-17 after a real violation on PR #5: I opened the PR and ended the turn with "CI will fire on push" instead of launching the watcher. Pierre escalated. Never again.
- Every `git push`, `gh pr create`, and `gh pr merge` MUST be immediately followed — in the **same response** — by a background `gh pr checks <PR#> --watch` (or `gh run watch <run-id>` for post-merge main CI). Not "in the next turn", not "if you want me to".
- Canonical pattern (use `gh run watch <id>`, NOT `gh pr checks --watch`): `Bash(command: "sleep 5 && RUN_ID=$(gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId') && gh run watch \"$RUN_ID\" --exit-status; echo '---EXIT:'$?'---'", run_in_background: true, timeout: 600000)`. The `sleep 5` is mandatory — without it `gh run list` returns the prior run because GitHub hasn't registered the new push yet, and `gh pr checks --watch` makes the same mistake (it returns the stale prior-run `pass` status and exits 0 immediately, hiding an in-progress / failing new run). Codified 2026-05-17 after this exact second violation in the same session as the original Rule-7 codification.
- Do NOT poll the background bash with `Read` — the harness notifies on completion. Polling burns cache + violates the "you'll be notified" rule.
- Squash-merge re-fires CI on main; the PR-side check going green does NOT exempt the post-merge main watch. Launch a separate background watcher for that run too.
- Skip ONLY for docs-only PRs that would hit `paths-ignore` (markdown / `_bmad/` etc.). If uncertain, watch anyway — wasted background bash costs nothing; missing a red CI is expensive.
- Never end a turn with "let me know if you want me to watch CI" — that phrasing IS the violation pattern.
- Memory: `[[feedback-monitor-ci-in-background]]` + `[[feedback-monitor-post-merge-ci-on-main]]` for canonical Bash patterns and rationale.

---

## Project Context

- **Project:** milton-browser-extension — Chromium MV3 browser extension that captures academic references and sends them to Milton's local connector
- **Sprint context:** Sprint 1 (MV1) shipped (BE-1 / BE-2 / BE-4 / BE-7). Sprint 2 (BE-8 — Zotero-Connector pivot for Class 2/3 capture parity) is active; charter at `_bmad-output/planning-artifacts/charter-v2.md`
- **License:** AGPL-3.0-or-later (`COPYING` at repo root; SPDX short-form headers on `src/**`). License chosen because BE-8-4 will import `zotero/translate` (AGPLv3) as a submodule
- **Tech Stack:** Vite 7 + CRXJS 2 + TypeScript 5.9 + Vitest 4 + (BE-8-4 will add) `zotero/translate` AGPL submodule
- **Distribution:** sideload-first (Load unpacked from `dist/`). Web Store packaging is a separate epic
- **IPC boundary with Milton-desktop:** HTTP-only at `127.0.0.1:7521` (local connector) and `translate.milton.so` (key broker + translation orchestrator). **Never import Milton-desktop code directly** (charter v2 standing rule; verified by `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returning zero hits)

### Companion repos / infrastructure

- **Milton-saas (private, https://github.com/Demandrel/Milton-saas):** the desktop app + connector + translator-mirror sync infra. When BE-8-N work needs to touch Milton's connector, that's two repos / two clones / two Claude sessions
- **Translator-mirror CDN:** served at `https://translators.milton.so/repo/`, mirrors `zotero/translators` upstream. Operated from Milton-saas's `tools/translator-mirror/` (private; visible to Demandrel members). The runtime in this repo fetches translator bytes from that CDN

### Dev-server caveat (adapted from Milton-saas)

- `pnpm dev` runs the Vite dev server for the popup. **This is fine to use** when iterating on UI — unlike Milton-saas's Tauri-app rule, the extension popup has no auto-update or background-state risk
- `pnpm build` produces the sideload-able `dist/` directory
- Do NOT publish anything to the Chrome Web Store without explicit user confirmation (treats web-store publish with the same care Milton-saas treats release tags)
