# Velocity

A modern Windows terminal with AI-powered command translation, built with Tauri v2 and React/TypeScript.

<!-- Screenshot placeholder: replace with actual screenshot -->
<!-- ![Velocity Screenshot](docs/screenshot.png) -->

## Features

- **Multi-shell support** -- PowerShell, CMD, and WSL sessions
- **Block-based output** -- each command and its output displayed in a visual block with exit codes
- **Syntax-highlighted input editor** with multi-line support
- **Ghost text suggestions** from command history
- **Tabs and split panes** with independent shell sessions
- **ANSI color rendering** with security filtering
- **Agent Mode** -- prefix a command with `#` to translate natural language to shell commands via LLM
- **Configurable LLM providers** -- OpenAI, Anthropic/Claude, Google Gemini, and Azure OpenAI

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://rustup.rs/) (stable)
- Windows 10 or Windows 11

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

1. Click the gear icon in the terminal to open Settings.
2. Select your LLM provider (OpenAI, Anthropic, Google Gemini, or Azure OpenAI).
3. Enter your API key.
4. Type `# your request` in the terminal input to translate natural language into a shell command.

## Building

Build a production distributable for Windows:

```bash
npm run tauri build
```

The installer and executable output will be located in:

```
src-tauri/target/release/bundle/
```

A convenience PowerShell build script is also provided:

```powershell
./scripts/build.ps1
```

## Development

| Command | Description |
|---|---|
| `npm run tauri dev` | Run the app in development mode |
| `npm run test` | Run frontend unit tests (Vitest) |
| `npm run test:watch` | Run frontend tests in watch mode |
| `npm run test:rust` | Run Rust unit and integration tests |
| `npm run test:all` | Run both frontend and Rust tests |
| `npm run test:e2e` | Run end-to-end tests (Playwright, requires running app) |
| `npm run build` | Build the frontend only |
| `npm run tauri build` | Build the full distributable |

## Architecture

```
+---------------------------+       Tauri IPC        +---------------------------+
|       React Frontend      | <--------------------> |       Rust Backend         |
|  (TypeScript, Vite)       |   commands + events    |  (Tauri v2)               |
|                           |                        |                           |
|  - Terminal UI            |                        |  - PTY process management |
|  - Block rendering        |                        |  - Shell lifecycle        |
|  - Input editor           |                        |  - ANSI parsing/filtering |
|  - Tab/pane layout        |                        |  - Output streaming       |
|  - Agent Mode UI          |                        |  - LLM provider bridge    |
|  - Settings panel         |                        |  - Security validation    |
+---------------------------+                        +---------------------------+
```

- **Rust backend** manages PTY processes, shell sessions, ANSI parsing, output streaming, and security validation. All IPC inputs are validated on the Rust side.
- **React frontend** handles UI rendering, block display, input editing, tab/pane layout, and Agent Mode interaction.
- Each pane owns an independent shell session (PowerShell, CMD, or WSL).
- Output streams from Rust to React in real time via Tauri events.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | [Tauri](https://tauri.app/) | v2 |
| Frontend | [React](https://react.dev/) | 19 |
| Language (frontend) | [TypeScript](https://www.typescriptlang.org/) | 5.8 |
| Bundler | [Vite](https://vite.dev/) | 7 |
| Language (backend) | [Rust](https://www.rust-lang.org/) | 2021 edition |
| PTY | [portable-pty](https://crates.io/crates/portable-pty) | 0.9 |
| ANSI parsing | [vte](https://crates.io/crates/vte) | 0.15 |
| Testing (frontend) | [Vitest](https://vitest.dev/) | 4 |
| Testing (E2E) | [Playwright](https://playwright.dev/) | 1.58 |

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
