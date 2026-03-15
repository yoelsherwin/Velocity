# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-15`

## Current Phase
**MVP COMPLETE.** All 5 pillars implemented and reviewed.

## Backlog Position
Post-MVP. Next steps: polish, bug fixes, production build, release.

## Completed Tasks

| Task | Description | Code Review | Security | QA |
|------|-------------|-------------|----------|-----|
| TASK-001 | Bootstrap project | APPROVED R2 | PASS | N/A |
| TASK-002 | PTY engine — spawn and stream | APPROVED R2 | PASS | N/A |
| TASK-003 | ANSI security filter + color rendering | APPROVED R2 | PASS | PASS |
| TASK-004 | Process lifecycle + shell selection | APPROVED R2 | PASS | PASS |
| TASK-005 | Block model — command/output containers | APPROVED R2 | PASS | PASS |
| TASK-006 | PTY channel refactor + integration tests | APPROVED R1 | N/A | N/A |
| TASK-007 | E2E tests with Playwright | N/A | N/A | N/A |
| TASK-008 | Input editor — multi-line + syntax highlighting | APPROVED R2 | N/A | PASS |
| TASK-009 | Tabbed interface | APPROVED R2 | N/A | PASS |
| TASK-010 | Split panes | APPROVED R2 | N/A | PASS |
| TASK-011 | Ghost text + command history | APPROVED R2 | N/A | N/A |
| TASK-012 | Exit codes via shell markers | APPROVED R1+fix | PASS | PASS |
| TASK-013 | Draggable pane dividers | APPROVED R1 | PASS | PASS |
| TASK-014 | Per-tab pane focus | APPROVED R1 | PASS | PASS |
| TASK-015 | Settings system + API key management | APPROVED R2 | PASS | PASS |
| TASK-016 | LLM provider client (4 providers) | APPROVED R2 | PASS | PASS |
| TASK-017 | Agent mode UI — # trigger + translation | APPROVED R2 | PASS | PASS |

## In Progress
None.

## Pillar Status — ALL COMPLETE

| Pillar | Status | Key Features |
|--------|--------|-------------|
| 1. Process Interfacing | **COMPLETE** | PTY spawn, real-time streaming, ANSI security filter, shell lifecycle, PowerShell/CMD/WSL, ConPTY fixes, lazy reader, channel architecture, child watchdog |
| 2. Block Model | **COMPLETE** | Command/output blocks, exit codes (✓/✗), timestamps, copy command/output, rerun, MAX_BLOCKS=50 |
| 3. Input Editor | **COMPLETE** | Multi-line (Shift+Enter), syntax highlighting (commands/flags/strings/pipes), ghost text suggestions, command history (Up/Down), Tab completion |
| 4. Structural Layout | **COMPLETE** | Tabs (Ctrl+T/W), split panes (horizontal/vertical), draggable dividers, per-tab focus, keyboard shortcuts, MAX_PANES=20 |
| 5. Agent Mode | **COMPLETE** | Settings modal (4 LLM providers), API key management, # trigger, LLM command translation, review-first execution, loading/error states, staleness guard |

## Test Summary (verified 2026-03-15)

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 193 |
| Unit | cargo test (Rust) | 64 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 10 |
| E2E | Playwright (real app + CDP) | 22+ |
| **Total** | | **~289** |

## Security Reviews Summary
- 7 security reviews conducted across all pillars
- 0 critical findings ever
- Key accepted risks: plaintext API key storage (MVP), Google API key in URL, full env inheritance by shells
- Never-auto-execute guarantee verified for Agent Mode

## Outstanding Issues — Tracked

### Medium Severity
- BUG-004: Full ANSI re-parse per PTY event (perf)
- BUG-009: Rapid shell switching race → orphaned sessions
- BUG-020: Welcome block retains `running` status after session close
- BUG-025: No per-block output size limit
- BUG-033: Tab close → closeSession fire-and-forget
- BUG-034: No frontend MAX_SESSIONS enforcement for tabs
- SEC-015-H1: Plaintext API key storage (future: OS keychain)
- SEC-015-H2: Google API key in URL query param
- SEC-015-M3: get_settings returns full API key to WebView
- SEC-015-M4: Azure endpoint not SSRF-validated
- SEC-017-H1: LLM prompt injection / social engineering (add dangerous command warnings)
- SEC-017-M2: get_cwd path disclosure to LLM providers

### Low Severity
- BUG-010, 028, 029, 031, 032, 035, 038 + various QA observations

### Accepted Risk
- SEC-002-H1: Full parent env inherited by shells
- SEC-001-M1: `unsafe-inline` in style-src CSP
- SEC-005-M1: Rerun without confirmation

## Architecture Notes
- Current HEAD: `eb56db1`
- ~50 commits on main
- Rust backend: PTY (portable-pty + ConPTY), ANSI filter (vte), session manager, LLM client (reqwest), settings (JSON file)
- React frontend: Terminal, BlockView, InputEditor, TabManager, PaneContainer, SettingsModal
- Channel-based PTY architecture (testable without Tauri runtime)
- 4 LLM providers: OpenAI, Anthropic (Claude), Google (Gemini), Azure OpenAI
