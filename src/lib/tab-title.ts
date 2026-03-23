/**
 * Utilities for computing dynamic tab titles based on CWD and running commands.
 */

const MAX_TITLE_LENGTH = 20;

/**
 * Extract the basename from a file path (works with both / and \ separators).
 */
export function getBasename(path: string): string {
  // Normalize separators, strip trailing slashes
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

/**
 * Extract the first word (command name) from a command string.
 * e.g., "npm install react" -> "npm"
 */
export function getCommandName(command: string): string {
  const trimmed = command.trim();
  const firstSpace = trimmed.indexOf(' ');
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}

/**
 * Truncate a title to the max length, appending ellipsis if needed.
 */
export function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return title.slice(0, MAX_TITLE_LENGTH - 1) + '\u2026';
}

/**
 * Compute the tab title based on current terminal state.
 *
 * @param cwd - Current working directory (may be null/empty)
 * @param runningCommand - The command currently running (null/empty if idle)
 * @param fallbackTitle - Fallback title (e.g. "Terminal 1")
 * @returns The formatted, truncated tab title
 */
export function computeTabTitle(
  cwd: string | null,
  runningCommand: string | null,
  fallbackTitle: string,
): string {
  // When a command is running, show the command name
  if (runningCommand && runningCommand.trim()) {
    const cmdName = getCommandName(runningCommand);
    if (cmdName) {
      return truncateTitle(cmdName);
    }
  }

  // When idle, show the CWD basename
  if (cwd && cwd.trim()) {
    const basename = getBasename(cwd);
    if (basename) {
      return truncateTitle(basename);
    }
  }

  // Fallback
  return fallbackTitle;
}
