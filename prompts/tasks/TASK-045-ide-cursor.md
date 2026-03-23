# Task 045: IDE-like Cursor in Input Editor (P1-I4)

## Context
The input editor uses a plain `<textarea>` with a syntax-highlighted overlay `<pre>`. The cursor is the native textarea cursor — users can click to position it, but there's no visual enhancement. This task adds a visible cursor indicator in the syntax highlight overlay and enables mouse click-to-position with word selection.

## Requirements
### Frontend only.

1. **Visible cursor in overlay**: Show a blinking cursor bar in the syntax-highlighted overlay at the current cursor position. The native textarea cursor is transparent/hidden, and the overlay renders a CSS-animated cursor.
2. **Click-to-position**: Already works (textarea handles it). Ensure the overlay cursor position syncs with the textarea's `selectionStart`.
3. **Double-click word selection**: Already works natively in textarea. Ensure the overlay highlights the selected word range.
4. **Selection highlighting**: When text is selected in the textarea, show a selection highlight in the overlay (semi-transparent blue background on selected characters).
5. **Cursor position tracking**: Use the existing `onCursorChange` callback (from TASK-022) to track cursor position for the overlay cursor.

## Tests
- [ ] `test_cursor_position_syncs_with_textarea`: Overlay cursor position matches textarea selectionStart.
- [ ] `test_cursor_blinks`: Cursor element has CSS blink animation.
- [ ] `test_selection_highlighted`: Selected text range gets highlight styling.
- [ ] `test_cursor_at_end_of_input`: Cursor at end of text positions correctly.
- [ ] `test_cursor_in_middle_of_token`: Cursor mid-word positions between characters.

## Files to Read First
- `src/components/editor/InputEditor.tsx` — textarea + overlay structure
- `src/App.css` — editor styling, overlay positioning

## Acceptance Criteria
- [ ] Blinking cursor visible in syntax-highlighted overlay
- [ ] Cursor position syncs with textarea
- [ ] Text selection shown in overlay
- [ ] No visual desync between textarea and overlay
- [ ] All tests pass
- [ ] Commit: `feat: add IDE-like cursor and selection highlighting in input editor`
