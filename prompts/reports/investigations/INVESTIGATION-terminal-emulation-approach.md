# Investigation: Full Terminal Emulation Architecture Decision

**Date**: 2026-03-18
**Priority**: P0-1
**Status**: Complete

---

## 1. Current ANSI Pipeline — Detailed Trace

### Data Flow

```
Shell (PowerShell/CMD/WSL)
  → ConPTY (Windows pseudo-console)
    → portable-pty reader (raw bytes)
      → spawn_reader_thread() reads 4096-byte chunks
        → AnsiFilter::filter() processes via vte parser
          → mpsc channel (PtyEvent::Output)
            → spawn_bridge_thread() emits Tauri event
              → pty:output:{sessionId} → React listen()
                → Terminal.tsx appends to block.output (string concat)
                  → BlockView renders via <AnsiOutput>
                    → useIncrementalAnsi() parses SGR via Anser library
                      → React DOM <span> elements with inline styles
```

### What the ANSI Filter Preserves

- **Printable characters** — `Perform::print()` passes through
- **SGR sequences** (`\x1b[...m`) — colors, bold, italic, underline, dim, 256-color, truecolor
- **Whitespace controls** — `\n` (0x0A), `\r` (0x0D), `\t` (0x09)

### What the ANSI Filter Strips

Everything else, specifically:

| Category | Examples | Impact |
|----------|----------|--------|
| **Cursor movement** | `\x1b[H`, `\x1b[A/B/C/D`, `\x1b[nG` | Progress bars, fzf, interactive UIs broken |
| **Cursor position queries** | `\x1b[6n` (DSR) | Programs that query cursor hang |
| **Erase sequences** | `\x1b[2J` (clear screen), `\x1b[K` (erase line) | Screen clearing doesn't work |
| **Alternate screen** | `\x1b[?1049h/l` | vim, nano, less, htop, man pages broken |
| **Scroll regions** | `\x1b[r` (DECSTBM) | Scrolling regions in TUI apps broken |
| **OSC sequences** | `\x1b]0;title\x07`, hyperlinks | Window titles, clickable links lost |
| **DCS sequences** | Sixel graphics, XTGETTCAP | Terminal graphics, capability queries broken |
| **Application mode** | `\x1b[?1h` (DECCKM) | Arrow keys in vim produce wrong sequences |
| **Backspace** | `0x08` | Overwrite rendering (man pages bold) broken |
| **Bell** | `0x07` | No audible/visual bell |

### What Would Need to Change Per Option

**Option A (Rust-side emulator):** Replace `AnsiFilter` with `vt100::Parser` or `alacritty_terminal::Term`. The reader thread would maintain a virtual terminal grid instead of filtering to text. The bridge thread would serialize grid state (or diffs) to the frontend.

**Option B (xterm.js):** Remove `AnsiFilter` entirely. Send raw PTY bytes directly to the frontend. xterm.js handles all parsing and rendering internally.

**Option C (Hybrid):** Keep `AnsiFilter` for normal mode. Add a parallel raw-byte path that activates when alternate screen or raw mode is detected. Detection could happen in the Rust `AnsiFilter` (extend `csi_dispatch` to watch for `\x1b[?1049h`).

---

## 2. Block Model Compatibility

### Current Block Model

Each `Block` is `{ id, command, output: string, timestamp, status, exitCode, shellType }`. The `output` field is a plain string that grows via concatenation as PTY chunks arrive. Commands are delimited by an exit-code marker that the shell echoes after each command.

Key features built on the block model:
- **Copy Command / Copy Output** — relies on `block.command` and `stripAnsi(block.output)`
- **Rerun** — re-sends `block.command` to PTY
- **Find in Output** (`Ctrl+Shift+F`) — searches `stripAnsi()` of all blocks, with per-span highlight overlays
- **Exit code detection** — parses a marker string from the output stream
- **Output truncation** — front-truncates at 500KB per block
- **Block visibility / virtualization** — uses IntersectionObserver to skip rendering offscreen blocks

### Option A — Block Model Impact

**Compatible with modifications.** The Rust emulator would maintain the grid, but we could still accumulate a "scrollback transcript" string per block for search, copy, and history. The grid state would only be needed for the *active* block (the currently running command). Completed blocks would freeze their output as a string, preserving the current block model. However, the active block's output would need a dual representation: grid state for rendering + accumulated text for search.

**Risks:** Grid-to-React rendering is the main challenge. We'd need to serialize the grid (rows x cols of styled cells) and render it efficiently. This is essentially building a custom terminal renderer, which is significant work.

### Option B — Block Model Impact

