# Code Review: TASK-009 Tabbed Interface with Independent Sessions (R1)

**Commit**: `21d7967 feat: add tabbed interface with independent terminal sessions`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit adds a tabbed interface to Velocity. Each tab owns an independent `<Terminal />` component. Inactive tabs use `display: none` to preserve React state and PTY sessions across tab switches. A `TabBar` component renders tabs with close/new buttons, and `TabManager` manages tab lifecycle. Ctrl+T/W keyboard shortcuts are wired up. All 78 tests pass (12 new tests across TabBar, TabManager, and App test suites).

The implementation is clean, well-structured, and follows the task spec closely. The `display: none` approach is the right call for preserving terminal state. However, there are two issues that need to be fixed before approval -- one is a stale closure bug in `handleCloseTab`, and the other is a missing `Ctrl+W` test.

---

## Findings

### [F-01] BUG (Medium): `handleCloseTab` reads stale `activeTabId` from closure

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 29-48

```typescript
const handleCloseTab = useCallback(
  (tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;

      const index = prev.findIndex((t) => t.id === tabId);
      const newTabs = prev.filter((t) => t.id !== tabId);

      // If closing the active tab, switch to an adjacent tab
      if (tabId === activeTabId) {             // <-- reads from closure
        const newActiveIndex = index > 0 ? index - 1 : 0;
        setActiveTabId(newTabs[newActiveIndex].id);
      }

      return newTabs;
    });
  },
  [activeTabId],                                // <-- dependency
);
```

The `activeTabId` comparison on line 38 reads from the closure. While the `useCallback` does list `activeTabId` in its dependency array, calling `setActiveTabId` inside a `setTabs` updater is mixing two state transitions in a way that can lead to subtle ordering issues. More critically, because `handleCloseTab` is recreated every time `activeTabId` changes, it causes the `useEffect` for keyboard shortcuts (lines 51-65) to detach and reattach its event listener on every tab switch. This is unnecessary churn.

**Recommended fix**: Use a ref for `activeTabId` (like `activeTabIdRef`) so `handleCloseTab` can be stable (empty dependency array), or use a functional pattern where the active tab ID is derived from an external ref rather than closed over.

Alternatively, the simpler approach: since `setTabs` already uses the functional updater form to get the latest `prev` tabs, you could also track the active tab ID alongside the tabs in a single state object or use a separate `useRef` to hold the current `activeTabId`:

```typescript
const activeTabIdRef = useRef(activeTabId);
activeTabIdRef.current = activeTabId;

const handleCloseTab = useCallback(
  (tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const index = prev.findIndex((t) => t.id === tabId);
      const newTabs = prev.filter((t) => t.id !== tabId);

      if (tabId === activeTabIdRef.current) {
        const newActiveIndex = index > 0 ? index - 1 : 0;
        setActiveTabId(newTabs[newActiveIndex].id);
      }

      return newTabs;
    });
  },
  [],
);
```

This makes `handleCloseTab` referentially stable, which also stabilizes the keyboard shortcut `useEffect` and avoids unnecessary event listener teardown/reattach cycles.

---

### [F-02] GAP (Low): Missing `Ctrl+W` test

**File**: `C:\Velocity\src\__tests__\TabManager.test.tsx`

The task spec requires both `Ctrl+T` and `Ctrl+W` keyboard shortcuts. `test_ctrl_t_creates_new_tab` exists and tests Ctrl+T. However, there is no corresponding test for Ctrl+W closing the active tab. This should be added for symmetry and completeness.

**Recommended**: Add a test like:

```typescript
it('test_ctrl_w_closes_active_tab', async () => {
  render(<TabManager />);
  await waitFor(() => {
    expect(mockCreateSession).toHaveBeenCalled();
  });

  // Create a second tab first (can't close the last one)
  await act(async () => {
    fireEvent.keyDown(document, { key: 't', ctrlKey: true });
  });

  let tabButtons = screen.getAllByTestId(/^tab-button-/);
  expect(tabButtons).toHaveLength(2);

  // Press Ctrl+W to close the active tab
  await act(async () => {
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
  });

  tabButtons = screen.getAllByTestId(/^tab-button-/);
  expect(tabButtons).toHaveLength(1);
});
```

---

### [F-03] NIT (Low): `.tab-panel` missing `display` in CSS

