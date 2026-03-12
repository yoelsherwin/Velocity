# Security Review -- TASK-004: Process Lifecycle + Shell Selection + Input Validation (R1)

## Scope

- **Commit range**: `cc00770..4953590`
- **Tasks covered**: TASK-004 (process lifecycle, shell selection, input validation), FIX-004 (code review fixes -- session ref, ARIA, type safety)
- **HEAD at time of review**: `4953590`
- **Commits in range**:
  - `de93326` update flow and state
  - `85c34dd` feat: add shell selection, restart support, and input validation
  - `4953590` fix: address code review findings for lifecycle -- session ref, ARIA, type safety

## Previous Review Status

- **R1 ANSI filter (`cc00770`)**: M-1 (color string validation) still open. M-2 (`unsafe-inline` in `style-src`) still open. L-1 (no DCS test) still open. L-2 (no APC test) still open. L-3 (bracketed paste test) still open. L-4 (`Ordering::Relaxed`) still open. L-5 (session ID format) still open.

## Attack Surface Map

### Changes in This Commit Range

1. **Modified: Rust PTY module** (`src-tauri/src/pty/mod.rs:13-21`): New `validate_dimensions(rows, cols)` function enforcing 1-500 range for both parameters. Called at entry of `create_session` (line 70) and `resize_session` (line 182).

2. **Modified: Terminal component** (`src/components/Terminal.tsx`): Major refactor:
   - Shell selector UI with three buttons (PowerShell, CMD, WSL) rendered from `SHELL_TYPES` constant
   - `sessionIdRef` (`useRef`) introduced alongside the existing `sessionId` state to prevent stale closure bugs
   - `unlistenRefs` (`useRef`) stores event listener cleanup functions
   - `resetAndStart()` shared function for shell switching and restart -- closes old session, cleans up listeners, clears state, starts new session
   - Restart button appears when `closed === true`, replacing the input field
   - Shell switching calls `resetAndStart()` with the new shell type

3. **Modified: TypeScript types** (`src/lib/types.ts`): `SHELL_TYPES` constant array and `ShellType` union type added. `SessionInfo.shellType` narrowed from `string` to `ShellType`.

4. **Modified: IPC wrapper** (`src/lib/pty.ts`): `createSession` parameter narrowed from `string` to `ShellType`.

5. **Modified: CSS** (`src/App.css`): New styles for `.shell-selector`, `.shell-btn`, `.shell-btn-active`, `.terminal-restart-row`, `.restart-btn`. Pure visual, no security impact.

