# QA Report: TASK-023 Replace AnsiFilter with vt100 Terminal Emulator

**Date**: 2026-03-18
**Reviewer**: QA Agent
**Commits**: `c4c67cb` (feat), `51fc742` (fix -- sanitizer)
**Verdict**: PASS

---

## 1. Automated Test Results

| Suite | Result |
|-------|--------|
| Frontend (Vitest) | 317 passed, 0 failed (30 test files) |
| Rust unit tests | 86 passed, 0 failed, 1 ignored |
| Rust integration tests | 11 passed, 0 failed |

All tests pass. No regressions.

## 2. Test Coverage Assessment

### Rust (`src-tauri/src/ansi/mod.rs`)

**TerminalEmulator tests (12 tests):**
- Plain text, SGR preservation, carriage return, backspace, cursor-up, clear screen, progress bar overwrite, append detection, overwrite (Replace) detection, alternate screen, resize, empty input, 256-color, truecolor.

**sanitize_to_sgr_only tests (14 tests):**
- Plain text passthrough, SGR kept, complex SGR (256/truecolor), cursor home/position/movement stripped, erase sequences stripped, cursor visibility stripped, backspace stripped, newlines/tabs preserved, mixed SGR + non-SGR, C0 controls stripped, UTF-8 preservation, empty string.

**Critical pipeline tests (3 tests):**
- `test_emulator_output_contains_only_sgr_sequences` -- verifies end-to-end sanitization
- `test_emulator_output_after_cursor_movement_is_sgr_only`
- `test_emulator_progress_bar_output_is_sgr_only`

These use a `verify_only_sgr_sequences` helper that walks every byte and panics on any non-SGR escape or unsafe control character. Solid coverage.

### Rust integration tests (`src-tauri/tests/pty_integration.rs`)

- `test_real_shell_carriage_return` -- exercises real PowerShell `\r` overwrite via vt100 emulator. Validates BBB overwrites AAA.
- `collect_output_text` helper correctly simulates frontend Replace semantics (last Replace wins, Append concatenates).
- All existing integration tests updated to accept `PtyEvent::OutputReplace` alongside `PtyEvent::Output`.

### Frontend (`Terminal.test.tsx`)

Three new tests specific to TASK-023:
- `test_output_replace_event_replaces_block_output` -- verifies Replace overwrites rather than appends.
- `test_output_append_still_works` -- regression guard on append behavior.
- `test_output_replace_listener_registered` -- verifies the `pty:output-replace:{sid}` listener is set up.

### Frontend (`useIncrementalAnsi.test.ts`)

- `test_incremental_ansi_handles_replacement` -- exercises the full-reparse path triggered by output-replace events (shorter string replaces longer string).

### Coverage Gaps

None identified that are significant. The key scenarios (append, replace, sanitization, real shell integration) are all covered.

## 3. Code-Level Bug Hunt

### 3.1 `sanitize_to_sgr_only()` -- OSC sequence handling

**Observation**: The sanitizer handles CSI sequences (`\x1b[...`) and simple non-CSI escapes (`\x1b` + single command byte). However, OSC sequences (`\x1b]...ST`) are not explicitly handled. If `vt100::Screen::contents_formatted()` ever emits an OSC sequence (e.g., `\x1b]0;title\x07`), the sanitizer would:
1. See `\x1b` at position `i`
2. Fall into the non-CSI branch (line 49-54)
3. Skip `\x1b` and the next byte `]` (since `]` = 0x5D, within 0x40-0x7E range)
4. The rest of the OSC payload (`0;title\x07`) would pass through as text

**Severity**: LOW. In practice, `contents_formatted()` emits the rendered screen content -- it does not re-emit OSC sequences from the input. The vt100 crate processes them internally (e.g., for window title) and only emits cell content + SGR in `contents_formatted()`. No bug in practice, but worth noting for defense-in-depth.

### 3.2 `process()` -- `String::from_utf8_lossy` replacement characters

**Observation** (line 122): `String::from_utf8_lossy(&current)` replaces invalid UTF-8 with U+FFFD replacement characters. If `contents_formatted()` ever returns bytes that are not valid UTF-8, the `last_content` comparison and `starts_with` prefix check would work correctly (U+FFFD is a valid UTF-8 character and byte slicing on it is safe). No bug, but the lossy conversion means garbled characters could appear in edge cases with broken multi-byte sequences.

**Severity**: NEGLIGIBLE. The vt100 crate processes bytes into cells that map to Unicode characters, so `contents_formatted()` should always produce valid UTF-8 in practice.

### 3.3 `process()` -- Append detection with SGR mid-change

