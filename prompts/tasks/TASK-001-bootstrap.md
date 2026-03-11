# Task 001: Project Bootstrap

## Context
This is a greenfield project. No application code exists yet — only workflow prompts in `prompts/` and `CLAUDE.md`. The goal is to scaffold the Tauri v2 + React/TypeScript application and establish the project structure, testing infrastructure, and a working dev build.

## Requirements

### 1. Initialize Tauri v2 Project

Scaffold the project **in the current directory** (`C:\Velocity`) using `create-tauri-app`. Configuration:

- **Project name**: `velocity`
- **Identifier**: `com.velocity.app`
- **Frontend language**: TypeScript / JavaScript
- **Package manager**: npm
- **UI template**: React
- **UI flavor**: TypeScript

**Important**: The current directory already has files (`CLAUDE.md`, `prompts/`, `.claude/`, `.git/`). The scaffolding tool may need to run in a temp directory, then files moved in — or you may need to initialize manually. Use whichever approach avoids clobbering existing files. Verify that `CLAUDE.md`, `prompts/`, and `.claude/` are preserved after scaffolding.

After scaffolding:
- Run `npm install` to install dependencies
- Verify `npm run tauri dev` opens a window (you can kill it after confirming it launches)

### 2. Establish Directory Structure

Create these directories (with `.gitkeep` files so git tracks them):

```
src/
  components/
    blocks/           # Block model components (future)
    editor/           # Input editor components (future)
    layout/           # Tab/pane layout components (future)
  hooks/              # Custom React hooks
  lib/                # Utilities, types, helpers
  styles/             # CSS/styling

src-tauri/src/
  commands/           # Tauri command handlers (IPC entry points)
  pty/                # PTY management
  ansi/               # ANSI parser
  session/            # Shell session registry
```

### 3. Testing Infrastructure

#### Frontend (Vitest)
- Install Vitest and related dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- Create `vitest.config.ts` at the project root configured for React (jsdom environment)
- Create a smoke test at `src/__tests__/App.test.tsx` that renders the App component and asserts it mounts
- Add npm script: `"test": "vitest run"` and `"test:watch": "vitest"`

#### E2E (Playwright)
- Install Playwright: `npm init playwright@latest` (accept defaults, use TypeScript)
- Configure it to test the Tauri app (this is a placeholder — real E2E tests come later)
- Add npm script: `"test:e2e": "npx playwright test"`

#### Rust
- Ensure `cargo test` works in `src-tauri/` (it should by default after scaffolding)
- Add npm script: `"test:rust": "cd src-tauri && cargo test"`

#### Combined
- Add npm script: `"test:all": "npm run test && npm run test:rust"`

### 4. Skeleton App

Replace the default Tauri/React template content with a minimal Velocity skeleton:

#### `src/App.tsx`
- Render a simple centered heading: "Velocity"
- Include a subtitle: "Modern Terminal for Windows"
- Dark background (`#1e1e2e`), light text (`#cdd6f4`) — Catppuccin Mocha vibes
- No complex styling — just enough to confirm the pipeline works

#### `src/App.css` (or equivalent)
- Minimal styles for the skeleton: full-viewport dark background, centered text
- Reset default margins/padding

#### `src-tauri/tauri.conf.json`
- Window title: "Velocity"
- Default window size: 1200x800
- Minimum window size: 800x500

### 5. Cleanup
- Remove any default template boilerplate that isn't needed (Tauri logo, counter example, etc.)
- Ensure no unused imports or dead code
- Keep the generated `src-tauri/src/lib.rs` and `src-tauri/src/main.rs` clean but functional

### 6. Git Hygiene
- Ensure `.gitignore` covers: `node_modules/`, `target/`, `dist/`, `.env`, `*.log`
- Do NOT delete or modify: `CLAUDE.md`, `prompts/`, `.claude/`
- Verify all existing files are preserved after scaffolding

## IPC Contract
None for this task — no custom Tauri commands yet. The default `greet` command from the template should be removed.

## Test Strategy
- `npm run test` passes (Vitest smoke test)
- `npm run test:rust` passes (default cargo tests)
- `npm run tauri dev` opens a window showing "Velocity" heading
- All pre-existing files (`CLAUDE.md`, `prompts/`, `.claude/`) still exist

## Acceptance Criteria
- [ ] Tauri v2 + React/TypeScript project is initialized and builds
- [ ] `npm run tauri dev` opens a window with "Velocity" heading on dark background
- [ ] Directory structure established per spec (all directories exist)
- [ ] Vitest configured with passing smoke test (`npm run test`)
- [ ] Playwright installed and configured
- [ ] `cargo test` passes in `src-tauri/`
- [ ] npm scripts: `test`, `test:watch`, `test:e2e`, `test:rust`, `test:all`
- [ ] Default template boilerplate removed (no Tauri logo, no counter)
- [ ] `.gitignore` properly configured
- [ ] Pre-existing files preserved (`CLAUDE.md`, `prompts/`, `.claude/`)
- [ ] Clean commit with message: `feat: bootstrap Velocity project with Tauri v2 + React/TypeScript`

## Files to Read First
- `CLAUDE.md` — Project conventions and architecture overview
- `prompts/FLOW.md` — Understand the project vision and structure
