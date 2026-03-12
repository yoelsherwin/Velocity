# Task 003: ANSI Security Filter + Color Rendering

## Context

The PTY engine is complete (TASK-002). Current state:

- **HEAD**: `c65cc00` on `main`
- **`src-tauri/src/pty/mod.rs`**: `SessionManager` with `create_session`, `write_to_session`, `resize_session`, `close_session`. Reader thread reads 4096-byte chunks and emits raw `String::from_utf8_lossy` text via `pty:output:{id}` events.
- **`src/components/Terminal.tsx`**: Renders output in a `<pre>{output}</pre>` tag as plain text. Accumulates a string buffer capped at 100K chars.
- **`src-tauri/src/ansi/`**: Empty directory with `.gitkeep`.
- **`src-tauri/src/commands/mod.rs`**: 4 Tauri commands using `spawn_blocking`.
- **`src-tauri/src/lib.rs`**: Registers commands and `AppState` with `Arc<Mutex<SessionManager>>`.

Currently, ANSI escape sequences from shell output (colors, cursor positioning, OSC title changes, etc.) are passed through raw to the frontend and rendered as garbled text. This task adds:
1. **Rust-side ANSI filter** — Parse sequences with `vte`, keep only safe display sequences (SGR colors/styles), strip everything dangerous
2. **Frontend ANSI rendering** — Parse the filtered (safe) ANSI string and render colored/styled text
3. **Session cap** — Add `MAX_SESSIONS` limit (security review M-1)
4. **Remove unused opener plugin** — (security review L-4)

### Architecture

```
PTY bytes
  → Reader thread
    → vte::Parser (Rust)
      → AnsiFilter (implements vte::Perform)
        → Keeps: printable text, SGR sequences (colors/bold/etc)
        → Strips: OSC, DCS, APC, PM, cursor movement, device queries
        → Bounds: sequences > 256 bytes rejected
      → Filtered string (safe ANSI with SGR only)
    → Emit via pty:output:{id}
  → Frontend
    → ansi-to-react (or similar library)
      → Renders <span> elements with inline color styles
```

Key design decision: ANSI parsing is split between Rust (security filter) and frontend (rendering). Rust strips dangerous sequences. The frontend receives a string that only contains printable text + SGR codes, which it renders as styled spans. This avoids sending structured JSON over IPC (performance) while maintaining security.

### Crate: `vte`

