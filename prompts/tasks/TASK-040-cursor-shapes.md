# Task 040: Custom Cursor Shapes in Alt Screen (P1-R4)

## Context
When in alternate screen mode (vim, less), there's no visible cursor. Terminal programs set cursor shapes via DECSCUSR (`\x1b[N q`) — block, underline, bar. The `vt100` crate tracks cursor position. This task adds a visible, blinking cursor in the TerminalGrid.

## Requirements
### Frontend + minor Rust.

1. **Cursor position**: The `vt100::Screen` has `cursor_position()` returning `(row, col)`. Send this with grid updates.
2. **Cursor visibility**: `screen.hide_cursor()` indicates if cursor should be hidden. Send this too.
3. **Cursor rendering**: In TerminalGrid, highlight the cursor cell with a blinking animation. Default shape: block (inverted colors).
4. **Cursor shapes**: Track DECSCUSR if available from vt100, otherwise default to block.
5. **Blink**: CSS animation, 1s period, 50% duty cycle.

## Tests
- [ ] `test_grid_update_includes_cursor_position`: Grid event payload includes cursor row/col.
- [ ] `test_cursor_cell_highlighted`: The cursor cell has a `.terminal-cursor` CSS class.
- [ ] `test_cursor_hidden_when_flagged`: When hide_cursor is true, no cursor class applied.
- [ ] `test_cursor_blink_animation`: Cursor element has CSS animation.

## Files to Read First
- `src-tauri/src/ansi/mod.rs` — extract_grid, GridCell
- `src-tauri/src/pty/mod.rs` — grid update event emission
- `src/components/TerminalGrid.tsx` — grid rendering

## Acceptance Criteria
- [ ] Visible blinking cursor in alt screen mode
- [ ] Cursor position matches vt100 screen state
- [ ] Cursor hidden when program requests it
- [ ] All tests pass
- [ ] Commit: `feat: add cursor rendering in alternate screen mode`
