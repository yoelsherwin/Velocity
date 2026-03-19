# Security Review: TASK-024 (Alternate Screen Grid Renderer)

**Reviewer**: Security Agent
**Date**: 2026-03-19
**Commit range**: `51fc742..7edf8a3` (2 commits: `bca5fbb` feat + `7edf8a3` fix)
**Verdict**: PASS with findings (1 MEDIUM, 1 LOW, 2 INFORMATIONAL)

---

## 1. Summary of Changes

Alternate screen mode support for fullscreen TUI programs (vim, htop, less, etc.):

- **Rust (`ansi/mod.rs`)**: New `GridCell`, `GridRow` structs, `extract_grid()` function, `color_to_css()` / `ansi_idx_to_css()` color conversion, alt screen transition detection in `TerminalEmulator`
- **Rust (`pty/mod.rs`)**: New `PtyEvent` variants (`AltScreenEnter`, `AltScreenExit`, `GridUpdate`), reader thread alt screen logic with 30fps grid throttling, bridge thread emits 3 new Tauri events
- **Frontend (`TerminalGrid.tsx`)**: New grid renderer component, receives `GridRow[]` data, renders cells with inline styles
- **Frontend (`key-encoder.ts`)**: New keyboard-to-ANSI encoder for sending input during alt screen mode
- **Frontend (`Terminal.tsx`)**: Alt screen state management, 3 new event listeners, `handleGridKeyDown` callback

## 2. Finding SEC-024-01: Key Encoder Passes Raw `e.key` to PTY (MEDIUM)

**File**: `src/lib/key-encoder.ts`, lines 43-45 and 124-126

**Issue**: The `encodeKey()` function sends `e.key` directly to the PTY in two places:

1. **Alt+key** (line 44): `return '\x1b' + e.key;` -- sends ESC + the raw key character
2. **Printable character fallback** (line 125): `return e.key;` -- sends the key as-is

The `e.key` value comes from the browser's `KeyboardEvent` API. For single printable characters (`e.key.length === 1`), this is safe -- the browser produces a single Unicode character. However:

- The **Alt+key path** (line 42-46) checks `e.key.length === 1` before sending, which is correct.
- The **printable fallback** (line 124) also checks `e.key.length === 1` and `!e.ctrlKey && !e.altKey && !e.metaKey`, which is correct.

**Actual risk**: The `e.key` values are constrained by the browser's `KeyboardEvent` API, which only produces well-defined key identifiers. Single-character keys are single Unicode codepoints. There is no mechanism for a remote program to influence `e.key` (it comes from physical keyboard input). The data flows **user keyboard -> browser -> PTY**, which is the intended direction.

**However**, the function does NOT filter control characters that might be produced by unusual keyboard layouts or input methods. A key that produces a character < 0x20 (other than the handled special keys) would be sent verbatim to the PTY. This is unlikely to be exploitable but is a gap in input validation.

**Recommendation**: Add a guard in the printable character fallback to reject control characters:
```typescript
if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
  const code = e.key.charCodeAt(0);
  if (code >= 0x20) return e.key;  // Only printable characters
}
```

**Severity**: MEDIUM -- defense-in-depth gap, not currently exploitable.

## 3. Finding SEC-024-02: Grid Cell Content Rendered Without Sanitization (LOW)

**File**: `src/components/TerminalGrid.tsx`, line 39

**Code**: `{cell.content || ' '}`

**Issue**: `cell.content` is a string from the Rust `GridCell` struct, extracted by `extract_grid()` from the `vt100::Screen`. The content is placed into a React `<span>` using JSX expression interpolation (`{cell.content}`), which is inherently safe against XSS -- React's JSX escapes all string values before rendering into the DOM. There is no use of `dangerouslySetInnerHTML`.

**Data flow**:
```
vt100::Screen::cell(row, col).contents()  // String from vt100 crate
  -> GridCell { content: ... }            // Serialized to JSON via serde
  -> Tauri event payload                  // JSON transport
  -> React JSX {cell.content}             // Auto-escaped by React
```

**Residual risk**: The `content` field could contain Unicode control characters, zero-width characters, or bidirectional override characters (e.g., U+202E RIGHT-TO-LEFT OVERRIDE) that could cause visual confusion but not code execution. A malicious program running in the terminal could emit these to make the UI display misleading text.

**Recommendation**: This is acceptable for a terminal emulator -- terminal programs routinely emit arbitrary Unicode. No action needed, but document that grid content is untrusted display text.

**Severity**: LOW -- visual confusion only, no code execution risk.

## 4. Finding SEC-024-03: Color Strings Used as Inline CSS (INFORMATIONAL)

**Files**: `src-tauri/src/ansi/mod.rs` (`color_to_css`, `ansi_idx_to_css`), `src/components/TerminalGrid.tsx` (`cellStyle`)

**Issue**: The `fg` and `bg` fields of `GridCell` are `Option<String>` values produced by `color_to_css()` in Rust, which generates strings like `"rgb(255,100,0)"`. These are applied as inline `style` properties in React (`color: cell.fg`, `backgroundColor: cell.bg`).

