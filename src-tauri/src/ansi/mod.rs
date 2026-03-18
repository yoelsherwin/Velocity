/// Terminal emulator wrapper around the `vt100` crate.
///
/// Replaces the old `AnsiFilter` that stripped escape sequences. Instead of
/// filtering, we process ALL sequences through a virtual terminal emulator
/// and extract the rendered screen content. This correctly handles cursor
/// movement, carriage return overwriting, backspace, progress bars, etc.
///
/// The output from `vt100::Screen::contents_formatted()` can contain non-SGR
/// escape sequences (cursor movement, screen clearing, erase characters,
/// cursor visibility, backspace). We post-process through `sanitize_to_sgr_only()`
/// to ensure only text + SGR sequences reach the frontend.

/// Sanitize terminal output to contain only text and SGR (Select Graphic
/// Rendition) escape sequences. Strips all CSI sequences whose final byte
/// is not `m`, all private-mode sequences (e.g., `\x1b[?25l`), and unsafe
/// C0 control characters (backspace, etc.). Preserves `\n`, `\r`, and `\t`.
fn sanitize_to_sgr_only(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == 0x1b && i + 1 < len && bytes[i + 1] == b'[' {
            // CSI sequence: \x1b[ followed by parameter bytes (0x30-0x3F),
            // intermediate bytes (0x20-0x2F), and a final byte (0x40-0x7E).
            let start = i;
            i += 2; // skip \x1b[

            // Skip parameter bytes (digits, semicolons, colons, ?, >, etc.)
            while i < len && bytes[i] >= 0x30 && bytes[i] <= 0x3F {
                i += 1;
            }
            // Skip intermediate bytes (space through /)
            while i < len && bytes[i] >= 0x20 && bytes[i] <= 0x2F {
                i += 1;
            }
            // Final byte determines the sequence type
            if i < len && bytes[i] >= 0x40 && bytes[i] <= 0x7E {
                let final_byte = bytes[i];
                i += 1;
                if final_byte == b'm' {
                    // SGR sequence — keep it
                    result.push_str(&input[start..i]);
                }
                // All other CSI sequences (H, J, K, C, X, l, h, etc.) are dropped
            }
            // If we ran out of bytes without a final byte, drop the partial sequence
        } else if bytes[i] == 0x1b {
            // Non-CSI escape sequence (e.g., \x1bM, \x1b7, \x1b8) — drop it
            i += 1;
            // Skip the next byte if present (the command character)
            if i < len && bytes[i] >= 0x40 && bytes[i] <= 0x7E {
                i += 1;
            }
        } else if bytes[i] == 0x08 {
            // Backspace — drop it
            i += 1;
        } else if bytes[i] < 0x20 && bytes[i] != b'\n' && bytes[i] != b'\r' && bytes[i] != b'\t' {
            // Other C0 control characters — drop them
            i += 1;
        } else {
            // Regular text byte (or part of multi-byte UTF-8) — keep it.
            // Advance past the full UTF-8 character to avoid splitting.
            let ch_len = utf8_char_len(bytes[i]);
            let end = (i + ch_len).min(len);
            result.push_str(&input[i..end]);
            i = end;
        }
    }

    result
}

/// Return the byte length of a UTF-8 character given its first byte.
fn utf8_char_len(first_byte: u8) -> usize {
    if first_byte < 0x80 {
        1
    } else if first_byte < 0xE0 {
        2
    } else if first_byte < 0xF0 {
        3
    } else {
        4
    }
}

/// A single cell in the terminal grid, serialized for the frontend.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct GridCell {
    pub content: String,
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub dim: bool,
}

/// A row of cells in the terminal grid.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct GridRow {
    pub cells: Vec<GridCell>,
}

/// Convert a vt100 color to a CSS color string.
/// Returns None for default colors (let the frontend theme handle it).
pub fn color_to_css(color: vt100::Color) -> Option<String> {
    match color {
        vt100::Color::Default => None,
        vt100::Color::Idx(idx) => Some(ansi_idx_to_css(idx)),
        vt100::Color::Rgb(r, g, b) => Some(format!("rgb({},{},{})", r, g, b)),
    }
}

