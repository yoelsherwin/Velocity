# Task 041: Block Selection (P1-B2)

## Context
Users can't select a block by clicking on it. Block navigation (Ctrl+Up/Down) sets a `focusedBlockIndex` but clicking anywhere in a block doesn't select it. This task adds click-to-select behavior.

## Requirements
### Frontend only.

1. **Click to select**: Clicking anywhere in a block's container selects it (sets `focusedBlockIndex`).
2. **Visual indicator**: Selected block gets the `.block-focused` class (already exists from TASK-027 — blue left border).
3. **Deselect**: Clicking outside any block (in empty terminal output area) deselects. Typing in InputEditor also deselects (already implemented).
4. **Multi-select**: NOT needed for MVP. Single selection only.
5. **Context menu**: NOT needed for MVP.
6. **Keyboard actions on selected block**: Enter/Space toggles collapse (already implemented from TASK-032).

## Tests
- [ ] `test_click_block_selects_it`: Click a block → focusedBlockIndex set to that block's index.
- [ ] `test_click_different_block_changes_selection`: Click block 0, then click block 2 → selection moves.
- [ ] `test_click_outside_deselects`: Click in empty area → focusedBlockIndex reset to -1.
- [ ] `test_selected_block_has_focused_class`: Selected block has `.block-focused` CSS class.

## Files to Read First
- `src/components/Terminal.tsx` — focusedBlockIndex state, block rendering
- `src/components/blocks/BlockView.tsx` — isFocused prop, click handling

## Acceptance Criteria
- [ ] Click selects a block
- [ ] Visual highlight on selected block
- [ ] Click outside deselects
- [ ] All tests pass
- [ ] Commit: `feat: add click-to-select block selection`
