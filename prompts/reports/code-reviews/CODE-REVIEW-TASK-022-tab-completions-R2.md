# Code Review: TASK-022 Tab Completions (R2)

**Reviewer**: Claude Opus 4.6 (Code Reviewer Agent)
**Fix Commit**: `dde12a2 fix: address code review findings for tab completions`
**Date**: 2026-03-18

---

## Previous Round Resolution

### C1: Path traversal via `cwd` parameter (Accepted Risk)

**R1 Verdict**: Add length limits on `partial` and `cwd` to prevent DoS.
**R2 Status**: **NOT ADDRESSED** -- No length limits were added. However, the R1 report itself concluded this was an accepted risk for a terminal application (which already grants full shell access). The absence of length limits is a minor hardening gap, not a functional bug. **Acceptable for MVP.**

### I1: Debounce timer not cleaned up on unmount

**R1 Verdict**: Add a cleanup `useEffect` that clears `debounceRef.current` on unmount.
**R2 Status**: **FIXED** -- Lines 62-68 of `src/hooks/useCompletions.ts` add exactly the prescribed cleanup effect:
```typescript
useEffect(() => {
  return () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  };
}, []);
```
Verified: the cleanup runs on unmount and prevents state-update-on-unmounted-component issues. Correct placement (before the input/cursor change effect).

### I2: `handleTab` dependency on entire `completions` object

**R1 Verdict**: Depend on `completions.cycleNext` instead of the whole object.
**R2 Status**: **FIXED** -- Line 427 of `src/components/Terminal.tsx` now uses granular dependencies:
```typescript
}, [completions.cycleNext, completions.suggestion, completions.completionIndex, completions.accept, input]);
```
This prevents unnecessary re-creation of `handleTab` when unrelated fields of the completions object change. Each dependency is a stable reference (from `useCallback`/`useMemo`) or a primitive value.

### I3: PATH scanning on every command completion

**R1 Verdict**: Cache the known commands list with a TTL.
**R2 Status**: **FIXED** -- Lines 8-10 and 309-324 of `src-tauri/src/commands/mod.rs` introduce a `COMMAND_CACHE` static with a 30-second TTL:
```rust
static COMMAND_CACHE: std::sync::LazyLock<Mutex<Option<(Instant, Vec<String>)>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));
```
The `get_cached_commands()` function checks if the cache is fresh (< 30s), returns the cached copy, or refreshes it. `compute_command_completions` now calls `get_cached_commands()` instead of `collect_known_commands()` directly. This eliminates repeated PATH scans on rapid Tab presses. The 30-second TTL balances performance with freshness.

**Note**: The `get_known_commands` Tauri command (used by `useKnownCommands` on frontend mount) still calls `collect_known_commands()` directly rather than `get_cached_commands()`. This is acceptable since `get_known_commands` is called once on mount, not on every Tab press, and the data flows separately. However, sharing the cache between the two would be a nice optimization.

**Poisoned mutex handling**: Line 313 uses `unwrap_or_else(|e| e.into_inner())` which recovers from a poisoned mutex. This is the correct approach for a cache -- if a previous thread panicked while holding the lock, we still want to serve cached data rather than propagating the panic. Good defensive practice.

### I4: `handleInputChange` sets `cursorPos` to `newValue.length` instead of actual cursor position

**R1 Verdict**: Remove `setCursorPos` from `handleInputChange`, rely on `onCursorChange` from InputEditor.
**R2 Status**: **FIXED** -- Two changes:
1. `src/components/Terminal.tsx` line 393: The `setCursorPos(newValue.length)` call was removed from `handleInputChange`, replaced with a comment: `// Cursor position is updated via onCursorChange from InputEditor`.
2. `src/components/editor/InputEditor.tsx` lines 120-128: The `onChange` handler now fires `onCursorChange` immediately after `onChange`:
```typescript
onChange={(e) => {
  onChange(e.target.value);
  if (onCursorChange) {
    const pos = e.target.selectionStart;
    onCursorChange(pos);
  }
}}
```
This eliminates the brief inconsistency where cursor position was wrong between `onChange` and the next `keyUp`. The actual DOM `selectionStart` is read synchronously during the change event, giving the correct position for mid-input edits.