/// Map a 256-color index to a CSS rgb() string.
/// Colors 0-7: standard ANSI (Catppuccin Mocha mapping)
/// Colors 8-15: bright ANSI (Catppuccin Mocha mapping)
/// Colors 16-231: 6x6x6 color cube
/// Colors 232-255: grayscale ramp
fn ansi_idx_to_css(idx: u8) -> String {
    // Catppuccin Mocha 16-color palette
    static PALETTE_16: [(u8, u8, u8); 16] = [
        (69, 71, 90),     // 0  black   (surface1)
        (243, 139, 168),  // 1  red
        (166, 227, 161),  // 2  green
        (249, 226, 175),  // 3  yellow
        (137, 180, 250),  // 4  blue
        (203, 166, 247),  // 5  magenta
        (148, 226, 213),  // 6  cyan
        (186, 194, 222),  // 7  white   (subtext1)
        (88, 91, 112),    // 8  bright black  (overlay0)
        (243, 139, 168),  // 9  bright red
        (166, 227, 161),  // 10 bright green
        (249, 226, 175),  // 11 bright yellow
        (137, 180, 250),  // 12 bright blue
        (203, 166, 247),  // 13 bright magenta
        (148, 226, 213),  // 14 bright cyan
        (205, 214, 244),  // 15 bright white (text)
    ];

    if idx < 16 {
        let (r, g, b) = PALETTE_16[idx as usize];
        return format!("rgb({},{},{})", r, g, b);
    }

    if idx < 232 {
        // 6x6x6 color cube: index 16-231
        let i = idx - 16;
        let ri = i / 36;
        let gi = (i % 36) / 6;
        let bi = i % 6;
        let r = if ri == 0 { 0 } else { 55 + ri * 40 };
        let g = if gi == 0 { 0 } else { 55 + gi * 40 };
        let b = if bi == 0 { 0 } else { 55 + bi * 40 };
        return format!("rgb({},{},{})", r, g, b);
    }

    // Grayscale ramp: index 232-255
    let level = 8 + (idx - 232) * 10;
    format!("rgb({},{},{})", level, level, level)
}

/// Extract the full grid state from a vt100 screen.
pub fn extract_grid(screen: &vt100::Screen, rows: u16, cols: u16) -> Vec<GridRow> {
    let mut grid = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        let mut cells = Vec::with_capacity(cols as usize);
        for col in 0..cols {
            if let Some(cell) = screen.cell(row, col) {
                cells.push(GridCell {
                    content: cell.contents().to_string(),
                    fg: color_to_css(cell.fgcolor()),
                    bg: color_to_css(cell.bgcolor()),
                    bold: cell.bold(),
                    italic: cell.italic(),
                    underline: cell.underline(),
                    dim: false, // vt100 0.15 does not expose faint/dim
                });
            } else {
                cells.push(GridCell {
                    content: " ".to_string(),
                    fg: None,
                    bg: None,
                    bold: false,
                    italic: false,
                    underline: false,
                    dim: false,
                });
            }
        }
        grid.push(GridRow { cells });
    }
    grid
}

pub struct TerminalEmulator {
    parser: vt100::Parser,
    /// The last content sent to the frontend, for diff computation.
    last_content: String,
    /// Track the current alternate screen state for transition detection.
    was_alternate_screen: bool,
    /// Rows for grid extraction.
    rows: u16,
    /// Cols for grid extraction.
    cols: u16,
}

/// Output produced by the terminal emulator after processing a chunk.
#[derive(Debug, Clone, PartialEq)]
pub enum TerminalOutput {
    /// New content to append (normal case — output simply grew)
    Append(String),
    /// Full content to replace block output with (overwrite case — cursor movement, \r, etc.)
    Replace(String),
}

impl TerminalEmulator {
    pub fn new(rows: u16, cols: u16) -> Self {
        TerminalEmulator {
            parser: vt100::Parser::new(rows, cols, 0),
            last_content: String::new(),
            was_alternate_screen: false,
            rows,
            cols,
        }
    }

