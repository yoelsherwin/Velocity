import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

interface HistorySearchProps {
  history: string[];
  isOpen: boolean;
  onAccept: (command: string) => void;
  onCancel: () => void;
}

/**
 * Finds all indices in `history` where the entry contains `query` (case-insensitive).
 * Returns indices sorted from most recent (highest index) to oldest (lowest index).
 */
function findMatches(history: string[], query: string): number[] {
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  const matches: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].toLowerCase().includes(lowerQuery)) {
      matches.push(i);
    }
  }
  return matches;
}

/**
 * Renders a command string with the matching substring highlighted.
 */
function HighlightedMatch({ command, query }: { command: string; query: string }) {
  if (!query) return <span>{command}</span>;

  const lowerCmd = command.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerCmd.indexOf(lowerQuery);

  if (idx === -1) return <span>{command}</span>;

  const before = command.slice(0, idx);
  const matched = command.slice(idx, idx + query.length);
  const after = command.slice(idx + query.length);

  return (
    <span>
      {before}
      <mark data-testid="history-search-highlight" className="history-search-highlight">
        {matched}
      </mark>
      {after}
    </span>
  );
}

function HistorySearch({ history, isOpen, onAccept, onCancel }: HistorySearchProps) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setMatchIndex(0);
      // Auto-focus with a small delay so the DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const matches = useMemo(() => findMatches(history, query), [history, query]);

  const currentMatch = matches.length > 0 ? history[matches[matchIndex]] : null;

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setMatchIndex(0); // Reset to most recent match on query change
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentMatch !== null) {
          onAccept(currentMatch);
        }
      } else if (e.key === 'r' && e.ctrlKey) {
        e.preventDefault();
        // Cycle to next older match
        if (matches.length > 0) {
          setMatchIndex((prev) => Math.min(prev + 1, matches.length - 1));
        }
      }
    },
    [onCancel, onAccept, currentMatch, matches.length],
  );

  if (!isOpen) return null;

  return (
    <div className="history-search" data-testid="history-search">
      <span className="history-search-label">reverse-i-search:</span>
      <input
        ref={inputRef}
        className="history-search-input"
        type="text"
        placeholder="Search history..."
        value={query}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="history-search-result">
        {query && matches.length === 0 && (
          <span className="history-search-no-match" data-testid="history-search-no-match">
            No matching history
          </span>
        )}
        {currentMatch !== null && (
          <span className="history-search-match-text" data-testid="history-search-match">
            <HighlightedMatch command={currentMatch} query={query} />
          </span>
        )}
      </div>
    </div>
  );
}

export default HistorySearch;
