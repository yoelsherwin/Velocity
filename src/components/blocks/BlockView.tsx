import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Block } from '../../lib/types';
import { stripAnsi } from '../../lib/ansi';
import { maskSecrets } from '../../lib/secretRedaction';
import { useSecretRedaction } from '../../hooks/useSecretRedaction';
import AnsiOutput, { HighlightRange } from '../AnsiOutput';
import { estimateBlockHeight } from '../../hooks/useBlockVisibility';
import ErrorSuggestion from './ErrorSuggestion';
import { getTypoCorrection } from '../../lib/command-corrections';

interface BlockViewProps {
  block: Block;
  isActive: boolean;        // true if this is the currently running block
  isFocused?: boolean;      // true if this block is focused via Ctrl+Up/Down navigation
  isCollapsed?: boolean;    // true if this block's output is collapsed
  onToggleCollapse?: () => void;  // callback to toggle collapse state
  onRerun: (command: string) => void;
  onSelect?: () => void;                // callback when block is clicked to select it
  onUseFix?: (command: string) => void;  // callback when user accepts a fix suggestion
  isVisible?: boolean;      // true if block is in or near the viewport
  observeRef?: (el: HTMLDivElement | null) => void;  // callback ref for IntersectionObserver
  highlights?: HighlightRange[];  // search match highlights for this block
  shellType?: string;       // shell type for error suggestion context
  cwd?: string;             // current working directory for error suggestion context
  hasApiKey?: boolean;      // whether an API key is configured
  isMostRecentFailed?: boolean;  // whether this is the most recently failed block
  knownCommands?: Set<string>;  // known commands for typo correction
  isBookmarked?: boolean;       // true if this block is bookmarked
  onToggleBookmark?: () => void; // callback to toggle bookmark state
}

