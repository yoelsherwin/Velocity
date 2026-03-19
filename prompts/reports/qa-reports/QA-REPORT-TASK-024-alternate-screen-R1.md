# QA Report: TASK-024 Alternate Screen Grid Renderer (R1)

**Date**: 2026-03-19
**Commits**: `bca5fbb` (feat) + `7edf8a3` (fix)
**Scope**: Alternate screen detection, character grid renderer, key encoder, color mapping, focus management, throttled grid updates

## 1. Test Results

### Frontend (Vitest)
- **33 test files, 348 tests** -- ALL PASSED
- TASK-024-specific test files:
  - `TerminalGrid.test.tsx` -- 5 tests, all passed
  - `key-encoder.test.ts` -- 21 tests, all passed
  - `terminal-alt-screen.test.tsx` -- 5 tests, all passed
  - `Terminal.test.tsx` -- 49 tests (includes pre-existing + new alt screen tests), all passed

### Backend (cargo test)
- **98 unit tests, 11 integration tests** -- ALL PASSED (1 ignored: `test_spawn_powershell_session`, expected)
- TASK-024-specific Rust tests:
  - `test_alt_screen_grid_content` -- passed
  - `test_alt_screen_transition_detection` -- passed
  - `test_emulator_alternate_screen_detection` -- passed
  - `test_extract_grid_basic` -- passed
  - `test_extract_grid_colors` -- passed
  - `test_extract_grid_dimensions` -- passed
  - `test_extract_grid_bold_italic_underline` -- passed
  - `test_color_to_css_rgb` -- passed
  - `test_color_to_css_idx_standard` -- passed
  - `test_color_to_css_idx_256_color_cube` -- passed
  - `test_color_to_css_idx_grayscale` -- passed
  - `test_color_to_css_default` -- passed
  - `test_pty_event_variants` (updated with new variants) -- passed

## 2. Test Coverage Analysis

### Well-Covered Areas
- **Grid extraction**: dimensions, content, colors (standard, 256-color cube, grayscale, truecolor, Catppuccin 16-color), bold/italic/underline attributes
- **Alt screen transitions**: enter/exit detection, consume-once semantics, grid-on-enter
- **Key encoder**: regular chars, Enter/Backspace/Tab/Escape, arrow keys (normal + application mode), Ctrl+letter (a-z, special brackets), Alt+char, Home/End, PageUp/PageDown/Delete/Insert, F1-F12, modifier-encoded arrows (Shift, Ctrl, Alt, Shift+Ctrl), modifier-encoded navigation/function keys, modifier-only keys ignored
- **Frontend integration**: alt screen shows grid, hides blocks/input, exit restores blocks, grid updates render cells, keyboard input writes to PTY
- **Color mapping**: full 256-color palette including Catppuccin Mocha 16-color, 6x6x6 cube, grayscale ramp, RGB truecolor, default (None)

