# Task 006: PTY Channel Refactor + Integration Tests

## Context

The PTY output pipeline was broken for weeks because no test exercised the real PTY → ANSI filter → event → listener path. Three critical bugs required multi-round investigations:
1. **ConPTY cursor deadlock** — `portable-pty` sends DSR query, Velocity never responds
2. **ANSI filter strips all ConPTY output** — real ConPTY output is control-sequence-heavy
3. **Emit/listen race** — output emitted before listeners registered

All 43 frontend tests mock IPC. All 34 Rust tests use synthetic inputs. Zero integration tests exist. Zero E2E tests exist.

This task implements the channel refactor described in `prompts/TESTING.md` and adds Layer 1 (Rust integration) tests that exercise the real PTY pipeline.

### Current State
- **HEAD**: Check `git log --oneline -1`
- **`src-tauri/src/pty/mod.rs`**: `SessionManager` with `create_session`, `start_reading`, `write_to_session`, `resize_session`, `close_session`. Reader thread emits directly via `app_handle.emit()`.
- **`src-tauri/src/ansi/mod.rs`**: `AnsiFilter` with `vte::Perform` — strips non-SGR sequences.
- **`src-tauri/src/commands/mod.rs`**: 5 Tauri commands using `spawn_blocking`.
- **`src-tauri/tests/`**: Does not exist yet.

## Requirements

### Backend (Rust)

#### 1. Define `PtyEvent` enum

In `src-tauri/src/pty/mod.rs` (or a new submodule):

```rust
#[derive(Debug, Clone)]
pub enum PtyEvent {
    Output(String),     // Filtered ANSI output
    Error(String),      // Read error
    Closed,             // Reader thread ended (process exited or PTY closed)
}
```

#### 2. Refactor reader thread to use channels

Currently the reader thread does `app_handle.emit(...)` directly. Change it to send events through an `mpsc::unbounded_channel()`:

```rust
use std::sync::mpsc;

// In start_reading:
let (tx, rx) = mpsc::channel::<PtyEvent>();

std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    let mut ansi_filter = AnsiFilter::new();
    loop {
        if shutdown_flag.load(Ordering::Relaxed) { break; }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let output = ansi_filter.filter(&buf[..n]);
                // Keep the diagnostic eprintln! logging
                if tx.send(PtyEvent::Output(output)).is_err() { break; }
            }
            Err(e) => {
                let _ = tx.send(PtyEvent::Error(e.to_string()));
                break;
            }
        }
    }
    let _ = tx.send(PtyEvent::Closed);
});
```

Store the `rx` in the session (or return it from `start_reading`).

#### 3. Add event bridge — channel → Tauri events

Add a second thread (or use the same pattern) that reads from the channel and calls `app_handle.emit()`. This is the **bridge** between the testable PTY layer and the Tauri event system:

```rust
// In start_reading, after spawning the reader thread:
let sid_for_bridge = session_id.to_string();
std::thread::spawn(move || {
    while let Ok(event) = rx.recv() {
        match &event {
            PtyEvent::Output(output) => {
                if let Err(e) = app_handle.emit(&format!("pty:output:{}", sid_for_bridge), output) {
                    eprintln!("[pty:{}] emit error: {}", sid_for_bridge, e);
                }
            }
            PtyEvent::Error(err) => {
                let _ = app_handle.emit(&format!("pty:error:{}", sid_for_bridge), err);
            }
            PtyEvent::Closed => {
                let _ = app_handle.emit(&format!("pty:closed:{}", sid_for_bridge), ());
                break;
            }
        }
    }
});
```

#### 4. Add `create_session_with_channel` for testing

Add a method that creates a session and returns the event receiver instead of bridging to Tauri events. This is the test-friendly entry point:

```rust
pub fn create_session_with_channel(
    &mut self,
    shell_type: &str,
    rows: u16,
    cols: u16,
) -> Result<(String, mpsc::Receiver<PtyEvent>), String> {
    // Same as create_session but returns the channel receiver
    // Does NOT need AppHandle — no event bridge
}

pub fn start_reading_with_channel(
    &mut self,
    session_id: &str,
) -> Result<mpsc::Receiver<PtyEvent>, String> {
    // Same as start_reading but returns receiver instead of bridging to events
}
```

Alternatively, make `start_reading` always return the `rx` and have the command layer set up the bridge. Either approach works — pick whichever is cleaner.

#### 5. Create integration test directory

