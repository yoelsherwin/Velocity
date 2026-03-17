import { useRef, useMemo } from 'react';
import { parseAnsi, AnsiSpan } from '../lib/ansi';

interface IncrementalAnsiState {
  parsedSpans: AnsiSpan[];
  parsedLength: number;
  /** First 64 chars of the parsed output, used for prefix-match detection */
  prefixSample: string;
  /** Last 64 chars of the parsed output, used to detect content changes at same length */
  suffixSample: string;
}

/**
 * Incrementally parse ANSI-escaped text into styled spans.
 *
 * Instead of re-parsing the entire output on every PTY chunk, this hook
 * caches already-parsed spans and only parses the NEW portion of the text.
 *
 * When the output is truncated (front-truncation from the output cap), the
 * prefix won't match the cache, triggering a full reparse.
 *
 * Caveat: ANSI state (current color) may not carry across chunk boundaries.
 * For MVP this is acceptable — most commands emit reset sequences frequently.
 */
export function useIncrementalAnsi(output: string): AnsiSpan[] {
  const cacheRef = useRef<IncrementalAnsiState>({
    parsedSpans: [],
    parsedLength: 0,
    prefixSample: '',
    suffixSample: '',
  });

  return useMemo(() => {
    const cache = cacheRef.current;

    // Empty input
    if (output.length === 0) {
      cache.parsedSpans = [];
      cache.parsedLength = 0;
      cache.prefixSample = '';
      cache.suffixSample = '';
      return cache.parsedSpans;
    }

    // No change — return cached spans (same reference for React.memo)
    if (
      output.length === cache.parsedLength &&
      output.slice(0, 64) === cache.prefixSample &&
      output.slice(-64) === cache.suffixSample
    ) {
      return cache.parsedSpans;
    }

    // If output is shorter than what we've parsed, truncation happened — full reparse.
    // Also catches same-length-but-different-content (e.g., steady-state truncation
    // where front-slicing + appending produces the same length but different content).
    if (output.length < cache.parsedLength) {
      const spans = parseAnsi(output);
      cache.parsedSpans = spans;
      cache.parsedLength = output.length;
      cache.prefixSample = output.slice(0, 64);
      cache.suffixSample = output.slice(-64);
      return spans;
    }

    // Incremental append: output is longer AND starts with the same prefix
    if (
      output.length > cache.parsedLength &&
      cache.parsedLength > 0 &&
      output.slice(0, 64) === cache.prefixSample
    ) {
      const newPart = output.slice(cache.parsedLength);
      const newSpans = parseAnsi(newPart);
      const allSpans = [...cache.parsedSpans, ...newSpans];
      cache.parsedSpans = allSpans;
      cache.parsedLength = output.length;
      // prefixSample stays the same (prefix didn't change)
      cache.suffixSample = output.slice(-64);
      return allSpans;
    }

    // Full reparse: output was truncated, replaced, or prefix mismatch
    const spans = parseAnsi(output);
    cache.parsedSpans = spans;
    cache.parsedLength = output.length;
    cache.prefixSample = output.slice(0, 64);
    cache.suffixSample = output.slice(-64);
    return spans;
  }, [output]);
}
