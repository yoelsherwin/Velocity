# Security Review: TASK-023 (vt100 Terminal Emulator - Phase 1)

**Reviewer**: Security Agent
**Date**: 2026-03-18
**Commit range**: `dde12a2..51fc742`
**Verdict**: PASS with findings (1 LOW, 1 INFORMATIONAL)

---

## 1. Summary of Changes

The PTY output pipeline was fundamentally restructured:

- **Removed**: `vte` crate (0.15) -- a low-level VT parser used by the old `AnsiFilter`
- **Added**: `vt100` crate (0.15.2) -- a full virtual terminal emulator
- **Removed**: `AnsiFilter` struct that explicitly stripped non-SGR sequences via VTE performer callbacks
- **Added**: `TerminalEmulator` struct wrapping `vt100::Parser`, which processes ALL escape sequences through a virtual terminal and extracts rendered screen contents
- **Added**: `sanitize_to_sgr_only()` post-processor to strip non-SGR sequences from `vt100::Screen::contents_formatted()` output
- **Added**: `PtyEvent::OutputReplace` variant for content that was overwritten (cursor movement, `\r`, etc.)
- **Added**: `Arc<Mutex<TerminalEmulator>>` shared between reader thread and resize
- **Frontend**: New `pty:output-replace:{sid}` event listener that replaces block output instead of appending

## 2. Critical Path Analysis: PTY Output to Frontend

```
PTY raw bytes
  -> reader thread: read(&mut buf[4096])
  -> emulator.lock().process(&buf[..n])
    -> vt100::Parser::process(raw)          // full terminal emulation
    -> screen.contents_formatted()          // extract rendered content
    -> String::from_utf8_lossy()            // bytes to string
    -> sanitize_to_sgr_only()               // strip non-SGR sequences
    -> diff vs last_content                 // append vs replace detection
  -> PtyEvent::Output(s) or PtyEvent::OutputReplace(s)
  -> mpsc channel -> bridge thread
  -> Tauri emit("pty:output:{sid}", s) or emit("pty:output-replace:{sid}", s)
  -> Frontend React listener
```

## 3. Sanitizer Analysis: `sanitize_to_sgr_only()`

### 3.1 What `contents_formatted()` Can Emit

By source-code audit of `vt100-0.15.2/src/term.rs` and `screen.rs`, `contents_formatted()` calls:

1. **`HideCursor::write_buf`** -- emits `\x1b[?25l` or `\x1b[?25h` (private-mode CSI)
2. **`grid().write_contents_formatted()`** -- emits:
   - `MoveTo`: `\x1b[H`, `\x1b[row;colH` (CSI H)
   - `MoveRight`: `\x1b[C`, `\x1b[nC` (CSI C)
   - `Crlf`: `\r\n`
   - `EraseChar`: `\x1b[X`, `\x1b[nX` (CSI X)
   - `ClearRowForward`: `\x1b[K` (CSI K)
   - `Backspace`: `\x08`
   - SGR sequences: `\x1b[...m`
   - Text content (including multi-byte UTF-8)
3. **`attrs.write_escape_code_diff`** -- emits SGR sequences only

**Critically**: `contents_formatted()` does NOT include title (`\x1b]0;...\x07`), input mode, or bell sequences -- those are only in `state_formatted()`. This is a positive security property.

### 3.2 Sanitizer Correctness Against Known Outputs

| Sequence from `contents_formatted()` | Sanitizer Behavior | Correct? |
|---|---|---|
| `\x1b[?25l` / `\x1b[?25h` (HideCursor) | CSI with `?` in params (0x3F range), final byte `l`/`h` != `m` -> STRIPPED | YES |
| `\x1b[H` / `\x1b[row;colH` (MoveTo) | CSI, final byte `H` != `m` -> STRIPPED | YES |
| `\x1b[C` / `\x1b[nC` (MoveRight) | CSI, final byte `C` != `m` -> STRIPPED | YES |
| `\x1b[X` / `\x1b[nX` (EraseChar) | CSI, final byte `X` != `m` -> STRIPPED | YES |
| `\x1b[K` (ClearRowForward) | CSI, final byte `K` != `m` -> STRIPPED | YES |
| `\x08` (Backspace) | Explicit backspace check -> STRIPPED | YES |
| `\r\n` (Crlf) | `\r` and `\n` are preserved (allowed C0) | YES |
| `\x1b[...m` (SGR) | CSI, final byte `m` -> KEPT | YES |
| Plain text / UTF-8 | Falls through to text handler -> KEPT | YES |