    /// Process a chunk of raw PTY bytes through the terminal emulator.
    /// Returns the new output to send to the frontend, or None if nothing changed.
    ///
    /// The output from `vt100::Screen::contents_formatted()` is post-processed
    /// through `sanitize_to_sgr_only()` to guarantee that only text + SGR
    /// escape sequences reach the frontend. This maintains the security
    /// contract documented in `src/lib/ansi.ts`.
    pub fn process(&mut self, raw: &[u8]) -> Option<TerminalOutput> {
        self.parser.process(raw);
        let screen = self.parser.screen();
        let current = screen.contents_formatted();
        let current_str = String::from_utf8_lossy(&current).to_string();

        // Sanitize: strip all non-SGR escape sequences (cursor movement,
        // screen clearing, erase, cursor visibility, backspace, etc.)
        let sanitized = sanitize_to_sgr_only(&current_str);

        if sanitized == self.last_content {
            return None; // No visible change
        }

        // Determine if this is an append or a replacement.
        //
        // Safety of `starts_with` + byte-offset slicing: the sanitized output
        // contains only ASCII escape codes (\x1b[...m) and text content.
        // Escape codes are pure ASCII, so `self.last_content.len()` always
        // falls on a UTF-8 character boundary — never inside a multi-byte
        // character — because any multi-byte text in `last_content` was
        // counted by its full byte length, and the prefix match guarantees
        // the same bytes appear at the same positions.
        let output = if sanitized.starts_with(&self.last_content) {
            // Simple append — send just the new part
            let new_part = sanitized[self.last_content.len()..].to_string();
            TerminalOutput::Append(new_part)
        } else {
            // Content was overwritten (cursor movement, \r, etc.)
            TerminalOutput::Replace(sanitized.clone())
        };

        self.last_content = sanitized;
        Some(output)
    }

