# Investigation: Warp Feature Gap Analysis

**Date**: 2026-03-15
**Author**: Investigator Agent
**Purpose**: Map Warp's feature set against Velocity's MVP to build a post-MVP roadmap.

---

## 1. Executive Summary

Warp has evolved from a "modern terminal" into an **Agentic Development Environment (ADE)** with deep AI integration, cloud collaboration (Warp Drive, Oz orchestration), and a full-featured code editor. Velocity's MVP covers the fundamentals well -- PTY management, block model, input editing, tabs/panes, and basic agent mode -- but has significant gaps in terminal emulation fidelity, AI depth, search/filter tooling, collaboration, and polish features that would prevent daily-driver adoption.

The biggest P0 gaps are around **terminal emulation completeness** (mouse support, scrollback, true color, application-mode cursor keys), **search/find in output**, and **command completions**. Without these, power users will hit walls within minutes of normal use.

---

## 2. Full Feature Comparison Table

### 2.1 Terminal Emulation & Rendering

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Full VT100/xterm emulation | **Missing** | Velocity uses vte crate for ANSI filtering only, not full terminal state machine. No cursor positioning, no alternate screen buffer, no application mode. Interactive programs (vim, htop, less) will not work. | **P0** |
| True color (24-bit) rendering | **Missing** | ANSI filter preserves SGR codes but the React frontend renders them as inline styled spans. No evidence of 24-bit color parsing/rendering in `AnsiOutput.tsx`. | **P0** |
| 256-color support | **Partial** | SGR codes are preserved through the filter, but rendering fidelity in the frontend is unverified. | **P0** |
| Mouse support (click, scroll, drag in TUI apps) | **Missing** | No mouse protocol handling. TUI apps like vim, tmux, htop that request mouse events will not work. | **P0** |
| Font ligatures | **Missing** | No ligature rendering support. Standard monospace font rendering only. | **P2** |
| GPU-accelerated rendering | **Missing** | Velocity renders via React DOM. Warp uses Rust + GPU for all text rendering. This matters at scale (large outputs, fast scrolling). | **P1** |
| Sixel/image protocol support | **Missing** | No inline image rendering. | **P3** |
| Emoji rendering | **Partial** | Relies on system font fallback in the webview. No dedicated emoji width handling. | **P2** |
| Bold, italic, underline, strikethrough | **Partial** | SGR codes preserved; frontend rendering of all variants unverified. Warp supports bold, dim, italic, underline (single/double/curly/colored), strikethrough, overline. | **P1** |
| Blink, reverse, invisible text | **Missing** | No support for these SGR attributes in the frontend renderer. | **P3** |
| Right-to-left text | **Missing** | No BiDi support. | **P3** |
| Scrollback buffer (configurable) | **Missing** | MAX_BLOCKS = 50 per terminal. No scrollback buffer concept for output within blocks. Warp has configurable scrollback (default high, adjustable). | **P0** |
| Alternate screen buffer | **Missing** | Required for vim, less, htop, etc. The terminal does not maintain screen state. | **P0** |
| Custom cursor shapes | **Missing** | No cursor rendering in output area (block/underline/bar). | **P2** |

### 2.2 Block Model

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Command + output blocks | **Done** | Velocity has this. | -- |
| Block navigation (keyboard) | **Missing** | Warp allows Cmd+Up/Down to navigate between blocks. Velocity has no block-level keyboard navigation. | **P1** |
| Block selection (click to select) | **Missing** | Warp allows clicking a block to select it, enabling block-level actions. | **P1** |
| Block find (Cmd+F within block) | **Missing** | Warp has per-block search with regex and case sensitivity toggle. Velocity has no search. | **P0** |
| Block filtering (show only matching lines) | **Missing** | Warp can filter block output to show only lines matching a pattern, live, even while a process is running. | **P1** |
| Sticky command header | **Missing** | When scrolling a long block, Warp pins the command at the top so you always know what produced the output. | **P1** |
| Block bookmarking | **Missing** | Warp allows bookmarking important blocks for quick reference (session-scoped). | **P2** |
| Block sharing (permalink) | **Missing** | Warp generates shareable URLs for blocks. Requires cloud infrastructure. | **P3** |
| Copy command / Copy output | **Done** | Velocity has copy command and copy output (ANSI-stripped). | -- |
| Rerun command | **Done** | Velocity has rerun button. | -- |
| Exit code indicator | **Done** | Velocity has checkmark/X indicators. | -- |
| Timestamp per block | **Done** | Velocity has this. | -- |
| Block collapse/expand | **Missing** | Ability to collapse long output blocks. | **P1** |

