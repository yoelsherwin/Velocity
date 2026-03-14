# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-14`

## Current Phase
Feature development — Pillars 1-4 COMPLETE. Ready for Pillar 5 (Agent Mode).

## Backlog Position
Pillar: 5 (Agent Mode)
Next task number: 011

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
| TASK-009 | Tabbed interface with independent sessions | `21d7967` | APPROVED R2 | N/A | PASS |
| TASK-010 | Split panes — vertical and horizontal | `f789ab6` | APPROVED R2 | N/A | PASS |
| FIX-011 | Batch fix for missed findings (QA audit) | `b19111d` | APPROVED R1 | N/A | N/A |

## In Progress
None.

## Outstanding Issues — Tracked

### Medium Severity
- **BUG-004**: Full ANSI re-parse per PTY event (perf).
- **BUG-008**: Old session output flash on shell switch.
- **BUG-009**: Rapid shell switching race creates orphaned sessions.
- **BUG-020**: Welcome block retains `running` status after session close.
- **BUG-025**: No per-block output size limit.
- **BUG-033**: Tab close → closeSession fire-and-forget.
- **BUG-034**: No frontend enforcement of MAX_SESSIONS for tabs (panes have MAX_PANES_TOTAL=20).
- **CR-002-I4**: UTF-8 lossy conversion splits multi-byte chars.

### Low Severity
- **BUG-010**: Rapid restart clicks orphan sessions.
- **BUG-028**: Tokenizer misclassifies flag-like filenames after redirects.
- **BUG-029**: Tokenizer doesn't recognize `;`, `&&`, `||`.
- **BUG-031**: Overlay scroll desync on long content.
- **BUG-032**: Disabled state doesn't gate handleKeyDown.
- **BUG-035**: autoFocus on hidden tabs.
- **BUG-038**: Ctrl+W preventDefault with 1 tab.
- **QA-010-BUG-002**: focusedPaneId is global not per-tab.
- **QA-010-BUG-003**: Ctrl+\ doesn't guard against Shift key.

### Accepted Risk
- **SEC-002-H1**: Full parent env inherited by shells.
- **SEC-001-M1**: `unsafe-inline` in style-src CSP.
- **SEC-005-M1**: Rerun without confirmation (industry standard).

## Pillar Status

| Pillar | Status | Notes |
|--------|--------|-------|
| 1. Process Interfacing | **COMPLETE** | PTY, streaming, ANSI filter, lifecycle, shells |
| 2. Block Model | **COMPLETE** (MVP) | Blocks, copy/rerun. Exit codes deferred. |
| 3. Input Editor | **COMPLETE** (3a+3b) | Multi-line, syntax highlighting. Ghost text deferred. |
| 4. Structural Layout | **COMPLETE** | Tabs (4a), split panes (4b), focus (4c), sessions (4d) |
| 5. Agent Mode | Not started | Final pillar |

## Test Summary

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 101 |
| Unit | cargo test (Rust) | 36 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 9 |
| E2E | Playwright (real app + CDP) | 8 |
| **Total** | | **154** |

## Last Security Review
- Scope: TASK-005 (block model)
- HEAD at review: `5e6afb6`
- Note: Security review needed for the full Pillar 4 batch before Pillar 5

## Notes
- Pane tree uses discriminated unions (leaf | split) with pure immutable operations
- MAX_PANES_TOTAL=20 enforced on frontend (matches backend MAX_SESSIONS)
- Keyboard: Ctrl+T (tab), Ctrl+W (close tab), Ctrl+Shift+Right (split h), Ctrl+Shift+Down (split v), Ctrl+Shift+W (close pane)
- Each pane's Terminal has `key={node.id}` for correct React reconciliation
- Drag-to-resize pane dividers deferred (ratio fixed at 0.5)
