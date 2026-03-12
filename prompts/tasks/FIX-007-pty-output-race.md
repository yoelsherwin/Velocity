# Fix: PTY Output Not Received — StrictMode Double-Mount Race Condition

## Bug Description
Terminal loads but NO PTY output appears. No initial prompt, no command output. Root cause: React StrictMode double-mount creates two concurrent sessions. The `startSession` function is async with no cancellation guard, so both complete and overwrite each other's state/listeners. Initial output is emitted by Rust before the frontend listener is registered (race window).

## Source
Investigation report: `prompts/reports/investigations/INVESTIGATION-pty-output-not-received.md`

## Root Cause
See investigation report for full trace. Summary of 3 interacting issues:

1. **StrictMode double-mount**: Two `startSession` calls run concurrently. First session is never closed (leaked). Second session overwrites listeners without cleaning first session's.
2. **No cancellation in async startSession**: After each `await`, there's no check whether the invocation is still current. A stale mount's `startSession` completes and corrupts state.
3. **Race window**: PowerShell emits its prompt immediately after spawn. The frontend `listen()` is registered only after the async `createSession` IPC returns. Initial output is lost.

## Suggested Fix

Use an **invocation counter** pattern to guard `startSession` against stale mounts:

### Frontend changes (`src/components/Terminal.tsx`)

1. Add an invocation counter ref:
```typescript
const startSessionIdRef = useRef(0);
```

2. In `startSession`, increment the counter at the start and check after each `await`:
```typescript
const startSession = useCallback(async (shell: ShellType) => {
    const thisInvocation = ++startSessionIdRef.current;

    // Close any existing session first
    if (sessionIdRef.current) {
        cleanupListeners();
        await closeSession(sessionIdRef.current).catch(() => {});
        updateSessionId(null);
    }

    try {
        const sid = await createSession(shell, 24, 80);

        // Bail if this invocation was superseded
        if (startSessionIdRef.current !== thisInvocation) {
            closeSession(sid).catch(() => {});
            return;
        }

        updateSessionId(sid);
        setClosed(false);

        const welcomeBlock = createBlock('', shell);
        activeBlockIdRef.current = welcomeBlock.id;
        setBlocks([welcomeBlock]);

        // Clean up any previous listeners before setting new ones
        cleanupListeners();

        const unlistenOutput = await listen<string>(`pty:output:${sid}`, (event) => {
            // ... same handler
        });

        // Check again after each listen await
        if (startSessionIdRef.current !== thisInvocation) {
            unlistenOutput();
            closeSession(sid).catch(() => {});
            return;
        }

        // ... same for error and closed listeners, with staleness check after each

        unlistenRefs.current = [unlistenOutput, unlistenError, unlistenClosed];
    } catch (err) {
        if (startSessionIdRef.current !== thisInvocation) return;
        // ... error handling
    }
}, [updateSessionId, cleanupListeners]);
```

3. Update the mount `useEffect` cleanup to increment the counter (invalidating any in-flight `startSession`):
```typescript
useEffect(() => {
    startSession('powershell');

    return () => {
        startSessionIdRef.current++; // Invalidate in-flight startSession
        cleanupListeners();
        if (sessionIdRef.current) {
            closeSession(sessionIdRef.current).catch(() => {});
        }
    };
}, []);
```

4. Apply the same pattern in `resetAndStart` — increment the counter at the start to cancel any previous in-flight session creation.

### Backend changes (`src-tauri/src/pty/mod.rs`)

5. Skip emitting empty strings in the reader thread:
```rust
let output = ansi_filter.filter(&buf[..n]);
if !output.is_empty() {
    let _ = app_handle.emit(&format!("pty:output:{}", sid), output);
}
```

6. Log emit errors instead of silently discarding:
```rust
if let Err(e) = app_handle.emit(&format!("pty:output:{}", sid), &output) {
    eprintln!("[pty:{}] Failed to emit output: {}", sid, e);
}
```

Apply the same `if !output.is_empty()` and error logging to the `pty:error` and `pty:closed` emit calls.

## Tests

### Existing tests must still pass
All 39 frontend tests and 31 Rust tests must continue to pass.

### New/updated tests
- [ ] **`test_startSession_cancels_on_remount`**: Simulate the double-mount scenario by calling `startSession` twice rapidly. Assert that `closeSession` is called for the first session and only the second session's listeners are active. (This may require adjusting the mock to support async timing.)

## Acceptance Criteria
- [ ] `npm run tauri dev` shows the PowerShell prompt on load
- [ ] Typing `echo hello` and Enter shows "hello" in the block output
- [ ] React.StrictMode is KEPT in `main.tsx`
- [ ] No leaked sessions from double-mount (first session cleaned up)
- [ ] Invocation counter prevents stale `startSession` from corrupting state
- [ ] `cleanupListeners()` called before overwriting `unlistenRefs.current`
- [ ] Existing session closed at the start of `startSession` (prevents leaks)
- [ ] Reader thread skips emitting empty strings
- [ ] Reader thread logs emit errors via `eprintln!`
- [ ] All existing tests pass (`npm run test` + `cargo test`)
- [ ] Clean commit: `fix: prevent StrictMode double-mount from causing session/listener mismatch`

## Files to Read First
- `prompts/reports/investigations/INVESTIGATION-pty-output-not-received.md` — Full root cause analysis
- `src/components/Terminal.tsx` — Main fix location (startSession, useEffect, resetAndStart)
- `src-tauri/src/pty/mod.rs` — Reader thread (empty string skip, error logging)
- `src/main.tsx` — StrictMode wrapper (DO NOT remove)