Use the [`vte`](https://crates.io/crates/vte) crate (from the Alacritty project). It provides a VT parser state machine. You implement the `vte::Perform` trait to handle parsed actions:

- `print(char)` — printable character → **KEEP** (append to output)
- `execute(byte)` — C0 control codes (newline, carriage return, tab, bell, etc.) → **KEEP** selectively (keep `\n`, `\r`, `\t`, `\x08` backspace; strip bell `\x07` and others)
- `csi_dispatch(params, intermediates, ignore, action)` — CSI sequences → **KEEP only SGR** (action `'m'`), strip everything else (cursor movement, erase, scroll, device queries)
- `esc_dispatch(intermediates, ignore, byte)` — ESC sequences → **STRIP** all
- `osc_dispatch(params, bell_terminated)` — OSC sequences (title set, hyperlinks, file write) → **STRIP** all
- `hook(params, intermediates, ignore, action)` / `put(byte)` / `unhook()` — DCS sequences → **STRIP** all

For SGR (Select Graphic Rendition, CSI `m`): reconstruct the escape sequence from the parsed params and append it to the output. Example: params `[1, 31]` with action `'m'` → emit `\x1b[1;31m` (bold red).

## Requirements

### Backend (Rust)

#### 1. Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
vte = "0.15"
```

Remove `tauri-plugin-opener` from `[dependencies]`.

#### 2. Module: `src-tauri/src/ansi/mod.rs`

Create the `AnsiFilter` struct:

```rust
use vte::{Params, Perform};

const MAX_SEQUENCE_LENGTH: usize = 256;

pub struct AnsiFilter {
    output: String,
    current_sequence_len: usize,
}

impl AnsiFilter {
    pub fn new() -> Self { ... }

    /// Filter a chunk of raw PTY output bytes.
    /// Returns a string containing only safe text + SGR sequences.
    pub fn filter(&mut self, raw: &[u8]) -> String {
        let mut parser = vte::Parser::new();
        self.output.clear();
        for &byte in raw {
            parser.advance(self, byte);
        }
        self.output.clone()
    }
}

impl Perform for AnsiFilter {
    fn print(&mut self, c: char) {
        self.output.push(c);
    }

    fn execute(&mut self, byte: u8) {
        // Keep: \n (0x0A), \r (0x0D), \t (0x09), backspace (0x08)
        // Strip: bell (0x07) and other C0 controls
        match byte {
            0x0A | 0x0D | 0x09 | 0x08 => self.output.push(byte as char),
            _ => {} // Strip
        }
    }

    fn csi_dispatch(&mut self, params: &Params, _intermediates: &[u8], _ignore: bool, action: char) {
        if action == 'm' {
            // SGR — reconstruct the escape sequence
            // Bound check: reject if reconstructed sequence would exceed MAX_SEQUENCE_LENGTH
            // Build: \x1b[ + params joined by ';' + m
            ...
        }
        // All other CSI actions (cursor move, erase, scroll, etc.) are stripped
    }

    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {
        // Strip all OSC sequences (title set, hyperlinks, iTerm2 file write, etc.)
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {
        // Strip DCS sequences
    }

    fn put(&mut self, _byte: u8) {
        // Strip DCS data
    }

    fn unhook(&mut self) {
        // Strip DCS end
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, _byte: u8) {
        // Strip raw ESC sequences
    }
}
```

#### 3. Integrate into reader thread

In `src-tauri/src/pty/mod.rs`, modify the reader thread:

**Before** (current):
```rust
let output = String::from_utf8_lossy(&buf[..n]).to_string();
```

**After**:
```rust
let output = ansi_filter.filter(&buf[..n]);
```

Create the `AnsiFilter` instance inside the reader thread (before the loop). Each reader thread owns its own filter instance.

#### 4. MAX_SESSIONS cap

In `SessionManager::create_session`, add a check at the top:

```rust
const MAX_SESSIONS: usize = 20;

if self.sessions.len() >= MAX_SESSIONS {
    return Err(format!("Maximum session limit ({}) reached", MAX_SESSIONS));
}
```

#### 5. Remove `tauri-plugin-opener`

- Remove `tauri-plugin-opener = "2"` from `src-tauri/Cargo.toml`
- Remove `.plugin(tauri_plugin_opener::init())` from `src-tauri/src/lib.rs`
- Remove `"opener:default"` from `src-tauri/capabilities/default.json`

#### 6. Wire `ansi` module

- Add `mod ansi;` to `src-tauri/src/lib.rs`
- Remove `.gitkeep` from `src-tauri/src/ansi/`

### Frontend (React/TypeScript)

#### 1. Install ANSI rendering library

```bash
npm install anser
```

`anser` is a lightweight ANSI escape code parser that converts ANSI strings to HTML/objects. It's well-maintained and has no dependencies.

Do NOT use `ansi-to-react` (it has React version compatibility issues). Use `anser` directly and render the result.

#### 2. Create ANSI rendering utility

Create `src/lib/ansi.ts`:

```typescript
import Anser from 'anser';

export interface AnsiSpan {
  content: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

/**
 * Parse ANSI-escaped text into styled spans.
 * Input should already be security-filtered by the Rust backend
 * (only SGR sequences remain).
 */
export function parseAnsi(text: string): AnsiSpan[] {
    const parsed = Anser.ansiToJson(text, { use_classes: false });
    return parsed.map(entry => ({
        content: entry.content,
        fg: entry.fg ? `rgb(${entry.fg})` : undefined,
        bg: entry.bg ? `rgb(${entry.bg})` : undefined,
        bold: entry.decoration === 'bold' || undefined,
        italic: entry.decoration === 'italic' || undefined,
        underline: entry.decoration === 'underline' || undefined,
        dim: entry.decoration === 'dim' || undefined,
    }));
}
```

Note: Check `anser`'s actual API when implementing — the interface above is approximate. Adapt to whatever `Anser.ansiToJson()` actually returns. The key point is: parse the ANSI string into segments with style information.

#### 3. Create AnsiOutput component

Create `src/components/AnsiOutput.tsx`:

A component that takes an ANSI string and renders it as styled `<span>` elements:

```tsx
interface AnsiOutputProps {
    text: string;
}

function AnsiOutput({ text }: AnsiOutputProps) {
    const spans = parseAnsi(text);
    return (
        <>
            {spans.map((span, i) => (
                <span key={i} style={{
                    color: span.fg,
                    backgroundColor: span.bg,
                    fontWeight: span.bold ? 'bold' : undefined,
                    fontStyle: span.italic ? 'italic' : undefined,
                    textDecoration: span.underline ? 'underline' : undefined,
                    opacity: span.dim ? 0.5 : undefined,
                }}>
                    {span.content}
                </span>
            ))}
        </>
    );
}
```

#### 4. Update Terminal.tsx

Replace the plain text rendering:

**Before**: `<pre className="terminal-output">{output}</pre>`

**After**: `<pre className="terminal-output"><AnsiOutput text={output} /></pre>`

The rest of Terminal.tsx stays the same — the output buffer is still a string, but it now contains only safe ANSI (SGR codes + text), and `AnsiOutput` renders it with colors.

## Tests (Write These FIRST)

### Rust Tests (`src-tauri/src/ansi/mod.rs`)

- [ ] **`test_plain_text_passes_through`**: `filter(b"hello world")` → returns `"hello world"`

- [ ] **`test_sgr_color_preserved`**: `filter(b"\x1b[31mred text\x1b[0m")` → returns `"\x1b[31mred text\x1b[0m"` (red color SGR kept)

- [ ] **`test_sgr_bold_preserved`**: `filter(b"\x1b[1mbold\x1b[0m")` → returns `"\x1b[1mbold\x1b[0m"`

- [ ] **`test_sgr_multiple_params_preserved`**: `filter(b"\x1b[1;31;42mstyledtext\x1b[0m")` → returns `"\x1b[1;31;42mstyledtext\x1b[0m"` (bold + red fg + green bg)

- [ ] **`test_osc_title_stripped`**: `filter(b"\x1b]0;My Title\x07some text")` → returns `"some text"` (OSC title-set removed)

- [ ] **`test_osc_hyperlink_stripped`**: `filter(b"\x1b]8;;https://example.com\x07link\x1b]8;;\x07")` → returns `"link"` (OSC hyperlink stripped, text preserved)

- [ ] **`test_cursor_movement_stripped`**: `filter(b"\x1b[10;5Htext")` → returns `"text"` (CSI H cursor position stripped)

- [ ] **`test_erase_sequence_stripped`**: `filter(b"\x1b[2Jtext")` → returns `"text"` (CSI J erase display stripped)

- [ ] **`test_device_query_stripped`**: `filter(b"\x1b[6ntext")` → returns `"text"` (CSI n device status report stripped)

- [ ] **`test_newline_preserved`**: `filter(b"line1\nline2\r\n")` → returns `"line1\nline2\r\n"`

- [ ] **`test_tab_preserved`**: `filter(b"col1\tcol2")` → returns `"col1\tcol2"`

- [ ] **`test_bell_stripped`**: `filter(b"text\x07more")` → returns `"textmore"` (bell character removed)

- [ ] **`test_empty_input`**: `filter(b"")` → returns `""`

- [ ] **`test_sgr_oversize_rejected`**: Generate an SGR sequence with more than 256 bytes worth of params (e.g., `\x1b[` followed by hundreds of numbers separated by `;` then `m`). The filter should strip it (not emit it to output).

- [ ] **`test_mixed_safe_and_unsafe`**: `filter(b"\x1b[31mred\x1b[0m\x1b]0;title\x07\x1b[1;5Hnormal")` → returns `"\x1b[31mred\x1b[0mnormal"` (SGR kept, OSC and cursor move stripped)

- [ ] **`test_max_sessions_enforced`**: On `SessionManager`, verify that after creating `MAX_SESSIONS` sessions, the next `create_session` returns an error containing "limit". (This requires mocking or a test-specific constructor — if integration testing with real PTY is too heavy, test the limit check logic in isolation.)

### Frontend Tests (Vitest)

- [ ] **`test_parseAnsi_plain_text`**: `parseAnsi("hello")` → returns array with one span: `{ content: "hello" }` (no style properties)

- [ ] **`test_parseAnsi_colored_text`**: `parseAnsi("\x1b[31mred\x1b[0m")` → returns spans where the "red" span has an `fg` property (exact value depends on anser output format)

- [ ] **`test_AnsiOutput_renders_plain_text`**: Render `<AnsiOutput text="hello world" />`. Assert "hello world" is visible.

- [ ] **`test_AnsiOutput_renders_colored_span`**: Render `<AnsiOutput text="\x1b[31mred text\x1b[0m" />`. Assert a `<span>` with a color style exists containing "red text".

- [ ] **`test_Terminal_still_works`**: Existing Terminal tests should still pass (session creation, input handling, etc.)

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] `vte` added as Rust dependency
- [ ] `AnsiFilter` implemented in `src-tauri/src/ansi/mod.rs` with `vte::Perform`
- [ ] Reader thread uses `AnsiFilter` — only safe text + SGR reaches the frontend
- [ ] OSC, DCS, cursor movement, device queries all stripped
- [ ] SGR sequences (colors, bold, italic, underline, dim, reset) preserved
- [ ] Oversize sequences (> 256 bytes) rejected
- [ ] `anser` installed as frontend dependency
- [ ] `AnsiOutput` component renders colored/styled text
- [ ] Terminal component uses `AnsiOutput` for output rendering
- [ ] `MAX_SESSIONS` cap (20) enforced in `SessionManager::create_session`
- [ ] `tauri-plugin-opener` removed from Cargo.toml, lib.rs, and capabilities
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Manual test: colored output (e.g., PowerShell errors, `Write-Host -ForegroundColor Red "test"`) renders in color
- [ ] No `unwrap()` on user-derived data
- [ ] Clean commit: `feat: add ANSI security filter and color rendering`

## Security Notes

- The filter is the **critical security boundary** between untrusted PTY output and the WebView. Every sequence type must be explicitly handled — default is STRIP.
- OSC sequences are **never** passed through. This prevents title manipulation, hyperlink injection, and file-write attacks.
- CSI sequences: only `m` (SGR) is allowed. All cursor movement, erase, scroll, and device query sequences are stripped.
- SGR sequence size is bounded at 256 bytes to prevent memory abuse.
- DCS sequences are fully stripped (they can carry arbitrary data).
- The `AnsiFilter` is stateless between `filter()` calls by design — each chunk is independently filtered. This means a partial SGR sequence split across two reads will be dropped (acceptable; the next complete sequence will apply correctly).

## Files to Read First

- `src-tauri/src/pty/mod.rs` — Reader thread (lines 97-122) where the filter integrates
- `src-tauri/src/lib.rs` — Module registration, plugin registration (remove opener)
- `src-tauri/Cargo.toml` — Dependencies to modify
- `src-tauri/capabilities/default.json` — Remove opener:default
- `src/components/Terminal.tsx` — Where AnsiOutput replaces plain text rendering
- `src/lib/pty.ts` — IPC wrappers (unchanged, but read for context)
