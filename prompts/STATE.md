# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-17`

## Current Phase
**Post-MVP Phase 1 (Usability).** Closing P0 gaps for daily-use readiness.

## Phase 1 Progress

| # | Feature | Status |
|---|---------|--------|
| P0-1 | Full terminal emulation (xterm/VT100) | Not started |
| P0-2 | Tab/path completions | Not started |
| P0-3 | Find in terminal output (Ctrl+Shift+F) | **IN PROGRESS** (TASK-020) |
| P0-4 | Command palette (Ctrl+Shift+P) | Not started |
| P0-5 | Scrollback + large output handling | **DONE** (`25ae200` + `b7bca3d`) |
| P0-6 | True color + 256-color rendering | **DONE** (`a04290b`) — was already working, added 8 tests |
| P0-7 | CLI/AI mode indicator | **DONE** (`04461db`) |
| P0-8a | Intent classifier heuristic engine | **DONE** (`04461db`) |
| P0-8b | Known-command enumeration (Rust) | **DONE** (`04461db`) |
| P0-8c | LLM fallback for ambiguous inputs | Deferred |
| P0-BUG | BUG-004 + BUG-025 | **FIXED** in P0-5 |

**Remaining: P0-1, P0-2, P0-3, P0-4** (4 items)

## In Progress
TASK-020: Find in Terminal Output (Ctrl+Shift+F) — P0-3

## Outstanding Issues

### Medium (from Phase 1 reviews)
- BUG-009: Rapid shell switching race → orphaned sessions
- BUG-020: Welcome block retains `running` status after session close
- BUG-033: Tab close → closeSession fire-and-forget
- BUG-034: No frontend MAX_SESSIONS enforcement for tabs
- BUG-039: Truncation marker causes redundant re-truncation at cap (perf)
- SEC-015-H1: Plaintext API key storage (future: OS keychain)
- SEC-015-H2: Google API key in URL (Google's required auth)
- SEC-017-H1: LLM prompt injection (add dangerous command warnings)
- SEC-018-H1: Heuristic misclassification → unintended LLM data disclosure

### Low
- BUG-010, 028, 029, 031, 032, 035, 038, 040, 041
- QA-018 BUG-001: History navigation doesn't re-classify intent
- QA-018 BUG-002: ModeIndicator missing disabled HTML attribute

### Accepted Risk
- SEC-002-H1: Full parent env inherited by shells
- SEC-001-M1: `unsafe-inline` in style-src CSP
- SEC-005-M1: Rerun without confirmation

## Test Summary

| Layer | Count |
|-------|-------|
| Vitest (frontend) | 244 |
| cargo test (Rust unit) | 69 (+1 ignored) |
| Rust integration | 10 |
| Playwright E2E | 24 |
| **Total** | **~347** |

## Remaining Phase 1 Roadmap

### P0-1: Full terminal emulation (Large — biggest remaining item)
Need alternate screen, cursor positioning, application-mode keys. Consider `alacritty_terminal` or `vt100` crate, or `xterm.js` on frontend.

### P0-2: Tab/path completions (Medium-Large)
Start with path completion + top 20 CLI tools. Consider Fig completion spec format.

### P0-3: Find in terminal output (Small-Medium)
Ctrl+Shift+F search overlay with match highlighting.

### P0-4: Command palette (Small-Medium)
Ctrl+Shift+P fuzzy search over actions/settings.

## Phase 2+ Roadmap (unchanged)
See `prompts/reports/investigations/INVESTIGATION-warp-feature-gap.md` for full gap analysis.

P1: Themes, fonts, git context, multi-turn AI, error correction, block enhancements, notifications, session restore, global hotkey, rich history, secret redaction, multiple windows.

P2: Vim keys, SSH, workflows, accessibility, code editor integration.

P3: Cloud collaboration, notebooks, orchestration.
