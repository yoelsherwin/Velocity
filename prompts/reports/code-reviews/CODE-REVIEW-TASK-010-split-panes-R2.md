# Code Review: TASK-010 Split Panes (R2 -- Fix Commit)

**Commit**: `90df1d1 fix: address code review findings for split panes -- refs, limits, keys, shortcuts`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Previous Round Resolution

### [F-02] BUG (Medium): `handleSelectTab` abuses `setTabs` as a read accessor -- RESOLVED

**R1 requirement**: Refactor `handleSelectTab` to use a `tabsRef` instead of no-op `setTabs`.

**What changed**:
1. A `tabsRef` was added at line 21: `const tabsRef = useRef(tabs);`
2. A `useEffect` at lines 30-33 keeps it in sync: `tabsRef.current = tabs;`
3. `handleSelectTab` (lines 135-146) now reads from `tabsRef.current` instead of calling `setTabs` with a no-op updater.

**Assessment**: Correctly resolved. The `tabsRef` pattern is idiomatic React and eliminates the anti-pattern. The `useEffect` sync approach is the standard way to keep a ref in sync with state. The dependency array `[tabs]` is correct.

One minor note: the ref could alternatively be updated inline during render (i.e., `tabsRef.current = tabs` placed directly in the component body before hooks that read it) to avoid the one-render delay inherent in `useEffect`. In practice this is not observable here because `handleSelectTab` is only called from user interactions (click/keyboard), which always occur after effects have flushed. Acceptable as-is.

---

### [F-03] GAP (Medium): No max pane count enforcement -- RESOLVED

**R1 requirement**: Add a max pane count check in `handleSplitPane`.

**What changed**:
1. A constant `MAX_PANES_TOTAL = 20` was added at line 7.
2. `handleSplitPane` (lines 91-107) now computes the total pane count across ALL tabs before splitting:
   ```typescript
   const totalPanes = prev.reduce((sum, t) => sum + countLeaves(t.paneRoot), 0);
   if (totalPanes >= MAX_PANES_TOTAL) return prev;
   ```

**Assessment**: Correctly resolved. The guard is inside the `setTabs` updater function, so it reads the latest state atomically. The limit is applied globally across all tabs (not per-tab), which aligns with the backend `MAX_SESSIONS` constraint since each leaf pane creates one session.

The value of 20 matches the Rust-side `MAX_SESSIONS` constant documented in the architecture. This prevents the frontend from creating panes that would fail at session creation time.

---

### [F-04] BUG (Low): `Ctrl+-` conflicts with browser/webview zoom out -- RESOLVED

**R1 recommendation**: Remove the `Ctrl+-` alternative shortcut.

**What changed**: The vertical split keyboard handler (lines 172-177) now only responds to `Ctrl+Shift+Down`:
```typescript
if (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') {
```

The `(e.ctrlKey && e.key === '-')` alternative has been removed entirely.

**Assessment**: Correctly resolved. The conflicting shortcut is gone. `Ctrl+\` for horizontal split remains, which is acceptable (less likely to conflict on Windows).

---

### [F-05] GAP (Low): Terminal in PaneContainer has no stable key -- RESOLVED

**R1 requirement**: Add `key={node.id}` to `<Terminal />` in PaneContainer.

**What changed**: Line 28 of `PaneContainer.tsx`:
```tsx
<Terminal key={node.id} />
```

**Assessment**: Correctly resolved. The key ensures React's reconciler correctly identifies Terminal instances during tree restructuring (e.g., when a sibling is closed and the tree collapses). This prevents accidental session loss or component remounting.

---

### [F-07] GAP (Low): No test for `Ctrl+Shift+Down` (vertical split) -- RESOLVED

**R1 recommendation**: Add a test for the vertical split shortcut.

**What changed**: A new test `test_ctrl_shift_down_splits_vertically` was added (lines 297-325 of `TabManager.test.tsx`). It:
1. Renders `TabManager` and waits for session creation.
2. Asserts 1 terminal exists initially.
3. Fires `Ctrl+Shift+ArrowDown`.
4. Asserts 2 terminals exist.
5. Verifies a `.pane-split-vertical` container was created.

**Assessment**: Correctly resolved. The test covers both the keyboard shortcut wiring and the correct split direction. The `.pane-split-vertical` class assertion is a good addition that validates the direction was applied correctly, going beyond what the horizontal split test does.

---

## Remaining R1 Items (Not Required)

| ID | Status | Notes |
|----|--------|-------|
| F-01 | Deferred | Inline closures for `onSplitPane`/`onClosePane` remain. Acceptable for MVP; should be addressed when adding drag-to-resize. |
| F-06 | Deferred | `isOnlyPane` prop drilling remains. Cosmetic; not blocking. |
| F-08 | Deferred | No test for close button visibility based on `isOnlyPane`. Low priority. |

---

## New Observations on the Fix Commit

### [N-01] GOOD: Global pane limit is correctly scoped

The max pane check computes a cross-tab total rather than per-tab. This is the right choice because all panes share the same backend session pool. A user with 4 tabs of 5 panes each (20 total) will be correctly blocked from creating a 21st pane in any tab.

### [N-02] GOOD: No regressions

All 101 tests pass (13 test files, 101 tests). The new test brings TabManager test count from 11 to 12. No existing tests were modified.

### [N-03] NIT: `useEffect` sync vs inline ref update

The `tabsRef` sync uses `useEffect`, which runs after render. An inline assignment (`tabsRef.current = tabs` in the component body) would be synchronous. As noted above, this has no practical impact since `handleSelectTab` is only invoked from user interactions. Not a required change.

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| pane-utils.test.ts | 9 | All pass |
| PaneContainer.test.tsx | 5 | All pass |
| TabManager.test.tsx | 12 (1 new) | All pass |
| All other suites | 75 | All pass |
| **Total** | **101** | **All pass** |

---

## Summary

All three required changes from R1 (F-02, F-03, F-05) have been correctly addressed. Both optional items that were picked up (F-04, F-07) are also correctly resolved. The implementations are clean, idiomatic, and introduce no regressions. The fix commit is minimal and focused -- it changes only what was requested with no unrelated modifications.

---

**Verdict: APPROVE**
