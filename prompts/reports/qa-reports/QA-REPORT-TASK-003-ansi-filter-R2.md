# QA Report R2: Shell Selector, Restart, ANSI Filter, Session Management

**Date**: 2026-03-12
**Tester**: QA Agent (automated + code review)
**Scope**: Shell selector UI, restart flow, ANSI filter, session lifecycle, input validation, overall stability
**Branch**: `main` (HEAD at `4bf0355`)
**Prior Report**: QA-REPORT-TASK-003-ansi-filter-R1.md

---

## 1. Test Execution Summary

### Frontend Tests (Vitest)
```
5 test files | 25 tests | ALL PASSED
Duration: 6.18s
```

| Test File | Tests | Status |
|-----------|-------|--------|
| `src/__tests__/ansi.test.ts` | 2 | PASS |
| `src/__tests__/pty.test.ts` | 5 | PASS |
| `src/__tests__/AnsiOutput.test.tsx` | 2 | PASS |
| `src/__tests__/App.test.tsx` | 2 | PASS |
| `src/__tests__/Terminal.test.tsx` | 14 | PASS |

### Rust Tests (cargo test)
```
32 tests | 31 passed | 0 failed | 1 ignored
Duration: 0.00s (after build)
```

| Module | Tests | Status |
|--------|-------|--------|
| `ansi::tests` | 18 | 18 PASS |
| `pty::tests` | 14 | 13 PASS, 1 IGNORED |

**Ignored test**: `test_spawn_powershell_session` -- requires Tauri `AppHandle` (integration test, expected to be ignored in unit test runs).

### Delta from R1
- Frontend: 18 tests -> 25 tests (+7 new tests for shell selector, restart, output clearing)
- Rust: 27 tests -> 32 tests (+5 new tests for dimension validation)
- All previously identified test gaps for shell switching and restart button are now covered

---

## 2. Test Coverage Analysis

### What IS Covered (New Since R1)

**Frontend -- Terminal Component (7 new tests):**
- Shell selector renders all 3 buttons (PowerShell, CMD, WSL)
- PowerShell is selected by default with `aria-selected="true"`
- Shell switch creates a new session and closes the old one
- Restart button appears when process exits (`pty:closed` event)
- Restart creates a new session with the same shell type
- Output clears on restart
- Write error display in output

**Rust -- PTY/Session Management (5 new tests):**
- `validate_dimensions` with valid values (24x80, 1x1, 500x500)
- `validate_dimensions` rejects zero rows
- `validate_dimensions` rejects zero cols
- `validate_dimensions` rejects overflow rows (>500)
- `validate_dimensions` rejects overflow cols (>500)

### What Is NOT Covered (Remaining Gaps)

| Gap | Risk Level | Notes |
|-----|-----------|-------|
| No integration test for real PTY session lifecycle | Medium | `test_spawn_powershell_session` is ignored; no E2E test exercises create-write-read-close flow |
| No test for output buffer truncation at 100K chars | Low | `OUTPUT_BUFFER_LIMIT` (100K) logic in Terminal.tsx is untested |
| No test for `pty:error` event handling | Low | Terminal.tsx listens for `pty:error` but no test triggers it (note: `pty:closed` IS now tested) |
| No test for `createSession` failure in Terminal | Low | The `catch` block in `startSession()` sets error output but is untested |
| No test for `closeSession` on unmount | Medium | Cleanup function in useEffect calls `closeSession(sid)` but no test verifies this |
| No test for resize_session from UI | Low | `resizeSession` wrapper is tested but resize is never called from the Terminal component |
| No Playwright E2E tests exist | Medium | Test script is configured but no test files present |
| No test for double-click on same shell button (no-op guard) | Low | `handleShellSwitch` returns early if same shell + not closed, untested |
| No test for rapid shell switching (race condition) | Medium | See BUG-001 below |
| MAX_SESSIONS integration test | Low | Only tests the constant value, not the actual enforcement path (requires `AppHandle`) |
| No test for `handleKeyDown` with non-Enter keys | Low | Only Enter key path is tested |

---

## 3. R1 Bug Status Review