### 3.3 Edge Cases Analyzed

**Partial CSI sequence** (`\x1b[` with no final byte):
- The parser loops through parameter and intermediate bytes. If it reaches end-of-input without finding a final byte (0x40-0x7E), the partial sequence is silently dropped. CORRECT.

**Non-CSI escape sequences** (`\x1b` followed by non-`[`):
- Falls into the `else if bytes[i] == 0x1b` branch. Skips ESC byte, then skips the command byte if it's in 0x40-0x7E range. This handles `\x1b7` (SaveCursor), `\x1b8` (RestoreCursor), `\x1bM` (ReverseIndex), `\x1b=`/`\x1b>` (Application Keypad), `\x1bg` (VisualBell). All stripped. CORRECT.

**C0 control characters**: Bell (0x07), form feed (0x0C), etc. are stripped by the `bytes[i] < 0x20` filter. Only `\n`, `\r`, `\t` are preserved. CORRECT.

**UTF-8 handling**: The `utf8_char_len()` function correctly determines multi-byte character length from the first byte. The `(i + ch_len).min(len)` prevents overrun on truncated UTF-8. CORRECT.

**Very long CSI parameters**: All digits/semicolons/colons are in the 0x30-0x3F range and consumed as parameter bytes. The final byte determines keep/strip. A very long `\x1b[9999...m` would be kept as SGR, which is safe -- the frontend ANSI parser handles arbitrary SGR parameters without security impact.

### 3.4 Potential Bypass Vectors

**OSC sequences** (`\x1b]...`): NOT emitted by `contents_formatted()` (confirmed by source audit). Even if they were, the sanitizer handles `\x1b` + `]` (0x5D, in 0x40-0x7E) by stripping both bytes. However, the OSC *payload* would leak through as plain text. See Finding F-001.

**DCS sequences** (`\x1bP...`): Same pattern -- `P` (0x50) is in 0x40-0x7E, so `\x1b` and `P` are stripped, but payload would leak as text. Not emitted by `contents_formatted()`.

**SOS/PM/APC** (`\x1bX`, `\x1b^`, `\x1b_`): `X` and `^` are in 0x40-0x7E, stripped. `_` (0x5F) is in range, stripped. Payloads would leak. Not emitted by `contents_formatted()`.

## 4. Findings

### F-001 [LOW]: Sanitizer Does Not Handle OSC/DCS/APC Payload Sequences

**Description**: If `vt100::Screen::contents_formatted()` were ever to emit OSC sequences (e.g., `\x1b]0;malicious title\x07`), the sanitizer would strip `\x1b]` but the payload text `0;malicious title` would pass through as visible text, and `\x07` (bell) would be stripped. This is not a vulnerability today because `contents_formatted()` does not emit these sequences (confirmed by source audit of vt100 0.15.2), but it is a latent risk if the vt100 crate changes behavior in a future version.

**Impact**: LOW. The leaked payload would appear as visible text in the terminal output, not as executable escape sequences. No code execution or XSS risk. The concern is defense-in-depth.

**Recommendation**: Add a comment documenting the assumption that `contents_formatted()` only emits CSI sequences, backspace, CRLF, and text. Consider adding a property test that feeds adversarial input through the full pipeline (process -> sanitize) and validates the output. Alternatively, add OSC/DCS stripping to the sanitizer for defense-in-depth:

```rust
// After the non-CSI escape branch, add:
} else if bytes[i] == 0x1b && i + 1 < len && (bytes[i+1] == b']' || bytes[i+1] == b'P' || bytes[i+1] == b'_' || bytes[i+1] == b'^' || bytes[i+1] == b'X') {
    // OSC/DCS/PM/APC/SOS: skip until ST (\x1b\\) or BEL (\x07)
    i += 2;
    while i < len {
        if bytes[i] == 0x1b && i + 1 < len && bytes[i+1] == b'\\' {
            i += 2; break;
        } else if bytes[i] == 0x07 {
            i += 1; break;
        }
        i += 1;
    }
}
```

