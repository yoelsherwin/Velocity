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
  return parsed
    .filter((entry) => entry.content.length > 0)
    .map((entry) => {
      const span: AnsiSpan = {
        content: entry.content,
      };
      if (entry.fg) {
        span.fg = `rgb(${entry.fg})`;
      }
      if (entry.bg) {
        span.bg = `rgb(${entry.bg})`;
      }
      const decorations: string[] = entry.decorations || [];
      if (decorations.includes('bold')) {
        span.bold = true;
      }
      if (decorations.includes('italic')) {
        span.italic = true;
      }
      if (decorations.includes('underline')) {
        span.underline = true;
      }
      if (decorations.includes('dim')) {
        span.dim = true;
      }
      return span;
    });
}
