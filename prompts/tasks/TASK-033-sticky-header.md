# Task 033: Sticky Command Header (P1-B5)

## Context

When scrolling through a block with long output, the command header scrolls off-screen, and the user loses context of which command produced the output. The header should stick to the top while scrolling within that block's output.

### What exists now

- **BlockView.tsx**: Block header (`.block-header`) contains command text, exit code, timestamp. Output area (`.block-output`) below it.
- **Terminal.tsx**: `.terminal-output` is the scrollable container with `overflow-y: auto`.
- **App.css**: `.block-container` has `border-bottom: 1px solid var(--border-color)`.

## Requirements

### Frontend + CSS only — no Rust changes.

1. **Sticky header**: The `.block-header` should use `position: sticky; top: 0;` so it sticks to the top of the `.terminal-output` scroll container when scrolling through that block's output.

2. **Z-index**: Sticky header needs `z-index: 10` to stay above block output content.

3. **Background**: The sticky header MUST have an opaque background (use `var(--bg-base)`) so output text doesn't show through behind it.

4. **Visual separator**: Add a subtle bottom border or shadow to the sticky header when it's stuck (use `box-shadow: 0 1px 3px rgba(0,0,0,0.2)` when stuck). This can be done with a simple always-on shadow since detecting "stuck" state is complex.

5. **Collapse toggle**: The collapse toggle (from TASK-032) should still be in the header and work while sticky.

6. **Action buttons**: Block action buttons (copy, rerun) should also stick with the header since they're in the header area.

## Tests

- [ ] `test_block_header_has_sticky_position`: Verify `.block-header` has `position: sticky` in computed styles.
- [ ] `test_block_header_has_opaque_background`: Verify header has a background-color set.
- [ ] `test_block_header_has_z_index`: Verify z-index is set on header.

## Acceptance Criteria
- [ ] Block header sticks to top when scrolling through long output
- [ ] Header has opaque background (no text bleeding through)
- [ ] Action buttons visible while header is sticky
- [ ] Collapse toggle works while sticky
- [ ] Doesn't interfere with search highlights or block navigation
- [ ] All tests pass
- [ ] Commit: `feat: add sticky command header on block scroll`

## Files to Read First
- `src/components/blocks/BlockView.tsx` — Header structure
- `src/App.css` — Block styling, header styles
- `src/components/Terminal.tsx` — Scroll container
