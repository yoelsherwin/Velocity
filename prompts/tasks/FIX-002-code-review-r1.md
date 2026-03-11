# Fix: Code Review Findings from TASK-002 R1

## Source
Code review report: `prompts/reports/code-reviews/CODE-REVIEW-TASK-002-pty-engine-R1.md`

## Fixes Required

### Fix 1: Move blocking I/O out of async context (CRITICAL — C1)

**File**: `src-tauri/src/commands/mod.rs`
**Issue**: `write_to_session` holds a `std::sync::Mutex` lock while performing blocking I/O (`write_all()` + `flush()` on the PTY writer). This blocks the Tokio async thread pool.

**Fix**: Wrap the blocking operation in `tokio::task::spawn_blocking`:

```rust
#[tauri::command]
pub async fn write_to_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager.lock().map_err(|e| e.to_string())?;
        mgr.write_to_session(&session_id, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

This requires `AppState` to hold the `SessionManager` behind an `Arc<Mutex<...>>` instead of just `Mutex<...>`, so it can be cloned into the blocking task. Update the `AppState` struct accordingly:

```rust
pub struct AppState {
    pub session_manager: Arc<Mutex<SessionManager>>,
}
```

Apply the same pattern to `close_session` (which also does blocking I/O via `child.kill()` and the new `child.wait()`). `resize_session` is fast enough that this isn't critical, but apply it for consistency.

`create_session` already runs substantial blocking work (PTY spawn), so it should also use `spawn_blocking`.

### Fix 2: Add reader thread shutdown mechanism (I1)

**File**: `src-tauri/src/pty/mod.rs`
**Issue**: Reader threads have no way to be signaled to stop. They linger until the PTY read returns EOF or errors.

**Fix**:
1. Add a `shutdown: Arc<AtomicBool>` field to `ShellSession`
2. Pass a clone of the `Arc<AtomicBool>` to the reader thread
3. In the reader loop, check `shutdown.load(Ordering::Relaxed)` at the top of each iteration. If true, break.
4. In `close_session`, set the flag to `true` before killing the child process.

This doesn't guarantee immediate thread termination (the thread may be blocked in `read()`), but it ensures the thread exits at the next loop iteration after the PTY EOF/error.

### Fix 3: Wait for child process after kill (I2)

**File**: `src-tauri/src/pty/mod.rs` — `close_session` method
**Issue**: `child.kill()` is called but `child.wait()` is not, leaving zombie process handles on Windows.

**Fix**: After `kill()`, call `session.child.wait()`. Use `try_wait()` in a short polling loop if you want to avoid blocking forever:

```rust
session.child.kill().map_err(|e| ...)?;
// Give process a moment to exit
std::thread::sleep(std::time::Duration::from_millis(100));
match session.child.try_wait() {
    Ok(Some(_status)) => {}, // Exited cleanly
    _ => {
        // Force wait — blocking but should be fast after kill
        let _ = session.child.wait();
    }
}
```

Or simply call `session.child.wait()` directly if blocking is acceptable (it should return quickly after `kill()`).

### Fix 4: Use IPC wrapper in Terminal component (I5)

**File**: `src/components/Terminal.tsx`
**Issue**: The component calls `invoke()` directly instead of using the typed wrapper functions from `src/lib/pty.ts`.

**Fix**: Replace all direct `invoke()` calls with the wrapper functions:
```typescript
import { createSession, writeToSession, closeSession } from '../lib/pty';

// Instead of: invoke('create_session', ...)
const sessionId = await createSession();

// Instead of: invoke('write_to_session', ...)
await writeToSession(sessionId, input + '\r');

// Instead of: invoke('close_session', ...)
await closeSession(sessionId);
```

Update the tests if the mock expectations change (they should now mock the wrapper module instead of `invoke` directly, OR the wrapper tests already cover the invoke layer).

### Fix 5: Surface write errors to user (I6)

**File**: `src/components/Terminal.tsx`
**Issue**: Write errors are silently swallowed with `.catch(() => {})`.

**Fix**: Show the error in the output area:
```typescript
writeToSession(sessionId, input + '\r').catch((err) => {
    setOutput(prev => prev + `\n[Write error: ${err}]\n`);
});
```

### Fix 6: Fix `act(...)` warnings in tests (I3)

**File**: `src/__tests__/Terminal.test.tsx`
**Issue**: Async state updates in `useEffect` cause React `act(...)` warnings.

**Fix**: Use `waitFor` from `@testing-library/react` after rendering to let async effects settle:
```typescript
import { render, screen, waitFor } from '@testing-library/react';

test("...", async () => {
    render(<Terminal />);
    await waitFor(() => {
        // Wait for async init to complete
    });
    // Now make assertions
});
```

For tests that check behavior after mount (like `test_creates_session_on_mount`), use `await waitFor(() => expect(invoke).toHaveBeenCalledWith(...))`.

### Fix 7: Clean up compiler warnings (S1)

**File**: `src-tauri/src/pty/mod.rs`
**Issue**: Compiler warnings for unused `id` and `shell_type` fields on `ShellSession`, and unused `get_session_ids` method.

**Fix**: Add `#[allow(dead_code)]` with a comment to each unused item noting it's reserved for future use. Or expose `get_session_ids` via a Tauri command (optional — not required).

## Acceptance Criteria

- [ ] `write_to_session`, `close_session`, and `create_session` use `tokio::task::spawn_blocking`
- [ ] `AppState` uses `Arc<Mutex<SessionManager>>` (clonable into blocking tasks)
- [ ] Reader thread checks `Arc<AtomicBool>` shutdown flag each iteration
- [ ] `close_session` sets shutdown flag and waits for child process exit
- [ ] Terminal component uses IPC wrapper functions (not direct `invoke`)
- [ ] Write errors shown in output area (not silently swallowed)
- [ ] No `act(...)` warnings in test output
- [ ] No compiler warnings (or warnings annotated with `#[allow(dead_code)]`)
- [ ] All existing tests still pass (`npm run test` + `cargo test`)
- [ ] Manual test: app still works — type commands, see output
- [ ] Clean commit: `fix: address code review findings for PTY engine — async safety, resource cleanup, error handling`

## Files to Read First

- `src-tauri/src/commands/mod.rs` — Current Tauri command implementations (C1 fix location)
- `src-tauri/src/pty/mod.rs` — SessionManager and ShellSession (I1, I2, S1 fix location)
- `src/components/Terminal.tsx` — Frontend component (I5, I6 fix location)
- `src/__tests__/Terminal.test.tsx` — Test file (I3 fix location)
- `src/lib/pty.ts` — IPC wrapper functions to use
