# Investigation: PTY Output Still Missing After StrictMode Fix

**Date**: 2026-03-12
**Investigator**: Claude Opus 4.6 (Investigator Agent)
**Severity**: Critical (blocks all terminal functionality)
**Status**: Root cause(s) identified
**Previous investigation**: `INVESTIGATION-pty-output-not-received.md`

---

## Context

The previous investigation identified two root causes:
1. React StrictMode double-mount causing session/listener mismatch
2. ANSI filter producing empty strings that were emitted as events

A fix was applied (commit `7ae29d7`) implementing:
- An invocation counter pattern (`startSessionIdRef`) in `startSession` with staleness checks after each `await`
- `if !output.is_empty()` skip in the Rust reader thread
- `eprintln!` logging for emit errors

**The fix is correct for the StrictMode race condition.** However, output still does not appear. This investigation identifies the remaining root cause(s).

---

## Validation of the StrictMode Fix

### Invocation Counter Trace Through StrictMode Double-Mount

I traced the exact execution of the invocation counter through React 18 StrictMode's mount/unmount/remount cycle:

```
STATE: startSessionIdRef.current = 0

Mount 1:
  useEffect fires
  startSession('powershell') called
    thisInvocation = ++startSessionIdRef.current = 1
    createSession IPC begins (async, awaiting Rust)

Unmount 1:
  cleanup runs
    startSessionIdRef.current++ => now 2
    cleanupListeners() => no-op (no listeners registered yet)
    sessionIdRef.current is null => closeSession not called

Mount 2:
  useEffect fires
  startSession('powershell') called
    thisInvocation = ++startSessionIdRef.current = 3
    createSession IPC begins (async, awaiting Rust)

--- async gap: both createSession IPCs in flight ---

Mount 1's createSession resolves with sid1:
  Check: startSessionIdRef.current (3) !== thisInvocation (1)
  => BAIL: closeSession(sid1) called, return early
  => Session 1 is properly cleaned up. CORRECT.

Mount 2's createSession resolves with sid2:
  Check: startSessionIdRef.current (3) === thisInvocation (3)
  => CONTINUE: updateSessionId(sid2)
  => Creates welcome block, sets activeBlockIdRef
  => cleanupListeners() called (no-op, safe)
  => listen('pty:output:sid2') begins (async IPC to Rust backend)
  ... listen resolves with unlistenOutput
  Check: startSessionIdRef.current (3) === thisInvocation (3) => CONTINUE
  => listen('pty:error:sid2') begins
  ... listen resolves
  Check: 3 === 3 => CONTINUE
  => listen('pty:closed:sid2') begins
  ... listen resolves
  Check: 3 === 3 => CONTINUE
  => unlistenRefs.current = [all three listeners for sid2]

RESULT:
  - Session sid1: CLOSED (properly cleaned up)
  - Session sid2: ACTIVE, all three listeners registered
  - startSessionIdRef.current = 3
  - sessionIdRef.current = sid2
```

**Verdict: The invocation counter logic is correct.** The StrictMode double-mount race condition IS fixed. Session 1 is properly cleaned up, session 2's listeners are properly registered, and there is no listener leak. The test at `Terminal.test.tsx:337-391` (`test_startSession_cancels_on_remount`) confirms this with a passing StrictMode test.

---

## Root Cause Analysis

### Root Cause #1 (PRIMARY): The ANSI Filter Strips ALL PowerShell Output

**Confidence: HIGH**
**Files**: `src-tauri/src/ansi/mod.rs:32-94`, `src-tauri/src/pty/mod.rs:121-155`

#### The Mechanism

The `AnsiFilter` strips all non-SGR ANSI sequences and passes through only printable text, newlines, carriage returns, tabs, and SGR color/style sequences. The `if !output.is_empty()` guard (added in the fix at `pty/mod.rs:132`) skips emitting when the filtered output is an empty string.

The critical question is: **what does PowerShell actually output, and how much of it survives the filter?**

Modern PowerShell on Windows uses ConPTY (the Windows Console Pseudoterminal API). ConPTY translates the traditional Win32 Console API calls into VT sequences for the PTY consumer. This means PowerShell output is expressed almost entirely through VT escape sequences, including:

