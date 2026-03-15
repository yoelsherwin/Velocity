# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-14`

## Current Phase
Feature development — Pillars 1-4 COMPLETE. Ready for Pillar 5 (Agent Mode).

## Backlog Position
Pillar: 5 (Agent Mode)
Next task number: 015

## Completed Tasks

| Task | Description | Commit | Code Review | Security Review | QA |
|------|-------------|--------|-------------|-----------------|-----|
| TASK-001 | Bootstrap project | `2b46797` | APPROVED R2 | PASS R1 | N/A |
| FIX-001 | Code review fixes (CSP, gitignore, jest-dom) | `c98cfc8` | — | — | — |
| TASK-002 | PTY engine — spawn and stream | `da21113` | APPROVED R2 | PASS R1 | N/A |
| FIX-002 | Code review fixes (async safety, cleanup) | `c65cc00` | — | — | — |
| TASK-003 | ANSI security filter + color rendering | `7ddb968` | APPROVED R2 | PASS R1 | PASS |
| FIX-003 | Code review fixes (memoization, parser state) | `cc00770` | — | — | — |
| TASK-004 | Process lifecycle + shell selection | `85c34dd` | APPROVED R2 | PASS R1 | PASS |
| FIX-004 | Code review fixes (session ref, ARIA, types) | `4953590` | — | — | — |
| TASK-005 | Block model — command/output containers | `6db813d` | APPROVED R2 | PASS R1 | PASS |
| FIX-005 | Code review fixes (tests, clipboard, dedup) | `5e6afb6` | — | — | — |
| FIX-006 | camelCase IPC keys | `1d7edf9` | — | — | — |
| FIX-007 | StrictMode double-mount race | `7ae29d7` | — | — | — |
| FIX-008 | Lazy reader thread start | `61301c8` | — | — | — |
| FIX-009 | ConPTY cursor position response | `1acbb98` | — | — | — |
| TASK-006 | PTY channel refactor + integration tests | `9ccbc42` | APPROVED R1 | N/A | N/A |
| TASK-007 | E2E tests with Playwright + WSL + CMD output | `37dda08`+`b88b93a`+`cd0cd6c` | N/A | N/A | N/A |
| Icons | Generate app icons from Velocity logo | `160edad` | N/A | N/A | N/A |
| TASK-008 | Input editor — multi-line + syntax highlighting | `e1afb70` | APPROVED R2 | N/A | PASS |
| FIX-008-CR | Code review fixes (unused prop, quotes, CSS) | `2455f55` | — | — | — |
| FIX-008-QA | QA fixes (newline→CR, overlay alignment) | `d306f4c` | — | — | — |
| TASK-009 | Tabbed interface with independent sessions | `21d7967` | APPROVED R2 | N/A | PASS |
| FIX-009-CR | Code review fix (stale closure, Ctrl+W test) | `7d8975e` | — | — | — |
| FIX-GAP-202 | PTY cleanup test for tab close | `9f4d988` | — | — | — |
| FIX-011 | Batch fix for missed findings (QA audit) | `b19111d` | APPROVED R1 | N/A | N/A |
| TASK-010 | Split panes — vertical and horizontal | `f789ab6` | APPROVED R2 | N/A | PASS |
| FIX-010-CR | Code review fixes (refs, limits, keys, shortcuts) | `90df1d1` | — | — | — |
| FIX-010-QA | QA fix (TabBar test paneRoot) | `9d962f2` | — | — | — |
| TASK-011 | Ghost text + command history | `525aade` | APPROVED R2 | N/A | N/A |
| FIX-011-CR | History navigation fix | `65c9f9a` | — | — | — |
| TASK-012 | Exit codes via shell markers | `47dedf8` | APPROVED (R1+fix) | PASS R1 | PASS |
| TASK-013 | Draggable pane dividers | `8613c86` | APPROVED R1 | PASS R1 | PASS |
| TASK-014 | Per-tab pane focus | `b99bba1` | APPROVED R1 | PASS R1 | PASS |
| FIX-012-CR | Exit code regex anchor, PowerShell $? | `7ace1a7` | — | — | — |
| FIX-012-014-QA | Batch QA cleanup (fixtures, dead code, clamping) | `52217f3` | — | — | — |

