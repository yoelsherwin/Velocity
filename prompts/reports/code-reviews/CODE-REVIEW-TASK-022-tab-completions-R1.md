# Code Review: TASK-022 Tab Completions (R1)

**Reviewer**: Claude Opus 4.6 (Code Reviewer Agent)
**Commit**: `e57b639 feat: add tab completions for paths and commands`
**Date**: 2026-03-18

---

## Files Reviewed

| File | Type | Lines Changed |
|------|------|---------------|
| `src-tauri/src/commands/mod.rs` | Rust backend | +302, -34 |
| `src-tauri/src/lib.rs` | Rust registration | +1 |
| `src/hooks/useCompletions.ts` | New hook | +189 |
| `src/lib/completion-context.ts` | New module | +116 |
| `src/components/editor/InputEditor.tsx` | Modified component | +17, -2 |
| `src/components/Terminal.tsx` | Modified component | +28, -3 |
| `src/__tests__/completion-context.test.ts` | New test | +59 |
| `src/__tests__/useCompletions.test.ts` | New test | +150 |
| `src/__tests__/InputEditor.test.tsx` | Test additions | +37 |
| `src/__tests__/Terminal.test.tsx` | Test additions | +44 |
| `e2e/tab-completions.spec.ts` | New E2E test | +34 |
| `prompts/STATE.md` | Status update | +100, -18 |
| `prompts/tasks/TASK-022-tab-completions.md` | Task spec | +257 |

---

## Critical Findings (Must Fix)

### C1: Path traversal via `cwd` parameter -- Rust does not validate `cwd` against a safe root

**File**: `src-tauri/src/commands/mod.rs`, lines 187-194
**Issue**: The `compute_path_completions` function validates that `cwd` is a real directory (`cwd_path.is_dir()`), but it does **not** restrict what directories can be listed. A compromised or malicious frontend could call `get_completions` with `cwd = "C:\\Windows\\System32"` or any arbitrary directory. While `compute_path_completions` is a read-only listing, it exposes the full filesystem structure to the frontend, which violates the principle of least privilege.

