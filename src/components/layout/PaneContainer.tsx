import type { PaneNode, PaneDirection } from '../../lib/types';
import Terminal from '../Terminal';

interface PaneContainerProps {
  node: PaneNode;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: PaneDirection) => void;
  onClosePane: (paneId: string) => void;
  isOnlyPane: boolean;
}

function PaneContainer({
  node,
  focusedPaneId,
  onFocusPane,
  onSplitPane,
  onClosePane,
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

  // Split node: render recursively
  return (
    <div
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
          isOnlyPane={isOnlyPane}
        />
      </div>
      <div className="pane-divider" />
      <div style={{ flex: 1 - node.ratio, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <PaneContainer
          node={node.second}
          focusedPaneId={focusedPaneId}
          onFocusPane={onFocusPane}
          onSplitPane={onSplitPane}
          onClosePane={onClosePane}
          isOnlyPane={isOnlyPane}
        />
      </div>
    </div>
  );
}

export default PaneContainer;