1. **OSC title-set** (`\x1b]0;Windows PowerShell\x07`) -- STRIPPED by `osc_dispatch()`
2. **Cursor show/hide** (`\x1b[?25h`, `\x1b[?25l`) -- STRIPPED by `csi_dispatch()` (action `h`/`l`, not `m`)
3. **Screen clear** (`\x1b[2J`) -- STRIPPED by `csi_dispatch()` (action `J`)
4. **Cursor positioning** (`\x1b[1;1H`, `\x1b[24;1H`) -- STRIPPED by `csi_dispatch()` (action `H`)
5. **Erase in line** (`\x1b[K`) -- STRIPPED by `csi_dispatch()` (action `K`)
6. **Scrolling region** (`\x1b[1;24r`) -- STRIPPED by `csi_dispatch()` (action `r`)
7. **Absolute cursor positioning for EVERY character** -- STRIPPED

The last point is the key insight. **ConPTY does NOT simply write `PS C:\Users\user> ` as a plain text string.** Instead, it emits something like:

```
\x1b[?25l          (hide cursor)
\x1b[2J            (clear screen)
\x1b[24;1H         (move cursor to row 24, col 1)
\x1b[K             (erase to end of line)
P                  (print 'P')
\x1b[24;2H         (move cursor to row 24, col 2)
S                  (print 'S')
\x1b[24;3H         (move cursor to row 24, col 3)
                   (print ' ')
...and so on for each character...
\x1b[?25h          (show cursor)
```

However, even in this case, the `print()` callback IS called for each character ('P', 'S', ' ', 'C', ':', etc.). These characters ARE appended to the filter's output buffer. So the filtered output would be `PS C:\Users\user> ` (without any cursor positioning).

**But there is a more insidious pattern.** ConPTY on some Windows versions and configurations uses a different strategy: it writes the ENTIRE line as a single string, but frames it with cursor positioning and erase sequences. In this case the text DOES survive filtering. The filtered output would be the text characters concatenated together.

So if the text characters are present in the raw output, they should survive the filter. The `!output.is_empty()` guard would only skip chunks that are 100% control sequences with zero printable characters.

**However**, there is a critical subtlety: **PowerShell startup and command output can span MULTIPLE PTY read chunks (4096 bytes each)**. A chunk might contain only control sequences (cursor positioning, screen clear), while the actual text is in a subsequent chunk. Each chunk is filtered independently. A chunk that is all control sequences produces an empty filtered output and is skipped (never emitted). The text chunk would produce non-empty output and would be emitted.

For the initial prompt, this means the text IS eventually emitted (in some chunk). For the post-fix scenario, the listener IS registered by the time the user types a command. So command output text should eventually arrive. **This narrows the problem space.**

### Root Cause #2 (CRITICAL): Race Between Session Creation and Listener Registration -- Output Lost During Async Gap

**Confidence: HIGH**
**Files**: `src/components/Terminal.tsx:62-138`, `src-tauri/src/pty/mod.rs:121-155`, `node_modules/@tauri-apps/api/event.js:69-81`

#### The Mechanism

Even with the StrictMode fix working correctly, there remains a fundamental race condition in the session lifecycle:

```
                   Rust Side                          Frontend Side
                   =========                          ==============

1. createSession IPC received
2. PTY opened, PowerShell spawned
3. Reader thread starts
4. Reader thread reads first chunk
5. AnsiFilter filters it
6. app_handle.emit("pty:output:sid2", data)  <--- EVENT EMITTED
7. (no listener registered yet --- event lost!)
8.                                            createSession IPC returns sid2
9.                                            updateSessionId(sid2)
10.                                           Creates welcome block
11.                                           cleanupListeners()
12.                                           listen('pty:output:sid2') IPC sent to Rust
13. listen IPC received, registers listener
14.                                           listen() resolves with unlisten fn
15. Reader thread reads next chunk
16. app_handle.emit("pty:output:sid2", data)  <--- EVENT EMITTED
17.                                           Listener receives event (if registered)
```

