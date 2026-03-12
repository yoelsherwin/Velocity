# Fix: PTY Output Pipeline — Lazy Reader Start + Diagnostic Logging

## Bug Description
No PTY output appears in the terminal. Two root causes:
1. **Emit/listen race**: Reader thread starts emitting immediately on session creation, but frontend `listen()` requires async IPC round-trips. Initial output is permanently lost.
2. **ANSI filter may strip all ConPTY output**: Windows ConPTY uses cursor positioning to express line structure. Our filter strips all non-SGR CSI, potentially reducing output to empty strings.

## Source
Investigation reports:
- `prompts/reports/investigations/INVESTIGATION-pty-output-not-received.md`
- `prompts/reports/investigations/INVESTIGATION-pty-output-still-missing.md`

## Fixes Required (in order)

### Fix 1: Add diagnostic logging to confirm the root cause

**File**: `src-tauri/src/pty/mod.rs` (reader thread)

Before making architectural changes, add `eprintln!` logging to confirm what's happening:

```rust
Ok(n) => {
    eprintln!("[pty:{}] raw read: {} bytes", sid, n);
    let output = ansi_filter.filter(&buf[..n]);
    eprintln!("[pty:{}] filtered: {} bytes, empty={}", sid, output.len(), output.is_empty());
    if !output.is_empty() {
        if let Err(e) = app_handle.emit(...) {
            eprintln!("[pty:{}] emit error: {}", sid, e);
        }
    }
}
```

This logging stays permanently (it's backend debug logging via `eprintln!`, not user-facing).

### Fix 2: Lazy reader thread — don't start reading until frontend is ready

**File**: `src-tauri/src/pty/mod.rs` + `src-tauri/src/commands/mod.rs`

Currently, the reader thread starts immediately in `create_session`. Change this:

1. **Don't spawn the reader thread in `create_session`.** Instead, store the reader handle in the `ShellSession`:
```rust
pub struct ShellSession {
    pub id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    pub shell_type: String,
    shutdown: Arc<AtomicBool>,
    reader: Option<Box<dyn Read + Send>>,  // NEW: stored until start_reading
}
```

2. **Add a new `start_reading` Tauri command**:
```rust
#[tauri::command]
pub async fn start_reading(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager.lock().map_err(|e| e.to_string())?;
        mgr.start_reading(&session_id, app_handle)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

3. **`SessionManager::start_reading`**: Takes the reader out of the session, spawns the reader thread:
```rust
pub fn start_reading(&mut self, session_id: &str, app_handle: AppHandle) -> Result<(), String> {
    let session = self.sessions.get_mut(session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let reader = session.reader.take()
        .ok_or_else(|| "Reader already started".to_string())?;

    let sid = session_id.to_string();
    let shutdown_flag = session.shutdown.clone();

    std::thread::spawn(move || {
        // ... existing reader loop with AnsiFilter + logging ...
    });

    Ok(())
}
```

4. **Register the command** in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    commands::create_session,
    commands::write_to_session,
    commands::resize_session,
    commands::close_session,
    commands::start_reading,  // NEW
])
```

5. **Add IPC wrapper** in `src/lib/pty.ts`:
```typescript
export async function startReading(sessionId: string): Promise<void> {
    return invoke<void>('start_reading', { sessionId });
}
```

6. **Update `Terminal.tsx`**: Call `startReading` AFTER all `listen()` calls complete:
```typescript
// In startSession, AFTER all three listen() calls and staleness checks:
unlistenRefs.current = [unlistenOutput, unlistenError, unlistenClosed];

// NOW start the reader thread — listeners are guaranteed to be registered
await startReading(sid);

// Check staleness one more time
if (startSessionIdRef.current !== thisInvocation) {
    // ... cleanup
    return;
}
```

### Fix 3: Remove the `!is_empty()` guard

**File**: `src-tauri/src/pty/mod.rs`

Remove the `if !output.is_empty()` check. Let empty strings be emitted — the frontend can handle them (appending "" is a no-op). This ensures we never silently suppress output.

### Fix 4: Investigate ConPTY output format (temporary diagnostic)

To understand whether the ANSI filter is actually stripping all output, the diagnostic logging from Fix 1 will reveal:
- If "raw read: N bytes" appears, the reader IS reading
- If "filtered: 0 bytes" appears for ALL reads, the filter IS stripping everything
- If "filtered: N bytes" with N > 0 appears, the filter passes some output through

**If the filter strips everything**: We'll need to rethink the ANSI strategy (either convert cursor moves to newlines, use a terminal state machine like `vt100` crate, or switch to `xterm.js` on the frontend). That's a separate task — for now, the diagnostic logging will confirm.

## Tests

### Rust Tests
- [ ] **`test_start_reading_nonexistent_session`**: Call `start_reading("bad-id")` → error containing "not found"
- [ ] **`test_start_reading_already_started`**: Create a session, call `start_reading` twice → second call returns error "already started"
- [ ] **`test_reader_not_stored_after_start`**: After `start_reading`, `session.reader` is `None`

### Frontend Tests
- [ ] **`test_startReading_calls_invoke`**: Mock invoke, call `startReading("abc")`, assert invoke was called with `"start_reading"` and `{ sessionId: "abc" }`
- [ ] **Existing Terminal tests must still pass** (update mocks to include `start_reading`)

## Acceptance Criteria
- [ ] Diagnostic `eprintln!` logging in reader thread (raw bytes + filtered bytes)
- [ ] Reader thread starts lazily via `start_reading` command (not in `create_session`)
- [ ] Frontend calls `startReading(sid)` AFTER all `listen()` calls complete
- [ ] `!is_empty()` guard removed from emit
- [ ] `start_reading` command registered in lib.rs
- [ ] IPC wrapper for `startReading` in pty.ts
- [ ] All tests pass (`npm run test` + `cargo test`)
- [ ] Run `npm run tauri dev` and check the terminal output for diagnostic logs — report what you see
- [ ] Clean commit: `fix: lazy reader thread start to eliminate emit/listen race condition`

## Files to Read First
- `prompts/reports/investigations/INVESTIGATION-pty-output-still-missing.md` — Full analysis
- `src-tauri/src/pty/mod.rs` — SessionManager, reader thread, create_session
- `src-tauri/src/commands/mod.rs` — Add start_reading command
- `src-tauri/src/lib.rs` — Register new command
- `src/components/Terminal.tsx` — Call startReading after listen() calls
- `src/lib/pty.ts` — Add startReading wrapper
