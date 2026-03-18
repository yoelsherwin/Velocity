# Velocity Project State

> Last updated by CTO session: `41746083-3b91-4ff2-83f8-b09d0c659fc1`
> Last updated at: `2026-03-17`

## Current Phase
**Post-MVP Phase 1 (Usability).** Closing P0 gaps for daily-use readiness.

## Phase 1 Progress

| # | Feature | Status |
|---|---------|--------|
| P0-1 | Full terminal emulation (xterm/VT100) | Not started |
| P0-2 | Tab/path completions | **DONE** (`e57b639` + `dde12a2`) |
| P0-3 | Find in terminal output (Ctrl+Shift+F) | **DONE** (`3848a3a` + `7251e29`) |
| P0-4 | Command palette (Ctrl+Shift+P) | **DONE** (`23e812a` + `9592e1c`) |
| P0-5 | Scrollback + large output handling | **DONE** (`25ae200` + `b7bca3d`) |
| P0-6 | True color + 256-color rendering | **DONE** (`a04290b`) — was already working, added 8 tests |
| P0-7 | CLI/AI mode indicator | **DONE** (`04461db`) |
| P0-8a | Intent classifier heuristic engine | **DONE** (`04461db`) |
| P0-8b | Known-command enumeration (Rust) | **DONE** (`04461db`) |
| P0-8c | LLM fallback for ambiguous inputs | Deferred |
| P0-BUG | BUG-004 + BUG-025 | **FIXED** in P0-5 |

**Remaining: P0-1** (1 item)

## In Progress
None.

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
- QA-021 BUG-001: `terminal.clear` drops in-flight PTY output (no replacement block)
- QA-021 BUG-002: Keyboard shortcuts leak through open palette overlay
- QA-022 BUG-001: Tab completion debounce makes first Tab appear unresponsive
- QA-022 BUG-002: handleTab bypasses handleInputChange (skips draft/classifier update)
- QA-022 BUG-007: CWD for completions is Tauri process CWD, not shell CWD after cd

### Low
- BUG-010, 028, 029, 031, 032, 035, 038, 040, 041
- QA-018 BUG-001: History navigation doesn't re-classify intent
- QA-018 BUG-002: ModeIndicator missing disabled HTML attribute
- QA-020 BUG-001: Search "10,000+ matches" text unreachable (> vs >=)
- QA-021 BUG-003: Missing ARIA attributes on command palette
- QA-021 BUG-004: Hover and selected states visually identical in palette
- QA-022 BUG-003: Case-insensitive ghost text looks odd with mixed-case partials
- QA-022 BUG-004: Completions reset on any cursor move, even within same token
- QA-022 BUG-006: PATH scan strips extensions via first-dot split

### Accepted Risk
- SEC-002-H1: Full parent env inherited by shells
- SEC-001-M1: `unsafe-inline` in style-src CSP
- SEC-005-M1: Rerun without confirmation
- SEC-022: Unrestricted directory enumeration via get_completions (accepted — terminal has full shell access)

## Test Summary

| Layer | Count |
|-------|-------|
| Vitest (frontend) | 313 |
| cargo test (Rust unit) | 77 (+1 ignored) |
| Rust integration | 10 |
| Playwright E2E | 26 |
| **Total** | **~426** |

## Remaining Phase 1 Roadmap

### P0-1: Full terminal emulation (Large — biggest remaining item)
Need alternate screen, cursor positioning, application-mode keys. Consider `alacritty_terminal` or `vt100` crate, or `xterm.js` on frontend.

### P0-2: Tab/path completions (Medium-Large)
Start with path completion + top 20 CLI tools. Consider Fig completion spec format.

## Phase 2: Adoption (P1 — make users want to switch)

Full gap analysis: `prompts/reports/investigations/INVESTIGATION-warp-feature-gap.md`

### Terminal Emulation & Rendering
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-R1 | Bold, italic, underline, strikethrough, dim rendering | Small | SGR codes preserved by filter but not all rendered in frontend |
| P1-R2 | GPU-accelerated rendering (or virtualized DOM) | Large | React DOM bottlenecks on large output. Canvas/WebGL long-term. |
| P1-R3 | Configurable scrollback lines | Small | Let user reduce scrollback to save memory |
| P1-R4 | Custom cursor shapes (block/underline/bar) | Small | No cursor rendering in output area |

### Block Model Enhancements
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-B1 | Block navigation (Ctrl+Up/Down between blocks) | Small | |
| P1-B2 | Block selection (click to select) | Small | |
| P1-B3 | Block collapse/expand | Medium | Fold long output blocks |
| P1-B4 | Block filtering (show only matching lines) | Medium | Live filter while process runs |
| P1-B5 | Sticky command header (pin on scroll) | Small | |