## In Progress
None.

## Outstanding Issues — Tracked

### Medium Severity
- **BUG-004**: Full ANSI re-parse per PTY event (perf). Mitigated by useMemo.
- **BUG-009**: Rapid shell switching race → orphaned sessions. Bounded by MAX_SESSIONS.
- **BUG-020**: Welcome block retains `running` status after session close.
- **BUG-025**: No per-block output size limit.
- **BUG-033**: Tab close → closeSession fire-and-forget.
- **BUG-034**: No frontend MAX_SESSIONS enforcement for tabs.
- **SEC-012-M1**: Marker spoofing — programs can forge `VELOCITY_EXIT:0`. Fix: add per-command nonce.
- **SEC-012-M2**: PowerShell exit codes limited to 0/1 (uses `$?` not `$LASTEXITCODE`).
- **CR-002-I4**: UTF-8 lossy conversion splits multi-byte chars across reads.

### Low Severity
- **BUG-010**: Rapid restart clicks orphan sessions.
- **BUG-028**: Tokenizer misclassifies flag-like filenames after redirects.
- **BUG-029**: Tokenizer doesn't recognize `;`, `&&`, `||`.
- **BUG-031**: Overlay scroll desync on long content.
- **BUG-032**: Disabled state doesn't gate handleKeyDown.
- **BUG-035**: autoFocus on hidden tabs.
- **BUG-038**: Ctrl+W preventDefault with 1 tab.
- **SEC-004-L4**: Drag event listeners could leak on unmount during active drag.
- **SEC-012-L6**: Exit code regex accepts arbitrarily large integers.

### Accepted Risk
- **SEC-002-H1**: Full parent env inherited by shells (inherent to terminal emulators).
- **SEC-001-M1**: `unsafe-inline` in style-src CSP (required for React).
- **SEC-005-M1**: Rerun without confirmation (industry standard, matches Warp).

## Pillar Status

| Pillar | Status | Sub-tasks |
|--------|--------|-----------|
| 1. Process Interfacing | **COMPLETE** | PTY spawn, streaming, ANSI filter, lifecycle, shells, ConPTY fix, lazy reader, channel refactor |
| 2. Block Model | **COMPLETE** | Blocks, copy/rerun, exit codes via shell markers |
| 3. Input Editor | **COMPLETE** | Multi-line, syntax highlighting, ghost text, command history |
| 4. Structural Layout | **COMPLETE** | Tabs, split panes, drag resize, per-tab focus, keyboard shortcuts |
| 5. Agent Mode | Not started | Intent classifier, # trigger, LLM bridge, review-first execution |

## Test Summary (verified 2026-03-14)

| Layer | Suite | Count | Verified |
|-------|-------|-------|----------|
| Unit | Vitest (frontend) | 153 | `npm run test` → 153 passed, 16 files |
| Unit | cargo test (Rust) | 36 (+1 ignored) | `cargo test` → 36 passed |
| Integration | Rust PTY (real PowerShell) | 9 | `cargo test` integration → 9 passed |
| E2E | Playwright (real app + CDP) | 8 | 3 spec files, 8 test() calls |
| **Total** | | **206** | |

## Last Security Review
- Scope: TASKS-012-014 batch
- Commit range: `65c9f9a..7ace1a7`
- HEAD at review: `7ace1a7`
- Report: `prompts/reports/security-reviews/SECURITY-REVIEW-TASKS-012-014-R1.md`

## Notes
- Current HEAD: `52217f3`
- 40 total commits on main
- App icons generated from custom Velocity logo (`src-tauri/icons/Velocity.png`)
- npm audit shows 6 `undici` advisories (high) — fixable with `npm audit fix`
- ConPTY cursor deadlock fixed (write `\x1b[1;1R` on session create)
- Lazy reader thread (`start_reading`) eliminates emit/listen race
- StrictMode double-mount handled with invocation counter
- Shell marker injection for exit codes: PowerShell (`$?`), CMD (`%ERRORLEVEL%`), WSL (`$?`)
