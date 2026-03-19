# Task 023: Replace AnsiFilter with vt100 Terminal Emulator (Phase 1)

## Context

Velocity's current ANSI pipeline strips everything except printable text and SGR color sequences. This means programs that use cursor movement, carriage return overwriting, backspace, or line editing don't render correctly. Progress bars show as accumulated garbage, PowerShell's PSReadLine produces duplicated lines, and `\r` (carriage return) doesn't work.

This task replaces the `AnsiFilter` with the `vt100` crate — a proper terminal emulator that maintains a virtual screen buffer. Instead of filtering out "unsafe" sequences, we process ALL sequences through `vt100::Parser`, then extract the rendered text from the virtual screen. The output sent to the frontend is the screen's rendered content, which correctly reflects cursor movement, line overwrites, backspace, and carriage returns.

**This is Phase 1 of the P0-1 terminal emulation plan.** Phase 2 (alternate screen grid renderer) is a separate future task.

### What exists now

- **ansi/mod.rs** (`src-tauri/src/ansi/mod.rs`, 291 lines): `AnsiFilter` struct that uses `vte::Parser` to pass through printable chars + SGR sequences, stripping everything else. The `Perform` trait implementation explicitly drops cursor movement, erase, OSC, DCS, backspace, and bell.

- **pty/mod.rs** (`src-tauri/src/pty/mod.rs`): `spawn_reader_thread()` at line 84 creates an `AnsiFilter` and calls `ansi_filter.filter(&buf[..n])` on each 4096-byte PTY read chunk. The filtered string is sent via `mpsc::Sender<PtyEvent>` as `PtyEvent::Output(output)`.

- **Cargo.toml**: Already depends on `vte = "0.15"`. The `vt100` crate also uses `vte` internally.

- **Frontend**: Terminal.tsx accumulates `block.output` by string concatenation. AnsiOutput.tsx renders via `useIncrementalAnsi` which parses SGR codes into styled spans. The frontend expects a string that grows by appending — it does NOT handle overwrites or cursor movement.

### The core problem

The frontend treats output as an append-only string. But with `vt100`, the virtual screen can have lines overwritten (progress bars, `\r`, backspace). We need a strategy to extract the screen content in a way that the frontend can render correctly.

### The solution

Replace `AnsiFilter` with `vt100::Parser` in the reader thread. After each `parser.process(chunk)`:

1. Extract the full screen content using `screen.contents_formatted()` — this gives us the rendered text WITH SGR codes, exactly as it would appear on a real terminal.
2. BUT we can't send the entire screen on every chunk — that would be a massive regression (re-sending 80x24+ chars on every keystroke).
3. Instead, use a **diff-based approach**: track the previous screen content, compute what changed, and send only the delta.

**Simpler approach for Phase 1**: Since the frontend already handles appended text well, and most normal commands just produce new lines:

1. Replace `AnsiFilter` with `vt100::Parser` in the reader thread.
2. After `parser.process(chunk)`, get `screen.contents_formatted()`.
3. Compare against the previously sent content. Send only the NEW portion (the diff).
4. For simple appends (most commands), this sends just the new lines — same as before.
5. For overwrites (progress bars, `\r`), the diff will include the overwritten lines. The frontend needs to handle this by REPLACING the block output, not appending.
6. Add a new `PtyEvent` variant to signal "full replace" vs "append" semantics.

**Even simpler for Phase 1 MVP**: Always send the full screen content as the block output, replacing the previous content entirely. This is less efficient but correct. The frontend already handles blocks with changing output (the `setBlocks` handler replaces block output). Optimize with diffs in Phase 3.

## Requirements

### Backend (Rust)

#### 1. Add `vt100` dependency

Add to `Cargo.toml`:
```toml
vt100 = "0.15"
```

#### 2. Create `TerminalEmulator` wrapper (`src-tauri/src/ansi/mod.rs`)

Replace (or rename) `AnsiFilter` with a new struct that wraps `vt100::Parser`:

```rust
pub struct TerminalEmulator {
    parser: vt100::Parser,
    /// The last content sent to the frontend, for diff computation.
    last_content: String,
}

impl TerminalEmulator {
    pub fn new(rows: u16, cols: u16) -> Self {
        TerminalEmulator {
            parser: vt100::Parser::new(rows, cols, 0), // no scrollback needed - we manage our own
            last_content: String::new(),
        }
    }

    /// Process a chunk of raw PTY bytes through the terminal emulator.
    /// Returns the new output to send to the frontend, or None if nothing changed.
    pub fn process(&mut self, raw: &[u8]) -> Option<TerminalOutput> {
        self.parser.process(raw);
        let screen = self.parser.screen();
        let current = screen.contents_formatted();
        // Convert bytes to string
        let current_str = String::from_utf8_lossy(&current).to_string();

        if current_str == self.last_content {
            return None; // No visible change
        }

        // Determine if this is an append or a replacement
        let output = if current_str.starts_with(&self.last_content) {
            // Simple append — send just the new part
            let new_part = current_str[self.last_content.len()..].to_string();
            TerminalOutput::Append(new_part)
        } else {
            // Content was overwritten (cursor movement, \r, etc.)
            TerminalOutput::Replace(current_str.clone())
        };

        self.last_content = current_str;
        Some(output)
    }

    /// Resize the virtual terminal.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows, cols);
    }

    /// Check if the terminal is in alternate screen mode.
    pub fn is_alternate_screen(&self) -> bool {
        self.parser.screen().alternate_screen()
    }
}

pub enum TerminalOutput {
    Append(String),   // New content to append (normal case)
    Replace(String),  // Full content to replace block output with (overwrite case)
}
```

#### 3. Update `PtyEvent` enum (`src-tauri/src/pty/mod.rs`)

Add a variant to distinguish append vs. replace:

```rust
pub enum PtyEvent {
    Output(String),           // Append new text (existing, kept for compatibility)
    OutputReplace(String),    // Replace entire block output (new — for cursor movement/overwrites)
    Error(String),
    Closed,
}
```

#### 4. Update `spawn_reader_thread()` (`src-tauri/src/pty/mod.rs`)

Replace `AnsiFilter::new()` with `TerminalEmulator::new(rows, cols)`. The rows/cols need to be passed to the reader thread (they come from `create_session`).

```rust
fn spawn_reader_thread(
    mut reader: Box<dyn Read + Send>,
    tx: mpsc::Sender<PtyEvent>,
    shutdown_flag: Arc<AtomicBool>,
    session_id: String,
    rows: u16,
    cols: u16,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut emulator = TerminalEmulator::new(rows, cols);
        loop {
            if shutdown_flag.load(Ordering::Relaxed) { break; }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Some(output) = emulator.process(&buf[..n]) {
                        let event = match output {
                            TerminalOutput::Append(s) => PtyEvent::Output(s),
                            TerminalOutput::Replace(s) => PtyEvent::OutputReplace(s),
                        };
                        if tx.send(event).is_err() { break; }
                    }
                }
                Err(e) => {
                    let _ = tx.send(PtyEvent::Error(e.to_string()));
                    break;
                }
            }
        }
        let _ = tx.send(PtyEvent::Closed);
    });
}
```

#### 5. Update bridge thread

The bridge thread in `start_reading()` emits Tauri events. It needs to handle the new `PtyEvent::OutputReplace` variant. Emit a different event name (e.g., `pty:replace:{sid}`) or include a field in the payload to distinguish append vs. replace.

**Simplest approach**: Use the same event name `pty:output:{sid}` but add a JSON payload with a `mode` field:

```rust
// For append:
app_handle.emit(&format!("pty:output:{}", sid), serde_json::json!({ "text": text, "replace": false }))
// For replace:
app_handle.emit(&format!("pty:output:{}", sid), serde_json::json!({ "text": text, "replace": true }))
```

Wait — changing the event payload format is a breaking change. The frontend currently expects a plain string. Let me reconsider.

**Better approach**: Keep `pty:output:{sid}` as append (plain string payload, unchanged). Add a NEW event `pty:output-replace:{sid}` for replacements (plain string payload). This is backward-compatible.

