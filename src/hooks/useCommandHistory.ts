import { useState, useCallback, useRef } from 'react';

export interface HistoryEntry {
  command: string;
  timestamp: number;
  exitCode?: number;
  cwd?: string;
  gitBranch?: string;
  shellType: string;
}

interface UseCommandHistory {
  history: HistoryEntry[];
  addCommand: (entry: HistoryEntry) => void;
  navigateUp: () => string | null;
  navigateDown: () => string | null;
  reset: () => void;
  draft: string;
  setDraft: (value: string) => void;
}

const DEFAULT_MAX_HISTORY = 100;

/**
 * Normalize initial history: accepts either string[] (backward compat) or HistoryEntry[].
 */
function normalizeHistory(initial: (string | HistoryEntry)[]): HistoryEntry[] {
  return initial.map((item) => {
    if (typeof item === 'string') {
      return {
        command: item,
        timestamp: Date.now(),
        shellType: 'powershell',
      };
    }
    return item;
  });
}

export function useCommandHistory(
  maxHistory: number = DEFAULT_MAX_HISTORY,
  initialHistory: (string | HistoryEntry)[] = [],
): UseCommandHistory {
  const [history, setHistory] = useState<HistoryEntry[]>(() => normalizeHistory(initialHistory));
  const [draft, setDraft] = useState('');
  const indexRef = useRef<number | null>(null);
  // Keep a ref mirror of history for synchronous access in navigateUp/Down
  const historyRef = useRef<HistoryEntry[]>(normalizeHistory(initialHistory));
  const draftRef = useRef('');

  // Sync draft ref
  const setDraftWrapped = useCallback((value: string) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  const addCommand = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => {
        // If same as last command, update the existing entry with new metadata
        if (prev.length > 0 && prev[prev.length - 1].command === entry.command) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], ...entry };
          historyRef.current = updated;
          return updated;
        }
        const next = [...prev, entry];
        // Enforce maxHistory
        const trimmed = next.length > maxHistory ? next.slice(-maxHistory) : next;
        historyRef.current = trimmed;
        return trimmed;
      });
      indexRef.current = null;
      draftRef.current = '';
      setDraft('');
    },
    [maxHistory],
  );

  const navigateUp = useCallback((): string | null => {
    const hist = historyRef.current;
    if (hist.length === 0) return null;

    const currentIndex = indexRef.current;

    if (currentIndex === null) {
      // First Up press: save current draft, go to most recent
      const newIndex = hist.length - 1;
      indexRef.current = newIndex;
      return hist[newIndex].command;
    }

    if (currentIndex <= 0) {
      // Already at the beginning
      return null;
    }

    const newIndex = currentIndex - 1;
    indexRef.current = newIndex;
    return hist[newIndex].command;
  }, []);

  const navigateDown = useCallback((): string | null => {
    const hist = historyRef.current;
    const currentIndex = indexRef.current;

    if (currentIndex === null) {
      // Not browsing history
      return null;
    }

    if (currentIndex >= hist.length - 1) {
      // Past the end: return draft
      indexRef.current = null;
      return draftRef.current;
    }

    const newIndex = currentIndex + 1;
    indexRef.current = newIndex;
    return hist[newIndex].command;
  }, []);

  const reset = useCallback(() => {
    indexRef.current = null;
  }, []);

  return {
    history,
    addCommand,
    navigateUp,
    navigateDown,
    reset,
    draft,
    setDraft: setDraftWrapped,
  };
}
