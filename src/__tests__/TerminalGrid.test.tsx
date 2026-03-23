import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TerminalGrid, { GridRow } from '../components/TerminalGrid';

function makeRow(text: string, cols: number = 80): GridRow {
  const cells = [];
  for (let i = 0; i < cols; i++) {
    cells.push({
      content: i < text.length ? text[i] : ' ',
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      dim: false,
    });
  }
  return { cells };
}

function makeStyledRow(): GridRow {
  return {
    cells: [
      { content: 'R', fg: 'rgb(255,0,0)', bg: null, bold: true, italic: false, underline: false, dim: false },
      { content: 'G', fg: 'rgb(0,255,0)', bg: 'rgb(0,0,0)', bold: false, italic: true, underline: false, dim: false },
      { content: 'U', fg: null, bg: null, bold: false, italic: false, underline: true, dim: false },
    ],
  };
}

describe('TerminalGrid', () => {
  it('test_terminal_grid_renders_cells', () => {
    const rows = [makeRow('Hello', 10), makeRow('World', 10)];
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={rows} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    expect(grid).toBeInTheDocument();

    // Should have 2 rows
    const gridRows = grid.querySelectorAll('.terminal-grid-row');
    expect(gridRows.length).toBe(2);

    // First row should have 10 cells (spans)
    const firstRowSpans = gridRows[0].querySelectorAll('span');
    expect(firstRowSpans.length).toBe(10);

    // Check content of first cell
    expect(firstRowSpans[0].textContent).toBe('H');
    expect(firstRowSpans[1].textContent).toBe('e');
  });

  it('test_terminal_grid_applies_styles', () => {
    const rows = [makeStyledRow()];
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={rows} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    const spans = grid.querySelectorAll('.terminal-grid-row span');

    // Bold red cell
    expect(spans[0].textContent).toBe('R');
    expect((spans[0] as HTMLElement).style.color).toBe('rgb(255, 0, 0)');
    expect((spans[0] as HTMLElement).style.fontWeight).toBe('bold');

    // Italic green cell with black bg
    expect(spans[1].textContent).toBe('G');
    expect((spans[1] as HTMLElement).style.color).toBe('rgb(0, 255, 0)');
    expect((spans[1] as HTMLElement).style.fontStyle).toBe('italic');
    expect((spans[1] as HTMLElement).style.backgroundColor).toBe('rgb(0, 0, 0)');

    // Underlined cell
    expect(spans[2].textContent).toBe('U');
    expect((spans[2] as HTMLElement).style.textDecoration).toBe('underline');
  });

  it('test_terminal_grid_keyboard_input', () => {
    const rows = [makeRow('test', 10)];
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={rows} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    fireEvent.keyDown(grid, { key: 'a' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('test_terminal_grid_has_focus', () => {
    const rows = [makeRow('test', 10)];
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={rows} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    expect(grid.getAttribute('tabindex')).toBe('0');
  });

  it('test_terminal_grid_empty_rows', () => {
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={[]} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    const gridRows = grid.querySelectorAll('.terminal-grid-row');
    expect(gridRows.length).toBe(0);
  });

  it('test_terminal_grid_renders_cursor_at_position', () => {
    const rows = [makeRow('Hello', 10), makeRow('World', 10)];
    const onKeyDown = vi.fn();
    render(
      <TerminalGrid
        rows={rows}
        onKeyDown={onKeyDown}
        cursorRow={0}
        cursorCol={5}
        cursorVisible={true}
      />
    );

    const grid = screen.getByTestId('terminal-grid');
    const cursorCell = grid.querySelector('.terminal-grid-cursor');
    expect(cursorCell).toBeInTheDocument();
    // Cursor should be on row 0, col 5 (the space after "Hello")
    expect(cursorCell?.textContent).toBe(' ');
  });

  it('test_terminal_grid_cursor_hidden_when_not_visible', () => {
    const rows = [makeRow('Hello', 10)];
    const onKeyDown = vi.fn();
    render(
      <TerminalGrid
        rows={rows}
        onKeyDown={onKeyDown}
        cursorRow={0}
        cursorCol={0}
        cursorVisible={false}
      />
    );

    const grid = screen.getByTestId('terminal-grid');
    const cursorCell = grid.querySelector('.terminal-grid-cursor');
    expect(cursorCell).not.toBeInTheDocument();
  });

  it('test_terminal_grid_cursor_not_rendered_without_props', () => {
    const rows = [makeRow('Hello', 10)];
    const onKeyDown = vi.fn();
    render(<TerminalGrid rows={rows} onKeyDown={onKeyDown} />);

    const grid = screen.getByTestId('terminal-grid');
    const cursorCell = grid.querySelector('.terminal-grid-cursor');
    expect(cursorCell).not.toBeInTheDocument();
  });

  it('test_terminal_grid_cursor_on_second_row', () => {
    const rows = [makeRow('Hello', 10), makeRow('World', 10)];
    const onKeyDown = vi.fn();
    render(
      <TerminalGrid
        rows={rows}
        onKeyDown={onKeyDown}
        cursorRow={1}
        cursorCol={3}
        cursorVisible={true}
      />
    );

    const grid = screen.getByTestId('terminal-grid');
    const gridRows = grid.querySelectorAll('.terminal-grid-row');
    // Cursor should be in second row, 4th cell
    const cursorCell = gridRows[1].querySelector('.terminal-grid-cursor');
    expect(cursorCell).toBeInTheDocument();
    expect(cursorCell?.textContent).toBe('l');
  });

  it('test_terminal_grid_cursor_blinks', () => {
    const rows = [makeRow('Hello', 10)];
    const onKeyDown = vi.fn();
    render(
      <TerminalGrid
        rows={rows}
        onKeyDown={onKeyDown}
        cursorRow={0}
        cursorCol={0}
        cursorVisible={true}
      />
    );

    const grid = screen.getByTestId('terminal-grid');
    const cursorCell = grid.querySelector('.terminal-grid-cursor');
    expect(cursorCell).toBeInTheDocument();
    // Cursor should have the blink class
    expect(cursorCell?.classList.contains('terminal-grid-cursor')).toBe(true);
  });
});
