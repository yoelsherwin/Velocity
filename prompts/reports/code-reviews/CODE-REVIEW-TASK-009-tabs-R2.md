# Code Review: TASK-009 Tabbed Interface with Independent Sessions (R2)

**Commit**: `7d8975e fix: stabilize tab close callback and add Ctrl+W test`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Summary

This is the R2 follow-up review for TASK-009. The fix commit addresses both required changes from R1: the stale closure bug in `handleCloseTab` (F-01) and the missing `Ctrl+W` test (F-02). The implementation is clean and correct. All 79 tests pass.

---

## Previous Round Resolution

### [F-01] BUG (Medium): `handleCloseTab` reads stale `activeTabId` from closure -- RESOLVED

**Status**: Fixed correctly.

The fix introduces an `activeTabIdRef` ref and an `updateActiveTabId` wrapper function that keeps the ref and state in sync:

```typescript
const activeTabIdRef = useRef(activeTabId);

const updateActiveTabId = useCallback((id: string) => {
  activeTabIdRef.current = id;
  setActiveTabId(id);
}, []);
```

All three sites that previously used `activeTabId` directly now use the ref or the wrapper:

1. **`handleCloseTab`** (line 44): Compares against `activeTabIdRef.current` instead of the closed-over `activeTabId`. The dependency array is now `[updateActiveTabId]` (stable) instead of `[activeTabId]` (changes on every tab switch).

2. **`handleNewTab`** (line 32): Calls `updateActiveTabId(newTab.id)` instead of `setActiveTabId(newTab.id)`. Dependency array is `[updateActiveTabId]` (stable).

3. **Keyboard shortcut `useEffect`** (line 65): Reads `activeTabIdRef.current` for the Ctrl+W handler. The dependency array is now `[handleNewTab, handleCloseTab]` -- both of which are now referentially stable since they no longer depend on `activeTabId`. This eliminates the unnecessary event listener teardown/reattach cycle on every tab switch.

4. **`TabBar` onSelectTab** (line 78): Passes `updateActiveTabId` instead of `setActiveTabId`, ensuring the ref stays in sync when tabs are clicked directly.

The approach follows the recommended pattern from R1 precisely. The ref and state setter are always updated together through the single `updateActiveTabId` entry point, which prevents any divergence between the ref value and the React state.

**Correctness verification**: The `updateActiveTabId` callback has an empty dependency array `[]`, which is correct because both `activeTabIdRef` (a ref, stable identity) and `setActiveTabId` (a state setter, stable identity) are referentially stable across renders. No stale captures are possible.

---

### [F-02] GAP (Low): Missing `Ctrl+W` test -- RESOLVED

**Status**: Fixed correctly.

A new test `test_ctrl_w_closes_active_tab` has been added (lines 163-191 of `TabManager.test.tsx`). The test:

1. Renders `TabManager` and waits for session creation
2. Creates a second tab via `Ctrl+T`
3. Asserts 2 tabs exist and the second is active
4. Fires `Ctrl+W` keydown
5. Asserts only 1 tab remains
6. Asserts the remaining tab is active

This covers the full Ctrl+W flow including the active-tab-switching logic, which is exactly the code path that F-01 fixed. The test exercises the ref-based approach end-to-end: create a tab (updates ref), then close it via keyboard shortcut (reads ref). If the stale closure bug were reintroduced, this test would catch it.

The test follows the established pattern of the existing `test_ctrl_t_creates_new_tab` test and uses proper `act` + `waitFor` wrappers.

---

## R1 Optional Items Status

| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| F-03 | Nit | `.tab-panel` CSS missing explicit `display` | Not addressed (acceptable -- works correctly at runtime) |
| F-04 | Nit | Unused `closeButtons` variable in TabBar test | Not addressed (acceptable -- cosmetic only) |
| F-09 | Future | Frontend tab limit matching backend MAX_SESSIONS | Deferred (not required for this task) |

None of these were required. They remain as optional improvements for future work.

---

## New Findings

### [F-10] OBSERVATION: `updateActiveTabId` ref sync pattern is sound

The chosen pattern of wrapping the ref update and state setter in a single `useCallback` is preferable to the alternative of assigning `activeTabIdRef.current = activeTabId` in the render body. The render-body approach can have a one-render delay where the ref holds a stale value during concurrent rendering. The `updateActiveTabId` wrapper ensures the ref is always updated atomically alongside the state setter call. This is the more robust pattern.

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| TabBar.test.tsx | 6 | All pass |
| TabManager.test.tsx | 7 (+1 new) | All pass |
| App.test.tsx | 3 | All pass |
| All other suites | 63 | All pass |
| **Total** | **79** | **All pass** |

The new `test_ctrl_w_closes_active_tab` test directly validates the fix for F-01 by exercising the keyboard-shortcut-triggered close path that previously had the stale closure issue.

---

## Verdict: APPROVE

Both required changes from R1 are resolved correctly:

- **F-01**: The stale closure bug is eliminated via `activeTabIdRef` + `updateActiveTabId`. All callbacks are now referentially stable. The keyboard shortcut `useEffect` no longer re-registers on tab switches.
- **F-02**: The `Ctrl+W` test is added and exercises the exact code path that was buggy.

The fix is minimal, focused, and introduces no regressions. Ready to proceed.
