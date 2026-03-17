import type { Command } from './commands';

export interface FuzzyResult {
  command: Command;
  score: number;
  matchedIndices: number[];
}

/**
 * Fuzzy match a query against the command's title.
 * Returns matched indices and a score, or null if no match.
 */
function fuzzyMatchTitle(query: string, title: string): { score: number; matchedIndices: number[] } | null {
  const lowerQuery = query.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const matchedIndices: number[] = [];
  let queryIdx = 0;

  for (let i = 0; i < lowerTitle.length && queryIdx < lowerQuery.length; i++) {
    if (lowerTitle[i] === lowerQuery[queryIdx]) {
      matchedIndices.push(i);
      queryIdx++;
    }
  }

  // All query characters must have been matched
  if (queryIdx !== lowerQuery.length) {
    return null;
  }

  // Score calculation
  let score = 0;

  // Bonus for consecutive matches
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      score += 10;
    }
  }

  // Bonus for matching at word starts
  for (const idx of matchedIndices) {
    if (idx === 0 || title[idx - 1] === ' ') {
      score += 5;
    }
  }

  // Bonus for matching at the very start
  if (matchedIndices.length > 0 && matchedIndices[0] === 0) {
    score += 3;
  }

  // Bonus for shorter titles (more specific match)
  score += Math.max(0, 20 - title.length);

  // Bonus for tighter match (smaller spread between first and last matched index)
  if (matchedIndices.length > 1) {
    const spread = matchedIndices[matchedIndices.length - 1] - matchedIndices[0];
    score += Math.max(0, 20 - spread);
  }

  return { score, matchedIndices };
}

/**
 * Check if the query matches any keyword in the command's keywords list.
 */
function matchesKeywords(query: string, keywords: string[] | undefined): boolean {
  if (!keywords) return false;
  const lowerQuery = query.toLowerCase();
  return keywords.some((kw) => kw.toLowerCase().includes(lowerQuery));
}

/**
 * Fuzzy match a query against a list of commands.
 * Returns sorted results (best match first).
 */
export function fuzzyMatch(query: string, commands: Command[]): FuzzyResult[] {
  if (!query) {
    // Empty query: return all commands sorted by category
    return commands.map((command) => ({
      command,
      score: 0,
      matchedIndices: [],
    }));
  }

  const results: FuzzyResult[] = [];

  for (const command of commands) {
    const titleMatch = fuzzyMatchTitle(query, command.title);

    if (titleMatch) {
      results.push({
        command,
        score: titleMatch.score,
        matchedIndices: titleMatch.matchedIndices,
      });
    } else if (matchesKeywords(query, command.keywords)) {
      // Keyword match - lower score than title match
      results.push({
        command,
        score: -1,
        matchedIndices: [],
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}
