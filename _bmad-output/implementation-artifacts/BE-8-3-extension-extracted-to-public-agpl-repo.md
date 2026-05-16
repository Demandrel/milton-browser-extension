# Story BE-8.3: Extension Extracted to Public AGPL Repo

Status: done
Origin: Charter v2 Decision A1 (`tools/browser-extension/_bmad-output/planning-artifacts/charter-v2.md` line 54; commit `e5600694` / PR #33, merged 2026-05-15). Unambiguous AGPL boundary for the translator runtime that BE-8-4 imports as a submodule. Parallelizable greenfield extraction — no runtime code change, no Milton-desktop change.
Depends on: — (parallelizable with BE-8-1 done, BE-8-2 done)
Unblocks: BE-8-4 (translator runtime lift requires the extracted repo as its AGPL host), BE-8-5 (curated translator bundle build pipeline targets the new repo), BE-8-6 (Class 3 capture lives in the new repo), BE-8-7 (Class 2 capture lives in the new repo)
Theme: License execution (charter v2 Themes table)
Risk: Low-medium (charter v2 Story Map column)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pierre / Milton-saas maintainer,
I want the browser-extension code extracted from `tools/browser-extension/` into a standalone public GitHub repo `Demandrel/milton-browser-extension` under `AGPL-3.0-or-later` — with full git history preserved (`git filter-repo --subdirectory-filter`), CI replicated as an extension-only pipeline (no Tauri / Rust toolchain), and a deprecated stub left behind in Milton-saas that redirects readers to the new home,
so that BE-8-4's import of `zotero/translate` (AGPLv3) as a git submodule lands inside an unambiguously-AGPL repo (no risk of forcing Milton-desktop's source disclosure across the IPC boundary), CI cycles on extension PRs drop from a multi-minute Tauri+Rust build to a sub-minute pnpm pipeline, and BE-8-4/5/6/7 land their changes in a repo with the license posture their architecture requires.

## Acceptance Criteria

### AC1 — New public GitHub repo created with correct license + visibility metadata