| R1 Bug | Severity | Status in R2 |
|--------|----------|-------------|
| BUG-001: Backspace spec vs. implementation | Low | Unchanged -- documented deviation, no action needed |
| BUG-002: Reader thread blocks on read() | Low | Unchanged -- by design, mitigated by child.kill() |
| BUG-003: close_session holds mutex during blocking cleanup | Low | Unchanged -- future concern for multi-session |
| BUG-004: Full output buffer re-parse on every PTY event | Medium | Unchanged -- performance concern for large output |
| BUG-005: Relaxed memory ordering for shutdown flag | Low | Unchanged -- acceptable on x86 |
| BUG-006: No input validation for rows/cols | Medium | **FIXED** -- `validate_dimensions()` now rejects <1 or >500, called in both `create_session` and `resize_session` |
| BUG-007: resize_session never called from frontend | Low | Unchanged -- missing feature |

---

## 4. New Bugs Found in R2

### BUG-008: Race Condition in Shell Switching -- Old Session Output Leaks to New Session

**Severity**: Medium
**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 79-92 (`resetAndStart`)

**Description**: When the user switches shells via `handleShellSwitch`, the following sequence occurs:
1. `closeSession(sessionIdRef.current)` is called (async, `.catch(() => {})`)
2. `cleanupListeners()` removes the event listeners
3. State is reset (`setOutput('')`, `setInput('')`, `setClosed(false)`, `setSessionId(null)`)
4. `startSession(newShell)` is called, which creates a new session and registers new listeners

The problem is that between step 1 and step 2, the `closeSession` call is fire-and-forget -- it does not `await` the close completing before removing listeners. However, this is actually handled correctly since `closeSession` is awaited.

The real race is different: between the old session's reader thread emitting events and the listener cleanup in step 2, there is a window where:
- The old session's reader thread may still emit `pty:output:{old-sid}` events
- The listeners for those events still exist (briefly) and will call `setOutput()` to append output
- Then `cleanupListeners()` runs and removes the old listeners
- Then `setOutput('')` resets the output
- **But** if a React state batch hasn't flushed yet, the old output append and the `setOutput('')` may be batched together, with the empty string winning, OR the old output append running after the reset

In practice, React 19's automatic batching makes this mostly safe (the `setOutput('')` in `resetAndStart` will override), but there is a theoretical window where:
- `closeSession` is awaited
- During the await, the old session's reader thread emits one last output event
- The old listener fires and calls `setOutput(prev => prev + newOutput)`
- Then `cleanupListeners()` runs
- Then `setOutput('')` runs
- These are in the same async function, so React batches them, and `setOutput('')` wins

**Assessment**: This is a theoretical race that is extremely unlikely to manifest in practice due to React 19 batching. However, the pattern is fragile.

**Impact**: Worst case: a brief flash of old session output in the new session, immediately overwritten. No data corruption or security issue.

**Recommendation**: Move `cleanupListeners()` to BEFORE the `await closeSession()` call, ensuring no old events are processed during the close operation.

---

### BUG-009: `handleShellSwitch` Stale Closure Over `shellType`

**Severity**: Medium
**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 122-129

**Description**: `handleShellSwitch` has a dependency on `shellType` state:
```tsx
const handleShellSwitch = useCallback(
  async (newShell: ShellType) => {
    if (newShell === shellType && !closed) return;
    setShellType(newShell);
    await resetAndStart(newShell);
  },
  [shellType, closed, resetAndStart],
);
```

The guard `if (newShell === shellType && !closed) return;` prevents re-creating a session when the user clicks the already-active shell button (unless the session has closed). This is correct.