#### 6. Update `resize_session` to resize the emulator

The emulator's virtual screen dimensions must match the PTY dimensions. When `resize_session` is called, the emulator needs to be resized too. This means the `TerminalEmulator` must be accessible from outside the reader thread.

**Approach**: Store the emulator in an `Arc<Mutex<TerminalEmulator>>` and share it between the reader thread and the session. The reader thread locks it to process bytes; `resize_session` locks it to call `resize()`.

Alternatively, send a resize message through a channel to the reader thread. The channel approach avoids mutex contention on every read.

**For Phase 1 MVP**: Use `Arc<Mutex<>>`. The mutex is held briefly (microseconds per chunk) and resize is rare.

### Frontend (React/TypeScript)

#### 7. Handle `pty:output-replace:{sid}` event in Terminal.tsx

Add a listener for the new event alongside the existing `pty:output:{sid}` listener:

```typescript
// Existing: append output
listen<string>(`pty:output:${sid}`, (event) => {
  // Same as current — append event.payload to block.output
});

// New: replace output
listen<string>(`pty:output-replace:${sid}`, (event) => {
  setBlocks(prev => prev.map(b => {
    if (b.id === activeBlockIdRef.current) {
      return { ...b, output: event.payload };
    }
    return b;
  }));
});
```

**Important**: The replace handler sets the ENTIRE block output, not appending. This means the truncation logic (`OUTPUT_LIMIT_PER_BLOCK`) should still apply but the logic changes slightly — we're replacing, not growing.

#### 8. Update `useIncrementalAnsi` hook

The incremental ANSI parsing hook currently assumes output only grows (appends). With replacements, the output can shrink or change entirely. The hook already handles this case (the "truncation" path — when `output.length < cache.parsedLength` or the prefix changes, it triggers a full reparse). So **no changes should be needed** — the existing full-reparse fallback handles replacements correctly.

Verify this in testing.

### IPC Contract

**Existing event (unchanged)**:
- `pty:output:{sid}` — payload: `string` — append text to block output

**New event**:
- `pty:output-replace:{sid}` — payload: `string` — replace entire block output with this text

### Performance Considerations

- **Phase 1 uses full-content replace for overwrites**: When a progress bar updates, the entire screen content (~2-4KB for an 80x24 terminal) is sent as a replacement. This is acceptable for Phase 1 — a real terminal sends similar amounts of data.
- **Append-detection optimization**: When content simply grows (most commands), only the new portion is sent — same as the current pipeline. No regression for normal commands.
- **`vt100::Parser` overhead**: The `vt100` crate maintains a cell grid in memory. For an 80x24 terminal, this is ~1920 cells × ~40 bytes/cell ≈ 75KB. Negligible.
- **`contents_formatted()` cost**: Serializes the screen to a byte vector with ANSI codes. O(rows × cols). Fast for typical terminal sizes.
- **Diff in Phase 3**: `screen.contents_diff(&prev_screen)` can be used later to send minimal updates for the grid renderer.

### Security Considerations

- The `vt100` crate processes ALL escape sequences, including ones our filter currently strips (OSC, DCS, cursor queries). However, the OUTPUT sent to the frontend is the rendered screen content (text + SGR), not the raw escape sequences. The `vt100` parser consumes dangerous sequences internally (they affect screen state) but doesn't pass them through to `contents_formatted()`.
- `contents_formatted()` produces text with SGR codes — the same safe output our current pipeline produces.
- The frontend's existing `isValidRgb` check in `ansi.ts` still applies.
- No new IPC commands are added — only a new event for screen replacements.

## Tests (Write These FIRST)

### Rust Unit Tests (in `src-tauri/src/ansi/mod.rs`)

