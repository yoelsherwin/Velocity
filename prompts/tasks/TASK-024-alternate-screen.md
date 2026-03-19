# Task 024: Alternate Screen Grid Renderer (P0-1 Phase 2)

## Context

Phase 1 (TASK-023) replaced the `AnsiFilter` with a `vt100::Parser` terminal emulator. Normal commands now render correctly — carriage returns, backspace, progress bars all work. However, programs that use the **alternate screen buffer** (vim, nano, less, htop, man pages) still don't work because:

1. The frontend treats output as an append-only string rendered through `AnsiOutput` (DOM spans)
2. Alternate screen programs need a **character grid** — a 2D array of rows × cols where each cell has content and style
3. When alternate screen is active, the normal block output should be hidden and a grid overlay shown
4. When alternate screen exits, the overlay disappears and block mode resumes

The `TerminalEmulator` already exposes `is_alternate_screen()` and the `vt100::Parser` already processes alternate screen sequences. We just need to:
1. Detect alternate screen transitions in Rust and notify the frontend
2. Send grid state (rows of styled cells) when in alternate screen mode
3. Build a `TerminalGrid` component to render the grid
4. Forward keyboard input to the PTY when in alternate screen mode (bypass our InputEditor)

### What exists now

- **ansi/mod.rs** (`src-tauri/src/ansi/mod.rs`): `TerminalEmulator` wrapping `vt100::Parser`. Has `is_alternate_screen()` method. `process()` returns `TerminalOutput::Append` or `TerminalOutput::Replace`. The `sanitize_to_sgr_only()` post-processor strips non-SGR sequences.

- **pty/mod.rs** (`src-tauri/src/pty/mod.rs`): Reader thread uses `Arc<Mutex<TerminalEmulator>>`. Bridge thread emits `pty:output:{sid}` (append) and `pty:output-replace:{sid}` (replace) events. `PtyEvent` enum has `Output`, `OutputReplace`, `Error`, `Closed` variants.

- **Terminal.tsx** (`src/components/Terminal.tsx`, ~727 lines): Manages blocks, listens for PTY events, renders `BlockView` components. Has `outputRef` pointing to `.terminal-output` div. The InputEditor is the primary keyboard input.

- **BlockView.tsx** (`src/components/blocks/BlockView.tsx`): Renders individual blocks with AnsiOutput.

- **InputEditor.tsx** (`src/components/editor/InputEditor.tsx`): Textarea-based input with syntax highlighting.

- **App.css** (`src/App.css`): Catppuccin Mocha theme. Terminal output is in `.terminal-output` div.

### Key insight

When alternate screen is active:
- The **block output area** should be hidden (not destroyed — we want it back when alt screen exits)
- A **full-screen grid** should overlay the block area, showing the terminal grid state
- The **InputEditor** should be hidden — keyboard input goes directly to the PTY
- When alternate screen exits, the grid disappears, blocks reappear, InputEditor returns

## Requirements

### Backend (Rust)

#### 1. New `PtyEvent` variants

Add events for alternate screen transitions and grid updates:

```rust
pub enum PtyEvent {
    Output(String),
    OutputReplace(String),
    /// Alternate screen entered — switch to grid rendering mode
    AltScreenEnter { rows: u16, cols: u16 },
    /// Alternate screen exited — switch back to block rendering mode
    AltScreenExit,
    /// Grid state update while in alternate screen mode.
    /// Contains rows of cells serialized for the frontend.
    GridUpdate(Vec<GridRow>),
    Error(String),
    Closed,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GridCell {
    pub content: String,    // The character(s) in this cell
    pub fg: Option<String>, // CSS color string, e.g. "rgb(255,0,0)"
    pub bg: Option<String>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub dim: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GridRow {
    pub cells: Vec<GridCell>,
}
```

#### 2. Detect alternate screen transitions in reader thread

After `emulator.process(chunk)`, check `emulator.is_alternate_screen()` and compare to the previous state. On transition:
- `false → true`: Send `PtyEvent::AltScreenEnter` + initial `PtyEvent::GridUpdate`
- `true → false`: Send `PtyEvent::AltScreenExit`
- While in alt screen: Send `PtyEvent::GridUpdate` instead of `PtyEvent::Output`/`OutputReplace`

#### 3. Extract grid state from vt100

When in alternate screen, iterate the vt100 screen cells to build `GridRow` data:

```rust
fn extract_grid(screen: &vt100::Screen, rows: u16, cols: u16) -> Vec<GridRow> {
    let mut grid = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        let mut cells = Vec::with_capacity(cols as usize);
        for col in 0..cols {
            let cell = screen.cell(row, col).unwrap_or_default();
            cells.push(GridCell {
                content: cell.contents().to_string(),
                fg: color_to_css(cell.fgcolor()),
                bg: color_to_css(cell.bgcolor()),
                bold: cell.bold(),
                italic: cell.italic(),
                underline: cell.underline(),
                dim: cell.faint(), // vt100 calls it "faint"
            });
        }
        grid.push(GridRow { cells });
    }
    grid
}
```

