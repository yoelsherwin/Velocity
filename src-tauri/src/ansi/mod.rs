/// Terminal emulator wrapper around the `vt100` crate.
///
/// Replaces the old `AnsiFilter` that stripped escape sequences. Instead of
/// filtering, we process ALL sequences through a virtual terminal emulator
/// and extract the rendered screen content. This correctly handles cursor
/// movement, carriage return overwriting, backspace, progress bars, etc.

pub struct TerminalEmulator {
    parser: vt100::Parser,
    /// The last content sent to the frontend, for diff computation.
    last_content: String,
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
        }
    }

    /// Process a chunk of raw PTY bytes through the terminal emulator.
    /// Returns the new output to send to the frontend, or None if nothing changed.
    pub fn process(&mut self, raw: &[u8]) -> Option<TerminalOutput> {
        self.parser.process(raw);
        let screen = self.parser.screen();
        let current = screen.contents_formatted();
        let current_str = String::from_utf8_lossy(&current).to_string();

        if current_str == self.last_content {
            return None; // No visible change
        }

        // Determine if this is an append or a replacement
        let output = if current_str.starts_with(&self.last_content) {
            // Simple append — send just the new part
            let new_part = current_str[self.last_content.len()..].to_string();
            TerminalOutput::Append(new_part)
        } else {
            // Content was overwritten (cursor movement, \r, etc.)
            TerminalOutput::Replace(current_str.clone())
        };

        self.last_content = current_str;
        Some(output)
    }

    /// Resize the virtual terminal.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows, cols);
    }

    /// Check if the terminal is in alternate screen mode.
    pub fn is_alternate_screen(&self) -> bool {
        self.parser.screen().alternate_screen()
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
}
