# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-14`

## Current Phase
Feature development — ALL MVP PILLARS COMPLETE (except Pillar 5 Agent Mode). Ready for Pillar 5.

## Backlog Position
Pillar: 5 (Agent Mode)
Next task number: 015

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project | `2b46797` | APPROVED R2 | PASS R1 | N/A |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS |
| TASK-004 | Process lifecycle + shell selection | `85c34dd` | APPROVED R2 | PASS R1 | PASS |
| TASK-005 | Block model — command/output containers | `6db813d` | APPROVED R2 | PASS R1 | PASS |
| TASK-006 | PTY channel refactor + integration tests | `9ccbc42` | APPROVED R1 | N/A | N/A |
| TASK-007 | E2E tests with Playwright | `37dda08` | N/A | N/A | N/A |
| TASK-008 | Input editor — multi-line + syntax highlighting | `e1afb70` | APPROVED R2 | N/A | PASS |
| TASK-009 | Tabbed interface | `21d7967` | APPROVED R2 | N/A | PASS |
| TASK-010 | Split panes | `f789ab6` | APPROVED R2 | N/A | PASS |
| TASK-011 | Ghost text + command history | `525aade` | APPROVED R2 | N/A | N/A |
| TASK-012 | Exit codes via shell markers | `47dedf8` | APPROVED (R1+fix) | PASS R1 | PASS |
| TASK-013 | Draggable pane dividers | `8613c86` | APPROVED R1 | PASS R1 | PASS |
| TASK-014 | Per-tab pane focus | `b99bba1` | APPROVED R1 | PASS R1 | PASS |

## In Progress
None.

## Outstanding Issues — Tracked

### Medium Severity
- **BUG-004**: Full ANSI re-parse per PTY event (perf).
- **BUG-009**: Rapid shell switching race → orphaned sessions.
- **BUG-020**: Welcome block retains `running` status after session close.
- **BUG-025**: No per-block output size limit.
- **BUG-033**: Tab close → closeSession fire-and-forget.
- **BUG-034**: No frontend MAX_SESSIONS enforcement for tabs.
- **SEC-012-M1**: Marker spoofing — programs can forge `VELOCITY_EXIT:0`.
- **SEC-012-M2**: PowerShell exit codes limited to 0/1 (uses `$?` not `$LASTEXITCODE`).

### Low Severity
- BUG-010, 028, 029, 031, 032, 035, 038

### Accepted Risk
- SEC-002-H1: Full parent env inherited by shells
- SEC-001-M1: `unsafe-inline` in style-src CSP
- SEC-005-M1: Rerun without confirmation

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells |
| 2. Block Model | **COMPLETE** | Blocks, copy/rerun, exit codes |
| 3. Input Editor | **COMPLETE** | Multi-line, syntax highlighting, ghost text, history |
| 4. Structural Layout | **COMPLETE** | Tabs, split panes, drag resize, per-tab focus |
| 5. Agent Mode | Not started | Final pillar |

## Test Summary

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 153 |
| Unit | cargo test (Rust) | 36 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 9 |
| E2E | Playwright (real app + CDP) | 8 |
| **Total** | | **206** |

## Last Security Review
- Scope: TASKS-012-014 batch
- HEAD at review: `7ace1a7`
- Report: `SECURITY-REVIEW-TASKS-012-014-R1.md`
