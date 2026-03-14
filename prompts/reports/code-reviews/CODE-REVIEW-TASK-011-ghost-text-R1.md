# Code Review: TASK-011 Ghost Text Suggestions + Command History Navigation (R1)

**Commit**: `525aade feat: add ghost text suggestions and command history navigation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit adds two new hooks (`useCommandHistory`, `useGhostText`), updates `InputEditor` to support ghost text rendering and arrow-key history navigation, and integrates everything through `Terminal.tsx`. Two new test files and five new tests in the existing `InputEditor.test.tsx` provide coverage. All 120 tests pass (15 test files).

The implementation is clean and well-structured overall. The hooks are correctly separated, the multi-line arrow-key safety logic is correct, and the ghost text rendering approach is sound. There are two medium-severity issues that should be addressed before merge, plus several low-severity observations.

---

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useCommandHistory.ts` | NEW: Command history hook with Up/Down navigation, draft preservation |
| `src/hooks/useGhostText.ts` | NEW: History-based prefix-match ghost text hook |
| `src/components/editor/InputEditor.tsx` | MODIFIED: Ghost text rendering, Tab behavior change, arrow key handlers |
| `src/components/Terminal.tsx` | MODIFIED: Hook integration, new handler wrappers |
| `src/__tests__/useCommandHistory.test.ts` | NEW: 9 tests for command history hook |
| `src/__tests__/useGhostText.test.ts` | NEW: 5 tests for ghost text hook |
| `src/__tests__/InputEditor.test.tsx` | MODIFIED: 5 new tests for ghost text + navigation |
| `src/App.css` | MODIFIED: `.ghost-text` style added |
| `prompts/STATE.md` | MODIFIED: Status updates |

---

## Findings

### [F-01] BUG (Medium): `handleInputChange` resets history index but does not save draft

**File**: `src/components/Terminal.tsx`, lines 275-281

```typescript
const handleInputChange = useCallback(
  (newValue: string) => {
    setInput(newValue);
    setDraft(newValue);
    reset();
  },
  [setDraft, reset],
);
```

The task spec (Section 4, onChange handler) says:
```typescript
const handleInputChange = (newValue: string) => {
  setInput(newValue);
  reset();  // Reset history browsing when user types
};
```

The implementation adds `setDraft(newValue)` which is not in the spec. This is actually a **good addition** -- it keeps the draft in sync when the user types. However, the issue is the **call order**: `setDraft` is called before `reset()`. Since `reset()` sets `indexRef.current = null` (indicating "not browsing history"), and `setDraft` stores the current text so it can be restored later, the ordering is correct. No actual bug here on re-analysis.

**Re-assessment**: This is actually correct and an improvement over the spec. The `setDraft` call ensures that if the user types something, then presses Up (saving draft), then Down (restoring draft), the draft reflects their most recent typing. **Withdrawn -- not a finding.**

---

### [F-02] BUG (Medium): `historyIndex` in return value is a stale ref snapshot

**File**: `src/hooks/useCommandHistory.ts`, lines 97-106

```typescript
return {
  history,
  historyIndex: indexRef.current,
  addCommand,
  navigateUp,
  navigateDown,
  reset,
  draft,
  setDraft: setDraftWrapped,
};
```

`historyIndex` is exposed as `indexRef.current`, which is captured at render time. Since `indexRef` is mutated synchronously by `navigateUp`/`navigateDown`/`reset`/`addCommand` **without triggering a re-render**, the `historyIndex` value returned to consumers will always be stale (it reflects the value at the last render, not the current navigation position).

Currently, no consumer reads `historyIndex` (Terminal.tsx destructures `{ history, addCommand, navigateUp, navigateDown, reset, setDraft }` and ignores it). So this is not an active bug -- but it is a misleading API surface. A consumer who reads `historyIndex` thinking it tracks the current position would get incorrect behavior.

**Severity**: Medium (misleading API -- not actively broken but a footgun for future use).

**Recommendation**: Either:
1. Remove `historyIndex` from the return value since no consumer uses it, or
2. Convert `indexRef` to `useState` so changes trigger re-renders and the value stays fresh.

Option (1) is simpler and appropriate here since navigation is communicated via return values from `navigateUp`/`navigateDown` rather than by reading the index.

---

### [F-03] BUG (Medium): `handleNavigateUp` captures stale `input` in closure

**File**: `src/components/Terminal.tsx`, lines 284-287

```typescript
const handleNavigateUp = useCallback(() => {
  setDraft(input);
  return navigateUp();
}, [input, setDraft, navigateUp]);
```

The `input` dependency is in the deps array, so the closure will be recreated when `input` changes. However, there is a subtle stale closure risk in the following scenario:

