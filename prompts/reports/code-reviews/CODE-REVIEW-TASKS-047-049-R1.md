# Code Review: TASK-047, TASK-048, TASK-049 (Round 1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-24
**Commits**: `64e90cf` (Tab Drag), `228f5b2` (Global Hotkey), `260442b` (Cursor Shapes)

---

## Test Results

| Suite | Result |
|-------|--------|
| Vitest (frontend) | 565/565 passed (54/55 files; 1 worker OOM — not a test failure) |
| Cargo test (Rust) | All passed (unit + 11 integration) |

---

## TASK-047: Tab Drag Reordering

**Files changed**: `TabBar.tsx`, `TabManager.tsx`, `App.css`, `TabBar.test.tsx`

### Findings

**[P2] `parseInt` on untrusted drag data**
In `TabBar.tsx:42`, `parseInt(e.dataTransfer.getData('text/plain'), 10)` parses data from the drag event. While HTML5 drag/drop within the same app is low-risk, the `fromIndex` value is only checked for `NaN` — it is not bounds-checked in `TabBar`. The bounds check exists in `TabManager.handleReorderTabs`, so this is defense-in-depth only, but the two layers should be consistent.

**Recommendation**: Add `fromIndex >= 0 && fromIndex < tabs.length` guard in `handleDrop` as well, or document that `TabManager` is the sole validator.

**[P3] Drag data type `text/plain`**
Using `text/plain` as the MIME type means other draggable text on the page could interfere. Consider a custom MIME type like `application/x-velocity-tab` to namespace the drag data.

**[P3] Accessibility: no keyboard reorder**
Drag/drop is mouse-only. Screen reader users and keyboard-only users cannot reorder tabs. Consider adding `aria-roledescription="draggable tab"` and keyboard shortcuts (e.g., Ctrl+Shift+Left/Right) in a follow-up.

**[OK] Bounds checking in TabManager**
`handleReorderTabs` correctly validates both `fromIndex` and `toIndex` are within `[0, prev.length)` and short-circuits on `fromIndex === toIndex`. The splice-based reorder logic is correct.

**[OK] CSS**
`.tab-dragging` (opacity: 0.5) and `.tab-drop-indicator` (border-left) provide clear visual feedback. No z-index conflicts observed.

**[OK] Test coverage**
5 new tests covering: draggable attribute, dragStart data, drop reorder callback, active tab preservation after reorder, and dragging opacity class. Good coverage.

### Verdict: PASS (with minor recommendations)

---

## TASK-048: Global Hotkey (Quake-style Toggle)

**Files changed**: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src/lib/commands.ts`, `src/__tests__/globalHotkey.test.ts`

### Security Review

**[P1] Capability scope is appropriate**
`global-shortcut:default` is the minimum permission needed. The capability is scoped to `["main"]` window only. The shortcut registers exactly one key combination (`ctrl+\``) with no user-configurable shortcut strings, so there is no injection surface.

**[P2] Error suppression in window toggle handler**
Lines 30-33 of `lib.rs` use `let _ = window.hide()` / `let _ = window.show()` / `let _ = window.set_focus()`. While panicking in a shortcut handler would be worse, silently swallowing errors makes debugging hard. Consider logging failures at `warn!` level.

**Recommendation**: Add `if let Err(e) = window.show() { eprintln!("Failed to show window: {e}"); }` or use Tauri's logger.

**[P3] Focus detection race condition**
The toggle logic checks `is_visible() && is_focused()`. If the window is visible but not focused (e.g., behind another window), the shortcut will show + focus it. On the next press it will hide. This is correct Quake-console behavior. However, on Windows, `is_focused()` can briefly return stale values. Consider using only `is_visible()` and toggling purely on visibility if focus detection proves unreliable.

**[OK] `#[cfg(desktop)]` guard**
Correctly prevents compilation on mobile targets.

**[OK] Shortcut matching**
Uses both string registration (`"ctrl+\`"`) and typed matching (`Modifiers::CONTROL, Code::Backquote`) for defense-in-depth — good.

**[OK] Command palette integration**
Added `window.toggle` command with `Ctrl+\`` shortcut, `Window` category, and relevant keywords (`quake`, `summon`, `hide`, `show`, `hotkey`, `global`).

**[WEAK] Rust test is a no-op**
`test_global_shortcut_plugin_registered` just asserts `true`. This provides zero value. Either remove it or test something meaningful (e.g., that `setup_global_shortcut` returns `Ok(())` when called outside a Tauri context — though that would require mocking).

### Verdict: PASS (with P2 logging recommendation)

---

## TASK-049: Configurable Cursor Shapes

**Files changed**: `InputEditor.tsx`, `Terminal.tsx`, `SettingsModal.tsx`, `App.css`, `src-tauri/src/settings/mod.rs`, `src/lib/types.ts`, `InputEditor.test.tsx`, `SettingsModal.test.tsx`

### Findings

**[OK] Type safety**
`CursorShape` is a union type derived from `CURSOR_SHAPES` const array (`'bar' | 'block' | 'underline'`). Rust side mirrors with `VALID_CURSOR_SHAPES` validation. Both sides are aligned.

**[P2] CSS class built from runtime string without validation**
In `InputEditor.tsx:42`:
```ts
const cursorClassName = `editor-cursor editor-cursor-${cursorShape} editor-cursor-blink`;
```
The `cursorShape` parameter in `buildOverlayContent` is typed as `string` (line 37), not `CursorShape`. While the prop is typed at the component level, the internal function accepts any string. If a caller passes an unexpected value, it would generate a non-existent CSS class silently.

**Recommendation**: Type the `cursorShape` parameter of `buildOverlayContent` as `CursorShape` instead of `string`.

**[OK] Rust validation**
`validate_settings` correctly rejects invalid cursor shapes. Backward compatibility test confirms `cursor_shape: None` deserialization works for existing config files without the field.

**[OK] Settings flow**
`SettingsModal` reads cursor shape from settings, defaults to `'bar'`, persists on save. `Terminal` reads it on mount and passes to `InputEditor`. Clean data flow.

**[P3] Cursor shape not reactive to settings changes**
`Terminal.tsx` reads `cursorShape` from settings only once on mount (in a `useEffect([], [])` with empty deps). If the user changes cursor shape in settings, they must restart/re-open the pane to see the change. Consider re-reading settings when the settings modal closes, or using a context/event.

**[OK] CSS definitions**
Three cursor shapes are well-defined: bar (2px wide), block (0.6em wide, 50% opacity), underline (2px tall, flex-end aligned). All inherit the blink animation.

**[OK] Test coverage**
3 new InputEditor tests (bar default, block, underline) + 3 SettingsModal tests (renders dropdown, persists saved value, saves changed value) + 3 Rust tests (validation, backward compat, deserialization).

### Verdict: PASS (with minor recommendations)

---

## Summary

| Task | Feature | Verdict | Blockers |
|------|---------|---------|----------|
| TASK-047 | Tab Drag Reorder | PASS | None |
| TASK-048 | Global Hotkey | PASS | None |
| TASK-049 | Cursor Shapes | PASS | None |

### Recommended Follow-ups (non-blocking)

1. **TASK-047**: Use custom MIME type for drag data; add keyboard-based tab reorder for accessibility.
2. **TASK-048**: Add `warn!`-level logging for window show/hide/focus errors instead of `let _ =`. Remove or replace the no-op Rust test.
3. **TASK-049**: Type `buildOverlayContent`'s `cursorShape` param as `CursorShape`. Make cursor shape reactive to settings changes without requiring pane restart.