### 2.3 Input Editor

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Multi-line editing | **Done** | Shift+Enter for newlines. | -- |
| Syntax highlighting | **Done** | Commands, flags, strings, pipes highlighted. | -- |
| Cursor movement (IDE-like) | **Partial** | Basic textarea. Warp has full IDE-like cursor with mouse click-to-position, word selection, etc. | **P1** |
| Vim keybindings | **Missing** | Warp has vi-mode for the input editor with normal/insert mode switching. | **P2** |
| Tab completions (400+ CLI tools) | **Missing** | Velocity has no tab completion. Warp has built-in specs for 400+ commands with fuzzy matching. | **P0** |
| Autosuggestions (history-based) | **Done** | Velocity has ghost text from history. | -- |
| AI command suggestions (as-you-type) | **Missing** | Warp generates AI suggestions as you type, not just from history. | **P2** |
| Command corrections (typo fix) | **Missing** | Warp auto-suggests corrections for typos and missing flags after a failed command. | **P1** |
| Command history (Up/Down) | **Done** | Velocity has history navigation. | -- |
| Rich history (exit codes, directory, branch, runtime) | **Missing** | Velocity stores command text only. Warp stores exit code, CWD, git branch, runtime, and completion time per history entry. | **P1** |
| History search (prefix + full-text) | **Partial** | Velocity has Up/Down navigation. Missing Ctrl+R reverse search, full-text search panel, and filtering by metadata. | **P1** |
| Input position (top/bottom pin) | **Missing** | Warp lets you pin the input editor to top or bottom of the terminal. | **P2** |
| Classic input mode (traditional terminal) | **Missing** | Warp offers a fallback "classic" input mode that behaves like a traditional terminal (inline input at cursor). | **P2** |

### 2.4 AI / Agent Features

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Natural language to command (`#` prefix) | **Done** | Velocity has `#` prefix triggering LLM translation. | -- |
| Multi-turn agent conversation | **Missing** | Warp has Agent Modality -- a dedicated conversation view for multi-turn workflows. Velocity only does single-shot translation. | **P1** |
| Pair Mode (AI assists alongside you) | **Missing** | Warp's Pair Mode lets AI observe and assist as you work in the terminal. | **P2** |
| Dispatch Mode (AI works independently) | **Missing** | Warp's Dispatch Mode sends AI to complete complex multi-step tasks autonomously. | **P2** |
| Full Terminal Use (agent runs commands) | **Missing** | Warp agents can execute terminal commands, observe output, and iterate. Velocity's agent only translates -- it cannot execute or chain. | **P1** |
| Computer Use (agent verifies with UI) | **Missing** | Warp agents can use computer/screen to verify changes visually. | **P3** |
| Codebase context (file awareness) | **Missing** | Warp agents are aware of the project's file tree, can search files, and reference code. | **P1** |
| AI command corrections (post-error) | **Missing** | After a command fails, Warp can suggest AI-powered fixes with error context. | **P1** |
| Natural language auto-detection | **Missing** | Warp detects natural language (vs CLI) locally without requiring a `#` prefix. | **P2** |
| Prompt suggestions (Active AI) | **Missing** | Warp proactively suggests what you might want to do next based on context. | **P2** |
| Next Command suggestion | **Missing** | AI-generated suggestion for the next command based on session history. | **P2** |
| Agent desktop notifications | **Missing** | Notifications when agents complete or need attention. | **P2** |
| Oz cloud agent orchestration | **Missing** | Cloud-based autonomous agents with cron scheduling, Slack/GitHub/Linear triggers, multi-repo support. Enterprise-tier feature. | **P3** |