1. User types "git" (input = "git", handleNavigateUp closes over "git").
2. User presses Up arrow. `handleNavigateUp` is called: `setDraft("git")` then `navigateUp()` returns the most recent command. `onChange` sets the input to that command (e.g., "ls").
3. React re-renders. `input` is now "ls". BUT: `handleInputChange` is called by `onChange` in InputEditor, which calls `reset()` -- this resets the history index to null, undoing the navigation.

Wait -- let me trace this more carefully. When Up is pressed:

1. `handleKeyDown` in InputEditor calls `onNavigateUp()` which is `handleNavigateUp`.
2. `handleNavigateUp` calls `setDraft(input)` and `navigateUp()`, returns the command string.
3. Back in `handleKeyDown`, `onChange(prev)` is called with the returned command.
4. `onChange` is `handleInputChange`, which calls `setInput(newValue)`, `setDraft(newValue)`, and **`reset()`**.

**This is a bug.** The `reset()` call in `handleInputChange` clears the history navigation index immediately after `navigateUp()` set it. This means every Up arrow press would:
- Set the index to the most recent command via `navigateUp()`,
- Immediately reset it back to null via `handleInputChange` -> `reset()`.

So pressing Up repeatedly would always return the same most recent command, never walking backward through history.

However, looking at the InputEditor code more carefully:

```typescript
} else if (e.key === 'ArrowUp' && !e.shiftKey) {
  ...
  const prev = onNavigateUp?.();
  if (prev !== null && prev !== undefined) {
    onChange(prev);
  }
```

The `onChange` here IS `handleInputChange`, which calls `reset()`. This would break multi-press Up navigation.

**BUT** -- the tests pass, including `test_navigateUp_twice_returns_earlier`. Let me re-examine why...

The `useCommandHistory` test calls `navigateUp()` directly without going through the Terminal + InputEditor integration. The InputEditor test for `test_up_arrow_calls_onNavigateUp` mocks `onNavigateUp` and only checks that `onChange` is called with the right value. Neither test exercises the full integrated flow where `handleInputChange` -> `reset()` would interfere.

**This is a real integration bug.** When the user presses Up, the returned command is passed through `onChange` -> `handleInputChange` -> `reset()`, which resets the navigation index. The next Up press starts from the end of history again instead of continuing backward.

**Severity**: Medium (core feature is broken in integration -- Up arrow will always show only the most recent command).

**Recommendation**: The `onChange` path from arrow key navigation should NOT call `reset()`. Options:
1. Add a separate callback for history-driven value changes that calls `setInput` without `reset()`.
2. Have `handleNavigateUp`/`handleNavigateDown` call `setInput` directly instead of going through `onChange`.
3. Add a flag/ref that suppresses the `reset()` call when the change originated from arrow navigation.

Option (2) is cleanest:
```typescript
const handleNavigateUp = useCallback(() => {
  setDraft(input);
  const prev = navigateUp();
  if (prev !== null) {
    setInput(prev);  // Direct state update, bypasses handleInputChange
  }
  return prev;
}, [input, setDraft, navigateUp]);
```

Then in InputEditor, remove the `onChange(prev)` call after `onNavigateUp`:
```typescript
const prev = onNavigateUp?.();
// Don't call onChange -- the parent handles the state update
```

Actually, the current architecture has InputEditor calling `onChange` with the navigation result, which triggers `handleInputChange` -> `reset()`. The fix should ensure that the InputEditor's `onNavigateUp`/`onNavigateDown` callbacks handle state updates internally (or that the `onChange` call is gated).

---

### [F-04] GAP (Low): No test for repeated Up arrow walking through full history in integration

Related to F-03 above. The `useCommandHistory` unit test verifies `navigateUp` called twice returns the correct values, but no integration test verifies that pressing Up arrow multiple times in Terminal/InputEditor correctly walks through the history. If F-03 is fixed, an integration test for this scenario would be valuable.

**Recommendation**: Add a test in `InputEditor.test.tsx` or `Terminal.test.tsx` that simulates pressing ArrowUp multiple times and verifies each subsequent command is returned (not always the most recent).

---

### [F-05] NIT (Low): Ghost text suggestion recomputes on every history array change

**File**: `src/hooks/useGhostText.ts`, line 25

```typescript
}, [input, history]);
```

