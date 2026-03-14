import { useMemo } from 'react';

interface UseGhostText {
  suggestion: string | null;
}

export function useGhostText(input: string, history: string[]): UseGhostText {
  const suggestion = useMemo(() => {
    // No suggestion for empty input
    if (!input) return null;

    // No suggestion for multi-line input
    if (input.includes('\n')) return null;

    // Search history most recent first (last in array = most recent)
    for (let i = history.length - 1; i >= 0; i--) {
      const cmd = history[i];
      if (cmd.startsWith(input) && cmd !== input) {
        // Return remaining portion after the input prefix
        return cmd.slice(input.length);
      }
    }

    return null;
  }, [input, history]);

  return { suggestion };
}
