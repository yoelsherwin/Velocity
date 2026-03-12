# QA Report: TASK-003 ANSI Security Filter + Color Rendering

**Date**: 2026-03-12
**Tester**: QA Agent (automated + code review)
**Scope**: ANSI filter (Rust), color rendering (React), session management, overall stability
**Branch**: `main` (HEAD at `4bf0355`)

---

## 1. Test Execution Summary

### Frontend Tests (Vitest)
```
5 test files | 18 tests | ALL PASSED
Duration: 2.70s
```

| Test File | Tests | Status |
|-----------|-------|--------|
| `src/__tests__/pty.test.ts` | 5 | PASS |
| `src/__tests__/ansi.test.ts` | 2 | PASS |
| `src/__tests__/AnsiOutput.test.tsx` | 2 | PASS |
| `src/__tests__/App.test.tsx` | 2 | PASS |
| `src/__tests__/Terminal.test.tsx` | 7 | PASS |

### Rust Tests (cargo test)
```
27 tests | 26 passed | 0 failed | 1 ignored
Duration: 0.02s
```

| Module | Tests | Status |
|--------|-------|--------|
| `ansi::tests` | 17 | 17 PASS |
| `pty::tests` | 10 | 9 PASS, 1 IGNORED |

**Ignored test**: `test_spawn_powershell_session` -- requires Tauri `AppHandle` (integration test, expected to be ignored in unit test runs).

---

## 2. Test Coverage Analysis

### What IS Covered

**Rust -- ANSI Filter (`ansi/mod.rs`):**
- Plain text passthrough
- SGR preservation (color, bold, multiple params)
- OSC stripping (title, hyperlinks)
- CSI stripping (cursor movement, erase, device query)
- C0 control handling (newline, tab, bell, backspace)
- Empty input
- Oversize SGR rejection (defense-in-depth)
- Mixed safe/unsafe sequences
- Parser persistence across chunks (split-sequence handling)

**Rust -- PTY/Session Management (`pty/mod.rs`):**
- Session manager starts empty
- Shell type validation (valid and invalid)
- Error handling for nonexistent sessions (close, write, resize)
- Shutdown flag behavior
- MAX_SESSIONS constant value

**Frontend -- IPC Wrappers (`pty.ts`):**
- All 4 IPC functions call `invoke` with correct parameters
- Default parameter handling

**Frontend -- ANSI Parsing (`ansi.ts`):**
- Plain text parsing
- Colored text parsing

**Frontend -- Components:**
- Terminal renders without crashing
- Terminal creates session on mount
- Terminal sends input on Enter
- Terminal clears input after Enter
- Terminal displays write errors
- AnsiOutput renders plain text
- AnsiOutput renders colored spans
- App renders with terminal

### What is NOT Covered (Gaps)

| Gap | Risk Level | Notes |
|-----|-----------|-------|
| No integration test for real PTY session lifecycle | Medium | `test_spawn_powershell_session` is ignored; no E2E test exercises create-write-read-close flow |
| No test for output buffer truncation | Low | `OUTPUT_BUFFER_LIMIT` (100K) logic in Terminal.tsx is untested |
| No test for `pty:closed` event handling | Medium | Terminal.tsx listens for `pty:closed` but no test triggers it |
| No test for `pty:error` event handling | Medium | Terminal.tsx listens for `pty:error` but no test triggers it |
| No test for `createSession` failure in Terminal | Low | The `catch` block in `init()` sets error output but is untested |
| No test for `closeSession` on unmount | Medium | Cleanup function calls `closeSession(sid)` but no test verifies this |
| No test for resize_session IPC | Low | `resizeSession` wrapper is tested but resize is never called from the UI |
| No test for concurrent session access | Medium | Multiple `spawn_blocking` calls could race on the `Mutex<SessionManager>` |
| No Playwright E2E tests exist | Medium | Test script is configured but no test files present |
| MAX_SESSIONS integration test | Low | Only tests the constant value, not the actual enforcement path (requires `AppHandle`) |

---

## 3. Code-Level Bug Hunt

### BUG-001: Backspace Handling Inconsistency Between Task Spec and Implementation

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\ansi\mod.rs`, line 43

**Description**: The task specification (TASK-003-ansi-filter.md, line 104) says backspace (`0x08`) should be **kept** (`match byte { 0x0A | 0x0D | 0x09 | 0x08 => ... }`). However, the implementation **strips** backspace. The code comment explains the rationale: "Backspace is stripped because the frontend does not perform terminal emulation -- it only appends text, so raw `\b` would accumulate invisibly."

**Assessment**: The implementation's behavior is actually **correct** for Velocity's architecture (no terminal emulation, append-only output). The spec was wrong. The deviation is intentional and well-documented. However, the task file and implementation are inconsistent, which could confuse future developers.

**Impact**: Minimal. Backspace characters in PTY output will not appear in the frontend. In a real terminal with backspace editing (e.g., progress bars using `\b`), the output will look slightly different from a native terminal, but this is the expected trade-off without full terminal emulation.

**Recommendation**: Update the task spec to match the implementation, or add a note to the task file that this was an intentional deviation.

---

### BUG-002: Reader Thread Blocks on `read()` After Shutdown Signal

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\pty\mod.rs`, lines 112-133

