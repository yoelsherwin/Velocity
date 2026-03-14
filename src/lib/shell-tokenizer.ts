export interface Token {
  type: 'command' | 'argument' | 'flag' | 'string' | 'pipe' | 'whitespace';
  value: string;
}

/**
 * Tokenize shell input for syntax highlighting.
 *
 * This is a simple regex-based tokenizer for DISPLAY purposes only.
 * It does not handle escaping, variable expansion, or subshells.
 *
 * Rules:
 * - First non-whitespace token on each line is a 'command'
 * - After a pipe (|), the next non-whitespace token is also a 'command'
 * - Tokens starting with - or -- are 'flag'
 * - Quoted strings ("..." or '...') are 'string'
 * - |, >, >>, < are 'pipe'
 * - Whitespace is preserved as separate tokens
 * - Everything else is 'argument'
 */
export function tokenize(input: string): Token[] {
  if (input === '') return [];

  const tokens: Token[] = [];

  // Regex to match tokens in order:
  // 1. Whitespace (including newlines)
  // 2. Quoted strings (double or single)
  // 3. Redirect operators (>>  must come before >)
  // 4. Pipe or single redirect
  // 5. Non-whitespace words
  const pattern = /(\s+)|("(?:[^"\\]|\\.)*"?)|('(?:[^'\\]|\\.)*'?)|(>>)|([|><])|(\S+)/g;

  // Track whether the next non-whitespace token should be a command.
  // True at the start of each line and after a pipe.
  let expectCommand = true;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const [_fullMatch, whitespace, dblString, sglString, doubleRedirect, pipeOrRedirect, word] = match;

    if (whitespace !== undefined) {
      tokens.push({ type: 'whitespace', value: whitespace });
      // If whitespace contains a newline, next non-ws token is a command
      if (whitespace.includes('\n')) {
        expectCommand = true;
      }
    } else if (dblString !== undefined) {
      tokens.push({ type: 'string', value: dblString });
      expectCommand = false;
    } else if (sglString !== undefined) {
      tokens.push({ type: 'string', value: sglString });
      expectCommand = false;
    } else if (doubleRedirect !== undefined) {
      tokens.push({ type: 'pipe', value: doubleRedirect });
      // After >> the next token is an argument (redirect target), not a command
      expectCommand = false;
    } else if (pipeOrRedirect !== undefined) {
      tokens.push({ type: 'pipe', value: pipeOrRedirect });
      // After a pipe |, the next non-ws token is a command
      // After > or <, next token is an argument (file target)
      if (pipeOrRedirect === '|') {
        expectCommand = true;
      } else {
        expectCommand = false;
      }
    } else if (word !== undefined) {
      if (expectCommand) {
        tokens.push({ type: 'command', value: word });
        expectCommand = false;
      } else if (word.startsWith('--') || word.startsWith('-')) {
        tokens.push({ type: 'flag', value: word });
      } else {
        tokens.push({ type: 'argument', value: word });
      }
    }
  }

  return tokens;
}
