export type InputIntent = 'cli' | 'natural_language';

/**
 * Classifies user input as either a CLI command or natural language.
 *
 * For MVP, only explicit `#` prefix triggers agent mode (natural_language).
 * Heuristics exist for future auto-detect but are not used in the submit flow yet.
 */
export function classifyIntent(input: string): InputIntent {
  const trimmed = input.trim();

  // Explicit # trigger — always natural language
  if (trimmed.startsWith('#')) return 'natural_language';

  // Empty or whitespace — treat as CLI (no-op)
  if (!trimmed) return 'cli';

  // Heuristics for CLI detection:
  const hasFlags = /\s-{1,2}\w/.test(trimmed);
  const hasPipes = /\|/.test(trimmed);
  const hasRedirects = /[<>]/.test(trimmed);
  const startsWithDot = /^\.{1,2}[/\\]/.test(trimmed);

  // If it has CLI artifacts, treat as CLI
  if (hasFlags || hasPipes || hasRedirects || startsWithDot) return 'cli';

  // Simple heuristic: if it looks like a natural sentence (spaces, no special chars)
  // and has 4+ words, suggest agent mode
  const hasPathSeparators = /[/\\]/.test(trimmed);
  const words = trimmed.split(/\s+/);
  if (words.length >= 4 && !hasPathSeparators) return 'natural_language';

  // Default: treat as CLI
  return 'cli';
}

/**
 * Strips the leading `#` prefix (and optional space) from input.
 */
export function stripHashPrefix(input: string): string {
  return input.replace(/^#\s*/, '');
}