**Description**: The reader thread checks `shutdown_flag.load(Ordering::Relaxed)` at the top of the loop, but `reader.read(&mut buf)` is a **blocking** call. When `close_session` sets the shutdown flag and then calls `child.kill()`, the reader thread may be blocked inside `read()` and won't check the flag until the read completes or errors out.

**Assessment**: In practice, this is mitigated by the fact that `child.kill()` will cause the PTY to close, which will make `read()` return `Ok(0)` or `Err(...)`, both of which exit the loop. The shutdown flag serves as an optimization/early-exit but is not the primary shutdown mechanism.

**Impact**: Minimal. The reader thread will still exit promptly after `child.kill()` because the read will unblock. The 100ms sleep in `close_session` (line 201) and the subsequent `try_wait`/`wait` provide additional safety. No zombie threads should result.

**Recommendation**: No immediate fix needed. If non-blocking reads are ever needed (e.g., for graceful shutdown without killing the child), consider using `poll` or async I/O. The current approach is adequate for the current architecture.

---

### BUG-003: `close_session` Performs Blocking Operations Inside `spawn_blocking`

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\commands\mod.rs`, lines 76-84 + `C:\Velocity\src-tauri\src\pty\mod.rs`, lines 188-211

**Description**: `close_session` holds the `Mutex<SessionManager>` lock while performing:
1. `session.child.kill()` -- may block briefly
2. `thread::sleep(Duration::from_millis(100))` -- definitely blocks for 100ms
3. `session.child.try_wait()` / `session.child.wait()` -- may block

During this entire time, the mutex is held. Any other command (`create_session`, `write_to_session`, `resize_session`, another `close_session`) will block waiting for the lock.

**Assessment**: Since `spawn_blocking` moves this off the async runtime, the Tauri event loop won't freeze. But all PTY operations are serialized through a single mutex, so a 100ms+ lock hold during close will briefly block other sessions. With a single session (current UI state), this is irrelevant. With multiple sessions (future tabs/panes), it could cause perceptible input lag in other sessions during close.

**Impact**: None currently (single-session UI). Will become relevant when tabs/panes are implemented.

**Recommendation**: Future improvement: remove the session from `HashMap` first (releasing the lock), then perform the blocking cleanup outside the lock. The current code already does `sessions.remove()`, so the mutex could be released immediately after, with cleanup happening in a separate scope.

---

### BUG-004: Potential Memory Growth in `AnsiOutput` with Large Output

**Severity**: Medium
**Location**: `C:\Velocity\src\components\AnsiOutput.tsx` + `C:\Velocity\src\components\Terminal.tsx`

**Description**: The `AnsiOutput` component calls `parseAnsi(text)` on every render (memoized by `text` dependency). The `text` value is the entire output buffer, which grows up to `OUTPUT_BUFFER_LIMIT` (100,000 characters). Each output event from the PTY appends to this string, causing the `text` prop to change, which invalidates the `useMemo` and re-parses the **entire** 100K string into spans.

For a 100K character string with many SGR sequences, `Anser.ansiToJson()` will create thousands of span objects, and React will diff/re-render all of them on every PTY output event (which can fire hundreds of times per second for fast output like `dir /s` or compilation logs).

**Assessment**: This is a performance issue, not a correctness bug. The app will work correctly but may become sluggish with large output buffers and fast-streaming output. The `React.memo` wrapper prevents re-renders when `text` hasn't changed, but since `text` changes on every PTY output event, it provides no benefit during active output streaming.

**Impact**: Performance degradation during fast output streaming. The user may see UI lag, dropped frames, or input latency when the output buffer is large.

**Recommendation**: Consider a ring-buffer or virtual scrolling approach in the future. For now, this is acceptable for pre-alpha.

---

### BUG-005: `Ordering::Relaxed` Used for Shutdown Flag Cross-Thread Synchronization

**Severity**: Low
**Location**: `C:\Velocity\src-tauri\src\pty\mod.rs`, lines 113 and 195

**Description**: The shutdown flag uses `Ordering::Relaxed` for both the store (in `close_session`) and load (in the reader thread). `Relaxed` provides no ordering guarantees -- the reader thread may not immediately see the store from `close_session` on a different CPU core.

**Assessment**: In practice, this is not a problem because:
1. The shutdown flag is only an optimization hint -- the primary shutdown mechanism is `child.kill()` causing the read to error/EOF
2. Even with `Relaxed`, the value will propagate within nanoseconds on x86 (TSO memory model)
3. The worst case is one extra loop iteration before the flag is observed

**Impact**: Effectively zero on x86/x64 (Windows). Could theoretically matter on ARM, but even there the impact is one extra read cycle.

**Recommendation**: No fix needed. If strict correctness across all architectures is desired in the future, upgrade to `Ordering::SeqCst` or `Ordering::Acquire`/`Release`.

---

### BUG-006: No Input Validation for `rows`/`cols` Parameters

**Severity**: Medium
**Location**: `C:\Velocity\src-tauri\src\commands\mod.rs`, lines 20-21 + `C:\Velocity\src-tauri\src\pty\mod.rs`, lines 53-58

**Description**: The `create_session` and `resize_session` commands accept `rows` and `cols` as `u16` values with no validation. A value of `0` for rows or cols is passed directly to `PtySize`. Similarly, extremely large values (e.g., 65535 x 65535) are accepted.

- `rows: 0, cols: 0` -- may cause division-by-zero or undefined behavior in the PTY subsystem
- `rows: 65535, cols: 65535` -- may cause excessive memory allocation

**Assessment**: Tauri's deserialization handles type safety (must be u16), but semantic validation is missing. The `portable-pty` crate may handle these edge cases gracefully, or it may not -- the behavior is undefined and platform-dependent.

**Impact**: A malicious or buggy frontend could pass `rows: 0` or extreme values. Whether this causes a crash depends on the PTY backend implementation. At minimum, `0` rows/cols is semantically invalid.

**Recommendation**: Add bounds checking: `rows` and `cols` should be clamped to reasonable ranges (e.g., 1-500 for rows, 1-1000 for cols), or reject 0 values with an error.

---

### BUG-007: Frontend Does Not Handle `resizeSession` -- No Resize Support

**Severity**: Low (Missing Feature)
**Location**: `C:\Velocity\src\components\Terminal.tsx`

**Description**: The `resize_session` Rust command exists and the `resizeSession` IPC wrapper exists in `src/lib/pty.ts`, but the Terminal component never calls it. The PTY is created with fixed 24x80 dimensions and never resized, even when the window is resized.

**Assessment**: This means the PTY output will be formatted for 80 columns regardless of the actual window width. Wide windows will have empty space on the right; narrow windows will have wrapped lines. Commands that use the terminal width (like `Get-ChildItem` with column formatting) will use 80 columns.

**Impact**: Output formatting will be incorrect when the window is not exactly 80 columns wide. This is a missing feature, not a bug.

---

## 4. Security Assessment

### Positive Findings

1. **No `unwrap()` on user-derived data** -- All Rust code uses `map_err()` or `unwrap_or()` for error handling. The only `expect()` is on the Tauri builder initialization, which is acceptable.

2. **Shell type validation** -- `validate_shell_type()` restricts to known shells ("powershell", "cmd", "wsl"). No arbitrary command execution.

3. **No string interpolation of user input** -- Commands are built using `CommandBuilder`, not string concatenation.

4. **ANSI filter is comprehensive** -- All dangerous sequence types (OSC, DCS, CSI non-SGR, ESC) are stripped. Default action is strip, not pass-through.

5. **SGR size bounded** -- `MAX_SEQUENCE_LENGTH` (256 bytes) prevents maliciously large SGR sequences.

6. **IPC inputs validated on Rust side** -- Session IDs are looked up in the HashMap (fails safely for invalid IDs), shell types are validated.

7. **CSP enabled** -- Capabilities file only grants `core:default` and `core:event:default` (minimal permissions).

8. **`tauri-plugin-opener` removed** -- No unnecessary plugins with filesystem/URL access.

### Security Concern: Parser Persistence Across Chunks

The `AnsiFilter.filter()` method persists the `vte::Parser` across calls (line 25-27 in `ansi/mod.rs`). This means a malicious PTY output could start a dangerous sequence in one chunk and complete it in the next. However, since only SGR sequences are allowed through `csi_dispatch`, and all other handlers strip their content, this persistence is actually safe -- it only benefits legitimate SGR sequences split across chunk boundaries. Other sequence types will be recognized and stripped regardless of whether they span chunks.

### Security Concern: Error Messages Leak Internal State

Error messages from Rust commands include internal details (e.g., `"Failed to lock session manager: PoisonError"`). While not exploitable, these messages are displayed in the terminal output and could be confusing.

---

## 5. Manual Test Plan

Since this is a desktop application, the following tests require human execution:

### MT-001: Basic Shell Interaction
1. Launch `npm run tauri dev`
2. Wait for PowerShell prompt to appear in the output area
3. Type `echo hello` and press Enter
4. **Expected**: "hello" appears in the output
5. Type `exit` and press Enter
6. **Expected**: "[Process exited]" appears, input field becomes disabled

### MT-002: Colored Output
1. Launch the app
2. Type `Write-Host -ForegroundColor Red "RED TEXT"` and press Enter
3. **Expected**: "RED TEXT" appears in red color
4. Type `Write-Host -ForegroundColor Green -BackgroundColor Yellow "STYLED"` and press Enter
5. **Expected**: "STYLED" appears in green text on yellow background
6. Type `Write-Host -ForegroundColor Blue "BLUE"` and press Enter
7. **Expected**: "BLUE" appears in blue

### MT-003: ANSI Stripping Verification
1. Launch the app
2. Type `[char]0x1b + "]0;HACKED TITLE" + [char]0x07` or equivalent PowerShell to emit an OSC title sequence
3. **Expected**: No window title change; the escaped text should not appear in output
4. Type `Write-Host "before$([char]27)[2Jafter"` (contains clear screen escape)
5. **Expected**: Output shows "beforeafter" (the erase sequence is stripped)

### MT-004: Large Output Handling
1. Launch the app
2. Type `dir C:\ /s` (recursive directory listing -- generates heavy output)
3. **Expected**: Output streams in real-time without freezing
4. Let it run for 10+ seconds
5. **Expected**: Output buffer caps at ~100K characters without crashing
6. **Expected**: Scrolling works, newest output is visible

### MT-005: Session Close Behavior
1. Launch the app
2. Type `echo test` and press Enter (verify it works)
3. Close the application window
4. Open Task Manager
5. **Expected**: No orphaned `powershell.exe` or `conhost.exe` processes remain

### MT-006: Error Display
1. Launch the app
2. Type a command that produces an error: `Get-Item nonexistent_file_xyz`
3. **Expected**: PowerShell error message appears (typically in red with ANSI colors)
4. The error should be readable and properly colored

### MT-007: Window Resize (Known Limitation)
1. Launch the app
2. Resize the window to be very wide (e.g., full screen)
3. Type `Get-ChildItem C:\Windows`
4. **Expected**: Output is formatted for 80 columns (left-aligned, not using full width)
5. This is expected behavior -- resize is not yet connected to `resize_session`

---

## 6. Bug Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| BUG-001 | Low | Backspace handling deviates from task spec (intentional) | Documented, no fix needed |
| BUG-002 | Low | Reader thread blocks on read() ignoring shutdown flag | By design, mitigated by child.kill() |
| BUG-003 | Low | close_session holds mutex during blocking cleanup | Future concern for multi-session |
| BUG-004 | Medium | Full output buffer re-parse on every PTY event | Performance concern for large output |
| BUG-005 | Low | Relaxed memory ordering for cross-thread flag | Acceptable on x86, pedantic concern |
| BUG-006 | Medium | No input validation for rows/cols (0 or extreme values) | Should fix -- potential crash |
| BUG-007 | Low | resize_session never called from frontend | Missing feature, documented |

### Bugs Requiring Action (Recommended)

**BUG-006** is the most actionable finding. Adding bounds validation for `rows` and `cols` is a straightforward defensive measure that prevents potential undefined behavior in the PTY subsystem. Specifically:
- Reject `rows == 0` or `cols == 0` with an error
- Consider capping at reasonable maximums (e.g., 500 rows, 1000 cols)

**BUG-004** is a performance concern that will become more apparent as the application matures. No immediate fix needed for pre-alpha, but should be addressed before beta.

---

## 7. Overall Assessment

**Verdict**: PASS with notes

The TASK-003 implementation is solid. The ANSI security filter is well-designed with a deny-by-default approach, comprehensive test coverage on the Rust side (17 tests covering all sequence types), and correct integration with the frontend rendering pipeline. The code follows the project's security guidelines (no `unwrap()` on user data, no string interpolation, proper error handling).

**Strengths:**
- Excellent ANSI filter test coverage (17 Rust unit tests)
- Security-first design: all sequence types explicitly handled, default is strip
- Parser persistence correctly handles split-chunk SGR sequences
- Clean separation of concerns: Rust filters, frontend renders
- Proper React memoization (`useMemo` + `React.memo`)
- All 44 automated tests pass (18 frontend + 26 Rust)

**Areas for Improvement:**
- Frontend test coverage has gaps (event handling, buffer truncation, cleanup)
- No E2E tests yet (Playwright configured but no test files)
- Input validation for PTY dimensions (rows/cols)
- Performance optimization for large output buffers (future)

**No critical or high-severity bugs found.**
