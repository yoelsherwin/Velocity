import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Block } from '../lib/types';
import { stripAnsi } from '../lib/ansi';

export interface SearchMatch {
  blockId: string;
  startOffset: number;  // char offset in stripped (plain text) output
  length: number;       // match length
}

export interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;      // -1 if no matches
  goToNext: () => void;
  goToPrev: () => void;
  goToMatch: (index: number) => void;
  matchesByBlock: Map<string, SearchMatch[]>;  // pre-grouped for rendering
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const MAX_MATCHES = 10_000;
const DEBOUNCE_MS = 150;

/**
 * Find-in-output search hook. Searches across all blocks in the current pane.
 * Operates entirely on the frontend using stripped (ANSI-free) output text.
 */
export function useSearch(blocks: Block[]): UseSearchResult {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [debouncedCaseSensitive, setDebouncedCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache stripped output per block to avoid recomputing stripAnsi on unchanged blocks
  const strippedCacheRef = useRef<Map<string, { output: string; stripped: string }>>(new Map());

  // Debounce query and caseSensitive changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setDebouncedCaseSensitive(caseSensitive);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, caseSensitive]);

  // Get stripped text for a block (using cache)
  const getStripped = useCallback((block: Block): string => {
    const cache = strippedCacheRef.current;
    const cached = cache.get(block.id);
    if (cached && cached.output === block.output) {
      return cached.stripped;
    }
    const stripped = stripAnsi(block.output);
    cache.set(block.id, { output: block.output, stripped });
    return stripped;
  }, []);

  // Compute matches
  const matches = useMemo((): SearchMatch[] => {
    if (!isOpen || !debouncedQuery) return [];

    const result: SearchMatch[] = [];
    const searchQuery = debouncedCaseSensitive ? debouncedQuery : debouncedQuery.toLowerCase();

    for (const block of blocks) {
      const stripped = getStripped(block);
      const text = debouncedCaseSensitive ? stripped : stripped.toLowerCase();

      let pos = 0;
      while (pos < text.length && result.length < MAX_MATCHES) {
        const idx = text.indexOf(searchQuery, pos);
        if (idx === -1) break;
        result.push({
          blockId: block.id,
          startOffset: idx,
          length: debouncedQuery.length,
        });
        pos = idx + searchQuery.length; // Non-overlapping matches (matches VS Code/Chrome behavior)
      }

      if (result.length >= MAX_MATCHES) break;
    }

    // Prune stale cache entries for blocks that have been evicted
    const currentIds = new Set(blocks.map(b => b.id));
    for (const key of strippedCacheRef.current.keys()) {
      if (!currentIds.has(key)) strippedCacheRef.current.delete(key);
    }

    return result;
  }, [isOpen, debouncedQuery, debouncedCaseSensitive, blocks, getStripped]);

  // Reset currentMatchIndex when matches change
  useEffect(() => {
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [matches]);

  // Pre-group matches by block
  const matchesByBlock = useMemo((): Map<string, SearchMatch[]> => {
    const map = new Map<string, SearchMatch[]>();
    for (const match of matches) {
      const existing = map.get(match.blockId);
      if (existing) {
        existing.push(match);
      } else {
        map.set(match.blockId, [match]);
      }
    }
    return map;
  }, [matches]);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const goToMatch = useCallback((index: number) => {
    if (index >= 0 && index < matches.length) {
      setCurrentMatchIndex(index);
    }
  }, [matches.length]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsOpen(false);
    setQuery('');
    setDebouncedQuery('');
    setCurrentMatchIndex(-1);
  }, []);

  return {
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    matches,
    currentMatchIndex,
    goToNext,
    goToPrev,
    goToMatch,
    matchesByBlock,
    isOpen,
    open,
    close,
  };
}
