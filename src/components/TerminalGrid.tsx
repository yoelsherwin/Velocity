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

export interface GridUpdatePayload {
  rows: GridRow[];
  cursor_row: number;
  cursor_col: number;
  cursor_visible: boolean;
}

interface TerminalGridProps {
  rows: GridRow[];
  onKeyDown: (e: React.KeyboardEvent) => void;
  cursorRow?: number;
  cursorCol?: number;
  cursorVisible?: boolean;
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

const GridRowMemo = React.memo(function GridRowComponent({
  row,
  cursorCol,
}: {
  row: GridRow;
  cursorCol?: number;
}) {
  return (
    <div className="terminal-grid-row">
      {row.cells.map((cell, colIdx) => {
        const isCursor = cursorCol === colIdx;
        return (
          <span
            key={colIdx}
            style={cellStyle(cell)}
            className={isCursor ? 'terminal-grid-cursor' : undefined}
          >
            {cell.content || ' '}
          </span>
        );
      })}
    </div>
  );
});

function TerminalGrid({ rows, onKeyDown, cursorRow, cursorCol, cursorVisible }: TerminalGridProps) {
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

  // Only show cursor if explicitly visible and position is defined
  const showCursor = cursorVisible === true && cursorRow != null && cursorCol != null;

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
        <GridRowMemo
          key={rowIdx}
          row={row}
          cursorCol={showCursor && rowIdx === cursorRow ? cursorCol : undefined}
        />
      ))}
    </div>
  );
}

export default React.memo(TerminalGrid);