### 2.5 UI / UX

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Command palette (Ctrl+Shift+P) | **Missing** | Warp has a VS Code-style command palette for searching all actions, settings, workflows, notebooks. | **P0** |
| Find in terminal (Ctrl+Shift+F) | **Missing** | Global search across all terminal output in a pane. | **P0** |
| Custom themes (YAML-based) | **Missing** | Warp has a theme library plus custom YAML theme authoring with background images/gradients. Velocity has no theming. | **P1** |
| Theme library (pre-built) | **Missing** | Warp ships with dozens of pre-built themes. | **P1** |
| Custom fonts | **Missing** | Warp allows any installed font, with configurable size and line height. | **P1** |
| Transparent/blurred backgrounds | **Missing** | Warp supports window opacity and background blur. | **P3** |
| Custom prompt (PS1 import, Starship, P10k) | **Missing** | Warp renders the shell prompt with context chips (git branch, k8s context, CWD, etc.) or imports PS1/Starship/P10k. | **P1** |
| Context chips (git, k8s, pyenv, etc.) | **Missing** | Visual chips showing current git branch, k8s context, python env, etc. in the prompt area. | **P1** |
| Desktop notifications (long-running commands) | **Missing** | Notifications when commands complete after configurable seconds. | **P1** |
| Quit warning (running processes) | **Missing** | Warns when quitting with active processes. | **P1** |
| Accessibility (VoiceOver, screen reader) | **Missing** | No accessibility support. Warp supports VoiceOver on macOS. | **P2** |
| Global hotkey (summon terminal) | **Missing** | System-wide hotkey to show/hide the terminal (like Quake-style dropdown). | **P1** |
| Markdown viewer | **Missing** | Warp can render markdown files with executable code blocks. | **P3** |

### 2.6 Session & Window Management

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Tabs | **Done** | Ctrl+T / Ctrl+W. | -- |
| Split panes (horizontal/vertical) | **Done** | Ctrl+Shift+Right/Down with draggable dividers. | -- |
| Session restoration on restart | **Missing** | Warp saves and restores windows, tabs, panes, and their state (CWD, history) on restart. Uses SQLite. | **P1** |
| Launch configurations (YAML) | **Missing** | Save multi-window/tab/pane layouts with startup commands. Reopen per-project workspaces instantly. | **P2** |
| Per-tab/pane titles | **Missing** | Custom or auto-detected titles per tab/pane (e.g., current directory name, running process). | **P1** |
| Tab drag reordering | **Missing** | Drag tabs to reorder them. | **P2** |
| Multiple windows | **Missing** | Warp supports multiple independent windows. Velocity appears to be single-window. | **P1** |

### 2.7 Command Completions & Workflows

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Tab completions (400+ tools) | **Missing** | Built-in completion specs for git, docker, npm, kubectl, cargo, etc. Fuzzy matching. | **P0** |
| Path completions | **Missing** | Tab-complete file and directory paths. | **P0** |
| Warp Drive (cloud knowledge base) | **Missing** | Personal/team cloud storage for workflows, notebooks, env vars, prompts. | **P3** |
| Workflows (parameterized aliases) | **Missing** | Reusable parameterized commands with `{{arg}}` syntax. Searchable from command palette. | **P2** |
| Notebooks (runnable docs) | **Missing** | Interactive runbooks with markdown + executable command blocks. | **P3** |
| Environment variable management | **Missing** | Save/sync environment variables per project/team. Load into sessions. | **P2** |

### 2.8 Collaboration

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Team Drive (shared workflows) | **Missing** | Shared cloud workspace for team commands, notebooks, env vars. Free for 3 users. | **P3** |
| Session sharing | **Missing** | Share live terminal sessions with other team members. | **P3** |
| Block sharing (permalinks) | **Missing** | Generate shareable URLs for terminal output blocks. | **P3** |
| SSO/SAML authentication | **Missing** | Enterprise auth integration. | **P3** |

