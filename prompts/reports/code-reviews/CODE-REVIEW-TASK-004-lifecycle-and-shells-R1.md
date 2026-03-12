# Code Review: TASK-004 — Process Lifecycle + Shell Selection + Input Validation

**Reviewer**: Code Reviewer (Claude)
**Commit**: `85c34dd` — `feat: add shell selection, restart support, and input validation`
**Date**: 2026-03-12
**Round**: R1

---

## Files Reviewed

| File | Change Type |
|---|---|
| `src-tauri/src/pty/mod.rs` | Modified — added `validate_dimensions()`, integrated into `create_session` and `resize_session`, added 5 unit tests |
| `src/components/Terminal.tsx` | Modified — refactored to support shell selection, restart, extracted `startSession` and `handleShellSwitch` |
| `src/__tests__/Terminal.test.tsx` | Modified — added 7 new tests for shell selector, restart, output clearing |
| `src/lib/types.ts` | Modified — added `SHELL_TYPES` const array and `ShellType` union type |
| `src/App.css` | Modified — added styles for `.shell-selector`, `.shell-btn`, `.restart-btn`, `.terminal-restart-row` |
| `src-tauri/src/commands/mod.rs` | Unchanged (read for context) |
| `src/lib/pty.ts` | Unchanged (read for context) |
| `prompts/tasks/TASK-004-lifecycle-and-shells.md` | New — task specification |
| `prompts/STATE.md` | Modified — updated in-progress status |

---

## Security Review (HIGHEST PRIORITY)

### [x] No command injection
The shell type is still validated on the Rust side by the existing allowlist (`"powershell"`, `"cmd"`, `"wsl"`) in `validate_shell_type()`. No new command construction paths were added. Shell switching on the frontend reuses the same `createSession` IPC call, which goes through the same validation. **PASS**.

### [x] Input validation on Rust side
`validate_dimensions()` is now called at the top of both `create_session()` and `resize_session()`. Bounds: min 1, max 500. This fixes BUG-006 from QA. Validation returns `Err` with descriptive messages rather than panicking. **PASS**.

### [x] PTY output safety
No changes to PTY output handling. The existing `AnsiFilter` continues to sanitize output. **PASS**.

### [x] ANSI parsing safety
No changes to the ANSI filter. **PASS**.

### [x] No secret leakage
No secrets, tokens, or credentials are introduced. Error messages expose only the invalid value (rows/cols number), which is not sensitive. **PASS**.

### [x] No unsafe Rust
No `unsafe` blocks added. No `unwrap()` on user-derived data. **PASS**.

---

## Critical (Must Fix)

### C-1: Race condition — `handleShellSwitch` reads stale `sessionId` from closure

- **File**: `src/components/Terminal.tsx:104-122`
- **Issue**: `handleShellSwitch` captures `sessionId` in its dependency array and uses it to call `closeSession`. However, `startSession` calls `setSessionId(sid)` which is asynchronous (React state update). When `handleShellSwitch` fires, the `sessionId` in the closure may be stale if `startSession` has not yet flushed its state update. More critically: if the user clicks a shell button rapidly (e.g., PowerShell -> CMD -> WSL in quick succession), the intermediate session created by the second click may never get closed because `sessionId` still holds the first session's ID when the third click fires.
- **Fix**: Use a `useRef` to track the current session ID (in addition to state for rendering), so that `handleShellSwitch` and `handleRestart` always read the latest value. Alternatively, add a guard/lock (e.g., `switching` boolean ref) to prevent concurrent shell switches.
- **Why**: Leaked sessions accumulate in the Rust `SessionManager`, consuming PTY handles and counting toward `MAX_SESSIONS` (20). A user who clicks shell buttons rapidly could exhaust the session limit and be unable to create new sessions.

### C-2: Unmount cleanup uses `setSessionId` setter hack to read current state

- **File**: `src/components/Terminal.tsx:88-93`
- **Issue**: The cleanup function uses `setSessionId((currentSid) => { ... return null; })` as a way to read the current session ID inside the effect cleanup. This is an anti-pattern: React state setters are meant for state transitions, not for side effects. While it works today, React documentation warns that setter functions may be called multiple times in concurrent mode (React 18+), which could cause `closeSession` to be called multiple times for the same session.
- **Fix**: Store `sessionId` in a `useRef` alongside the state variable. Read the ref in the cleanup function.
- **Why**: Double-calling `closeSession` on the same ID would hit the "Session not found" error path on the second call (which is caught by `.catch(() => {})`), so the practical impact is minor. But this is a reliability concern and a code smell that could mask real bugs.

---

## Important (Should Fix)

### I-1: `startSession` has empty dependency array but uses `setSessionId`, `setClosed`, `setOutput`

