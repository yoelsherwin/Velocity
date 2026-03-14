# Code Review: TASK-010 Split Panes (R1)

**Commit**: `f789ab6 feat: add split panes with independent terminal sessions per pane`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit adds split pane support to Velocity. Each tab now owns a recursive `PaneNode` tree where leaf nodes render independent `<Terminal />` components. A `PaneContainer` component recursively renders the tree. Pure utility functions in `pane-utils.ts` handle immutable tree operations (split, close, find, count, getLeafIds). Focus management tracks a single focused pane across all tabs. Keyboard shortcuts for split (Ctrl+Shift+Right, Ctrl+Shift+Down) and close pane (Ctrl+Shift+W) are wired up. All 100 tests pass (23 new tests across pane-utils, PaneContainer, and TabManager suites).

The implementation is clean and well-structured. The immutable tree approach is correct and the recursive rendering is sound. However, there are several issues ranging from a performance concern with inline closures to a missing max-pane bound that need attention.

---

## Findings

### [F-01] PERF (Medium): Inline closures in render cause unnecessary PaneContainer re-renders

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 202-210

```typescript
<PaneContainer
  node={tab.paneRoot}
  focusedPaneId={focusedPaneId}
  onFocusPane={handleFocusPane}
  onSplitPane={(paneId, dir) => handleSplitPane(tab.id, paneId, dir)}
  onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
  isOnlyPane={countLeaves(tab.paneRoot) === 1}
/>
```

The `onSplitPane` and `onClosePane` props are inline arrow functions that create new function references on every render. Since `PaneContainer` is a recursive component, every state change (including focus changes) will re-render the entire pane tree, and each `PaneContainer` node will always receive "new" callback props.

This is particularly impactful here because the pane tree can be deeply nested, and each level receives these callbacks. With `React.memo` (which is not currently applied, but would be the natural optimization), these inline closures would defeat memoization entirely.

**Recommended fix**: Either:
1. Pass `tabId` as a prop to `PaneContainer` and let it include the `tabId` in its callback invocations, so the parent can pass stable `useCallback` references, or
2. Wrap the closures with `useMemo`/`useCallback` per tab (e.g., using a factory pattern or storing per-tab callbacks in a ref/map).

Option 1 is cleaner:
```typescript
// PaneContainer receives tabId and calls onSplitPane(tabId, paneId, dir)
// TabManager passes stable handleSplitPane / handleClosePane directly
```

Not blocking for MVP (the pane tree is small), but this is the kind of issue that compounds as pane counts increase and will need to be fixed before adding drag-to-resize or animated transitions.

---

### [F-02] BUG (Medium): `handleSelectTab` abuses `setTabs` as a read accessor

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 122-137

```typescript
const handleSelectTab = useCallback(
  (tabId: string) => {
    updateActiveTabId(tabId);
    // Find the new tab and focus its first pane
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab) {
        const leafIds = getLeafIds(tab.paneRoot);
        updateFocusedPaneId(leafIds.length > 0 ? leafIds[0] : null);
      }
      return prev; // No mutation needed
    });
  },
  [updateActiveTabId, updateFocusedPaneId],
);
```

This calls `setTabs` with an updater that returns the previous state unmodified, purely to read the current `tabs` array. While React will bail out (no re-render since `prev === returnValue`), this is an anti-pattern that is surprising to read and may cause React to schedule unnecessary work internally (the bail-out check still runs).

**Recommended fix**: Use a `tabsRef` pattern (a ref that mirrors the `tabs` state) so `handleSelectTab` can read the current tabs without going through `setTabs`:

```typescript
const tabsRef = useRef(tabs);
tabsRef.current = tabs;

const handleSelectTab = useCallback(
  (tabId: string) => {
    updateActiveTabId(tabId);
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab) {
      const leafIds = getLeafIds(tab.paneRoot);
      updateFocusedPaneId(leafIds.length > 0 ? leafIds[0] : null);
    }
  },
  [updateActiveTabId, updateFocusedPaneId],
);
```

This is cleaner, more idiomatic, and avoids the confusing no-op `setTabs` call.

---

### [F-03] GAP (Medium): No max pane count enforcement

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, `handleSplitPane`

```typescript
const handleSplitPane = useCallback(
  (tabId: string, paneId: string, direction: PaneDirection) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        const newRoot = splitPane(tab.paneRoot, paneId, direction);
        return { ...tab, paneRoot: newRoot };
      }),
    );
  },
  [],
);
```