**Optimization**: Don't send the full grid on every chunk. Use a simple dirty check — compare against the last sent grid, only send if changed. Or send on every chunk but debounce in the bridge thread (e.g., max 30fps = one grid update per 33ms).

#### 4. Convert vt100 colors to CSS strings

The `vt100::Color` enum has variants like `Default`, `Idx(u8)`, `Rgb(u8, u8, u8)`. Map them to CSS color strings matching what the frontend expects:

```rust
fn color_to_css(color: vt100::Color) -> Option<String> {
    match color {
        vt100::Color::Default => None,
        vt100::Color::Idx(idx) => Some(ansi_256_to_rgb(idx)),
        vt100::Color::Rgb(r, g, b) => Some(format!("rgb({},{},{})", r, g, b)),
    }
}
```

For `Idx(0-15)`, map to the Catppuccin Mocha 16-color palette. For `Idx(16-255)`, use the standard 256-color table.

#### 5. Emit new Tauri events

In the bridge thread, handle the new `PtyEvent` variants:
- `AltScreenEnter` → emit `pty:alt-screen-enter:{sid}` with `{ rows, cols }`
- `AltScreenExit` → emit `pty:alt-screen-exit:{sid}`
- `GridUpdate` → emit `pty:grid-update:{sid}` with the serialized grid rows

#### 6. New Tauri command: `write_raw_to_session`

When in alternate screen mode, the frontend needs to send raw keystrokes (not commands) to the PTY. The existing `write_to_session` may work, but add a dedicated command if needed to bypass any input processing:

```rust
#[tauri::command]
pub async fn write_raw_to_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String>
```

Actually — check if `write_to_session` already sends raw bytes to the PTY writer. If so, reuse it. The frontend just needs to encode keyboard events as ANSI escape sequences (e.g., arrow up = `\x1b[A`, or `\x1bOA` in application mode).

### Frontend (React/TypeScript)

#### 7. `TerminalGrid` component (`src/components/TerminalGrid.tsx`)

A new component that renders a character grid:

```typescript
interface GridCell {
  content: string;
  fg?: string;
  bg?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

interface GridRow {
  cells: GridCell[];
}

interface TerminalGridProps {
  rows: GridRow[];
  onKeyDown: (e: React.KeyboardEvent) => void;
}
```

**Rendering approach**: Use a `<pre>` with absolutely-positioned or inline `<span>` elements for each cell. Each row is a line. Use monospace font matching the terminal output font.

**Simpler approach**: Render each row as a `<div>`, each cell as a `<span>` with inline styles. This matches the existing `AnsiOutput` pattern. The grid is small (typically 80×24 = 1920 cells) — React can handle this.

**Keyboard input**: The grid component captures keyboard events when focused. It translates key events to ANSI escape sequences and sends them to the PTY via `write_to_session`. Key mappings:
- Regular characters: send as-is
- Enter: `\r`
- Backspace: `\x7f`
- Arrow keys: `\x1b[A/B/C/D` (or `\x1bOA/B/C/D` in application mode)
- Escape: `\x1b`
- Tab: `\t`
- Ctrl+C: `\x03`
- Ctrl+D: `\x04`
- Ctrl+Z: `\x1a`
- Home/End/PgUp/PgDn: appropriate CSI sequences

The component should auto-focus when mounted and capture all keyboard input.

#### 8. Integration in Terminal.tsx

- Add state: `altScreenActive` (boolean), `gridRows` (GridRow[])
- Listen for `pty:alt-screen-enter:{sid}`, `pty:alt-screen-exit:{sid}`, `pty:grid-update:{sid}` events
- When alt screen enters: set `altScreenActive = true`, hide blocks + InputEditor, show `TerminalGrid`
- When alt screen exits: set `altScreenActive = false`, show blocks + InputEditor, hide grid
- When grid updates: update `gridRows` state

**Layout**:
```jsx
{altScreenActive ? (
  <TerminalGrid
    rows={gridRows}
    onKeyDown={handleGridKeyDown}
  />
) : (
  <>
    {/* existing block rendering */}
    {blocks.map(block => <BlockView ... />)}
  </>
)}
```

The InputEditor section should be hidden when `altScreenActive` is true.

#### 9. Keyboard event translation (`src/lib/key-encoder.ts`)

A utility to convert browser `KeyboardEvent` to ANSI escape sequences:

```typescript
function encodeKey(e: KeyboardEvent, applicationMode: boolean): string | null
```

This handles the mapping of browser key events to the byte sequences that terminal programs expect.

### IPC Contract

