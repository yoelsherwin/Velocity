# Code Review: TASK-023 Replace AnsiFilter with vt100 Terminal Emulator

**Reviewer**: Claude Code (Automated)
**Commit**: `c4c67cb` feat: replace ANSI filter with vt100 terminal emulator
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit replaces the custom `AnsiFilter` (which stripped non-SGR sequences) with a `vt100` crate-based terminal emulator. Instead of filtering escape sequences, all raw PTY output is processed through a virtual terminal (`vt100::Parser`), and the rendered screen contents (with formatting) are extracted via `contents_formatted()`. A new `PtyEvent::OutputReplace` variant handles cursor-movement/overwrite scenarios. The frontend adds a `pty:output-replace` listener that replaces (rather than appends) block output.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/ansi/mod.rs` | Full rewrite: `AnsiFilter` -> `TerminalEmulator` wrapping `vt100::Parser` |
| `src-tauri/src/pty/mod.rs` | Integrate emulator into reader thread, add `PtyEvent::OutputReplace`, resize sync |
| `src-tauri/tests/pty_integration.rs` | Add `collect_output_text` helper, new carriage return test |
| `src/components/Terminal.tsx` | Add `pty:output-replace` listener |
| `src/__tests__/Terminal.test.tsx` | Add tests for replace events |
| `src/__tests__/useIncrementalAnsi.test.ts` | Add test for replacement scenario |
| `src-tauri/Cargo.toml` | Add `vt100 = "0.15"` dependency |

---

## Security Review

### CRITICAL: `contents_formatted()` emits non-SGR escape sequences [S1]

**Severity: HIGH**

The old `AnsiFilter` was explicitly designed to strip all escape sequences except SGR (color/style). The new approach uses `vt100::Screen::contents_formatted()`, and the frontend `parseAnsi()` function (via Anser) and `stripAnsi()` regex both assume only SGR sequences (`\x1b[...m`) will be present.

After auditing the `vt100` crate source (`src/term.rs`, `src/screen.rs`, `src/grid.rs`, `src/row.rs`), `contents_formatted()` can emit the following non-SGR sequences:

1. **Cursor movement**: `\x1b[H` (cursor home), `\x1b[row;colH` (cursor position), `\x1b[nC` (move right)
2. **Screen clearing**: `\x1b[H\x1b[J` (clear screen), `\x1b[K` (clear row forward)
3. **Character operations**: `\x1b[X` or `\x1b[nX` (erase character), `\x08` (backspace)
4. **Cursor visibility**: `\x1b[?25l` (hide cursor), `\x1b[?25h` (show cursor)
5. **Line breaks**: `\r\n` (CRLF)

The previous `AnsiFilter` guaranteed only SGR sequences reached the frontend. The comment in `ansi.ts` still says: "Input should already be security-filtered by the Rust backend (only SGR sequences remain)." This contract is now violated.

**Impact**: The frontend's `stripAnsi()` function (used for clipboard copy) will fail to strip cursor movement and erase sequences, leaving raw escape codes in copied text. The Anser library will likely pass through or display these sequences as literal text. While this is not a direct security vulnerability (no XSS -- React escapes text), it violates the previously established security contract and produces garbled output.

**Recommendation**: Either:
- (a) Post-process `contents_formatted()` to strip all non-SGR sequences before sending to the frontend, or
- (b) Use `screen.contents()` (plain text) + `screen.rows_formatted()` per-row to reconstruct a sanitized SGR-only output, or
- (c) Update the frontend parser (`ansi.ts`) and `stripAnsi()` to handle cursor positioning sequences and convert them to text layout (newlines, spaces).

### MEDIUM: `String::from_utf8_lossy` on `contents_formatted()` output [S2]

**Severity: MEDIUM**

In `ansi/mod.rs` line 37:
```rust
let current_str = String::from_utf8_lossy(&current).to_string();
```

`contents_formatted()` returns structured escape codes that are always valid UTF-8 by construction (ASCII escape codes + UTF-8 text content). However, `from_utf8_lossy` will silently replace invalid bytes with the Unicode replacement character `U+FFFD` instead of erroring. This masks potential corruption. Consider using `String::from_utf8()` with explicit error handling, or at minimum document why lossy conversion is acceptable.

### LOW: Unused `vte` direct dependency [S3]

**Severity: LOW**

`Cargo.toml` still lists `vte = "0.15"` as a direct dependency, but no code directly uses `vte::`. It is pulled in transitively by `vt100`. The direct dependency should be removed to reduce the attack surface and avoid confusion.

---

## Rust Quality

### Thread Safety [R1] -- OK with caveat

The `TerminalEmulator` is wrapped in `Arc<Mutex<TerminalEmulator>>` and shared between the reader thread and `resize_session`. The mutex is locked briefly in each case:
- Reader thread: locks to call `emu.process()` per chunk
- `resize_session`: locks to call `emu.resize()`

This is correct. However, note that `resize_session` (line 532) silently ignores a poisoned mutex:
```rust
if let Ok(mut emu) = session.emulator.lock() {
    emu.resize(rows, cols);
}
```

If the mutex is poisoned (reader thread panicked while holding the lock), the resize silently does nothing. This is arguably acceptable since a poisoned mutex means the reader thread is dead, but it should at minimum log a warning.

### Error Handling [R2] -- Mostly good

- The reader thread handles a poisoned mutex by breaking out of the loop (line 117-118). Good.
- `process()` returns `Option<TerminalOutput>`, cleanly handling the no-change case.
- No `unwrap()` on user-derived data. Good.

### Append Detection Logic [R3] -- Potential correctness issue

In `ansi/mod.rs` line 44:
```rust
let output = if current_str.starts_with(&self.last_content) {
    let new_part = current_str[self.last_content.len()..].to_string();
    TerminalOutput::Append(new_part)
} else {
    TerminalOutput::Replace(current_str.clone())
};
```

The `starts_with` check compares the raw formatted output (which includes escape codes). If `vt100` changes the escape code formatting for content that was previously emitted (e.g., due to attribute changes propagating through the clear-attrs prefix), this could false-positive as a Replace when it's really an Append, or vice versa. In practice, `contents_formatted()` always starts with `\x1b[?25h` or `\x1b[?25l` followed by `\x1b[m\x1b[H\x1b[J`, so the prefix is deterministic. However, the string slicing at `self.last_content.len()` on a UTF-8 string containing escape codes is fragile -- if the prefix ever includes multi-byte UTF-8, the slice could split a character. This deserves a comment explaining why it's safe.

---

## TypeScript / React Quality

### Listener Cleanup [T1] -- Correct

The `unlistenOutputReplace` is properly:
- Stored in `unlistenRefs.current` (line 235)
- Cleaned up by `cleanupListeners`
- Checked for staleness after each async `listen()` call

No memory leaks. Well done.

### Replace Listener Logic [T2] -- Correct

The `pty:output-replace` handler (line 159-186) correctly replaces `b.output` with `event.payload` instead of appending. The exit code extraction and truncation logic is properly duplicated for the replace path.

### Test Coverage [T3] -- Good

Three new tests added:
- `test_output_replace_event_replaces_block_output` -- verifies replace semantics
- `test_output_append_still_works` -- verifies append is not regressed
- `test_output_replace_listener_registered` -- verifies listener exists

The `useIncrementalAnsi.test.ts` adds a `test_incremental_ansi_handles_replacement` test covering the full-reparse path triggered by replacements.

---

## Performance

### Full Screen Replacement [P1] -- Acceptable with caveat

For rapid updates (e.g., progress bars doing `\r` overwrite), each chunk triggers:
1. `vt100::Parser::process()` -- processes raw bytes through emulator
2. `screen.contents_formatted()` -- serializes full screen state to bytes
3. String comparison against `last_content` -- O(n) where n = screen size
4. Full `Replace` sent via channel to frontend

For a 24x80 terminal, the screen content is ~2KB, so this is fine. But for larger terminals (e.g., 500x500 = 250K chars), the serialization + comparison on every chunk could become expensive during rapid updates. The `contents_formatted()` call is O(rows*cols) even when only one character changed.

**Recommendation**: Consider using `vt100::Screen::contents_diff()` for the Replace case to minimize data sent to the frontend, or debounce rapid updates.

### Mutex Contention [P2] -- Minimal

The reader thread holds the mutex only during `emu.process()` which is fast (parsing a 4KB buffer). `resize_session` is called infrequently. No contention concern.

---

## Checklist

### Security
- [x] No command injection
- [ ] **PTY output safety -- `contents_formatted()` emits non-SGR sequences** [S1] **NEEDS FIX**
- [x] No path traversal
- [x] Input validation on IPC (session ID, dimensions validated)

### Rust Quality
- [x] Error handling (Result types, no unwrap on user data)
- [x] Thread safety (Arc<Mutex<>> used correctly)
- [x] Resource cleanup (emulator dropped with session)
- [x] Async correctness (synchronous reader thread, no async issues)

### TypeScript / React Quality
- [x] Hooks correctness (listener cleanup, staleness checks)
- [x] No memory leaks (new listener cleaned up)
- [x] Type safety

### Performance
- [x] Full screen replacement acceptable for normal terminal sizes
- [x] Mutex contention acceptable

---

## Required Changes

1. **[S1] MUST FIX**: The output from `contents_formatted()` contains cursor movement, screen clearing, erase, and cursor visibility escape sequences. These are not SGR sequences and violate the frontend's security contract. The frontend's `stripAnsi()` and `parseAnsi()` assume only SGR. Either sanitize the output on the Rust side before sending, or update the frontend to handle these sequences.

2. **[S3] Should fix**: Remove the unused direct `vte = "0.15"` dependency from `Cargo.toml`. It is only needed transitively by `vt100`.

## Suggested Improvements (non-blocking)

3. **[S2]**: Consider `String::from_utf8()` with error handling instead of `from_utf8_lossy()`.

4. **[R1]**: Log a warning when the emulator mutex is poisoned during resize, rather than silently ignoring.

5. **[R3]**: Add a comment explaining why `starts_with` + string slicing is safe on the formatted output (i.e., the escape code prefix is always ASCII, so byte-level slicing is character-safe).

6. **[P1]**: For future optimization, consider `contents_diff()` or debouncing rapid replace updates.