function BlockView({ block, isActive, isFocused = false, isCollapsed = false, onToggleCollapse, onRerun, onSelect, onUseFix, isVisible = true, observeRef, highlights, shellType, cwd, hasApiKey = false, isMostRecentFailed = false, knownCommands, isBookmarked = false, onToggleBookmark }: BlockViewProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const filterInputRef = useRef<HTMLInputElement>(null);

  const formattedTime = useMemo(() => {
    return new Date(block.timestamp).toLocaleTimeString();
  }, [block.timestamp]);

  const { segments: redactedSegments, revealedIds, revealSecret } = useSecretRedaction(block.output);

  // Debounce filter input for running blocks to avoid recalculating on every output chunk.
  // For completed blocks the output is stable so no debounce is needed.
  const [debouncedOutput, setDebouncedOutput] = useState(block.output);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // If the filter is not active or block is not running, use the output directly
    if (!filterOpen || !filterText || block.status !== 'running') {
      setDebouncedOutput(block.output);
      return;
    }
    // Debounce output updates while filtering a running block
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedOutput(block.output);
    }, 200);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [block.output, block.status, filterOpen, filterText]);

  // Use debounced output for filter calculations, raw output for display when not filtering
  const filterSourceOutput = (filterOpen && filterText) ? debouncedOutput : block.output;

  // Split output into lines for filtering. Each entry is the original (ANSI) line.
  const outputLines = useMemo(() => filterSourceOutput.split('\n'), [filterSourceOutput]);

  // Compute filtered output: keep only lines whose stripped text matches filter
  const { filteredOutput, matchCount, totalCount } = useMemo(() => {
    const total = outputLines.length;
    if (!filterOpen || !filterText) {
      return { filteredOutput: block.output, matchCount: total, totalCount: total };
    }
    const lowerFilter = filterText.toLowerCase();
    const matching = outputLines.filter(line => stripAnsi(line).toLowerCase().includes(lowerFilter));
    return {
      filteredOutput: matching.join('\n'),
      matchCount: matching.length,
      totalCount: total,
    };
  }, [block.output, outputLines, filterOpen, filterText]);

  const handleOpenFilter = useCallback(() => {
    setFilterOpen(true);
    setFilterText('');
    // Focus the input after it renders
    setTimeout(() => filterInputRef.current?.focus(), 0);
  }, []);

  const handleCloseFilter = useCallback(() => {
    setFilterOpen(false);
    setFilterText('');
  }, []);

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCloseFilter();
    }
  }, [handleCloseFilter]);

  const handleCopyCommand = useCallback(() => {
    navigator.clipboard.writeText(block.command).catch(() => {
      // Clipboard write failed — silently ignore (user can manually select + copy)
    });
  }, [block.command]);

  const handleCopyOutput = useCallback(() => {
    // Copy masked text by default to prevent accidental secret exposure
    const stripped = stripAnsi(block.output);
    navigator.clipboard.writeText(maskSecrets(stripped)).catch(() => {
      // Clipboard write failed — silently ignore
    });
  }, [block.output]);

  const handleCopyRawOutput = useCallback(() => {
    // Copy raw (unmasked) text — explicit user action
    navigator.clipboard.writeText(stripAnsi(block.output)).catch(() => {
      // Clipboard write failed — silently ignore
    });
  }, [block.output]);

  const handleRerun = useCallback(() => {
    onRerun(block.command);
  }, [onRerun, block.command]);

  const handleClick = useCallback(() => {
    if (onSelect) {
      onSelect();
    }
  }, [onSelect]);

  const handleActionsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Typo correction: compute once per block when it's a failed command
  const typoCorrection = useMemo(() => {
    if (!isMostRecentFailed || block.exitCode == null || block.exitCode === 0 || block.status !== 'completed') {
      return null;
    }
    if (!knownCommands || knownCommands.size === 0) {
      return null;
    }
    return getTypoCorrection(block.command, block.output, knownCommands);
  }, [block.command, block.output, block.exitCode, block.status, isMostRecentFailed, knownCommands]);

  const handleUseTypoCorrection = useCallback(() => {
    if (typoCorrection && onUseFix) {
      onUseFix(typoCorrection);
    }
  }, [typoCorrection, onUseFix]);

  const isWelcome = block.command === '';

  return (
    <div
      ref={observeRef}
      className={`block-container ${isActive && block.status === 'running' ? 'block-active' : ''} ${isFocused ? 'block-focused' : ''} ${isCollapsed ? 'block-collapsed' : ''} ${isBookmarked ? 'block-bookmarked' : ''}`}
      data-testid="block-container"
      onClick={handleClick}
    >
      {!isWelcome && (
        <div className="block-header">
          <div className="block-command-row">
            <button
              className="collapse-toggle"
              data-testid="collapse-toggle"
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? 'Expand block' : 'Collapse block'}
            >
              {isCollapsed ? '\u25B6' : '\u25BC'}
            </button>
            {isActive && block.status === 'running' && (
              <span className="block-running-indicator" aria-label="running">
                ●
              </span>
            )}
            <span className="block-command">
              {block.command}
            </span>
            {isBookmarked && (
              <span className="bookmark-indicator" data-testid="bookmark-indicator" aria-label="bookmarked">
                ★
              </span>
            )}
          </div>
          <div className="block-header-right">
            {isCollapsed && (
              <span className="block-collapsed-indicator">...</span>
            )}
            {block.exitCode !== undefined && block.exitCode !== null && (
              <span className={`block-exit-code ${block.exitCode === 0 ? 'exit-success' : 'exit-failure'}`}>
                {block.exitCode === 0 ? '\u2713' : `\u2717 ${block.exitCode}`}
              </span>
            )}
            <span className="block-timestamp">{formattedTime}</span>
          </div>
        </div>
      )}
      {!isCollapsed && filterOpen && (
        <div className="block-filter-bar" data-testid="block-filter-bar">
          <input
            ref={filterInputRef}
            className="block-filter-input"
            data-testid="block-filter-input"
            type="text"
            placeholder="Filter lines..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            onKeyDown={handleFilterKeyDown}
          />
          <span className="block-filter-count" data-testid="block-filter-count">
            {matchCount} of {totalCount} lines
          </span>
          <button
            className="block-filter-close"
            data-testid="block-filter-close"
            onClick={handleCloseFilter}
            aria-label="Close filter"
          >
            ✕
          </button>
        </div>
      )}
      {!isCollapsed && block.output && (
        isVisible ? (
          <pre className="block-output" data-testid="block-output">
            <AnsiOutput
              text={filteredOutput}
              highlights={highlights}
              redactedSegments={redactedSegments}
              revealedSecretIds={revealedIds}
              onRevealSecret={revealSecret}
            />
          </pre>
        ) : (
          <pre
            className="block-output block-output-placeholder"
            data-testid="block-output-placeholder"
            style={{ height: estimateBlockHeight(block.output) }}
          />
        )
      )}
      {!isCollapsed && (
        <div className="block-actions" onClick={handleActionsClick}>
          {!isWelcome && (
            <>
              <button className="block-action-btn" onClick={handleCopyCommand}>
                Copy Command
              </button>
              <button className="block-action-btn" onClick={handleRerun}>
                Rerun
              </button>
              <button
                className={`block-action-btn ${isBookmarked ? 'block-action-btn-active' : ''}`}
                data-testid="bookmark-toggle"
                onClick={onToggleBookmark}
                aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              >
                {isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}
              </button>
            </>
          )}
          <button className="block-action-btn" onClick={handleCopyOutput}>
            Copy Output
          </button>
          <button className="block-action-btn" onClick={handleCopyRawOutput}>
            Copy Raw
          </button>
          <button className="block-action-btn" onClick={handleOpenFilter}>
            Filter
          </button>
        </div>
      )}
      {!isCollapsed && isMostRecentFailed && block.exitCode != null && block.exitCode !== 0 && block.status === 'completed' && onUseFix && (
        typoCorrection ? (
          <div className="error-suggestion" data-testid="typo-correction">
            <span className="error-suggestion-label">Did you mean:</span>
            <code className="error-suggestion-command" data-testid="typo-correction-command">
              {typoCorrection}
            </code>
            <button
              className="error-suggestion-btn error-suggestion-use"
              data-testid="typo-correction-use"
              onClick={handleUseTypoCorrection}
            >
              Use
            </button>
          </div>
        ) : (
          <ErrorSuggestion
            command={block.command}
            exitCode={block.exitCode}
            output={block.output}
            shellType={shellType || block.shellType}
            cwd={cwd || 'C:\\'}
            hasApiKey={hasApiKey}
            onUseFix={onUseFix}
          />
        )
      )}
    </div>
  );
}

export default React.memo(BlockView);
