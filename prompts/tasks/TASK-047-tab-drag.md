# Task 047: Tab Drag Reordering (P2-5)

## Context
Users can't reorder tabs by dragging. This task adds drag-and-drop reordering in the TabBar.

## Requirements
### Frontend only.

1. **Drag handle**: Each tab is draggable. Use HTML5 drag and drop API (`draggable`, `onDragStart`, `onDragOver`, `onDrop`).
2. **Visual feedback**: Show a drop indicator (vertical line or highlighted gap) between tabs where the tab will be inserted.
3. **Reorder logic**: On drop, move the dragged tab to the new position in the `tabs` array in TabManager.
4. **Active tab preserved**: The active tab stays active after reordering.
5. **CSS**: Add `.tab-dragging` (opacity 0.5) and `.tab-drop-indicator` styles.

## Tests
- [ ] `test_tab_has_draggable_attribute`: Tab elements have `draggable="true"`.
- [ ] `test_drag_start_sets_data`: DragStart event sets transfer data.
- [ ] `test_drop_reorders_tabs`: Drag tab 0 to position 2 → tabs reordered.
- [ ] `test_active_tab_preserved_after_reorder`: Active tab ID unchanged after reorder.
- [ ] `test_dragging_tab_has_opacity`: Dragging tab gets `.tab-dragging` class.

## Files to Read First
- `src/components/layout/TabBar.tsx` — Tab rendering
- `src/components/layout/TabManager.tsx` — Tab state
- `src/App.css` — Tab styling

## Acceptance Criteria
- [ ] Tabs can be reordered by drag and drop
- [ ] Visual drop indicator
- [ ] Active tab preserved
- [ ] All tests pass
- [ ] Commit: `feat: add tab drag reordering`