More importantly, the `partial` parameter can be an absolute path (e.g., `C:\Users\Administrator\.ssh\`), completely bypassing the `cwd` parameter. This means **any directory on the system can be enumerated** regardless of what `cwd` is set to.

**Fix**: For MVP, this is an accepted risk since the application already grants full shell access (the user can run `dir` anywhere). Document this as an accepted risk. However, add a length limit on `partial` and `cwd` to prevent DoS via extremely long paths.

**Why**: Terminal applications inherently have full filesystem access, but the IPC surface should still be hardened. A compromised webview could silently enumerate sensitive directories.

### C2: `get_known_commands` return type changed silently -- now returns `Vec<String>` not `Result<Vec<String>, String>`

**File**: `src-tauri/src/commands/mod.rs`, lines 125-129
**Issue**: The refactored `get_known_commands` changed from:
```rust
// Before: returned Result from inner closure
tokio::task::spawn_blocking(|| { ... Ok(commands) }).await.map_err(|e| e.to_string())?
// After: collects Vec directly
tokio::task::spawn_blocking(collect_known_commands).await.map_err(|e| e.to_string())
```

The new version wraps the `Vec<String>` return from `collect_known_commands()` in `Ok()` via `.map_err()` on the `JoinError` only. But `collect_known_commands()` returns `Vec<String>`, not `Result<Vec<String>, String>`. The `spawn_blocking` wraps it in `Result<Vec<String>, JoinError>`, and `.map_err(|e| e.to_string())` converts to `Result<Vec<String>, String>`. This **actually works correctly** since `spawn_blocking(fn) -> Result<fn_return, JoinError>`, and the function signature expects `Result<Vec<String>, String>`. No issue after closer inspection.

**Status**: Retracted -- upon re-analysis this is correct. Removing from count.

---

## Important Findings (Should Fix)

### I1: Debounce timer in `useCompletions` is never cleaned up on unmount

**File**: `src/hooks/useCompletions.ts`, lines 43-44, 132-148
**Issue**: The `debounceRef` timer created in `cycleNext` for path completions is cleaned up on input changes (line 67-69) and in `resetFn` (lines 175-177), but there is **no cleanup on component unmount**. If the component unmounts while a 100ms debounce is pending, the `setTimeout` callback will fire and call `setCompletions` / `setCompletionIndex` / `setActiveContext` on an unmounted component.

In React 18 this triggers a warning and can cause state update bugs in strict mode. While React 18 does not throw on this, it is still a memory leak and a correctness issue.

**Fix**: Add a cleanup `useEffect` that clears `debounceRef.current` on unmount:
```typescript
useEffect(() => {
  return () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  };
}, []);
```

**Why**: Prevents memory leaks and state-update-on-unmounted-component warnings.

### I2: `handleTab` dependency on entire `completions` object causes re-creation on every render

**File**: `src/components/Terminal.tsx`, lines 395-400
**Issue**: `handleTab` depends on `[completions]`, where `completions` is the full return object from `useCompletions`. Since `useCompletions` returns a new object on every render (even when values haven't changed), `handleTab` will be re-created on every render, defeating the purpose of `useCallback`.

```typescript
const handleTab = useCallback(() => {
  completions.cycleNext();
}, [completions]); // completions is a NEW object every render
```

**Fix**: Depend on `completions.cycleNext` instead, or use a ref to hold the latest `cycleNext` function:
```typescript
const handleTab = useCallback(() => {
  completions.cycleNext();
}, [completions.cycleNext]);
```

**Why**: Unnecessary re-creation of `handleTab` causes unnecessary re-renders of `InputEditor` (since `onTab` prop changes).

### I3: `compute_command_completions` calls `collect_known_commands()` on every invocation -- scans entire PATH each time

**File**: `src-tauri/src/commands/mod.rs`, lines 304-320
**Issue**: Every call to `get_completions` with `context: "command"` invokes `collect_known_commands()`, which scans every directory in `PATH` and iterates all files. On a typical Windows system with many PATH entries, this is a significant I/O operation (potentially reading thousands of directory entries).

This function is called on every Tab press when the cursor is in command position. With debounce only on path completions (not command completions), rapid Tab presses will each trigger a full PATH scan.

**Fix**: Cache the known commands list. Options:
1. Use a `OnceCell<Vec<String>>` or `lazy_static` to compute once.
2. Cache with a TTL (e.g., 30 seconds) so new installations are eventually detected.
3. At minimum, share the result between `get_known_commands` and `compute_command_completions`.

**Why**: Performance -- PATH scanning is I/O-heavy and should not happen on every Tab press.

### I4: `handleInputChange` sets `cursorPos` to `newValue.length`, not actual cursor position

**File**: `src/components/Terminal.tsx`, line 374
**Issue**: When the user types or pastes, `handleInputChange` always sets `cursorPos` to `newValue.length` (end of input). This is incorrect when the user edits in the middle of the input -- the cursor position will be wrong, and completions will target the wrong token.

The `onCursorChange` callback from `InputEditor` does correctly report the real cursor position via `textareaRef.current.selectionStart`, but only on `keyUp` and `click`. The `onChange` handler fires first and sets the wrong position, which is then corrected asynchronously on `keyUp`. This creates a brief inconsistency where the completion context is computed against the wrong cursor position.

**Fix**: Don't set `cursorPos` in `handleInputChange`. Rely solely on the `onCursorChange` callback from InputEditor, or read the actual selection position from the textarea ref. Alternatively, trigger `onCursorChange` from the `onChange` handler in InputEditor.

**Why**: Incorrect cursor position leads to wrong completion context, especially for mid-input edits.

### I5: `collect_known_commands` uses `unwrap_or` on `split('.')` which can't fail, but the pattern is fragile

**File**: `src-tauri/src/commands/mod.rs`, line 156
**Issue**: The line `let base = name.split('.').next().unwrap_or(name).to_lowercase();` uses `unwrap_or` which is acceptable here since `split()` always yields at least one element. However, this strips ALL extensions including double extensions (e.g., `git.exe` becomes `git`, but `python3.12.exe` would also become `python3` -- losing the `12`).

For files like `python3.12.exe`, `split('.').next()` returns `python3`, which is actually correct behavior for command names. However, this strips extension even from extensionless files on PATH (which don't exist on Windows but could on WSL). This is a pre-existing issue, not introduced by this PR.

**Fix**: No action needed for this PR. The behavior is inherited and correct for Windows.

**Why**: Pre-existing, documented for awareness.

### I6: CWD is fetched once on mount but never updated

**File**: `src/components/Terminal.tsx`, lines 249-252
**Issue**: The `cwd` state is fetched once on mount via `getCwd()` and never updated. As the user navigates directories with `cd`, the `cwd` used for path completions becomes stale. Completions will be relative to the original working directory, not the shell's current directory.

```typescript
useEffect(() => {
  getCwd().then(setCwd).catch(() => {});
}, []);
```

This is acknowledged as "acceptable for MVP" in the existing `cwd.ts` comment, but it directly impacts the usability of tab completions.

**Fix**: Update `cwd` periodically (e.g., after each command execution completes) or when the user triggers a Tab completion. At minimum, document this as a known limitation.

**Why**: Stale CWD means path completions show files from the wrong directory after `cd`.

---

## Suggestions (Nice to Have)

### S1: E2E test uses `waitForTimeout` (fixed delay) instead of polling

**File**: `e2e/tab-completions.spec.ts`, line 22
**Issue**: `await appPage.waitForTimeout(500)` is a fixed sleep, which is flaky on slow machines and wastes time on fast ones. Playwright recommends polling assertions instead.

**Fix**: Replace with a `waitFor` or `expect().toPass()` pattern:
```typescript
await expect(async () => {
  const ghostText = await editor.locator('.ghost-text').count();
  const inputValue = await textarea.inputValue();
  expect(ghostText > 0 || inputValue !== 'dir src').toBe(true);
}).toPass({ timeout: 2000 });
```

**Why**: More robust E2E test that adapts to machine speed.

### S2: `getCompletionContext` defines `PositionedToken` interface inside the function body

**File**: `src/lib/completion-context.ts`, lines 25-28
**Issue**: The `PositionedToken` interface is defined inline inside the function. This is fine for a private type but is unusual and makes the function harder to read. It also prevents reuse.

**Fix**: Move `PositionedToken` to module scope:
```typescript
interface PositionedToken extends Token {
  start: number;
  end: number;
}
```

**Why**: Cleaner code organization. Minor readability improvement.

### S3: Path completions always use backslash for directory suffix, even on WSL

**File**: `src-tauri/src/commands/mod.rs`, lines 278-279
**Issue**: The code always appends `\\` as the directory separator in completion results. When the user is in a WSL shell, forward slash (`/`) would be more appropriate.

**Fix**: Accept an optional `shell_type` parameter in `get_completions` and use `/` for WSL shells. This can be deferred to a future iteration.

**Why**: Better UX for WSL users. Not critical for MVP.

### S4: No `Shift+Tab` support for cycling backwards

**File**: `src/components/editor/InputEditor.tsx`, `src/hooks/useCompletions.ts`
**Issue**: The hook provides `cycleNext` but no `cyclePrev`. Fish and most shells support `Shift+Tab` to cycle backwards through completions.

**Fix**: Add `cyclePrev` to the hook interface and handle `Shift+Tab` in InputEditor.

**Why**: Standard terminal UX expectation. Non-blocking for MVP.

### S5: Rust tests don't clean up temp directories on test failure

**File**: `src-tauri/src/commands/mod.rs`, lines 341-441
**Issue**: Test cleanup (`fs::remove_dir_all`) is at the end of each test function. If an assertion fails before cleanup, the temp directory is left behind. This can cause test pollution on subsequent runs.

**Fix**: Use a RAII cleanup pattern or `Drop` guard:
```rust
struct TempDir(std::path::PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}
```
Or use the `tempdir` / `tempfile` crate.

**Why**: Prevents test pollution. Minor improvement.

### S6: `useCompletions` hook does not use the `accept` return value in the Tab flow

**File**: `src/components/Terminal.tsx`, lines 395-400
**Issue**: When `handleTab` is called, it only calls `cycleNext()`. There is no code path in Terminal.tsx that calls `completions.accept()` to actually apply a completion to the input. The `accept` method exists on the hook but is never called. Ghost text acceptance goes through InputEditor's existing `onChange(value + ghostText)` path when Tab is pressed with ghost text visible, but this means:

1. First Tab press: calls `cycleNext()` which populates ghost text.
2. Second Tab press with ghost text now visible: InputEditor sees ghost text, calls `onChange(value + ghostText)` which appends the suggestion.

This works for the first completion but is subtly incorrect -- the ghost text is appended to the end of input rather than replacing the partial at the cursor position. For example, if cursor is in the middle of `"git comm"` and ghost text shows `"it"`, pressing Tab would produce `"git commit"` (append) instead of replacing `comm` with `commit`.

**Fix**: Use `completions.accept()` in the Tab handler when completions are active, and update the input with the returned value. This gives correct replacement semantics.

**Why**: Mid-input completion would produce incorrect results. The `accept()` method correctly handles `replaceStart`/`replaceEnd` but is never called.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No command injection | PASS | `get_completions` only reads directory listings, never executes |
| Input validation in Rust | PARTIAL | `cwd` validated as real directory; no length limits on inputs |
| No path traversal | NOTED | Absolute paths in `partial` can enumerate any directory (accepted risk for terminal app) |
| PTY output safety | N/A | No PTY interaction in this feature |
| No secret leakage | PASS | No secrets involved |
| ANSI parsing safety | N/A | No ANSI processing |
| IPC permissions minimal | PASS | Uses `core:default` permissions only |
| Symlink safety | NOTED | `file_type()` follows symlinks by default; `is_dir()` follows symlinks. Could allow symlink-based enumeration of files outside the target directory. Accepted risk for a terminal app. |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 (C1 demoted to accepted risk after analysis) |
| Important | 6 |
| Suggestions | 6 |

**Overall Assessment**: **NEEDS CHANGES**

The implementation is well-structured and follows established patterns in the codebase. The Rust backend is properly isolated from the Tauri runtime for testability, input validation is present, and test coverage is solid across all layers. The completion context detection via the existing tokenizer is a clean design choice.

However, there are several important issues that should be addressed:

1. **I1 (debounce cleanup on unmount)** -- Memory leak / state-on-unmounted bug. Quick fix.
2. **I2 (handleTab dependency array)** -- Causes unnecessary re-renders. Quick fix.
3. **I3 (PATH scanning on every command completion)** -- Performance issue on Tab press. Should cache.
4. **I4 (cursorPos set to end in onChange)** -- Incorrect completion context for mid-input edits.
5. **I6 (stale CWD)** -- Path completions from wrong directory after `cd`. Known MVP limitation but worth documenting prominently.
6. **S6 (accept() never called)** -- Promoted to important: mid-input completions will produce wrong results because ghost text is appended rather than replacing the partial.

The feature is functional for the common case (cursor at end of input, completing commands and paths) but has correctness issues for edge cases (mid-input editing, stale CWD). Recommend addressing I1, I2, I3, I4, and S6 before merge.
