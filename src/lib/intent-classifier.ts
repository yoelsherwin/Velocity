export type InputIntent = 'cli' | 'natural_language';

/**
 * Classifies user input as either a CLI command or natural language.
 *
 * MVP: Only explicit # prefix triggers agent mode.
 * Auto-detection (heuristic-based) deferred to future task.
 */
export function classifyIntent(input: string): InputIntent {
  const trimmed = input.trim();

  // Explicit # trigger — always natural language
  if (trimmed.startsWith('#')) return 'natural_language';

  // Everything else is treated as a CLI command for MVP
  return 'cli';
}

/**
 * Strips the leading `#` prefix (and optional space) from input.
 */
export function stripHashPrefix(input: string): string {
  return input.replace(/^#\s*/, '');
}
