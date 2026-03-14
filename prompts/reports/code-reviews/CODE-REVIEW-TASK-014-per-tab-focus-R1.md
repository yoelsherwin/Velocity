# Code Review: TASK-014 Per-Tab Pane Focus Management (R1)

**Commit**: `b99bba1 feat: per-tab pane focus management`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Summary

This commit adds three new integration tests to `TabManager.test.tsx` that verify per-tab pane focus behavior: focus preserved across tab switches, split auto-focuses the new pane, and closing a pane focuses its sibling. The commit contains **only test additions** -- the actual implementation (moving `focusedPaneId` from global state into the `Tab` object, deriving it from the active tab, auto-focus on split, sibling-focus on close) was included in the earlier pane-resize commit `8613c86`.

The implementation (reviewed here in its entirety despite being in an earlier commit) is well-structured, and the tests are thorough. No blocking issues found.

---

## Files Changed

| File | Change |
|------|--------|
| `src/__tests__/TabManager.test.tsx` | MODIFIED: 3 new tests for per-tab focus behavior (+145 lines) |

### Implementation files reviewed (from commit `8613c86`, active at `b99bba1`):

| File | Relevant Logic |
|------|----------------|
| `src/components/layout/TabManager.tsx` | `focusedPaneId` derived from active tab, `findNewPaneId()` for auto-focus, sibling-focus on close |
| `src/components/layout/PaneContainer.tsx` | `pane-focused` CSS class driven by `focusedPaneId` prop, click-to-focus |
| `src/lib/types.ts` | `Tab.focusedPaneId: string \| null` field |
| `src/lib/pane-utils.ts` | `getLeafIds()` used for sibling focus fallback |

---

## Findings

### [F-01] GOOD: Focus derivation is correct and clean

**File**: `src/components/layout/TabManager.tsx`

```typescript
// Derive focusedPaneId from the active tab
const activeTab = tabs.find((t) => t.id === activeTabId);
const focusedPaneId = activeTab?.focusedPaneId ?? null;
```

The `focusedPaneId` is derived directly from the active tab on every render, rather than maintained as a separate piece of state. This eliminates any possibility of the focused pane ID getting out of sync with the active tab. The `?? null` fallback is appropriate for the case where `activeTab` is momentarily undefined (e.g., during tab close transitions).

---

### [F-02] GOOD: Ref sync for keyboard shortcut handlers

**File**: `src/components/layout/TabManager.tsx`

```typescript
const focusedPaneIdRef = useRef(focusedPaneId);
useEffect(() => {
  focusedPaneIdRef.current = focusedPaneId;
}, [focusedPaneId]);
```

The `focusedPaneIdRef` is kept in sync via `useEffect`, and the keyboard shortcut handler (registered once in a separate `useEffect`) reads from the ref. This is the standard React pattern for accessing current state in stable event listener callbacks without re-registering the listener on every change. Correct.

---

### [F-03] GOOD: Split auto-focus logic is sound

**File**: `src/components/layout/TabManager.tsx`

```typescript
function findNewPaneId(oldRoot: PaneNode, newRoot: PaneNode): string | null {
  const oldIds = new Set(getLeafIds(oldRoot));
  const newIds = getLeafIds(newRoot);
  for (const id of newIds) {
    if (!oldIds.has(id)) return id;
  }
  return null;
}
```

And in `handleSplitPane`:

```typescript
const newRoot = splitPane(tab.paneRoot, paneId, direction);
const newPaneId = findNewPaneId(tab.paneRoot, newRoot);
return {
  ...tab,
  paneRoot: newRoot,
  focusedPaneId: newPaneId ?? tab.focusedPaneId,
};
```

The `findNewPaneId` helper compares leaf IDs before and after the split to identify the newly created pane. This approach is robust -- it doesn't depend on tree structure assumptions, works for splits at any depth, and gracefully falls back to keeping the current focus if no new pane is found (defensive case that shouldn't normally occur).

The `splitPane` utility always places the new leaf as the `second` child and the original as `first`, so `findNewPaneId` will always find exactly one new ID. The `Set` lookup makes this O(n) where n is the number of leaves, which is bounded by `MAX_PANES_TOTAL = 20`.

---

### [F-04] GOOD: Close pane sibling-focus logic

**File**: `src/components/layout/TabManager.tsx`

```typescript
let newFocusedPaneId = tab.focusedPaneId;
if (tab.focusedPaneId === paneId) {
  const leafIds = getLeafIds(newRoot);
  newFocusedPaneId = leafIds.length > 0 ? leafIds[0] : null;
}
```

When the closed pane was the focused one, the first remaining leaf (in tree in-order traversal) receives focus. This is a reasonable heuristic. It correctly reads from `tab.focusedPaneId` (per-tab state) rather than a global ref, avoiding cross-tab contamination.

One minor note: `getLeafIds` returns leaves in in-order (left-to-right/top-to-bottom) traversal, so `leafIds[0]` is always the leftmost/topmost pane. This is a sensible default, though not necessarily the geometric "sibling" of the closed pane. For the two-pane case (the common case), it always picks the surviving pane, which is correct.

---

### [F-05] OBSERVATION (Low): `handleFocusPane` duplicates `updateFocusedPaneId` logic

**File**: `src/components/layout/TabManager.tsx`

```typescript
const updateFocusedPaneId = useCallback((paneId: string | null) => {
  setTabs((prev) =>
    prev.map((t) =>
      t.id === activeTabIdRef.current ? { ...t, focusedPaneId: paneId } : t,
    ),
  );
}, []);

const handleFocusPane = useCallback(
  (paneId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabIdRef.current ? { ...t, focusedPaneId: paneId } : t,
      ),
    );
  },
  [],
);
```

