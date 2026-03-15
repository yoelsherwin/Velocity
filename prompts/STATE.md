# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-15`

## Current Phase
Feature development — Pillar 5 (Agent Mode) in progress.

## Backlog Position
Pillar: 5 (Agent Mode)
Next task number: 015

## Pillar 5 Plan: Agent Mode (3 tasks)

### TASK-015: Settings System + API Key Management
- Settings data model: provider, API key, model name, endpoint (for Azure)
- Tauri commands: `save_settings`, `get_settings`
- Settings persisted to `%LOCALAPPDATA%/Velocity/settings.json`
- Frontend: Settings modal with provider dropdown, API key input, model selector
- Providers: OpenAI, Anthropic (Claude), Google (Gemini), Azure OpenAI
- Gear icon in the tab bar to open settings

### TASK-016: LLM Provider Client (Rust)
- Rust HTTP client using `reqwest` crate
- Multi-provider abstraction: trait-based `LlmProvider`
- Support all 4 providers with their respective API formats
- System prompt template: "Translate natural language to a {shell_type} command for Windows. CWD: {cwd}. Output ONLY the command, nothing else."
- Tauri command: `translate_command(input, shell_type, cwd)` → `Result<String, String>`
- Reads settings to determine which provider/key/model to use

### TASK-017: Agent Mode UI + Intent Classifier
- Simple heuristic intent classifier: `#` prefix = NL mode, starts with known commands = CLI mode
- `#` trigger: user types `# find all ts files` → strips `#`, sends to LLM
- Auto-detect: if input doesn't look like a CLI command, suggest agent mode
- Loading state while LLM processes (spinner in input area)
- Generated command populates input editor for review
- User presses Enter to execute (review-first, never auto-execute)
- Error states: no API key configured → prompt to open settings, API error → show in output

### Execution order: 015 → 016 → 017

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
| FIX-011 | Batch fix for missed findings | `b19111d` | APPROVED R1 | N/A | N/A |
| TASK-011 | Ghost text + command history | `525aade` | APPROVED R2 | N/A | N/A |
| TASK-012 | Exit codes via shell markers | `47dedf8` | APPROVED (R1+fix) | PASS R1 | PASS |
| TASK-013 | Draggable pane dividers | `8613c86` | APPROVED R1 | PASS R1 | PASS |
| TASK-014 | Per-tab pane focus | `b99bba1` | APPROVED R1 | PASS R1 | PASS |
| TASK-015-E2E | E2E test expansion (21 tests) | `0d0239e` | N/A | N/A | N/A |
| FIX-watchdog | ConPTY exit detection watchdog | `93cb37b` | N/A | N/A | N/A |

## In Progress
None. TASK-015 and TASK-016 complete. Ready for TASK-017 (Agent Mode UI).

## Outstanding Issues — Tracked

### Medium Severity
- BUG-004, BUG-009, BUG-020, BUG-025, BUG-033, BUG-034
- SEC-012-M1 (marker spoofing), SEC-012-M2 (PS exit codes 0/1 only)
- CR-002-I4 (UTF-8 lossy conversion)

### Low Severity
- BUG-010, 028, 029, 031, 032, 035, 038
- SEC-004-L4, SEC-012-L6

### Accepted Risk
- SEC-002-H1, SEC-001-M1, SEC-005-M1

## Pillar Status

| Pillar | Status |
|--------|--------|
| 1. Process Interfacing | **COMPLETE** |
| 2. Block Model | **COMPLETE** |
| 3. Input Editor | **COMPLETE** |
| 4. Structural Layout | **COMPLETE** |
| 5. Agent Mode | **IN PROGRESS** (0/3 tasks) |

## Test Summary (verified 2026-03-15)

| Layer | Suite | Count |
|-------|-------|-------|
| Unit | Vitest (frontend) | 159 |
| Unit | cargo test (Rust) | 36 (+1 ignored) |
| Integration | Rust PTY (real PowerShell) | 10 |
| E2E | Playwright | 21 |
| **Total** | | **226** |

## Last Security Review
- Scope: TASKS-012-014 batch
- HEAD at review: `7ace1a7`