**New events:**
- `pty:alt-screen-enter:{sid}` — payload: `{ rows: number, cols: number }`
- `pty:alt-screen-exit:{sid}` — payload: none
- `pty:grid-update:{sid}` — payload: `GridRow[]` (JSON array of rows with cells)

**Existing command reused:**
- `write_to_session(session_id, data)` — sends raw bytes to PTY (already exists)

### Performance Considerations

- **Grid size**: 80×24 = 1,920 cells. At ~100 bytes/cell JSON, that's ~192KB per grid update. Acceptable for 30fps.
- **React rendering**: 1,920 `<span>` elements is fast. Use `React.memo` on row components to skip unchanged rows.
- **Update frequency**: Debounce grid updates to 30fps max (33ms) in the bridge thread to avoid flooding the frontend.
- **Serialization**: `serde_json::to_string()` for the grid. Consider a more compact format if perf is an issue (e.g., omit default-colored cells).

## Tests (Write These FIRST)

### Rust Unit Tests

- [ ] `test_alt_screen_detection`: Process `\x1b[?1049h`, verify `is_alternate_screen()` is true. Process `\x1b[?1049l`, verify false.
- [ ] `test_extract_grid_basic`: Write text to vt100 parser, extract grid, verify cell contents.
- [ ] `test_extract_grid_colors`: Write colored text, verify grid cells have correct fg/bg.
- [ ] `test_extract_grid_dimensions`: Grid dimensions match parser rows × cols.
- [ ] `test_color_to_css_rgb`: RGB color maps to `"rgb(r,g,b)"`.
- [ ] `test_color_to_css_idx`: Standard color index maps to correct RGB.
- [ ] `test_color_to_css_default`: Default color maps to None.
- [ ] `test_alt_screen_transition_events`: Process bytes that enter and exit alt screen, verify correct PtyEvent sequence.

### Frontend Tests (Vitest)

- [ ] `test_terminal_grid_renders_cells`: TerminalGrid renders correct number of rows and cells.
- [ ] `test_terminal_grid_applies_styles`: Cells with fg/bg/bold render with correct styles.
- [ ] `test_terminal_grid_keyboard_input`: Keydown events call onKeyDown handler.
- [ ] `test_key_encoder_regular_chars`: Regular characters encoded correctly.
- [ ] `test_key_encoder_arrow_keys`: Arrow keys produce correct ANSI sequences.
- [ ] `test_key_encoder_ctrl_c`: Ctrl+C produces `\x03`.
- [ ] `test_terminal_alt_screen_shows_grid`: When `altScreenActive` is true, grid is rendered instead of blocks.
- [ ] `test_terminal_alt_screen_hides_input`: When alt screen active, InputEditor is hidden.
- [ ] `test_terminal_alt_screen_exit_restores_blocks`: After alt screen exit, blocks and InputEditor return.

### E2E Tests (Playwright)

- [ ] `test_e2e_alt_screen`: Run a command that enters alternate screen (e.g., `powershell -Command "& { $host.UI.RawUI.WindowTitle = 'test' }"`), or use a simpler approach — just verify the events are handled. (Note: testing vim/less in E2E is complex; a simpler smoke test is acceptable.)

### Test type requirements

| Test Type | This Task |
|-----------|-----------|
| Rust Unit | **REQUIRED** — grid extraction, color mapping, alt screen detection |
| Rust Integration | Optional — real shell alt screen is hard to test reliably |
| Frontend (Vitest) | **REQUIRED** — TerminalGrid component, key encoder, Terminal integration |
| E2E (Playwright) | **REQUIRED** — basic alt screen transition |

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] Alternate screen detection works (vim, less, htop, nano trigger grid mode)
- [ ] Grid renders correctly with colors, bold, underline
- [ ] Keyboard input in grid mode reaches the PTY (can type in vim, navigate in less)
- [ ] Arrow keys work in terminal programs (application mode handled)
- [ ] Exiting alternate screen (`:q` in vim, `q` in less) returns to block mode
- [ ] Block output is preserved — blocks from before alt screen are still there after exit
- [ ] Ctrl+C works in grid mode
- [ ] Grid mode hides the InputEditor and shell selector
- [ ] Normal mode (non-alt-screen commands) still works correctly (regression check)
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `feat: add alternate screen grid renderer for terminal programs`

## Files to Read First

- `src-tauri/src/ansi/mod.rs` — TerminalEmulator, is_alternate_screen()
- `src-tauri/src/pty/mod.rs` — Reader thread, bridge thread, PtyEvent enum
- `src/components/Terminal.tsx` — Block rendering, PTY event listeners, layout
- `src/components/blocks/BlockView.tsx` — Block rendering pattern
- `src/components/AnsiOutput.tsx` — How styled spans are rendered (pattern for grid cells)
- `src/components/editor/InputEditor.tsx` — Current keyboard input handling
- `src/lib/pty.ts` — Frontend PTY interface (writeToSession)
- `src/App.css` — Terminal layout styles, monospace font
