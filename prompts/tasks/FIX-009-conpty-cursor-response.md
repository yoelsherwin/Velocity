# Fix: ConPTY Cursor Position Response — Unblocks PTY Output

## Bug Description
ConPTY sends a Device Status Report query (`\x1b[6n` — 4 bytes) at startup because `portable-pty` creates the pseudoconsole with the `PSEUDOCONSOLE_INHERIT_CURSOR` flag. ConPTY then blocks waiting for a cursor position response on the input pipe. Velocity never sends this response, causing a deadlock — no output is ever produced.

## Source
Investigation: `prompts/reports/investigations/INVESTIGATION-reader-stuck-after-4-bytes.md`

## Root Cause
`portable-pty` v0.9.0 hardcodes the `PSEUDOCONSOLE_INHERIT_CURSOR` flag when creating the ConPTY. This causes ConPTY to:
1. Write `\x1b[6n` (Device Status Report) to the output pipe
2. Wait for `\x1b[{row};{col}R` (Cursor Position Report) on the input pipe
3. Block ALL further output until the response is received

## Fix

### Step 1: Add hex dump diagnostic to confirm (do this first)

In `src-tauri/src/pty/mod.rs`, in the reader thread's `raw read` logging, add hex dump:

```rust
eprintln!("[pty:{}] raw read: {} bytes, hex: {:02x?}", sid, n, &buf[..n.min(64)]);
```

### Step 2: Send cursor position response immediately after session creation

In `src-tauri/src/pty/mod.rs`, in `create_session`, AFTER `take_writer()` but BEFORE storing the session, write the cursor position response to the writer:

```rust
let mut writer = pair
    .master
    .take_writer()
    .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

// Respond to ConPTY's cursor position query (DSR \x1b[6n)
// portable-pty creates ConPTY with PSEUDOCONSOLE_INHERIT_CURSOR flag,
// which causes ConPTY to query cursor position and block until response.
// We respond with cursor at (1,1) to unblock it.
writer
    .write_all(b"\x1b[1;1R")
    .map_err(|e| format!("Failed to send cursor position response: {}", e))?;
writer
    .flush()
    .map_err(|e| format!("Failed to flush cursor response: {}", e))?;
```

This MUST happen before the reader thread starts (which it does, since reader starts lazily via `start_reading`). The sequence is:
1. `create_session` → PTY created, writer obtained, cursor response written
2. Frontend sets up listeners
3. `start_reading` → reader thread starts, ConPTY is unblocked, output flows

### Step 3: Verify the fix works

After implementing, run `npm run tauri dev` and check:
1. More than one `raw read` line appears in the terminal
2. Some `filtered: N bytes` with N > 0 should appear (printable text from the prompt)
3. The Velocity window should show PowerShell prompt text
4. Typing `echo hello` should show output in the block

Report what the diagnostic output shows.

## Tests

### Rust Tests
- [ ] **`test_cursor_response_written_on_create`**: This is hard to test without a real ConPTY. Instead, verify by reading the code path — the write happens before the session is stored. Alternatively, create an integration test (marked `#[ignore]`) that creates a real session and verifies the reader produces more than 4 bytes of output.

### Frontend Tests
- [ ] Existing tests must still pass — no frontend changes needed for this fix.

## Acceptance Criteria
- [ ] Cursor position response (`\x1b[1;1R`) written to PTY writer in `create_session`
- [ ] Hex dump diagnostic logging added to reader thread
- [ ] `npm run tauri dev` → PowerShell prompt appears in the welcome block
- [ ] Typing `echo hello` → output appears in the command block
- [ ] All tests pass (`npm run test` + `cargo test`)
- [ ] Report diagnostic output from `npm run tauri dev`
- [ ] Clean commit: `fix: send cursor position response to unblock ConPTY output`

## Files to Read First
- `prompts/reports/investigations/INVESTIGATION-reader-stuck-after-4-bytes.md` — Full root cause
- `src-tauri/src/pty/mod.rs` — `create_session` (add cursor response after take_writer), reader thread (add hex dump)
