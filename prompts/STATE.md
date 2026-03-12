# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-12`

## Current Phase
Feature development — Pillar 1 (Process Interfacing) in progress.

## Backlog Position
Pillar: 1 (Process Interfacing)
Next task number: 004
Remaining sub-tasks: 1d (process lifecycle — restart), 1e (CMD/WSL testing)

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project (Tauri v2 + React/TS) | `2b46797` | APPROVED R2 | PASS R1 | N/A (bootstrap) |
| FIX-001 | Code review fixes (CSP, gitignore, jest-dom) | `c98cfc8` | (part of TASK-001 R2) | (part of TASK-001 R1) | N/A |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A (combined with TASK-003) |
| FIX-002 | Code review fixes (async safety, resource cleanup) | `c65cc00` | (part of TASK-002 R2) | (part of TASK-002 R1) | N/A |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS (2026-03-12) |
| FIX-003 | Code review fixes (memoization, backspace, parser state) | `cc00770` | (part of TASK-003 R2) | (part of TASK-003 R1) | (part of QA 2026-03-12) |

## In Progress
None.

## Outstanding Issues
- **BUG-006 (Medium)**: No input validation for `rows`/`cols` in `create_session`/`resize_session` — 0 or extreme values accepted. Could cause PTY crash.
- **BUG-004 (Medium)**: Full output buffer re-parse on every PTY event. Mitigated by `useMemo` but still O(n) when text changes. Incremental parsing deferred.
- **Security M-1**: Color string validation in `src/lib/ansi.ts` relies on Anser behavior (defense-in-depth).
- **Security M-2**: `unsafe-inline` in `style-src` CSP (accepted risk, monitor during future rendering changes).
- **QA BUG-007 (Low)**: `resize_session` exists but is never called from the frontend.

## Last Security Review
- Scope: TASK-003 (ANSI filter)
- Commit range: `c65cc00..cc00770`
- HEAD at review: `cc00770`
- Report: `prompts/reports/security-reviews/SECURITY-REVIEW-TASK-003-ansi-filter-R1.md`

## Notes
- Pillar 1 sub-tasks 1a (spawn), 1b (stream), 1c (ANSI) are complete.
- 1d (process lifecycle) partially done: kill works, restart not implemented.
- 1e (CMD/WSL) code exists but is untested.
- Rust toolchain may need `winget install Rustlang.Rustup` on fresh machines.
- `tauri-plugin-opener` has been removed (security review L-4).
- 42 total tests passing (18 frontend + 26 Rust).
