# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-13`

## Current Phase
Feature development — Pillars 1-3 complete. Ready for Pillar 4.

## Backlog Position
Pillar: 4 (Structural Layout — Tabs & Panes)
Next task number: 009

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project | `2b46797` | APPROVED R2 | PASS R1 | N/A |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS R1 |
| TASK-004 | Process lifecycle + shell selection | `85c34dd` | APPROVED R2 | PASS R1 | PASS R2 |
| TASK-005 | Block model — command/output containers | `6db813d` | APPROVED R2 | PASS R1 | PASS R3 |
| TASK-006 | PTY channel refactor + integration tests | `9ccbc42` | APPROVED R1 | N/A | N/A |
| TASK-007 | E2E tests with Playwright | `37dda08` | N/A | N/A | N/A |
| TASK-008 | Input editor — multi-line + syntax highlighting | `e1afb70` | APPROVED R2 | N/A (frontend) | PASS |

## In Progress
None.

## Outstanding Issues
- **BUG-025 (Medium)**: No per-block output size limit.
- **BUG-020 (Medium)**: Welcome block retains `running` status after session close.
- **BUG-009 (Medium)**: Rapid shell switching race creates orphaned sessions.
- **BUG-004 (Medium)**: Full ANSI re-parse per PTY event (perf).
- **BUG-028 (Low)**: Tokenizer misclassifies flag-like filenames after redirects.
- **BUG-029 (Low)**: Tokenizer doesn't recognize `;`, `&&`, `||` as command separators.
- **BUG-031 (Low)**: Overlay scroll desync on very long content.

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells, ConPTY fix |
| 2. Block Model | **COMPLETE** (MVP) | Blocks, copy/rerun. Exit codes deferred. |
| 3. Input Editor | **COMPLETE** (3a+3b) | Multi-line, syntax highlighting. Ghost text (3c) deferred. |
| Testing Infrastructure | **COMPLETE** | 9 integration + 8 E2E + 65 unit tests |
| 4. Layout (Tabs/Panes) | Not started | Next up |
| 5. Agent Mode | Not started | |

## Test Summary

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 65 |
| Unit | cargo test (Rust) | 35 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 9 |
| E2E | Playwright (real app + CDP) | 8 |
| **Total** | | **117** |

## Last Security Review
- Scope: TASK-005 (block model)
- HEAD at review: `5e6afb6`

## Notes
- Pillar 3 sub-tasks 3a (multi-line) and 3b (syntax highlighting) complete.
- 3c (ghost text suggestions) and 3d (keyboard shortcuts) deferred — can add later.
- Shell tokenizer handles: commands, flags, strings (including unclosed), pipes, redirects.
- Input editor uses textarea + pre overlay with CSS Grid alignment.
- Multi-line commands convert `\n` → `\r` before sending to PTY.
