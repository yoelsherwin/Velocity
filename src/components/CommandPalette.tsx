import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { COMMANDS } from '../lib/commands';
import { fuzzyMatch, FuzzyResult } from '../lib/fuzzy';

interface CommandPaletteProps {
  onExecute: (commandId: string) => void;
  onClose: () => void;
}

function HighlightedTitle({ title, matchedIndices }: { title: string; matchedIndices: number[] }) {
  if (matchedIndices.length === 0) {
    return <span className="palette-item-title">{title}</span>;
  }

  const indexSet = new Set(matchedIndices);
  const chars = title.split('').map((char, i) => {
    if (indexSet.has(i)) {
      return (
        <span key={i} className="palette-match-char">
          {char}
        </span>
      );
    }
    return <span key={i}>{char}</span>;
  });

  return <span className="palette-item-title">{chars}</span>;
}

function CommandPalette({ onExecute, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results: FuzzyResult[] = useMemo(() => fuzzyMatch(query, COMMANDS), [query]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector('.palette-item-selected');
      if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleExecute = useCallback(
    (commandId: string) => {
      onExecute(commandId);
      onClose();
    },
    [onExecute, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev + 1) % results.length : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results.length > 0 && selectedIndex < results.length) {
          handleExecute(results[selectedIndex].command.id);
        }
      }
    },
    [results, selectedIndex, onClose, handleExecute],
  );

  return (
    <div
      className="palette-overlay"
      data-testid="command-palette"
    >
      <div
        className="palette-backdrop"
        data-testid="palette-backdrop"
        onClick={onClose}
      />
      <div className="palette-dialog">
        <div className="palette-input-row">
          <span className="palette-prefix">&gt;</span>
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="palette-results" ref={listRef}>
          {results.length === 0 && query ? (
            <div className="palette-no-results">No matching commands</div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.command.id}
                className={`palette-item ${index === selectedIndex ? 'palette-item-selected' : ''}`}
                data-testid="palette-item"
                onClick={() => handleExecute(result.command.id)}
              >
                <HighlightedTitle
                  title={result.command.title}
                  matchedIndices={result.matchedIndices}
                />
                <div className="palette-item-right">
                  {result.command.shortcut && (
                    <span className="palette-shortcut">{result.command.shortcut}</span>
                  )}
                  <span className="palette-category">{result.command.category}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