### 2.9 Security & Privacy

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| ANSI security filter | **Done** | Velocity strips dangerous sequences (OSC, title set, etc.). | -- |
| Secret redaction (regex-based) | **Missing** | Warp detects API keys, passwords, PII via configurable regex and replaces with asterisks. Click to reveal. Redacted on copy. | **P1** |
| Telemetry opt-out | **Missing** | No telemetry system yet; will need opt-out when added. | **P2** |
| Zero data retention policy | **Missing** | Enterprise feature. | **P3** |

### 2.10 SSH & Remote

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| SSH with Warp features (Warpify) | **Missing** | Warp wraps SSH sessions via tmux to enable blocks, completions, input editor on remote machines. | **P2** |
| SSH session detection | **Missing** | Auto-detect interactive SSH sessions and offer to Warpify. | **P2** |
| Remote file editing | **Missing** | Code editor + file tree over SSH. | **P3** |

### 2.11 Integrations

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Git context (branch, status in prompt) | **Missing** | Warp shows git branch, uncommitted changes count, staged/unstaged. | **P1** |
| Docker extension (click-to-shell) | **Missing** | Click to open Docker containers in a subshell. | **P3** |
| Kubernetes context chip | **Missing** | Show k8s context in prompt area. | **P3** |
| Code editor integration (VSCode, Cursor) | **Missing** | Open files from terminal in external editor. | **P2** |
| Raycast/Alfred launcher | **Missing** | N/A for Windows (these are macOS tools). Equivalent would be PowerToys Run integration. | **P3** |
| OSC escape sequence notifications | **Missing** | Support OSC 9 and OSC 777 for script-triggered desktop notifications. | **P2** |

### 2.12 Code Editing (Warp 2.0 ADE Features)

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| Built-in file tree | **Missing** | Warp has a sidebar file tree for the current project. | **P2** |
| Built-in code editor with LSP | **Missing** | Warp has a full code editor with language server protocol support. | **P3** |
| Code review interface | **Missing** | Inline code review with line-level comments, send to agents. | **P3** |
| Find and replace in files | **Missing** | Editor feature. | **P3** |

### 2.13 Performance

| Warp Feature | Velocity Status | Gap Description | Priority |
|---|---|---|---|
| GPU rendering (Rust-native) | **Missing** | Warp renders all text via GPU. Velocity uses React DOM. Will bottleneck on large outputs. | **P1** |
| Efficient scrollback | **Missing** | Large output handling. Velocity has BUG-025 (no per-block output size limit) and BUG-004 (full re-parse per event). | **P0** |
| Configurable scrollback lines | **Missing** | Warp allows reducing scrollback to save memory. | **P1** |

---

## 3. P0 Gaps -- Must-Close for Usability

These gaps make the terminal **unusable for daily work** if not addressed. Users will abandon Velocity within minutes of hitting these walls.

### 3.1 Full Terminal Emulation (VT100/xterm)
**Impact**: Without alternate screen buffer, cursor positioning, and application-mode keys, users cannot run vim, less, htop, tmux, nano, or any full-screen TUI application. This is the single largest gap.
**Scope**: Large. Requires a proper terminal state machine (grid of cells with attributes, cursor state, scroll regions, alternate buffer). Consider integrating a crate like `alacritty_terminal` or `vt100` for the backend, and rendering the cell grid on the frontend.

### 3.2 Tab Completions and Path Completions
**Impact**: Every terminal user expects Tab to complete commands, flags, and paths. Without this, Velocity feels broken.
**Scope**: Medium-large. Warp uses built-in completion specs for 400+ tools. Start with path completion and a small set of popular tools (git, docker, npm, cargo). Consider the Fig completion spec format as a data source.

