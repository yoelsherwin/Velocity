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
 * Strip SGR (Select Graphic Rendition) ANSI escape sequences from text.
 * Only strips SGR sequences — the only kind our Rust filter allows through.
 * Used for clean clipboard copying.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Parse ANSI-escaped text into styled spans.
 * Input should already be security-filtered by the Rust backend
 * (only SGR sequences remain).
 */
export function parseAnsi(text: string): AnsiSpan[] {
  const parsed = Anser.ansiToJson(text, { use_classes: false, remove_empty: true });
  return parsed.map((entry) => {
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