- **File**: `src/components/Terminal.tsx:31-71`
- **Issue**: The `useCallback` for `startSession` has an empty dependency array `[]`. It captures React state setters (`setSessionId`, `setClosed`, `setOutput`), which are stable and do not need to be listed. This is technically correct. However, if `startSession` were ever extended to read any state variable (e.g., checking `closed` before creating), the empty dep array would cause stale closures. The `eslint-disable` on the mount effect (line 95) further suppresses warnings.
- **Fix**: Add `setSessionId`, `setClosed`, `setOutput` to the dependency array for documentation purposes (they are stable so it changes nothing), and add a comment explaining why. Remove the eslint-disable if possible.
- **Why**: Maintainability. Future developers may add state reads to `startSession` without realizing the dep array is intentionally empty.

### I-2: `handleShellSwitch` allows re-creating a session for the same shell when `closed === true`

- **File**: `src/components/Terminal.tsx:106`
- **Issue**: The guard `if (newShell === shellType && !closed) return;` means that clicking the already-active shell button when the process has exited will trigger a full restart (close + create). This is actually the intended behavior per the task spec (user can click the active shell to restart). However, this overlaps with the explicit "Restart" button's functionality. The user now has two ways to restart: click the active shell button, or click the Restart button. This isn't a bug, but it's undocumented behavior that could confuse future developers.
- **Fix**: Add a code comment explaining this intentional dual-path restart behavior.
- **Why**: Clarity for future developers.

### I-3: Shell selector buttons use `aria-selected` without `role="tab"` or `role="option"`

- **File**: `src/components/Terminal.tsx:160`
- **Issue**: The shell buttons use `aria-selected` attribute, but `aria-selected` is only valid on elements with `role="tab"`, `role="option"`, `role="gridcell"`, `role="row"`, or `role="treeitem"`. Without a proper ARIA role, `aria-selected` has no semantic meaning for screen readers.
- **Fix**: Add `role="tab"` to each shell button and wrap them in a container with `role="tablist"`. Or use `aria-pressed` (valid on buttons) instead of `aria-selected`.
- **Why**: Accessibility. While not a security issue, invalid ARIA is worse than no ARIA because it confuses assistive technology.

### I-4: `handleRestart` and `handleShellSwitch` duplicate cleanup logic

- **File**: `src/components/Terminal.tsx:104-138`
- **Issue**: Both `handleShellSwitch` and `handleRestart` contain the same cleanup sequence: `cleanupListeners()` -> `closeSession(sessionId)` -> `setOutput('')` -> `setInput('')` -> `setClosed(false)` -> `setSessionId(null)` -> `startSession(...)`. The only difference is the shell type passed to `startSession`. This duplication means any bug fix to the cleanup sequence must be applied in two places.
- **Fix**: Extract a shared `resetAndStart(shell: ShellType)` function that both handlers call.
- **Why**: DRY principle. Reduces bug surface from divergent cleanup paths.

---

## Suggestions (Nice to Have)

### S-1: `validate_dimensions` could use range syntax for clarity

- **File**: `src-tauri/src/pty/mod.rs:13-21`
- **Issue**: `if rows < 1 || rows > 500` could be expressed as `if !(1..=500).contains(&rows)` which is more idiomatic Rust.
- **Fix**: `if !(1..=500).contains(&rows) { ... }`
- **Why**: Readability and Rust idiom. Minor style preference.

### S-2: Consider disabling shell selector buttons during session creation

- **File**: `src/components/Terminal.tsx:154-166`
- **Issue**: The shell selector buttons are always enabled. If `createSession` takes a moment (cold start of WSL, for instance), the user could click another shell button mid-creation, triggering C-1.
- **Fix**: Add an `isLoading` state that disables the shell buttons while a session is being created.
- **Why**: UX improvement and mitigation for C-1.

### S-3: Test `test_shell_switch_creates_new_session` does not verify listener cleanup

- **File**: `src/__tests__/Terminal.test.tsx:154-179`
- **Issue**: The test verifies that `closeSession` and `createSession` are called in the right order, but does not assert that the old event listeners were cleaned up (unlisten called). Since the mock `listen` returns unlisten functions, the test could verify they were invoked.
- **Fix**: Track the unlisten mock functions per session and assert they were called on shell switch.
- **Why**: Ensures no event listener leaks across session switches.

### S-4: `pty.ts` wrapper types don't enforce `ShellType`

