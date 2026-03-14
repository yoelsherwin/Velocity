# Task 013: Draggable Pane Divider Resizing

## Context

Split panes exist (TASK-010) but the ratio is fixed at 0.5. This task adds drag-to-resize on the pane dividers.

### Current State
- **`src/components/layout/PaneContainer.tsx`**: Renders split nodes with a `.pane-divider` element between children. Each child has `flex: node.ratio` and `flex: 1 - node.ratio`.
- **`src/lib/types.ts`**: `PaneNode` split type has `ratio: number` field.
- **`src/lib/pane-utils.ts`**: `splitPane` creates splits with `ratio: 0.5`.
- **`src/App.css`**: `.pane-divider` has cursor styling but no drag behavior.

### Design

Add mousedown/mousemove/mouseup handlers on the `.pane-divider`. On drag, calculate the new ratio based on mouse position relative to the parent split container, and call a callback to update the pane tree.

## Requirements

### Frontend Changes

#### 1. Add `onResizePane` callback to PaneContainer

```typescript
interface PaneContainerProps {
  // ... existing props
  onResizePane: (paneId: string, newRatio: number) => void;  // NEW
}
```

#### 2. Divider drag handler

In PaneContainer, for split nodes, add drag handling on the divider:

```typescript
function usePaneDrag(
  splitId: string,
  direction: PaneDirection,
  onResize: (id: string, ratio: number) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      let ratio: number;
      if (direction === 'horizontal') {
        ratio = (moveEvent.clientX - rect.left) / rect.width;
      } else {
        ratio = (moveEvent.clientY - rect.top) / rect.height;
      }
      // Clamp between 0.1 and 0.9 (minimum 10% per pane)
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      onResize(splitId, ratio);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [splitId, direction, onResize]);

  return { containerRef, handleMouseDown };
}
```

Apply to the divider:
```tsx
<div className="pane-divider" onMouseDown={handleMouseDown} />
```

And the container:
```tsx
<div ref={containerRef} className={`pane-split pane-split-${node.direction}`} ...>
```

#### 3. Add `updateRatio` to pane-utils.ts

```typescript
export function updatePaneRatio(root: PaneNode, splitId: string, newRatio: number): PaneNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) {
    return { ...root, ratio: newRatio };
  }
  return {
    ...root,
    first: updatePaneRatio(root.first, splitId, newRatio),
    second: updatePaneRatio(root.second, splitId, newRatio),
  };
}
```

#### 4. Wire into TabManager

Add `handleResizePane` that updates the tab's pane tree:
```typescript
const handleResizePane = useCallback((tabId: string, splitId: string, newRatio: number) => {
  setTabs(prev => prev.map(t =>
    t.id === tabId ? { ...t, paneRoot: updatePaneRatio(t.paneRoot, splitId, newRatio) } : t
  ));
}, []);
```

Pass to PaneContainer.

#### 5. Styles
Add hover/active state to divider:
```css
.pane-divider:hover {
  background-color: #45475a;
}
.pane-divider:active {
  background-color: #89b4fa;
}
```

## Tests (Write These FIRST)

### Pane Utils Tests (`src/__tests__/pane-utils.test.ts`)
- [ ] **`test_updatePaneRatio`**: Create a split with ratio 0.5. Update to 0.7. Assert the ratio changed.
- [ ] **`test_updatePaneRatio_nested`**: Create a nested split. Update an inner split's ratio. Assert only the target changed.
- [ ] **`test_updatePaneRatio_clamps`**: (handled by the component, not the util — skip)

### PaneContainer Tests (`src/__tests__/PaneContainer.test.tsx`)
- [ ] **`test_divider_has_mousedown_handler`**: Render a split. Assert the divider element exists and can be interacted with.

## Acceptance Criteria
- [ ] Dragging the pane divider resizes panes
- [ ] Ratio clamped between 0.1 and 0.9 (minimum 10% per pane)
- [ ] Cursor changes to col-resize/row-resize during drag
- [ ] Text selection disabled during drag
- [ ] `updatePaneRatio` utility function added
- [ ] All tests pass
- [ ] Clean commit: `feat: add draggable pane divider resizing`

## Files to Read First
- `src/components/layout/PaneContainer.tsx` — Add drag handlers
- `src/lib/pane-utils.ts` — Add updatePaneRatio
- `src/components/layout/TabManager.tsx` — Wire handleResizePane
- `src/App.css` — Divider hover/active styles