There is no upper bound on the number of panes. The task spec notes "Total panes bounded by MAX_SESSIONS=20 (same as tabs)" but this is only enforced on the Rust side (session creation will fail). On the frontend, a user could split endlessly -- each new pane creates a `<Terminal />` that calls `createSession`. Once `MAX_SESSIONS` is hit, new panes will show an error message in their terminal area, but the pane structure itself will keep growing.

More importantly, each split doubles the recursive rendering depth. A deeply nested tree with 20+ leaves will create 40+ PaneContainer instances, each receiving fresh inline closures per F-01.

**Recommended fix**: Add a `countLeaves` check before splitting:

```typescript
const handleSplitPane = useCallback(
  (tabId: string, paneId: string, direction: PaneDirection) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        if (countLeaves(tab.paneRoot) >= MAX_PANES) return tab;
        const newRoot = splitPane(tab.paneRoot, paneId, direction);
        return { ...tab, paneRoot: newRoot };
      }),
    );
  },
  [],
);
```

Where `MAX_PANES` could be a constant (e.g., 8 per tab) or derived from the backend `MAX_SESSIONS` limit.

---

### [F-04] BUG (Low): `Ctrl+-` conflicts with browser/webview zoom out

**File**: `C:\Velocity\src\components\layout\TabManager.tsx`, lines 163-170

```typescript
if (
  (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') ||
  (e.ctrlKey && e.key === '-')
) {
  e.preventDefault();
```

`Ctrl+-` is the standard zoom-out shortcut in web browsers and Tauri webviews. While `e.preventDefault()` suppresses the default behavior, this will surprise users who expect Ctrl+- to zoom out. The primary shortcut `Ctrl+Shift+Down` is sufficient and conflict-free.

Similarly, `Ctrl+\` (for horizontal split) may conflict with some terminal emulator conventions (SIGQUIT in Unix terminals), though this is less of a concern on Windows.

**Recommended fix**: Remove the `Ctrl+-` alternative or change it to something less likely to conflict (e.g., `Ctrl+Shift+-`). The `Ctrl+Shift+Arrow` shortcuts are the primary bindings and are sufficient.

---

### [F-05] GAP (Low): Terminal in PaneContainer has no stable key

**File**: `C:\Velocity\src\components\layout\PaneContainer.tsx`, line 28

```tsx
<Terminal />
```

The `<Terminal />` inside a leaf pane has no `key` prop. When the pane tree is restructured (e.g., a sibling is closed, causing the tree to collapse), React's reconciliation may re-use a Terminal instance for a different pane, or unmount and remount it unexpectedly. This could cause session loss.

Currently the tree structure changes cause the parent container to re-render, and since each leaf is identified by its `data-testid` on the wrapper div, React can typically match them. However, it is safer to explicitly key the Terminal:

```tsx
<Terminal key={node.id} />
```

This ensures that if the tree structure changes around a leaf (e.g., its parent split node is replaced by the leaf itself after a sibling close), React will retain the correct Terminal instance as long as the `node.id` stays the same.

---

### [F-06] NIT (Low): `isOnlyPane` is passed through the entire recursive tree

**File**: `C:\Velocity\src\components\layout\PaneContainer.tsx`, lines 81-83

```typescript
<PaneContainer
  ...
  isOnlyPane={isOnlyPane}
