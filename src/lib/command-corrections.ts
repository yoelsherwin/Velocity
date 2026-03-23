/**
 * Heuristic-based command typo correction.
 * Uses Levenshtein distance to suggest corrections for mistyped commands.
 */

/**
 * Compute the Damerau-Levenshtein distance between two strings.
 * Counts insertions, deletions, substitutions, and transpositions of adjacent
 * characters — each as a single operation.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Full matrix DP needed for transposition check
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      // Transposition of adjacent characters
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[m][n];
}

export interface TypoCorrection {
  /** The full corrected command (first word replaced) */
  correctedCommand: string;
  /** The original mistyped first word */
  originalWord: string;
  /** The suggested replacement word */
  suggestedWord: string;
  /** Edit distance */
  distance: number;
}

/**
 * Check if a command's first word is a close match to any known command.
 * Returns null if no close match found (distance > 2 or exact match).
 */
export function suggestCorrection(
  firstWord: string,
  knownCommands: Set<string>,
): TypoCorrection | null {
  if (!firstWord || knownCommands.size === 0) return null;

  // If the first word is already a known command, no correction needed
  if (knownCommands.has(firstWord)) return null;

  const lower = firstWord.toLowerCase();
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const cmd of knownCommands) {
    const dist = levenshteinDistance(lower, cmd.toLowerCase());
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = cmd;
    }
  }

  // Only suggest if distance <= 2
  if (bestMatch && bestDistance > 0 && bestDistance <= 2) {
    return {
      correctedCommand: bestMatch,
      originalWord: firstWord,
      suggestedWord: bestMatch,
      distance: bestDistance,
    };
  }

  return null;
}

/**
 * Common shell typo patterns that don't need Levenshtein.
 * Returns the corrected full command, or null if no pattern matches.
 */
export function detectCommonPatterns(command: string): string | null {
  // cd.. → cd ..
  if (/^cd\.\./.test(command)) {
    return command.replace(/^cd\.\./, 'cd ..');
  }

  // cd/ → cd /
  if (/^cd\//.test(command)) {
    return command.replace(/^cd\//, 'cd /');
  }

  // ls-la → ls -la
  if (/^ls-la\b/.test(command)) {
    return command.replace(/^ls-la/, 'ls -la');
  }

  // ls-al → ls -al
  if (/^ls-al\b/.test(command)) {
    return command.replace(/^ls-al/, 'ls -al');
  }

  return null;
}

/** Patterns that indicate a "command not found" error */
const NOT_FOUND_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /not recognized/i,
  /command not found/i,
  /not found/i,
  /is not a recognized/i,
  /the term .+ is not recognized/i,
];

/**
 * Check if the output indicates a "command not found" error.
 */
export function isCommandNotFoundError(output: string): boolean {
  return NOT_FOUND_PATTERNS.some(p => p.test(output));
}

/**
 * Given a failed command and its output, try to find a typo correction.
 * Returns the full corrected command string, or null.
 */
export function getTypoCorrection(
  command: string,
  output: string,
  knownCommands: Set<string>,
): string | null {
  // First check common patterns (no need to check error output)
  const patternFix = detectCommonPatterns(command);
  if (patternFix) return patternFix;

  // Only proceed if the error looks like "command not found"
  if (!isCommandNotFoundError(output)) return null;

  // Extract the first word
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) return null;
  const firstWord = parts[0];
  const rest = parts.slice(1).join(' ');

  const correction = suggestCorrection(firstWord, knownCommands);
  if (!correction) return null;

  // Reconstruct the command with the corrected first word
  return rest ? `${correction.correctedCommand} ${rest}` : correction.correctedCommand;
}