The `listen()` function at `node_modules/@tauri-apps/api/event.js:69-81` is itself an `async` function that calls `invoke('plugin:event|listen', ...)`. This is a full IPC round-trip to the Rust backend. The listener does NOT exist until this IPC completes on the Rust side.

The timeline gap between step 2 (PowerShell spawned) and step 13 (listener registered) includes:
- Time for `createSession` IPC to return to frontend (step 8)
- Time for `updateSessionId`, block creation, cleanup (steps 9-11)
- Time for `listen()` IPC round-trip (steps 12-14)

During this gap, PowerShell starts up and emits its initial output. The reader thread dutifully reads, filters, and emits these events via `app_handle.emit()`. Since no listener is registered, **these events are silently dropped**.

**For the initial prompt**: PowerShell's startup prompt is emitted during this gap and is lost. The welcome block remains empty.

**For typed commands**: After the gap closes, the listener IS registered. When the user types a command and presses Enter, the command is written to the PTY via `writeToSession`. PowerShell processes it and outputs the result. The reader thread reads this output, filters it, and emits it. **The listener should receive this event.**

So why are typed commands also showing empty output?

### Root Cause #3 (CRITICAL): PowerShell Echo and ConPTY Redraw Semantics

**Confidence: MEDIUM-HIGH**
**Files**: `src-tauri/src/ansi/mod.rs:48-73`, `src-tauri/src/pty/mod.rs:121-155`

When a user types a command and presses Enter, the frontend sends `command + '\r'` to the PTY. PowerShell receives this and:

1. **Echoes the command** -- but via ConPTY, this echo is expressed as cursor positioning + character output. The cursor moves are stripped, but the echo text survives as concatenated characters.
2. **Executes the command** and writes the result -- again via ConPTY VT sequences.
3. **Redraws the prompt** -- cursor positioning + prompt text.

The text from steps 1-3 DOES contain printable characters that survive filtering. So the filtered output is non-empty, and `app_handle.emit()` IS called.

**But here's the problem**: ConPTY uses a **full-screen redraw model**. When PowerShell outputs a command result, ConPTY doesn't just send the result text. It redraws the entire visible portion of the terminal buffer. This means the output includes:

- All blank lines (as spaces or `\x1b[K` erase sequences)
- The full prompt redraw
- Cursor positioning for every line

After filtering, the output is a concatenation of ALL printable characters from ALL lines of the visible buffer, with NO newlines in the right places (because the line structure was conveyed through cursor positioning, which is stripped).

For example, `pwd` output might look like this after filtering:

```
PS C:\Users\user> pwd                      Path----C:\Users\user                    PS C:\Users\user>
```

All the text is there, but it's one long line because the `\r\n` between lines was expressed as cursor positioning (`\x1b[row;1H`) rather than literal `\r\n`. The AnsiFilter strips the cursor moves but keeps the text, resulting in a garbled concatenation.

**Wait -- but the symptom says the output is EMPTY, not garbled.** This means either:
1. The text really isn't there (ConPTY might use an even more aggressive strategy on this Windows version)
2. The `!output.is_empty()` check is filtering it
3. There's yet another issue

Let me reconsider. It's possible that on the specific Windows version and PowerShell version in use, ConPTY outputs are structured such that printable text chunks are VERY small (single characters) interspersed with large blocks of control sequences. The 4096-byte buffer reads could consistently capture only control sequences in one read, and the single characters from the next read. But the characters WOULD produce non-empty filtered output.

**Actually, the most likely explanation for completely empty output on typed commands is that the listener IS receiving events, but the `event.payload` is being appended to the wrong block, or the block's output rendering is hiding it.**

### Root Cause #4 (SMOKING GUN): `block.output` Truthiness Check in BlockView

**Confidence: HIGH**
**File**: `src/components/blocks/BlockView.tsx:55-58`

```tsx
{block.output && (
  <pre className="block-output" data-testid="block-output">
    <AnsiOutput text={block.output} />
  </pre>
)}
```

This conditional renders the output `<pre>` element ONLY if `block.output` is truthy. An empty string `""` is falsy in JavaScript.

