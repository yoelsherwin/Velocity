# Code Review: TASK-011 Ghost Text Suggestions + Command History Navigation (R2)

**Commit**: `65c9f9a fix: prevent history reset on arrow navigation and remove stale historyIndex`
**Parent commit**: `525aade feat: add ghost text suggestions and command history navigation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Summary

This is the R2 review for the fix commit addressing findings F-02 and F-03 from the R1 code review. Both findings are fully resolved. The fix is minimal, architecturally clean, and accompanied by an integration test that directly reproduces the original bug. All 121 tests pass (15 test files).

---

## R1 Finding Resolution

### [F-02] RESOLVED: Remove stale `historyIndex` from return value

**R1 issue**: `useCommandHistory` exposed `historyIndex: indexRef.current` which was always stale because ref mutations do not trigger re-renders. No consumer used it, but it was a misleading API surface.

**Fix applied**: `historyIndex` has been removed from both the `UseCommandHistory` interface and the return object in `useCommandHistory.ts`.

```typescript
// Before (lines 2-3 of interface, line 99 of return)
interface UseCommandHistory {
  history: string[];
  historyIndex: number | null;  // <-- removed
  ...
}
return {
  history,
  historyIndex: indexRef.current,  // <-- removed
  ...
};
```

**Assessment**: Clean removal. No consumer references `historyIndex`, so no downstream changes are needed. The interface and implementation are now consistent. **Fully resolved.**

---

### [F-03] RESOLVED: Fix Up/Down navigation calling `handleInputChange` -> `reset()`

**R1 issue**: When the user pressed Up arrow in InputEditor, the flow was:
1. `onNavigateUp()` returns a command string.
2. InputEditor calls `onChange(prev)` with that string.
3. `onChange` is `handleInputChange` in Terminal, which calls `reset()`.
4. `reset()` clears `indexRef.current = null`, undoing the navigation.

Result: repeated Up presses always showed the most recent command.

**Fix applied**: A two-part architectural change that lifts state management out of InputEditor and into Terminal:

**Part 1 -- Terminal.tsx** (`handleNavigateUp` and `handleNavigateDown`):

```typescript
// Before
const handleNavigateUp = useCallback(() => {
  setDraft(input);
  return navigateUp();
}, [input, setDraft, navigateUp]);

const handleNavigateDown = useCallback(() => {
  return navigateDown();
}, [navigateDown]);

// After
const handleNavigateUp = useCallback(() => {
  setDraft(input);
  const prev = navigateUp();
  if (prev !== null) {
    setInput(prev);       // Direct state update — bypasses handleInputChange
  }
}, [input, setDraft, navigateUp]);

const handleNavigateDown = useCallback(() => {
  const next = navigateDown();
  if (next !== null) {
    setInput(next);       // Direct state update — bypasses handleInputChange
  }
}, [navigateDown]);
```

**Part 2 -- InputEditor.tsx** (callback signatures and handler logic):

```typescript
// Before — callbacks return history values and InputEditor calls onChange
onNavigateUp?: () => string | null;
onNavigateDown?: () => string | null;
// ... inside handleKeyDown:
const prev = onNavigateUp?.();
if (prev !== null && prev !== undefined) {
  onChange(prev);  // This triggers handleInputChange -> reset() -> BUG
}

