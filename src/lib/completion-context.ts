import { tokenize, Token } from './shell-tokenizer';

export interface CompletionContext {
  type: 'command' | 'path' | 'none';
  partial: string;          // The partial word at cursor (text to complete)
  replaceStart: number;     // Index in input where the partial starts
  replaceEnd: number;       // Index in input where the partial ends (usually cursor pos)
}

/**
 * Determine what kind of completion to perform based on cursor position and input.
 *
 * Uses the existing tokenizer to figure out which token the cursor is in,
 * then decides whether to complete a command name or a file path.
 */
export function getCompletionContext(input: string, cursorPos: number): CompletionContext {
  // Empty input: cursor at position 0 means we're in command position
  if (input === '') {
    return { type: 'command', partial: '', replaceStart: 0, replaceEnd: 0 };
  }

  const tokens = tokenize(input);

  // Build position map: each token gets a start and end position
  interface PositionedToken extends Token {
    start: number;
    end: number;
  }

  const positioned: PositionedToken[] = [];
  let offset = 0;
  for (const token of tokens) {
    positioned.push({
      ...token,
      start: offset,
      end: offset + token.value.length,
    });
    offset += token.value.length;
  }

  // Find which token the cursor is in (or at the boundary of)
  let cursorToken: PositionedToken | null = null;

  for (const pt of positioned) {
    if (cursorPos >= pt.start && cursorPos <= pt.end) {
      cursorToken = pt;
      break;
    }
  }

  // If cursor is past all tokens, check the last token
  if (!cursorToken && positioned.length > 0) {
    const last = positioned[positioned.length - 1];
    if (cursorPos === last.end) {
      cursorToken = last;
    }
  }

  // Special case: cursor is at the end of a whitespace token at the end of input
  if (cursorToken && cursorToken.type === 'whitespace') {
    // Check if this is at the end of input
    if (cursorToken.end === input.length && cursorPos === input.length) {
      // After a command or arguments, completing path
      return { type: 'path', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
    }
    // In the middle of whitespace: no completion
    return { type: 'none', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
  }

  if (!cursorToken) {
    return { type: 'none', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
  }

  // Extract the partial text (text up to cursor position within the token)
  const partialEnd = cursorPos - cursorToken.start;

  switch (cursorToken.type) {
    case 'command': {
      const partial = cursorToken.value.substring(0, partialEnd);
      return {
        type: 'command',
        partial,
        replaceStart: cursorToken.start,
        replaceEnd: cursorPos,
      };
    }
    case 'argument': {
      const partial = cursorToken.value.substring(0, partialEnd);
      return {
        type: 'path',
        partial,
        replaceStart: cursorToken.start,
        replaceEnd: cursorPos,
      };
    }
    case 'string': {
      // Extract unquoted content up to cursor
      const raw = cursorToken.value.substring(0, partialEnd);
      // Remove the leading quote character
      const partial = raw.startsWith('"') || raw.startsWith("'") ? raw.substring(1) : raw;
      return {
        type: 'path',
        partial,
        replaceStart: cursorToken.start,
        replaceEnd: cursorPos,
      };
    }
    case 'flag':
      // Don't complete flags for MVP
      return { type: 'none', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
    case 'pipe':
      return { type: 'none', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
    default:
      return { type: 'none', partial: '', replaceStart: cursorPos, replaceEnd: cursorPos };
  }
}