However, if the user rapidly clicks two different shell buttons (e.g., CMD then WSL), the following can happen:
1. User clicks CMD. `handleShellSwitch('cmd')` starts executing. `shellType` is `'powershell'`. The guard passes. `setShellType('cmd')` is called. `resetAndStart('cmd')` starts awaiting.
2. Before `resetAndStart('cmd')` completes, user clicks WSL. A new `handleShellSwitch('wsl')` call starts. Due to React batching, `shellType` may still be `'powershell'` in this closure (the `setShellType('cmd')` hasn't triggered a re-render yet). The guard checks `'wsl' === 'powershell'` -> false, so it passes. `setShellType('wsl')` is called. `resetAndStart('wsl')` starts.

Now there are two concurrent `resetAndStart` calls:
- The first is creating a CMD session
- The second is creating a WSL session

Both will complete, and the component will end up with the second session's ID, but the first session (CMD) was created on the backend and never closed. It becomes an orphaned session that leaks resources.

**Assessment**: This is a real bug that can be triggered by rapid clicking. The orphaned session will count against the MAX_SESSIONS limit and its reader thread will continue running until the app is closed.

**Impact**: Resource leak (orphaned PTY session, reader thread, child process). With 20 rapid shell switches, the MAX_SESSIONS cap would be hit and no new sessions could be created. The user would need to restart the app.

**Recommendation**: Add a guard flag (e.g., `isSwitching` ref) to prevent concurrent shell switches, or use an abort/cancellation pattern. Alternatively, debounce the shell switch handler.

---

### BUG-010: `handleRestart` Does Not Guard Against Concurrent Clicks

**Severity**: Low
**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 131-133

**Description**: Similar to BUG-009, if the user clicks the Restart button rapidly before the first restart completes, multiple concurrent `resetAndStart(shellType)` calls will execute, creating multiple sessions with only the last one being tracked. The earlier sessions become orphaned.

**Assessment**: Less likely than BUG-009 since the Restart button only appears when the process has exited, and the button disappears once the new session starts (because `setClosed(false)` hides it). However, there is still a brief window between clicking Restart and the button being hidden where a second click could register.

**Impact**: Same as BUG-009 -- orphaned sessions, resource leak.

**Recommendation**: Disable the Restart button immediately on click (optimistic disable), or use a ref guard to prevent re-entry.

---

### BUG-011: Cleanup on Unmount May Race with `startSession`

**Severity**: Low
**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 95-114

**Description**: The initialization effect:
```tsx
useEffect(() => {
  let mounted = true;
  async function init() {
    if (!mounted) return;
    await startSession('powershell');
  }
  init();
  return () => {
    mounted = false;
    cleanupListeners();
    if (sessionIdRef.current) {
      closeSession(sessionIdRef.current).catch(() => {});
    }
  };
}, []);
```

The `mounted` flag is checked before `startSession`, but `startSession` is async. If the component unmounts while `startSession` is executing (e.g., during the `await createSession()` call), the cleanup function runs:
- `mounted = false` (but `startSession` is already past the check)
- `cleanupListeners()` -- cleans up any listeners registered so far
- `closeSession(sessionIdRef.current)` -- `sessionIdRef.current` is still `null` at this point because `startSession` hasn't completed, so `closeSession` is NOT called

Then `startSession` completes:
- `updateSessionId(sid)` -- sets the session ID (but the component is unmounted)
- `listen()` calls register new listeners (but the component is unmounted)

The result: a session is created on the backend, listeners are registered, but the cleanup already ran. The session is orphaned.

**Assessment**: This can happen during React Strict Mode (double mount/unmount in development) or during rapid navigation between views (not applicable in the current single-Terminal UI).

**Impact**: Orphaned backend session in development mode or rapid mount/unmount scenarios. In the current single-Terminal UI, the Terminal never unmounts during normal usage, so this is theoretical.

**Recommendation**: Use an AbortController or check `mounted` after each async step in `startSession`, and ensure cleanup can handle sessions created after the cleanup function ran.

---

### BUG-012: `slave` PTY Handle Not Explicitly Dropped Before Session Insert

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\pty\mod.rs`, lines 80-158

**Description**: When creating a session, the `pair.slave` handle is used to `spawn_command()` on line 101-103, and then the `ShellSession` struct stores `pair.master` but NOT `pair.slave`. The `pair.slave` is implicitly dropped when `pair` goes out of scope or is partially moved.

In `portable-pty`, the `SlavePty` should be dropped after spawning the child process. If it is kept alive, it can prevent the PTY from properly signaling EOF when the child exits. The current code correctly drops it implicitly since only `pair.master` is moved into the `ShellSession`.

**Assessment**: The behavior is actually correct -- `pair.slave` is dropped after `spawn_command()` returns and `pair.master` is moved out. Rust's ownership semantics handle this properly. No bug here, just worth noting for documentation.

**Impact**: None. Noted for completeness.

---

### BUG-013: `vte::Parser` Taken Via `std::mem::take` May Reset Parser State

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\ansi\mod.rs`, lines 25-28

**Description**: The `filter` method uses `std::mem::take` to temporarily take ownership of the parser:
```rust
pub fn filter(&mut self, raw: &[u8]) -> String {
    self.output.clear();
    let mut parser = std::mem::take(&mut self.parser);
    parser.advance(self, raw);
    self.parser = parser;
    self.output.clone()
}
```

`std::mem::take` replaces `self.parser` with `Default::default()` (a fresh parser). The taken parser is then used for `advance()` and put back. This is correct -- the parser state is preserved because it is taken out, used, and put back. The intermediate default value at `self.parser` is never used.

However, if `advance()` panics (which would require a bug in the `vte` crate), `self.parser` would be left in the default (fresh) state, losing any mid-sequence parser state. This is actually a reasonable behavior on panic -- better to have a fresh parser than a corrupted one.

**Assessment**: Not a bug. The pattern is correct and the test `test_parser_persists_across_chunks` validates the behavior. The `Perform` trait requires `&mut self` which creates a borrowing conflict with `self.parser` -- the `take` pattern is the idiomatic solution.

**Impact**: None. Noted for completeness.

---

### BUG-014: Error Messages in Frontend Use String Interpolation Without Sanitization

**Severity**: Low
**Location**: `C:\Velocity\src\components\Terminal.tsx`, lines 60, 72-73, 138-139

**Description**: Error messages from the backend are interpolated directly into the output string:
```tsx
setOutput((prev) => prev + `\n[Error: ${event.payload}]\n`);
setOutput(`[Failed to create session: ${err}]`);
setOutput((prev) => prev + `\n[Write error: ${err}]\n`);
```

These strings are then passed to `AnsiOutput`, which renders them via `parseAnsi()` into React `<span>` elements. Since React's JSX rendering auto-escapes HTML, there is no XSS risk from the error content itself. However, if the error payload contains ANSI escape sequences, `Anser.ansiToJson()` will parse them and apply styling.

A malicious PTY could emit an error message containing ANSI sequences that, when rendered, could produce misleading styled output (e.g., fake error messages, UI confusion). The Rust backend strips ANSI from `pty:output` events but the `pty:error` event payload comes from Rust's `e.to_string()` which should not contain ANSI sequences. The `[Failed to create session: ...]` error is from a Tauri command error, also unlikely to contain ANSI.

**Assessment**: Not exploitable in the current architecture. Rust error strings don't contain ANSI sequences. However, the pattern of passing untrusted data through `parseAnsi()` without explicit sanitization is worth noting.

**Impact**: None currently. Defensive concern for future code paths.

---

## 5. Security Assessment

### Positive Findings (Unchanged from R1 + New)

1. **No `unwrap()` on user-derived data** -- All Rust code uses `map_err()` or `unwrap_or()`.
2. **Shell type validation** -- `validate_shell_type()` restricts to known shells.
3. **No string interpolation of user input** -- Commands use `CommandBuilder`.
4. **ANSI filter is comprehensive** -- Deny-by-default, only SGR passes through.
5. **SGR size bounded** -- `MAX_SEQUENCE_LENGTH` (256 bytes).
6. **IPC inputs validated on Rust side** -- Session IDs, shell types, dimensions all validated.
7. **CSP minimal** -- Only `core:default` and `core:event:default` permissions.
8. **(NEW) Dimension validation added** -- `validate_dimensions()` rejects rows/cols outside 1-500 range (fixes R1 BUG-006).

### Security Concern: Session ID Guessability

Session IDs are UUIDs v4 (128-bit random). An attacker who could call IPC commands would need to guess a UUID to interact with another session. This is effectively impossible (2^122 possible values). No concern.

### Security Concern: MAX_SESSIONS DoS

A malicious frontend script (or compromised webview) could create 20 sessions to hit MAX_SESSIONS, preventing the user from creating new sessions. This is mitigated by the Tauri capability system limiting which windows can invoke commands.

---

## 6. Manual Test Plans

### MT-001: Shell Selector -- Basic Switching
1. Launch `npm run tauri dev`
2. Verify PowerShell button is highlighted (active state)
3. Type `echo "I am PowerShell"` and press Enter
4. Verify output appears
5. Click "CMD" button
6. **Expected**: Output clears, CMD session starts, CMD button becomes active
7. Type `echo I am CMD` and press Enter
8. **Expected**: CMD output appears
9. Click "WSL" button
10. **Expected**: Output clears, WSL session starts (if WSL is installed)
11. **Expected**: If WSL is not installed, an error message appears

### MT-002: Shell Selector -- Same Shell Click (No-op)
1. Launch the app (PowerShell starts)
2. Type `echo test` and press Enter
3. Click the "PowerShell" button (already active)
4. **Expected**: Nothing happens -- no output clear, no new session, same output persists

### MT-003: Restart After Process Exit
1. Launch the app
2. Type `exit` and press Enter
3. **Expected**: "[Process exited]" appears, input field is replaced by Restart button
4. Click "Restart"
5. **Expected**: Output clears, new PowerShell session starts, input field reappears
6. Type `echo "restarted"` and press Enter
7. **Expected**: "restarted" appears in output

### MT-004: Restart Preserves Shell Type
1. Launch the app
2. Click "CMD" to switch to CMD
3. Type `exit` and press Enter
4. **Expected**: "[Process exited]" appears with Restart button
5. Click "Restart"
6. **Expected**: A new CMD session starts (not PowerShell), CMD button remains active

### MT-005: Shell Switch After Process Exit
1. Launch the app (PowerShell)
2. Type `exit` and press Enter
3. **Expected**: "[Process exited]" and Restart button appear
4. Click "CMD" button (instead of Restart)
5. **Expected**: Output clears, CMD session starts, CMD button becomes active, input field appears

### MT-006: Colored Output Rendering
1. Launch the app
2. Type `Write-Host -ForegroundColor Red "RED TEXT"` and press Enter
3. **Expected**: "RED TEXT" appears in red
4. Type `Write-Host -ForegroundColor Green -BackgroundColor Yellow "STYLED"` and press Enter
5. **Expected**: "STYLED" appears in green on yellow background
6. Type `Write-Host -ForegroundColor Cyan -NoNewline "CYAN"; Write-Host -ForegroundColor Magenta " MAGENTA"` and press Enter
7. **Expected**: "CYAN" in cyan, "MAGENTA" in magenta, on the same line

### MT-007: Large Output Stress Test
1. Launch the app
2. Type `dir C:\ /s` (or `Get-ChildItem C:\ -Recurse -ErrorAction SilentlyContinue`) for heavy output
3. **Expected**: Output streams in real-time
4. Let it run for 10-15 seconds
5. **Expected**: UI remains responsive (can still scroll, click shell buttons)
6. **Expected**: No crash or freeze
7. Press Ctrl+C or type `exit` to stop
8. **Expected**: Output buffer is capped (not unbounded growth)

### MT-008: Rapid Shell Switching Stress Test (BUG-009 Reproduction)
1. Launch the app
2. Rapidly click: CMD -> WSL -> PowerShell -> CMD -> WSL (within 1-2 seconds)
3. **Expected (current behavior)**: May create orphaned sessions
4. Open Task Manager and check for multiple `powershell.exe`, `cmd.exe`, `wsl.exe` processes
5. **Expected (desired)**: Only one shell process should be running at a time

### MT-009: Process Cleanup on Window Close
1. Launch `npm run tauri dev`
2. Type `echo test` to verify session works
3. Close the application window (X button)
4. Check Task Manager
5. **Expected**: No orphaned shell processes remain

### MT-010: Input Validation Edge Cases
1. Open browser devtools (if possible in Tauri dev mode)
2. Try invoking: `invoke('create_session', { shell_type: 'bash', rows: 24, cols: 80 })`
3. **Expected**: Error: "Invalid shell type: bash"
4. Try: `invoke('create_session', { shell_type: 'powershell', rows: 0, cols: 80 })`
5. **Expected**: Error: "Invalid rows: 0. Must be between 1 and 500."
6. Try: `invoke('create_session', { shell_type: 'powershell', rows: 24, cols: 501 })`
7. **Expected**: Error: "Invalid cols: 501. Must be between 1 and 500."

---

## 7. Bug Summary

### New Bugs (R2)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| BUG-008 | Medium | Race condition: old session output may briefly flash during shell switch | Open -- theoretical, mitigated by React batching |
| BUG-009 | Medium | Rapid shell switching creates orphaned sessions (resource leak) | Open -- real bug, needs fix |
| BUG-010 | Low | Rapid restart clicks can create orphaned sessions | Open -- real but unlikely |
| BUG-011 | Low | Unmount during session creation can leak session | Open -- theoretical in current UI |
| BUG-012 | N/A | slave PTY handle drop timing (non-bug, documented for clarity) | N/A |
| BUG-013 | N/A | vte::Parser take pattern (non-bug, documented for clarity) | N/A |
| BUG-014 | Low | Error messages rendered through ANSI parser without explicit sanitization | Open -- defensive concern |

### Bugs Requiring Action (Recommended)

**BUG-009 (Medium)** is the most actionable finding. Rapid shell switching can create orphaned PTY sessions that leak resources and count against the MAX_SESSIONS cap. Fix: add a re-entry guard (e.g., `isSwitchingRef`) to `handleShellSwitch` and `handleRestart`, or disable the shell buttons during the async operation.

**BUG-010 (Low)** is the same class of bug applied to the restart button. Fix: disable the button immediately on click or add a guard ref.

### R1 Bugs Resolved

**BUG-006 (Medium) -- FIXED**: Input validation for rows/cols is now implemented via `validate_dimensions()` with range checking (1-500). Both `create_session` and `resize_session` call it. Five new Rust tests verify the validation logic.

---

## 8. Test Coverage Delta

| Metric | R1 | R2 | Delta |
|--------|----|----|-------|
| Frontend test files | 5 | 5 | -- |
| Frontend tests | 18 | 25 | +7 |
| Rust tests (total) | 27 | 32 | +5 |
| Rust tests (pass) | 26 | 31 | +5 |
| Rust tests (ignored) | 1 | 1 | -- |
| E2E tests | 0 | 0 | -- |

### New Tests Added Since R1

**Frontend (7 new):**
1. `test_shell_selector_renders` -- verifies all 3 shell buttons are present
2. `test_powershell_selected_by_default` -- verifies aria-selected on PowerShell button
3. `test_creates_session_with_default_shell` -- verifies initial session is PowerShell
4. `test_shell_switch_creates_new_session` -- verifies close old + create new on shell switch
5. `test_restart_button_appears_on_exit` -- verifies restart button on pty:closed event
6. `test_restart_creates_new_session` -- verifies restart creates session with same shell
7. `test_output_clears_on_restart` -- verifies output buffer is cleared on restart

**Rust (5 new):**
1. `test_validate_dimensions_valid` -- valid values (24x80, 1x1, 500x500)
2. `test_validate_dimensions_zero_rows` -- rejects rows=0
3. `test_validate_dimensions_zero_cols` -- rejects cols=0
4. `test_validate_dimensions_overflow_rows` -- rejects rows=501
5. `test_validate_dimensions_overflow_cols` -- rejects cols=501

---

## 9. Overall Assessment

**Verdict**: PASS with notes

The shell selector and restart features are well-implemented with proper session lifecycle management, event listener cleanup, and accessible UI (ARIA roles, data-testid attributes). The dimension validation fix from R1 BUG-006 is solid with comprehensive test coverage.

**Strengths:**
- Clean session lifecycle: close old -> cleanup listeners -> reset state -> create new
- Proper use of refs for session ID (avoiding stale closures in callbacks)
- `sessionIdRef` + `sessionId` dual state/ref pattern ensures both React rendering and callback access are correct
- Accessible shell selector with `role="tablist"`, `role="tab"`, `aria-selected`
- `OUTPUT_BUFFER_LIMIT` prevents unbounded memory growth
- Event listener cleanup is thorough (tracked in `unlistenRefs`)
- All 56 automated tests pass (25 frontend + 31 Rust)
- R1 BUG-006 (dimension validation) is fully resolved

**Primary Concern:**
- BUG-009 (rapid shell switching creating orphaned sessions) is a real, reproducible bug that should be fixed before the next milestone. It is a resource leak that can exhaust the MAX_SESSIONS cap.

**Areas for Future Improvement:**
- Add re-entry guard for async shell switch/restart operations (fixes BUG-009/010)
- Add E2E tests via Playwright for interactive flows
- Add test for output buffer truncation at 100K
- Add test for component unmount cleanup
- Performance optimization for AnsiOutput re-parsing on large buffers (R1 BUG-004)

**No critical or high-severity bugs found.**