### 3.3 Find in Terminal Output
**Impact**: Users constantly Ctrl+F to search output. This is the single most-used feature after typing commands.
**Scope**: Small-medium. Implement a search overlay (Ctrl+Shift+F) that highlights matches in the output area. Per-block search (Ctrl+F with block selected) as a bonus.

### 3.4 Command Palette
**Impact**: Warp, VS Code, and every modern tool has one. Users expect Ctrl+Shift+P to find actions, settings, and features. Without it, discoverability collapses.
**Scope**: Small-medium. Modal overlay with fuzzy search over registered actions and settings.

### 3.5 Scrollback Buffer / Large Output Handling
**Impact**: MAX_BLOCKS = 50 and no per-block output size limit means: (a) users lose history quickly, and (b) a single `cat large-file.txt` can freeze the UI. Combined with BUG-004 (full ANSI re-parse per event) and BUG-025, this is a usability and stability problem.
**Scope**: Medium. Implement virtualized rendering (only render visible lines), output truncation with "Show more" expansion, and increase MAX_BLOCKS or make it configurable.

### 3.6 True Color and 256-Color Rendering
**Impact**: Many modern CLI tools (bat, delta, lsd, starship) output 24-bit color. If Velocity cannot render these, output looks broken.
**Scope**: Small. Ensure the ANSI parser and React renderer handle `\e[38;2;R;G;Bm` (24-bit foreground) and `\e[38;5;Nm` (256-color) SGR sequences correctly.

---

## 4. P1 Gaps -- Should-Close for Adoption

These gaps do not break the terminal but make users **choose to stay** with their current terminal (Windows Terminal, Warp, iTerm2). Closing these makes Velocity compelling.

### 4.1 AI Depth (Multi-turn, Error Fix, Context)
- Multi-turn agent conversation (not just single-shot translation)
- AI-powered error correction (attach failed command as context)
- Codebase/file context awareness for agent
- Full Terminal Use (agent can run commands, not just translate)

### 4.2 UI Polish
- Custom themes (at minimum: dark/light toggle, then YAML theme files)
- Custom fonts (configurable family, size, line height)
- Git context in prompt (branch name, dirty state)
- Custom prompt / Starship integration
- Desktop notifications for long-running commands
- Quit warning when processes are running
- Global hotkey to summon the terminal

### 4.3 Block Model Enhancements
- Block navigation (Ctrl+Up/Down to jump between blocks)
- Block selection (click to select, then block actions)
- Block collapse/expand for long outputs
- Sticky command header (pin command at top of long block while scrolling)
- Block filtering (show only matching lines, live, with regex)

### 4.4 Input / History Enhancements
- Command corrections (suggest fix after failed command)
- Rich history (store exit code, CWD, git branch, runtime per entry)
- Ctrl+R reverse search
- Bold/italic/underline/strikethrough rendering in output

### 4.5 Session Management
- Session restoration on app restart (save/restore tabs, panes, CWD)
- Per-tab/pane titles (auto-detect from CWD or running process)
- Multiple independent windows

### 4.6 Performance
- GPU rendering or virtualized DOM rendering for large outputs
- Configurable scrollback buffer size

### 4.7 Security
- Secret redaction (regex-based, configurable, redact on copy)

### 4.8 Integrations
- Git context chips
- OSC notification escape sequence support

---

## 5. P2 Gaps -- Competitive Parity (Can Defer)

