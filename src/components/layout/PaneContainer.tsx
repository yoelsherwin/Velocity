import { useCallback, useRef } from 'react';
import type { PaneNode, PaneDirection } from '../../lib/types';
import Terminal from '../Terminal';

interface PaneContainerProps {
  node: PaneNode;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: PaneDirection) => void;
  onClosePane: (paneId: string) => void;
  onResizePane?: (splitId: string, newRatio: number) => void;
  isOnlyPane: boolean;
}

function usePaneDrag(
  splitId: string,
  direction: PaneDirection,
  onResize: (id: string, ratio: number) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      let ratio: number;
      if (direction === 'horizontal') {
        ratio = (moveEvent.clientX - rect.left) / rect.width;
      } else {
        ratio = (moveEvent.clientY - rect.top) / rect.height;
      }
      // Clamp between 0.1 and 0.9 (minimum 10% per pane)
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      onResize(splitId, ratio);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [splitId, direction, onResize]);

  return { containerRef, handleMouseDown };
}

// No-op resize handler used when onResizePane is not provided
const noopResize = () => {};

interface SplitPaneProps {
  node: Extract<PaneNode, { type: 'split' }>;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: PaneDirection) => void;
  onClosePane: (paneId: string) => void;
  onResizePane: (splitId: string, newRatio: number) => void;
  isOnlyPane: boolean;
}

function SplitPane({
  node,
  focusedPaneId,
  onFocusPane,
  onSplitPane,
  onClosePane,
  onResizePane,
  isOnlyPane,
}: SplitPaneProps) {
  const { containerRef, handleMouseDown } = usePaneDrag(node.id, node.direction, onResizePane);

  return (
    <div
      ref={containerRef}
      className={`pane-split pane-split-${node.direction}`}
      style={{
        flexDirection: node.direction === 'horizontal' ? 'row' : 'column',
      }}
    >
      <div style={{ flex: node.ratio, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <PaneContainer
          node={node.first}
          focusedPaneId={focusedPaneId}
          onFocusPane={onFocusPane}
          onSplitPane={onSplitPane}
          onClosePane={onClosePane}
          onResizePane={onResizePane}
          isOnlyPane={isOnlyPane}
        />
      </div>
      <div className="pane-divider" onMouseDown={handleMouseDown} />
      <div style={{ flex: 1 - node.ratio, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <PaneContainer
          node={node.second}
          focusedPaneId={focusedPaneId}
          onFocusPane={onFocusPane}
          onSplitPane={onSplitPane}
          onClosePane={onClosePane}
          onResizePane={onResizePane}
          isOnlyPane={isOnlyPane}
        />
      </div>
    </div>
  );
}

function PaneContainer({
  node,
  focusedPaneId,
  onFocusPane,
  onSplitPane,
  onClosePane,
  onResizePane,
  isOnlyPane,
}: PaneContainerProps) {
  if (node.type === 'leaf') {
    return (
      <div
        className={`pane-leaf ${node.id === focusedPaneId ? 'pane-focused' : ''}`}
        onClick={() => onFocusPane(node.id)}
        data-testid={`pane-${node.id}`}
      >
        <Terminal key={node.id} />
        <div className="pane-actions">
          <button
            className="pane-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSplitPane(node.id, 'horizontal');
            }}
            title="Split Right"
          >
            |
          </button>
          <button
            className="pane-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSplitPane(node.id, 'vertical');
            }}
            title="Split Down"
          >
            -
          </button>
          {!isOnlyPane && (
            <button
              className="pane-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClosePane(node.id);
              }}
              title="Close Pane"
            >
              x
            </button>
          )}
        </div>
      </div>
    );
  }

  // Split node: delegate to SplitPane component (so the hook is called unconditionally)
  return (
    <SplitPane
      node={node}
      focusedPaneId={focusedPaneId}
      onFocusPane={onFocusPane}
      onSplitPane={onSplitPane}
      onClosePane={onClosePane}
      onResizePane={onResizePane ?? noopResize}
      isOnlyPane={isOnlyPane}
    />
  );
}

export default PaneContainer;
