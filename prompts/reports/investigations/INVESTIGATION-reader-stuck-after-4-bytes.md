# Investigation: Reader Thread Stuck After 4-Byte Read

**Date**: 2026-03-12
**Investigator**: Claude Opus 4.6 (Investigator Agent)
**Severity**: Critical (blocks all terminal functionality)
**Status**: Root cause identified with HIGH confidence
**Previous investigations**: `INVESTIGATION-pty-output-not-received.md`, `INVESTIGATION-pty-output-still-missing.md`

---

## Symptom

After applying the lazy reader fix (reader thread starts only after frontend listeners are registered via `start_reading` command), running `npm run tauri dev` shows:

```
[pty:930a7839-7660-40d5-b6e3-c35b4da93766] raw read: 4 bytes
[pty:930a7839-7660-40d5-b6e3-c35b4da93766] filtered: 0 bytes, empty=true
```

Then **NOTHING MORE** -- no further `raw read` lines, no output in the Velocity window, even after the user types `pwd` and presses Enter.

---

## Previous Fixes Validated

The following fixes from prior investigations are confirmed correct:

1. **Invocation counter for StrictMode double-mount** -- Correctly prevents session leaks and listener mismatches.
2. **Lazy reader thread via `start_reading`** -- Correctly eliminates the emit/listen race by deferring reader thread start until after all listeners are registered.
3. **Diagnostic `eprintln!` logging** -- Correctly reveals the reader thread's behavior.
4. **`!is_empty()` guard removed** -- The guard was previously removed per the second investigation. The current code emits ALL filtered output (including empty strings).

---

## Root Cause Analysis

### Root Cause #1 (PRIMARY, CRITICAL): `PSUEDOCONSOLE_INHERIT_CURSOR` Flag Causes ConPTY to Block Waiting for Cursor Position Response

**Confidence: HIGH**
**Files**: `portable-pty-0.9.0/src/win/psuedocon.rs:79-98`, `src-tauri/src/pty/mod.rs:168-207`

#### The Mechanism

The `portable-pty` crate creates the ConPTY pseudoconsole with the following flags at `psuedocon.rs:87-89`:

```rust
PSUEDOCONSOLE_INHERIT_CURSOR
    | PSEUDOCONSOLE_RESIZE_QUIRK
    | PSEUDOCONSOLE_WIN32_INPUT_MODE,
```

The `PSUEDOCONSOLE_INHERIT_CURSOR` flag (value `0x1`) triggers a cursor inheritance protocol. Per the [official Microsoft documentation](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole):

> "If using `PSEUDOCONSOLE_INHERIT_CURSOR`, the calling application should be prepared to respond to the request for the cursor state in an asynchronous fashion on a background thread by forwarding or interpreting the request for cursor information that will be received on `hOutput` and replying on `hInput`. **Failure to do so may cause the calling application to hang** while making another request of the pseudoconsole system."

When ConPTY starts with this flag, the following sequence occurs:

```
1. CreatePseudoConsole() creates the pseudoconsole with INHERIT_CURSOR
2. ConPTY sends a cursor position query (Device Status Report / DSR)
   on the output pipe: ESC [ 6 n  (4 bytes: 0x1B 0x5B 0x36 0x6E)
3. ConPTY BLOCKS waiting for the cursor position response on the input pipe
   Expected response format: ESC [ {row} ; {col} R
4. The hosting application (Velocity) never sends this response
5. ConPTY remains blocked (with a possible 3-second timeout on newer Windows)
6. ALL subsequent console output is suppressed while ConPTY waits
```

#### The 4 Bytes Explained

The 4 bytes read by the reader thread are almost certainly `\x1b[6n` -- the Device Status Report (DSR) escape sequence:

| Byte | Hex | Character | Meaning |
|------|-----|-----------|---------|
| 1 | `0x1B` | ESC | Escape character |
| 2 | `0x5B` | `[` | CSI introducer |
| 3 | `0x36` | `6` | Parameter |
| 4 | `0x6E` | `n` | DSR action |

The ANSI filter processes this as a CSI sequence with action `n`. Since `n` is not `m` (SGR), the filter strips it completely, producing 0 filtered bytes. This matches the diagnostic output exactly: "raw read: 4 bytes" / "filtered: 0 bytes, empty=true".

#### Why the Reader Thread Blocks on the Second Read

