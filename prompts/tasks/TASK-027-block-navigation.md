# Task 027: Block Navigation with Ctrl+Up/Down (P1-B1)

## Context

Users can't quickly jump between command blocks in the terminal output. They have to scroll manually. This task adds Ctrl+Up (previous block) and Ctrl+Down (next block) keyboard shortcuts that scroll to and highlight the target block.

### What exists now

- **Terminal.tsx**: Manages `blocks` array, has `outputRef` pointing to `.terminal-output` div. Keyboard handlers exist for Ctrl+Shift+F (search).
- **BlockView.tsx**: Each block has `data-testid="block-container"` and a `.block-container` CSS class.
- **TabManager.tsx**: Global keyboard handler for Ctrl+T, Ctrl+W, etc.

## Requirements

### Frontend only — no Rust changes.

1. **Keyboard shortcuts**: Ctrl+Up scrolls to the previous block, Ctrl+Down scrolls to the next block. Register in Terminal.tsx (pane-level, not global).

2. **Focused block state**: Track a `focusedBlockIndex` in Terminal.tsx. Default: -1 (no block focused). Ctrl+Down from -1 goes to the first block. Ctrl+Up from -1 goes to the last block.

3. **Scroll behavior**: `scrollIntoView({ block: 'nearest', behavior: 'smooth' })` on the target block container.

4. **Visual indicator**: The focused block gets a subtle left border highlight (e.g., `border-left: 2px solid #89b4fa` — same blue as pane focus). CSS class: `.block-focused`.

5. **Reset**: `focusedBlockIndex` resets to -1 when the user types in the InputEditor, submits a command, or clicks in the output area.

6. **Wrapping**: Ctrl+Down from the last block stays at the last block (no wrap). Ctrl+Up from the first block stays at the first block.

7. **Register in command palette**: Add `block.prev` and `block.next` commands to `src/lib/commands.ts`.

## Tests

- [ ] `test_ctrl_down_focuses_first_block`: From no focus, Ctrl+Down focuses block 0.
- [ ] `test_ctrl_down_advances_to_next`: From block 0, Ctrl+Down focuses block 1.
- [ ] `test_ctrl_up_focuses_last_block`: From no focus, Ctrl+Up focuses the last block.
- [ ] `test_ctrl_up_goes_to_previous`: From block 2, Ctrl+Up focuses block 1.
- [ ] `test_focus_resets_on_input`: After focusing a block, typing resets focus to -1.
- [ ] `test_focused_block_has_css_class`: Focused block container has `.block-focused` class.
- [ ] `test_no_wrap_at_boundaries`: Ctrl+Up at block 0 stays at 0. Ctrl+Down at last stays at last.

## Acceptance Criteria
- [ ] Ctrl+Up/Down navigates between blocks
- [ ] Focused block has visual left border
- [ ] Focus resets on input/submit
- [ ] No wrapping at boundaries
- [ ] Commands registered in palette
- [ ] All tests pass
- [ ] Commit: `feat: add block navigation with Ctrl+Up/Down`

## Files to Read First
- `src/components/Terminal.tsx` — keyboard handlers, blocks array, outputRef
- `src/components/blocks/BlockView.tsx` — block rendering, CSS classes
- `src/lib/commands.ts` — command palette registry
- `src/App.css` — block styling