**File**: `C:\Velocity\src\App.css`, lines 339-343

```css
.tab-panel {
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
```

The `flex-direction: column` property has no effect unless `display: flex` or `display: inline-flex` is set. Since the inline `style` attribute handles the display value (`flex` or `none`), this technically works at runtime -- when visible, `display: flex` is set via the inline style and `flex-direction: column` from the CSS class applies correctly. However, it reads as a mistake because `flex-direction` is meaningless without a display context in the static CSS. Adding a comment or restructuring to make the intent explicit would help maintainability.

Not a blocking issue -- it works correctly because the inline style provides `display: flex`.

---

### [F-04] STYLE (Low): Unused variable in test

**File**: `C:\Velocity\src\__tests__\TabBar.test.tsx`, line 75

```typescript
const closeButtons = screen.getAllByTestId(/^tab-close-/);
// Click close on the second tab
fireEvent.click(screen.getByTestId('tab-close-tab-2'));
```

The `closeButtons` variable is assigned but never used. The test directly queries `tab-close-tab-2` on the next line. Remove the unused variable.

---

### [F-05] GOOD: `display: none` approach is correct

The `display: none` strategy for inactive tabs is the right design choice. It preserves:
- React component state (blocks, input, session refs)
- PTY session connections (no unmount/remount cycle)
- Output buffer history

This avoids the expensive alternative of session serialization/deserialization. Each `<Terminal />` keeps its own `useEffect` cleanup intact and runs independently.

---

### [F-06] GOOD: Clean component separation

`TabBar` is a pure presentational component with no internal state. All behavior is lifted to `TabManager` via callback props. This follows the established pattern in the codebase (e.g., `BlockView`, `InputEditor`) and makes `TabBar` trivially testable, as demonstrated by the 6 TabBar tests that need no mocking.

---

### [F-07] GOOD: Proper accessibility attributes

The `TabBar` uses `role="tablist"`, `role="tab"`, `aria-selected`, and `aria-label` on the close buttons. This is a solid foundation for accessibility.

---

### [F-08] GOOD: Security posture unchanged

No new IPC surface is introduced. Tab IDs use `crypto.randomUUID()` consistent with the existing block ID pattern. No user input flows into any new unsafe path. The `SessionManager`'s `MAX_SESSIONS = 20` limit acts as a natural upper bound on tab count without needing additional validation.

---

### [F-09] OBSERVATION: No upper bound on tab count (frontend)

While the backend has `MAX_SESSIONS = 20`, the frontend has no limit on how many tabs a user can create. If a user creates 21+ tabs, the 21st session will fail to create. The `Terminal` component handles this gracefully (it shows the error in a block), but the user experience would be confusing -- they would see a tab with an error message rather than a proactive "max tabs reached" warning.

This is not blocking for MVP, but worth noting for a follow-up task.

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| TabBar.test.tsx | 6 | All pass |
| TabManager.test.tsx | 6 | All pass |
| App.test.tsx | 3 (1 new) | All pass |
| All other suites | 63 | All pass |
| **Total** | **78** | **All pass** |

Test quality is good. The mocking strategy for Tauri IPC (`createSession`, `startReading`, `listen`) is consistent with the existing `Terminal.test.tsx` pattern. The `test_switching_tabs_preserves_terminal` test directly validates the `display: none` mechanism by checking computed styles, which is the right approach.

The one gap is the missing `Ctrl+W` test (F-02).

---

## Required Changes for R2

| ID | Severity | Summary |
|----|----------|---------|
| F-01 | Medium | Fix `handleCloseTab` stale closure / stabilize with ref |
| F-02 | Low | Add `Ctrl+W` test |

## Optional Improvements

| ID | Severity | Summary |
|----|----------|---------|
| F-03 | Nit | Add comment or `display: flex` fallback to `.tab-panel` CSS |
| F-04 | Nit | Remove unused `closeButtons` variable in TabBar test |
| F-09 | Future | Consider frontend tab limit matching backend MAX_SESSIONS |

---

**Verdict: NEEDS CHANGES**

Two items to address: the stale closure in `handleCloseTab` (F-01) and the missing `Ctrl+W` test (F-02). The nits (F-03, F-04) are optional. After those two fixes, this is ready for approval.