### Coverage Gaps
- **Throttled grid updates**: no test verifies the 33ms throttling behavior or that final frames are not stale
- **Shift+Tab (backtab)**: not tested and not encoded (see Bug #2)
- **Multi-byte / wide Unicode in grid**: grid extraction tested with ASCII only; no test for CJK wide chars or emoji that occupy two cells
- **Concurrent alt-screen enter during listener setup**: race condition between `listen()` calls and `startReading()` is guarded by the invocation counter pattern, but no explicit test for this interleaving
- **Re-focus behavior on blur**: `handleBlur` logic in TerminalGrid not tested

## 3. Bugs Found

### BUG-1: Grid throttling can drop the final update (Severity: Medium)

**File**: `src-tauri/src/pty/mod.rs`, lines 152-158

When in alternate screen mode, grid updates are throttled to ~30fps (33ms). If the last data chunk arrives before the throttle timer expires, the update is silently dropped. The grid displayed to the user may be stale by up to 33ms. This matters for programs that write a final frame and immediately exit alt screen -- the user sees the penultimate frame, not the final one.

**Suggestion**: When `AltScreenExit` is detected, always send a final `GridUpdate` with the current grid state before emitting `AltScreenExit`. Additionally, consider sending a final grid update when the read loop ends while still in alt screen.

### BUG-2: Key encoder missing Shift+Tab (backtab) (Severity: Low)

**File**: `src/lib/key-encoder.ts`, line 116

`Shift+Tab` should encode to `\x1b[Z` (CSI Z / backtab), which is used by TUI programs for reverse tab navigation (e.g., `dialog`, `fzf`, form UIs). Currently, `Shift+Tab` falls through to the printable-character handler which returns `null` (since `Tab` has length > 1 and shift+Tab has modifiers). The key is silently dropped.

**Suggestion**: Add a case before or in the switch statement:
```typescript
if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) return '\x1b[Z';
```

### BUG-3: Alt screen enter swallows normal-mode output from same chunk (Severity: Low)

**File**: `src-tauri/src/pty/mod.rs`, lines 134-141

When `consume_alt_screen_transition()` returns `Some(true)` (entering alt screen), the code sends `AltScreenEnter` and `GridUpdate` but does NOT forward the `process_output` from the same chunk. The vt100 emulator processes the entire chunk atomically, and any normal-mode text emitted by `process()` before the escape sequence is discarded. In practice this rarely matters because the alt-screen-entering program typically clears the screen first, but it could cause lost output in edge cases (e.g., a script that prints a line then immediately launches vim).

## 4. Code Quality Observations

### Positive
- Clean separation: Rust handles grid extraction/color mapping, TypeScript handles rendering and key encoding
- Throttled grid updates at 30fps is a sound performance decision
- `GridRowMemo` using `React.memo` prevents unnecessary re-renders of unchanged rows
- Event listener cleanup pattern is thorough with invocation-counter staleness checks
- Key encoder has comprehensive modifier support matching xterm conventions
- Catppuccin Mocha palette is properly mapped for the 16 standard ANSI colors

### Minor Observations
- `dim` field in `GridCell` is always `false` (vt100 0.15 limitation). Frontend renders `opacity: 0.5` for dim, which is dead code today. Consider adding a comment in the TypeScript type or removing the frontend dim handling until the backend supports it.
- `handleBlur` re-focus after 10ms could fight with right-click context menus or other non-dialog focus targets. The `dialog, [role="dialog"]` check covers modals but not all cases.
- The `TerminalGrid` component uses `key={rowIdx}` for row keys, which is acceptable since rows are positional, but could cause unnecessary re-mounts if row count changes. The `React.memo` on `GridRowMemo` mitigates this.

## 5. Manual Test Plan

### MT-1: Basic Alt Screen Enter/Exit
1. Launch Velocity, open PowerShell
2. Run `more C:\Windows\System32\drivers\etc\hosts` (or any file with enough lines)
3. Verify: block view and input editor disappear, grid view appears
4. Press `q` to exit
5. Verify: grid disappears, block view and input editor return
6. Verify: shell selector reappears

### MT-2: Vim in Alt Screen
1. Run `vim test.txt` (or `notepad`-style TUI editor)
2. Verify: grid renders with vim UI (status bar, tildes for empty lines)
3. Type `i` to enter insert mode, type text
4. Verify: typed characters appear in grid
5. Press `Escape`, type `:q!` + Enter
6. Verify: returns to block view cleanly

### MT-3: Color Rendering in Grid
1. Run a command that produces colored output in alt screen (e.g., `htop` if available, or `python -c "import curses; ..."`)
2. Verify: colors render correctly in the grid
3. Verify: bold, italic, underline attributes display properly

### MT-4: Arrow Keys and Modifiers
1. In vim or less, use arrow keys to navigate
2. Verify: cursor movement works
3. Test Shift+Arrow, Ctrl+Arrow in programs that support them
4. Test Ctrl+C to interrupt a long-running alt-screen program

### MT-5: Resize During Alt Screen
1. Enter alt screen (e.g., `less` on a file)
2. Resize the Velocity window
3. Verify: grid re-renders at new dimensions without crash
4. Verify: content reflows appropriately

### MT-6: Rapid Alt Screen Toggle
1. Run a script that quickly enters and exits alt screen multiple times
2. Verify: UI transitions cleanly without stale grid artifacts or stuck states

### MT-7: Function Keys
1. In a program that uses function keys (e.g., `mc` or `htop`)
2. Press F1-F12
3. Verify: keys are received and acted upon by the program

## 6. Verdict

**PASS with minor issues.** All automated tests pass. The implementation is solid with clean architecture. Three bugs were identified:
- BUG-1 (medium): throttled grid updates may drop the final frame before alt screen exit
- BUG-2 (low): Shift+Tab not encoded
- BUG-3 (low): normal output in the same chunk as alt-screen-enter is swallowed

None of these are blockers. BUG-1 should be addressed before the feature is considered stable for daily use. BUG-2 and BUG-3 can be deferred to a follow-up task.
