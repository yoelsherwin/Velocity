/**
 * Compute xterm modifier parameter from modifier key state.
 * Returns 1 (no modifier) through 8 (all three modifiers).
 * Value > 1 means a modifier-encoded sequence is needed.
 */
function modifierParam(e: KeyboardEvent | React.KeyboardEvent): number {
  return 1
    + (e.shiftKey ? 1 : 0)
    + (e.altKey ? 2 : 0)
    + (e.ctrlKey ? 4 : 0);
}

/**
 * Encodes browser KeyboardEvent into ANSI escape sequences
 * for sending to a PTY in alternate screen mode.
 *
 * Returns the byte string to send, or null if the key should be ignored.
 */
export function encodeKey(
  e: KeyboardEvent | React.KeyboardEvent,
  applicationMode = false,
): string | null {
  const mod = modifierParam(e);
  const hasModifier = mod > 1;

  // Ctrl+key combinations (letter keys only, no shift/alt)
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key.length === 1 && key >= 'a' && key <= 'z') {
      // Ctrl+A = 0x01, Ctrl+B = 0x02, ..., Ctrl+Z = 0x1A
      return String.fromCharCode(key.charCodeAt(0) - 96);
    }
    // Ctrl+[ = Escape
    if (key === '[') return '\x1b';
    // Ctrl+] = 0x1D
    if (key === ']') return '\x1d';
    // Ctrl+\\ = 0x1C
    if (key === '\\') return '\x1c';
  }

  // Alt+key for printable characters (send as ESC + key)
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.key.length === 1) {
      return '\x1b' + e.key;
    }
  }

  // Arrow keys — support modifier encoding (e.g., Shift+ArrowUp = \x1b[1;2A)
  const arrowMap: Record<string, string> = {
    ArrowUp: 'A',
    ArrowDown: 'B',
    ArrowRight: 'C',
    ArrowLeft: 'D',
  };
  if (e.key in arrowMap) {
    const ch = arrowMap[e.key];
    if (hasModifier) return `\x1b[1;${mod}${ch}`;
    return applicationMode ? `\x1bO${ch}` : `\x1b[${ch}`;
  }

  // Home/End — \x1b[1;{mod}H / \x1b[1;{mod}F with modifiers
  if (e.key === 'Home') {
    return hasModifier ? `\x1b[1;${mod}H` : '\x1b[H';
  }
  if (e.key === 'End') {
    return hasModifier ? `\x1b[1;${mod}F` : '\x1b[F';
  }

  // Keys using CSI {code} ~ format — support modifier encoding
  const tildeMap: Record<string, number> = {
    Delete: 3,
    Insert: 2,
    PageUp: 5,
    PageDown: 6,
  };
  if (e.key in tildeMap) {
    const code = tildeMap[e.key];
    return hasModifier ? `\x1b[${code};${mod}~` : `\x1b[${code}~`;
  }

  // Function keys F1-F4 use SS3 format without modifiers, CSI 1;mod P/Q/R/S with modifiers
  const f1to4Map: Record<string, string> = {
    F1: 'P',
    F2: 'Q',
    F3: 'R',
    F4: 'S',
  };
  if (e.key in f1to4Map) {
    const ch = f1to4Map[e.key];
    return hasModifier ? `\x1b[1;${mod}${ch}` : `\x1bO${ch}`;
  }

  // Function keys F5-F12 use CSI {code} ~ format
  const fkeyTildeMap: Record<string, number> = {
    F5: 15,
    F6: 17,
    F7: 18,
    F8: 19,
    F9: 20,
    F10: 21,
    F11: 23,
    F12: 24,
  };
  if (e.key in fkeyTildeMap) {
    const code = fkeyTildeMap[e.key];
    return hasModifier ? `\x1b[${code};${mod}~` : `\x1b[${code}~`;
  }

  // Non-modifier special keys
  switch (e.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\x7f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\x1b';
    default:
      break;
  }

  // Regular printable characters
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return e.key;
  }

  // Ignore modifier-only keys, meta combos, etc.
  return null;
}