### F-002 [INFORMATIONAL]: `from_utf8_lossy` Replacement Character Injection

**Description**: At line 122 of `pty/mod.rs`, `String::from_utf8_lossy(&current)` converts the vt100 output to a string. If the raw PTY output contains malformed UTF-8 (which is uncommon but possible with binary commands like `cat /dev/urandom`), the lossy conversion inserts Unicode replacement characters (U+FFFD). These are harmless but may cause unexpected visual output.

**Impact**: INFORMATIONAL. No security impact. The replacement character is valid UTF-8 text.

## 5. Concurrency Analysis: `Arc<Mutex<TerminalEmulator>>`

The `TerminalEmulator` is shared between:
1. **Reader thread** (`spawn_reader_thread`): Locks to call `emu.process()` for each read chunk
2. **Main thread** (`resize_session`): Locks to call `emu.resize()`

**Assessment**:
- The Mutex provides exclusive access -- no data races possible.
- Lock contention is minimal: reader holds the lock briefly per chunk (~4KB), resize is infrequent.
- Poisoned mutex is handled: reader breaks on poison (`Err(_) => break`), resize logs a warning and continues. Both are correct.
- No deadlock risk: only one mutex is ever held at a time in each code path.

**Verdict**: No new attack vectors from the shared state.

## 6. `PtyEvent::OutputReplace` Risk Assessment

The new `OutputReplace` variant sends a full replacement string instead of an incremental append. Frontend handles it by replacing the entire block output.

**Risks considered**:
- **Size**: The replacement string is bounded by the vt100 terminal dimensions (rows * cols * ~max_char_width). With 500x500 max dimensions, this is at most ~1MB. The frontend already has `OUTPUT_LIMIT_PER_BLOCK` applied to replace events (confirmed in Terminal.tsx).
- **Frequency**: In a fast-updating progress bar, the emulator could emit many `OutputReplace` events. This is rate-limited only by the PTY read loop (4KB buffer). The frontend replaces the whole block on each event, which could cause rendering pressure. This is a performance concern, not a security concern.
- **Content**: The replacement content goes through the same `sanitize_to_sgr_only()` as append content. No bypass.

**Verdict**: No new security risks.

## 7. Dependency Audit

### vt100 0.15.2
- **Purpose**: Full virtual terminal emulator
- **Dependency tree**: `vt100` -> `vte` 0.11.1 (parser), `itoa`, `log`, `unicode-width`
- **Advisory check**: No known vulnerabilities in `vt100` or its dependencies
- **`unsafe` in project code**: None. The word "unsafe" appears only in comments/docs.

### cargo audit
- **Result**: 0 vulnerabilities, 18 warnings (all GTK3 unmaintained crate warnings from Tauri's Linux dependencies -- not applicable on Windows target)

## 8. Security Contract Verification

The security contract states: "Frontend only receives text + SGR escape sequences."

**Verification**:
1. All output goes through `sanitize_to_sgr_only()` before reaching the channel -- confirmed in `TerminalEmulator::process()` (line 126 of ansi/mod.rs)
2. No code path exists to emit raw vt100 output without sanitization
3. The sanitizer correctly strips all non-SGR CSI sequences (H, C, X, K, J, l, h, etc.)
4. The sanitizer correctly strips backspace, non-CSI escapes, and dangerous C0 controls
5. The sanitizer preserves only: text, `\n`, `\r`, `\t`, and `\x1b[...m` (SGR) sequences
6. 30 unit tests pass, including 3 critical end-to-end pipeline tests (`test_emulator_output_contains_only_sgr_sequences`, `test_emulator_output_after_cursor_movement_is_sgr_only`, `test_emulator_progress_bar_output_is_sgr_only`)

**Contract status**: MAINTAINED.

## 9. Verdict

**PASS** -- The security contract is maintained. The `sanitize_to_sgr_only()` function correctly strips all non-SGR sequences that `vt100::Screen::contents_formatted()` is known to emit. The one low finding (F-001) is a defense-in-depth improvement for future-proofing against vt100 crate changes, not a current vulnerability.

### Action Items
| ID | Severity | Action | Blocking? |
|---|---|---|---|
| F-001 | LOW | Add OSC/DCS payload stripping for defense-in-depth, or document the assumption | No |
| F-002 | INFO | No action required | No |