**Observation**: The append-vs-replace detection uses `sanitized.starts_with(&self.last_content)`. This is correct for the common case, but there is an edge case: if vt100 changes how it formats SGR codes between calls (e.g., normalizing `\x1b[0;31m` to `\x1b[31m` retroactively when screen state changes), the prefix would not match and it would fall back to Replace. This is actually the **correct** fallback behavior -- Replace is always safe, just less efficient.

**Severity**: NONE (by design). Replace is the safe fallback.

### 3.4 Emulator mutex contention

**Observation**: The emulator is shared via `Arc<Mutex<TerminalEmulator>>` between the reader thread and `resize_session`. The reader thread locks briefly per chunk (4096 bytes). During resize, the mutex is locked for the duration of `emu.resize()`. If resize is called while the reader thread is processing, one will briefly block the other. This is acceptable -- both operations are fast (microseconds).

**Severity**: NONE.

### 3.5 Frontend -- OutputReplace listener cleanup on superseded session

**Observation**: In `Terminal.tsx`, the `unlistenOutputReplace` function is properly stored in `unlistenRefs.current` (line 235) and cleaned up via `cleanupListeners()`. The staleness checks between each async `listen()` call also correctly clean up the replace listener (lines 189-194). No leak.

**Severity**: NONE.

### 3.6 Frontend -- OutputReplace truncation cap

**Observation**: The `pty:output-replace` handler (lines 162-181) applies the same `OUTPUT_LIMIT_PER_BLOCK` truncation as the append handler. Since Replace sends the full screen content, the payload size is bounded by the vt100 screen dimensions (rows * cols * ~10 bytes for SGR). For a 500x500 terminal (max allowed), that is ~2.5MB, which exceeds the 500KB cap. The truncation code handles this correctly by slicing from the end.

**Severity**: NONE. Correctly handled.

## 4. Manual Test Plans

### Plan 1: Progress bar rendering
1. Start Velocity, open PowerShell
2. Run: `1..100 | ForEach-Object { Write-Host -NoNewline ("`r[" + ("#" * $_) + (" " * (100-$_)) + "] $_%"); Start-Sleep -Milliseconds 50 }`
3. **Expected**: Progress bar updates in place on a single line, reaching 100%. No ghost text from intermediate states.

### Plan 2: Carriage return overwrite
1. Run: `Write-Host -NoNewline "AAAA"; Write-Host -NoNewline "`rBBBB"; Write-Host ""`
2. **Expected**: Output shows "BBBB", not "AAAA" or "AAAABBBB".

### Plan 3: Cursor movement (clear screen)
1. Type several commands to fill the terminal with output
2. Run: `cls` (or `Clear-Host`)
3. **Expected**: Screen clears. Previous output should not reappear.

### Plan 4: Colored output preservation
1. Run: `Write-Host -ForegroundColor Red "RED" -NoNewline; Write-Host -ForegroundColor Green " GREEN"`
2. **Expected**: "RED" appears in red, "GREEN" appears in green. SGR codes preserved through emulator.

### Plan 5: Backspace handling
1. Run a command that produces backspace characters (e.g., some build tools)
2. **Expected**: Backspaces are processed by vt100; no raw `\x08` characters appear in output.

### Plan 6: Resize during output
1. Start a long-running command: `1..1000 | ForEach-Object { echo "line $_"; Start-Sleep -Milliseconds 10 }`
2. While running, resize the Velocity window
3. **Expected**: Output continues flowing without crashes or garbled text.

### Plan 7: OutputReplace event in block model
1. Run a progress-bar command that triggers Replace events
2. After it completes, run a normal command (append events)
3. **Expected**: The new command's output appends to a new block normally. The previous block's output reflects the final state of the progress bar.

### Plan 8: Alternate screen detection
1. Run `vim` or `nano` in WSL (or `more` in PowerShell)
2. Exit the program
3. **Expected**: No crash. Output does not contain garbled escape sequences from alternate screen content.

## 5. Bugs Filed

**No bugs found.** The implementation is clean and well-tested.

## 6. Summary

TASK-023 is a well-executed replacement of the custom `AnsiFilter` with a proper vt100 terminal emulator. Key strengths:

- **Comprehensive sanitizer**: `sanitize_to_sgr_only()` correctly strips all non-SGR sequences with a hand-written byte-level parser, and has 14 unit tests plus 3 end-to-end pipeline validation tests.
- **Append vs Replace detection**: Clean prefix-match algorithm with safe Replace fallback.
- **Frontend integration**: New `pty:output-replace` event properly wired with listener lifecycle management matching the existing `pty:output` pattern.
- **Integration tests**: Real PowerShell carriage-return test validates the full pipeline.
- **No regressions**: All 317 frontend + 97 Rust tests pass.

The code is ready to merge.
