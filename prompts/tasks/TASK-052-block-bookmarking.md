# Task 052: Block Bookmarking (P2-20)

## Context
Users run important commands and want to mark specific blocks for easy reference later. This task adds the ability to bookmark blocks and jump between bookmarked blocks.

## Requirements
### Frontend only.

1. **Bookmark toggle**: Add a bookmark icon (star or flag) to block actions. Clicking it toggles the block's bookmarked state.
2. **Visual indicator**: Bookmarked blocks have a colored star/flag icon in the header and a subtle accent left border (e.g., yellow `var(--accent-yellow)`).
3. **State**: Track bookmarked block IDs in a `Set<string>` in Terminal.tsx (like `collapsedBlocks`).
4. **Navigation**: Add `block.nextBookmark` and `block.prevBookmark` commands to the palette. These jump to the next/previous bookmarked block (similar to block navigation but only visiting bookmarks).
5. **Keyboard shortcut**: Ctrl+B to toggle bookmark on the focused block.
6. **Bookmark count**: Show bookmark count somewhere subtle (e.g., in the terminal status area or just in the command palette).
7. **Persistence**: Bookmarks are per-session only (not persisted to disk). They reset on restart.

## Tests
- [ ] `test_bookmark_toggle`: Click bookmark icon → block added to bookmarks set.
- [ ] `test_bookmarked_block_has_indicator`: Bookmarked block has `.block-bookmarked` class.
- [ ] `test_unbookmark`: Click again → block removed from bookmarks.
- [ ] `test_next_bookmark_navigation`: Jump to next bookmarked block.
- [ ] `test_prev_bookmark_navigation`: Jump to previous bookmarked block.
- [ ] `test_ctrl_b_toggles_bookmark`: Ctrl+B on focused block toggles bookmark.
- [ ] `test_no_bookmark_navigation_when_none`: No bookmarks → navigation does nothing.

## Files to Read First
- `src/components/blocks/BlockView.tsx` — Block actions, header
- `src/components/Terminal.tsx` — Block state, focusedBlockIndex
- `src/lib/commands.ts` — Command palette
- `src/App.css` — Block styling

## Acceptance Criteria
- [ ] Bookmark toggle on each block
- [ ] Visual indicator for bookmarked blocks
- [ ] Jump between bookmarks via palette commands
- [ ] Ctrl+B shortcut
- [ ] All tests pass
- [ ] Commit: `feat: add block bookmarking with navigation`
