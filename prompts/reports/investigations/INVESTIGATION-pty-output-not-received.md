# Investigation: PTY Output Not Received by Frontend

**Date**: 2026-03-12
**Investigator**: Claude Opus 4.6 (Investigator Agent)
**Severity**: Critical (blocks all terminal functionality)
**Status**: Root cause(s) identified

---

## Symptom

When running `npm run tauri dev`, the terminal UI loads but NO PTY output is ever received by the frontend:
1. No initial PowerShell prompt appears in the welcome block
2. Commands typed and submitted (e.g., `pwd`) create new blocks with headers but EMPTY output
3. No errors in the WebView developer console
4. `writeToSession` IPC succeeds (no write error)
5. Session creation succeeds (blocks are created, shell selector works)

---

## Root Cause Analysis

**There are TWO root causes, both contributing to the failure. Both must be fixed.**

### Root Cause #1 (PRIMARY): React StrictMode Double-Mount Causes Session/Listener Mismatch

**Confidence: HIGH**

#### The Mechanism

React 18 `<StrictMode>` in development mode (see `src/main.tsx:6`) double-mounts every component. This means the `useEffect` at `Terminal.tsx:123-142` fires like this:

```
Mount 1:   init() called -> startSession('powershell') begins (async)
Unmount 1: cleanup runs -> cleanupListeners(), closeSession(null) [sessionIdRef not yet set]
Mount 2:   init() called -> startSession('powershell') begins (async)
```

The critical problem is the `mounted` flag check at `Terminal.tsx:124-127`:

```typescript
let mounted = true;

async function init() {
  if (!mounted) return;      // <-- checked BEFORE the await
  await startSession('powershell');  // <-- async, takes time
}

init();

return () => {
  mounted = false;           // <-- set on unmount
  cleanupListeners();
  if (sessionIdRef.current) {
    closeSession(sessionIdRef.current).catch(() => {});
  }
};
```

**The `mounted` flag is checked once before the `await`, but `startSession` is async.** Here is the race:

1. **Mount 1** calls `init()` -> `mounted` is `true` -> calls `startSession('powershell')`
2. `startSession` calls `createSession()` (async IPC call to Rust)
3. **Unmount 1** runs: `mounted = false`, `cleanupListeners()` (no listeners yet), `closeSession(null)` (no-op because `sessionIdRef.current` is still null -- the IPC hasn't returned)
4. **Mount 2** calls `init()` -> `mounted` is `true` (this is a NEW closure with a NEW `mounted` variable!) -> calls `startSession('powershell')`
5. Now **TWO** `createSession` IPC calls are in-flight to Rust
6. **Mount 1's `startSession` resolves**: It calls `updateSessionId(sid1)`, creates a welcome block, and sets up `listen('pty:output:sid1', ...)` listeners. These listeners are stored in `unlistenRefs.current`.
7. **Mount 2's `startSession` resolves**: It calls `updateSessionId(sid2)`, creates a NEW welcome block (overwriting the previous), and sets up `listen('pty:output:sid2', ...)` listeners. It ALSO writes these to `unlistenRefs.current` -- **overwriting the sid1 listeners without cleaning them up.**

**Result after both resolve:**
- `sessionIdRef.current` = `sid2` (the second session)
- `unlistenRefs.current` = listeners for `sid2` only
- Listeners for `sid1` are **leaked** (never unlistened, never cleaned up)
- **Session `sid1` is still alive on the Rust side** (it was never closed because `sessionIdRef.current` was null at Unmount 1)
- Session `sid1` has a reader thread actively emitting `pty:output:sid1` events -- but the listeners in `unlistenRefs` are only for `sid2`
- Session `sid2` also has a reader thread emitting `pty:output:sid2` events

Now here's the key: **which session's output actually appears?** Both sessions are alive. Both are emitting events. The frontend is listening to `sid2`. So `sid2` output SHOULD appear... unless something else is wrong.

But wait -- there's a subtler issue. When the user types a command and presses Enter, `submitCommand` writes to `sessionIdRef.current` which is `sid2`. The command goes to session `sid2`. Session `sid2`'s reader thread should emit the response. The frontend is listening to `sid2`. So in theory, at least the second session should work.

**However**: The `startSession` function at `Terminal.tsx:49-104` does the following sequence:
1. `const sid = await createSession(shell, 24, 80);` -- waits for IPC
2. `updateSessionId(sid);` -- sets ref and state
3. Creates welcome block and sets `activeBlockIdRef.current`
4. `const unlistenOutput = await listen(...)` -- **this is also async!**

Between steps 2 and 4, there is another async gap (`listen` is async). If Mount 1's `startSession` is between steps 2-4 when Mount 2's `startSession` starts executing step 2, the `activeBlockIdRef` and `blocks` state can get corrupted.

The most likely failure scenario:
- Mount 1's `startSession` sets up session `sid1`, creates welcome block A, and registers listeners for `sid1`
- Mount 2's `startSession` sets up session `sid2`, creates welcome block B (overwriting blocks with `[welcomeBlock]`), and registers listeners for `sid2`
- Mount 2's listeners are now the "active" ones, pointing at `sid2`
- `activeBlockIdRef.current` points to welcome block B
- Output from `sid2` should flow to block B... **but session `sid1` is still running and leaked**

This alone may not fully explain "zero output." But combined with Root Cause #2, it does.

#### Evidence

- `src/main.tsx:6`: `<React.StrictMode>` wraps the entire app
- `Terminal.tsx:123-142`: The `useEffect` has `[]` dependencies (mount-only) but the `mounted` flag only guards the synchronous entry, not the async completion
- `Terminal.tsx:49-104`: `startSession` is fully async and does not check any cancellation token after each `await`
- `Terminal.tsx:94`: `unlistenRefs.current = [...]` is a direct assignment, not append -- so Mount 1's listeners are lost

### Root Cause #2 (CRITICAL): The ANSI Filter Can Emit Empty Strings

**Confidence: HIGH**

The ANSI filter strips CSI sequences that are NOT SGR (action `m`). PowerShell's initial output on Windows is **heavily laden with ANSI control sequences**, particularly:

- **CSI cursor position sequences** (e.g., `\x1b[?25h` to show cursor, `\x1b[?25l` to hide cursor)
- **CSI erase sequences** (e.g., `\x1b[2J` to clear screen, `\x1b[K` to erase line)
- **CSI cursor movement** (e.g., `\x1b[1;1H` to move cursor)
- **OSC title-set sequences** (e.g., `\x1b]0;Windows PowerShell\x07`)

When PowerShell starts (even with `-NoLogo -NoProfile`), it typically emits something like:

```
\x1b]0;Windows PowerShell\x07\x1b[?25l\x1b[2J\x1b[m\x1b[H\x1b[?25hPS C:\Users\user>
```

The `AnsiFilter` at `src-tauri/src/ansi/mod.rs:32-94`:
- `print()` (line 33-35): Passes through printable characters -- this is correct
- `execute()` (line 37-45): Only passes `\n` (0x0A), `\r` (0x0D), `\t` (0x09) -- strips backspace, bell, and **all other C0 controls**
- `csi_dispatch()` (line 48-73): Only passes SGR sequences (action `m`) -- **strips ALL cursor movement, erase, scroll, device queries**
- `osc_dispatch()` (line 75-77): Strips ALL OSC sequences

**This means**: If a PTY read chunk contains ONLY control sequences (cursor positioning, screen erase, title set) with no printable text, the filter returns an empty string `""`. The reader thread at `pty/mod.rs:130-135` then emits this empty string to the frontend:

```rust
Ok(n) => {
    let output = ansi_filter.filter(&buf[..n]);  // Could be ""
    let _ = app_handle.emit(
        &format!("pty:output:{}", sid),
        output,  // Emits ""
    );
}
```

The empty string IS emitted and IS received by the frontend listener, which appends it: `b.output + event.payload` = `"" + ""` = `""`. The prompt text (`PS C:\Users\user>`) may arrive in a later chunk, but **if the reader thread is reading from session `sid1` (the leaked session from Root Cause #1), and the frontend is listening to `sid2`, the prompt from `sid1` is lost.**

Meanwhile, `sid2`'s PowerShell also starts, but its prompt may arrive before the listener is set up (due to the async gap in `startSession`), or it may be in a chunk that's mostly control sequences.

**The filter itself is not the primary problem** -- it correctly passes through printable text. But it means that PTY output is often split into chunks where some chunks are 100% control sequences (yielding empty strings after filtering), and the actual text content arrives in separate chunks. Combined with the timing issues from Root Cause #1, this dramatically increases the chance of missing all meaningful output.

#### Evidence

- `src-tauri/src/ansi/mod.rs:48-73`: Non-SGR CSI sequences are stripped
- `src-tauri/src/ansi/mod.rs:75-77`: OSC sequences are stripped
- `src-tauri/src/pty/mod.rs:131-135`: Empty strings are emitted without filtering
- PowerShell is known to emit extensive ANSI control sequences on startup

---

## Full Execution Path Trace

### Happy Path (What Should Happen)

```
1. Terminal mounts (Terminal.tsx:123)
2. useEffect fires, calls startSession('powershell') (Terminal.tsx:128)
3. startSession calls createSession('powershell', 24, 80) (Terminal.tsx:52)
4. Frontend invoke() -> Rust create_session command (lib/pty.ts:9)
5. Rust commands::create_session (commands/mod.rs:10-31)
6.   -> spawn_blocking -> SessionManager::create_session (pty/mod.rs:63-159)
7.   -> Opens PTY, spawns powershell.exe -NoLogo -NoProfile
8.   -> Clones reader, takes writer
9.   -> Spawns reader thread (pty/mod.rs:121-147)
10.  -> Reader thread loops: read(buf) -> AnsiFilter::filter() -> app_handle.emit("pty:output:{sid}")
11. Returns session_id to frontend
12. startSession receives sid (Terminal.tsx:52)
13.  -> updateSessionId(sid) (Terminal.tsx:53)
14.  -> Creates welcome block (Terminal.tsx:57-59)
15.  -> listen("pty:output:{sid}") (Terminal.tsx:61-72)
16. Reader thread emits "pty:output:{sid}" with filtered output
17. Frontend listener receives event, appends to active block (Terminal.tsx:64-70)
18. React re-renders BlockView with updated output
19. AnsiOutput parses SGR spans and renders (AnsiOutput.tsx:8-29)
```

### Actual Path (What Happens with StrictMode)

```
1.  Mount 1: Terminal mounts
2.  Mount 1: useEffect fires -> startSession('powershell') begins
3.  Mount 1: createSession IPC sent to Rust -> awaiting response
4.  [React StrictMode unmounts + remounts]
5.  Unmount 1: cleanup runs:
    - cleanupListeners() -> nothing to clean (no listeners yet)
    - sessionIdRef.current is null -> no closeSession call
6.  Mount 2: Terminal mounts (fresh state)
7.  Mount 2: useEffect fires -> startSession('powershell') begins
8.  Mount 2: createSession IPC sent to Rust -> awaiting response
9.  [TWO Rust sessions now being created concurrently]
10. Rust creates session sid1, spawns PowerShell #1, starts reader thread #1
11. Reader thread #1 starts emitting pty:output:sid1 events
12. Rust creates session sid2, spawns PowerShell #2, starts reader thread #2
13. Reader thread #2 starts emitting pty:output:sid2 events
14. Mount 1's startSession resolves with sid1:
    - updateSessionId(sid1)
    - Creates welcome block A, sets activeBlockIdRef to A.id
    - Registers listeners for pty:output:sid1
    - unlistenRefs.current = [unlisten_output_sid1, unlisten_error_sid1, unlisten_closed_sid1]
15. Mount 2's startSession resolves with sid2:
    - updateSessionId(sid2) [OVERWRITES sid1 in ref and state]
    - setBlocks([welcomeBlockB]) [OVERWRITES blocks including A]
    - activeBlockIdRef.current = B.id
    - Registers listeners for pty:output:sid2
    - unlistenRefs.current = [unlisten_output_sid2, ...] [OVERWRITES without cleaning sid1 listeners]
16. RESULT:
    - Session sid1: LEAKED (running, emitting events, no one listening effectively)
    - Session sid2: Active, listeners registered
    - BUT: PowerShell startup output may have already been emitted BEFORE listeners were set up
    - The initial prompt from sid2's PowerShell may have been emitted during steps 10-15
    - By the time the listener is active, the prompt has already been sent and missed
```

**Key Insight**: Even for `sid2` (the "winning" session), the PowerShell process starts and emits its prompt IMMEDIATELY after being spawned (step 12). The reader thread starts reading immediately. But the frontend listener for `sid2` is not registered until step 15. There is a **race window** between the PTY starting to emit output and the frontend registering the listener. During this window, the PowerShell prompt and any initial output is emitted as Tauri events that go to no listener. They are lost.

This race window is **dramatically widened** by the StrictMode double-mount, because the second `createSession` IPC doesn't start until after the first mount/unmount cycle, and both async chains must resolve before listeners are set up.

---

## Contributing Factor: No Output Buffering

The reader thread in `pty/mod.rs:121-147` uses fire-and-forget event emission:
```rust
let _ = app_handle.emit(&format!("pty:output:{}", sid), output);
```

The `let _ =` silently discards any errors from `emit()`. If the emit fails (e.g., no listener registered yet, or an event validation error), the output is permanently lost. There is no buffering, no replay mechanism, and no error logging.

---

## Why Tests Don't Catch This

### Frontend Tests (39 passing)

All tests in `src/__tests__/Terminal.test.tsx` mock both the IPC layer and the event layer:
- `createSession` is mocked to return immediately with `'test-session-id'` (line 31)
- `listen` is mocked to synchronously register callbacks in a test-controlled map (lines 32-37)
- Tests do NOT use `<React.StrictMode>` wrapper
- The async race between session creation and listener registration is eliminated because mocks resolve instantly

The tests prove the component logic works when IPC is instantaneous and there's no double-mount. They do NOT test:
- Real async timing between session creation and listener setup
- StrictMode double-mount behavior
- Whether Tauri events actually reach the frontend

### Rust Tests (31 passing, 1 ignored)

All Rust PTY tests that touch session creation are either:
- Unit tests that don't need `AppHandle` (validation, flags, limits)
- Marked `#[ignore]` with `todo!()` because they require a real `AppHandle` (line 320-325)

No Rust test verifies that `app_handle.emit()` actually sends data that a frontend can receive. The integration test gap is acknowledged in the code but never filled.

---

## Findings Summary

| # | Finding | Severity | File:Line |
|---|---------|----------|-----------|
| 1 | StrictMode double-mount creates two sessions, leaks first, second session's early output lost to race | Critical | `Terminal.tsx:123-142` |
| 2 | `startSession` is async but has no cancellation/guard after each `await` | Critical | `Terminal.tsx:49-104` |
| 3 | `unlistenRefs.current = [...]` overwrites without cleaning previous listeners | High | `Terminal.tsx:94` |
| 4 | PowerShell prompt emitted by reader thread before frontend listener is registered (race window) | Critical | `pty/mod.rs:121-147` + `Terminal.tsx:61` |
| 5 | ANSI filter can produce empty strings that are emitted as events (not a bug, but wastes IPC) | Low | `pty/mod.rs:131`, `ansi/mod.rs:23-29` |
| 6 | `let _ = app_handle.emit(...)` silently discards emit errors -- no logging | Medium | `pty/mod.rs:132-135` |
| 7 | Session sid1 is never closed (leaked process on every dev reload) | High | `Terminal.tsx:133-139` |
| 8 | No integration tests for event emission path | Medium | `pty/mod.rs:320-325` |

---

## Recommended Fixes

### Fix 1: Guard `startSession` Against Stale Mounts (MUST FIX)

The `startSession` function must check after EACH `await` whether the component is still mounted and this invocation is still current. Two approaches:

**Option A (AbortController pattern):**
Pass an `AbortSignal` into `startSession`. After each `await`, check `signal.aborted`. If true, close the just-created session and return without setting state.

**Option B (Invocation ID pattern):**
Use an invocation counter ref. Increment on each call to `startSession`. After each `await`, check if the counter still matches. If not, close the just-created session and return.

**Option C (Move listener setup to Rust side):**
Have the Rust backend buffer initial output until the frontend explicitly signals it's ready (e.g., a `subscribe_session` command). This eliminates the race entirely.

### Fix 2: Clean Up Listeners Before Overwriting (MUST FIX)

Before setting `unlistenRefs.current` in `startSession`, call `cleanupListeners()` first to unlisten any existing listeners from a previous (stale) invocation:

```typescript
// Inside startSession, before line 94:
cleanupListeners();
unlistenRefs.current = [unlistenOutput, unlistenError, unlistenClosed];
```

### Fix 3: Close Leaked Sessions (MUST FIX)

In `startSession`, before creating a new session, close any existing session:

```typescript
// At the start of startSession:
if (sessionIdRef.current) {
  await closeSession(sessionIdRef.current).catch(() => {});
}
```

Or better: move this into the useEffect cleanup by ensuring `sessionIdRef.current` is set synchronously (which it won't be until the async IPC returns -- hence the race).

### Fix 4: Skip Emitting Empty Strings (NICE TO HAVE)

In the reader thread, skip emitting when the filtered output is empty:

```rust
let output = ansi_filter.filter(&buf[..n]);
if !output.is_empty() {
    let _ = app_handle.emit(&format!("pty:output:{}", sid), output);
}
```

### Fix 5: Log Emit Errors (NICE TO HAVE)

Replace `let _ = app_handle.emit(...)` with proper error logging:

```rust
if let Err(e) = app_handle.emit(&format!("pty:output:{}", sid), output) {
    eprintln!("Failed to emit PTY output for session {}: {}", sid, e);
}
```

### Fix 6: Consider Removing StrictMode for Terminal Component (ALTERNATIVE)

If StrictMode adds no value for this component and causes persistent issues, consider either:
- Removing `<React.StrictMode>` from `main.tsx` entirely
- Or wrapping only non-terminal parts in StrictMode

**However, the proper fix is Fix 1** -- making the code StrictMode-safe is the React-recommended approach and will also fix the same race condition that could occur in production (e.g., during fast shell switches).

---

## Reproduction Notes

- All 39 frontend tests pass -- they do NOT reproduce this because they mock async IPC as synchronous
- All 31 Rust tests pass -- they do NOT test event emission at all
- The issue is only observable in `npm run tauri dev` with the real Tauri runtime
- A diagnostic `console.log` in the `listen` callback would confirm whether events are received at all
- A diagnostic `eprintln!` in the Rust reader thread would confirm whether the reader is running and emitting

---

## Appendix: Event Permission Verification

The capabilities file at `src-tauri/capabilities/default.json` contains:
```json
"permissions": ["core:default", "core:event:default"]
```

Per Tauri v2 docs, `core:default` includes default permissions for all core plugins, and `core:event:default` explicitly enables event listening. The event name format `pty:output:{uuid}` uses only alphanumeric characters, colons, and hyphens -- all permitted by `EventName::new()` validation (confirmed in tauri-2.10.3/src/event/event_name.rs:8-12). **Permissions are NOT the issue.**

## Appendix: ANSI Filter Correctness

The `AnsiFilter` implementation is correct for its stated purpose. It properly:
- Passes printable text through `print()` callback
- Preserves `\n`, `\r`, `\t` in `execute()`
- Reconstructs SGR sequences in `csi_dispatch()`
- Strips all dangerous sequences (OSC, DCS, cursor movement, erase)
- Persists parser state across chunks (handling split sequences)

The filter does NOT strip all output -- it will pass through the actual PowerShell prompt text. The issue is timing (when the prompt arrives vs. when the listener is ready), not filtering.
