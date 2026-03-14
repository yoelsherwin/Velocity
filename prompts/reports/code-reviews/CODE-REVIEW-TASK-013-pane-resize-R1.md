# Code Review: TASK-013 Draggable Pane Divider Resizing

**Commit**: `8613c86 feat: add draggable pane divider resizing`
**Diff range**: `92df2bc..8613c86`
**Reviewer**: Claude Code Reviewer
**Date**: 2026-03-14
**Verdict**: **APPROVE**

---

## Summary

This commit adds interactive drag-to-resize on pane dividers. It also includes a valuable refactor: `focusedPaneId` is now stored per-tab on the `Tab` type rather than as global state in `TabManager`, and split operations auto-focus the newly created pane. The implementation is clean, well-tested, and correctly handles event listener lifecycle.

## Files Changed

| File | Type | Lines |
|------|------|-------|
| `src/components/layout/PaneContainer.tsx` | Major change | Extracted `SplitPane` component + `usePaneDrag` hook |
| `src/components/layout/TabManager.tsx` | Major refactor | Per-tab focusedPaneId, resize handler, findNewPaneId |
| `src/lib/pane-utils.ts` | Addition | `updatePaneRatio()` function |
| `src/lib/types.ts` | Addition | `focusedPaneId` field on `Tab` |
| `src/App.css` | Addition | Divider hover/active states, exit-code styles |
| `src/__tests__/PaneContainer.test.tsx` | Addition | 4 drag-related tests |
| `src/__tests__/pane-utils.test.ts` | Addition | 4 updatePaneRatio tests |

---

## Detailed Findings

### POSITIVE: Correct Hook Architecture

The split-node rendering was extracted into a dedicated `SplitPane` component so that `usePaneDrag` is called unconditionally at the component top level. This avoids the React hook rules violation that would occur if the hook were called conditionally inside `PaneContainer`'s split branch. This is the right approach.

### POSITIVE: Proper Event Listener Cleanup

```typescript
const handleMouseUp = () => {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};
```

The mouseup handler correctly removes both `mousemove` and `mouseup` listeners, and resets `cursor` and `userSelect` styles. No leak path exists -- even if the mouse leaves the window, the `mouseup` on `document` will still fire when the mouse returns and is released. This is the standard pattern for drag operations.

### POSITIVE: Cursor and Selection Management During Drag

Setting `document.body.style.userSelect = 'none'` during drag prevents text selection, which would cause visual glitches and interfere with the drag operation. Setting `document.body.style.cursor` ensures the resize cursor persists even when the mouse moves outside the divider during fast drags. Both are correctly cleaned up on mouseup.

### POSITIVE: Immutable `updatePaneRatio`

The `updatePaneRatio` function follows the established immutable pattern used by `splitPane` and `closePane`:

- Returns the original node by reference when no change is detected (referential equality optimization).
- Leaf nodes are returned as-is (early exit).
- Only creates new objects along the path to the changed node.

This means React's reconciliation can efficiently skip re-rendering unchanged subtrees.

### POSITIVE: Per-Tab Focus State Refactor

Moving `focusedPaneId` from `TabManager` state into `Tab` is architecturally sound. Each tab now preserves its own focus state when switching between tabs, rather than losing focus context. This eliminates the previous behavior where switching tabs would reset the focused pane to the first leaf.

### POSITIVE: Test Quality

The 8 new tests (4 for `PaneContainer` drag, 4 for `updatePaneRatio`) cover:
- Divider existence and mousedown handler
- Drag producing correct ratio for horizontal splits
- Ratio clamping at both bounds (0.1 and 0.9)
- Vertical splits using clientY instead of clientX
- updatePaneRatio on flat and nested trees
- Leaf-node passthrough (returns same reference)
- Not-found passthrough (returns same reference)

The `getBoundingClientRect` mocking approach is correct: the mock is set on the `containerRef` element (the `.pane-split` div), matching how the drag handler reads it.

### MINOR: `rect` Captured Once at mousedown (By Design)

```typescript
const handleMouseDown = useCallback((e: React.MouseEvent) => {
  // ...
  const rect = container.getBoundingClientRect();  // captured once
  const handleMouseMove = (moveEvent: MouseEvent) => {
    // uses rect from closure
  };
```

The bounding rect is captured at the start of the drag rather than re-queried on each mousemove. This is intentional and correct for this use case -- the container position should not change during a single drag operation, and re-querying the rect on every mousemove would be wasteful. If the window is scrolled during a drag it could produce a slight offset, but that is an extremely edge-case scenario for a terminal application and not worth the overhead.

### MINOR: `onResizePane` is Optional on `PaneContainer` but Required on `SplitPane`

```typescript
interface PaneContainerProps {
  onResizePane?: (splitId: string, newRatio: number) => void;  // optional
}

interface SplitPaneProps {
  onResizePane: (splitId: string, newRatio: number) => void;   // required
}
```

This is bridged by the `noopResize` constant:

```typescript
onResizePane={onResizePane ?? noopResize}
```

This is acceptable -- `noopResize` is a module-level constant so it is referentially stable and will not cause unnecessary re-renders. The approach keeps the external API flexible while keeping the internal component simple. No issue here.

### MINOR: `findNewPaneId` Helper

The `findNewPaneId` function compares leaf IDs before and after a split to find the newly created pane. This is O(n) where n is the number of leaves, but since `MAX_PANES_TOTAL = 20`, this is negligible. The function is only called during split operations (user-initiated), not during renders or drags, so there is no performance concern.

### NOTE: Unrelated CSS Changes Included

The diff includes `block-header-right`, `block-exit-code`, `exit-success`, and `exit-failure` CSS classes that appear related to a different task (exit code display in blocks). These appear harmless -- they are purely additive CSS rules that do not affect existing styles. However, it would be cleaner to commit these in their own task. This is a minor process observation, not a blocking issue.

### VERIFY: No `updateFocusedPaneId` Dead Code

The `updateFocusedPaneId` callback is still defined in `TabManager` (line 60-66) but its only remaining call site appears to be... none. `handleFocusPane` now uses inline `setTabs` directly (line 107-111). `handleNewTab` no longer calls it. `handleCloseTab` no longer calls it. `handleSelectTab` no longer calls it.

**This is dead code.** The `updateFocusedPaneId` callback on lines 60-66 of `TabManager.tsx` is defined but never invoked. It should be removed.

**Severity**: Low. It has zero runtime impact -- it is just an unused function. But it adds cognitive overhead for future readers.

---

## Test Results

```
Test Files  16 passed (16)
     Tests  150 passed (150)
```

All existing tests continue to pass. No regressions.

---

## Verdict: APPROVE

The implementation is correct, well-structured, and well-tested. The drag handler lifecycle is clean with no leak paths. The per-tab focus refactor is a valuable improvement that was necessary for correct tab-switching behavior. The `updatePaneRatio` utility follows established immutable tree patterns.

**One cleanup item** (non-blocking): Remove the dead `updateFocusedPaneId` callback from `TabManager.tsx`.
