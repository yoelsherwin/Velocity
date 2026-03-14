import { useState, useCallback, useRef } from 'react';

interface UseCommandHistory {
  history: string[];
  historyIndex: number | null;
  addCommand: (command: string) => void;
  navigateUp: () => string | null;
  navigateDown: () => string | null;
  reset: () => void;
  draft: string;
  setDraft: (value: string) => void;
}

const DEFAULT_MAX_HISTORY = 100;

export function useCommandHistory(maxHistory: number = DEFAULT_MAX_HISTORY): UseCommandHistory {
  const [history, setHistory] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const indexRef = useRef<number | null>(null);
  // Keep a ref mirror of history for synchronous access in navigateUp/Down
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');

  // Sync draft ref
  const setDraftWrapped = useCallback((value: string) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  const addCommand = useCallback(
    (command: string) => {
      setHistory((prev) => {
        // Skip duplicate if same as last command
        if (prev.length > 0 && prev[prev.length - 1] === command) {
          return prev;
        }
        const next = [...prev, command];
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
      return hist[newIndex];
    }

    if (currentIndex <= 0) {
      // Already at the beginning
      return null;
    }

    const newIndex = currentIndex - 1;
    indexRef.current = newIndex;
    return hist[newIndex];
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
    return hist[newIndex];
  }, []);

  const reset = useCallback(() => {
    indexRef.current = null;
  }, []);

  return {
    history,
    historyIndex: indexRef.current,
    addCommand,
    navigateUp,
    navigateDown,
    reset,
    draft,
    setDraft: setDraftWrapped,
  };
}
