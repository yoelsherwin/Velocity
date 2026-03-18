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
  // Ctrl+key combinations
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
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
    return null;
  }

  // Alt+key (send as ESC + key)
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key.length === 1) {
      return '\x1b' + e.key;
    }
  }

  // Special keys
  switch (e.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\x7f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\x1b';
    case 'Delete':
      return '\x1b[3~';

    // Arrow keys
    case 'ArrowUp':
      return applicationMode ? '\x1bOA' : '\x1b[A';
    case 'ArrowDown':
      return applicationMode ? '\x1bOB' : '\x1b[B';
    case 'ArrowRight':
      return applicationMode ? '\x1bOC' : '\x1b[C';
    case 'ArrowLeft':
      return applicationMode ? '\x1bOD' : '\x1b[D';

    // Navigation keys
    case 'Home':
      return '\x1b[H';
    case 'End':
      return '\x1b[F';
    case 'PageUp':
      return '\x1b[5~';
    case 'PageDown':
      return '\x1b[6~';
    case 'Insert':
      return '\x1b[2~';

    // Function keys
    case 'F1':
      return '\x1bOP';
    case 'F2':
      return '\x1bOQ';
    case 'F3':
      return '\x1bOR';
    case 'F4':
      return '\x1bOS';
    case 'F5':
      return '\x1b[15~';
    case 'F6':
      return '\x1b[17~';
    case 'F7':
      return '\x1b[18~';
    case 'F8':
      return '\x1b[19~';
    case 'F9':
      return '\x1b[20~';
    case 'F10':
      return '\x1b[21~';
    case 'F11':
      return '\x1b[23~';
    case 'F12':
      return '\x1b[24~';

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
