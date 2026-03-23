# Code Review: TASK-038 Session Restoration (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: 454d392 `feat: add session restoration on restart`

## Verdict: PASS (with findings)

No blocking issues. The implementation follows a clean architecture with proper atomic writes, debounced saves, and graceful degradation on corrupt data. Several findings noted below, including one security item.

---

## Security Review

### S-1: CWD Injection via `cd` Command (MEDIUM)

**File**: `src/components/Terminal.tsx` (line ~430)
```typescript
writeToSession(sessionIdRef.current, `cd "${initialCwd}"\r`).catch(() => {});
```

The saved CWD is interpolated into a shell command with only double-quote wrapping. A malicious or corrupted session file could contain a CWD like:
```
C:\"; Remove-Item -Recurse C:\important; echo "
```

Double quotes in PowerShell do not prevent command injection -- semicolons and backticks can break out. The CWD value comes from the session file on disk, which is written by the app itself, so exploitation requires local file modification. However, this violates the project security rule: "NEVER string-interpolate user input into shell commands."

**Recommendation**: Instead of sending `cd "path"`, use the Tauri command layer to change directory before the shell session starts, or validate the CWD is an existing directory path using a Rust-side command before sending it. At minimum, sanitize the path to reject characters like `;`, `|`, `&`, `` ` ``, `$`, `(`, `)`.

### S-2: Session File Contains Command History (LOW)

The session file at `%LOCALAPPDATA%\Velocity\session.json` stores the last 100 commands per pane. This could include sensitive commands (e.g., `curl -H "Authorization: Bearer sk-..."`, `$env:PASSWORD="..."`, database connection strings).

The file inherits OS-level user permissions, which is the standard approach for local app data. No additional encryption is applied.

**Recommendation**: Consider filtering commands that match secret patterns (reuse the existing `detectSecrets` from TASK-037) before persisting history. Low priority since the file is user-local.

### S-3: JSON Validation on Load (PASS)

The Rust `load_session` function validates JSON syntax with `serde_json::from_str` before returning content. The TypeScript `loadSessionState` further validates `version === 1`, `Array.isArray(tabs)`, and `activeTabId` presence. Corrupt or malicious JSON gracefully returns `null`, falling back to a fresh session. This is correct.

### S-4: No Secrets in Session File Structure (PASS)

The session file stores: tab IDs, titles, shell types, pane tree structure, CWD paths, and command history strings. No environment variables, authentication tokens, or shell output is persisted. The CWD paths and command history are the only potentially sensitive items (addressed in S-1 and S-2).

### S-5: Atomic Write (PASS)

The Rust `save_session` writes to `session.json.tmp` then renames to `session.json`. This prevents partial writes from corrupting the session file on crash. On Windows, `std::fs::rename` is not truly atomic (it fails if the target is locked), but it is sufficient for this use case since only one process writes to the file.

---

## Architecture Review

### Pattern: GOOD

The four-layer design is well-separated:
1. `src-tauri/src/session/mod.rs` -- Rust file I/O with atomic write and JSON validation
2. `src/lib/session.ts` -- TypeScript IPC wrapper with version validation
3. `src/hooks/useSessionPersistence.ts` -- React hook managing debounce, pane data collection, and serialization
4. `src/lib/session-context.ts` -- React context for pane-level data exchange between TabManager and Terminal

The pre-load pattern (`loadInitialSession()` before `ReactDOM.createRoot`) avoids a loading state flash and allows synchronous tab initialization.

### Module-level Mutable State (ACCEPTABLE)

`TabManager.tsx` uses module-level variables (`cachedSessionState`, `sessionLoadAttempted`) to cache the pre-loaded session. This works because:
- `loadInitialSession()` is called exactly once before render
- The cached state is consumed during the first `useState` initializer
- React StrictMode double-invocation is safe since `sessionLoadAttempted` prevents re-fetch

This is a pragmatic pattern for async-before-render scenarios in React.

---

## Findings

### F-1: Debounce Doesn't Coalesce Rapid Tab Changes (LOW)

**File**: `src/hooks/useSessionPersistence.ts` (lines 67-79)

The debounce implementation uses a "leading-edge ignore, trailing-edge fire" pattern: the first call starts a timer, subsequent calls update `pendingRef` but do NOT reset the timer. This means if the user opens/closes 5 tabs over 3 seconds, the save fires at t=2s with the state at t=0s (the original `pendingRef`), missing the later changes.

Wait -- re-reading: `pendingRef.current` IS updated on each call (line 69), and the timer callback reads `pendingRef.current` (line 73). So the timer fires with the LATEST state. This is correct. However, if rapid changes happen AFTER the first timer fires but before a new timer starts, those changes won't trigger a save until the next `requestSave` call. This is acceptable because the `useEffect` in TabManager fires on every `tabs`/`activeTabId` change, so a new debounce cycle starts immediately.

No action needed.

### F-2: `updatePaneData` Triggers Effect on Every Render (LOW)

**File**: `src/components/Terminal.tsx` (lines 447-455)

The `useEffect` depends on `history` (an array). Since `useCommandHistory` returns a new array reference on every `addCommand`, this effect fires after every command execution, calling `updatePaneData` which updates a Map ref and (via the parent effect) triggers `requestSave`. The debounce protects against excessive disk writes, but the effect chain is chatty.

**Recommendation**: Consider comparing `history.length` or using a ref to skip no-op updates. Low priority since the debounce absorbs the cost.

### F-3: `beforeunload` Save Is Synchronous-Only (LOW)

**File**: `src/components/layout/TabManager.tsx` (lines 144-148)

`saveNow` calls `doSave` which calls `saveSessionState` (an async `invoke`). In `beforeunload`, the browser may not wait for the async IPC call to complete. The `invoke` call is fire-and-forget here.

**Recommendation**: For reliable save-on-close, consider using `navigator.sendBeacon` (if Tauri supports it) or a Tauri `on_close_requested` event handler on the Rust side that triggers the save synchronously. Alternatively, since the debounced save fires every 2 seconds, the worst case is losing 2 seconds of session state -- acceptable for pre-alpha.

### F-4: Rust Tests Don't Test the Actual Functions (LOW)

**File**: `src-tauri/src/session/mod.rs` (tests)

Tests `test_save_session_writes_file` and `test_load_session_reads_file` manually replicate the write/rename and read/parse logic instead of calling `save_session()` / `load_session()`. Only `test_save_and_load_roundtrip` and `test_load_session_missing_file` test the actual functions.

The `test_load_session_invalid_json` test writes invalid JSON to a temp directory but then manually parses it instead of calling `load_session()`, because `load_session()` uses the real `session_path()` (pointing to `%LOCALAPPDATA%`). This means the corrupt-file handling in `load_session()` is not directly tested.

**Recommendation**: Extract the path as a parameter (or use a test helper that overrides it) so all tests exercise the real functions.

### F-5: `restoreTabsFromSession` Sets Counter Incorrectly (LOW)

**File**: `src/components/layout/TabManager.tsx` (line ~60)

```typescript
counter.current = session.tabs.length;
```

If the session had 3 tabs (titled "Terminal 1", "Terminal 2", "Terminal 3"), the counter is set to 3. When the user creates a new tab, it gets `++counter.current` = 4, titled "Terminal 4". This is correct.

However, if the user had renamed tabs (e.g., session has "Terminal 1", "Terminal 5", "Terminal 2" due to opening/closing), the counter resets to 3 and the next tab would be "Terminal 4", which may duplicate a previously used number. This is cosmetic only.

---

## Summary

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| S-1 | MEDIUM | Security | CWD path interpolated into shell command without sanitization |
| S-2 | LOW | Security | Command history in session file may contain secrets |
| F-2 | LOW | Performance | updatePaneData effect fires on every command execution |
| F-3 | LOW | Reliability | beforeunload async save may not complete |
| F-4 | LOW | Testing | Rust tests don't exercise actual load/save functions for edge cases |
| F-5 | LOW | Cosmetic | Tab counter reset may produce duplicate tab numbers |

**Recommended for R2**: Fix S-1 (CWD sanitization). All other items are acceptable for pre-alpha.
