# Code Review R2: TASK-023 Replace AnsiFilter with vt100 Terminal Emulator

**Reviewer**: Claude Code (Automated R2)
**Commits**: `c4c67cb` (feat) + `40dd84a` (fix)
**R1 Report**: `CODE-REVIEW-TASK-023-vt100-emulator-R1.md`
**Verdict**: **APPROVE**

---

## R1 Findings Verification

### [S1] CRITICAL: `contents_formatted()` emits non-SGR sequences -- FIXED

The fix adds `sanitize_to_sgr_only()` in `src-tauri/src/ansi/mod.rs` (lines 17-73), which is called on every `process()` invocation before the output reaches the append/replace logic or the frontend.

**Verification of `sanitize_to_sgr_only()` correctness:**

The function is a byte-level state machine that handles four categories:

1. **CSI sequences** (`\x1b[...`): Parses parameter bytes (0x30-0x3F), intermediate bytes (0x20-0x2F), and final byte (0x40-0x7E) per ECMA-48. Only keeps sequences where the final byte is `m` (SGR). All others (H, J, K, C, A, B, D, X, l, h, etc.) are dropped. Partial sequences (truncated at buffer boundary) are also dropped.

2. **Non-CSI escapes** (`\x1b` followed by 0x40-0x7E): Dropped. Covers `\x1bM` (reverse index), `\x1b7`/`\x1b8` (save/restore cursor), etc.

3. **Backspace** (0x08): Dropped.

4. **Other C0 controls** (0x00-0x1F except `\n`, `\r`, `\t`): Dropped. Covers BEL (0x07), FF (0x0C), etc.

5. **Regular text + multi-byte UTF-8**: Kept, with proper UTF-8 character length detection to avoid splitting.

**Edge case analysis:**

- **Private mode sequences** (e.g., `\x1b[?25l`): The `?` byte (0x3F) falls in the parameter byte range (0x30-0x3F), so it is consumed during parameter parsing. The final byte `l` (0x6C) is not `m`, so the sequence is correctly dropped. Verified by `test_sanitize_strips_cursor_visibility`.

- **OSC sequences** (`\x1b]...`): The `]` byte (0x5D) is not `[` (0x5B), so the function falls into the non-CSI escape branch. The `]` byte (0x5D) is in range 0x40-0x7E, so it gets consumed as the "command character." The remainder of the OSC payload (up to ST or BEL) would be treated as regular text. **Minor gap**: OSC sequences with long payloads (e.g., `\x1b]0;title\x07`) would leak the payload text ("0;title") into the output. However, `vt100::Screen::contents_formatted()` does not emit OSC sequences in its output, so this is not a practical concern. The function is designed to sanitize `contents_formatted()` output specifically, not arbitrary terminal streams.

- **DCS sequences** (`\x1bP...`): Similar to OSC -- the `P` byte gets consumed as a non-CSI escape command character, payload leaks as text. Again, `contents_formatted()` does not emit DCS sequences, so this is not a practical issue.

- **Truncated CSI at end of string** (e.g., `"text\x1b["` or `"text\x1b[31"`): The parameter/intermediate loops advance `i` to end-of-string, the final byte check fails (`i >= len`), and the partial sequence is silently dropped. Correct.

- **Empty SGR** (`\x1b[m`): The parameter loop sees `m` (0x6D, which is outside 0x30-0x3F), so it skips to the final byte check. `m` is in 0x40-0x7E range, final_byte == `m`, so it is kept. Correct -- `\x1b[m` is equivalent to `\x1b[0m` (reset).

- **SGR with colon sub-parameters** (e.g., `\x1b[38:2:255:100:0m`): Colons (0x3A) are in the parameter byte range (0x30-0x3F), so they are correctly consumed. Final byte `m` means it is kept. Correct.

**Conclusion**: The sanitizer correctly strips all non-SGR sequences that `contents_formatted()` is known to emit. The security contract in `src/lib/ansi.ts:33-34` is now properly maintained.

### [S2] MEDIUM: `String::from_utf8_lossy` -- NOT ADDRESSED (acceptable)

The code still uses `from_utf8_lossy` on line 122. This was a suggested improvement, not a required change. The `vt100` crate produces valid UTF-8 by construction, so the lossy path is never taken in practice. Acceptable to defer.

### [S3] LOW: Unused `vte` direct dependency -- FIXED

