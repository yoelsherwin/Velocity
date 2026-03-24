# Task 049: Custom Cursor Shapes in Input Editor (P2-14)

## Context
The input editor has a blinking bar cursor (from TASK-045). Users should be able to choose between block, underline, and bar cursor shapes, matching their preference from other editors.

## Requirements
### Frontend + settings extension.

1. **Cursor shapes**: Block (filled rectangle), Underline (bottom border), Bar (thin vertical line — current default).
2. **Settings**: Add `cursor_shape` to AppSettings. Values: `"bar"` (default), `"block"`, `"underline"`.
3. **CSS classes**: `.editor-cursor-bar`, `.editor-cursor-block`, `.editor-cursor-underline`.
   - Bar: `width: 2px; height: 1.2em;` (current)
   - Block: `width: 0.6em; height: 1.2em; opacity: 0.5;` (semi-transparent so text is visible)
   - Underline: `width: 0.6em; height: 2px; align-self: flex-end;`
4. **Settings UI**: Add cursor shape dropdown in Appearance section of SettingsModal.
5. **Apply**: Read from settings on load, apply CSS class dynamically.

## Tests
- [ ] `test_cursor_bar_shape`: Default cursor has bar class.
- [ ] `test_cursor_block_shape`: Block setting applies block class.
- [ ] `test_cursor_underline_shape`: Underline setting applies underline class.
- [ ] `test_cursor_shape_setting_persists`: Setting saves and loads correctly.

### Rust
- [ ] `test_cursor_shape_validation`: Only "bar", "block", "underline" accepted.
- [ ] `test_cursor_shape_backward_compat`: Old settings without cursor_shape deserialize.

## Files to Read First
- `src/components/editor/InputEditor.tsx` — Current cursor rendering
- `src-tauri/src/settings/mod.rs` — Settings struct
- `src/lib/types.ts` — AppSettings type
- `src/components/SettingsModal.tsx` — Settings UI
- `src/App.css` — Current cursor styles

## Acceptance Criteria
- [ ] Three cursor shapes available (bar, block, underline)
- [ ] Configurable in Settings
- [ ] Persists across restarts
- [ ] All tests pass
- [ ] Commit: `feat: add configurable cursor shapes in input editor`
