# Code Review: TASK-002 PTY Engine — R1

**Commit**: `da21113 feat: implement PTY engine with shell spawning and output streaming`
**Reviewer**: Code Review Agent
**Date**: 2026-03-11

---

## Critical (Must fix)

### C1: PTY output rendered via innerHTML-equivalent without sanitization

- **File**: `src/components/Terminal.tsx:94-96`
- **Issue**: PTY output is rendered directly as text content inside a `<pre>` element:
  ```tsx
  <pre className="terminal-output">{output}</pre>
  ```
  While React's JSX rendering escapes HTML entities (so this is **not** an XSS vector via HTML injection), the raw terminal output may contain ANSI escape sequences that could be confusing or misleading to users. More critically, a malicious program could emit terminal escape sequences that, if ever rendered by a real terminal emulator, could execute arbitrary commands (OSC sequences, title manipulation, etc.). Since this is currently plain-text rendering, this is acceptable for now, but must be addressed before ANSI rendering is added.
- **Fix**: No immediate code change needed. This is tracked as a future security requirement for ANSI parsing (Pillar 1 continuation). **Document this as a known limitation.**
- **Why**: Terminal applications are a well-known attack surface for escape sequence injection.

**Downgrade: This is actually an Important, not Critical, since React's text rendering prevents the immediate attack vector. Reclassified below.**

### C1 (ACTUAL): Mutex held across blocking I/O in async Tauri commands

- **File**: `src-tauri/src/commands/mod.rs:30-41`
- **Issue**: The `write_to_session` command acquires the `Mutex` lock and then calls `write_all()` + `flush()` on the PTY writer, which are **blocking I/O operations**. Since these are `async` Tauri commands, they run on the Tokio async runtime. Holding a `std::sync::Mutex` across a blocking I/O call in an async context can:
  1. Block the entire Tokio thread pool if many writes happen concurrently
  2. Cause deadlocks if a PTY write stalls (e.g., flow control backpressure)

  The same concern applies to `resize_session` (though resize is fast and unlikely to block).

  ```rust
  pub async fn write_to_session(
      state: State<'_, AppState>,
      session_id: String,
      data: String,
  ) -> Result<(), String> {
      let mut manager = state.session_manager.lock()...;
      manager.write_to_session(&session_id, &data) // blocking I/O under mutex!
  }
  ```

