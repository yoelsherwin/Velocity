# Code Review — TASK-001-bootstrap — R1

**Date:** 2026-03-11
**Commit:** `2b46797` — feat: bootstrap Velocity project with Tauri v2 + React/TypeScript
**Reviewer:** Code Review Agent

---

## Critical (Must fix)

### 1. CSP is disabled in Tauri config

- **File**: `src-tauri/tauri.conf.json:23`
- **Issue**: `"csp": null` completely disables Content Security Policy. In a terminal application that will render untrusted PTY output, this allows arbitrary script execution if any output is rendered as HTML.
- **Fix**: Set a restrictive CSP. At minimum: `"csp": "default-src 'self'; script-src 'self'"`. Adjust as needed for Vite HMR in dev mode (Tauri v2 supports separate dev/build CSP).
- **Why**: This is a terminal app — it will display output from arbitrary commands. Without CSP, a malicious escape sequence or command output that somehow gets rendered as HTML could execute arbitrary JavaScript in the webview, with full IPC access to the Rust backend.

### 2. `.gitignore` missing trailing newline + incorrect path separator

- **File**: `.gitignore:36`
- **Issue**: Last line `.claude\settings.local.json` uses a backslash (Windows path separator) instead of forward slash. Git treats backslashes as escape characters in `.gitignore` on some systems, making this rule unreliable. The file also lacks a trailing newline, which is a POSIX convention and can cause issues with some tools.
- **Fix**: Change to `.claude/settings.local.json` with a trailing newline. However — the `*.local` pattern on line 34 already matches `settings.local.json`, making this explicit entry redundant. The simpler fix is to remove line 36 entirely and ensure the file ends with a newline after line 34.
- **Why**: This file is already tracked in git (it appears in the commit). The gitignore rule won't retroactively untrack it. If the intent is to stop tracking it, `git rm --cached .claude/settings.local.json` is needed. If it should be tracked (it contains allowed tool settings), the gitignore entry is misleading.

---

## Important (Should fix)

### 3. `lib.rs` uses `.expect()` on application startup

- **File**: `src-tauri/src/lib.rs:5`
- **Issue**: `.expect("error while running tauri application")` will panic if the Tauri app fails to start. While this is the Tauri template default and a panic at startup is arguably acceptable (there's nothing to recover to), the project's `CLAUDE.md` states: "No `unwrap()` on user-derived data in Rust." This is a framework call, not user-derived data, so it's borderline — but worth noting for consistency.
- **Fix**: This is acceptable for now. The security rule targets user-derived data specifically, and there's no meaningful recovery if the Tauri runtime fails to initialize. Document the exception with a comment if desired.
- **Why**: Establishing clear conventions early avoids ambiguity later.

### 4. Test assertions use `toBeDefined()` instead of `toBeInTheDocument()`

- **File**: `src/__tests__/App.test.tsx:7,12`
- **Issue**: Tests use `expect(screen.getByText(...)).toBeDefined()` — but `getByText()` already throws if the element isn't found, making `toBeDefined()` redundant (it will always pass if execution reaches that line). The `@testing-library/jest-dom` package is installed but not configured.
- **Fix**: Add `@testing-library/jest-dom` to vitest setup files in `vitest.config.ts`:
  ```ts
  setupFiles: ['./src/__tests__/setup.ts'],
  ```
  Create `src/__tests__/setup.ts`:
  ```ts
  import '@testing-library/jest-dom/vitest';
  ```
  Then use `toBeInTheDocument()` in tests:
  ```ts
  expect(screen.getByText("Velocity")).toBeInTheDocument();
  ```
- **Why**: The current tests provide a false sense of coverage — they can never fail on the assertion. If someone removes the heading, `getByText` throws, which is caught as a test error (not assertion failure), making debugging harder.

### 5. `vite.config.ts` uses `@ts-expect-error` for `process.env`

- **File**: `vite.config.ts:4`
- **Issue**: `// @ts-expect-error process is a nodejs global` is a Tauri template artifact. This is a minor type safety gap.
- **Fix**: This is the standard Tauri template pattern and works correctly. Low priority, but could be cleaned up by declaring `process` in a `.d.ts` file or using `import.meta.env` instead.
- **Why**: Minor code quality concern. Not blocking.

---

## Suggestions (Nice to have)

### 6. Font family includes non-monospace fonts

- **File**: `src/App.css:7`
- **Issue**: `font-family: Inter, Avenir, Helvetica, Arial, sans-serif` — these are all proportional fonts. A terminal application will eventually need a monospace font for command output. The current skeleton is placeholder UI so this is fine, but worth noting.
- **Fix**: No action needed now. When implementing the Block Model (Pillar 2), switch to a monospace font stack for terminal output areas.
- **Why**: Pre-planning note for future implementation.

### 7. Report directories not yet created

- **Issue**: The FLOW.md and prompt files reference `prompts/reports/code-reviews/`, `prompts/reports/security-reviews/`, and `prompts/reports/qa-reports/`, but these directories weren't created in the bootstrap commit (only `prompts/reports/` exists).
- **Fix**: Create these directories (with `.gitkeep` files) so the reporting workflow is ready.
- **Why**: Minor gap — the directories get created on first use anyway, but having them in the repo makes the structure self-documenting.

### 8. No Rust test exists

- **Issue**: `cargo test` passes but runs 0 tests. There's no smoke test for the Rust side.
- **Fix**: This is expected for a bootstrap — there's no custom Rust code to test yet. As Tauri commands are added, corresponding tests should follow.
- **Why**: Noting for completeness. No action needed now.

---

## Summary

- **Total findings**: 2 critical, 3 important, 3 suggestions
- **Overall assessment**: **NEEDS CHANGES**

The bootstrap is well-structured and closely follows the TASK-001 spec. Pre-existing files are preserved, directory structure is correct, Vitest passes, and the project builds. However:

1. **CSP disabled** (`"csp": null`) is a security concern that should be addressed before any PTY output rendering code is added. This is the most important finding.
2. **`.gitignore` formatting** is a minor correctness issue that should be cleaned up.

The important and suggestion items are non-blocking but would improve test reliability and code quality.
