# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-12`

## Current Phase
Feature development — Pillars 1-2 complete + full testing infrastructure. Ready for Pillar 3.

## Backlog Position
Pillar: 3 (Decoupled Input Editor)
Next task number: 008

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project | `2b46797` | APPROVED R2 | PASS R1 | N/A |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS R1 |
| TASK-004 | Process lifecycle + shell selection | `85c34dd` | APPROVED R2 | PASS R1 | PASS R2 |
| TASK-005 | Block model — command/output containers | `6db813d` | APPROVED R2 | PASS R1 | PASS R3 |
| TASK-006 | PTY channel refactor + integration tests | `9ccbc42` | APPROVED R1 | N/A | N/A |
| TASK-007 | E2E tests with Playwright | `37dda08` | — | N/A | N/A |
| FIX-006 | camelCase IPC keys | `1d7edf9` | — | — | — |
| FIX-007 | StrictMode double-mount race | `7ae29d7` | — | — | — |
| FIX-008 | Lazy reader thread start | committed | — | — | — |
| FIX-009 | ConPTY cursor position response | `1acbb98` | — | — | — |

## In Progress
TASK-008: Decoupled Input Editor — Multi-line + Syntax Highlighting

## Outstanding Issues
- **BUG-025 (Medium)**: No per-block output size limit.
- **BUG-020 (Medium)**: Welcome block retains `running` status after session close.
- **BUG-009 (Medium)**: Rapid shell switching race creates orphaned sessions.
- **BUG-004 (Medium)**: Full ANSI re-parse per PTY event (perf).

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells, ConPTY fix |
| 2. Block Model | **COMPLETE** (MVP) | Blocks, copy/rerun. Exit codes deferred. |
| Testing Infrastructure | **COMPLETE** | Layer 1 (9 integration), Layer 3 (7 E2E), 43 unit |
| 3. Input Editor | Not started | Next up |
| 4. Layout (Tabs/Panes) | Not started | |
| 5. Agent Mode | Not started | |

## Test Summary

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 43 |
| Unit | cargo test (Rust) | 35 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 9 |
| E2E | Playwright (real app + CDP) | 7 |
| **Total** | | **94** |

## Last Security Review
- Scope: TASK-005 (block model)
- HEAD at review: `5e6afb6`

## Notes
- E2E uses Playwright + CDP to WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`)
- E2E fixture manages Vite dev server (worker-scoped) + Tauri app (test-scoped)
- `workers: 1` in Playwright config (serial, shared CDP port)
- `vitest.config.ts` excludes `e2e/**` to avoid Vitest/Playwright conflict