### Input & History
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-I1 | Rich history (exit code + CWD + git branch per entry) | Medium | Currently stores text only |
| P1-I2 | History search (Ctrl+R reverse search, full-text panel) | Medium | Only Up/Down navigation exists |
| P1-I3 | Command corrections (typo fix after failed command) | Medium | AI-powered post-error suggestions |
| P1-I4 | IDE-like cursor (mouse click-to-position, word selection) | Medium | Basic textarea currently |

### AI / Agent Enhancements
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-A1 | Multi-turn agent conversation | Medium | Currently single-shot translation only |
| P1-A2 | AI error correction (failed command → suggest fix with context) | Medium | |
| P1-A3 | Codebase/file context awareness for agent | Medium | Agent doesn't know project structure |
| P1-A4 | Full Terminal Use (agent runs commands, not just translates) | Large | Agent can execute and iterate |

### UI / UX
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-U1 | Custom themes (YAML-based) + theme library | Medium | Catppuccin Mocha hardcoded |
| P1-U2 | Custom fonts + size/line-height config | Small | |
| P1-U3 | Git context in prompt (branch, status, dirty) | Medium | |
| P1-U4 | Custom prompt (Starship, P10k import) + context chips | Medium | |
| P1-U5 | Desktop notifications (long-running commands) | Small | |
| P1-U6 | Global hotkey (summon terminal, Quake-style) | Small | |
| P1-U7 | Quit warning (running processes) | Small | |
| P1-U8 | Per-tab/pane auto-titles (CWD, running process) | Small | |

### Session & Window Management
| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| P1-W1 | Session restoration on restart (SQLite) | Medium | Lose everything on close |
| P1-W2 | Multiple windows | Medium | Single window currently |
| P1-W3 | Secret redaction (regex-based, click to reveal) | Medium | API keys visible in output |

## Phase 3: Polish (P2 — competitive parity)

| # | Feature | Notes |
|---|---------|-------|
| P2-1 | Vim keybindings (vi-mode for input editor) | |
| P2-2 | SSH with Velocity features (Warpify via tmux) | |
| P2-3 | Launch configurations (YAML, per-project workspaces) | |
| P2-4 | Workflows (parameterized aliases with `{{arg}}` syntax) | |
| P2-5 | Tab drag reordering | |
| P2-6 | NL auto-detection without # (remove explicit trigger requirement) | |
| P2-7 | Environment variable management (per-project) | |
| P2-8 | Accessibility (screen reader, high contrast) | |
| P2-9 | Code editor integration (open file from terminal in VS Code) | |
| P2-10 | Input position (pin to top/bottom) | |
| P2-11 | Classic input mode (traditional inline input) | |
| P2-12 | Font ligatures | |
| P2-13 | Emoji width handling | |
| P2-14 | Custom cursor shapes | |
| P2-15 | AI pair mode (observe and assist) | |
| P2-16 | AI dispatch mode (autonomous multi-step tasks) | |
| P2-17 | Telemetry with opt-out | |
| P2-18 | OSC escape sequence notifications (OSC 9, 777) | |
| P2-19 | Transparent/blurred backgrounds | |
| P2-20 | Block bookmarking | |

## Phase 4: Differentiation (P3 — beyond Warp)

| # | Feature | Notes |
|---|---------|-------|
| P3-1 | Cloud collaboration (team drive, shared workflows) | |
| P3-2 | Notebooks (runnable docs with executable code blocks) | |
| P3-3 | Oz-style cloud agent orchestration | |
| P3-4 | Docker/K8s integration (click-to-shell containers) | |
| P3-5 | Sixel/image protocol support | |
| P3-6 | Remote file editing over SSH | |
| P3-7 | Markdown viewer with executable blocks | |
| P3-8 | Built-in file tree sidebar | |
| P3-9 | Built-in code editor with LSP | |
| P3-10 | Block sharing (permalinks, cloud URLs) | |
| P3-11 | SSO/SAML enterprise auth | |
| P3-12 | AI computer use (visual verification) | |
| P3-13 | Session sharing (live terminal) | |
| P3-14 | Right-to-left text / BiDi support | |

## Strategic Notes

- **Windows-first advantage**: Warp's Windows support is less mature than macOS. Velocity being Windows-native with first-class PowerShell/WSL is a real differentiator.
- **Terminal, not IDE**: Warp is pivoting toward an "Agentic Development Environment" (code editor, file tree, code review). Velocity wins by being the best terminal for users who don't want an IDE.
- **Performance wall**: React DOM will bottleneck on large outputs. Phase 1 uses virtualized rendering; long-term may need Canvas/WebGL (P1-R2).
- **The completion gap is critical**: Tab completion is the second most-used terminal feature. P0-2 must be high quality.
- **xterm.js consideration**: For P0-1 (full terminal emulation), consider replacing the current block-based renderer with xterm.js for the output area. This gives full VT100 support immediately but changes the block model architecture significantly.
