# Code Review: TASK-024 Alternate Screen Grid Renderer (R1)

**Reviewer**: Claude Code Reviewer
**Commit**: `bca5fbb feat: add alternate screen grid renderer for terminal programs`
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit adds alternate screen mode detection and a grid renderer so that fullscreen terminal programs (vim, less, htop) display correctly. The Rust side detects alternate screen transitions via the vt100 crate, extracts cell-by-cell grid state with colors/attributes, and streams throttled grid updates to the frontend. The React side shows a `TerminalGrid` component when in alt screen mode, hides blocks/input, and forwards raw keyboard input back to the PTY via `key-encoder.ts`.

Overall: well-structured, good separation of concerns, solid test coverage. A handful of issues need attention before merge.

---

## Findings

### MUST FIX

#### M1. Grid output suppressed during alt screen normal-mode transition chunk

**File**: `src-tauri/src/pty/mod.rs` lines 130-159

When a PTY chunk contains an alt screen exit (`\x1b[?1049l`) followed by normal output in the same chunk, the code enters the `else if emu.is_alternate_screen()` branch on the first iteration but then after `consume_alt_screen_transition()` fires `AltScreenExit`, subsequent output in that same chunk hits the `else` (normal mode) branch. However, `process()` is called once per chunk, not per-byte. If a single `read()` returns bytes that contain both the exit sequence and subsequent normal output, `process()` processes all bytes at once, and then:

1. `consume_alt_screen_transition()` returns `Some(false)` -- pushes `AltScreenExit`
2. `process_output` was already computed from the full chunk

The `process_output` from `emu.process(&buf[..n])` is computed before the alt-screen check, which is good. But in the `AltScreenExit` path (line 141-143), the `process_output` is never sent. The normal output from that chunk is lost.

**Fix**: After pushing `AltScreenExit`, also check `process_output` and push the corresponding `PtyEvent::Output`/`OutputReplace` if it is `Some`.

```rust
if entered {
    // ... existing enter logic
} else {
    evts.push(PtyEvent::AltScreenExit);
    // Also forward any normal-mode output from this chunk
    if let Some(output) = process_output {
        evts.push(match output {
            TerminalOutput::Append(s) => PtyEvent::Output(s),
            TerminalOutput::Replace(s) => PtyEvent::OutputReplace(s),
        });
    }
}
```

#### M2. `handleBlur` in TerminalGrid re-focuses aggressively, trapping focus

**File**: `src/components/TerminalGrid.tsx` lines 55-59

The `handleBlur` callback unconditionally re-focuses the grid after 10ms. This means the user can never intentionally move focus away from the grid (e.g., to interact with a system dialog, browser devtools, or accessibility tools). It also fights with the tab system if one is added later.

**Fix**: Only re-focus if the grid is still mounted and the document is still focused. Better yet, check that the new `activeElement` is not a meaningful interactive element:

```tsx
const handleBlur = useCallback(() => {
  setTimeout(() => {
    if (document.hasFocus() && gridRef.current && !document.activeElement?.closest('dialog, [role="dialog"]')) {
      gridRef.current.focus();
    }
  }, 10);
}, []);
```

#### M3. Missing Shift+key modifier handling in key-encoder

**File**: `src/lib/key-encoder.ts`

When `Shift` is held with arrow keys or other special keys, many terminal programs expect modified key sequences (e.g., `Shift+ArrowUp` = `\x1b[1;2A`). Currently, `Shift+ArrowUp` just sends `\x1b[A` (same as plain ArrowUp), which means text selection in vim visual mode, shift-navigation in less, etc., will not work.

