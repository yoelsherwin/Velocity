# Velocity

A modern Windows terminal application built with [Tauri v2](https://v2.tauri.app/) + React/TypeScript. Inspired by [Warp](https://www.warp.dev/), designed Windows-first with native PowerShell, CMD, and WSL support.

<!-- Screenshot placeholder: replace with actual screenshot -->
<!-- ![Velocity Screenshot](docs/screenshot.png) -->

## Features

### Terminal Emulation
- **Full VT100/xterm support** via `vt100` crate -- cursor movement, carriage returns, progress bars all render correctly
- **Alternate screen mode** -- vim, nano, less, htop, man pages display in a dedicated grid overlay with full keyboard input
- **True color + 256-color rendering** -- complete SGR support
- **Real-time output streaming** -- non-blocking async output via Tauri events
- **Multi-shell** -- PowerShell, CMD, and WSL sessions

### Block Model
- **Command/output grouping** -- each command and its output are a visual "Block" (like a Jupyter cell)
- **Exit code + timestamp** per block
- **Block actions** -- Copy Command, Copy Output, Rerun
- **Block collapse/expand** -- fold long outputs with toggle, Collapse All / Expand All via command palette
- **Block navigation** -- Ctrl+Up/Down to jump between blocks
- **Sticky command header** -- block header pins to top while scrolling through long output

### Input Editor
- **Decoupled rich input** -- dedicated input area with syntax highlighting for commands, arguments, flags, strings, pipes
- **Tab completions** -- file/directory path + command name completions with ghost text
- **Ghost text suggestions** -- history-based autocomplete accepted with Tab
- **History search** -- Ctrl+R reverse incremental search through command history
- **Multi-line editing** -- Shift+Enter for new lines

### AI / Agent Mode
- **Intent classifier** -- automatically detects CLI commands vs. natural language input
- **LLM translation** -- natural language requests translated to shell commands via configurable LLM
- **LLM fallback** -- ambiguous inputs classified by LLM on submit
- **AI error correction** -- failed commands automatically analyzed with suggested fixes ("Did you mean: ...?")
- **Review-first execution** -- translated commands populate the editor for review, never auto-executed
- **Providers** -- OpenAI, Anthropic (Claude), Google Gemini, Azure OpenAI

### Layout & Navigation
- **Tabs** -- Ctrl+T / Ctrl+W, auto-updating titles (CWD or running command)
- **Split panes** -- horizontal (Ctrl+Shift+Right) and vertical (Ctrl+Shift+Down)
- **Independent sessions** -- each pane owns its own shell process
- **Command palette** -- Ctrl+Shift+P fuzzy search over all 20+ actions
- **Find in output** -- Ctrl+Shift+F search across all blocks with match highlighting and navigation

### Appearance
- **5 built-in themes** -- Catppuccin Mocha, Catppuccin Latte, Dracula, One Dark, Solarized Dark
- **Custom fonts** -- configurable font family, size, and line-height
- **Git context** -- branch name, dirty/clean status, ahead/behind count in the prompt

### Security & Privacy
- **Secret redaction** -- API keys, tokens, and passwords automatically masked in output (click to reveal)
- **ANSI security filter** -- dangerous escape sequences stripped; only SGR (colors/styles) reach the frontend
- **Input validation** -- all IPC inputs validated on the Rust side
- **No auto-execution** -- AI-translated commands always require user confirmation

### Session Management
- **Session restoration** -- tabs, panes, CWD, and command history persist across restarts
- **Desktop notifications** -- long-running commands (10s+) notify on completion when window is unfocused
- **Quit warning** -- confirmation dialog before closing with running processes

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://rustup.rs/) (stable)
- Windows 10 or Windows 11
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Installation

```bash
git clone https://github.com/user/velocity.git
cd velocity
npm install
```

### Running in Development

```bash
npm run tauri dev
```

### Agent Mode Setup

1. Click the gear icon to open Settings
2. Select your LLM provider (OpenAI, Anthropic, Google Gemini, or Azure OpenAI)
3. Enter your API key
4. Type `# your request` in the terminal to translate natural language to a shell command

## Building

```bash
npm run tauri build
```

Output in `src-tauri/target/release/bundle/`.

## Development

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Run in development mode |
| `npm run test` | Frontend unit tests (Vitest, ~530 tests) |
| `cd src-tauri && cargo test` | Rust unit + integration tests (~150 tests) |
| `npx playwright test` | E2E tests (~28 tests, requires built app) |
| `npm run build` | Build frontend only |
| `npm run tauri build` | Build full distributable |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+Shift+Right | Split pane right |
| Ctrl+Shift+Down | Split pane down |
| Ctrl+Shift+W | Close pane |
| Ctrl+Shift+P | Command palette |
| Ctrl+Shift+F | Find in output |
| Ctrl+R | History search |
| Ctrl+Up/Down | Navigate between blocks |
| Enter / Space | Toggle block collapse (when block focused) |
| Tab | Accept completion / cycle suggestions |
| `#` prefix | Natural language mode |

## Architecture

```
+---------------------------------------------+
|            React Frontend (WebView)          |
|  +--------+ +---------+ +----------------+  |
|  | Input  | | Block   | | Tab/Pane       |  |
|  | Editor | | View    | | Manager        |  |
|  +---+----+ +----+----+ +-------+--------+  |
|      |           |              |            |
|      +-----------+--------------+            |
|                  | invoke() / listen()       |
+------------------+---------------------------+
|                  | Tauri IPC                  |
+------------------+---------------------------+
|            Rust Backend                      |
|  +--------+ +---------+ +----------------+  |
|  | PTY    | | vt100   | | Session        |  |
|  | Manager| | Emulator| | Registry       |  |
|  +--------+ +---------+ +----------------+  |
|      |                                       |
|  +---+-----------------------------------+  |
|  | Shell Processes (PowerShell/CMD/WSL)  |  |
|  +---------------------------------------+  |
+---------------------------------------------+
```

- **Rust backend** -- PTY process management, vt100 terminal emulation, ANSI security filtering, output streaming, LLM provider bridge, session persistence, settings storage
- **React frontend** -- UI rendering, block display, input editing, tab/pane layout, search, command palette, theming, secret redaction
- Each pane owns an independent shell session
- Output streams from Rust to React in real time via Tauri events

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri](https://tauri.app/) v2 |
| Frontend | [React](https://react.dev/) 19 + TypeScript |
| Bundler | [Vite](https://vite.dev/) |
| Backend | [Rust](https://www.rust-lang.org/) (2021 edition) |
| Terminal Emulator | [vt100](https://crates.io/crates/vt100) |
| PTY | [portable-pty](https://crates.io/crates/portable-pty) (ConPTY on Windows) |
| Testing | Vitest, cargo test, Playwright |

## Configuration

Settings are stored in `%LOCALAPPDATA%\Velocity\settings.json`:
- LLM provider, API key, and model
- Theme selection (5 built-in themes)
- Font family, size, and line-height

Session state persists in `%LOCALAPPDATA%\Velocity\session.json`:
- Tab/pane layout
- Working directories
- Command history (last 100 per pane)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