After reading the 4-byte DSR query, the reader thread loops back and calls `reader.read(&mut buf)` again. This is a blocking `ReadFile` call on the ConPTY output pipe. Since ConPTY is waiting for the cursor position response on the input pipe (which never comes), ConPTY does not produce any more output. The output pipe has no more data. The `ReadFile` call blocks indefinitely waiting for data that will never arrive.

The [Microsoft Terminal issue #17688](https://github.com/microsoft/terminal/issues/17688) and [discussion #17716](https://github.com/microsoft/terminal/discussions/17716) confirm that `PSUEDOCONSOLE_INHERIT_CURSOR` can cause exactly this kind of blocking/deadlock behavior. A timeout of approximately 3 seconds was added in newer Windows builds (PR #17510), but:
- The timeout may not be present on all Windows versions
- Even with the timeout, 3 seconds of no output is a significant UX problem
- The behavior after timeout may not be fully reliable

#### Why Typed Commands Also Produce No Output

When the user types `pwd\r`, `writeToSession` writes `"pwd\r"` to the PTY's stdin pipe. However:

1. **If ConPTY is still blocked on the cursor query**: The written bytes sit in the stdin pipe buffer. ConPTY is not processing input because its render thread (which also services the console API) is blocked. PowerShell never receives the command.

2. **If the 3-second timeout passed**: ConPTY may have resumed, but PowerShell's initial startup (which was blocked behind the cursor query) may have produced output that was buffered and is now interleaved with post-timeout initialization. The reader may eventually read this, but the user may have already concluded "nothing works" before the timeout expires.

3. **A further deadlock scenario**: If PowerShell's startup produced enough output to fill the ConPTY output pipe buffer BEFORE the reader thread started, AND ConPTY was blocking on the cursor query simultaneously, the system enters a three-way deadlock:
   - ConPTY waits for cursor response on input pipe
   - ConPTY render thread is blocked trying to write to full output pipe
   - Reader thread isn't running yet to drain the output pipe

   When `start_reading` finally starts the reader, it drains the 4-byte cursor query from the pipe. But the render thread may have been holding a lock that prevents further output processing even after the buffer is drained.

#### Evidence

- The symptom matches exactly: 4 bytes read, 0 bytes after filtering, reader blocks forever
- `\x1b[6n` is exactly 4 bytes
- `\x1b[6n` is a CSI with action `n`, stripped by the ANSI filter (producing 0 filtered bytes)
- Microsoft documentation explicitly warns about hanging when `INHERIT_CURSOR` responses are not handled
- `portable-pty-0.9.0/src/win/psuedocon.rs:87` sets `PSUEDOCONSOLE_INHERIT_CURSOR` unconditionally
- Velocity has no code to detect or respond to DSR queries

---

### Root Cause #2 (CONTRIBUTING): Lazy Reader Start Creates a Window Where Output Pipe is Not Being Drained

**Confidence: HIGH**
**Files**: `src-tauri/src/pty/mod.rs:68-134` (create_session), `src-tauri/src/pty/mod.rs:150-210` (start_reading), `src/components/Terminal.tsx:81-142`

#### The Mechanism

The lazy reader pattern was introduced to fix the emit/listen race condition. However, it creates a new problem: between `create_session` (which spawns PowerShell immediately) and `start_reading` (which starts reading from the output pipe), there is a gap during which:

1. PowerShell starts up and produces console output
2. ConPTY translates this to VT sequences and writes to the output pipe
3. **Nobody is reading the output pipe**

The timeline gap includes:
- `createSession` IPC return to frontend (async)
- Frontend creates welcome block and state updates
- Frontend registers 3 event listeners (3 async IPC round-trips)
- Frontend calls `start_reading` (1 more async IPC round-trip)

This gap is estimated at 50-200ms, during which ConPTY output accumulates in the pipe buffer. If the pipe buffer fills (anonymous pipes on Windows default to ~4096 bytes), ConPTY's render thread blocks on the write. Since the render thread holds internal locks, this can cascade into a deadlock that persists even after `start_reading` begins draining the pipe.

Combined with Root Cause #1, this creates a perfect storm:
- ConPTY is trying to write the cursor query to the output pipe
- The output pipe is not being read (no reader thread yet)
- Even if the pipe doesn't fill, the cursor query is the first and only thing emitted before ConPTY blocks waiting for the response

#### Evidence

- The `start_reading` call happens AFTER 4 async IPC round-trips (3 `listen` calls + 1 `startReading` call)
- ConPTY starts producing output immediately when PowerShell spawns
- Only 4 bytes were in the pipe buffer when the reader finally started, suggesting ConPTY wrote the cursor query and immediately blocked

---

### Root Cause #3 (CONTRIBUTING): The `PSEUDOCONSOLE_WIN32_INPUT_MODE` Flag May Cause Input Misinterpretation

**Confidence: MEDIUM**
**Files**: `portable-pty-0.9.0/src/win/psuedocon.rs:89`

The `PSEUDOCONSOLE_WIN32_INPUT_MODE` flag (value `0x4`) changes how ConPTY expects input on the stdin pipe. When this mode is active, ConPTY expects input formatted as [Win32 input mode escape sequences](https://github.com/microsoft/terminal/pull/6309), not plain text.

When Velocity's `writeToSession` sends `"pwd\r"` as raw ASCII bytes, ConPTY may misinterpret them because it expects structured input records. This could explain why commands don't produce output even if the cursor query deadlock is resolved.

However, the [official Microsoft documentation](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) states: "On the input stream, plain text represents standard keyboard keys input by a user." This suggests plain text should still work. The `PSEUDOCONSOLE_WIN32_INPUT_MODE` flag may only affect how the ConPTY emits input mode request sequences, not how it interprets incoming pipe data. This needs empirical verification.

---

## Full Execution Trace

### Expected Flow (Happy Path)

```
Frontend                          Rust                              ConPTY/PowerShell
========                          ====                              =================
createSession('powershell')  -->  create_session()
                                    openpty(24x80)            -->   CreatePseudoConsole(INHERIT_CURSOR|...)
                                    spawn_command(ps.exe)     -->   PowerShell starts
                                    try_clone_reader()
                                    take_writer()
                                    store reader in session
                              <-- return session_id
listen('pty:output:sid')     -->  register listener
listen('pty:error:sid')      -->  register listener
listen('pty:closed:sid')     -->  register listener
startReading(sid)            -->  start_reading()
                                    take reader from session
                                    spawn reader thread
                                    reader.read() blocks     ...   ConPTY writes VT output
                                    read returns N bytes      <--  VT data arrives
                                    filter + emit
```

### Actual Flow (What Happens)

```
Frontend                          Rust                              ConPTY/PowerShell
========                          ====                              =================
createSession('powershell')  -->  create_session()
                                    openpty(24x80)            -->   CreatePseudoConsole(INHERIT_CURSOR|...)
                                    spawn_command(ps.exe)     -->   PowerShell starts
                                    try_clone_reader()
                                    take_writer()
                                    store reader in session
                                                                    ConPTY sends \x1b[6n (cursor query)
                                                                    ConPTY BLOCKS waiting for response
                                                                    PowerShell blocked (ConPTY holding lock)
                              <-- return session_id
listen('pty:output:sid')     -->  register listener
listen('pty:error:sid')      -->  register listener
listen('pty:closed:sid')     -->  register listener
startReading(sid)            -->  start_reading()
                                    take reader from session
                                    spawn reader thread
                                    reader.read() returns     <--  4 bytes (\x1b[6n) from pipe buffer
                                    filter strips to ""
                                    emit "" (or skip if guard active)
                                    reader.read() BLOCKS      ...  ConPTY still waiting for cursor response
                                                                   No more output on pipe
                                                                   PowerShell still blocked
User types "pwd" + Enter
writeToSession("pwd\r")      --> write_to_session()
                                    writer.write_all()        -->  Bytes go to stdin pipe
                                                                   ConPTY may not process (blocked)
                                                                   OR: ConPTY times out, resumes, but
                                                                       startup sequence corrupted
                                    reader.read() still blocking
                                    NOTHING HAPPENS
```

---

## Why Tests Don't Catch This

| Test Suite | Why It Misses This |
|---|---|
| **Frontend tests** (43 passing) | Mock `createSession` and `listen` as synchronous. Never interact with real ConPTY. |
| **Rust unit tests** (34 passing) | Cannot construct `AppHandle` for integration tests. All PTY-touching tests are `#[ignore]`. |
| **ANSI filter tests** | Test with synthetic inputs, not real ConPTY output. No test for `\x1b[6n` DSR query. |
| **No E2E tests** | No Playwright or integration test that exercises the full Tauri + ConPTY pipeline. |

---

## Findings Summary

| # | Finding | Severity | Confidence | File:Line |
|---|---------|----------|------------|-----------|
| 1 | **`PSUEDOCONSOLE_INHERIT_CURSOR` causes ConPTY to block after sending DSR query** -- the 4-byte `\x1b[6n` is the ONLY output before ConPTY hangs waiting for cursor position response that Velocity never sends | Critical | HIGH | `portable-pty:psuedocon.rs:87` |
| 2 | **Lazy reader start means the DSR query sits unread until `start_reading`** -- exacerbates the timing but is not the primary issue | Medium | HIGH | `pty/mod.rs:150-210`, `Terminal.tsx:142` |
| 3 | **`PSEUDOCONSOLE_WIN32_INPUT_MODE` may cause input misinterpretation** -- plain text writes via `writeToSession` may not be processed correctly | Medium | MEDIUM | `portable-pty:psuedocon.rs:89` |
| 4 | **No diagnostic logging on `writeToSession`** -- impossible to confirm whether writes reach PowerShell | Low | HIGH | `pty/mod.rs:212-229` |
| 5 | **ANSI filter strips DSR query silently** -- the cursor query is indistinguishable from any other stripped CSI sequence | Low | HIGH | `ansi/mod.rs:48-73` |

---

## Recommended Fixes

### Fix 1: Respond to the Cursor Position Query (MUST FIX -- addresses Finding #1)

The reader thread (or a separate monitoring mechanism) must detect the `\x1b[6n` DSR query in the ConPTY output and respond with a cursor position report on the input pipe.

**Option A: Detect and respond in the reader thread (RECOMMENDED)**

Before passing raw bytes through the ANSI filter, scan for the DSR query `\x1b[6n`. When detected, write a cursor position response `\x1b[1;1R` (row 1, col 1) to the writer.

```rust
// In the reader thread, before filtering:
if contains_dsr_query(&buf[..n]) {
    // Send cursor position response (row 1, col 1) to the input pipe
    // This requires the reader thread to have access to the writer
    let response = b"\x1b[1;1R";
    // writer.write_all(response)...
}
```

Challenge: The reader thread currently does not have access to the writer. The writer is stored in `ShellSession.writer`. The reader thread only has the reader handle, the `AppHandle`, and the shutdown flag. To implement this, the reader thread would need a clone/reference to the writer, OR a separate channel to send back a "please write this response" message.

**Option B: Use a dedicated cursor response thread**

Spawn a separate short-lived thread that, immediately after `create_session` returns, writes `\x1b[1;1R` to the stdin pipe. This preemptively answers the cursor query even before the reader starts.

```rust
// In create_session, after spawn_command:
let mut cursor_writer = pair.master.take_writer()?; // Wait, writer is already taken...
```

This doesn't work because the writer is already taken. However, `try_clone_reader` clones the read handle -- we could similarly try to clone the write handle. Unfortunately, `take_writer` takes (moves) the writer, so there's no clone available.

**Option C: Write the cursor response before returning from `create_session` (SIMPLEST)**

After spawning the command and taking the writer, immediately write the cursor position response:

```rust
// In create_session, right after take_writer:
let writer = pair.master.take_writer()...;

// Preemptively respond to the INHERIT_CURSOR DSR query
// ConPTY sends \x1b[6n on startup; respond with position (1,1)
writer.write_all(b"\x1b[1;1R").map_err(...)?;
writer.flush().map_err(...)?;
```

This is the simplest fix. The response is written to the stdin pipe before anything else. When ConPTY reads from the input pipe, it finds the cursor position response and unblocks. This works regardless of when `start_reading` is called.

**Potential concern with Option C**: If ConPTY doesn't send the DSR query immediately (e.g., it sends it after some initialization), the cursor response might arrive before the query. ConPTY might interpret it as garbage input. However, per the Microsoft docs, the cursor inheritance query is part of the initial ConPTY startup, so it should be the first thing ConPTY looks for on the input pipe.

**Option D: Remove `PSUEDOCONSOLE_INHERIT_CURSOR` from portable-pty (BEST LONG-TERM)**

The `PSUEDOCONSOLE_INHERIT_CURSOR` flag is intended for terminal multiplexers that are themselves running inside another console. Velocity is a standalone terminal application -- it does not need to inherit cursor position from a parent console. The flag is hardcoded in `portable-pty` and cannot be changed without forking the crate.

Options for removing the flag:
1. Fork `portable-pty` and remove the flag from `psuedocon.rs:87`
2. Submit a PR to `portable-pty` to make the flags configurable
3. Use the `windows-rs` crate to call `CreatePseudoConsole` directly, bypassing `portable-pty`'s fixed flag set
4. Use a newer version of `portable-pty` if one exists that addresses this

Removing the flag eliminates the cursor query entirely. No response needed, no blocking, no deadlock risk. This is the cleanest solution.

### Fix 2: Add Diagnostic Logging to `writeToSession` (SHOULD FIX -- addresses Finding #4)

Add `eprintln!` to confirm writes reach the PTY:

```rust
pub fn write_to_session(&mut self, session_id: &str, data: &str) -> Result<(), String> {
    eprintln!("[pty:{}] write: {} bytes", session_id, data.len());
    let session = self.sessions.get_mut(session_id)...;
    session.writer.write_all(data.as_bytes())...;
    session.writer.flush()...;
    eprintln!("[pty:{}] write complete", session_id);
    Ok(())
}
```

This will confirm whether `writeToSession` is called and whether the write succeeds or blocks.

### Fix 3: Add ANSI Filter Test for DSR Query (SHOULD FIX -- addresses Finding #5)

Add a test to verify that the DSR query is processed (and stripped) correctly:

```rust
#[test]
fn test_dsr_query_stripped() {
    let mut filter = AnsiFilter::new();
    let result = filter.filter(b"\x1b[6n");
    assert_eq!(result, ""); // DSR query is CSI with action 'n', stripped
}

#[test]
fn test_dsr_mixed_with_text() {
    let mut filter = AnsiFilter::new();
    let result = filter.filter(b"\x1b[6nPS C:\\Users>");
    assert_eq!(result, "PS C:\\Users>");
}
```

### Fix 4: Consider the `PSEUDOCONSOLE_WIN32_INPUT_MODE` Implications (SHOULD INVESTIGATE)

Verify empirically whether `writeToSession` with plain text works when `PSEUDOCONSOLE_WIN32_INPUT_MODE` is active. If it doesn't, the write format would need to encode each character as a Win32 input mode escape sequence:

```
ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _
```

This would be a significant change to the write path. However, based on the [Microsoft documentation](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole), plain text on the input stream should still represent keyboard input. The `WIN32_INPUT_MODE` flag primarily affects how ConPTY *requests* input encoding from the hosting terminal, not how it interprets raw pipe bytes.

### Fix 5: Add Raw Byte Logging for Diagnostic Confirmation (NICE TO HAVE)

To confirm the 4 bytes are indeed `\x1b[6n`, add hex dump logging:

```rust
Ok(n) => {
    eprintln!(
        "[pty:{}] raw read: {} bytes: {:02x?}",
        sid, n, &buf[..n.min(64)]
    );
    // ... rest of processing
}
```

This would log something like:
```
[pty:930a...] raw read: 4 bytes: [1b, 5b, 36, 6e]
```

Confirming `1b 5b 36 6e` = `ESC [ 6 n` would validate the root cause with 100% certainty.

---

## Recommended Fix Priority

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| **P0** | Fix 5: Add raw byte hex dump logging to confirm root cause | 5 min | Validates hypothesis |
| **P0** | Fix 1 Option C: Write `\x1b[1;1R` in `create_session` | 10 min | Unblocks ConPTY immediately |
| **P1** | Fix 1 Option D: Fork/patch `portable-pty` to remove `INHERIT_CURSOR` flag | 30 min | Eliminates root cause |
| **P1** | Fix 2: Add write diagnostic logging | 5 min | Aids future debugging |
| **P2** | Fix 3: Add DSR filter test | 5 min | Improves test coverage |
| **P2** | Fix 4: Investigate `WIN32_INPUT_MODE` | 30 min | May fix future input issues |

**Recommended immediate action**: Apply Fix 5 (hex dump) to confirm, then Fix 1 Option C (preemptive cursor response) as the quick unblock, followed by Fix 1 Option D (remove the flag) as the proper long-term solution.

---

## Appendix: portable-pty ConPTY Architecture

```
                    portable-pty internals
                    ======================

    Velocity (writer)          ConPTY (HPCON)           PowerShell
    ================           ==============           ==========

    stdin.write  ---------->   stdin.read (dropped)
         |                         |
         |                    [CreatePseudoConsole]
         |                         |
         +-- writer pipe -------> ConPTY input --------> PS stdin

    stdout.read  <---------   stdout.write (dropped)
         |                         |
         |                    [CreatePseudoConsole]
         |                         |
         +-- reader pipe <------- ConPTY output <------- PS console API
                                                         (via Win32 Console)
```

Key: `stdin.read` and `stdout.write` are consumed by `PsuedoCon::new()` and dropped after `CreatePseudoConsole` duplicates them internally. The reader reads from `stdout.read` (the other end of the output pipe). The writer writes to `stdin.write` (the other end of the input pipe).

## Appendix: ConPTY Flags Used by portable-pty

| Flag | Value | Purpose | Impact on Velocity |
|------|-------|---------|-------------------|
| `PSUEDOCONSOLE_INHERIT_CURSOR` | `0x1` | Inherit cursor position from parent console | **Causes the blocking issue** -- sends DSR query, blocks until response |
| `PSEUDOCONSOLE_RESIZE_QUIRK` | `0x2` | Improved resize behavior | Benign, helps with resize |
| `PSEUDOCONSOLE_WIN32_INPUT_MODE` | `0x4` | Structured keyboard input | May affect how plain text input is processed |

Velocity is a standalone terminal, not a nested terminal. It has no parent console cursor to inherit. The `INHERIT_CURSOR` flag is unnecessary and actively harmful.

## Appendix: All Tests Pass

```
Rust:  34 passed, 0 failed, 1 ignored
Frontend: 43 passed, 0 failed
```

Tests pass because they don't exercise real ConPTY. The `INHERIT_CURSOR` blocking only manifests with a real `CreatePseudoConsole` call on Windows.

## Appendix: Files Analyzed

| File | Purpose |
|------|---------|
| `src-tauri/src/pty/mod.rs` | PTY session manager, reader thread, writer |
| `src-tauri/src/commands/mod.rs` | Tauri IPC command handlers |
| `src-tauri/src/ansi/mod.rs` | ANSI VTE-based filter |
| `src-tauri/src/lib.rs` | Tauri app setup and command registration |
| `src/components/Terminal.tsx` | Terminal component with lazy reader flow |
| `src/lib/pty.ts` | Frontend IPC wrappers for PTY commands |
| `src-tauri/capabilities/default.json` | Tauri capability permissions |
| `src-tauri/Cargo.toml` | Rust dependencies (portable-pty 0.9) |
| `portable-pty-0.9.0/src/win/conpty.rs` | ConPTY master/slave PTY implementation |
| `portable-pty-0.9.0/src/win/psuedocon.rs` | PseudoConsole wrapper (CreatePseudoConsole call) |
| `portable-pty-0.9.0/src/win/mod.rs` | Windows child process management |
| `portable-pty-0.9.0/src/lib.rs` | PTY trait definitions, PtyPair struct |
| `portable-pty-0.9.0/examples/whoami.rs` | Official usage example (drops slave after spawn) |
| `filedescriptor-0.8.3/src/windows.rs` | Windows pipe and file descriptor implementation |

## Appendix: External References

- [CreatePseudoConsole - Microsoft Docs](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)
- [ConPTY hangs with INHERIT_CURSOR - microsoft/terminal #17688](https://github.com/microsoft/terminal/issues/17688)
- [ConPTY INHERIT_CURSOR discussion - microsoft/terminal #17716](https://github.com/microsoft/terminal/discussions/17716)
- [Win32 Input Mode PR - microsoft/terminal #6309](https://github.com/microsoft/terminal/pull/6309)
- [Win32 Input Mode quirks - microsoft/terminal #13239](https://github.com/microsoft/terminal/discussions/13239)
- [ConPTY reader blocks indefinitely - microsoft/terminal #19112](https://github.com/microsoft/terminal/discussions/19112)
- [Taming Win32 Input Mode in ConPTY - DEV Community](https://dev.to/andylbrummer/taming-windows-terminals-win32-input-mode-in-go-conpty-applications-7gg)