This is not a regression (the feature didn't exist before), but it limits usability of programs that depend on shift-modified keys. Consider adding modifier-encoded sequences for the most common cases (arrows, Home, End, function keys).

**Fix**: Add modifier parameter encoding per xterm spec. The modifier value is `1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)`:

```ts
// For arrow keys with modifiers:
if (modifier > 1) return `\x1b[1;${modifier}${arrowChar}`;
```

---

### SHOULD FIX

#### S1. Grid data is cloned on every emission

**File**: `src-tauri/src/pty/mod.rs` line 305

`rows.clone()` clones the entire grid (potentially 24x80 = 1,920 cells, each with multiple String allocations) on every emit. At 30fps throttle, this is ~57,600 String clones per second.

**Suggestion**: The `PtyEvent::GridUpdate` already owns the `Vec<GridRow>`. The clone happens because `match &event` borrows it. Consider taking ownership in the bridge thread:

```rust
PtyEvent::GridUpdate(rows) => {
    // rows is already owned, emit directly
    if let Err(e) = app_handle.emit(&format!("pty:grid-update:{}", session_id), rows) { ... }
}
```

Change `match &event` to `match event` and adjust the other arms accordingly (most are `String` which are cheap to move).

#### S2. No max grid dimensions guard in `extract_grid`

**File**: `src-tauri/src/ansi/mod.rs` line 165

`extract_grid` allocates `rows * cols` GridCells. If somehow the terminal dimensions are very large (e.g., 500x500 = 250,000 cells), this produces a large allocation. The PTY dimensions are validated to max 500x500 in `validate_dimensions`, but `extract_grid` takes raw `u16` and trusts them.

**Suggestion**: Add a `debug_assert!(rows <= 500 && cols <= 500)` or cap values to be safe.

#### S3. Serialization overhead -- consider delta updates

At 30fps, serializing the entire 24x80 grid as JSON every frame creates significant serialization overhead. Most frames only change a few cells (e.g., cursor blink, single character typed). This is acceptable for MVP but should be tracked as a performance TODO.

#### S4. `cellStyle` creates a new object on every render

**File**: `src/components/TerminalGrid.tsx` line 23

`cellStyle()` returns a new `React.CSSProperties` object for every cell on every render. With 1,920 cells at 30fps, that's many short-lived allocations. Consider using `useMemo` at the row level or CSS classes for common style combinations.

---

### NITPICKS

#### N1. `GridRowMemo` uses index as key

**File**: `src/components/TerminalGrid.tsx` line 37

```tsx
<span key={colIdx} style={cellStyle(cell)}>
```

Using index as key is fine here since grid cells are positional and don't reorder, but worth a comment explaining why.

#### N2. Missing integration test for alt screen flow

The Rust integration tests (`src-tauri/tests/pty_integration.rs`) do not test the alt screen flow (enter, grid update, exit). The unit tests cover the emulator and the frontend independently, but an end-to-end Rust integration test that sends `\x1b[?1049h`, verifies `AltScreenEnter` event, then sends `\x1b[?1049l` and verifies `AltScreenExit` would increase confidence.

#### N3. `applicationMode` parameter in `encodeKey` is unused in production

**File**: `src/lib/key-encoder.ts` line 9

`applicationMode` defaults to `false` and is never passed as `true` from production code. This is fine as forward-looking API design but could be noted with a comment.

#### N4. CSS uses magic `1.4em` for row height

**File**: `src/App.css` line 836

`.terminal-grid-row { height: 1.4em; }` matches the `line-height: 1.4` on `.terminal-container`, but this coupling is implicit. Consider using a CSS variable or `line-height: inherit`.

---

## Security Assessment

**Raw keyboard input**: `encodeKey` translates browser `KeyboardEvent` objects to well-defined ANSI byte strings. It does not forward arbitrary user strings -- it matches specific key names and emits fixed escape sequences. Ctrl+key mappings are computed from character codes within the a-z range. This is safe. The output goes through `writeToSession` which writes bytes to the PTY, which is the expected path.

**Grid data**: Grid cells are extracted from the vt100 crate's `Screen` API. Cell contents are character strings (what the terminal program wrote). These are serialized as JSON via Serde and rendered in React via `textContent` (not `dangerouslySetInnerHTML`). The `{cell.content || ' '}` pattern in JSX is safe -- React escapes text content. No XSS risk.

**Alt screen transition detection**: Uses `vt100::Screen::alternate_screen()` which is a simple boolean flag set by the vt100 crate when processing `\x1b[?1049h`/`\x1b[?1049l`. No user input involved in the detection logic.

**Verdict**: No security issues found.

---

## Test Assessment

- **Rust unit tests**: 9 new tests covering grid extraction, color conversion (standard, 256, grayscale, truecolor, default), alt screen transition detection, and alt screen grid content. Good coverage.
- **Frontend unit tests**: `TerminalGrid.test.tsx` (5 tests) covers rendering, styles, keyboard, focus, empty state. `key-encoder.test.ts` (13 tests) covers all key categories. `terminal-alt-screen.test.tsx` (5 tests) covers the full alt screen lifecycle in the Terminal component.
- **Gap**: No Rust integration test for the alt screen PTY event flow.

---

## Verdict: NEEDS CHANGES

Three must-fix items:
1. **M1**: Output lost on alt screen exit when normal output is in the same PTY chunk
2. **M2**: Aggressive focus trap in TerminalGrid blocks all intentional focus changes
3. **M3**: Missing shift/ctrl/alt modifier encoding for arrow and navigation keys limits usability in programs like vim

The security model is sound and the architecture is clean. Once the must-fixes are addressed, this is ready to merge.
