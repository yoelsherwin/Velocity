import { useState, useEffect, useCallback, useRef } from 'react';
import { listDirectory, FileEntry } from '../../lib/file-tree';

interface FileTreeNodeProps {
  entry: FileEntry;
  onFileClick: (path: string) => void;
}

function FileTreeNode({ entry, onFileClick }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(() => {
    if (entry.is_directory) {
      if (!expanded && children === null) {
        // Lazy-load children on first expand
        setLoading(true);
        listDirectory(entry.path)
          .then((entries) => {
            setChildren(entries);
            setExpanded(true);
          })
          .catch(() => {
            setChildren([]);
            setExpanded(true);
          })
          .finally(() => setLoading(false));
      } else {
        setExpanded((prev) => !prev);
      }
    } else {
      onFileClick(entry.path);
    }
  }, [entry, expanded, children, onFileClick]);

  const icon = entry.is_directory
    ? expanded ? '\u{1F4C2}' : '\u{1F4C1}'
    : '\u{1F4C4}';

  return (
    <div className="file-tree-node" data-testid={`file-tree-node-${entry.name}`}>
      <div
        className={`file-tree-item ${entry.is_hidden ? 'file-tree-hidden' : ''}`}
        onClick={handleClick}
        data-testid={`file-tree-item-${entry.name}`}
        role="treeitem"
        aria-expanded={entry.is_directory ? expanded : undefined}
      >
        <span className="file-tree-icon">{icon}</span>
        <span className="file-tree-name">{entry.name}</span>
        {loading && <span className="file-tree-loading">...</span>}
      </div>
      {expanded && children && children.length > 0 && (
        <div className="file-tree-children" role="group">
          {children.map((child) => (
            <FileTreeNode key={child.path} entry={child} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  rootPath: string;
  onFileClick: (path: string) => void;
  width: number;
  onResize: (newWidth: number) => void;
}

function FileTree({ rootPath, onFileClick, width, onResize }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    listDirectory(rootPath)
      .then((result) => {
        setEntries(result);
        setError(null);
      })
      .catch((err) => {
        setError(String(err));
        setEntries([]);
      });
  }, [rootPath]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = moveEvent.clientX - dragRef.current.startX;
        const newWidth = Math.max(150, Math.min(400, dragRef.current.startWidth + delta));
        onResize(newWidth);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, onResize],
  );

  return (
    <div
      className="file-tree-sidebar"
      style={{ width: `${width}px` }}
      data-testid="file-tree-sidebar"
      role="tree"
    >
      <div className="file-tree-header">
        <span className="file-tree-title">Explorer</span>
      </div>
      <div className="file-tree-content">
        {error && <div className="file-tree-error">{error}</div>}
        {entries.map((entry) => (
          <FileTreeNode key={entry.path} entry={entry} onFileClick={onFileClick} />
        ))}
      </div>
      <div
        className="file-tree-resize-handle"
        onMouseDown={handleMouseDown}
        data-testid="file-tree-resize-handle"
      />
    </div>
  );
}

export default FileTree;