Create `src-tauri/tests/integration.rs` (or `src-tauri/tests/pty_integration.rs`):

```rust
// This file runs as a separate binary — not part of lib tests
// It can use real PTY processes without needing AppHandle
```

### No Frontend Changes

This is a backend-only refactor. The Tauri commands still emit events to the frontend exactly as before. The channel is an internal implementation detail.

### IPC Contract

Unchanged. All 5 Tauri commands work exactly as before. The frontend doesn't need to know about the channel.

## Tests (Write These FIRST)

### Rust Integration Tests (`src-tauri/tests/pty_integration.rs`)

These use REAL PTY processes. No mocks. The `create_session_with_channel` / `start_reading_with_channel` methods return a channel receiver that tests read from.

- [ ] **`test_real_powershell_produces_output`**: Create a session with PowerShell. Start reading. Read from the channel receiver with a timeout (e.g., 5 seconds). Assert at least one `PtyEvent::Output` is received. Assert the combined output is non-empty. Close the session.

- [ ] **`test_real_echo_command`**: Create a PowerShell session. Start reading. Write `"echo hello\r"` to the session. Collect output events for 3 seconds. Assert the combined output text contains `"hello"`.

- [ ] **`test_real_ansi_filter_on_live_output`**: Create a PowerShell session. Start reading. Write `"Write-Host -ForegroundColor Red 'colored'\r"`. Collect output. Assert the output contains `"colored"` AND contains `\x1b[` (SGR sequence preserved by filter).

- [ ] **`test_session_close_produces_closed_event`**: Create a session. Start reading. Write `"exit\r"`. Collect events until `PtyEvent::Closed` is received (with timeout). Assert it arrives.

- [ ] **`test_session_kill_produces_closed_event`**: Create a session. Start reading. Call `close_session`. Collect events until `PtyEvent::Closed` (with timeout). Assert it arrives.

- [ ] **`test_concurrent_sessions_independent`**: Create 2 PowerShell sessions. Start reading both. Write `"echo session1\r"` to session 1 and `"echo session2\r"` to session 2. Assert session 1's output contains "session1" but not "session2", and vice versa.

- [ ] **`test_cursor_response_unblocks_output`**: Create a session (which writes `\x1b[1;1R` automatically). Start reading. Assert more than one `PtyEvent::Output` is received within 5 seconds (proving ConPTY wasn't deadlocked).

- [ ] **`test_large_output_no_truncation`**: Create a session. Start reading. Write `"1..100 | ForEach-Object { echo \"line $_\" }\r"`. Collect all output events. Assert the combined text contains "line 1" and "line 100".

### Rust Unit Tests (keep existing + add)

- [ ] **`test_pty_event_variants`**: Create each `PtyEvent` variant and assert `Debug` output works (compile-time type check).

### Frontend Tests

No new frontend tests needed. Existing 43 tests must continue to pass.

## Acceptance Criteria

- [ ] `PtyEvent` enum defined with `Output`, `Error`, `Closed` variants
- [ ] Reader thread sends to `mpsc::channel` instead of calling `app_handle.emit()` directly
- [ ] Bridge thread reads from channel and calls `app_handle.emit()` (preserves existing behavior)
- [ ] `create_session_with_channel` or equivalent test-friendly API exists
- [ ] Integration test file at `src-tauri/tests/pty_integration.rs`
- [ ] All 8 integration tests written and passing
- [ ] All existing unit tests pass (`cargo test`)
- [ ] All frontend tests pass (`npm run test`)
- [ ] The app still works: `npm run tauri dev` → PowerShell prompt appears, commands produce output
- [ ] Clean commit: `feat: refactor PTY to use channels and add integration tests`

## Security Notes

- The channel is an internal implementation detail — no new attack surface.
- The bridge thread has the same emit behavior as before — event names, payloads, error handling unchanged.
- Integration tests use real PowerShell — they should NOT run in CI without careful sandboxing. Mark with `#[ignore]` if needed, but they MUST pass locally.

## Files to Read First

- `prompts/TESTING.md` — The testing strategy (Layer 1 pattern)
- `prompts/reports/investigations/INVESTIGATION-test-coverage-gaps.md` — Gap analysis
- `src-tauri/src/pty/mod.rs` — Current PTY code (refactor target)
- `src-tauri/src/commands/mod.rs` — Command layer (bridge goes here or in pty)
- `src-tauri/src/ansi/mod.rs` — ANSI filter (used by reader thread, unchanged)