**Analysis**: The Rust `color_to_css()` function uses a `match` on `vt100::Color` enum variants:
- `Color::Default` -> `None` (safe)
- `Color::Idx(idx)` -> `ansi_idx_to_css(idx)` where `idx: u8` produces only `format!("rgb({},{},{})", r, g, b)` with computed integer values (safe -- no user-controlled strings)
- `Color::Rgb(r, g, b)` -> `format!("rgb({},{},{})", r, g, b)` where `r`, `g`, `b` are `u8` (safe -- only 0-255 integers)

All color strings are generated from integer arithmetic, never from untrusted string data. CSS injection is not possible.

**Severity**: INFORMATIONAL -- verified safe.

## 5. Finding SEC-024-04: Alt Screen Mode Spoofing (INFORMATIONAL)

**Issue**: A malicious program could send `\x1b[?1049h` (enter alt screen) followed by crafted grid content to take over the terminal UI, then send `\x1b[?1049l` (exit alt screen) -- this is standard terminal behavior, not a vulnerability. The alt screen detection uses `vt100::Screen::alternate_screen()` which correctly tracks the DECSET/DECRST 1049 state.

**Considerations**:
- The transition detection (`consume_alt_screen_transition()`) compares current vs. previous state, preventing duplicate transitions.
- A malicious program could rapidly toggle alt screen to cause UI flickering, but this is a DoS-level annoyance, not a security issue.
- The 30fps grid throttle (`grid_throttle = 33ms`) in the reader thread prevents unbounded event emission, limiting the impact of rapid grid updates.

**Severity**: INFORMATIONAL -- inherent terminal behavior, not a vulnerability.

## 6. New IPC Surface Analysis

Three new Tauri events are added, all following the established `pty:{event}:{session_id}` pattern:

| Event | Payload | Direction | Risk |
|-------|---------|-----------|------|
| `pty:alt-screen-enter:{sid}` | `{ rows: u16, cols: u16 }` | Rust -> Frontend | Safe: integer-only struct, validated by `validate_dimensions()` at session creation |
| `pty:alt-screen-exit:{sid}` | `()` | Rust -> Frontend | Safe: no payload |
| `pty:grid-update:{sid}` | `Vec<GridRow>` | Rust -> Frontend | See SEC-024-02 and SEC-024-03: content is React-escaped, colors are generated from integers |

All events are **unidirectional** (Rust to frontend), emitted from the bridge thread. The frontend only listens; it does not invoke new Tauri commands. The session ID in event names is a UUID validated at session creation.

**Keyboard input path**: `handleGridKeyDown` -> `encodeKey(e)` -> `writeToSession(sessionId, encoded)` reuses the existing `writeToSession` Tauri command, which already validates the session ID.

## 7. Grid Data Volume / DoS Considerations

Each grid update serializes `rows * cols` cells. At 24x80 = 1,920 cells, with each `GridCell` containing ~50-100 bytes of JSON, a single `pty:grid-update` event is approximately 100-200KB. At 30fps, this is ~3-6MB/s of JSON through the IPC channel.

The 30fps throttle is appropriate. If the terminal is resized to the maximum allowed (500x500 = 250,000 cells), a single grid update could be ~12-25MB. This is bounded by the `validate_dimensions()` limit (max 500x500) but could cause brief UI freezes.

**Recommendation**: Consider adding a grid-specific dimension cap (e.g., 200x300) in `extract_grid()` or clamping the serialized grid size. This is a quality-of-life issue, not a security vulnerability, since dimensions are already validated.

## 8. Positive Security Observations

1. **No `dangerouslySetInnerHTML`**: Grid cell content is rendered via JSX expressions, which auto-escape.
2. **No new Tauri commands**: Only new events (Rust -> Frontend). No new frontend -> Rust attack surface.
3. **Color generation is pure computation**: No user strings flow into CSS values.
4. **Session ID validation**: All existing session ID validation applies to the new event paths.
5. **Listener cleanup**: All 7 listeners (including 3 new) are properly cleaned up in the `startSession` staleness checks and `cleanupListeners`.
6. **Grid throttle**: 30fps cap prevents unbounded event emission.
7. **`e.preventDefault()` + `e.stopPropagation()`**: `handleGridKeyDown` prevents keyboard events from leaking to other handlers during alt screen mode.

## 9. Verdict

**PASS** -- The implementation is sound. The new alt screen rendering path correctly leverages React's built-in XSS protection for cell content, generates CSS color values from integer arithmetic only, and reuses existing validated IPC channels. The key encoder faithfully translates keyboard events to standard ANSI sequences.

Findings summary:
- **SEC-024-01 (MEDIUM)**: Add control character guard in `encodeKey()` printable fallback -- defense-in-depth.
- **SEC-024-02 (LOW)**: Grid cell content could contain misleading Unicode -- inherent to terminal emulators, acceptable.
- **SEC-024-03 (INFORMATIONAL)**: Color strings verified safe (integer-only generation).
- **SEC-024-04 (INFORMATIONAL)**: Alt screen spoofing is standard terminal behavior, mitigated by throttle.