- **File**: `src/lib/pty.ts:3`
- **Issue**: `createSession` accepts `shellType?: string` instead of `shellType?: ShellType`. The frontend types define `ShellType` but the IPC wrapper doesn't use it, so TypeScript won't catch invalid shell types passed to `createSession`.
- **Fix**: Change the signature to `shellType?: ShellType` and import `ShellType` from `types.ts`.
- **Why**: The whole point of defining `ShellType` was type safety. Not using it at the IPC boundary defeats the purpose.

### S-5: Consider extracting terminal dimension constants

- **File**: `src/components/Terminal.tsx:34`
- **Issue**: The dimensions `24, 80` are hardcoded in multiple places (`startSession`, test assertions). If the default dimensions change, multiple files need updating.
- **Fix**: Define `DEFAULT_ROWS = 24` and `DEFAULT_COLS = 80` constants in `types.ts` and reference them.
- **Why**: Single source of truth.

---

## Rust Quality

### [x] Error handling with Result<>
All new functions return `Result<(), String>`. `validate_dimensions` uses early-return `Err` pattern. No panics on user input. **PASS**.

### [x] Resource cleanup
Session cleanup logic unchanged. Shell switch and restart go through existing `closeSession` path. **PASS**.

### [x] Thread safety
No new threading code. Existing `Arc<AtomicBool>` shutdown pattern unchanged. **PASS**.

### [x] Async correctness
No new async code on the Rust side. Existing `spawn_blocking` pattern unchanged. **PASS**.

---

## TypeScript / React Quality

### [x] Hooks correctness
- `useCallback` dependencies are listed for `handleShellSwitch`, `handleRestart`, `handleKeyDown`.
- `startSession` has empty deps (correct for now since it only uses stable setters).
- `cleanupListeners` has empty deps (correct, it only uses the ref).
- Mount effect runs once with `[]` deps. **Mostly PASS** (see I-1 for maintenance concern).

### [x] No memory leaks
- Event listeners are cleaned up via `cleanupListeners()` on shell switch, restart, and unmount.
- Sessions are closed on unmount. **PASS** (see C-1 for rapid-click edge case).

### [x] Type safety
- `ShellType` union type defined and used in component state. **Mostly PASS** (see S-4 for IPC wrapper gap).

### [x] Memoization where needed
- `AnsiOutput` is `React.memo`'d (unchanged).
- Shell selector renders 3 buttons, no performance concern.
- `handleShellSwitch`, `handleRestart`, `handleKeyDown` are memoized with `useCallback`. **PASS**.

---

## Performance

### [x] Streaming efficiency
No changes to streaming. **PASS**.

### [x] Render efficiency
Shell selector is a flat list of 3 buttons, no virtualization needed. Output buffer limit (100K) unchanged. **PASS**.

---

## Test Coverage

| Area | Tests | Status |
|---|---|---|
| `validate_dimensions` — valid inputs | 1 test (3 cases) | PASS |
| `validate_dimensions` — zero rows | 1 test | PASS |
| `validate_dimensions` — zero cols | 1 test | PASS |
| `validate_dimensions` — overflow rows | 1 test | PASS |
| `validate_dimensions` — overflow cols | 1 test | PASS |
| Shell selector renders | 1 test | PASS |
| PowerShell selected by default | 1 test | PASS |
| Default shell creates session | 1 test | PASS |
| Shell switch creates new session | 1 test | PASS |
| Restart button appears on exit | 1 test | PASS |
| Restart creates new session | 1 test | PASS |
| Output clears on restart | 1 test | PASS |

All 25 frontend tests pass. All 31 Rust tests pass (1 ignored integration test).

**Missing test coverage**:
- No test for rapid shell switching (C-1 scenario)
- No test for unmount during active session
- No test for `createSession` failure during shell switch/restart (error handling path)

---

## Summary

| Severity | Count |
|---|---|
| Critical | 2 |
| Important | 4 |
| Suggestions | 5 |

### Critical Findings

1. **C-1**: Race condition when rapidly switching shells — intermediate sessions may leak, eventually exhausting `MAX_SESSIONS`.
2. **C-2**: Unmount cleanup abuses `setSessionId` setter to read current state — fragile pattern that may double-fire in React concurrent mode.

### Verdict: **NEEDS CHANGES**

The implementation is solid overall. The Rust-side validation is clean, well-tested, and properly integrated. The frontend shell selector and restart flow work correctly for normal usage. The test suite is comprehensive for happy paths.

The two critical findings both relate to session lifecycle management when React state updates race against user actions. C-1 (rapid shell switching) is the more pressing concern because it can cause real resource exhaustion. The fix is straightforward: use a `useRef` to track the current session ID so cleanup always acts on the latest value, and optionally add a loading guard to prevent concurrent switches.

Once C-1 and C-2 are addressed, and ideally the ARIA roles (I-3) and the IPC type gap (S-4) are fixed, this is ready to approve.