    /// Resize the virtual terminal.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.rows = rows;
        self.cols = cols;
        self.parser.set_size(rows, cols);
    }

    /// Check if the terminal is in alternate screen mode.
    pub fn is_alternate_screen(&self) -> bool {
        self.parser.screen().alternate_screen()
    }

    /// Check if the alt screen state changed since last call to `consume_alt_screen_transition`.
    /// Returns Some(true) if entered alt screen, Some(false) if exited, None if no change.
    pub fn consume_alt_screen_transition(&mut self) -> Option<bool> {
        let current = self.is_alternate_screen();
        if current != self.was_alternate_screen {
            self.was_alternate_screen = current;
            Some(current)
        } else {
            None
        }
    }

    /// Extract the current grid state from the vt100 screen.
    pub fn extract_grid(&self) -> Vec<GridRow> {
        extract_grid(self.parser.screen(), self.rows, self.cols)
    }

    /// Get the current terminal dimensions.
    pub fn dimensions(&self) -> (u16, u16) {
        (self.rows, self.cols)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emulator_plain_text() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"hello world");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("hello world"), "Expected 'hello world' in output, got: {}", s);
            }
        }
    }

    #[test]
    fn test_emulator_sgr_preserved() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"\x1b[31mred text\x1b[0m");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("red text"), "Expected 'red text', got: {}", s);
                // vt100 contents_formatted() should include SGR codes
                assert!(s.contains("\x1b["), "Expected SGR escape in output, got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_carriage_return() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"hello\rworld");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                // "hello\rworld" should overwrite "hello" with "world"
                assert!(s.contains("world"), "Expected 'world' in output, got: {:?}", s);
                assert!(!s.contains("hello"), "Expected 'hello' to be overwritten, got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_backspace() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"abc\x08d");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                // "abc\x08d" should produce "abd" (backspace moves cursor, 'd' overwrites 'c')
                assert!(s.contains("abd"), "Expected 'abd', got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_cursor_up() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"line1\nline2\x1b[Aoverwrite");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                // Cursor up should move to line1 and overwrite with "overwrite"
                // line1 starts with "line1", cursor up puts us on that line at col 5
                // Then "overwrite" overwrites from there
                assert!(s.contains("overwrite"), "Expected 'overwrite', got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_clear_screen() {
        let mut emu = TerminalEmulator::new(24, 80);
        // First write some text
        emu.process(b"some text here");
        // Then clear screen
        let result = emu.process(b"\x1b[2J");
        // After clear, the screen should be empty (or contain just whitespace)
        // The result could be None (if screen is empty == last_content was empty)
        // or Replace with empty/whitespace content
        if let Some(output) = result {
            match output {
                TerminalOutput::Replace(s) => {
                    // After clear screen, the visible text content should be gone
                    assert!(!s.contains("some text here"), "Expected text to be cleared, got: {:?}", s);
                }
                TerminalOutput::Append(s) => {
                    // This shouldn't happen, but if it does, the old text should be gone
                    assert!(!s.contains("some text here"), "Expected text to be cleared, got: {:?}", s);
                }
            }
        }
        // If None, it means the screen content didn't change visually (empty to empty)
    }

    #[test]
    fn test_emulator_progress_bar() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"[###       ] 30%\r[######    ] 60%\r[##########] 100%");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("100%"), "Expected '100%' in output, got: {:?}", s);
                // Should NOT contain the old percentages as separate lines
                assert!(!s.contains("30%"), "Expected '30%' to be overwritten, got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_append_detection() {
        let mut emu = TerminalEmulator::new(24, 80);
        // First chunk
        let result1 = emu.process(b"hello ");
        assert!(result1.is_some());
        // Second chunk — should be detected as append
        let result2 = emu.process(b"world");
        assert!(result2.is_some());
        match result2.unwrap() {
            TerminalOutput::Append(s) => {
                assert!(s.contains("world"), "Expected 'world' in appended output, got: {:?}", s);
            }
            TerminalOutput::Replace(s) => {
                panic!("Expected Append, got Replace: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_overwrite_detection() {
        let mut emu = TerminalEmulator::new(24, 80);
        // First chunk
        emu.process(b"hello");
        // Carriage return + new text — should be detected as Replace
        let result = emu.process(b"\rworld");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Replace(_) => {
                // Expected — overwrite detected
            }
            TerminalOutput::Append(s) => {
                panic!("Expected Replace for carriage return overwrite, got Append: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_alternate_screen_detection() {
        let mut emu = TerminalEmulator::new(24, 80);
        assert!(!emu.is_alternate_screen());

        // Enter alternate screen
        emu.process(b"\x1b[?1049h");
        assert!(emu.is_alternate_screen());

        // Exit alternate screen
        emu.process(b"\x1b[?1049l");
        assert!(!emu.is_alternate_screen());
    }

    #[test]
    fn test_emulator_resize() {
        let mut emu = TerminalEmulator::new(24, 80);
        // Should not panic
        emu.resize(40, 120);
        // Process some text after resize to verify it works
        let result = emu.process(b"after resize");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("after resize"), "Expected 'after resize', got: {:?}", s);
            }
        }
    }

    #[test]
    fn test_emulator_empty_input_no_change() {
        let mut emu = TerminalEmulator::new(24, 80);
        // First call with empty bytes may produce initial screen state
        let _ = emu.process(b"");
        // Second call with empty bytes should produce no change
        let result = emu.process(b"");
        assert!(result.is_none(), "Expected None for second empty input (no change), got: {:?}", result);
    }

    #[test]
    fn test_emulator_256_and_truecolor() {
        let mut emu = TerminalEmulator::new(24, 80);
        // 256-color
        let result = emu.process(b"\x1b[38;5;196mred256\x1b[0m");
        assert!(result.is_some());
        match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("red256"), "Expected 'red256', got: {:?}", s);
                // vt100 should preserve SGR codes in contents_formatted()
                assert!(s.contains("\x1b["), "Expected SGR codes preserved, got: {:?}", s);
            }
        }

        // Truecolor
        let mut emu2 = TerminalEmulator::new(24, 80);
        let result2 = emu2.process(b"\x1b[38;2;255;100;0morange\x1b[0m");
        assert!(result2.is_some());
        match result2.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => {
                assert!(s.contains("orange"), "Expected 'orange', got: {:?}", s);
            }
        }
    }

    // ---- sanitize_to_sgr_only tests ----

    #[test]
    fn test_sanitize_keeps_plain_text() {
        assert_eq!(sanitize_to_sgr_only("hello world"), "hello world");
    }

    #[test]
    fn test_sanitize_keeps_sgr_sequences() {
        let input = "\x1b[31mred\x1b[0m";
        assert_eq!(sanitize_to_sgr_only(input), input);
    }

    #[test]
    fn test_sanitize_keeps_complex_sgr() {
        // 256-color, truecolor, bold+italic combinations
        let input = "\x1b[1;3;38;5;196mtext\x1b[0m";
        assert_eq!(sanitize_to_sgr_only(input), input);

        let input2 = "\x1b[38;2;255;100;0mtext\x1b[0m";
        assert_eq!(sanitize_to_sgr_only(input2), input2);
    }

    #[test]
    fn test_sanitize_strips_cursor_home() {
        let input = "\x1b[Hhello";
        assert_eq!(sanitize_to_sgr_only(input), "hello");
    }

    #[test]
    fn test_sanitize_strips_cursor_position() {
        let input = "\x1b[5;10Hhello";
        assert_eq!(sanitize_to_sgr_only(input), "hello");
    }

    #[test]
    fn test_sanitize_strips_cursor_movement() {
        // Cursor right
        assert_eq!(sanitize_to_sgr_only("\x1b[5Chello"), "hello");
        // Cursor up
        assert_eq!(sanitize_to_sgr_only("\x1b[Ahello"), "hello");
        // Cursor down
        assert_eq!(sanitize_to_sgr_only("\x1b[Bhello"), "hello");
        // Cursor left (back)
        assert_eq!(sanitize_to_sgr_only("\x1b[Dhello"), "hello");
    }

    #[test]
    fn test_sanitize_strips_erase_sequences() {
        // Clear screen
        assert_eq!(sanitize_to_sgr_only("\x1b[Jhello"), "hello");
        assert_eq!(sanitize_to_sgr_only("\x1b[2Jhello"), "hello");
        // Clear line
        assert_eq!(sanitize_to_sgr_only("\x1b[Khello"), "hello");
        // Erase character
        assert_eq!(sanitize_to_sgr_only("\x1b[Xhello"), "hello");
        assert_eq!(sanitize_to_sgr_only("\x1b[3Xhello"), "hello");
    }

    #[test]
    fn test_sanitize_strips_cursor_visibility() {
        // Hide cursor (private mode sequence)
        assert_eq!(sanitize_to_sgr_only("\x1b[?25lhello"), "hello");
        // Show cursor
        assert_eq!(sanitize_to_sgr_only("\x1b[?25hhello"), "hello");
    }

    #[test]
    fn test_sanitize_strips_backspace() {
        assert_eq!(sanitize_to_sgr_only("abc\x08d"), "abcd");
    }

    #[test]
    fn test_sanitize_preserves_newlines_and_tabs() {
        let input = "line1\nline2\r\n\ttabbed";
        assert_eq!(sanitize_to_sgr_only(input), input);
    }

    #[test]
    fn test_sanitize_mixed_sgr_and_non_sgr() {
        // Mix of SGR (keep) and cursor movement (strip)
        let input = "\x1b[H\x1b[J\x1b[31mred text\x1b[0m\x1b[5C more";
        let expected = "\x1b[31mred text\x1b[0m more";
        assert_eq!(sanitize_to_sgr_only(input), expected);
    }

    #[test]
    fn test_sanitize_strips_other_c0_controls() {
        // Bell, form feed, etc. should be stripped
        assert_eq!(sanitize_to_sgr_only("\x07hello\x0cworld"), "helloworld");
    }

    #[test]
    fn test_sanitize_handles_utf8() {
        assert_eq!(sanitize_to_sgr_only("hello \u{1f600} world"), "hello \u{1f600} world");
        // UTF-8 with SGR
        let input = "\x1b[32m\u{00e9}l\u{00e8}ve\x1b[0m";
        assert_eq!(sanitize_to_sgr_only(input), input);
    }

    #[test]
    fn test_sanitize_empty_string() {
        assert_eq!(sanitize_to_sgr_only(""), "");
    }

    /// Critical test: verify that the full emulator pipeline (process -> sanitize)
    /// produces output containing ONLY text and SGR sequences, with no cursor
    /// movement, screen clearing, erase, or cursor visibility sequences.
    #[test]
    fn test_emulator_output_contains_only_sgr_sequences() {
        let mut emu = TerminalEmulator::new(24, 80);

        // Process text that will cause vt100 to emit various non-SGR sequences
        // in contents_formatted() (cursor positioning, screen clearing, etc.)
        let result = emu.process(b"\x1b[31mhello\x1b[0m world");
        assert!(result.is_some());

        let output_str = match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => s,
        };

        // Verify the output contains text
        assert!(output_str.contains("hello"), "Missing text content");
        assert!(output_str.contains("world"), "Missing text content");

        // Verify ALL escape sequences in the output are SGR (end with 'm')
        verify_only_sgr_sequences(&output_str);
    }

    /// Critical test: verify sanitization after cursor movement sequences.
    #[test]
    fn test_emulator_output_after_cursor_movement_is_sgr_only() {
        let mut emu = TerminalEmulator::new(24, 80);

        // Send text with cursor movement, carriage return, backspace
        emu.process(b"line1\nline2\x1b[Aoverwritten");
        let result = emu.process(b"\n\x1b[32mnew line\x1b[0m");
        if let Some(output) = result {
            let s = match output {
                TerminalOutput::Append(s) | TerminalOutput::Replace(s) => s,
            };
            verify_only_sgr_sequences(&s);
        }
    }

    /// Critical test: verify sanitization with progress bar overwrite.
    #[test]
    fn test_emulator_progress_bar_output_is_sgr_only() {
        let mut emu = TerminalEmulator::new(24, 80);
        let result = emu.process(b"[#####] 50%\r[##########] 100%");
        assert!(result.is_some());
        let s = match result.unwrap() {
            TerminalOutput::Append(s) | TerminalOutput::Replace(s) => s,
        };
        verify_only_sgr_sequences(&s);
        assert!(s.contains("100%"));
    }

    // ---- Grid extraction and color conversion tests ----

    #[test]
    fn test_extract_grid_basic() {
        let mut emu = TerminalEmulator::new(24, 80);
        emu.process(b"Hello");
        let grid = emu.extract_grid();
        assert_eq!(grid.len(), 24);
        assert_eq!(grid[0].cells.len(), 80);
        assert_eq!(grid[0].cells[0].content, "H");
        assert_eq!(grid[0].cells[1].content, "e");
        assert_eq!(grid[0].cells[2].content, "l");
        assert_eq!(grid[0].cells[3].content, "l");
        assert_eq!(grid[0].cells[4].content, "o");
    }

    #[test]
    fn test_extract_grid_colors() {
        let mut emu = TerminalEmulator::new(24, 80);
        // Red foreground text
        emu.process(b"\x1b[31mR\x1b[0m");
        let grid = emu.extract_grid();
        let cell = &grid[0].cells[0];
        assert_eq!(cell.content, "R");
        // vt100 stores Idx(1) for color 31 (red)
        assert!(cell.fg.is_some(), "Expected foreground color for red text");
    }

    #[test]
    fn test_extract_grid_dimensions() {
        let emu = TerminalEmulator::new(10, 40);
        let grid = emu.extract_grid();
        assert_eq!(grid.len(), 10);
        for row in &grid {
            assert_eq!(row.cells.len(), 40);
        }
    }

    #[test]
    fn test_extract_grid_bold_italic_underline() {
        let mut emu = TerminalEmulator::new(24, 80);
        emu.process(b"\x1b[1mB\x1b[0m\x1b[3mI\x1b[0m\x1b[4mU\x1b[0m");
        let grid = emu.extract_grid();
        assert!(grid[0].cells[0].bold, "Expected bold");
        assert!(grid[0].cells[1].italic, "Expected italic");
        assert!(grid[0].cells[2].underline, "Expected underline");
    }

    #[test]
    fn test_color_to_css_rgb() {
        let result = color_to_css(vt100::Color::Rgb(255, 100, 0));
        assert_eq!(result, Some("rgb(255,100,0)".to_string()));
    }

    #[test]
    fn test_color_to_css_idx_standard() {
        // Index 1 should map to Catppuccin red
        let result = color_to_css(vt100::Color::Idx(1));
        assert_eq!(result, Some("rgb(243,139,168)".to_string()));
    }

    #[test]
    fn test_color_to_css_idx_256_color_cube() {
        // Index 196 = bright red in the color cube
        let result = color_to_css(vt100::Color::Idx(196));
        assert!(result.is_some());
        // 196 - 16 = 180, 180/36 = 5, (180%36)/6 = 0, 180%6 = 0
        // r = 55 + 5*40 = 255, g = 0, b = 0
        assert_eq!(result, Some("rgb(255,0,0)".to_string()));
    }

    #[test]
    fn test_color_to_css_idx_grayscale() {
        // Index 232 = first grayscale (darkest)
        let result = color_to_css(vt100::Color::Idx(232));
        assert_eq!(result, Some("rgb(8,8,8)".to_string()));
    }

    #[test]
    fn test_color_to_css_default() {
        let result = color_to_css(vt100::Color::Default);
        assert_eq!(result, None);
    }

    #[test]
    fn test_alt_screen_transition_detection() {
        let mut emu = TerminalEmulator::new(24, 80);
        // Initially no transition
        assert_eq!(emu.consume_alt_screen_transition(), None);

        // Enter alt screen
        emu.process(b"\x1b[?1049h");
        assert_eq!(emu.consume_alt_screen_transition(), Some(true));
        // No further transition
        assert_eq!(emu.consume_alt_screen_transition(), None);

        // Exit alt screen
        emu.process(b"\x1b[?1049l");
        assert_eq!(emu.consume_alt_screen_transition(), Some(false));
        assert_eq!(emu.consume_alt_screen_transition(), None);
    }

    #[test]
    fn test_alt_screen_grid_content() {
        let mut emu = TerminalEmulator::new(24, 80);
        // Enter alternate screen
        emu.process(b"\x1b[?1049h");
        assert!(emu.is_alternate_screen());
        // Write text in alt screen
        emu.process(b"\x1b[H\x1b[2JHello from alt screen");
        let grid = emu.extract_grid();
        assert_eq!(grid[0].cells[0].content, "H");
        assert_eq!(grid[0].cells[1].content, "e");
    }

    /// Helper: assert that a string contains only text and SGR escape sequences.
    /// Panics if any non-SGR CSI sequence, backspace, or other unsafe control
    /// character is found.
    fn verify_only_sgr_sequences(s: &str) {
        let bytes = s.as_bytes();
        let len = bytes.len();
        let mut i = 0;

        while i < len {
            if bytes[i] == 0x1b {
                // Must be a CSI sequence starting with \x1b[
                assert!(
                    i + 1 < len && bytes[i + 1] == b'[',
                    "Found non-CSI escape at position {}: {:?}",
                    i,
                    &s[i..]
                );
                i += 2;
                // Skip parameters and intermediates
                while i < len && bytes[i] >= 0x20 && bytes[i] <= 0x3F {
                    i += 1;
                }
                // Final byte must be 'm' (SGR)
                assert!(
                    i < len && bytes[i] == b'm',
                    "Found non-SGR CSI sequence (final byte '{}') in output: {:?}",
                    if i < len { bytes[i] as char } else { '?' },
                    s
                );
                i += 1;
            } else if bytes[i] == 0x08 {
                panic!("Found backspace (0x08) in sanitized output: {:?}", s);
            } else if bytes[i] < 0x20 && bytes[i] != b'\n' && bytes[i] != b'\r' && bytes[i] != b'\t' {
                panic!(
                    "Found unsafe control character 0x{:02x} in sanitized output: {:?}",
                    bytes[i], s
                );
            } else {
                i += 1;
            }
        }
    }
}
