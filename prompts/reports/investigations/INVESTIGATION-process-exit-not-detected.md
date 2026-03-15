# Investigation: Process Exit Not Detected After `exit` Command

**Date**: 2026-03-15
**Status**: Root cause identified
**Severity**: High — blocks E2E test `process-lifecycle.spec.ts`

---

## Problem Statement

After typing `exit` in PowerShell, the `[Process exited]` message and `.block-process-exited` div never appear in the DOM. The E2E test (`e2e/process-lifecycle.spec.ts`) fails because `appPage.locator('.block-process-exited')` never becomes visible.

---

## Investigation Results

### 1. Frontend: `closed` State and `.block-process-exited` Rendering

**File**: `src/components/Terminal.tsx` (lines 134-139, 339)

The `closed` state is set to `true` only by the `pty:closed:{sid}` event listener:

```tsx
const unlistenClosed = await listen<void>(
  `pty:closed:${sid}`,
  () => {
    setClosed(true);
  },
);
```

The `.block-process-exited` div is rendered conditionally at line 339:

```tsx
{closed && <div className="block-process-exited">[Process exited]</div>}
```

**Finding**: The frontend code is correct. The class name `.block-process-exited` matches. The `closed` state directly gates rendering. The listener is registered on the correct event name format `pty:closed:${sid}`. No other conditions prevent the div from appearing (it is a sibling of the blocks, not nested inside anything conditional). The only requirement is that the `pty:closed:{sid}` event fires.

### 2. Event Listener Registration

**File**: `src/components/Terminal.tsx` (lines 88-154)

The `startSession` function registers listeners in this order:
1. `pty:output:{sid}` (line 88)
2. `pty:error:{sid}` (line 113)
3. `pty:closed:{sid}` (line 134)
4. Then calls `startReading(sid)` (line 154) to start the reader thread

This ordering is correct. All listeners are registered BEFORE the reader thread starts, so no events can be missed due to a race condition. Each async step also checks the `startSessionIdRef` staleness counter before proceeding.

**Finding**: Listener registration is correct and race-free.

### 3. Tauri Event Permissions

**File**: `src-tauri/capabilities/default.json`

```json
"permissions": [
  "core:default",
  "core:event:default"
]
```

`core:event:default` includes `allow-listen`, `allow-emit`, `allow-emit-to`, and `allow-unlisten`. This is sufficient for the frontend to listen to backend-emitted events.

**Finding**: Permissions are correct.

### 4. Rust Backend: Event Emission Chain

**File**: `src-tauri/src/pty/mod.rs`

The event chain is:

1. **Reader thread** (`spawn_reader_thread`, line 82): reads from PTY pipe in a loop. On `Ok(0)` (EOF) or `Err(e)` (read error), it breaks the loop and sends `PtyEvent::Closed` via the channel (line 119).

2. **Bridge thread** (`spawn_bridge_thread`, line 130): receives events from the channel. On `PtyEvent::Closed`, it emits `pty:closed:{session_id}` via `app_handle.emit()` (line 149) and breaks.

**Finding**: The Rust emission logic is correct — if the reader thread exits its loop, `PtyEvent::Closed` will be sent, and the bridge thread will emit the event to the frontend.

### 5. ROOT CAUSE: ConPTY Does Not Send EOF After `exit`

**File**: `src-tauri/src/pty/mod.rs`, reader thread (line 89)

The reader thread blocks on `reader.read(&mut buf)`. For the `Closed` event to fire, this read must return:
- `Ok(0)` — EOF, meaning the pipe was closed
- `Err(e)` — a read error

**On Windows ConPTY, the read pipe does NOT receive EOF when the shell process exits via `exit`.** This is a well-documented ConPTY behavior:

- [microsoft/terminal#4564](https://github.com/microsoft/terminal/issues/4564): "ConPTY host lingers when all connected clients have been terminated." The PTY host process keeps running and holds the pipe open even after the shell child exits.
- The fix (merged in PR #14544) tracks processes using ConPTY slaves and terminates the ConPTY when all slave-side processes complete, but this fix requires a sufficiently recent Windows version.

**The Rust integration test itself documents this exact problem** in `src-tauri/tests/pty_integration.rs` (line 172-184):

```rust
// On Windows ConPTY, the PTY reader may not receive EOF immediately
// after the shell process exits -- it can take several seconds for the
// ConPTY handle to close. We use a longer timeout and also check
// whether close_session (which kills the child) triggers the Closed event.
let mut events = collect_events(&rx, Duration::from_secs(5));

if !has_closed_event(&events) {
    // The shell may have exited but ConPTY hasn't closed the pipe yet.
    // Force close the session to trigger reader thread termination.
    let _ = manager.close_session(&session_id);
    let more = collect_events(&rx, Duration::from_secs(5));
    events.extend(more);
}
```

The integration test works around the problem by calling `close_session()` as a fallback, which kills the child process and sets the shutdown flag, causing the reader thread to exit.

**However, in the E2E/production path, there is no such fallback.** When the user types `exit`:

1. Frontend sends `exit\r` to the PTY via `writeToSession`
2. PowerShell exits
3. ConPTY keeps the read pipe open (PTY host lingers)
4. Reader thread blocks forever on `reader.read(&mut buf)`
5. `PtyEvent::Closed` is never sent
6. `pty:closed:{sid}` event is never emitted
7. `setClosed(true)` is never called
8. `.block-process-exited` div is never rendered

### 6. The `exit` Command Special-Casing

**File**: `src/components/Terminal.tsx` (lines 251-253)

```tsx
const isExitCommand = trimmedLower === 'exit' || trimmedLower.startsWith('exit ');
const markerSuffix = isExitCommand ? '' : getExitCodeMarker(shellType);
```

When the command is `exit`, the exit-code marker suffix is correctly omitted (since the shell is dying, the marker would never execute). However, this special-casing only affects the marker — it does NOT trigger any `closeSession` call or process monitoring.

**Finding**: The `exit` detection exists but does nothing to handle the ConPTY pipe-not-closing issue.

---

## Summary of Root Cause

**The reader thread in `spawn_reader_thread` blocks on `reader.read()`, waiting for EOF from ConPTY. On Windows, ConPTY does not reliably send EOF when the child process exits via `exit`. There is no child process monitoring or polling mechanism on the Rust side to detect that the shell has exited and force the pipe closed.**

The Rust integration tests worked around this by calling `close_session()` as a fallback, but the production/E2E path has no equivalent mechanism.

---

## Recommended Fixes

### Option A: Child Process Watchdog Thread (Recommended)

Spawn a dedicated watchdog thread alongside the reader thread that polls `child.try_wait()` periodically (e.g., every 200-500ms). When the child process exits:

1. Set the `shutdown` flag to signal the reader thread
2. Drop/close the master PTY handle to unblock the read call
3. The reader thread will then exit its loop and send `PtyEvent::Closed`

This is the most robust solution because it handles all exit scenarios (not just `exit` — also crashes, `Stop-Process`, etc.).

### Option B: Frontend-Initiated Close on `exit` Command

When the frontend detects an `exit` command (the special-casing at line 251 already does this), start a timer. If no `pty:closed` event arrives within N seconds, call `closeSession()` from the frontend to force cleanup.

Pros: Simple. Cons: Only works for explicit `exit` commands, not arbitrary process death.

### Option C: Non-blocking Read with Timeout

Change the reader thread to use non-blocking reads with a timeout (e.g., via `poll` on the pipe handle). On each timeout, check if the child process is still alive via `try_wait()`. If the child has exited, break the loop.

This requires platform-specific code (Windows `WaitForSingleObject` on the pipe handle with timeout, or `SetNamedPipeHandleState` for non-blocking mode).

---

## Relevant Files

| File | Role |
|------|------|
| `src/components/Terminal.tsx` | Frontend: `closed` state, event listener, render |
| `src-tauri/src/pty/mod.rs` | Backend: reader thread, bridge thread, session management |
| `src-tauri/src/commands/mod.rs` | Tauri commands (IPC bridge) |
| `src-tauri/tests/pty_integration.rs` | Integration test (documents the workaround) |
| `e2e/process-lifecycle.spec.ts` | Failing E2E test |
| `src-tauri/capabilities/default.json` | Tauri event permissions |

---

## References

- [ConPTY host lingers when all connected clients have been terminated (microsoft/terminal#4564)](https://github.com/microsoft/terminal/issues/4564)
- [ConPty sometimes hangs when calling ClosePseudoConsole (microsoft/terminal#17716)](https://github.com/microsoft/terminal/discussions/17716)
- [Tauri v2 Core Event Permissions](https://v2.tauri.app/reference/acl/core-permissions/)