Both `updateFocusedPaneId` and `handleFocusPane` contain identical logic -- they update the `focusedPaneId` on the active tab. The only difference is that `updateFocusedPaneId` accepts `string | null` while `handleFocusPane` accepts `string`. In practice, `updateFocusedPaneId` is never called anywhere (it was the old API). It is dead code.

**Severity**: Low (dead code, no functional impact).

**Recommendation**: Remove `updateFocusedPaneId` since it is unused. `handleFocusPane` and the inline updates in `handleSplitPane` / `handleClosePane` handle all focus mutations.

---

### [F-06] GOOD: Tab switch preserves focus without extra logic

**File**: `src/components/layout/TabManager.tsx`

```typescript
const handleSelectTab = useCallback(
  (tabId: string) => {
    updateActiveTabId(tabId);
    // No need to update focusedPaneId; it's stored per-tab and will be
    // derived automatically from the new active tab
  },
  [updateActiveTabId],
);
```

This is the key benefit of the per-tab design: switching tabs requires zero focus-management code. The derived `focusedPaneId` naturally picks up the correct value from the newly active tab. Clean.

---

### [F-07] GOOD: PaneContainer receives correct focus for inactive tabs

**File**: `src/components/layout/TabManager.tsx`

```typescript
<PaneContainer
  node={tab.paneRoot}
  focusedPaneId={tab.id === activeTabId ? focusedPaneId : tab.focusedPaneId}
  ...
/>
```

For the active tab, the derived `focusedPaneId` is used (ensuring consistency). For inactive tabs, `tab.focusedPaneId` is used directly. Since inactive tabs are rendered with `display: none`, the focus styling is not visible, but this ensures correct state when switching back. The ternary could be simplified to just `tab.focusedPaneId` since `focusedPaneId` is derived from `activeTab?.focusedPaneId` anyway, but the explicit branching is harmless and arguably clearer about intent.

---

### [F-08] GOOD: Test quality -- `test_focus_preserved_across_tab_switch`

The test properly exercises the full round-trip:
1. Split pane in tab 1 (creating 2 panes).
2. Click the second pane to focus it.
3. Create tab 2 (switches away from tab 1).
4. Switch back to tab 1.
5. Verify the second pane is still focused.

The CSS selector `[data-testid^="tab-panel-"]:not([style*="display: none"]) .pane-focused` correctly targets only the visible tab panel, avoiding false matches from the hidden tab 2 panel.

---

### [F-09] GOOD: Test quality -- `test_split_focuses_new_pane`

The test captures the initial pane's `data-testid` before the split, then after splitting verifies that the focused pane is NOT the original. This is a robust approach -- it doesn't need to know the new pane's ID in advance, only that focus moved away from the original.

---

### [F-10] GOOD: Test quality -- `test_close_pane_focuses_sibling`

The test correctly identifies the unfocused (sibling) pane before closing, then verifies that after closing the focused pane, the remaining pane matches the sibling's test ID and has the `pane-focused` class. This validates both that the correct pane survives and that it receives focus.

---

### [F-11] OBSERVATION (Low): Unused variable in test

**File**: `src/__tests__/TabManager.test.tsx`

```typescript
const tab1PanesAfter = document.querySelectorAll(
  `[data-testid^="tab-panel-"]:not([style*="display: none"]) [data-testid^="pane-"]`,
);
```

In `test_focus_preserved_across_tab_switch`, the variable `tab1PanesAfter` is assigned but never read. It appears to have been intended for an assertion that was later replaced by the `focusedPane` query below it.

**Severity**: Low (unused variable, no functional impact on test correctness).

**Recommendation**: Remove the unused `tab1PanesAfter` declaration.

---

## Required Changes

None. No blocking or medium-severity issues found.

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-05 | Low | Remove dead code: `updateFocusedPaneId` callback is unused (replaced by `handleFocusPane` and inline updates) |
| F-11 | Low | Remove unused `tab1PanesAfter` variable in `test_focus_preserved_across_tab_switch` |

---

## Test Assessment

| Suite | Tests | Notes |
|-------|-------|-------|
| TabManager.test.tsx | 3 new | Focus preservation, split auto-focus, close sibling-focus |

The three tests cover the three core behaviors of the per-tab focus feature:
1. **Preservation**: Focus survives tab switch round-trip.
2. **Auto-focus on split**: Newly created pane receives focus.
3. **Sibling-focus on close**: Remaining pane receives focus when focused pane is closed.

Test quality is high. Selectors are precise, assertions are specific, and the tests exercise real user interactions (click, keyboard shortcuts) rather than directly manipulating state.

**Missing test coverage** (acceptable for this scope):
- Closing an unfocused pane does NOT change focus (i.e., the focused pane stays focused). Currently only the "close the focused pane" case is tested.
- Focus behavior with 3+ panes (nested splits). The current tests all use 2-pane scenarios.
- Keyboard-driven focus cycling between panes (Ctrl+Tab or similar) -- this feature does not exist yet, so no test is needed.

---

## Verdict: APPROVE

The per-tab focus implementation is well-designed. Moving `focusedPaneId` into the `Tab` object and deriving it from the active tab eliminates an entire class of state synchronization bugs. The split auto-focus and close sibling-focus behaviors are correctly implemented. The three new tests are well-written and cover the core scenarios. The two optional improvements (dead code removal, unused variable) are minor and do not warrant blocking the merge.
