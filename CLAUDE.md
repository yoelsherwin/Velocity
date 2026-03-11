# Velocity

Modern Windows terminal application (Warp-equivalent), built with Tauri v2 + React/TypeScript.

## Tech Stack
- **Frontend**: React + TypeScript (Vite) — `src/`
- **Backend**: Rust (Tauri v2) — `src-tauri/`
- **IPC**: Tauri commands (`invoke`) and events (`emit`/`listen`)
- **Tests**: Vitest (frontend), `cargo test` (Rust), Playwright (E2E)

## Commands
- `npm run tauri dev` — Run in development mode
- `npm run test` — Run frontend tests (Vitest)
- `cd src-tauri && cargo test` — Run Rust tests
- `npx playwright test` — Run E2E tests
- `npm run build` — Build frontend
- `npm run tauri build` — Build distributable

## Architecture
- Rust manages: PTY processes, shell lifecycle, ANSI parsing, output streaming, security validation
- React manages: UI rendering, input editing, block display, tab/pane layout
- Each pane owns an independent shell session (PowerShell, CMD, or WSL)
- Output streams from Rust → React via Tauri events (real-time, not buffered)

## Security Rules
- NEVER string-interpolate user input into shell commands
- Always validate IPC inputs on the Rust side
- Treat all PTY output as untrusted
- No `unwrap()` on user-derived data in Rust

## Development Workflow
See `prompts/FLOW.md` for the multi-agent development workflow.
Agent prompts are in `prompts/` (cto.md, dev-agent.md, code-reviewer.md, security-reviewer.md, qa-agent.md).