- [ ] `test_emulator_plain_text`: Process plain text, verify `contents_formatted()` contains the text.
- [ ] `test_emulator_sgr_preserved`: Process SGR-colored text, verify SGR codes in formatted output.
- [ ] `test_emulator_carriage_return`: Process `"hello\rworld"`, verify output is `"world"` (overwritten).
- [ ] `test_emulator_backspace`: Process `"abc\x08d"`, verify output is `"abd"` (backspace + overwrite).
- [ ] `test_emulator_cursor_up`: Process `"line1\nline2\x1b[Aoverwrite"`, verify line1 is overwritten.
- [ ] `test_emulator_clear_screen`: Process `"text\x1b[2J"`, verify screen is cleared.
- [ ] `test_emulator_progress_bar`: Simulate a progress bar: `"[###       ] 30%\r[######    ] 60%\r[##########] 100%"`, verify final output shows 100%.
- [ ] `test_emulator_append_detection`: Two sequential appends detected as `Append`, not `Replace`.
- [ ] `test_emulator_overwrite_detection`: Carriage return detected as `Replace`, not `Append`.
- [ ] `test_emulator_alternate_screen_detection`: Process `"\x1b[?1049h"`, verify `is_alternate_screen()` returns true. Process `"\x1b[?1049l"`, verify returns false.
- [ ] `test_emulator_resize`: Create with 80x24, resize to 120x40, verify no crash and dimensions take effect.
- [ ] `test_emulator_empty_input_no_output`: Processing empty bytes returns None.
- [ ] `test_emulator_256_and_truecolor`: SGR 256-color and truecolor preserved through vt100.

### Rust Integration Tests (in `src-tauri/tests/`)

- [ ] `test_real_shell_progress_bar`: Spawn a real PowerShell process, run a command that uses `Write-Host -NoNewline` with `\r` to simulate a progress bar, verify the output reflects the final state (not accumulated garbage).

### Frontend Tests (Vitest)

- [ ] `test_output_replace_event_replaces_block_output`: Mock the `pty:output-replace:{sid}` event, verify block output is replaced (not appended).
- [ ] `test_output_append_still_works`: Existing `pty:output:{sid}` append behavior unchanged.
- [ ] `test_incremental_ansi_handles_replacement`: Feed the `useIncrementalAnsi` hook with a shorter string (simulating replacement), verify it triggers full reparse and produces correct spans.

### E2E Tests (Playwright)

- [ ] `test_e2e_carriage_return_rendering`: Run a command with `\r` output, verify the display shows the final overwritten text, not accumulated lines.

**Rust integration tests**: REQUIRED — this task changes the PTY output pipeline.
**Frontend tests**: REQUIRED — new event handling.
**E2E tests**: REQUIRED — user-visible rendering change.

## Acceptance Criteria

- [ ] All tests above written and passing
- [ ] `vt100` crate added to Cargo.toml
- [ ] `AnsiFilter` replaced with `TerminalEmulator` wrapping `vt100::Parser`
- [ ] Reader thread uses `TerminalEmulator` instead of `AnsiFilter`
- [ ] Append vs. replace output correctly detected and sent as appropriate events
- [ ] Frontend handles `pty:output-replace:{sid}` event
- [ ] Plain commands (echo, ls, dir) still produce correct output (regression check)
- [ ] SGR colors still work (regression check)
- [ ] Carriage return (`\r`) correctly overwrites the line
- [ ] Backspace correctly overwrites characters
- [ ] Progress-bar-style output renders correctly (not accumulated garbage)
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Existing ANSI filter tests adapted or replaced for the new emulator
- [ ] Clean commit: `feat: replace ANSI filter with vt100 terminal emulator`

## Files to Read First

- `src-tauri/src/ansi/mod.rs` — Current AnsiFilter (to be replaced)
- `src-tauri/src/pty/mod.rs` — Reader thread, bridge thread, PtyEvent enum, session management
- `src-tauri/src/lib.rs` — Command registration (no changes expected, but understand the structure)
- `src-tauri/Cargo.toml` — Dependencies
- `src/components/Terminal.tsx` — Output event handler, block output management
- `src/hooks/useIncrementalAnsi.ts` — Incremental ANSI parsing (verify it handles replacements)
- `src/__tests__/Terminal.test.tsx` — Existing output handling tests
- `src-tauri/tests/integration/` — Existing integration test patterns