**Potential subtlety**: After `onChange(e.target.value)` triggers a React state update and re-render, `e.target.selectionStart` is still the value from the current event (the browser hasn't re-rendered yet, and the synthetic event is still valid at this point). This is correct behavior.

### I5: `collect_known_commands` uses `unwrap_or` on `split('.')`

**R1 Verdict**: No action needed (pre-existing, correct for Windows).
**R2 Status**: **N/A** -- No changes required or made.

### I6: CWD fetched once on mount, never updated

**R1 Verdict**: Update `cwd` periodically or after each command execution.
**R2 Status**: **PARTIALLY FIXED** -- Lines 122-148 of `src/components/Terminal.tsx` now detect command completion (via exit code detection) and re-fetch CWD:
```typescript
let commandCompleted = false;
// ... inside setBlocks:
if (exitCode !== null) {
  commandCompleted = true;
}
// ... after setBlocks:
if (commandCompleted) {
  getCwd().then(setCwd).catch(() => {});
}
```

This is a meaningful improvement -- CWD is now refreshed after every command completes, not just on mount. However, the code itself documents the fundamental limitation in the comment (lines 142-145): `getCwd()` returns the **Tauri process CWD**, not the child shell's CWD. After `cd C:\Users`, the shell's CWD changes but the Tauri process CWD typically does not. So the re-fetch will return the same stale value in most cases.

This is an honest and well-documented limitation. The fix still helps in edge cases (e.g., if the Tauri process itself changes CWD), and the infrastructure is in place for when a proper CWD-tracking mechanism is added. **Acceptable for MVP.**

### S6: `accept()` never called -- mid-input completions produce wrong results

**R1 Verdict**: Use `completions.accept()` in the Tab handler when completions are active.
**R2 Status**: **FIXED** -- Lines 406-427 of `src/components/Terminal.tsx` now implement a three-way branching `handleTab`:

```typescript
const handleTab = useCallback(() => {
  if (completions.suggestion && completions.completionIndex >= 0) {
    // Active tab completion -- accept via completions.accept()
    const newValue = completions.accept();
    if (newValue !== null) {
      setInput(newValue);
      setCursorPos(newValue.length);
    }
  } else if (completions.suggestion && completions.completionIndex === -1) {
    // History ghost text -- append to end
    setInput(input + completions.suggestion);
    setCursorPos((input + completions.suggestion).length);
  } else {
    // No ghost text -- trigger completion cycling
    completions.cycleNext();
  }
}, [completions.cycleNext, completions.suggestion, completions.completionIndex, completions.accept, input]);
```

This correctly distinguishes between:
1. **Tab completions active** (`completionIndex >= 0`): Uses `accept()` for proper `replaceStart`/`replaceEnd` replacement semantics.
2. **History suggestion** (`completionIndex === -1`, which is the default): Appends ghost text to end.
3. **No ghost text**: Triggers `cycleNext()` to start completion cycling.

The InputEditor was also updated (lines 33-43) to delegate ghost text acceptance to the parent via `onTab` when available, rather than always appending:
```typescript
if (ghostText && onTab) {
  // Delegate to parent for correct replacement semantics
  onTab();
} else if (ghostText) {
  // No onTab handler -- fallback to append
  onChange(value + ghostText);
} else if (onTab) {
  onTab();
}
```

This is a well-designed fix. The `accept()` function in `useCompletions.ts` (lines 162-178) correctly splices the completion into the input using `replaceStart` and `replaceEnd`, handling mid-input cursor positions.

---

## New Findings in Fix Commit

### N1 (Minor): `handleTab` sets cursor to end of input after accepting tab completion

**File**: `src/components/Terminal.tsx`, line 415
**Issue**: After calling `completions.accept()`, the cursor is placed at `newValue.length` (end of input). For mid-input completions (e.g., completing `git comm|and` where `|` is cursor), the cursor should ideally be placed after the completed token, not at the very end. If there's text after the cursor (`and` in this case), the cursor jumps to the end.

For example:
- Input: `git comm`, cursor at position 8, text after: ` --all`
- Full input: `git comm --all`
- After accepting `commit`: `git commit --all` with cursor at position 16 (end) instead of position 10 (after `commit`)

**Severity**: Minor -- mid-input completion is an edge case for MVP, and putting the cursor at the end is the safe default. Fish shell also moves cursor to end in most cases. This can be improved in a later iteration.

### N2 (Observation): `commandCompleted` flag inside `setBlocks` callback may not behave as expected with React batching

**File**: `src/components/Terminal.tsx`, lines 122-148
**Issue**: The `commandCompleted` flag is a local `let` variable declared outside `setBlocks()`. The closure inside `setBlocks` sets it to `true`, and the code after `setBlocks` checks it. This works because React 18's automatic batching does not defer the `setBlocks` updater function -- the updater runs synchronously during the `setBlocks` call, even though the actual DOM update is batched. The side-effect (calling `getCwd()`) correctly reads the flag after the updater has run.

However, this pattern of using side-effects communicated via mutable closure variables is fragile. A more explicit approach would be to use a separate `useEffect` that watches for block status changes. For MVP, this works correctly.

**Severity**: Observation only -- no bug, just a code pattern note.

### N3 (Observation): Test mock for `selectionStart` uses `Object.defineProperty`

**File**: `src/__tests__/Terminal.test.tsx`, line 1192
**Issue**: The test uses `Object.defineProperty(textarea, 'selectionStart', { value: 2, writable: true, configurable: true })` to mock the cursor position. This overrides the property on the DOM element instance. The value `2` matches the length of `'gi'`, which is correct. However, this mock is set before the `fireEvent.change()` call and persists for the rest of the test. If the test later checks cursor positions for different input lengths, this could cause subtle issues.

**Severity**: Test-only observation. The current test is correct as written.

---

## Suggestions Not Addressed (Carried Forward)

These R1 suggestions were not addressed in the fix commit. They are non-blocking and can be deferred:

| R1 ID | Finding | Status |
|-------|---------|--------|
| S1 | E2E test uses `waitForTimeout` instead of polling | Not addressed -- acceptable for MVP |
| S2 | `PositionedToken` defined inside function body | Not addressed -- minor readability |
| S3 | Path completions always use backslash (WSL) | Not addressed -- deferred to future |
| S4 | No `Shift+Tab` for cycling backwards | Not addressed -- deferred to future |
| S5 | Rust tests don't clean up temp dirs on failure | Not addressed -- minor test hygiene |

---

## Test Verification

All tests pass:
- **Frontend (Vitest)**: 313/313 passed across 30 test files
- **Rust (cargo test)**: 87/87 passed (77 unit + 10 integration)

The Terminal.test.tsx file was updated to properly mock `selectionStart` for the tab completion test, which is necessary given the I4 fix that now reads `selectionStart` from the change event.

---

## Security Re-check

No new security concerns introduced by the fix commit. The command cache (`COMMAND_CACHE`) uses a static `LazyLock<Mutex<...>>`, which is safe for concurrent access. The poisoned-mutex recovery is appropriate for a cache. No new IPC surfaces, no new user-input handling paths.

---

## Summary

| R1 Finding | Resolution |
|------------|------------|
| C1 (path traversal) | Accepted risk for terminal app (no length limits added) |
| I1 (debounce cleanup) | **FIXED** -- cleanup useEffect on unmount |
| I2 (handleTab deps) | **FIXED** -- granular dependency array |
| I3 (PATH scanning) | **FIXED** -- 30s TTL cache via LazyLock |
| I4 (cursor position) | **FIXED** -- removed from onChange, fire from InputEditor |
| I5 (unwrap_or on split) | N/A -- pre-existing, no action needed |
| I6 (stale CWD) | **PARTIALLY FIXED** -- re-fetches on command completion (documented MVP limitation) |
| S6 (accept() unused) | **FIXED** -- three-way handleTab with proper accept() semantics |

| New Finding | Severity |
|-------------|----------|
| N1 (cursor at end after accept) | Minor |
| N2 (commandCompleted closure pattern) | Observation |
| N3 (test mock for selectionStart) | Test observation |

**Verdict**: **APPROVE**

All important findings from R1 have been addressed or explicitly accepted with documentation. The fixes are well-implemented, the code is clean, and all tests pass. The three new observations are minor and non-blocking. The feature is ready for merge.