/>
```

The `isOnlyPane` prop is calculated at the `TabManager` level and passed through every level of the recursive tree. This works, but it means every `PaneContainer` node receives a prop it only uses at the leaf level. This is a minor readability concern -- a reader might wonder if split nodes also use `isOnlyPane` for something.

Not a blocking issue. Could be addressed by using React context or by only checking the condition in the leaf branch.

---

### [F-07] GAP (Low): No test for `Ctrl+Shift+Down` (vertical split)

**File**: `C:\Velocity\src\__tests__\TabManager.test.tsx`

The integration tests cover:
- `test_split_pane_creates_two_terminals` (uses Ctrl+Shift+ArrowRight -- horizontal split)
- `test_close_pane_removes_split` (uses Ctrl+Shift+W)

There is no test for the vertical split shortcut (Ctrl+Shift+Down). While the underlying `splitPane` utility is tested for both directions in `pane-utils.test.ts`, the keyboard shortcut wiring for vertical split is not covered.

**Recommended**: Add a test for Ctrl+Shift+Down that verifies a vertical split produces two terminals.

---

### [F-08] GAP (Low): No test for closing the close button when it is the only pane

**File**: `C:\Velocity\src\__tests__\PaneContainer.test.tsx`

The `PaneContainer` component conditionally hides the close button when `isOnlyPane` is true. This behavior is not tested. There should be a test that renders a leaf with `isOnlyPane={true}` and asserts the close button is absent, and another with `isOnlyPane={false}` asserting it is present.

---

### [F-09] GOOD: Immutable tree operations are correct

The `pane-utils.ts` functions are pure, immutable, and structurally correct:
- `splitPane` creates a new split node with the original leaf as `first` and a new leaf as `second`, preserving the original ID for focus continuity.
- `closePane` correctly collapses the parent split when a leaf is removed, promoting the sibling. The recursive case properly handles deep removal with null propagation.
- Reference equality checks (`newFirst === root.first`) provide structural sharing, avoiding unnecessary object creation when the target isn't found.

The 9 unit tests provide good coverage of the core operations including edge cases (close last, nested split, not-found).

---

### [F-10] GOOD: Focus management is well-designed

The `focusedPaneId` + `focusedPaneIdRef` pattern is consistent with the existing `activeTabId` pattern established in TASK-009 (following the R1 review recommendation). Focus is correctly:
- Set to the initial pane on tab creation
- Transferred to the first leaf when switching tabs
- Transferred to the first remaining leaf when the focused pane is closed
- Preserved after a split (the original pane stays focused)

---

### [F-11] GOOD: Security posture unchanged

No new IPC surface is introduced. Pane IDs use `crypto.randomUUID()` consistent with existing patterns. Each pane's Terminal independently creates its own session through the existing validated IPC path. No user input flows into any new unsafe path.

---

### [F-12] GOOD: `display: none` approach preserved

Inactive tabs still use `display: none`, which means all Terminals in all panes of all tabs remain mounted. This preserves PTY sessions and block history across tab switches. When a pane is closed, only that Terminal unmounts, triggering its cleanup `useEffect` to call `closeSession`. This is correct behavior.

---

### [F-13] GOOD: Clean recursive component design

`PaneContainer` is clean: base case (leaf) renders a Terminal with action buttons; recursive case (split) renders two children with a divider. The `e.stopPropagation()` on action buttons prevents the click from bubbling to the pane's `onClick` (which would set focus). The CSS correctly uses `flex` with `minWidth: 0` / `minHeight: 0` to prevent flex items from overflowing.

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| pane-utils.test.ts | 9 | All pass |
| PaneContainer.test.tsx | 5 | All pass |
| TabManager.test.tsx | 11 (2 new) | All pass |
| All other suites | 75 | All pass |
| **Total** | **100** | **All pass** |

Test quality is good for the utility functions. The PaneContainer tests properly mock `Terminal` to avoid PTY session creation. The TabManager integration tests cover the end-to-end split and close flows. Two gaps noted (F-07, F-08) are low severity.

---

## Required Changes for R2

| ID | Severity | Summary |
|----|----------|---------|
| F-02 | Medium | Refactor `handleSelectTab` to use a `tabsRef` instead of no-op `setTabs` |
| F-03 | Medium | Add a max pane count check in `handleSplitPane` |
| F-05 | Low | Add `key={node.id}` to `<Terminal />` in PaneContainer |

## Optional Improvements

| ID | Severity | Summary |
|----|----------|---------|
| F-01 | Medium | Avoid inline closures for `onSplitPane`/`onClosePane` in render |
| F-04 | Low | Remove `Ctrl+-` alternative shortcut (conflicts with zoom) |
| F-06 | Nit | Consider using context for `isOnlyPane` instead of prop drilling |
| F-07 | Low | Add test for Ctrl+Shift+Down (vertical split) |
| F-08 | Low | Add test for close button visibility when `isOnlyPane` varies |

---

**Verdict: NEEDS CHANGES**

Three items must be addressed: the no-op `setTabs` anti-pattern in `handleSelectTab` (F-02), the missing max pane count guard (F-03), and the missing `key` on `<Terminal />` (F-05). The inline closure performance concern (F-01) is recommended but not blocking for MVP. After the required changes, this is ready for approval.
