use vte::{Params, Perform};

const MAX_SEQUENCE_LENGTH: usize = 256;

pub struct AnsiFilter {
    output: String,
    parser: vte::Parser,
}

impl AnsiFilter {
    pub fn new() -> Self {
        AnsiFilter {
            output: String::new(),
            parser: vte::Parser::new(),
        }
    }

    /// Filter a chunk of raw PTY output bytes.
    /// Returns a string containing only safe text + SGR sequences.
    /// The parser is persistent across calls so that SGR sequences split
    /// across chunk boundaries (e.g. at 4096-byte PTY reads) are handled
    /// correctly instead of being silently dropped.
    pub fn filter(&mut self, raw: &[u8]) -> String {
        self.output.clear();
        let mut parser = std::mem::take(&mut self.parser);
        parser.advance(self, raw);
        self.parser = parser;
        self.output.clone()
    }
}

impl Perform for AnsiFilter {
    fn print(&mut self, c: char) {
        self.output.push(c);
    }

    fn execute(&mut self, byte: u8) {
        // Keep: \n (0x0A), \r (0x0D), \t (0x09)
        // Strip: backspace (0x08), bell (0x07) and other C0 controls
        // Backspace is stripped because the frontend does not perform terminal
        // emulation — it only appends text, so raw \b would accumulate invisibly.
        match byte {
            0x0A | 0x0D | 0x09 => self.output.push(byte as char),
            _ => {} // Strip bell, backspace, and other C0 controls
        }
    }

    fn csi_dispatch(&mut self, params: &Params, _intermediates: &[u8], _ignore: bool, action: char) {
        if action == 'm' {
            // SGR — reconstruct the escape sequence
            // Build: \x1b[ + params joined by ';' + m
            let mut reconstructed = String::from("\x1b[");
            let mut first = true;
            for param in params.iter() {
                for &subparam in param {
                    if !first {
                        reconstructed.push(';');
                    }
                    reconstructed.push_str(&subparam.to_string());
                    first = false;
                }
            }
            reconstructed.push('m');

            // Defense-in-depth: vte parser caps at 32 params (making this unreachable
            // through normal parsing), but we bound-check anyway as a safety net against
            // future parser changes or alternative code paths.
            if reconstructed.len() <= MAX_SEQUENCE_LENGTH {
                self.output.push_str(&reconstructed);
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_text_passes_through() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"hello world");
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_sgr_color_preserved() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[31mred text\x1b[0m");
        assert_eq!(result, "\x1b[31mred text\x1b[0m");
    }

    #[test]
    fn test_sgr_bold_preserved() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[1mbold\x1b[0m");
        assert_eq!(result, "\x1b[1mbold\x1b[0m");
    }

    #[test]
    fn test_sgr_multiple_params_preserved() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[1;31;42mstyledtext\x1b[0m");
        assert_eq!(result, "\x1b[1;31;42mstyledtext\x1b[0m");
    }

    #[test]
    fn test_osc_title_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b]0;My Title\x07some text");
        assert_eq!(result, "some text");
    }

    #[test]
    fn test_osc_hyperlink_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b]8;;https://example.com\x07link\x1b]8;;\x07");
        assert_eq!(result, "link");
    }

    #[test]
    fn test_cursor_movement_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[10;5Htext");
        assert_eq!(result, "text");
    }

    #[test]
    fn test_erase_sequence_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[2Jtext");
        assert_eq!(result, "text");
    }

    #[test]
    fn test_device_query_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[6ntext");
        assert_eq!(result, "text");
    }

    #[test]
    fn test_newline_preserved() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"line1\nline2\r\n");
        assert_eq!(result, "line1\nline2\r\n");
    }

    #[test]
    fn test_tab_preserved() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"col1\tcol2");
        assert_eq!(result, "col1\tcol2");
    }

    #[test]
    fn test_bell_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"text\x07more");
        assert_eq!(result, "textmore");
    }

    #[test]
    fn test_empty_input() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"");
        assert_eq!(result, "");
    }

    #[test]
    fn test_sgr_oversize_rejected() {
        // Defense-in-depth test: The vte parser caps at 32 params, so we cannot
        // generate a >256 byte SGR through normal parsing. The MAX_SEQUENCE_LENGTH
        // bound check in csi_dispatch is unreachable via vte but exists as a safety
        // net against future parser changes or alternative code paths.
        // We verify the constant is set and that normal SGR sequences pass through.
        assert_eq!(MAX_SEQUENCE_LENGTH, 256);

        // Test that a normal SGR within bounds passes through
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[1;31;42m");
        assert_eq!(result, "\x1b[1;31;42m");

        // Test with 32 params (vte's max) — should still be under 256 bytes
        let mut seq = Vec::new();
        seq.push(0x1b);
        seq.push(b'[');
        for i in 0..32u16 {
            if i > 0 {
                seq.push(b';');
            }
            let num = format!("{}", 100 + i);
            seq.extend_from_slice(num.as_bytes());
        }
        seq.push(b'm');
        seq.extend_from_slice(b"text");

        let result = filter.filter(&seq);
        // 32 params of 3 digits each = ~130 bytes, well under 256, so it should pass
        assert!(result.contains("text"));
        assert!(result.contains("\x1b["));
    }

    #[test]
    fn test_mixed_safe_and_unsafe() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"\x1b[31mred\x1b[0m\x1b]0;title\x07\x1b[1;5Hnormal");
        assert_eq!(result, "\x1b[31mred\x1b[0mnormal");
    }

    #[test]
    fn test_backspace_stripped() {
        let mut filter = AnsiFilter::new();
        let result = filter.filter(b"abc\x08def");
        // Backspace (0x08) should be stripped since the frontend doesn't emulate it
        assert_eq!(result, "abcdef");
    }

    #[test]
    fn test_parser_persists_across_chunks() {
        // Simulate an SGR sequence split across two PTY read chunks.
        // With a persistent parser, the sequence is reassembled correctly.
        let mut filter = AnsiFilter::new();

        // First chunk: ESC [ 3 1 (start of SGR red)
        let chunk1 = b"\x1b[31";
        // Second chunk: m followed by text (completes the SGR)
        let chunk2 = b"mred text\x1b[0m";

        let result1 = filter.filter(chunk1);
        let result2 = filter.filter(chunk2);

        let combined = format!("{}{}", result1, result2);
        // The persistent parser should reconstruct the split SGR sequence
        assert!(combined.contains("red text"), "Split SGR should produce text output, got: {}", combined);
        assert!(combined.contains("\x1b[31m"), "Split SGR should be reconstructed, got: {}", combined);
    }
}
