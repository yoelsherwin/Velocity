# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-12`

## Current Phase
Feature development — Pillar 2 (Block Model) **COMPLETE** (2a + 2b + 2d done; 2c deferred to shell integration).

## Backlog Position
Pillar: 3 (Decoupled Input Editor)
Next task number: 006

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project (Tauri v2 + React/TS) | `2b46797` | APPROVED R2 | PASS R1 | N/A |
| FIX-001 | Code review fixes (CSP, gitignore, jest-dom) | `c98cfc8` | — | — | — |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A |
| FIX-002 | Code review fixes (async safety, resource cleanup) | `c65cc00` | — | — | — |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS R1 |
| FIX-003 | Code review fixes (memoization, backspace, parser state) | `cc00770` | — | — | — |
| TASK-004 | Process lifecycle + shell selection + input validation | `85c34dd` | APPROVED R2 | PASS R1 | PASS R2 |
| FIX-004 | Code review fixes (session ref, ARIA, type safety) | `4953590` | — | — | — |
| TASK-005 | Block model — command/output containers | `6db813d` | APPROVED R2 | PASS R1 | PASS R3 |
| FIX-005 | Code review fixes (tests, clipboard, dedup) | `5e6afb6` | — | — | — |

## In Progress
TASK-006: PTY Channel Refactor + Integration Tests

## Outstanding Issues
- **BUG-025 (Medium)**: No per-block output size limit — unbounded memory growth from single long-running command.
- **BUG-020 (Medium)**: Welcome block retains `running` status after session close.
- **BUG-015 (Medium)**: Input field active after session creation failure — no error indication.
- **BUG-022 (Medium)**: Rapid shell switching race creates orphaned blocks (extension of BUG-009).
- **BUG-017 (Low)**: Empty Enter creates block identical to welcome block.
- **BUG-009 (Medium)**: Rapid shell switching orphans sessions (carried from R2).
- **BUG-004 (Medium)**: Full ANSI re-parse per PTY event (perf, carried from R1).
- **Security M-1 (TASK-005)**: Rerun without confirmation (accepted, industry standard).
- **Security M-2 (TASK-005)**: Unbounded per-block output (same as BUG-025).

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells |
| 2. Block Model | **COMPLETE** (MVP) | Blocks, copy/rerun actions. Exit codes deferred (needs shell integration). |
| 3. Input Editor | Not started | Next up |
| 4. Layout (Tabs/Panes) | Not started | |
| 5. Agent Mode | Not started | |

## Last Security Review
- Scope: TASK-005 (block model)
- Commit range: `4953590..5e6afb6`
- HEAD at review: `5e6afb6`
- Report: `prompts/reports/security-reviews/SECURITY-REVIEW-TASK-005-block-model-R1.md`

## Notes
- 70 total tests passing (39 frontend + 31 Rust).
- Pillar 2 sub-task 2c (exit code + timestamp display) partially done: timestamp shows, exit code deferred to shell integration.
- Block count capped at MAX_BLOCKS=50. Per-block output unbounded (BUG-025).
- No Rust changes in Pillar 2 — entirely frontend.