6. **No new IPC commands added.** No changes to `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, or `src-tauri/capabilities/default.json`.

7. **No dependency changes.** `Cargo.toml` and `package.json` dependencies unchanged from previous review HEAD.

---

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1: Race condition in shell switching -- rapid clicks can leak sessions**

- **Vector**: Process Lifecycle Abuse (#6), Denial of Service (#9)
- **Location**: `src/components/Terminal.tsx:79-92` (`resetAndStart`), `src/components/Terminal.tsx:122-129` (`handleShellSwitch`)
- **Description**: The `handleShellSwitch` function has a guard (`if (newShell === shellType && !closed) return`) that checks the React state `shellType` and `closed`. However, `resetAndStart` is an async function. If a user rapidly clicks shell buttons (e.g., PowerShell -> CMD -> WSL in quick succession), the following sequence can occur:

  1. Click CMD: `handleShellSwitch('cmd')` starts executing. `shellType` is still `'powershell'`, so the guard passes. `setShellType('cmd')` is called (React schedules a state update). `resetAndStart('cmd')` begins -- closes session-1, starts creating session-2.
  2. Before `resetAndStart('cmd')` resolves, click WSL: `handleShellSwitch('wsl')` fires. Because React state updates are asynchronous, `shellType` may still be `'powershell'` (or may have updated to `'cmd'` -- depends on batching). Either way, the guard does not prevent re-entry. `setShellType('wsl')` is called. `resetAndStart('wsl')` begins.
  3. Now `resetAndStart('wsl')` reads `sessionIdRef.current`. If the first `resetAndStart('cmd')` has already called `updateSessionId(null)` (line 88) but not yet completed `startSession`, the ref is `null`, so the second call skips `closeSession`. But the first call's `startSession('cmd')` is still in progress.
  4. When the first `startSession('cmd')` completes, it sets `sessionIdRef.current` to session-2. But the component has already moved on to session-3 (WSL). Session-2 is now orphaned -- never closed, still running a reader thread, still consuming a slot in `SessionManager`.

  Over time, repeated rapid switching can exhaust the 20-session limit (`MAX_SESSIONS`), effectively creating a client-side DoS. The `MAX_SESSIONS` cap on the Rust side prevents unbounded process spawning, limiting this to 20 orphaned processes at most.

- **Exploit Scenario**: A user (or automated test/script) rapidly toggles shell types in a loop. After 20 orphaned sessions accumulate, all subsequent `createSession` calls fail with "Maximum session limit (20) reached". The terminal becomes non-functional until the application is restarted.

- **Recommended Fix**: Add a `switchingRef` guard (`useRef<boolean>`) that prevents re-entry into `resetAndStart` while an operation is in progress. Alternatively, use an `AbortController`-style pattern or disable shell buttons while switching is in progress (simplest approach -- set a `switching` state and disable buttons).

- **Severity Justification**: Medium. Requires deliberate rapid clicking. The `MAX_SESSIONS = 20` cap prevents escalation beyond 20 orphaned processes. Self-inflicted DoS only (not remotely exploitable).

**M-2: Stale event listeners can fire after session replacement**

- **Vector**: Cross-Session Data Leakage (#10)
- **Location**: `src/components/Terminal.tsx:79-92` (`resetAndStart`)
- **Description**: In `resetAndStart`, the operations execute in this order:
  1. `closeSession(sessionIdRef.current)` -- tells Rust to close the session
  2. `cleanupListeners()` -- removes event listeners
  3. `startSession(shell)` -- creates a new session and registers new listeners

  Between step 1 and step 2, there is a window where the old event listeners are still active. The `closeSession` IPC call is async (awaited), and during that await, if the reader thread emits a final `pty:output` or `pty:error` event before it fully shuts down, the old listeners will fire and append output to the state.

  This output is from the *old* session (session being closed), but it will be appended to the React `output` state. Immediately after, `setOutput('')` (line 85) clears the output. So in practice, the stale output is quickly overwritten. However, there is a visual flicker possibility, and the output buffer temporarily contains data from a different session.

  The real concern is if `cleanupListeners()` has *not* been called before `startSession(shell)` (line 89). Looking at the code, `cleanupListeners()` is called synchronously at line 84, after the `closeSession` await. So by the time `startSession` runs, old listeners are cleaned up. The window for stale events is only during the `closeSession` await.

- **Exploit Scenario**: A long-running command in session-1 produces high-volume output. User switches shells. During the `closeSession` IPC round-trip, session-1's reader thread emits several more output events. These are processed by the still-active `pty:output:session-1` listener and appended to the output state. Then `setOutput('')` clears it. If an attacker controls the output of session-1 (e.g., via a malicious program), they could try to flash misleading content in the UI during the transition. However, this is a visual flicker of <100ms and is immediately cleared.

- **Recommended Fix**: Call `cleanupListeners()` *before* `closeSession()` in `resetAndStart`. This ensures no stale events are processed during the close IPC call. The order should be: (1) cleanup listeners, (2) close session, (3) clear state, (4) start new session.

- **Severity Justification**: Medium. Cross-session data bleed is architecturally concerning even though the practical impact is minimal (transient visual flicker of old output). The fix is a one-line reorder.

### LOW

**L-1: Shell selector buttons not disabled during active switch operation**

- **Vector**: Denial of Service (#9)
- **Location**: `src/components/Terminal.tsx:149-161`
- **Description**: The shell selector buttons have no `disabled` state during an active shell switch or restart operation. While the guard in `handleShellSwitch` prevents switching to the same shell when the session is active, it does not prevent rapid switching between different shells (see M-1). Disabling buttons during the async operation would be the most user-visible mitigation for M-1.
- **Recommended Fix**: Add a `switching` state that is set to `true` at the start of `resetAndStart` and `false` at the end. Pass `disabled={switching}` to all shell buttons.
- **Severity Justification**: Low. UX improvement that also mitigates M-1. Not a standalone vulnerability.

**L-2: `mounted` flag in useEffect not checked before `startSession` completion**

- **Vector**: Resource Leak (#6)
- **Location**: `src/components/Terminal.tsx:95-114`
- **Description**: The initialization `useEffect` checks `mounted` before calling `startSession`, but `startSession` is async. If the component unmounts during the `createSession` IPC call inside `startSession`, the `mounted` flag is set to `false` and the cleanup function calls `cleanupListeners()` and `closeSession(sessionIdRef.current)`. However, `sessionIdRef.current` is still `null` at this point (it's only set *after* `createSession` resolves), so `closeSession` is not called. Meanwhile, `startSession` continues in the background. When `createSession` resolves, `updateSessionId(sid)` is called on the unmounted component (setting the ref and calling `setSessionId`). The `setSessionId` call on an unmounted component is harmless in React 19 (no warning), but the session is now created on the Rust side with no cleanup path.

  In practice, this is unlikely -- it requires the component to unmount during the ~10-50ms `createSession` IPC round-trip. The orphaned Rust session will be cleaned up when the application exits (process termination). But it is a resource leak in the strict sense.

- **Recommended Fix**: Check `mounted` flag inside `startSession` after the `createSession` await. If unmounted, call `closeSession(sid)` immediately and return without registering listeners.
- **Severity Justification**: Low. Extremely narrow race window. Single orphaned session at most. Cleaned up on app exit.

**L-3: `Ordering::Relaxed` on shutdown flag (carried from R2, R3)**

- **Vector**: Process Lifecycle Abuse (#6)
- **Location**: `src-tauri/src/pty/mod.rs:125,209`
- **Description**: Still using `Ordering::Relaxed`. Unchanged from previous reviews. Not a vulnerability on x86 Windows.
- **Severity Justification**: Low. Unchanged.

**L-4: Session ID format not validated (carried from R2, R3)**

- **Vector**: IPC Command Abuse (#2)
- **Location**: `src-tauri/src/commands/mod.rs:37,55,63,81`
- **Description**: The `session_id` parameter in `write_to_session`, `resize_session`, and `close_session` commands accepts any string. A compromised WebView could send arbitrary session ID strings. The HashMap lookup will return "not found" for invalid IDs, so there is no crash risk. But a UUID format check would add defense-in-depth.
- **Severity Justification**: Low. Unchanged.

**L-5: `unsafe-inline` in `style-src` CSP (carried from R2, R3)**

- **Vector**: Defense-in-depth
- **Location**: `src-tauri/tauri.conf.json:23`
- **Description**: Unchanged. `style-src 'self' 'unsafe-inline'`. Still accepted risk.
- **Severity Justification**: Low. Unchanged.

---

## Detailed Audit by Attack Vector

### 1. Command Injection -- PASS

No changes affect command construction. Shell types remain validated by the Rust-side allowlist (`"powershell"`, `"cmd"`, `"wsl"`). The TypeScript `ShellType` union type adds a compile-time constraint, but the Rust `validate_shell_type()` remains the authoritative security boundary. User input still flows through the PTY writer as raw bytes -- not interpolated into shell commands.

The `createSession` IPC wrapper now accepts `ShellType` instead of `string` (`src/lib/pty.ts:4`). This is a defense-in-depth improvement at the TypeScript layer. A compromised WebView could still call `invoke('create_session', { shell_type: 'arbitrary' })` directly, bypassing the TypeScript type. The Rust `validate_shell_type` function correctly rejects this.

### 2. IPC Command Abuse -- PASS

- No new IPC commands added.
- No changes to `capabilities/default.json`. Permissions remain minimal: `core:default`, `core:event:default`.
- Dimension validation (`validate_dimensions`) added to both `create_session` and `resize_session`. A compromised WebView sending `rows: 0` or `cols: 65535` is now rejected at the Rust boundary.
- The `validate_dimensions` function uses `u16` parameters, which means the Tauri deserialization layer handles overflow. If the frontend sends `rows: 70000`, Tauri's serde deserialization will either truncate or reject it (serde rejects out-of-range integers for `u16`). Values within `u16` range (0-65535) are then checked by `validate_dimensions`. This is correct.

### 3. Terminal Escape Injection -- N/A

No changes to the ANSI filter or rendering pipeline in this commit range.

### 4. Path Traversal -- N/A

No file path handling in this commit range.

### 5. Environment Variable Leakage -- N/A

No changes. Accepted risk from previous reviews.

### 6. Process Lifecycle Abuse -- IMPROVED (with caveats)

**Improvements:**
- Dimension validation prevents PTY layer issues from extreme values (0 rows/cols could cause undefined behavior in `portable-pty`).
- `sessionIdRef` pattern prevents stale closure bugs where the cleanup function captured a stale `sessionId` value.
- `resetAndStart` consolidates session teardown and creation into a single function, reducing duplication-related bugs.
- Restart functionality properly calls `closeSession` before `createSession`.

**Caveats:**
- Race condition in rapid shell switching can orphan sessions (M-1).
- Stale listeners can fire during session transition (M-2).
- Mount/unmount race can orphan a session (L-2).

### 7. LLM Prompt Injection -- N/A

Agent Mode not yet implemented.

### 8. Clipboard Injection -- N/A

No clipboard handling in this commit range.

### 9. Denial of Service -- IMPROVED (with caveats)

**Improvements:**
- Dimension validation (1-500) prevents `create_session` and `resize_session` with pathological values.
- Test coverage for boundary values: 0, 1, 500, 501.

**Caveats:**
- Rapid shell switching can exhaust `MAX_SESSIONS` (M-1). Bounded at 20 by the Rust-side cap.

### 10. Cross-Pane Leakage -- PASS (with caveat)

No multi-pane architecture yet. Single terminal component. The stale listener issue (M-2) represents a cross-*session* data bleed within the same pane during transitions, not cross-pane leakage.

---

## Tauri Configuration Review

| Check | Status | Notes |
|-------|--------|-------|
| Command permissions are minimal | PASS | `core:default`, `core:event:default` only. Unchanged. |
| No overly broad file system access | PASS | No `fs:` permissions |
| CSP is configured | PASS | `unsafe-inline` in `style-src` remains (L-5, accepted risk) |
| No unnecessary capabilities | PASS | Unchanged from previous review |
| Window creation is restricted | PASS | Single window `"main"` |
| Custom IPC commands | REVIEWED | 4 commands, unchanged. `create_session` and `resize_session` now have dimension validation. |
| No new IPC commands | PASS | Verified: `lib.rs` unchanged in this commit range. |

---

## Unsafe Code Review

**No `unsafe` blocks in Velocity application code.** Verified via grep. The only match for "unsafe" in `src-tauri/src/` is the test function name `test_mixed_safe_and_unsafe` in `ansi/mod.rs:226` -- this is a test name, not unsafe Rust code.

**No `unwrap()` calls on user-derived data.** Verified via grep. All error handling uses `map_err` and `?` operator.

---

## Dependency Audit

### npm audit

```
found 0 vulnerabilities
```

No new npm dependencies in this commit range. `package.json` dependencies unchanged.

### cargo audit

`cargo-audit` was not available in the build environment. No new Rust dependencies in this commit range. `Cargo.toml` dependencies unchanged from previous review HEAD.

---

## Input Validation Analysis

### Dimension Validation (`validate_dimensions`)

| Input | Expected | Actual | Status |
|-------|----------|--------|--------|
| `rows=0, cols=80` | `Err("Invalid rows")` | `Err("Invalid rows: 0...")` | PASS |
| `rows=24, cols=0` | `Err("Invalid cols")` | `Err("Invalid cols: 0...")` | PASS |
| `rows=501, cols=80` | `Err("Invalid rows")` | `Err("Invalid rows: 501...")` | PASS |
| `rows=24, cols=501` | `Err("Invalid cols")` | `Err("Invalid cols: 501...")` | PASS |
| `rows=1, cols=1` | `Ok(())` | `Ok(())` | PASS |
| `rows=500, cols=500` | `Ok(())` | `Ok(())` | PASS |
| `rows=24, cols=80` | `Ok(())` | `Ok(())` | PASS |

The function uses `u16` type, which means values above 65535 are rejected by Tauri's serde deserialization before reaching `validate_dimensions`. The range check (1-500) is correct and comprehensive.

**Validation placement**: `validate_dimensions` is called at the *top* of `create_session` (line 70, before session limit check) and `resize_session` (line 182, before session lookup). This is correct -- fail fast on invalid input before performing any work.

---

## Session Lifecycle Analysis

### Shell Switch Flow

```
User clicks CMD button
  -> handleShellSwitch('cmd')
    -> guard: newShell !== shellType || closed? proceed
    -> setShellType('cmd')
    -> resetAndStart('cmd')
      -> closeSession(sessionIdRef.current)  // close old
      -> cleanupListeners()                   // remove old event handlers
      -> setOutput(''), setInput(''), setClosed(false)
      -> updateSessionId(null)
      -> startSession('cmd')
        -> createSession('cmd', 24, 80)       // IPC to Rust
        -> updateSessionId(newSid)
        -> listen('pty:output:newSid', ...)
        -> listen('pty:error:newSid', ...)
        -> listen('pty:closed:newSid', ...)
        -> unlistenRefs.current = [...]