- A public GitHub repository at `https://github.com/Demandrel/milton-browser-extension` exists, with:
  - Visibility: **public**
  - License (GitHub's `license` field, surfaced in the API + sidebar): **AGPL-3.0-or-later** (`AGPL-3.0` is the SPDX-canonical GitHub uses; the `COPYING` file MUST say `AGPL-3.0-or-later` per AC3)
  - Default branch: `main`
  - Description: one-line summary mirroring `tools/browser-extension/package.json` `description` field ("Save academic references to Milton from any browser tab.")
  - Topics: `browser-extension`, `manifest-v3`, `agpl`, `zotero`, `milton`, `references`
- Repo created via `gh repo create Demandrel/milton-browser-extension --public --license agpl-3.0 --description "<...>"` (or equivalent dashboard equivalence — Pierre owns the click if `gh` lacks permission).
- **Atypical:** if the slug `Demandrel/milton-browser-extension` is already taken (someone else registered it during the BE-8 sprint), fall back to `Demandrel/milton-extension` and update every charter / sprint-status / README reference accordingly in the same PR; flag the deviation in the story file Change Log.

### AC2 — Extension code extracted with full git history preserved via `git filter-repo`

- The new repo's `main` branch contains every Milton-saas commit that ever touched `tools/browser-extension/**`, rewritten so `tools/browser-extension/` becomes the new root (no `tools/browser-extension/` prefix).
- Extraction performed via `git filter-repo --subdirectory-filter tools/browser-extension` on a fresh clone of Milton-saas, then pushed to the new remote.
- `git log --oneline` in the new repo shows BE-1 / BE-2 / BE-4 / BE-7 / BE-8-1 / BE-8-2 commits with their original SHAs preserved as the source-of-truth (filter-repo rewrites hashes; new repo records the rewritten hashes, but commit messages, authors, and dates are unchanged).
- Commit authors are preserved (`Pierre Jacquel <…@…>` + any Claude co-author lines).
- **Atypical — `git filter-repo` not installed locally:** install via `brew install git-filter-repo` (preferred) OR `pip install git-filter-repo` (fallback); document the install command in the story file Change Log so retrospective replays know which path was used.
- **Atypical — extraction discovers commits that touched BOTH `tools/browser-extension/` AND other Milton-saas paths in the same commit** (e.g., a Story 18-1 commit that added `GET /tags` server-side AND consumed it in `tools/browser-extension/src/popup/`): filter-repo keeps only the file-tree slice; verify by spot-checking 2-3 such commits show ONLY the extension-side changes.

### AC3 — AGPL-3.0-or-later `COPYING` at repo root + per-file headers on first-party source

- New repo root contains a `COPYING` file with the full GNU AGPL v3 text (the SPDX-canonical https://www.gnu.org/licenses/agpl-3.0.txt content).
- Every first-party source file under `src/**` (`.ts`, `.html`, `.css`) carries the SPDX short-form header at the top:
  ```
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026  Demandrel SAS
  ```
  (HTML uses `<!-- ... -->`, CSS uses `/* ... */`.)
- `package.json` `license` field set to `"AGPL-3.0-or-later"` (overwriting BE-1's likely `"UNLICENSED"` / unset).
- Per-file headers added via a one-shot script (committed to the new repo at `scripts/add-spdx-headers.sh` for future-file enforcement, idempotent — won't double-add).
- **Atypical — generated files (`dist/**`, `node_modules/**`, `.svelte-kit/**`):** excluded from header pass via the script's gitignore-aware exclusion; verify `.gitignore` is preserved from extraction.
- **Atypical — test fixtures or data files that aren't really source:** skipped if extension is not `.ts | .html | .css | .json | .md`; package.json + tsconfig.json carry SPDX via their package-level `license` / a `// SPDX-License-Identifier: ...` comment line (JSON-with-comments is not valid; document the package.json `license` field as the SPDX source-of-truth and skip header insertion on `.json`).

### AC4 — CI workflow translated to extension-only pipeline (no Tauri / Rust)

- New repo's `.github/workflows/ci.yml` runs on `push` + `pull_request` to `main`, with the standard `paths-ignore` carve-out for `_bmad-output/**` + `**/*.md` (matches Milton-saas convention).
- Pipeline steps (single job, `runs-on: ubuntu-latest`):
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4` with `version: 10` (matches Milton-saas)
  3. `actions/setup-node@v4` with `node-version: '22'` + `cache: pnpm` + `cache-dependency-path: pnpm-lock.yaml` (NO `tools/browser-extension/` prefix — repo root IS the extension now)
  4. `pnpm install --frozen-lockfile`
  5. `pnpm typecheck` (tsc --noEmit)
  6. `pnpm test` (vitest run — current unit tests for `auth-client`, `connector-client`, `translation-client`, `metadata-to-payload`, `tag-colors`, `popup-helpers`)
  7. `pnpm build` (vite build → `dist/`)
  8. Upload `dist/` as a workflow artifact (named `milton-browser-extension-<sha>.zip`) for downstream sideload by reviewers
- **NO** Tauri system-deps install. **NO** Rust toolchain. **NO** `awalsh128/cache-apt-pkgs-action`. **NO** `Swatinem/rust-cache`. **NO** `pnpm svelte-kit sync` / `pnpm panda codegen`.
- `timeout-minutes: 10` (extension build is sub-minute; 10 is generous headroom for cache miss).
- **Atypical — package manager drift:** if `pnpm-lock.yaml` in `tools/browser-extension/` was generated against pnpm 10.x (verified pre-extraction), `--frozen-lockfile` will green-light. Otherwise, regenerate the lockfile pre-extraction in Milton-saas and commit before the filter-repo run — DO NOT regenerate in the new repo as the first commit, that breaks the history-preservation goal.

### AC5 — Repo hygiene: README, `.gitignore`, `.npmrc`, `.env.local.example` carry over verbatim

- `README.md` at the new repo root is the CURRENT `tools/browser-extension/README.md` (492 lines as of this story's draft) with:
  - All relative paths fixed (`../translator-mirror/README.md` → an absolute URL to `https://github.com/Demandrel/Milton-saas/tree/main/tools/translator-mirror`)
  - The "Charter + sprint" links repointed to **paths inside the new repo** (`_bmad-output/planning-artifacts/charter-v2.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`)
  - Add a top-of-README badge row: AGPL-3.0-or-later license badge + CI status badge
  - Add a "## License" section above "## Charter + sprint" with a one-paragraph AGPL disclosure
- `.gitignore`, `.npmrc`, `.env.local.example` carry forward unchanged from extraction.
- `.env.local` (Pierre's local file, gitignored) is NOT in the extracted history (validate: `git log --all --full-history -- .env.local` returns empty).
- **Atypical — pre-extraction `.gitignore` already excluded `_bmad-output/**`:** verify that's NOT the case (current `tools/browser-extension/_bmad-output/` is checked in — story files + sprint-status need to ship). If `_bmad-output/` is somehow in `.gitignore`, remove that line in Milton-saas pre-extraction.

### AC6 — First CI run green; first sideload-able artifact produced

- Push the rewritten history to `Demandrel/milton-browser-extension:main` with `git push --force` (force-needed because the repo's initial autoinit commit from `gh repo create --license agpl-3.0` is replaced).
- The first GitHub Actions run for the push completes green (all steps pass — install, typecheck, test, build).
- The `dist/` artifact from the run is downloadable + sideload-tested by Pierre in Chrome (Load unpacked → toolbar icon appears → popup opens → `GET /health` to local Milton connector returns 200).
- **Atypical — first run reds:** standard pattern (fix in a follow-up commit, re-push, re-watch); not a blocker for the story to land. The blocker is "first GREEN run exists" before the deprecated stub PR merges in Milton-saas.

### AC7 — Deprecated stub left in `tools/browser-extension/` of Milton-saas

- After extraction, in a Milton-saas PR (`chore(BE-8-3): deprecate tools/browser-extension, extracted to Demandrel/milton-browser-extension`):
  - Delete every file under `tools/browser-extension/` EXCEPT:
    - A new minimalist `tools/browser-extension/README.md` (≤30 lines) that says ONLY:
      - "This subtree has been extracted to https://github.com/Demandrel/milton-browser-extension"
      - License: AGPL-3.0-or-later
      - Cutover commit: `<this-PR's-merge-SHA>` in Milton-saas; `<filter-repo-run-SHA>` in new repo
      - Reason: charter v2 Decision A1 (link to charter-v2.md)
      - For the BMAD planning trail, sprint-status + charter-v2 are now mirrored in the new repo at `_bmad-output/`
    - **OPTIONAL** preserve `_bmad-output/` here too as a frozen snapshot if the BMAD memory references it; otherwise move with the code. Decision: **delete `tools/browser-extension/_bmad-output/` from Milton-saas** (the canonical version lives in the new repo now) and let history preserve the snapshot.
  - The deprecated stub README is the ONLY remaining file under `tools/browser-extension/` in Milton-saas after the stub PR merges.
- `tools/translator-mirror/` is UNTOUCHED in Milton-saas (per Pierre's decision: translator-mirror stays here; only the extension moves).
- **Atypical — Milton-saas has open PRs that touch `tools/browser-extension/` at extraction time:** rebase or coordinate close before the stub PR merges, otherwise those PRs will conflict catastrophically. Story task includes a `gh pr list --search "tools/browser-extension"` check pre-extraction.

### AC8 — Charter v2 + sprint-status.yaml updated to reflect post-extraction reality

- Within the new repo at `_bmad-output/planning-artifacts/charter-v2.md`:
  - The "Predecessors" table's BE-1/BE-2/BE-7 rows are unchanged (history pointers are fine cross-repo).
  - Add a "Repo Extraction" subsection under Locked Decisions A row: "Extracted 2026-05-DD via BE-8-3 PR #N (Milton-saas) + commit `<sha>` (new repo)."
- Within the new repo at `_bmad-output/implementation-artifacts/sprint-status.yaml`:
  - `epic-be-8: in-progress` (unchanged)
  - `BE-8-3-extension-extracted-to-public-agpl-repo: done` (flipped on story close — the dev-agent does this at handoff)
  - The header comment block updated: `story_location:` repointed from `tools/browser-extension/_bmad-output/...` to the new repo's `_bmad-output/...` path
- Within Milton-saas's main `_bmad-output/implementation-artifacts/sprint-status.yaml` (the master tracker): NO change needed — BE-8 stories were never tracked there (epic-8 in that file is the documentation epic, not browser-extension). Verify with `grep -i be-8 _bmad-output/implementation-artifacts/sprint-status.yaml` — should return zero hits.
- **Atypical — `_bmad-output/` files reference relative paths that break post-extraction:** sweep for `../` patterns in charter-v2.md and story files; fix in the same commit that lands them in the new repo.

### AC9 — IPC-boundary self-check explicit + passes

- The Milton-saas stub PR description includes the standing self-check (charter v2 Risks table line): **"Does this PR violate the IPC boundary (i.e., does Milton-desktop import extension code or vice versa)? — No. This PR REMOVES the extension subtree; nothing under `milton/` or `tools/translator-mirror/` imports the extension."**
- The new repo's first commit's PR description (the force-push initialization) carries the same self-check: **"Does any code in this repo import Milton-desktop / connector / Tauri APIs directly? — No. The extension talks to Milton ONLY via the local connector at `127.0.0.1:7521` (HTTP) and to `translate.milton.so` (HTTPS). No code-level imports of `milton/src-tauri/**` or `milton/src/**` exist."**
- Verify by `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" <new-repo>/src` returning zero hits.

### AC10 — End-to-end smoke: sideloaded build from new repo's CI artifact still works against Milton-desktop

Pierre-owned smoke (G17-1 HARD gate — UI / runtime surface, JSDOM-blind):

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | Download `milton-browser-extension-<sha>.zip` artifact from first green CI run on new repo | Unzip yields a `dist/` directory with `manifest.json`, `popup.html`, JS bundles |
| 2 | `chrome://extensions/` → Developer mode ON → Load unpacked → select `dist/` | Toolbar icon appears; popup opens on click |
| 3 | Open `https://arxiv.org/abs/2303.08774` → click toolbar icon → click Save | Toast in Milton "Reference added from browser"; library shows new ref |
| 4 | Quit Milton-desktop → click toolbar icon | "Milton isn't running" + Open Milton deep-link works |
| 5 | Sign out of Milton → click toolbar icon | "Sign in to Milton" + Open Milton deep-link works |
| 6 | BE-7 regression: `https://www.econstor.eu/bitstream/10419/32581/1/623739976.pdf` | Reference created; PDF attached within ~30s (same as pre-extraction) |
| 7 | BE-7 regression: `https://arxiv.org/abs/2303.08774` (HTML abs page) | Reference created; PDF auto-attached via OA discovery (same as pre-extraction) |

All 7 must pass before story flips `review → done`. If any red, fix in the new repo and re-smoke.

### AC11 — Cross-repo discoverability: Milton-saas root README + docs link to the new repo

- Milton-saas root `README.md` (if a "Sub-projects" / "Companion repos" section exists, ADD to it; otherwise add a new short "## Companion Repositories" section above "License"):
  - One line: `- [milton-browser-extension](https://github.com/Demandrel/milton-browser-extension) — Chromium MV3 extension (AGPL-3.0-or-later), extracted from `tools/browser-extension/` in BE-8-3.`
- `docs/developer-guide/` (if a "Sub-projects" page exists) gets the same pointer. If no such page exists, this is a no-op — the deprecated stub README + root README are sufficient discovery surface.
- **Atypical — Milton-saas root README has no obvious place for a sub-project list:** create a "## Companion Repositories" section as the natural home; don't force-fit it into an unrelated section.

## Tasks / Subtasks

Convention from BE-8-1: `[D]` = dev-agent owned (code / git / gh CLI), `[P]` = Pierre-owned (dashboard click, hardware-key custody, local sideload smoke). Subtasks numbered `N.M`.

- [x] **Task 1 — Pre-flight checks before extraction** (AC: #1, #2, #5, #7) — completed 2026-05-16
  - [x] 1.1 [D] `gh pr list --search "tools/browser-extension"` → ZERO open PRs touching the subtree. ZERO open Milton-saas PRs total. Clean main.
  - [x] 1.2 [D] `gh repo view Demandrel/milton-browser-extension` → 404 (slug available). **Drift finding:** `gh repo list Demandrel` shows `Demandrel/Milton-saas` as `private`, not public as charter v2 claimed. Pierre 2026-05-16: keep Milton-saas private; ship BE-8-3 with auth-gated cross-links (charter correction handled in Task 7 sweep).
  - [x] 1.3 [D] `git-filter-repo` was missing. Installed via `brew install git-filter-repo` (version 2.47.0, at `/opt/homebrew/bin/git-filter-repo`). `git filter-repo --help` confirms callable as git subcommand.
  - [x] 1.4 [D] `pnpm install --ignore-workspace --frozen-lockfile --prefer-offline` succeeded in 283ms (cached). Lockfile current; no regeneration needed. (Pre-existing `esbuild@0.27.7` build-scripts warning is non-blocking.)
  - [x] 1.5 [D] `git log --all --full-history -- tools/browser-extension/.env.local` returned EMPTY. Same for `.env*`, `secrets*`, `*.key`, `*.pem` globs. Clean — no sensitive files ever committed; no `--invert-paths` redaction pass needed.
  - [x] 1.6 [D] Found 7 `../` paths in `_bmad-output/**` + `README.md` that break post-extraction (BE-8-1 story file has 6 — translator-mirror back-link, product brief, research, translation-server, ci.yml, README; BE-8-3 story has 1; `tools/browser-extension/README.md` has 1 — translator-mirror back-link). Task 7 will fix all to absolute Milton-saas URLs (note: those URLs are auth-gated since Milton-saas is private — accepted per Pierre 2026-05-16).

- [x] **Task 2 — Create the new public repo with correct metadata** (AC: #1) — completed 2026-05-16
  - [x] 2.1 [D] `gh repo create Demandrel/milton-browser-extension --public --license agpl-3.0 --description "..."` succeeded; gh CLI ran without dashboard intervention (Pierre's `Demandrel` account has org create permission). Repo live at https://github.com/Demandrel/milton-browser-extension.
  - [x] 2.2 [D] `gh repo edit --add-topic ...` added all 6 topics in one call. Verified via repositoryTopics field below.
  - [x] 2.3 [D] `gh repo view --json isPrivate,licenseInfo,defaultBranchRef,description,repositoryTopics` returned: `{"defaultBranchRef":{"name":"main"},"description":"Save academic references to Milton from any browser tab.","isPrivate":false,"licenseInfo":{"key":"agpl-3.0","name":"GNU Affero General Public License v3.0","nickname":"GNU AGPLv3"},"repositoryTopics":[{"name":"agpl"},{"name":"browser-extension"},{"name":"manifest-v3"},{"name":"milton"},{"name":"references"},{"name":"zotero"}]}`. All 5 AC1 metadata gates green. (Note: gh CLI's `--json` schema uses `isPrivate` not `visibility`; story Task 2.3 corrected.)

- [x] **Task 3 — Extract `tools/browser-extension/` with history-preserving filter-repo** (AC: #2) — completed 2026-05-16
  - [x] 3.1 [D] Throwaway clone at `/tmp/milton-saas-be8-3-extraction` (HEAD `19cff63f`, 537 commits, 8 root entries in `tools/browser-extension/`). 13 commits touch the subtree ever.
  - [x] 3.2 [D] `git filter-repo --subdirectory-filter tools/browser-extension` succeeded. 537 → 13 commits in 0.47s rewrite + 1.14s repack. `origin` auto-removed (filter-repo safety). Root tree: `src/`, `package.json`, `vite.config.ts`, `_bmad-output/`, `README.md`, `.gitignore`, `.npmrc`, `.env.local.example`, `manifest.config.ts`, `pnpm-lock.yaml`, `tsconfig.json` — all flattened correctly.
  - [x] 3.3 [D] History density: 13 commits (BE-1 PR #21 → BE-8-2 PR #40 lineage + 3 pre-BE-1 planning commits). Authors: `Pierre Jacquel <pierre.jacquel@outlook.fr>` (sole author). Co-author trailers preserved in commit bodies (verified on `1e28cd0` chore(BE-8) sprint planning — body has `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`).
  - [x] 3.4 [D] Spot-checked `1e28cd0` (chore(BE-8) sprint planning — touched ONLY extension's `_bmad-output/`) and `3e43aeb` (chore(auth) story drafts — kept because it added story drafts under `tools/browser-extension/_bmad-output/`, even though commit message references TS-6/TS-7/18-15 server-side work; correctly filtered).
  - [x] 3.5 [D] HTTPS origin re-added (matching gh CLI's `git operations: https` config), force-push succeeded: `+ d42e037...ad60d7e main -> main (forced update)`. gh-autoinit commit `d42e037` (with AGPL-3.0 `LICENSE`) replaced by `ad60d7e` (BE-8-2 HEAD).
  - [x] 3.6 [D] No CI watch needed — the filter-repo'd tree has no `.github/workflows/` (Milton-saas's `.github/` lives at repo root, not under `tools/browser-extension/`). Force-push triggered ZERO CI runs. Task 5 adds the extension-only `ci.yml` which will fire on its own bootstrap PR.

- [x] **Task 4 — Add AGPL `COPYING` + per-file SPDX headers in the new repo** (AC: #3) — completed 2026-05-16
  - [x] 4.1 [D] Worked in the throwaway clone (now at `/tmp/milton-saas-be8-3-extraction`) which is functionally equivalent to a fresh new-repo clone (origin re-pointed at the new repo post-Task-3.5). Saved a re-clone round-trip.
  - [x] 4.2 [D] Branch `chore/bootstrap-license-ci-bmad-trail`. `COPYING` fetched from `https://www.gnu.org/licenses/agpl-3.0.txt` (661 lines, 34523 bytes, SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`).
  - [x] 4.3 [D] `package.json` updated: `"license": "AGPL-3.0-or-later"` + `author: "Pierre Jacquel"` + `repository` + `homepage` + `bugs` fields added (matches `Demandrel/agentink` precedent).
  - [x] 4.4 [D] `scripts/add-spdx-headers.sh` written: idempotent (skip if `SPDX-License-Identifier` in first 200 bytes). 4-line SPDX header per file, comment style by extension (`.ts` → `//`, `.css` → `/* */`, `.html` → `<!-- -->`). Env overrides: `YEAR` (default current year), `AUTHOR` (default `Pierre Jacquel`).
  - [x] 4.5 [D] Ran script: 17 files headered, 0 skipped on first run. Re-run idempotency check: 0 added, 17 skipped (confirms idempotency). Sample (`src/popup/popup.ts` first 5 lines): `// SPDX-License-Identifier: AGPL-3.0-or-later / // Copyright (C) 2026  Pierre Jacquel / // / // This file is part of milton-browser-extension. / // See COPYING for license terms.`
  - [x] 4.6 [D] Combined with Tasks 5 + 7 into single bootstrap PR (dev-agent's call per [[feedback-ci-discipline-one-per-pr]] — one CI run for the bootstrap rather than three).

- [x] **Task 5 — Translate CI to extension-only pipeline** (AC: #4, #6) — completed 2026-05-16
  - [x] 5.1 [D] `.github/workflows/ci.yml` written: 8 steps (checkout → pnpm setup v4@10 → node@22 with pnpm cache → install --frozen-lockfile → typecheck → test → build → upload dist/ artifact). `timeout-minutes: 10`.
  - [x] 5.2 [D] `paths-ignore` includes `**/*.md`, `**/*.mdx`, `_bmad-output/**`, `.gitignore`, `COPYING`. Skips CI on docs/planning PRs.
  - [x] 5.3 [D] Pushed bootstrap branch; CI run ID 25970454938 fired. Live: https://github.com/Demandrel/milton-browser-extension/actions/runs/25970454938. Background-watched per [[feedback-monitor-ci-in-background]] — pending Pierre's smoke (Task 8) on green.
  - [x] 5.4 [D] Once green, `dist/` artifact downloadable from the CI run URL (named `milton-browser-extension-c405ce9c...`).

- [-] **Task 6 — Port pre-push hook + setup script (optional / nice-to-have)** (AC: #6 implicitly) — SKIPPED per Task 6.4 escape hatch
  - [x] 6.4 [D] Skipped — new repo's CI gates serve the same purpose for a 1-developer extension. No `format:check` / `lint:reactive` scripts exist in the extension's `package.json`. Local validation runs the same set (`pnpm install + typecheck + test + build`) on demand. If/when a hook becomes useful, the pattern from Milton-saas's `.githooks/pre-push` lands then.

- [x] **Task 7 — Update `_bmad-output/` inside the new repo + IPC self-checks** (AC: #8, #9) — completed 2026-05-16
  - [x] 7.1 [D] Charter v2 `../` paths fixed; "Repo Extraction" subsection added under Decision A1 row.
  - [x] 7.2 [D] Charter v2 Decision A1 row amended: "Milton-saas already public" drift corrected — Milton-saas is private as of 2026-05-16; A1 row now records extraction completion + cutover SHAs.
  - [x] 7.3 [D] sprint-status.yaml header: `story_location:` repointed from `tools/browser-extension/_bmad-output/...` to `_bmad-output/...` (post-extraction paths). `repository:` field added. Charter paths in comment block updated. BE-8-3 entry flipped `backlog → in-progress` to match Milton-saas-side state.
  - [x] 7.4 [D] BE-8-1 story file `../` paths fixed: charter-v2 link to intra-repo relative; product brief + zotero research + translation-server README + Milton-saas ci.yml all converted to absolute `https://github.com/Demandrel/Milton-saas/...` URLs (auth-gated, accepted per Pierre 2026-05-16); this repo's README link adjusted to `../../README.md` (intra-repo relative). Historical/template references in code blocks (lines 906, 1450) left unchanged — they're documentation of past state.
  - [x] 7.5 [D] Combined into bootstrap PR with `chore(bootstrap): AGPL license + CI + BMAD post-extraction sweep` title. PR body includes the IPC self-check verbatim per AC9.
  - [x] 7.6 [D] `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` returned ZERO hits — pasted in PR body as boundary evidence.

- [ ] **Task 5 — Translate CI to extension-only pipeline** (AC: #4, #6)
  - [ ] 5.1 [D] On the same `license/agpl-3.0` branch (or a separate `ci/initial-pipeline` branch — dev-agent's call): write `.github/workflows/ci.yml` with the 8-step pipeline per AC4.
  - [ ] 5.2 [D] Add `paths-ignore` block matching Milton-saas's pattern: `**/*.md`, `**/*.mdx`, `_bmad-output/**`, `.gitignore`, `LICENSE`, `COPYING`. (NB: `COPYING` added vs Milton-saas's list, since AGPL puts the license text there.)
  - [ ] 5.3 [D] Push branch; verify first CI run completes green (~1-2 min target). If red, fix in follow-up commit + re-watch (one CI run per PR per [[feedback-ci-discipline-one-per-pr]]).
  - [ ] 5.4 [D] Capture the `dist/` artifact URL from the green run for Task 8 (Pierre's smoke).

- [ ] **Task 6 — Port pre-push hook + setup script (optional / nice-to-have)** (AC: #6 implicitly)
  - [ ] 6.1 [D] Check if `.githooks/pre-push` from Milton-saas is meaningful for the extension repo. Milton-saas's hook runs `format:check + lint:reactive + check + test --run` — extension has no `format:check` script in `package.json`, no `lint:reactive`. Adapt: just `pnpm typecheck && pnpm test && pnpm build` (~10s on M2 — fast enough to be useful).
  - [ ] 6.2 [D] Port `scripts/setup-hooks.sh` adapted for the simpler hook content.
  - [ ] 6.3 [D] Run `bash scripts/setup-hooks.sh` locally + verify `core.hooksPath` is set + verify a no-op push runs the hook.
  - [ ] 6.4 If time-boxed: skip Task 6 entirely — the new repo's CI gates serve the same purpose for a 1-developer extension. Document the skip in the Change Log with rationale.

- [ ] **Task 7 — Update `_bmad-output/` inside the new repo + IPC self-checks** (AC: #8, #9)
  - [ ] 7.1 [D] Sweep `_bmad-output/planning-artifacts/charter-v2.md` for `../` relative paths; fix to absolute Milton-saas URLs.
  - [ ] 7.2 [D] Add the "Repo Extraction" subsection under Locked Decisions A row in charter-v2.md per AC8.
  - [ ] 7.3 [D] In `_bmad-output/implementation-artifacts/sprint-status.yaml`: update the header `story_location:` field. Leave `BE-8-3-extension-extracted-to-public-agpl-repo: backlog` for now — the flip to `done` is the dev-agent's last action when the deprecated stub merges.
  - [ ] 7.4 [D] Sweep BE-1/BE-2/BE-4/BE-7/BE-8-1/BE-8-2 story files for `../` paths that break post-extraction; fix in the same PR.
  - [ ] 7.5 [D] Open PR with title `chore(bmad): post-extraction _bmad-output sweep` and body including the IPC-boundary self-check verbatim per AC9.
  - [ ] 7.6 [D] `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" src` MUST return zero hits — paste the empty-grep evidence into the PR body.

- [x] **Task 8 — Pierre's smoke (G17-1 HARD gate)** (AC: #6, #10) — completed 2026-05-16
  - [x] 8.1 [D] Bootstrap PR #1 CI green (21s); artifact `milton-browser-extension-3c25ca33...` (30,959 bytes) pre-downloaded + unzipped to `~/Downloads/be-8-3-smoke/`.
  - [x] 8.2 [P] Pierre sideloaded the unzipped dist/ into Chrome via Load unpacked. Toolbar icon appeared.
  - [x] 8.3 [P] Pierre ran all 7 scenarios from AC10. Result: **7/7 green** ("done all 7, all green" — 2026-05-16).
  - [x] 8.4 [D] No reds; loop exit not needed.
  - [x] 8.5 [D] Smoke result recorded in Change Log.

- [x] **Task 9 — Land the deprecated stub PR in Milton-saas** (AC: #5, #7, #11) — completed 2026-05-16
  - [x] 9.1 [D] Branch `chore/be-8-3-deprecate-extension-subtree` was already cut at Task 0 setup (off `main@19cff63f`).
  - [x] 9.2 [D] `git rm -rf tools/browser-extension/` — 40 files deleted (`-f` required because BE-8-3 story file had uncommitted edits; safe because those edits were already mirrored to new repo as commit `3c4789e`).
  - [x] 9.3 [D] New `tools/browser-extension/README.md` written: 22 lines, deprecation stub pointing at new repo + cutover SHAs (`ad60d7e` filter-repo HEAD + `eb2daf2b` bootstrap PR squash-merge) + charter v2 link.
  - [x] 9.4 [D] Milton-saas root `README.md` updated: added `## Companion Repositories` section after `## Project Structure`; `tools/` line added to Project Structure code block (was missing entirely).
  - [x] 9.5 [D] No `docs/developer-guide/sub-projects.mdx` exists in Milton-saas; no-op (documented).
  - [x] 9.6 [D] Pre-push hook fired all 4 gates: format:check ✅ / lint:reactive ✅ / check ✅ / test 2799/2799 in 80.56s ✅.
  - [x] 9.7 [D] `gh pr create` opened https://github.com/Demandrel/Milton-saas/pull/42 with IPC-boundary self-check verbatim in body.
  - [x] 9.8 [D] `gh run watch 25970858399` background-watched per [[feedback-monitor-ci-in-background]]. Conclusion: `success` after 13m12s.
  - [x] 9.9 [D] Merge call surfaced per [[feedback-claude-owns-merge-call-at-story-close]]: "BE-8-3 stub PR #42 — gates green · recommend merge."
  - [x] 9.10 [D] Pierre "go" → `gh pr merge 42 --squash --delete-branch`. Squash commit `7ddcf647` on Milton-saas main. Post-merge main CI watch run `25971158252`: `success` after 13m35s.

- [x] **Task 10 — Story closeout** (AC: #8) — completed 2026-05-16
  - [x] 10.1 [D] New repo `_bmad-output/implementation-artifacts/sprint-status.yaml`: BE-8-3 flipped `in-progress → done`. Pushed to main (paths-ignored — no CI run).
  - [x] 10.2 [D] All gates green confirmed before flip per [[feedback-never-mark-done-before-everything-green]]: bootstrap PR pre-merge CI `success` · new repo post-merge main CI `success` · Milton-saas PR #42 pre-merge CI `success` · Milton-saas post-merge main CI `success` · Pierre G17-1 smoke 7/7. NO exceptions.
  - [x] 10.3 [D] Change Log captures entire flow.
  - [x] 10.4 [D] Surfaced to Pierre with done call + unblocked-stories list (BE-8-4 translator runtime lift is the natural next). Next-story call belongs to Pierre per [[feedback-pierre-owns-epic-scope]].

## Dev Notes

### Architectural posture (the WHY behind this story)

- Charter v2 Decision A1 locks: extension extracts to a **separate public AGPL repo** even though Milton-saas (parent) is already public. The reason is unambiguous license signaling. Once BE-8-4 imports `zotero/translate` as a submodule, the surrounding repo's `LICENSE` is the canonical license-of-the-whole-work. Keeping the translator runtime inside Milton-saas would create a "is Milton-desktop affected by AGPL?" ambiguity nobody benefits from. Extracting closes it cleanly: extension repo = AGPL-3.0-or-later (translator runtime + extension first-party code); Milton-saas = unchanged (currently MIT-or-equivalent based on existing `LICENSE`); IPC boundary = HTTP-only across `127.0.0.1:7521` + `translate.milton.so` (no code-level imports either direction, validated by AC9 grep).
- This is the **second** sub-project extraction-or-equivalent in the BE-8 sprint. BE-8-1 established `tools/translator-mirror/` as a separate Coolify-deployed service (also operationally standalone). BE-8-3 takes the next step: full repo extraction, not just operational separation.
- North star: Pierre uninstalls Zotero Connector after a week of BE-v2 dogfood. This story doesn't move that needle directly — it's pure license execution housekeeping. But every story from BE-8-4 onward lands in the new repo, so getting the extraction right unblocks the capture-parity work that DOES move the needle.

### Source tree (what BE-8-3 touches)

- **`tools/browser-extension/`** (Milton-saas, current home — being deleted):
  - `src/` — popup TS (`popup/popup.ts`, `popup/popup-helpers.ts`), popup HTML + CSS, lib modules (`lib/auth-client.ts`, `lib/connector-client.ts`, `lib/translation-client.ts`, `lib/metadata-to-payload.ts`, `lib/tag-colors.ts`, `lib/types.ts`), Chrome type augmentation (`chrome-augment.d.ts`)
  - Build config: `package.json` (Vite 7 + CRXJS 2 + TypeScript 5.9 + Vitest 4), `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `manifest.config.ts`, `.npmrc` (`ignore-workspace=true`), `.env.local.example`, `.gitignore`
  - Tests: 6 Vitest files co-located (`*.test.ts`)
  - BMAD trail: `_bmad-output/planning-artifacts/{charter.md, charter-v2.md}`, `_bmad-output/implementation-artifacts/{sprint-status.yaml, BE-1/2/4/7/8-1/8-2 story files}`
  - README.md (492 lines — comprehensive; carries forward verbatim with path rewrites per AC5)
- **`tools/translator-mirror/`** (Milton-saas) — **STAYS** here. Untouched by BE-8-3.
- **`.github/workflows/`** (Milton-saas) — `translator-mirror-sync.yml` STAYS. `ci.yml`, `release.yml`, `release-mirror.yml` STAY (those are Milton-desktop's, not the extension's).
- **New repo `Demandrel/milton-browser-extension`** — receives the extracted subtree + `COPYING` + SPDX headers + new `.github/workflows/ci.yml` (translated, extension-only). `dist/` artifacts generated by CI.

### git filter-repo invocation specifics

- Install (one of):
  - `brew install git-filter-repo` (macOS, preferred — Pierre's host)
  - `pip install git-filter-repo` (cross-platform fallback)
  - `git-filter-repo` is the **third-party** rewriter recommended by the git project itself; `git filter-branch` is deprecated and slow.
- Invocation: `git filter-repo --subdirectory-filter tools/browser-extension` — Path semantics: makes `tools/browser-extension/` the new repo root; everything else is removed from history.
- **CRITICAL**: filter-repo refuses to run against a clone that has any "named remote" configured by default — it auto-removes the `origin` remote (a safety measure) and warns. That's why Task 3.5 re-adds the remote pointing at the new repo. Do NOT run filter-repo against the active worktree; ALWAYS work in a throwaway clone (Task 3.1).
- Commit-author preservation is automatic. Co-author trailers (`Co-Authored-By: Claude ... <noreply@anthropic.com>`) survive as commit-message content — they're not "git authors" so filter-repo doesn't touch them.
- Hash rewrite: every commit gets a new SHA because the tree changed. Old SHAs are unrecoverable from the new repo's history; if memory or PR descriptions reference Milton-saas SHAs, those references stay valid IN MILTON-SAAS forever. Don't try to "round-trip" mappings.

### AGPL-3.0-or-later: per-file headers vs umbrella

- `COPYING` at repo root is the canonical license text. GNU's convention is `COPYING` for AGPL/GPL/LGPL (not `LICENSE`); GitHub's `license` detection recognizes both, but stick to `COPYING` for AGPL signaling clarity. Source: https://www.gnu.org/licenses/gpl-howto.html
- SPDX short-form header format (per the SPDX spec — see https://spdx.dev/learn/handling-license-info/):
  ```
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026  Demandrel SAS
  //
  // This file is part of milton-browser-extension.
  // See COPYING for license terms.
  ```
  (The 4-line variant above is recommended for first-party AGPL code. The minimal `// SPDX-License-Identifier: AGPL-3.0-or-later` is technically sufficient but less helpful to readers.)
- `package.json` `"license": "AGPL-3.0-or-later"` is the SPDX identifier (NOT `"AGPL-3.0"` — the `-or-later` suffix matters legally; it permits future AGPL versions per FSF guidance).
- AGPL-3.0 vs AGPL-3.0-only vs AGPL-3.0-or-later: pick `AGPL-3.0-or-later` for first-party code. `zotero/translate` upstream uses AGPLv3 without specifying `-only` or `-or-later` (their `COPYING` is the bare v3 text) — that's compatible with our `-or-later` choice because the `-or-later` permission is granted by US (the new code), not by them.
- **DO NOT** add headers to upstream/imported code that has its own headers. For BE-8-3 there's no such code yet — every `src/**` file is first-party. BE-8-4 will introduce `zotero/translate` as a submodule with its own AGPL headers; leave those alone.

### CI translation: what the extension repo's `ci.yml` does NOT need

Inheriting Milton-saas's `ci.yml` blindly would pull in:
- `awalsh128/cache-apt-pkgs-action@v1` installing `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf` — NOT NEEDED (no Tauri build in extension)
- `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` — NOT NEEDED (no Rust)
- `pnpm svelte-kit sync` + `pnpm panda codegen` — NOT NEEDED (no SvelteKit)
- `timeout-minutes: 40` — DROP to 10 (extension build is sub-minute; cache miss adds maybe 30s)
- `cache-dependency-path: 'pnpm-lock.yaml'` in Milton-saas pointed at root; in the extension repo, root IS the extension, so the same path string works post-extraction (no `tools/browser-extension/` prefix needed)

Translated `ci.yml` is ~30 lines vs Milton-saas's ~200. Reference shape:
```yaml
name: CI
on:
  push: { branches: [main], paths-ignore: [...] }
  pull_request: { branches: [main], paths-ignore: [...] }
jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: pnpm, cache-dependency-path: pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with: { name: milton-browser-extension-${{ github.sha }}, path: dist/ }
```

### IPC boundary discipline (charter v2 standing rule)

Every BE-8-* PR description includes an explicit Yes/No on: "Does this PR violate the IPC boundary (i.e., does Milton-desktop import extension code or vice versa)?" For BE-8-3 the answer is firmly **No** on BOTH sides (the deprecated stub PR in Milton-saas REMOVES the subtree; the new repo's first commit has no Milton-desktop imports).

The boundary is enforced HTTP-only:
- Extension → Milton-desktop: HTTP to `127.0.0.1:7521` (`/health`, `/auth/issue-token`, `/references`, `/tags`, `/projects`, `/collections`, and BE-8-2's `/references/{id}/pdf-bytes`)
- Extension → Milton-server: HTTPS to `translate.milton.so` (`/metadata`, `/web`)
- Milton-desktop → Extension: NEVER (Milton-desktop has no awareness of the extension's code or repo)

AC9's grep is the mechanical proof: `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" <new-repo>/src` MUST return zero. If non-empty: surface to Pierre IMMEDIATELY, do not push, do not extract — investigate first.

### Previous story intelligence

**From BE-8-1 (PR #35, merged 2026-05-16) — translator-mirror CDN setup:**
- Sub-project standalone posture is **deliberate** — `tools/*` are NOT in `pnpm-workspace.yaml`, installed with `pnpm install --ignore-workspace`, lockfile lives in the sub-project dir. Pierre/dev-agent already validated this works; BE-8-3 inherits a known-good standalone surface.
- GitHub Actions pinned versions (must match): `actions/checkout@v4`, `pnpm/action-setup@v4` with `version: 10`, `actions/setup-node@v4` with `node-version: '22'` + `cache: pnpm`. New repo `ci.yml` uses identical pins.
- PR title convention: `feat(BE-N): ...` for code PRs, `chore(BE-N): ...` for sprint-status / mark-done / deprecated-stub PRs. BE-8-3 has TWO PRs: the Milton-saas deprecated-stub PR is `chore(BE-8-3): ...`; the new repo's initial commit is a force-push to `main` (no PR), and the AGPL-license PR + CI-pipeline PR (Tasks 4-5) are `chore(license): ...` and `ci(infra): ...` against the new repo.
- AGPL boundary was already flagged in BE-8-1's open questions: "(a) does `tools/translator-mirror/` move with the extension or stay in Milton-saas?" — **resolved 2026-05-16 by Pierre: STAYS in Milton-saas.** BE-8-3 honors that decision.
- Worktree friction (G19-1) is active: when this story is implemented in a fresh worktree, run `pnpm install --prefer-offline && pnpm typecheck && pnpm test` BEFORE first push, even with the pre-push hook installed.

**From BE-8-2 (PR #40, merged 2026-05-16) — connector bytes endpoint:**
- Milton-desktop-side ONLY — touched `milton/src-tauri/src/connector/{server.rs, handlers.rs, payload.rs, telemetry.rs}` + `milton/src-tauri/src/commands/pdf_fetch.rs` + tests. ZERO touches under `tools/browser-extension/`. The IPC-boundary self-check passed cleanly. BE-8-3's deprecated stub PR has the same shape: cross-boundary in the OTHER direction (touches `tools/browser-extension/` + Milton-saas root README; ZERO touches under `milton/`). The IPC self-check is a 5-second cognitive check at PR-body time, not a code-level burden.
- Pre-Review Self-Check pattern: BE-8-2 explicitly marked the project-wide checklist items N/A with reason (`[x] No raw hex color values — N/A, no UI surface`, `[x] $effect dependencies checked — N/A, no Svelte runes`). BE-8-3 does the same — virtually every item is N/A because the story is git/gh CLI + Markdown only.
- Change Log discipline: BE-8-2 has dated rows for every notable transition (drafted, dev complete, code-review, smoke-fix, merged). BE-8-3 follows the same density.

**From BE-7 (PR #30, merged 2026-05-15) — auto-attach PDF on extension save:**
- The `tools/browser-extension/README.md` Smoke test table includes 4 BE-7 scenarios (econstor + arXiv direct PDF + arXiv abs + .pdf.html negative). AC10's smoke matrix imports the 2 most important (econstor + arXiv abs) as regression checks — if BE-7 breaks post-extraction, the extension extraction is broken.
- BE-7 was the first BE-N to cross into `milton/src-tauri/` (added `connector::handlers` integration). That code STAYS in Milton-saas under `milton/src-tauri/` — BE-8-3 only extracts the `tools/browser-extension/` slice. The BE-7 work in Milton-saas (`pdfUrl` field on `ConnectorReferencePayload`, `maybe_spawn_auto_fetch` call from `connector::handlers::add_reference`) is unaffected.

### Git intelligence summary

Recent commits relevant to BE-8-3 (`git log --oneline -10` from `main`, BE-8 lineage):

| SHA | Subject | Relevance to BE-8-3 |
|---|---|---|
| `19cff63f` | chore(19-8): mark done — PR #41 merged, CI green 12m43s | Most recent main commit; confirms epic-19 in-flight (parallel session) — DO NOT interfere |
| `b9d6f31c` | feat(BE-8-2): connector bytes endpoint (#40) | Most recent BE-8 commit; BE-8-3 extracts AFTER this lands so the extracted history includes BE-8-2 |
| `a79fbb33` | feat(BE-8-1): translator-mirror CDN setup (Coolify variant) (#35) | BE-8-1 added `tools/translator-mirror/` which STAYS in Milton-saas — BE-8-3 must not extract it |
| `a9b6093e` | chore(BE-8): sprint planning — 9 stories staged as backlog | BE-8 sprint origin; this story was staged here |
| `e5600694` | docs(BE-8): charter v2 (#33) | The decision authority for this story (Decision A1) |
| `ceb8ebf3` | chore(BE-7): mark done | Last pre-BE-8 work touching `tools/browser-extension/` |
| `76df5cb7` | feat(BE-7): auto-attach PDF (#30) | The BE-7 work whose extension-side code (`tools/browser-extension/src/popup/*`) carries forward verbatim post-extraction |
| `0676196d` | chore(extension): swap icons to Figma Milton mark + add 32px size (#28) | Icon assets preserved in extraction |
| `1964f661` | feat(BE-2): rich popup UX (#27) | Carries forward |
| `0a259429` | feat(BE-4): migrate to per-user JWT auth (#23) | Carries forward |
| `538ac562` | feat(BE-1): scaffold (#21) | Carries forward — the first commit that ever touched `tools/browser-extension/` |

**What git history confirms is NOT shipped yet:**
- No prior `Demandrel/milton-browser-extension` repo (`gh repo view` returns 404 — confirmed pre-flight)
- No `git submodule` references in Milton-saas (BE-8-4's `zotero/translate` submodule lands in the new repo, not here)
- No prior extraction attempts (no `tools/browser-extension/` deletion commits in history; the only deletion is BE-8-3 itself)

### Testing standards

- Extension already has 6 Vitest unit-test files (`auth-client`, `connector-client`, `translation-client`, `metadata-to-payload`, `tag-colors`, `popup-helpers`). These carry forward to the new repo verbatim; `pnpm test` in new repo CI runs them.
- BE-8-3 itself adds NO new tests. It's a repo-structure change, not a runtime change. CI passing is the test (typecheck + test + build all green).
- G17-1 HARD gate: AC10's Pierre smoke matrix is the runtime test. The 7 scenarios cover sideload, popup open, save flow, signed-out state, Milton-not-running, and 2 BE-7 regression checks. JSDOM cannot smoke any of these — real Chrome + real Milton-desktop required.

### Verify third-party library APIs against node_modules types before implementing

Not applicable in the meaningful sense — BE-8-3 introduces no new third-party APIs. The `gh` CLI commands used (`gh repo create`, `gh repo edit`, `gh repo view`, `gh pr create`, `gh pr merge`, `gh run watch`) are stable since gh CLI 2.x. The `git filter-repo` invocation is documented above. If `gh` syntax has drifted, fall back to `gh <command> --help` rather than guessing.

### References

- [Source: `tools/browser-extension/_bmad-output/planning-artifacts/charter-v2.md`#Locked Decisions] — Decision A1 (line 54): extension extracts to separate public repo `Demandrel/milton-browser-extension`. Decision rationale spans the Themes table (line 62) and Risks & Mitigations table (line 144: "BE-8-3 uses `git filter-repo`").
- [Source: `tools/browser-extension/_bmad-output/planning-artifacts/charter-v2.md`#Architecture] — IPC boundary diagram (lines 70-95). Confirms no extension-imports-Milton or vice versa at the code level.
- [Source: `tools/browser-extension/_bmad-output/implementation-artifacts/sprint-status.yaml`#development_status] — Lines 117-139: BE-8-3 sprint entry (line 132-139) names the story scope verbatim; parallelizable with BE-8-1 + BE-8-2 (both done).
- [Source: `tools/browser-extension/_bmad-output/implementation-artifacts/BE-8-1-translator-mirror-cdn-setup.md`] — Companion-infrastructure README addition pattern (story Task 7 region); sub-project standalone install convention; CI workflow pin versions.
- [Source: `tools/browser-extension/_bmad-output/implementation-artifacts/BE-8-2-connector-bytes-endpoint.md`] — Per-PR IPC-boundary self-check verbatim text (story AC region + Pre-Review Self-Check); Milton-desktop-side example of "this PR does NOT cross the boundary."
- [Source: `tools/browser-extension/README.md`] — Comprehensive 492-line README; AC5 mandates verbatim carryover with path rewrites; serves as the new repo's root README post-extraction.
- [Source: `.github/workflows/ci.yml`] — Milton-saas CI workflow; AC4 mandates translation to extension-only pipeline (drop Tauri/Rust/SvelteKit steps, drop 40-min timeout to 10).
- [Source: `CLAUDE.md`#Git Workflow] — "Rule 1 — Don't push until the story is done locally" governs the extraction commit cadence. Rule 3 (PR opens as non-draft, ready-for-review immediately) governs the Milton-saas deprecated-stub PR.
- [Source: `_bmad-output/planning-artifacts/product-brief-browser-extension-v2-2026-05-15.md`] — BE-v2 product brief commit `15c6aac1` / PR #32 — the 10 locked decisions whose Decision #1 (Path #3 — AGPL ext + closed-source Milton-desktop) is the parent rationale for charter v2 Decision A1.
- [Source: External — GNU AGPL v3 canonical text] — https://www.gnu.org/licenses/agpl-3.0.txt (AC3 mandates this as the `COPYING` content).
- [Source: External — SPDX license-identifier spec] — https://spdx.dev/learn/handling-license-info/ (AC3 mandates SPDX short-form headers on first-party `src/**` files).
- [Source: External — `git-filter-repo` man page] — https://htmlpreview.github.io/?https://github.com/newren/git-filter-repo/blob/docs/html/git-filter-repo.html (`--subdirectory-filter` semantics + safety warnings).
- [Source: Memory — [[feedback-ci-discipline-one-per-pr]]] — One CI run per PR; the new repo + deprecated-stub PR each follow this rule independently.
- [Source: Memory — [[feedback-monitor-ci-in-background]] + [[feedback-monitor-post-merge-ci-on-main]]] — Background-watch both pre-merge PR CI and post-merge main CI in Milton-saas; background-watch the force-push CI in the new repo.
- [Source: Memory — [[feedback-never-mark-done-before-everything-green]]] — Story does NOT flip `review → done` until: Milton-saas pre-merge CI green + Milton-saas post-merge main CI green + new repo post-push main CI green + Pierre smoke 7/7 green.
- [Source: Memory — [[feedback-claude-owns-merge-call-at-story-close]]] — Surface explicit merge recommendation; Pierre says "go" → dev-agent runs `gh pr merge`.
- [Source: Memory — [[feedback-format-check-before-push-from-new-worktree]]] — If story is executed in a fresh worktree, run `pnpm install + format:check + check + lint:reactive` before first push (G19-1).

### Project Structure Notes

- New repo's structure is `tools/browser-extension/` flattened to root — no nested project layout, no monorepo split. This matches Zotero's `zotero-connectors` repo layout convention (their extension is also a single flat repo) and is the simplest target for BE-8-4's submodule import.
- `_bmad-output/` lives at repo root in the new repo, mirroring Milton-saas's convention. The dev-agent / SM workflows discover sprint-status via the same path pattern (`_bmad-output/implementation-artifacts/sprint-status.yaml`).
- No detected conflicts with the unified Milton-saas structure — extracting `tools/browser-extension/` removes a leaf, doesn't restructure anything else. `tools/translator-mirror/` continues to live at `tools/translator-mirror/` in Milton-saas, unaffected.
- Variance from Milton-saas: extension repo uses `COPYING` not `LICENSE` (AGPL convention); Milton-saas keeps its `LICENSE` file (likely non-AGPL — verify the file exists at Milton-saas root and is unchanged by this story).

### Documentation Consolidation Notes

<!-- Record key decisions, new patterns, and behaviors here for Paige (tech-writer agent) to consolidate into feature documentation at epic completion. Keep entries to 2-3 lines each. -->

- **Extension repo extraction pattern:** History-preserving via `git filter-repo --subdirectory-filter`; throwaway clone discipline; force-push initialization replacing `gh repo create --license agpl-3.0` autoinit commit. Reusable template if Milton ever extracts another `tools/*` sub-project.
- **AGPL-3.0-or-later signaling:** `COPYING` at repo root + SPDX short-form headers on first-party `src/**` files + `package.json` `"license": "AGPL-3.0-or-later"` (3-layer signaling). Idempotent header-add script at `scripts/add-spdx-headers.sh`.
- **Deprecated stub pattern:** ≤30-line `tools/<sub-project>/README.md` containing only: pointer to new repo, license, cutover SHAs, decision link. Sets the precedent for future `tools/*` extractions (BE-9 server downscale may apply this to `translate.milton.so` if it migrates).
- **CI translation pattern:** Strip Tauri/Rust/SvelteKit toolchain steps when extracting a frontend-only sub-project. Reference: Milton-saas's ~200-line `ci.yml` translates to a ~30-line extension-only `ci.yml`.
- **IPC-boundary self-check as standing PR-body item:** Charter v2 Risks table establishes "Yes/No: does this PR violate the IPC boundary?" as mandatory on every BE-8-* PR. BE-8-3 carries it on BOTH the deprecated-stub PR in Milton-saas AND the new repo's initial commit narrative.

## Pre-Review Self-Check

<!-- Before requesting code review, verify each item and check the box. -->

Standard project-wide checklist (many N/A for this story — extension extraction is git + gh CLI + Markdown only; no Rust, no Svelte, no UI surface):

- [ ] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke) — N/A, no UI changes; existing extension icons (`tools/browser-extension/public/icons/`) carry forward verbatim via `git filter-repo`.
- [ ] File list in story matches actual files changed — verify the Dev Agent Record File List below mirrors `git diff --name-status main` output on the Milton-saas stub PR + the new repo's commits.
- [ ] No raw hex color values — all colors use PandaCSS tokens — N/A, no CSS changes (existing extension CSS uses raw hex per BE-1's self-contained styling rule; PandaCSS is Milton-desktop's tokenization, not the extension's).
- [ ] `$effect` dependencies checked against async boundaries (no split reactive state across `await`) — N/A, no Svelte runes (extension is vanilla TS).
- [ ] Superforms tests use real adapter (not mocked) — N/A, no form work; no Superforms in the extension.
- [ ] Barrel imports only — no direct imports from `features/*/utils/` — N/A, no Milton-desktop frontend imports; extension is its own repo with no `features/` directory.
- [ ] No type casts (`as any`, `as unknown as T`) in new production code — N/A, BE-8-3 adds no production TypeScript (only scripts, workflows, READMEs).
- [ ] Error paths handled — all async operations have try/catch or .catch() — N/A, no new async code; bash + gh CLI in the extraction scripts fail-fast with `set -euo pipefail`.
- [ ] IPC command results checked for error states before use — N/A, no IPC code; the only Tauri/IPC-adjacent verification is AC9's `grep` confirming the extension repo doesn't import `milton/src-tauri/**`.
- [ ] Loading states span full async lifecycle (set before await, cleared in finally) — N/A, no UI loading states (no UI changes).

Story-specific subsection (BE-8-3 license + extraction gates):

- [ ] `git filter-repo --subdirectory-filter tools/browser-extension` ran cleanly against a throwaway clone; rewritten commit count + rewritten-vs-original SHA spot-checks recorded in Change Log.
- [ ] AGPL `COPYING` at new repo root contains the full GNU AGPL v3 text (SHA-256 verified against https://www.gnu.org/licenses/agpl-3.0.txt).
- [ ] SPDX short-form headers added on every first-party `src/**` file (`.ts | .html | .css`) via idempotent `scripts/add-spdx-headers.sh`.
- [ ] `package.json` `"license"` field set to `"AGPL-3.0-or-later"` (verified via `jq -r '.license' package.json`).
- [ ] New repo's first CI run on `main` is green (URL recorded in Change Log).
- [ ] `dist/` artifact (`milton-browser-extension-<sha>.zip`) downloadable from the green CI run.
- [ ] Pierre smoke 7/7 from AC10 — all green (date + scenario list recorded in Change Log; this is the G17-1 HARD gate).
- [ ] Milton-saas deprecated stub at `tools/browser-extension/README.md` is ≤30 lines and names: new repo URL, AGPL-3.0-or-later license, cutover SHA in Milton-saas, cutover SHA in new repo, charter v2 link.
- [ ] `tools/browser-extension/_bmad-output/` removed from Milton-saas in the stub PR (canonical BMAD trail now lives in the new repo).
- [ ] Charter v2 + sprint-status.yaml inside the new repo updated: "Repo Extraction" subsection added to charter Locked Decisions A; sprint-status `story_location:` repointed.
- [ ] `grep -rE "(milton/src-tauri|@milton-saas|src-tauri/)" <new-repo>/src` returns ZERO hits (empty-grep evidence pasted in the new repo's PR descriptions).
- [ ] IPC-boundary self-check verbatim in BOTH the Milton-saas deprecated-stub PR body AND the new repo's first-commit PR descriptions per AC9.
- [ ] Milton-saas root `README.md` updated: "## Companion Repositories" section added (or extended) with the new repo pointer per AC11.
- [ ] Milton-saas's MAIN `_bmad-output/implementation-artifacts/sprint-status.yaml` UNTOUCHED — verified via `grep -i be-8 _bmad-output/implementation-artifacts/sprint-status.yaml` returning zero hits.
- [ ] `tools/translator-mirror/` in Milton-saas UNTOUCHED — verified via `git diff main HEAD -- tools/translator-mirror/` returning empty on the stub PR.
- [ ] `.github/workflows/translator-mirror-sync.yml` (+ `ci.yml`, `release.yml`, `release-mirror.yml`) in Milton-saas UNTOUCHED — verified via `git diff main HEAD -- .github/workflows/` returning empty on the stub PR.
- [ ] Post-merge Milton-saas main CI green (URL recorded; gh run watch confirmed `success` per [[feedback-monitor-post-merge-ci-on-main]]).
- [ ] Post-push new repo `main` CI green after `BE-8-3-extension-extracted-to-public-agpl-repo: done` flip (Task 10.1).
- [ ] IPC-boundary `grep` evidence: Pasted in PR body. Confirmed `tools/browser-extension/` deletion is the only cross-boundary touch.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

**Modified (Milton-saas — deprecated stub PR):**

- `tools/browser-extension/README.md` (rewritten to ≤30-line deprecation stub)
- `README.md` (added `## Companion Repositories` section)
- (Optional) `docs/developer-guide/<sub-projects-page>.mdx` if such a page exists

**Deleted (Milton-saas — deprecated stub PR):**

- `tools/browser-extension/src/**` (entire subtree)
- `tools/browser-extension/_bmad-output/**` (entire subtree — canonical now in new repo)
- `tools/browser-extension/{package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, manifest.config.ts, .npmrc, .env.local.example, .gitignore}` (build config)
- (NOTE: `tools/browser-extension/.env.local` is gitignored — should not appear in `git status` even before deletion)

**Created (new repo `Demandrel/milton-browser-extension`):**

- `COPYING` (GNU AGPL v3 canonical text)
- `scripts/add-spdx-headers.sh` (idempotent header-add script)
- `.github/workflows/ci.yml` (extension-only pipeline, ~30 lines)
- `(Optional)` `.githooks/pre-push` + `scripts/setup-hooks.sh` (Task 6 — dev-agent's call)

**Modified (new repo `Demandrel/milton-browser-extension`):**

- `package.json` (`"license": "AGPL-3.0-or-later"`)
- `README.md` (path rewrites for cross-repo links; badges; License section)
- Every `src/**/*.{ts,html,css}` file (SPDX header added)
- `_bmad-output/planning-artifacts/charter-v2.md` (Repo Extraction subsection added)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (`story_location:` repointed; BE-8-3 → done on Task 10.1)

## Change Log

| Date | Author | Summary |
|---|---|---|
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad SM workflow) | Story drafted via `/bmad_bmm_create-story`. Charter v2 Decision A1 scope confirmed by Pierre in 4-question gating round: (1) slug = `Demandrel/milton-browser-extension`; (2) `tools/translator-mirror/` STAYS in Milton-saas; (3) `translator-mirror-sync.yml` STAYS in Milton-saas; (4) git history preservation via `git filter-repo --subdirectory-filter tools/browser-extension`. 11 ACs + 10 tasks (~50 subtasks) authored. Status: `ready-for-dev`. Sprint-status flipped `backlog → ready-for-dev`. |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | Started implementation via `/bmad_bmm_dev-story`. Pacing locked: pause-and-confirm before each high-blast-radius external op (4 pause gates: `gh repo create`, `git filter-repo` run, force-push to new repo main, Milton-saas stub PR). Branch `chore/be-8-3-deprecate-extension-subtree` cut off `main@19cff63f`. Stale `milton/src/lib/bindings.ts` regeneration (3742-LOC diff) stashed (`stash@{0}`) — recover via `git stash pop` if needed; not BE-8-3's territory. Status: `in-progress`. Sprint-status flipped `ready-for-dev → in-progress`. |
| 2026-05-16 | Claude (Opus 4.7 1M, BMad Dev workflow) | **Task 1 pre-flight complete (1.1-1.6 all green).** Key findings: (a) ZERO open PRs touch the subtree — clean extraction surface; (b) slug `Demandrel/milton-browser-extension` is 404 → claim is safe; (c) **drift finding — `Demandrel/Milton-saas` is PRIVATE, not public as charter v2 claimed** — Pierre 2026-05-16 confirmed: keep Milton-saas private, accept auth-gated cross-links from public extension repo, fix charter wording in Task 7; (d) `git-filter-repo 2.47.0` installed via `brew`; (e) lockfile clean (`--frozen-lockfile` succeeded in 283ms); (f) zero secrets in extension history; (g) 7 `../` paths inventoried for Task 7 fix-up. Pausing at PAUSE-1 (`gh repo create`) per pacing rule. |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | **PAUSE-1 confirmed; Task 2 complete (2.1-2.3 all green).** Public repo live at https://github.com/Demandrel/milton-browser-extension. All 5 AC1 metadata gates verified: visibility public, license `agpl-3.0` (auto-applied by `gh repo create --license` flag — will be overwritten by `COPYING` AGPL-3.0-or-later in Task 4), default branch `main`, description matches package.json, all 6 topics present. GitHub-canonical `LICENSE` file sits on a single autoinit commit; Task 3.5 force-push will replace it with the filter-repo'd history. Pausing at PAUSE-2 (`git filter-repo` dry run). |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | **PAUSE-2 + PAUSE-3 confirmed; Task 3 complete (3.1-3.6 all green).** Throwaway clone at `/tmp/milton-saas-be8-3-extraction` → filter-repo 537→13 commits in 1.61s total → force-pushed to new repo main. The 13-commit lineage (BE-1 PR #21 → BE-8-2 PR #40 + 3 pre-BE-1 planning commits) is publicly visible at https://github.com/Demandrel/milton-browser-extension/commits/main. Co-author trailers preserved in commit bodies. No CI fired (no `.github/workflows/` in the extracted tree — Milton-saas's workflows lived at repo root, not under `tools/browser-extension/`). BE-8-3 story file is NOT in the new repo yet (it's local-only on Milton-saas branch `chore/be-8-3-deprecate-extension-subtree`) — will land via the bootstrap PR (Task 7). Next: bootstrap PR combining Tasks 4 (license) + 5 (CI) + 7 (BMAD sweep) into a single new-repo PR for one CI run. |
| 2026-05-16 | Claude (Opus 4.7 1M, BMad Dev workflow) | **Tasks 4 + 5 + 7 complete; bootstrap PR opened.** PR #1: https://github.com/Demandrel/milton-browser-extension/pull/1 (commit `c405ce9c`, 26 files +1456/-19). Task 6 (pre-push hook) SKIPPED per Task 6.4 escape hatch — CI gates suffice for solo extension repo. Local validation green: `pnpm install` 972ms / `typecheck` clean / `test` 111/111 in 309ms / `build` 149ms / bundle 43.02 kB → 12.07 kB gzipped. IPC-boundary self-check: `grep -rE "(milton/src-tauri\|@milton-saas\|src-tauri/)" src` returned ZERO hits — pasted in PR body. CI live: https://github.com/Demandrel/milton-browser-extension/actions/runs/25970454938 (background-watched). Next: await CI green → Pierre G17-1 smoke (Task 8 / AC10, 7 scenarios) → PAUSE-4 (Milton-saas-side stub PR). |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | **Bootstrap PR #1 green + merged; Pierre G17-1 smoke 7/7 passed.** Bootstrap PR #1 pre-merge CI: `success` (21s). Squash-merged at 19:20:56 UTC as commit `eb2daf2b`. Post-merge main CI on new repo: `success` (16s). Pre-downloaded dist/ artifact to `~/Downloads/be-8-3-smoke/`; Pierre sideloaded + ran 7 scenarios (sideload + popup + arxiv save + Milton-quit + signed-out + BE-7 econstor PDF regression + BE-7 arxiv abs regression) — all green. Synced BE-8-3 story file to new repo main as `3c4789e` (paths-ignored, no CI). Status remains `in-progress` pending stub PR (PAUSE-4). |
| 2026-05-16 | Pierre + Claude (Opus 4.7 1M, BMad Dev workflow) | **PAUSE-4 confirmed; Milton-saas stub PR #42 opened + merged + post-merge main CI green; BE-8-3 DONE.** Discarded stale `bindings.ts` regeneration; `git rm -rf tools/browser-extension/` removed 40 files; wrote 22-line stub README; updated Milton-saas root README (`## Companion Repositories` + `tools/` line in Project Structure). Pre-push hook all 4 gates green (format:check ✅ / lint:reactive ✅ / check ✅ / test 2799/2799 in 80.56s ✅). PR #42 opened: https://github.com/Demandrel/Milton-saas/pull/42. Pre-merge CI: `success` (13m12s). Squash-merged at 19:42 UTC as commit `7ddcf647`. Post-merge main CI run `25971158252`: `success` (13m35s). All 5 CI gates + smoke green; per [[feedback-never-mark-done-before-everything-green]] confirmed clear → flipped `BE-8-3-extension-extracted-to-public-agpl-repo: in-progress → done` in new repo sprint-status. **Story closed.** Net work: 2 PRs merged (Demandrel/milton-browser-extension#1 + Demandrel/Milton-saas#42), 1 public repo created (https://github.com/Demandrel/milton-browser-extension), 13-commit history preserved via filter-repo, AGPL signaling 3-layer (COPYING + package.json license + SPDX headers on 17 files), 1 deprecated stub. Unblocks BE-8-4 (translator runtime lift, depends on BE-8-3 per charter Story Map). |



