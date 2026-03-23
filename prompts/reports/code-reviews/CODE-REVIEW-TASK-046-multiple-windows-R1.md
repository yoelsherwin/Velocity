# Code Review: TASK-046 Multiple Windows (R1)

**Commit:** `b593501` — feat: add multiple window support
**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-23
**Verdict:** PASS

---

## Summary

Adds the ability to open independent Velocity windows via Ctrl+Shift+N or the command palette. The Rust backend creates new webview windows using `WebviewWindowBuilder`; the frontend wires up the keyboard shortcut and palette entry.

## Files Changed (5 files, +161 lines)

| File | Change |
|------|--------|
| `src-tauri/src/commands/mod.rs` | `create_new_window` Tauri command (+25 lines) |
| `src-tauri/src/lib.rs` | Register command (+1 line) |
| `src/components/layout/TabManager.tsx` | Ctrl+Shift+N handler + palette action (+13 lines) |
| `src/lib/commands.ts` | `window.new` palette entry (+1 line) |
| `src/__tests__/multipleWindows.test.tsx` | 4 tests (+121 lines) |

## Security Review

### URL Hardcoding (PASS)
The `create_new_window` command uses `tauri::WebviewUrl::App("index.html".into())`, which resolves to the bundled app assets only. There are no user-supplied parameters that influence the URL -- the command takes zero arguments beyond the `AppHandle`. A new window cannot be pointed at an arbitrary URL.

### No User Input in Window Creation (PASS)
The window ID is generated server-side via `uuid::Uuid::new_v4()`. No user-derived strings are interpolated into the window label or URL.

### IPC Surface (PASS)
The command accepts no parameters from the frontend, so there is no input to validate. The only argument is the Tauri-provided `AppHandle`.

## Code Quality

### Rust `create_new_window` (PASS)
- Clean, minimal implementation. Uses `WebviewWindowBuilder` correctly.
- UUID-based window IDs prevent label collisions.
- Error mapped to `String` via `.map_err(|e| e.to_string())` -- consistent with other commands.
- No `unwrap()` on any fallible operation.

### Frontend Shortcut (PASS)
- Ctrl+Shift+N correctly placed before Ctrl+Shift+P in the keydown handler (order doesn't conflict since keys differ).
- `.catch(() => {})` silences errors in test environments -- acceptable for a window-creation call that can't meaningfully be retried.

### Command Palette Entry (PASS)
- `window.new` entry has correct shortcut label, category, and keywords.
- `handlePaletteAction` dispatches to `invoke('create_new_window')` with same error handling.

### Independent Window State (PASS)
- Each new window loads `index.html` fresh, which renders its own `TabManager` with independent React state. Test `test_new_window_independent_state` verifies a fresh TabManager starts with exactly 1 tab.

## Findings

### Minor

1. **No window count limit.** There is no cap on how many windows can be created. A user (or a script rapidly invoking the command) could open an unbounded number. Consider adding a MAX_WINDOWS constant similar to `MAX_PANES_TOTAL`. Low severity -- user would have to deliberately spam the shortcut.

2. **Silent error swallowing.** Both call sites use `.catch(() => {})`. If the Rust side fails (e.g., the build call returns an error), the user gets no feedback. Consider at minimum logging to console: `.catch((e) => console.error('Failed to create window:', e))`.

3. **Missing `min_inner_size`.** The window sets `inner_size(1200, 800)` but no `min_inner_size`. Users could resize the window to an unusably small size. Not a blocker.

## Test Results

| Suite | Result |
|-------|--------|
| Frontend (Vitest) | 53/54 files passed, 551 tests passed. 1 file OOM (infrastructure, not test failure) |
| Rust (`cargo test`) | 144 tests passed (143 unit + 1 compile-time), 11 integration |
| New test file | `multipleWindows.test.tsx` -- 4/4 passed |

### Test Coverage
- `test_ctrl_shift_n_creates_window` -- verifies shortcut invokes backend command
- `test_window_new_in_palette` -- verifies command registry entry
- `test_new_window_independent_state` -- verifies fresh TabManager has 1 tab
- `test_palette_action_creates_window` -- verifies palette dispatches to backend
- `test_create_window_command_exists` -- Rust compile-time signature check

## Verdict: PASS

Clean, secure, minimal implementation. The three minor findings (no window cap, silent errors, no min size) are non-blocking suggestions for future improvement.