**Fundamentally incompatible in pure form.** xterm.js maintains its own scrollback buffer, input handling, and rendering surface (canvas/WebGL). It does not expose a "block" concept. Adopting xterm.js wholesale means:
- Losing the block model (no command-output grouping)
- Losing Find in Output (xterm.js has its own search addon, but it's not block-aware)
- Losing block actions (copy command, rerun, exit code per block)
- The decoupled input editor would conflict with xterm.js's built-in input handling
- Essentially becoming a traditional terminal with an xterm.js widget per pane

This would be a regression from Velocity's key differentiators.

### Option C — Block Model Impact

**Most compatible.** Normal mode keeps the block model exactly as-is. When a program enters alternate screen (vim, less, htop), we switch to a full terminal renderer (either xterm.js or a Rust grid) that overlays the block view. When the program exits, the overlay is removed and a new block is created with a summary (e.g., "[vim session]"). The block model is preserved for all normal shell usage.

**Risks:** Two rendering paths means double the bugs. The transition between modes must be seamless. Some programs use cursor movement without alternate screen (progress bars, fzf in inline mode).

---

## 3. `alacritty_terminal` Crate Feasibility

### Current State (v0.25.1 on docs.rs)

- **Standalone use:** Partially designed for it. The crate is split from the Alacritty GPU renderer, but it still includes an `event_loop` module and `tty` module that assume it manages the PTY. Using it standalone requires careful extraction.
- **Key types:** `Term<T>` (terminal state), `Grid` (2D cell grid), `Config`, event handler trait
- **Creating a Term:** `Term::new(config, &dimensions, event_proxy)` — requires implementing an event listener trait
- **Feeding bytes:** Term implements the `vte::Perform` trait (handler). You feed bytes through a `vte::Parser` that calls methods on the Term. This is the same `vte` crate we already use.
- **Reading state:** `term.grid()` for raw grid access, `term.renderable_content()` for render-ready data, `term.damage()` for change tracking (dirty-rect optimization)
- **Alternate screen:** `term.swap_alt()` switches buffers
- **Diff support:** `damage()` / `reset_damage()` provides line-level change tracking

### Pros
- Full VT100/xterm emulation (same engine as Alacritty, a production terminal)
- Rust-native, high performance
- Damage tracking enables efficient diffs (don't re-send entire grid each frame)
- Same `vte` crate we already depend on

### Cons
- Heavy dependency (pulls in Alacritty's config types, event system, etc.)
- Not designed as a clean "feed bytes, get grid" library — requires adapting around its event_loop assumptions
- Grid serialization to JSON for IPC could be expensive (80x24 = 1920 cells per frame, each with content + style)
- Versioning: `alacritty_terminal` does not follow semver independently from Alacritty releases; API may break without warning
- No official "embedded use" documentation or examples

### Verdict
**Feasible but overengineered for our needs.** The damage tracking is nice, but the coupling to Alacritty's architecture makes it harder to integrate than `vt100`.

---

## 4. `vt100` Crate Feasibility

### Current State (v0.15.x on docs.rs)

- **Purpose:** Explicitly designed as an embeddable terminal emulator library ("the terminal parser component of a graphical terminal emulator pulled out into a separate crate")
- **API is clean and simple:**
  ```rust
  let mut parser = vt100::Parser::new(24, 80, 1000); // rows, cols, scrollback
  parser.process(raw_bytes);                          // feed PTY output
  let screen = parser.screen();                       // get current state
  screen.cell(row, col)                               // individual cell access
  screen.contents()                                   // plain text
  screen.contents_formatted()                         // text with ANSI codes
  screen.contents_diff(&prev_screen)                  // minimal diff
  screen.alternate_screen()                           // bool: is alt screen active?
  screen.application_cursor()                         // bool: app cursor keys?
  screen.title()                                      // window title from OSC
  ```
- **Implements `Write` trait:** Can use `write!()` / `write_all()` directly
- **Alternate screen:** `screen.alternate_screen()` returns `bool` — exactly what we need for hybrid mode detection
- **Scrollback:** Configurable via constructor, accessed via `set_scrollback()`
- **Diff support:** `contents_diff(&prev_screen)` and `state_diff(&prev_screen)` return minimal escape code sequences to transform one state into another

### Pros
- Purpose-built for exactly our use case (embeddable terminal state machine)
- Clean, minimal API with no framework coupling
- `alternate_screen()` method is exactly what hybrid detection needs
- `contents_diff()` enables efficient updates
- Small dependency footprint
- Already using `vte` for parsing (vt100 uses the same underlying parser)

### Cons
- Less battle-tested than alacritty_terminal (though used in several terminal projects)
- Diff output is ANSI escape codes, not structured data — would need to parse for React rendering
- No built-in damage tracking at the cell level (diff is string-based)

### Verdict
**Best fit for the Rust-side emulator approach.** Clean API, purpose-built, minimal coupling. If we go with Option A or C, this is the crate to use.

---

## 5. `xterm.js` Feasibility in Tauri

### Overview

- **Version:** 5.x (package renamed to `@xterm/xterm`)
- **Used by:** VS Code (its integrated terminal), Hyper, Theia, and many Electron apps
- **Renderers:** DOM renderer (default), Canvas addon (`@xterm/addon-canvas`), WebGL addon (`@xterm/addon-webgl`)
- **Key addons:** fit (auto-sizing), search, web-links, image (sixel), serialize, unicode11

### Tauri WebView Compatibility

xterm.js runs in a browser context. Tauri's webview is:
- **Windows:** WebView2 (Chromium-based Edge) — full modern web API support
- Canvas and WebGL renderers should work in WebView2
- No known blocking issues for xterm.js in Tauri WebView2

Multiple community projects have demonstrated xterm.js + Tauri integration. The pattern is:
1. xterm.js `Terminal` instance in the webview
2. `terminal.onData()` callback sends keystrokes to Rust via `invoke()`
3. Rust reads from PTY and emits raw bytes via Tauri events
4. Frontend listener calls `terminal.write(data)` to feed xterm.js

### Integration With Our React Components

xterm.js manages its own DOM (canvas element). It does NOT produce React virtual DOM. Integration requires:
- A React wrapper component that mounts xterm.js into a `<div ref={...}>`
- xterm.js handles ALL rendering for that terminal area
- Our React components (block headers, actions, search) would need to be overlaid or adjacent, not interleaved

### Pros
- Battle-tested (powers VS Code terminal)
- GPU-accelerated rendering (WebGL addon)
- Complete terminal emulation (sixel graphics, OSC hyperlinks, etc.)
- Rich addon ecosystem (search, fit, serialize)
- Active maintenance, large community
- Works in WebView2

### Cons
- Replaces our entire rendering pipeline (AnsiOutput, useIncrementalAnsi, block output rendering)
- Own input handling conflicts with our InputEditor
- No native "block" concept — would need to hack around it or abandon blocks
- Canvas rendering means our DOM-based Find in Output won't work (need xterm's search addon)
- Adds ~300KB+ to bundle size (with addons)
- Styling is through xterm.js theming API, not our CSS

### Verdict
**Technically feasible in Tauri.** But adopting it wholesale destroys our block model and custom UI paradigm. Only viable as part of a hybrid approach for raw/alternate-screen mode.

---

## 6. Hybrid Approach Feasibility

### Alternate Screen Detection

The alternate screen buffer is activated by `\x1b[?1049h` (or the older `\x1b[?47h` / `\x1b[?1047h`) and deactivated by `\x1b[?1049l`. This is **reliable and well-standardized.** Virtually all programs that need a full-screen TUI use this sequence:

| Program | Uses Alternate Screen? | Uses Cursor Movement? |
|---------|----------------------|---------------------|
| vim/neovim | Yes | Yes |
| nano | Yes | Yes |
| less/more | Yes | Yes |
| htop/top | Yes | Yes |
| man (pager) | Yes (via less) | Yes |
| fzf | **No** (inline mode) | Yes |
| bat | Depends on config | Sometimes |
| Progress bars | **No** | Yes (`\r`, `\x1b[A`) |
| PowerShell PSReadLine | **No** | Yes |
| git log (pager) | Yes (via less) | Yes |

### Detection Implementation

With `vt100` crate: `parser.screen().alternate_screen()` returns a bool after each `process()` call. This is the simplest detection mechanism.

Alternatively, we could detect in our existing `AnsiFilter` by extending `csi_dispatch()` to watch for the `?1049h` private mode sequence. This would avoid adding a full terminal emulator for detection alone.

### Mode Switching Architecture

```
Normal Mode (block model):
  PTY → AnsiFilter → string → Block.output → AnsiOutput (React DOM)

Raw/Fullscreen Mode (terminal emulator):
  PTY → raw bytes → xterm.js or vt100 grid → canvas/WebGL or grid renderer
```

Transition triggers:
1. **Enter raw mode:** AnsiFilter (or vt100) detects `\x1b[?1049h` → frontend switches active block to fullscreen renderer
2. **Exit raw mode:** Detects `\x1b[?1049l` → captures final screen content as block output, switches back to normal rendering

### The "In-Between" Problem

Programs like `fzf` (inline mode), progress bars, and PowerShell's PSReadLine use cursor movement WITHOUT alternate screen. Under the hybrid approach, these would still be broken in normal mode.

Possible mitigations:
- **Accept the limitation for MVP:** Most broken programs (vim, less, htop) use alternate screen. Progress bars and fzf are lower priority.
- **Enhanced normal mode:** Use `vt100` in Rust for ALL output (not just alternate screen), but serialize the scrollback transcript as a string for the block model. This gives us cursor movement in normal mode too, at the cost of complexity.

---

## 7. Performance Implications

### Current Approach (React DOM)
- **Rendering:** Each ANSI span becomes a `<span>` DOM element with inline styles. A command producing 1000 colored lines could generate 5000+ DOM nodes.
- **Parsing:** Dual parsing — `vte` in Rust (filter), then `Anser` in JS (SGR→styles). Redundant work.
- **Incremental:** `useIncrementalAnsi` only re-parses new chunks. `React.memo` on `BlockView` and `AnsiOutput` prevents re-renders of unchanged blocks.
- **Bottleneck:** DOM node count for large outputs. Mitigated by block visibility virtualization (IntersectionObserver).
- **Measured:** Adequate for typical shell output (< 10KB per command). Would struggle with programs producing rapid continuous output (e.g., `yes`, compilation logs at high speed).

### Option A: Rust-side Emulator (vt100)
- **Grid size:** 80x24 = 1920 cells. At ~50 bytes/cell serialized, that's ~96KB per full frame. With `contents_diff()`, typical updates are much smaller.
- **IPC overhead:** Serializing grid state to JSON through Tauri events adds latency. At 60fps, 96KB * 60 = 5.7MB/s through IPC — feasible but not free.
- **React rendering:** Would need a grid renderer (table or positioned divs). ~1920 cells is manageable for React if we use proper memoization and only update changed rows.
- **Advantage:** All heavy parsing stays in Rust. Frontend is a dumb renderer.
- **Risk:** Serialization/deserialization overhead could negate Rust parsing gains.

### Option B: xterm.js
- **Rendering:** Canvas/WebGL — hardware accelerated, handles millions of cells efficiently. This is how VS Code, Hyper, and professional terminals render.
- **Performance:** Excellent. xterm.js is optimized for high-throughput terminal output. Handles `cat /dev/urandom` at full speed.
- **No IPC serialization:** Raw bytes go straight to xterm.js. Minimal overhead.
- **Best performing option by far for raw terminal output.**

### Option C: Hybrid
- **Normal mode:** Same as current approach (adequate for typical output).
- **Raw mode:** Same as Option B (xterm.js) or Option A (grid renderer) — excellent for TUI apps.
- **Transition cost:** Switching renderers has a brief visual glitch risk. Can be mitigated with a loading frame.

---

## 8. Impact on Existing Features

| Feature | Option A (Rust Grid) | Option B (xterm.js Full) | Option C (Hybrid) |
|---------|---------------------|------------------------|--------------------|
| **Find in Output** (Ctrl+Shift+F) | Works on scrollback transcript string | Lost (xterm.js search addon is different UX) | Works in normal mode; xterm.js search addon in raw mode |
| **Block actions** (copy cmd, copy output, rerun) | Preserved — blocks still exist | Lost — no block concept | Preserved in normal mode; limited in raw mode |
| **Scrollback** | Managed by vt100 + serialized to blocks | Managed by xterm.js (own scrollback) | Both, depending on mode |
| **Input Editor** (decoupled) | Preserved — editor separate from output | Conflicts with xterm.js input handling | Preserved in normal mode; xterm.js handles input in raw mode |
| **Tab completions** | Preserved | Lost (xterm.js handles keys) | Preserved in normal mode |
| **Exit code detection** | Works via marker parsing | Would need rework (raw bytes, no filter) | Works in normal mode; not applicable in raw mode |
| **Output truncation** (500KB cap) | Applied to transcript string | xterm.js manages own scrollback limit | Applied in normal mode |
| **Block visibility virtualization** | Preserved | Not applicable (xterm.js has own viewport) | Preserved in normal mode |
| **Agent mode** (NL→CLI translation) | Preserved | Preserved (input routing is separate) | Preserved |
| **ANSI color rendering** | Full (vt100 handles all sequences) | Full (xterm.js handles everything) | Full in both modes |

---

## 9. Recommendation

### Recommended Approach: Option C (Hybrid) with `vt100` crate

**Specifically: Use `vt100` in Rust for ALL output processing, with dual output modes.**

#### Architecture

```
PTY raw bytes
  → vt100::Parser::process() in reader thread
    → Check screen.alternate_screen()
    → If normal mode:
        → Extract scrollback text (screen.contents() or similar)
        → Send as string via existing PtyEvent::Output pipeline
        → Block model + AnsiOutput rendering (unchanged)
    → If alternate screen:
        → Serialize grid state (rows of styled cells) or full ANSI (contents_formatted())
        → Send via new PtyEvent::ScreenUpdate event
        → Frontend renders grid overlay (new TerminalGrid component)
```

#### Why This Approach

1. **Preserves the block model** — Velocity's key differentiator over traditional terminals. Normal shell commands still produce blocks with copy, rerun, search, and exit codes.

2. **Enables full terminal programs** — vim, less, htop, nano all work in alternate screen mode with a dedicated grid renderer.

3. **Handles the "in-between" programs** — By using `vt100` for ALL output (not just alternate screen), cursor movement in normal mode is handled correctly. Progress bars, PSReadLine line editing, and fzf inline mode work because `vt100` processes cursor movement internally. We extract the rendered text from the virtual screen rather than the raw byte stream.

4. **Avoids xterm.js conflicts** — No need to reconcile xterm.js's input handling with our decoupled InputEditor. No canvas rendering conflicts with our DOM-based search highlights.

5. **`vt100` is ideal** — Purpose-built, clean API, `alternate_screen()` detection, `contents_diff()` for efficient updates. Lightweight dependency.

6. **Incremental implementation** — Phase 1 can just replace `AnsiFilter` with `vt100` and extract rendered text (fixing progress bars and cursor movement with minimal frontend changes). Phase 2 adds the grid renderer for alternate screen mode.

#### Implementation Phases

**Phase 1 — Replace AnsiFilter with vt100 (fixes cursor movement, progress bars)**
- Replace `AnsiFilter` with `vt100::Parser` in `spawn_reader_thread()`
- After `parser.process(chunk)`, extract `screen.contents_formatted()`
- Send formatted output through existing pipeline
- This alone fixes progress bars, backspace rendering, PSReadLine, and basic cursor movement
- Block model, search, copy — all unchanged
- Estimated effort: 1-2 days

**Phase 2 — Add alternate screen detection + grid renderer (fixes vim, less, htop)**
- Detect `screen.alternate_screen()` transition
- When entering alternate screen: emit a new event type with grid state
- Frontend: new `TerminalGrid` component renders the grid as a positioned overlay
- When exiting alternate screen: remove overlay, resume normal block rendering
- Estimated effort: 3-5 days

**Phase 3 — Optimization**
- Use `screen.contents_diff()` to send only changed portions
- Cell-level memoization in the grid renderer
- Handle edge cases: resize during alternate screen, rapid mode switching

#### What NOT To Do

- **Do not adopt xterm.js wholesale (Option B).** It destroys the block model, which is Velocity's core differentiator over Windows Terminal, Alacritty, and other traditional terminals.
- **Do not use `alacritty_terminal`.** It's overengineered for our needs and has unstable versioning for embedded use. `vt100` is purpose-built and simpler.
- **Do not try to detect "raw mode" programs heuristically.** Stick to the well-defined `alternate_screen()` signal for mode switching.

---

## Files Analyzed

- `src-tauri/src/pty/mod.rs` — PTY management, reader/bridge threads, output pipeline
- `src-tauri/src/ansi/mod.rs` — ANSI filter (vte-based, SGR passthrough, strips everything else)
- `src-tauri/Cargo.toml` — Dependencies (vte 0.15, portable-pty 0.9)
- `src/components/AnsiOutput.tsx` — SGR→React span renderer with search highlights
- `src/components/Terminal.tsx` — Block management, PTY event handling, output accumulation
- `src/components/blocks/BlockView.tsx` — Block rendering with copy/rerun actions
- `src/hooks/useIncrementalAnsi.ts` — Incremental ANSI parsing cache
- `src/lib/ansi.ts` — Anser-based SGR parsing, stripAnsi utility
- `src/lib/types.ts` — Block type definition
- `package.json` — Frontend dependencies (anser, react 19)

## External Libraries Researched

- **`vt100` crate** (v0.15.x) — Embeddable terminal emulator, clean API, `alternate_screen()` detection, `contents_diff()`, purpose-built for this use case
- **`alacritty_terminal` crate** (v0.25.1) — Full Alacritty terminal engine, `Term` struct with grid/damage tracking, heavier and more coupled than needed
- **`xterm.js`** (@xterm/xterm 5.x) — Battle-tested browser terminal (powers VS Code), canvas/WebGL rendering, works in Tauri WebView2, but fundamentally incompatible with block model
