import { useCallback, useEffect, useRef } from 'react';

interface SearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  matchCount: number;
  currentMatchIndex: number;
  goToNext: () => void;
  goToPrev: () => void;
  isOpen: boolean;
  onClose: () => void;
}

function SearchBar({
  query,
  setQuery,
  caseSensitive,
  setCaseSensitive,
  matchCount,
  currentMatchIndex,
  goToNext,
  goToPrev,
  isOpen,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'F3' && e.shiftKey) {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'F3') {
        e.preventDefault();
        goToNext();
      }
    },
    [onClose, goToNext, goToPrev],
  );

  const handleToggleCaseSensitive = useCallback(() => {
    setCaseSensitive(!caseSensitive);
  }, [caseSensitive, setCaseSensitive]);

  if (!isOpen) return null;

  // Match counter text
  let counterText = '';
  if (query) {
    if (matchCount === 0) {
      counterText = 'No results';
    } else if (matchCount > 10_000) {
      counterText = '10,000+ matches';
    } else {
      counterText = `${currentMatchIndex + 1} of ${matchCount}`;
    }
  }

  return (
    <div className="search-bar" data-testid="search-bar">
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Find in output..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {counterText && (
        <span className="search-match-count" data-testid="search-match-count">
          {counterText}
        </span>
      )}
      <button
        className="search-nav-btn"
        onClick={goToPrev}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        &#x25B2;
      </button>
      <button
        className="search-nav-btn"
        onClick={goToNext}
        disabled={matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        &#x25BC;
      </button>
      <button
        className={`search-case-btn ${caseSensitive ? 'search-case-btn-active' : ''}`}
        onClick={handleToggleCaseSensitive}
        title="Match case"
        aria-label="Toggle case sensitivity"
      >
        Aa
      </button>
      <button
        className="search-close-btn"
        onClick={onClose}
        title="Close (Escape)"
        aria-label="Close search"
      >
        &#x00D7;
      </button>
    </div>
  );
}

export default SearchBar;