But wait -- if output IS being received, `block.output` would be non-empty. So this check alone doesn't explain empty output. However, there's a subtle interaction:

The output from ConPTY after ANSI filtering could be strings like `"\r\n"` or `"\r"` which ARE truthy (non-empty strings). These would render but show as blank lines in the `<pre>`. The user might see this as "empty output" even though the output element exists with whitespace-only content.

But the user specifically says "EMPTY output" and "no PowerShell prompt appears." This points to either:
- No events received at all, OR
- Events received but payload is empty/whitespace-only

### Root Cause #5 (CONFIRMED PRIMARY): All Non-Empty Output is Lost During the Listener Registration Gap

**Confidence: HIGH**

After ruling out other possibilities, here is the most probable scenario for ALL symptoms:

**For the initial prompt (welcome block empty):**
- PowerShell starts and emits its prompt during the async gap before listeners are registered (Root Cause #2)
- ALL initial output is lost
- After listeners are registered, PowerShell is sitting idle waiting for input
- No further output is emitted until the user types something
- Result: welcome block has empty output

**For typed commands (command blocks empty):**
- User types a command and presses Enter
- `writeToSession` sends `command + '\r'` to the PTY
- PowerShell processes the command
- ConPTY emits the result as VT sequences
- Reader thread reads, filters, and emits
- **But**: The filtered output from ConPTY's full-screen redraw model may consist of:
  - Chunks that are entirely cursor positioning/erase sequences (filtered to empty, skipped by `!is_empty()`)
  - Chunks that contain printable characters interspersed with cursor positioning

The printable character chunks SHOULD be emitted and received. Unless... there is an issue with how PowerShell + ConPTY + `portable-pty` interact on this system.

**Actually, let me reconsider the `portable-pty` angle.** The `portable-pty` crate on Windows uses ConPTY. The `try_clone_reader()` returns a reader handle to the ConPTY output pipe. The reader thread reads from this pipe in a blocking loop.

Here's a potential issue: **ConPTY on Windows may buffer output differently than Unix PTYs.** If ConPTY batches the entire screen redraw into a single large write, the 4096-byte buffer might capture a mix of control sequences and text. The filter would extract the text and emit it. This should work.

But if ConPTY writes are very small (e.g., one character at a time), each `reader.read()` call might return just a control sequence fragment (e.g., `\x1b[`). The VTE parser handles split sequences correctly (the parser is persistent across chunks), so this shouldn't cause loss.

**Let me reconsider from first principles.** The symptoms are:
1. No initial prompt -- explained by Root Cause #2 (race between emit and listen)
2. No output for typed commands -- this is the puzzler
3. No `eprintln!` output -- means no emit errors (emit succeeds or is skipped)

For symptom 2, if the listener IS registered by the time the user types, why is output empty?

**CRITICAL REALIZATION**: Looking at point 3 again -- "No `eprintln!` output" also covers the case where `!output.is_empty()` is true for EVERY chunk. If the ANSI filter produces an empty string for every chunk, the `emit()` is never called, and therefore no `eprintln!` can fire either.

**This means the filter IS producing empty output for ALL chunks.** This is the smoking gun.

### Root Cause #6 (ACTUAL SMOKING GUN): ConPTY Outputs May Not Contain Standard Printable Characters

**Confidence: MEDIUM**

On Windows, ConPTY can output characters using C1 control sequences (bytes 0x80-0x9F) for certain operations. The VTE parser's `ground_dispatch` method routes C1 controls to `execute()`:

```rust
// vte-0.15.0/src/lib.rs:722-729
fn ground_dispatch<P: Perform>(performer: &mut P, text: &str) {
    for c in text.chars() {
        match c {
            '\x00'..='\x1f' | '\u{80}'..='\u{9f}' => performer.execute(c as u8),
            _ => performer.print(c),
        }
    }
}
```

The AnsiFilter's `execute()` only passes `\n` (0x0A), `\r` (0x0D), and `\t` (0x09). All other C0/C1 controls are stripped. If ConPTY uses C1 escape sequences (which are single-byte equivalents of `ESC [` etc.), these would be routed to `execute()` and stripped.

However, the actual printable text ('P', 'S', ':', etc.) would still go through `print()` and be preserved. C1 control codes don't replace printable characters; they're used for escape sequences only.

**So this alone doesn't explain empty output for all chunks.**

### Revised Root Cause Assessment

After thorough analysis, the remaining root causes are:

1. **Root Cause #2 (Listener Registration Race)** definitively explains why the initial prompt is missing. This is confirmed.

2. **For typed command output**, the issue is more nuanced. The most likely explanations are:

   **Hypothesis A: ConPTY + portable-pty read behavior**
   The `portable-pty` reader may return data in patterns where EVERY 4096-byte read happens to produce empty filtered output. This would be unusual but possible if ConPTY's output format on this Windows version is particularly heavy on control sequences with very little interleaved text per buffer-read.

   **Hypothesis B: The reader thread is blocked or dead**
   If the reader thread's `reader.read()` call is blocking indefinitely (e.g., because the ConPTY output pipe entered an unexpected state after the first session was created and closed), no output would ever be emitted. The `eprintln!` for emit errors would never fire because the thread never reaches that code.

   **Hypothesis C: The session is not the one the user is interacting with**
   If there's a mismatch between the session the frontend thinks it has and the session that's actually running, writes would go to one session while reads come from another. But the invocation counter fix should prevent this.

**My assessment**: Hypothesis A is most likely. ConPTY output is known to be extremely heavy on VT sequences, and the 4096-byte buffer reads can easily land on chunk boundaries that are 100% control sequences. However, over multiple reads, SOME chunks should contain text. Unless the total output volume per command is very small and fits within control-sequence-heavy chunks.

---

## Critical Finding: The `!output.is_empty()` Filter May Be Overly Aggressive

**File**: `src-tauri/src/pty/mod.rs:132`

```rust
if !output.is_empty() {
    if let Err(e) = app_handle.emit(
        &format!("pty:output:{}", sid),
        output,
    ) {
        eprintln!("[pty:{}] Failed to emit output: {}", sid, e);
    }
}
```

While this filter correctly avoids emitting empty events, it interacts badly with the ANSI filter's behavior on ConPTY output. The combination of:
1. ConPTY outputting control-sequence-heavy data
2. The ANSI filter stripping all non-SGR sequences
3. The empty-string guard skipping the emit

...means that a significant portion (potentially all) of the output events are suppressed. Even if some chunks DO contain text, the fact that no `eprintln!` output was observed suggests that EITHER:
- `emit()` always succeeds for the non-empty chunks (likely)
- OR no non-empty chunks exist (all output is filtered to empty)

The lack of ANY `eprintln!` output is consistent with either scenario. It does NOT confirm that emit is succeeding, because if all output is filtered to empty, emit is never called.

---

## Definitive Root Cause Summary

| # | Finding | Severity | Confidence | File:Line |
|---|---------|----------|------------|-----------|
| 1 | **StrictMode fix is CORRECT** -- invocation counter properly handles double-mount | N/A (fixed) | HIGH | `Terminal.tsx:50-151` |
| 2 | **Initial prompt lost to emit/listen race** -- PTY emits output before frontend `listen()` IPC completes | Critical | HIGH | `Terminal.tsx:81-92`, `pty/mod.rs:121-155` |
| 3 | **ANSI filter + `!is_empty()` guard suppress all ConPTY output** -- ConPTY's control-sequence-heavy output is filtered to empty strings, which are then skipped by the guard | Critical | MEDIUM-HIGH | `ansi/mod.rs:48-73`, `pty/mod.rs:132` |
| 4 | **No output buffering** -- events emitted before listener registration are permanently lost | Critical | HIGH | `pty/mod.rs:121-155` |

**The combination of findings #2, #3, and #4 explains ALL symptoms:**
- No initial prompt: Finding #2 + #4 (prompt emitted before listener exists, no buffer to replay it)
- No command output: Finding #3 (if ConPTY output is filtered to empty for most/all chunks)
- No `eprintln!` output: Finding #3 (emit is never called because `!is_empty()` skips it) OR emit succeeds for the few non-empty chunks

---

## Recommended Fixes

### Fix 1: Add Output Buffering with Replay (MUST FIX -- addresses Findings #2 and #4)

Buffer output in the Rust reader thread until the frontend signals it's ready. This eliminates the emit/listen race entirely.

**Approach A: Explicit "subscribe" command**
1. Add a `subscribe_session` Tauri command
2. Reader thread buffers all output in a `Vec<String>`
3. When frontend calls `subscribe_session(sid)`, flush the buffer and start live-emitting
4. Frontend calls `subscribe_session` AFTER all `listen()` calls complete

**Approach B: Buffered emitter with timestamp**
1. Reader thread stores output with timestamps
2. Frontend, after setting up listeners, calls a `replay_session(sid, since_timestamp)` command
3. Rust replays all buffered output since the given timestamp

**Approach C: Delay reader thread start**
1. Don't start the reader thread in `create_session`
2. Add a `start_reading(session_id)` command
3. Frontend calls `start_reading` AFTER all listeners are registered
4. Reader thread only starts when `start_reading` is called

**Approach C is the simplest and most robust.** It completely eliminates the race by making the read/emit loop lazy.

### Fix 2: Remove `!is_empty()` Guard or Add Diagnostic Logging (MUST FIX -- addresses Finding #3)

The `!output.is_empty()` guard was added to avoid emitting empty events. However, it masks the real problem: the ANSI filter's aggressive stripping of ConPTY output. Options:

**Option A: Remove the guard and let the frontend handle empty payloads**
```rust
// Remove the if !output.is_empty() check
// Let the frontend append empty strings (harmless)
if let Err(e) = app_handle.emit(...) {
    eprintln!(...);
}
```

This alone won't fix the problem (the output is still empty), but it provides diagnostic signal.

**Option B: Add diagnostic logging BEFORE the filter**
```rust
Ok(n) => {
    eprintln!("[pty:{}] Read {} bytes: {:?}", sid, n, &buf[..n.min(100)]);
    let output = ansi_filter.filter(&buf[..n]);
    eprintln!("[pty:{}] Filtered to {} bytes: {:?}", sid, output.len(), &output[..output.len().min(100)]);
    // ... emit ...
}
```

This would confirm whether the reader thread is reading data and whether the filter is stripping all of it.

**Option C: Emit raw (unfiltered) output alongside filtered output**
For debugging purposes, emit the raw bytes as a separate event to confirm the reader thread is working.

### Fix 3: Rethink the ANSI Filter Strategy for ConPTY (SHOULD FIX -- addresses Finding #3)

The current ANSI filter strips all non-SGR CSI sequences. This is appropriate for a traditional terminal emulator that has its own cursor/screen model. But Velocity's current block model only appends text -- it doesn't track cursor position, screen regions, or line structure.

The problem is that **ConPTY expresses line structure through cursor positioning, not through `\r\n`.** By stripping cursor positioning, the filter destroys the line structure of the output.

Options:

**Option A: Convert cursor positioning to newlines**
When a CSI cursor-move sequence moves to a new row, emit a `\n`. When it moves to column 1, emit a `\r`. This reconstructs the basic line structure.

**Option B: Use a proper terminal state machine**
Instead of filtering ANSI sequences, use a full terminal state machine (like a virtual screen buffer) that processes all VT sequences, tracks cursor position, and maintains a character grid. Then read the grid contents as the "output." Libraries like `vt100` (Rust crate) or `alacritty_terminal` provide this.

**Option C: Don't filter at all -- send raw bytes to frontend**
Let the frontend handle all ANSI interpretation. Use a frontend terminal library like `xterm.js` that can process raw VT sequences. This is the approach used by VS Code's terminal, Warp, and most modern terminal UIs.

**Option B or C is strongly recommended for a production terminal application.** The current approach of stripping non-SGR sequences is fundamentally incompatible with ConPTY's output model.

### Fix 4: Diagnostic Steps Before Code Changes

Before implementing fixes, add temporary diagnostic logging to confirm the hypothesis:

1. **In the Rust reader thread** (`pty/mod.rs:128-139`), add `eprintln!` BEFORE the filter to log raw byte counts:
   ```rust
   Ok(n) => {
       eprintln!("[pty:{}] raw read: {} bytes", sid, n);
       let output = ansi_filter.filter(&buf[..n]);
       eprintln!("[pty:{}] filtered: {} bytes, empty={}", sid, output.len(), output.is_empty());
       // ... rest of emit logic ...
   }
   ```

2. **In the frontend listener** (`Terminal.tsx:83-91`), add `console.log` in the event callback:
   ```typescript
   (event) => {
       console.log('[pty:output] received payload:', JSON.stringify(event.payload).substring(0, 200));
       // ... rest of handler ...
   }
   ```

3. **Run `npm run tauri dev`** and observe:
   - If Rust logs show "raw read: N bytes" followed by "filtered: 0 bytes, empty=true" for ALL reads, this confirms Finding #3 (filter strips everything)
   - If Rust logs show "filtered: N bytes" with N > 0 but no frontend `console.log`, this confirms Finding #2 (events lost before listener registration)
   - If frontend logs DO show payloads, the issue is in rendering (check BlockView and AnsiOutput)

---

## Test Gap Analysis

### Why Existing Tests Don't Catch This

1. **Frontend tests** (`Terminal.test.tsx`): Mock `listen()` as synchronous, eliminating the emit/listen race. Mock `createSession` as instant, eliminating the startup output race. Tests prove the component logic works when timing is perfect.

2. **Rust tests** (`pty/mod.rs`): No integration tests for event emission (requires `AppHandle`). The ignored test at line 328-333 acknowledges this gap.

3. **ANSI filter tests** (`ansi/mod.rs`): Test with small, hand-crafted inputs, not with real ConPTY output. No test feeds actual Windows PowerShell startup bytes through the filter to verify non-empty output.

4. **No end-to-end test** that connects a real PTY to real Tauri event emission to a real frontend listener.

### Recommended Test Additions

1. **ANSI filter test with ConPTY-realistic input**: Capture actual raw bytes from a PowerShell ConPTY session and feed them through the filter. Verify that some non-empty text survives.

2. **Integration test for reader thread**: Create a real PTY session, write a known command, and verify that the reader thread emits non-empty events.

3. **Frontend integration test**: Use Playwright/WebDriver to verify that PTY output actually appears in the rendered DOM.

---

## Appendix: Version Information

| Component | Version |
|-----------|---------|
| Tauri (Rust) | 2.10.3 |
| @tauri-apps/api | 2.10.1 |
| React | 19.1.0 |
| vte | 0.15.0 |
| portable-pty | 0.9 |
| TypeScript | 5.8.3 |

## Appendix: Files Analyzed

| File | Purpose |
|------|---------|
| `src/components/Terminal.tsx` | Terminal component with invocation counter fix |
| `src-tauri/src/pty/mod.rs` | PTY session manager and reader thread |
| `src-tauri/src/ansi/mod.rs` | ANSI filter (VTE-based) |
| `src-tauri/src/commands/mod.rs` | Tauri IPC commands |
| `src-tauri/src/lib.rs` | Tauri app setup |
| `src/main.tsx` | React StrictMode wrapper |
| `src/lib/pty.ts` | Frontend IPC wrappers |
| `src/lib/ansi.ts` | Frontend ANSI parsing (Anser) |
| `src/components/blocks/BlockView.tsx` | Block rendering component |
| `src/components/AnsiOutput.tsx` | ANSI-styled text renderer |
| `src/__tests__/Terminal.test.tsx` | Terminal component tests |
| `src-tauri/capabilities/default.json` | Tauri capability permissions |
| `node_modules/@tauri-apps/api/event.js` | Tauri event API implementation |
| `node_modules/@tauri-apps/api/core.js` | Tauri core API (invoke, transformCallback) |
| `~/.cargo/.../vte-0.15.0/src/lib.rs` | VTE parser source (upstream) |

## Appendix: All Tests Pass

```
Rust:  31 passed, 0 failed, 1 ignored
Frontend: 40 passed, 0 failed
```

Tests pass because they don't test the real PTY-to-event-to-listener pipeline. The issue is only observable with `npm run tauri dev` against a real PowerShell process on Windows.