- **Fix**: Either:
  - (a) Use `tokio::task::spawn_blocking` to move the write off the async runtime, OR
  - (b) Extract the writer from behind the mutex (e.g., store writers in a separate `HashMap<String, Arc<Mutex<Writer>>>` so the session manager lock isn't held during I/O), OR
  - (c) Accept this for MVP and document the limitation (single session, low contention).

- **Why**: In a terminal app with real-time input, PTY writes must be reliable. A blocked async runtime degrades the entire UI. This will become critical once multiple panes/sessions exist.

---

## Important (Should fix)

### I1: Reader thread has no shutdown mechanism

- **File**: `src-tauri/src/pty/mod.rs:89-111`
- **Issue**: The reader thread spawned per session runs until `read()` returns 0 or errors. There is no mechanism to signal it to stop when `close_session` is called. When `close_session` kills the child process, the reader *should* eventually get a read error or EOF, but this is not guaranteed on all platforms/PTY implementations. The thread could linger.
- **Fix**: Consider adding an `Arc<AtomicBool>` shutdown flag that the reader checks in its loop, or store the `JoinHandle` and join/abort on close.
- **Why**: Leaked threads accumulate over the lifetime of the application, especially if users open/close many sessions.

### I2: `close_session` does not wait for child process to exit

- **File**: `src-tauri/src/pty/mod.rs:163-173`
- **Issue**: `close_session` calls `child.kill()` but does not call `child.wait()`. On Windows, this can leave zombie process handles. The `portable_pty::Child` trait provides `wait()` and `try_wait()`.
- **Fix**: Call `session.child.wait()` after `kill()` (or `try_wait()` with a timeout).
- **Why**: Resource leak — orphaned process handles accumulate.

### I3: `act(...)` warnings in all Terminal-related tests

- **File**: `src/__tests__/Terminal.test.tsx`, `src/__tests__/App.test.tsx`
- **Issue**: All tests that render `<Terminal />` produce React `act(...)` warnings because the async `init()` function inside `useEffect` triggers state updates after the initial render. While tests pass, these warnings indicate the tests aren't properly awaiting async side effects.
- **Fix**: Wrap render calls in `act()` or use `waitFor` to await the initial async state settlement before making assertions. For the simpler tests (`renders_without_crashing`, `has_output_area`, `has_input_field`), add `await waitFor(() => {})` after render.
- **Why**: Suppressed warnings can mask real issues. Clean test output is important for catching regressions.

### I4: PTY output treated as UTF-8 with lossy conversion

- **File**: `src-tauri/src/pty/mod.rs:95`
- **Issue**: `String::from_utf8_lossy(&buf[..n])` replaces invalid UTF-8 bytes with the replacement character (U+FFFD). Terminal output is a byte stream — a multi-byte UTF-8 character could be split across two `read()` calls, causing the second half of a valid character to be mangled.
- **Fix**: Use a UTF-8 decoder that buffers incomplete sequences across reads (e.g., maintain a small tail buffer of up to 3 bytes between reads). Alternatively, accept this limitation for MVP and document it.
- **Why**: Users working with non-ASCII content (CJK, emoji, Unicode paths) will see garbled output intermittently.

### I5: Terminal component directly uses `invoke` instead of IPC wrapper

- **File**: `src/components/Terminal.tsx:23-27, 78-81`
- **Issue**: The Terminal component calls `invoke()` directly instead of using the typed IPC wrapper functions in `src/lib/pty.ts` (`createSession`, `writeToSession`, `closeSession`). The wrapper was created for this purpose.
- **Fix**: Import and use the wrapper functions from `src/lib/pty.ts`.
- **Why**: Code duplication and inconsistency. The wrappers provide a single point of change for IPC signatures.

### I6: No error handling for `write_to_session` failures in Terminal

- **File**: `src/components/Terminal.tsx:78-81`
- **Issue**: The `invoke('write_to_session', ...)` call has `.catch(() => {})` — errors are silently swallowed. If a write fails (e.g., session closed, PTY error), the user gets no feedback.
- **Fix**: At minimum, show an error in the output area: `.catch((err) => setOutput(prev => prev + \`\n[Write error: ${err}]\n\`))`.
- **Why**: Silent failures make debugging impossible for users.

---

## Suggestions (Nice to have)

### S1: Compiler warnings for unused fields

- **Files**: `src-tauri/src/pty/mod.rs:16,21`
- **Issue**: `cargo test` reports warnings for unused fields `id` and `shell_type` on `ShellSession`, and unused method `get_session_ids`. The `#[allow(dead_code)]` is only on the `master` field.
- **Fix**: Either use these fields (expose them in commands) or add `#[allow(dead_code)]` annotations with a comment noting they're for future use.
- **Why**: Clean compiler output makes real warnings visible.

### S2: `.gitkeep` files remain in `commands/` and `pty/` directories

- **File**: `src-tauri/src/commands/.gitkeep`, `src-tauri/src/pty/.gitkeep`
- **Issue**: These directories now have real `.rs` files, but the `.gitkeep` placeholders remain in the diff (they were added).
- **Fix**: The `.gitkeep` files should have been removed since the directories have content.
- **Why**: Convention — `.gitkeep` is only needed for otherwise-empty directories.

**UPDATE**: On closer inspection, the diff shows these `.gitkeep` files were created as new files in this commit. Looking at the stat: `src-tauri/src/commands/.gitkeep | 0` and `src-tauri/src/pty/.gitkeep | 0` appear in the diff as new empty files. However, the directories already had `.gitkeep` from TASK-001. The diff may be showing them due to permissions or other changes. The actual `.gitkeep` files were already removed from `commands/` and `pty/` — only `ansi/` and `session/` retain them (correctly). Disregard this suggestion.

### S3: Consider `camelCase` for Tauri command parameters

- **File**: `src-tauri/src/commands/mod.rs`
- **Issue**: Tauri uses `snake_case` for Rust parameters which auto-converts to `camelCase` for JS by default (unless `rename_all` is configured). The current code uses `snake_case` on both sides (`shell_type`, `session_id`) which works because Tauri's default deserialization handles both. However, the Tauri convention recommends `camelCase` on the JS side.
- **Fix**: Either add `#[serde(rename_all = "camelCase")]` on the Rust side or keep the current approach (which works fine). Low priority.
- **Why**: Consistency with Tauri ecosystem conventions.

### S4: Missing tests for event listener behavior

- **File**: `src/__tests__/Terminal.test.tsx`
- **Issue**: Tests verify session creation and input sending, but don't test that `listen()` is called for the correct event channels (`pty:output:{id}`, `pty:error:{id}`, `pty:closed:{id}`), or that the output callback correctly appends to the display.
- **Fix**: Add tests that verify `listen` was called with the expected event names after session creation, and simulate event callbacks to verify output rendering.
- **Why**: The output streaming path is the core feature but has no test coverage.

### S5: Output buffer trimming could split multi-byte characters

- **File**: `src/components/Terminal.tsx:35-36`
- **Issue**: `next.slice(next.length - OUTPUT_BUFFER_LIMIT)` could slice in the middle of a surrogate pair in JavaScript strings.
- **Fix**: Low priority — unlikely in practice with 100K limit, but could use a helper that backs up to a safe boundary.
- **Why**: Defensive coding for edge cases.

---

## Summary

- **Total findings**: 1 critical, 6 important, 5 suggestions (1 retracted)
- **Overall assessment**: **NEEDS CHANGES**

### Rationale

The implementation closely follows the task spec and demonstrates solid engineering. The PTY spawning, IPC contract, event streaming, and frontend component are all correct and well-structured. Tests are comprehensive for unit-level behavior and all pass.

However, there is one critical finding (C1: blocking I/O under mutex in async context) that will cause problems as the app scales to multiple sessions. The important findings around resource cleanup (I1, I2), UTF-8 handling (I4), and the unused IPC wrapper (I5) should also be addressed.

The security posture is good:
- Shell type validation is strict and correct
- No command injection — `CommandBuilder::new()` with `.arg()` is used properly
- No `unwrap()` on user-derived data
- Output buffer is capped
- CSP is maintained
- Capabilities are minimal and appropriate

### Verdict: NEEDS CHANGES

**Must address before merge:**
- C1: Document or mitigate the blocking I/O under mutex issue

**Should address:**
- I1: Reader thread shutdown mechanism
- I2: Child process wait after kill
- I5: Use IPC wrapper in Terminal component
- I6: Surface write errors to user
