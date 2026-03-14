# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-14`

## Current Phase
Feature development — Pillars 1-4a complete. QA audit complete. Ready for Pillar 5.

## Backlog Position
Pillar: 5 (Agent Mode)
Next task number: 010

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
| TASK-008 | Input editor — multi-line + syntax highlighting | `e1afb70` | APPROVED R2 | N/A | PASS |
| TASK-009 | Tabbed interface with independent sessions | `21d7967` | APPROVED R2 | N/A | PASS |
| FIX-011 | Batch fix for missed findings (QA audit) | `b19111d` | — | — | — |

## In Progress
TASK-010: Split Panes — Vertical and Horizontal Splitting

## Outstanding Issues — Tracked (from QA Audit)

### Medium Severity (deferred, non-blocking)
- **BUG-004**: Full ANSI re-parse per PTY event (perf). Mitigated by useMemo.
- **BUG-008**: Old session output may flash during shell switch. Low practical impact.
- **BUG-009**: Rapid shell switching race creates orphaned sessions. Bounded by MAX_SESSIONS.
- **BUG-020**: Welcome block retains `running` status after session close. Easy fix on `pty:closed`.
- **BUG-025**: No per-block output size limit. Performance concern for long-running commands.
- **BUG-033**: Tab close → closeSession is fire-and-forget. May leak processes silently.
- **BUG-034**: No frontend enforcement of MAX_SESSIONS=20. User gets confusing error on 21st tab.
- **CR-002-I4**: UTF-8 lossy conversion splits multi-byte chars across reads. Deferred to ANSI rework.

### Low Severity (deferred)
- **BUG-010**: Rapid restart clicks can orphan sessions.
- **BUG-028**: Tokenizer misclassifies flag-like filenames after redirects.
- **BUG-029**: Tokenizer doesn't recognize `;`, `&&`, `||` as command separators.
- **BUG-031**: Overlay scroll desync on very long content.
- **BUG-032**: Disabled state doesn't gate handleKeyDown shortcuts.
- **BUG-035**: autoFocus on hidden tab textareas (latent).
- **BUG-038**: Ctrl+W preventDefault fires even with 1 tab.

### Accepted Risk
- **SEC-002-H1**: Full parent environment inherited by shells (inherent to terminal emulators).
- **SEC-001-M1**: `unsafe-inline` in style-src CSP (required for React).
- **SEC-005-M1**: Rerun replays without confirmation (industry standard, matches Warp).
- **BUG-005**: Relaxed memory ordering (acceptable on x86).

### Test Coverage Gaps (from QA audit — address incrementally)
- GAP-001: MAX_BLOCKS behavioral test (only constant checked)
- GAP-002: Output accumulation into active block
- GAP-003: Block status transition (running → completed)
- GAP-004/005: Copy Output button + ANSI stripping
- GAP-006: Rerun end-to-end
- GAP-101/102: Escaped chars and mixed quoting in tokenizer
- GAP-203: Tab limit test (20+ tabs)
- GAP-206: Cross-tab output isolation
- GAP-209: E2E tests for tab interactions

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells |
| 2. Block Model | **COMPLETE** (MVP) | Blocks, copy/rerun. Exit codes deferred. |
| 3. Input Editor | **COMPLETE** (3a+3b) | Multi-line, syntax highlighting. Ghost text deferred. |
| 4. Structural Layout | **PARTIAL** (4a+4c+4d) | Tabs, focus, sessions. Split panes (4b) deferred. |
| 5. Agent Mode | Not started | Final pillar |

## Test Summary

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 84 |
| Unit | cargo test (Rust) | 36 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 9 |
| E2E | Playwright (real app + CDP) | 8 |
| **Total** | | **137** |

## Last Security Review
- Scope: TASK-005 (block model)
- HEAD at review: `5e6afb6`

## Notes
- Comprehensive QA audit completed (INVESTIGATION-qa-audit.md). ~50 missed findings addressed or tracked.
- Session IDs now validated as UUID format (SEC-002-L1, flagged in all 4 security reviews — finally fixed).
- Anser color strings validated with regex before CSS interpolation (SEC-003-M1).
- Debug eprintln gated behind cfg(debug_assertions) (CR-006-NC1).
- Stale listener ordering fixed in resetAndStart (SEC-004-M2).
- Empty command submission prevented (BUG-017).
- Session failure shows restart button (BUG-015).
