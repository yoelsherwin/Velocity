import React, { useCallback, useMemo } from 'react';
import { Block } from '../../lib/types';
import { stripAnsi } from '../../lib/ansi';
import AnsiOutput from '../AnsiOutput';
import { estimateBlockHeight } from '../../hooks/useBlockVisibility';

interface BlockViewProps {
  block: Block;
  isActive: boolean;        // true if this is the currently running block
  onRerun: (command: string) => void;
  isVisible?: boolean;      // true if block is in or near the viewport
  observeRef?: (el: HTMLDivElement | null) => void;  // callback ref for IntersectionObserver
}

function BlockView({ block, isActive, onRerun, isVisible = true, observeRef }: BlockViewProps) {
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
      className={`block-container ${isActive && block.status === 'running' ? 'block-active' : ''}`}
      data-testid="block-container"
    >
      {!isWelcome && (
        <div className="block-header">
          <div className="block-command-row">
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
            {block.exitCode !== undefined && block.exitCode !== null && (
              <span className={`block-exit-code ${block.exitCode === 0 ? 'exit-success' : 'exit-failure'}`}>
                {block.exitCode === 0 ? '\u2713' : `\u2717 ${block.exitCode}`}
              </span>
            )}
            <span className="block-timestamp">{formattedTime}</span>
          </div>
        </div>
      )}
      {block.output && (
        isVisible ? (
          <pre className="block-output" data-testid="block-output">
            <AnsiOutput text={block.output} />
          </pre>
        ) : (
          <pre
            className="block-output block-output-placeholder"
            data-testid="block-output-placeholder"
            style={{ height: estimateBlockHeight(block.output) }}
          />
        )
      )}
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
    </div>
  );
}

export default React.memo(BlockView);