| Gap | Notes |
|---|---|
| Vim keybindings in input editor | Nice for vim users but not blocking. |
| Input position (pin top/bottom) | UX preference feature. |
| Classic input mode | Fallback for users who prefer traditional inline input. |
| AI as-you-type suggestions | Enhancement over history-based ghost text. |
| Natural language auto-detection (no # prefix) | Polish over MVP # prefix approach. |
| Pair Mode / Dispatch Mode (agent modes) | Requires significant agent infrastructure. |
| Active AI / Prompt suggestions / Next Command | Proactive AI features. |
| Agent notifications | Desktop notifications for agent completion. |
| Accessibility (screen reader) | Important for inclusivity, plan for it. |
| Launch configurations (YAML) | Power-user workspace management. |
| Tab drag reordering | Standard UI feature. |
| Workflows (parameterized aliases) | Warp Drive feature. |
| Environment variable management | Warp Drive feature. |
| SSH with Warp features | Requires significant tmux-based wrapper. |
| Code editor integration | Open-in-editor from terminal. |
| Built-in file tree | ADE feature, beyond terminal scope for now. |
| Font ligatures | Rendering enhancement. |
| Emoji width handling | Rendering correctness. |
| Custom cursor shapes | Minor polish. |
| Telemetry opt-out | Needed before adding telemetry. |
| OSC notification support | Script-triggered notifications. |

---

## 6. P3 Gaps -- Nice to Have (Defer Indefinitely)

| Gap | Notes |
|---|---|
| Oz cloud agent orchestration | Enterprise SaaS product. Not in scope. |
| Team Drive / Session sharing / Block permalinks | Cloud collaboration infrastructure. |
| Built-in code editor with LSP | ADE scope, not terminal scope. |
| Code review interface | ADE scope. |
| Sixel/image protocol | Niche graphics feature. |
| Transparent/blurred backgrounds | Eye candy. |
| Markdown viewer with executable blocks | Nice but niche. |
| Docker extension (click-to-shell) | Integration. |
| Kubernetes context chip | Integration. |
| SSO/SAML | Enterprise. |
| Zero data retention policy | Enterprise. |
| Blink/reverse/invisible text | Rare SGR attributes. |
| Right-to-left text | BiDi support. |
| Remote file editing over SSH | ADE scope. |
| Raycast/Alfred/PowerToys launcher | Platform integration. |
| Notebooks (runnable docs) | Warp Drive feature. |

---

## 7. Known Bugs Assessment

| Bug | Description | Priority | Rationale |
|---|---|---|---|
| **BUG-004** | Full ANSI re-parse per output event | **P0** | Directly causes UI lag on any non-trivial output. Must fix before release. Core performance issue. |
| **BUG-025** | No per-block output size limit | **P0** | A single `cat large-file.txt` or runaway process can freeze/crash the UI. Must add truncation + "Show more". |
| **BUG-020** | Welcome block retains running status | **P1** | Visible cosmetic bug that makes the app look broken on first launch. Easy fix, high first-impression impact. |
| **BUG-033** | Tab close cleanup fire-and-forget | **P1** | Resource leak over time. Important for session stability but not immediately user-visible. |
| **BUG-034** | No frontend MAX_SESSIONS enforcement | **P1** | Could lead to resource exhaustion. Rust enforces MAX_SESSIONS=20 but frontend does not check before creating. |
| **BUG-009** | Rapid shell switching race | **P1** | Edge case but can cause confusing state. The staleness guard in agent mode was a partial fix. |
| Security findings | Plaintext API keys, prompt injection vectors | **P0-P1** | Plaintext API key storage is P0 -- must encrypt or use OS keychain before release. Prompt injection is P1. |

### Bug Priority Summary
- **P0 (must fix before any release)**: BUG-004, BUG-025, plaintext API key storage
- **P1 (fix before public beta)**: BUG-020, BUG-033, BUG-034, BUG-009, prompt injection hardening

---

## 8. Recommended Post-MVP Implementation Order

Based on the gap analysis, here is the recommended implementation sequence. Each phase builds on the previous and unlocks the next level of usability.

### Phase 1: "Make It Actually Usable" (P0 -- Weeks 1-6)

**Goal**: A user can open Velocity, run commands, see output correctly, search output, and use interactive programs.

| Order | Feature | Effort | Depends On |
|---|---|---|---|
| 1.1 | Fix BUG-004 (incremental ANSI parsing) | Small | -- |
| 1.2 | Fix BUG-025 (per-block output size limit + truncation) | Small | -- |
| 1.3 | True color + 256-color rendering | Small | -- |
| 1.4 | Virtualized output rendering (only render visible lines) | Medium | 1.1, 1.2 |
| 1.5 | Full terminal emulation (alternate screen, cursor, scroll regions) | Large | 1.4 |
| 1.6 | Mouse support (for TUI apps in alternate screen) | Medium | 1.5 |
| 1.7 | Find in terminal (Ctrl+Shift+F) | Medium | -- |
| 1.8 | Path completions (Tab to complete file/dir paths) | Medium | -- |
| 1.9 | Command palette (Ctrl+Shift+P) | Medium | -- |
| 1.10 | Fix plaintext API key storage (encrypt or OS keychain) | Small | -- |

### Phase 2: "Make It Compelling" (P1 -- Weeks 7-14)

**Goal**: Users choose Velocity over Windows Terminal because of its block model, AI, and polish.

| Order | Feature | Effort | Depends On |
|---|---|---|---|
| 2.1 | Tab completions for common tools (git, docker, npm, cargo) | Medium | 1.8 |
| 2.2 | Custom themes (dark/light + YAML theme engine) | Medium | -- |
| 2.3 | Custom fonts (family, size, line height) | Small | -- |
| 2.4 | Block navigation + selection (Ctrl+Up/Down, click) | Small | -- |
| 2.5 | Block collapse/expand | Small | 2.4 |
| 2.6 | Sticky command header | Small | 2.4 |
| 2.7 | Block filtering (regex, live) | Medium | 2.4 |
| 2.8 | Git context in prompt (branch, dirty state) | Small | -- |
| 2.9 | Desktop notifications (long-running commands) | Small | -- |
| 2.10 | Quit warning (active processes) | Small | -- |
| 2.11 | Session restoration (save/restore on restart) | Medium | -- |
| 2.12 | Rich command history (exit code, CWD, branch, runtime) | Medium | -- |
| 2.13 | Ctrl+R reverse search | Small | 2.12 |
| 2.14 | Command corrections (suggest fix after error) | Medium | -- |
| 2.15 | Multi-turn agent conversation | Medium | -- |
| 2.16 | AI error correction (attach failed command as context) | Small | 2.15 |
| 2.17 | Secret redaction (regex-based) | Medium | -- |
| 2.18 | Per-tab/pane titles | Small | -- |
| 2.19 | Global hotkey (summon terminal) | Small | -- |
| 2.20 | Multiple windows | Medium | -- |
| 2.21 | Fix BUG-020, BUG-033, BUG-034, BUG-009 | Small-Med | -- |

### Phase 3: "Competitive Parity" (P2 -- Weeks 15-24)

**Goal**: Feature parity with Warp's terminal features. Velocity is a serious alternative.

| Order | Feature | Effort |
|---|---|---|
| 3.1 | Vim keybindings in input editor | Medium |
| 3.2 | Input position (pin top/bottom) | Small |
| 3.3 | AI as-you-type suggestions | Medium |
| 3.4 | Natural language auto-detection | Small |
| 3.5 | Pair / Dispatch agent modes | Large |
| 3.6 | Active AI / Prompt suggestions | Medium |
| 3.7 | Launch configurations (YAML) | Medium |
| 3.8 | Tab drag reordering | Small |
| 3.9 | Workflows (parameterized commands) | Medium |
| 3.10 | Environment variable management | Medium |
| 3.11 | Accessibility (screen reader) | Medium |
| 3.12 | SSH with Warp-style features | Large |
| 3.13 | Font ligatures | Medium |
| 3.14 | Code editor integration | Small |

### Phase 4: "Differentiation" (P3 -- Beyond Week 24)

**Goal**: Features that go beyond Warp or target specific niches.

- Cloud collaboration (if there is a business model for it)
- Built-in code editor with LSP (ADE pivot)
- Oz-style cloud agent orchestration
- Image/Sixel protocol support
- Custom notification escape sequences

---

## 9. Key Strategic Observations

### 9.1 Warp's Direction
Warp is moving away from being "just a terminal" toward an **Agentic Development Environment (ADE)**. Their 2.0 launch (June 2025) added a code editor, file tree, code review, and the Oz cloud agent platform. This means:
- **Opportunity**: Velocity can be the best **terminal** without needing to become an IDE. Users who want a great terminal (not an ADE) are underserved as Warp gets more complex.
- **Risk**: If the market moves to ADEs, staying terminal-only may limit the ceiling.

### 9.2 Windows-First Advantage
Warp launched on Windows in February 2025 but their Windows support is less mature than macOS. Velocity being Windows-native (Tauri + ConPTY) with first-class PowerShell/WSL support could be a differentiator.

### 9.3 Performance Architecture
Velocity's React DOM rendering will hit a wall for large outputs. The choice is:
- **Short term**: Virtualized rendering (react-window/react-virtuoso) -- keeps the React architecture, handles most cases.
- **Long term**: Canvas/WebGL rendering or native rendering via Tauri -- required for true GPU-accelerated performance parity with Warp/Alacritty/Ghostty.

### 9.4 The Completion Gap is Critical
Tab completion is the #2 most-used terminal feature (after typing commands). Every other modern terminal has it. This should be treated as P0 alongside terminal emulation.

---

## 10. Sources

- [Warp: All Features](https://www.warp.dev/all-features)
- [Warp: Terminal Features Comparison](https://docs.warp.dev/terminal/terminal-features)
- [Warp: Agent Mode](https://www.warp.dev/ai)
- [Warp: Warp AI](https://www.warp.dev/warp-ai)
- [Warp: 2025 in Review](https://www.warp.dev/blog/2025-in-review)
- [Warp: Oz Orchestration Platform](https://www.warp.dev/oz)
- [Warp: Warp Drive](https://www.warp.dev/warp-drive)
- [Warp: Completions](https://docs.warp.dev/terminal/command-completions/completions)
- [Warp: Custom Themes](https://docs.warp.dev/terminal/appearance/custom-themes)
- [Warp: SSH](https://docs.warp.dev/terminal/warpify/ssh)
- [Warp: Block Filtering](https://docs.warp.dev/terminal/blocks/block-filtering)
- [Warp: Block Find](https://docs.warp.dev/terminal/blocks/find)
- [Warp: Block Actions](https://docs.warp.dev/terminal/blocks/block-actions)
- [Warp: Sticky Command Header](https://docs.warp.dev/terminal/blocks/sticky-command-header)
- [Warp: Command Palette](https://docs.warp.dev/terminal/command-palette)
- [Warp: Desktop Notifications](https://docs.warp.dev/terminal/more-features/notifications)
- [Warp: Secret Redaction](https://docs.warp.dev/privacy/secret-redaction)
- [Warp: Launch Configurations](https://docs.warp.dev/terminal/sessions/launch-configurations)
- [Warp: Session Restoration](https://docs.warp.dev/terminal/sessions/session-restoration)
- [Warp: Vim Keybindings](https://docs.warp.dev/terminal/editor/vim)
- [Warp: Command History](https://docs.warp.dev/terminal/entry/command-history)
- [Warp: Command Corrections](https://docs.warp.dev/terminal/entry/command-corrections)
- [Warp: Markdown Viewer](https://docs.warp.dev/terminal/more-features/markdown-viewer)
- [Warp: Workflows](https://docs.warp.dev/knowledge-and-collaboration/warp-drive/workflows)
- [Warp: Notebooks](https://docs.warp.dev/knowledge-and-collaboration/warp-drive/notebooks)
- [Warp GitHub Repository](https://github.com/warpdotdev/Warp)
- [Warp Goes Agentic - The New Stack](https://thenewstack.io/warp-goes-agentic-a-developer-walk-through-of-warp-2-0/)
- [Warp 2.0 Adds AI Agents - It's FOSS](https://itsfoss.com/news/warp-terminal-2-0/)
- [Best Terminal Emulators 2026 - The Software Scout](https://thesoftwarescout.com/best-terminal-emulators-for-developers-2026-warp-iterm2-alacritty-more/)