```

**Analysis**: The flow is correct for the happy path. The `sessionIdRef` pattern ensures the cleanup function in the unmount effect always has the current session ID. The stale closure issue from the original code (where the cleanup function captured the initial `sessionId` value from React state) has been properly fixed.

### Restart Flow

```
Process exits
  -> pty:closed event fires
  -> setClosed(true)
  -> Restart button appears (input field hidden)
User clicks Restart
  -> handleRestart()
    -> resetAndStart(shellType)   // same shell type
      -> (same flow as shell switch)
```

**Analysis**: Correct. The restart uses the same `resetAndStart` function as shell switching, ensuring consistent cleanup behavior.

### Unmount Cleanup

```
Component unmounts
  -> cleanupListeners()           // remove event handlers
  -> closeSession(sessionIdRef.current)  // close session (if exists)
```

**Analysis**: Correct for the common case. The `sessionIdRef` pattern ensures the current session ID is available during cleanup, even in React's async state model. The edge case where unmount occurs during `startSession` is documented as L-2.

---

## Previous Finding Resolution

| Finding | Status | Notes |
|---------|--------|-------|
| H-1: Full env inherited by shells | OPEN (accepted risk) | Inherent to terminal emulators |
| M-1 (R3): Color string validation | OPEN | No changes in this range |
| M-2 (R3): `unsafe-inline` in `style-src` | OPEN (accepted risk) | No changes |
| L-1 (R3): No DCS test | OPEN | No changes |
| L-2 (R3): No APC test | OPEN | No changes |
| L-3 (R3): Bracketed paste test | OPEN | No changes |
| L-4 (R3): `Ordering::Relaxed` | OPEN | No changes |
| L-5 (R3): Session ID format | OPEN | No changes |

---

## Summary of New Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| M-1 | MEDIUM | Race condition in rapid shell switching can orphan sessions | `Terminal.tsx:79-92, 122-129` |
| M-2 | MEDIUM | Stale event listeners can fire during session transition | `Terminal.tsx:79-92` |
| L-1 | LOW | Shell buttons not disabled during active switch | `Terminal.tsx:149-161` |
| L-2 | LOW | Mount/unmount race can orphan a session | `Terminal.tsx:95-114` |

---

## Overall Risk Assessment

### Current State: **LOW-MODERATE RISK**

Risk level unchanged from the previous review. The new features (shell switching, restart, dimension validation) are architecturally sound and do not introduce new security boundaries. The findings are frontend race conditions, not Rust-side vulnerabilities.

**Strengths:**
- Dimension validation is correctly implemented and tested at the Rust boundary
- Shell type allowlist remains enforced server-side (Rust), with additional TypeScript type safety as defense-in-depth
- No new IPC commands or capabilities added -- attack surface unchanged
- `sessionIdRef` pattern correctly fixes the stale closure bug from the original implementation
- `resetAndStart` consolidation eliminates a class of duplication-related cleanup bugs
- No `unsafe` Rust, no `unwrap()` on user data, no `dangerouslySetInnerHTML`
- Restart properly cleans up old sessions before creating new ones
- `MAX_SESSIONS = 20` bounds the impact of session leaks

**Weaknesses:**
- Rapid shell switching race condition (M-1) -- mitigated by `MAX_SESSIONS` cap
- Stale listener window during transition (M-2) -- minimal practical impact but architecturally unclean
- No protection against concurrent async operations on the frontend
- Carried forward: color string validation (M-1/R3), CSP `unsafe-inline` (L-5), session ID validation (L-4), etc.

### Risk Trajectory

Security posture is **stable** from the previous milestone. The new features are correctly implemented with proper validation and cleanup. The two medium findings are frontend-only race conditions with bounded impact (20-session cap). No new Rust-side or IPC-level vulnerabilities were introduced.

### Recommendations for Next Task

Before implementing the Block Model (Pillar 2):
- [ ] Fix M-1 (rapid switch race) by adding a switching guard or disabling buttons during async operations
- [ ] Fix M-2 (stale listeners) by reordering `cleanupListeners()` before `closeSession()` in `resetAndStart`
- [ ] Consider adding a per-block output limit in addition to the global 100KB cap
- [ ] Ensure block model renders content via React JSX (not `dangerouslySetInnerHTML`)

---

**Reviewed by**: Security Review Agent
**Review date**: 2026-03-12
**Verdict**: **PASS** -- No blocking issues. Two medium findings (M-1: rapid switch race, M-2: stale listener ordering) are recommended for the next fix pass but do not represent exploitable vulnerabilities. Dimension validation is correctly implemented. No new attack surface introduced. The `MAX_SESSIONS = 20` cap on the Rust side provides a hard bound on the impact of any frontend session management bugs.