`Cargo.toml` no longer lists `vte = "0.15"`. Only `vt100 = "0.15"` remains. `Cargo.lock` confirms the standalone `vte 0.15.0` package entry was removed; only the transitive `vte 0.11.1` (used by `vt100` internally) remains. Correct.

### [R1] Thread Safety / Poisoned mutex warning -- FIXED

`src-tauri/src/pty/mod.rs` lines 535-540 now uses a `match` on `session.emulator.lock()` with an explicit `Err` branch that logs via `eprintln!` with the session ID and error details, instead of silently ignoring the error. Correct.

### [R3] Append detection slicing safety comment -- FIXED

Lines 132-140 of `ansi/mod.rs` now have a detailed comment explaining why `starts_with` + `self.last_content.len()` byte slicing is safe: the sanitized output contains only ASCII escape codes and text, and the prefix match guarantees byte-alignment. The explanation is accurate.

### [P1] Performance -- NOT ADDRESSED (acceptable)

No debouncing or `contents_diff()` optimization was added. This was a non-blocking suggestion for future optimization.

---

## New Issues Check

### Test Coverage -- Excellent

The fix commit adds 20 new unit tests for `sanitize_to_sgr_only()`:
- 13 tests for the sanitizer function itself (plain text, SGR keep, cursor strip, erase strip, visibility strip, backspace strip, C0 strip, UTF-8, mixed, empty)
- 3 integration tests that run through the full emulator pipeline and verify only SGR sequences appear in the output (`verify_only_sgr_sequences` helper)
- The `verify_only_sgr_sequences` helper is itself a rigorous byte-level validator

All 86 unit tests and 11 integration tests pass.

### NEW [N1]: Non-CSI escape handling is minimal -- LOW, NON-BLOCKING

As noted in the edge case analysis above, the non-CSI escape handler (lines 49-55) only consumes one byte after `\x1b`. Two-byte escape sequences like `\x1bM` (reverse index) or `\x1b7` (save cursor) are handled correctly. However, multi-byte non-CSI sequences (OSC `\x1b]...ST`, DCS `\x1bP...ST`, APC `\x1b_...ST`) would not be fully consumed -- their payloads would leak as text. This is not a practical issue because `vt100::Screen::contents_formatted()` does not emit these sequence types, but if this sanitizer were ever reused on raw PTY output, it would need a more complete parser. Consider adding a comment documenting this limitation.

### NEW [N2]: `from_utf8_lossy` followed by `sanitize_to_sgr_only` -- double allocation

Line 122 creates a `String` via `from_utf8_lossy().to_string()`, then line 126 creates another `String` via `sanitize_to_sgr_only()`. This is two heap allocations per chunk. For typical terminal output this is negligible, but the sanitizer could theoretically operate directly on `&[u8]` to avoid the first allocation. Non-blocking, future optimization.

---

## Checklist

### R1 Required Changes
- [x] **[S1]** Non-SGR sequences stripped via `sanitize_to_sgr_only()` -- FIXED
- [x] **[S3]** Unused `vte` dependency removed -- FIXED

### R1 Suggested Improvements
- [x] **[R1]** Poisoned mutex warning logged -- FIXED
- [x] **[R3]** Slicing safety comment added -- FIXED
- [ ] **[S2]** `from_utf8_lossy` -> `from_utf8` -- deferred (acceptable)
- [ ] **[P1]** `contents_diff()` / debounce -- deferred (acceptable)

### New Issues
- [ ] **[N1]** Non-CSI escape handler limited to 2-byte sequences -- LOW, non-blocking
- [ ] **[N2]** Double allocation (lossy + sanitize) -- LOW, non-blocking

### Security Contract
- [x] Frontend `ansi.ts:33-34` states "only SGR sequences remain"
- [x] Rust `sanitize_to_sgr_only()` guarantees this contract
- [x] Pipeline: `contents_formatted()` -> `sanitize_to_sgr_only()` -> append/replace -> frontend

### Tests
- [x] All 86 unit tests pass
- [x] All 11 integration tests pass
- [x] 20 new sanitizer tests cover all sequence types identified in R1

---

## Verdict: APPROVE

All critical and required findings from R1 have been properly addressed. The `sanitize_to_sgr_only()` function is correct for its intended use case (sanitizing `vt100::Screen::contents_formatted()` output). The security contract between Rust backend and TypeScript frontend is restored. Test coverage is thorough. The two new low-severity observations (N1, N2) are non-blocking and can be addressed in future work.