// After — callbacks are void, Terminal handles everything
onNavigateUp?: () => void;
onNavigateDown?: () => void;
// ... inside handleKeyDown:
onNavigateUp?.();
// Don't call onChange — Terminal handles the state update directly
```

**Assessment**: This is the exact approach recommended in R1 (Option 2). The fix correctly:
1. Moves `setInput` into Terminal's handlers, bypassing `handleInputChange` entirely.
2. Changes the callback signatures from `() => string | null` to `() => void`, making InputEditor a pure fire-and-forget notifier for navigation events.
3. Adds null checks before calling `setInput` (the `if (prev !== null)` guard), so that navigating past the beginning/end of history does not clear the input.
4. Removes `onChange` calls from InputEditor's arrow key handlers, eliminating the `reset()` pathway.

The data flow is now:
- **Typing**: textarea `onChange` -> `handleInputChange` -> `setInput` + `setDraft` + `reset()` (correct -- typing should reset history position).
- **Arrow navigation**: `onNavigateUp`/`onNavigateDown` -> `navigateUp`/`navigateDown` + `setInput` directly (correct -- no `reset()` involved).

**Fully resolved.**

---

## Integration Test Assessment

### New test: `test_up_arrow_twice_shows_first_command`

**File**: `src/__tests__/Terminal.test.tsx`, lines 440-482

```typescript
it('test_up_arrow_twice_shows_first_command', async () => {
  render(<Terminal />);
  await waitFor(() => { expect(mockCreateSession).toHaveBeenCalled(); });
  const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;

  // Type and submit first command
  fireEvent.change(textarea, { target: { value: 'echo first' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => {
    expect(mockWriteToSession).toHaveBeenCalledWith('test-session-id', 'echo first\r');
  });

  // Type and submit second command
  fireEvent.change(textarea, { target: { value: 'echo second' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => {
    expect(mockWriteToSession).toHaveBeenCalledWith('test-session-id', 'echo second\r');
  });

  // Press Up once — should show "echo second"
  fireEvent.keyDown(textarea, { key: 'ArrowUp' });
  await waitFor(() => { expect(textarea.value).toBe('echo second'); });

  // Press Up again — should show "echo first"
  fireEvent.keyDown(textarea, { key: 'ArrowUp' });
  await waitFor(() => { expect(textarea.value).toBe('echo first'); });
});
```

**Does this test catch the original bug?** Yes. The test exercises the full integrated flow:
1. Commands are submitted through `handleSubmit` which calls `addCommand` + `submitCommand`.
2. The `fireEvent.change` between commands goes through `handleInputChange` (which calls `reset()`).
3. Arrow key presses go through InputEditor's `handleKeyDown` -> Terminal's `handleNavigateUp`.
4. The assertion on `textarea.value` verifies the actual DOM value, not mock return values.

Before the fix, this test would fail at the second `expect(textarea.value).toBe('echo first')` assertion because `reset()` was called after every Up press, causing the index to snap back to null and the next Up to return "echo second" again.

**Assessment**: This is a well-constructed regression test that directly reproduces the bug described in F-03. It is an integration-level test (Terminal + InputEditor + useCommandHistory all working together) which is the correct level to catch this class of bug.

---

## Updated Test Assertions

### InputEditor.test.tsx changes

Two existing tests were updated to match the new callback signatures:

- `test_up_arrow_calls_onNavigateUp`: Mock changed from `vi.fn().mockReturnValue('ls')` to `vi.fn()`. Assertion changed from `expect(onChange).toHaveBeenCalledWith('ls')` to `expect(onChange).not.toHaveBeenCalled()`.
- `test_down_arrow_calls_onNavigateDown`: Mirror change for down arrow.

**Assessment**: Correct. These tests now accurately verify that InputEditor calls the navigation callback but does NOT call `onChange` -- which is the new contract. The tests verify the right behavioral boundary.

---

## Detailed File Review

### `src/hooks/useCommandHistory.ts`

- Interface `UseCommandHistory` no longer exposes `historyIndex`. Clean.
- Return object no longer includes `historyIndex`. Clean.
- All other logic (navigateUp, navigateDown, addCommand, reset, draft management) is unchanged.
- No new issues identified.

### `src/components/Terminal.tsx`

- `handleNavigateUp` now calls `setInput(prev)` directly when `prev !== null`. The null guard prevents clearing input when already at the beginning of history. Correct.
- `handleNavigateDown` now calls `setInput(next)` directly when `next !== null`. The null guard prevents clearing input when already past the end of history... Wait -- when navigating Down past the end, `navigateDown` returns `draftRef.current` (the saved draft), which could be an empty string. An empty string is not null, so `setInput('')` would be called, which correctly restores the draft. This is correct.
- The `handleNavigateUp` dependency array includes `[input, setDraft, navigateUp]`. The `input` dependency is needed because `setDraft(input)` captures the current input as draft on first Up press. This is correct.
- The `handleNavigateDown` dependency array is `[navigateDown]`. It does not need `input` because it never reads input -- it restores from the saved draft via the hook. Correct.

### `src/components/editor/InputEditor.tsx`

- Interface types changed from `() => string | null` to `() => void`. Correct.
- Arrow key handlers now just call `onNavigateUp?.()` / `onNavigateDown?.()` without capturing return values or calling `onChange`. Correct.
- The `handleKeyDown` dependency array still includes `onChange` -- this is fine because `onChange` is still used for Tab key handling. No dead dependency.

---

## Potential Concerns (evaluated, no action needed)

**Concern 1**: Does `handleNavigateUp` recreate on every keystroke due to `input` in the dependency array?

Yes, it does. Every time `input` changes, `handleNavigateUp` gets a new identity, which causes InputEditor to re-render (since it receives a new `onNavigateUp` prop). However, this was already the case before the fix (the R1 code also had `[input, setDraft, navigateUp]` as deps). No regression.

In practice, the InputEditor is already re-rendering on every keystroke because the `value` prop changes. The extra callback identity change is negligible. No action needed.

**Concern 2**: Is there a race between `setInput` in `handleNavigateUp` and InputEditor's controlled value?

No. `setInput` updates React state, which triggers a re-render that passes the new value to InputEditor as a prop. InputEditor's textarea is controlled (`value={value}`), so it will reflect the new value on the next render. This is standard React controlled component behavior.

---

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/hooks/useCommandHistory.ts` | Remove `historyIndex` from interface and return | -2 lines |
| `src/components/Terminal.tsx` | Handle `setInput` directly in navigate handlers | +8/-2 lines |
| `src/components/editor/InputEditor.tsx` | Change callback types to void, remove `onChange` calls | +4/-8 lines |
| `src/__tests__/Terminal.test.tsx` | Add integration test for repeated Up arrow | +46 lines |
| `src/__tests__/InputEditor.test.tsx` | Update test assertions for new callback contract | +5/-4 lines |
| `prompts/STATE.md` | Status updates | various |

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| useCommandHistory.test.ts | 9 | All pass |
| useGhostText.test.ts | 5 | All pass |
| InputEditor.test.tsx | 13 | All pass |
| Terminal.test.tsx | 23 (1 new) | All pass |
| All other suites | 71 | All pass |
| **Total** | **121** | **All pass** |

---

## R1 Optional Findings Status

| ID | Description | Status |
|----|-------------|--------|
| F-04 | Add integration test for repeated Up arrow | **Addressed** -- `test_up_arrow_twice_shows_first_command` |
| F-06 | Suppress ghost text while browsing history | Deferred (acceptable for MVP) |

---

## Verdict: APPROVE

Both required findings from R1 are fully resolved:

- **F-02**: `historyIndex` removed from the hook's public API.
- **F-03**: Navigation handlers now call `setInput` directly in Terminal, bypassing `handleInputChange` -> `reset()`. The data flow is clean: typing resets history position, arrow navigation does not.

The fix is minimal (net +19 lines across 3 source files), architecturally sound, and follows the recommended approach from R1. The new integration test directly catches the original bug and provides ongoing regression protection. No new issues introduced.