The `useMemo` depends on `history`, which is a state array. Every call to `addCommand` creates a new array reference via `setHistory`, which triggers the ghost text recomputation. This is correct behavior (the suggestion should update when history changes), but it also means that navigating through history (which doesn't change the `history` array) won't cause unnecessary recomputation. Good.

However, the `history` array identity changes on every `addCommand`, even when the command is a duplicate (because `setHistory` returns `prev` -- same reference). Actually, looking at the code:

```typescript
if (prev.length > 0 && prev[prev.length - 1] === command) {
  return prev;  // Same reference -- React won't re-render
}
```

This is correct -- React will skip the re-render when the same reference is returned. **No issue here.** Withdrawn.

---

### [F-06] NIT (Low): Ghost text displayed while browsing history

When the user presses Up arrow and a history command is displayed (e.g., "ls"), the ghost text will immediately try to match "ls" against history and may show a suggestion (e.g., "ls -la" -> ghost text " -la"). This could be visually confusing -- the user is browsing history, not typing, but they see ghost text suggestions.

This is a minor UX concern, not a correctness bug. The ghost text is harmless and the user can ignore it or press Tab to accept it. Warp has similar behavior. Acceptable for MVP.

**Severity**: Low (UX nit, not a correctness issue).

**Recommendation**: Optionally suppress ghost text while `historyIndex !== null` (i.e., while browsing history). Not required for this round.

---

### [F-07] GOOD: Multi-line arrow key safety is correctly implemented

**File**: `src/components/editor/InputEditor.tsx`, lines 44-71

The ArrowUp handler only intercepts when:
1. No shift key is held (`!e.shiftKey`).
2. No text selection exists (`selectionStart === selectionEnd`).
3. Cursor is on the first line (`!textBeforeCursor.includes('\n')`).

The ArrowDown handler mirrors this with a "last line" check (`!textAfterCursor.includes('\n')`).

This correctly preserves native textarea navigation in multi-line mode. The user can use Up/Down to move between lines, and only the first/last line triggers history navigation. Selection via Shift+Up/Down is also preserved.

---

### [F-08] GOOD: useCommandHistory uses refs for synchronous access

**File**: `src/hooks/useCommandHistory.ts`

The hook uses `historyRef` and `draftRef` alongside the state values to enable synchronous reads in `navigateUp`/`navigateDown`. This avoids the common React pitfall where `useState` values are stale within callbacks that close over them. The `navigateUp` and `navigateDown` callbacks have empty dependency arrays `[]`, which is correct because they only read from refs.

This is a well-considered design choice.

---

### [F-09] GOOD: Duplicate command suppression

**File**: `src/hooks/useCommandHistory.ts`, lines 33-36

```typescript
if (prev.length > 0 && prev[prev.length - 1] === command) {
  return prev;
}
```

Returns the same array reference to skip React re-render. Simple and correct. Matches the bash behavior of not adding consecutive duplicates.

---

### [F-10] GOOD: Tab behavior branching

**File**: `src/components/editor/InputEditor.tsx`, lines 24-43

The Tab key correctly branches:
- If `ghostText` is truthy, accept the suggestion by appending it to the value.
- If no ghost text, fall back to the existing 2-space insertion at cursor position.

The cursor repositioning via `requestAnimationFrame` for the space-insertion case is preserved and still correct.

---

### [F-11] GOOD: Test quality

The test suites are comprehensive and well-structured:

- **useCommandHistory.test.ts** (9 tests): Covers add, navigate up/down, boundary conditions (beginning, past end), draft restoration, reset, duplicate skip, and max history enforcement.
- **useGhostText.test.ts** (5 tests): Covers match, empty input, no match, recency preference, and multi-line suppression.
- **InputEditor.test.tsx** (5 new tests): Covers ghost text rendering, Tab with/without ghost text, and arrow key navigation callbacks.

All tests use proper `act()` wrapping for hook state mutations. The test names are descriptive and follow the existing naming convention.

---

## Required Changes

| ID | Severity | Description |
|----|----------|-------------|
| F-02 | Medium | Remove `historyIndex` from return value (unused, always stale) |
| F-03 | Medium | Fix Up/Down navigation: `handleInputChange` calls `reset()`, which clears the navigation index immediately after navigateUp/Down sets it. The integrated flow is broken -- repeated Up presses always return the most recent command. |

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-04 | Low | Add integration test for repeated Up arrow walking through history |
| F-06 | Low | Consider suppressing ghost text while browsing history |

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| useCommandHistory.test.ts | 9 | All pass |
| useGhostText.test.ts | 5 | All pass |
| InputEditor.test.tsx | 13 (5 new) | All pass |
| All other suites | 93 | All pass |
| **Total** | **120** | **All pass** |

Tests pass, but they do not catch the integration bug in F-03 because:
1. Hook tests call `navigateUp()` directly without flowing through `handleInputChange`.
2. InputEditor tests mock `onNavigateUp` and only verify the mock was called, not the full lifecycle.

---

## Verdict: NEEDS CHANGES

F-03 is a functional bug that breaks the core Up/Down history navigation feature when integrated end-to-end. Pressing Up arrow repeatedly will always show the most recent command because `handleInputChange` -> `reset()` fires on every navigation. This must be fixed before merge.

F-02 is a minor cleanup that should be addressed in the same fix commit.
