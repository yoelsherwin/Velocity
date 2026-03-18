import React, { useEffect, useRef, useCallback } from 'react';

export interface GridCell {
  content: string;
  fg?: string | null;
  bg?: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

export interface GridRow {
  cells: GridCell[];
}

interface TerminalGridProps {
  rows: GridRow[];
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/** Style for a single grid cell */
function cellStyle(cell: GridCell): React.CSSProperties {
  return {
    color: cell.fg || undefined,
    backgroundColor: cell.bg || undefined,
    fontWeight: cell.bold ? 'bold' : undefined,
    fontStyle: cell.italic ? 'italic' : undefined,
    textDecoration: cell.underline ? 'underline' : undefined,
    opacity: cell.dim ? 0.5 : undefined,
  };
}

const GridRowMemo = React.memo(function GridRowComponent({ row }: { row: GridRow }) {
  return (
    <div className="terminal-grid-row">
      {row.cells.map((cell, colIdx) => (
        <span key={colIdx} style={cellStyle(cell)}>
          {cell.content || ' '}
        </span>
      ))}
    </div>
  );
});

function TerminalGrid({ rows, onKeyDown }: TerminalGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Auto-focus the grid so it captures keyboard input
  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  // Re-focus if we lose focus, but only when the window is still active
  // and the user hasn't moved focus to a dialog or modal
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (document.hasFocus() && gridRef.current && !document.activeElement?.closest('dialog, [role="dialog"]')) {
        gridRef.current.focus();
      }
    }, 10);
  }, []);

  return (
    <div
      ref={gridRef}
      className="terminal-grid"
      data-testid="terminal-grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={handleBlur}
    >
      {rows.map((row, rowIdx) => (
        <GridRowMemo key={rowIdx} row={row} />
      ))}
    </div>
  );
}

export default React.memo(TerminalGrid);
