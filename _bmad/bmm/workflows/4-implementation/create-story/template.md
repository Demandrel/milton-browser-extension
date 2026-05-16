# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a {{role}},
I want {{action}},
so that {{benefit}}.

## Acceptance Criteria

1. [Add acceptance criteria from epics/PRD]

## Tasks / Subtasks

- [ ] Task 1 (AC: #)
  - [ ] Subtask 1.1
- [ ] Task 2 (AC: #)
  - [ ] Subtask 2.1

## Dev Notes

- Relevant architecture patterns and constraints
- Source tree components to touch
- Testing standards summary
- Verify third-party library APIs against `node_modules` types before implementing — story dev notes may document APIs incorrectly

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming)
- Detected conflicts or variances (with rationale)

### Documentation Consolidation Notes

<!-- Record key decisions, new patterns, and behaviors here for Paige (tech-writer agent) to consolidate into feature documentation at epic completion. Keep entries to 2-3 lines each. -->

### References

- Cite all technical details with source paths and sections, e.g. [Source: docs/<file>.md#Section]

## Pre-Review Self-Check

<!-- Before requesting code review, verify each item and check the box. -->

- [ ] Icon variants verified against Figma (fill → solid/duo-solid, stroke → stroke/duo-stroke)
- [ ] File list in story matches actual files changed
- [ ] No raw hex color values — all colors use PandaCSS tokens
- [ ] `$effect` dependencies checked against async boundaries (no split reactive state across `await`)
- [ ] Superforms tests use real adapter (not mocked)
- [ ] Barrel imports only — no direct imports from `features/*/utils/`
- [ ] No type casts (`as any`, `as unknown as T`) in new production code — test mocks excepted per team agreement
- [ ] Error paths handled — all async operations have try/catch or .catch()
- [ ] IPC command results checked for error states before use
- [ ] Loading states span full async lifecycle (set before await, cleared in finally)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
