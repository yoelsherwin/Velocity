import React, { useCallback, useMemo } from 'react';
import { Block } from '../../lib/types';
import { stripAnsi } from '../../lib/ansi';
import AnsiOutput, { HighlightRange } from '../AnsiOutput';
import { estimateBlockHeight } from '../../hooks/useBlockVisibility';
import ErrorSuggestion from './ErrorSuggestion';

interface BlockViewProps {
  block: Block;
  isActive: boolean;        // true if this is the currently running block
  isFocused?: boolean;      // true if this block is focused via Ctrl+Up/Down navigation
  isCollapsed?: boolean;    // true if this block's output is collapsed
  onToggleCollapse?: () => void;  // callback to toggle collapse state
  onRerun: (command: string) => void;
  onUseFix?: (command: string) => void;  // callback when user accepts a fix suggestion
  isVisible?: boolean;      // true if block is in or near the viewport
  observeRef?: (el: HTMLDivElement | null) => void;  // callback ref for IntersectionObserver
  highlights?: HighlightRange[];  // search match highlights for this block
  shellType?: string;       // shell type for error suggestion context
  cwd?: string;             // current working directory for error suggestion context
  hasApiKey?: boolean;      // whether an API key is configured
  isMostRecentFailed?: boolean;  // whether this is the most recently failed block
}

function BlockView({ block, isActive, isFocused = false, isCollapsed = false, onToggleCollapse, onRerun, onUseFix, isVisible = true, observeRef, highlights, shellType, cwd, hasApiKey = false, isMostRecentFailed = false }: BlockViewProps) {
  const formattedTime = useMemo(() => {
    return new Date(block.timestamp).toLocaleTimeString();
  }, [block.timestamp]);

  const handleCopyCommand = useCallback(() => {
    navigator.clipboard.writeText(block.command).catch(() => {
      // Clipboard write failed — silently ignore (user can manually select + copy)
    });
  }, [block.command]);

  const handleCopyOutput = useCallback(() => {
    navigator.clipboard.writeText(stripAnsi(block.output)).catch(() => {
      // Clipboard write failed — silently ignore
    });
  }, [block.output]);

  const handleRerun = useCallback(() => {
    onRerun(block.command);
  }, [onRerun, block.command]);

  const isWelcome = block.command === '';

  return (
    <div
      ref={observeRef}
      className={`block-container ${isActive && block.status === 'running' ? 'block-active' : ''} ${isFocused ? 'block-focused' : ''} ${isCollapsed ? 'block-collapsed' : ''}`}
      data-testid="block-container"
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
      {!isCollapsed && block.output && (
        isVisible ? (
          <pre className="block-output" data-testid="block-output">
            <AnsiOutput text={block.output} highlights={highlights} />
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
        <div className="block-actions">
          {!isWelcome && (
            <>
              <button className="block-action-btn" onClick={handleCopyCommand}>
                Copy Command
              </button>
              <button className="block-action-btn" onClick={handleRerun}>
                Rerun
              </button>
            </>
          )}
          <button className="block-action-btn" onClick={handleCopyOutput}>
            Copy Output
          </button>
        </div>
      )}
      {!isCollapsed && isMostRecentFailed && block.exitCode != null && block.exitCode !== 0 && block.status === 'completed' && onUseFix && (
        <ErrorSuggestion
          command={block.command}
          exitCode={block.exitCode}
          output={block.output}
          shellType={shellType || block.shellType}
          cwd={cwd || 'C:\\'}
          hasApiKey={hasApiKey}
          onUseFix={onUseFix}
        />
      )}
    </div>
  );
}

export default React.memo(BlockView);
