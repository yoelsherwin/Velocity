import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from '../components/CommandPalette';
import { COMMANDS } from '../lib/commands';

const defaultProps = {
  onExecute: vi.fn(),
  onClose: vi.fn(),
};

describe('CommandPalette Component', () => {
  it('test_palette_renders_when_open', () => {
    render(<CommandPalette {...defaultProps} />);
    // Should render the input
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
    // Should render commands in the list
    expect(screen.getByText('New Tab')).toBeInTheDocument();
  });

  it('test_palette_autofocuses_input', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');
    expect(document.activeElement).toBe(input);
  });

  it('test_palette_filters_on_type', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');

    fireEvent.change(input, { target: { value: 'new tab' } });

    // "New Tab" should be visible (text may be split across highlighted spans)
    const items = screen.getAllByTestId('palette-item');
    const hasNewTab = items.some((item) => item.textContent?.includes('New Tab'));
    expect(hasNewTab).toBe(true);
    // Commands that don't match should not be visible
    const hasClosePane = items.some((item) => item.textContent?.includes('Close Pane'));
    expect(hasClosePane).toBe(false);
  });

  it('test_palette_arrow_down_selects_next', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');

    // Arrow down should select the second item (first is selected by default)
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // The second item should have the selected class
    const items = screen.getAllByTestId('palette-item');
    expect(items[1]).toHaveClass('palette-item-selected');
  });

  it('test_palette_arrow_up_selects_previous', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');

    // Move down twice, then up once
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    // The second item should be selected
    const items = screen.getAllByTestId('palette-item');
    expect(items[1]).toHaveClass('palette-item-selected');
  });

  it('test_palette_enter_executes_selected', () => {
    const onExecute = vi.fn();
    render(<CommandPalette {...defaultProps} onExecute={onExecute} />);
    const input = screen.getByPlaceholderText('Type a command...');

    // Press Enter to execute the first (default-selected) command
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onExecute).toHaveBeenCalledTimes(1);
    // Should be called with the ID of the first command in the list
    expect(onExecute).toHaveBeenCalledWith(expect.any(String));
  });

  it('test_palette_escape_closes', () => {
    const onClose = vi.fn();
    render(<CommandPalette {...defaultProps} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command...');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('test_palette_click_executes_command', () => {
    const onExecute = vi.fn();
    render(<CommandPalette {...defaultProps} onExecute={onExecute} />);

    // Click on "New Tab" command
    const newTabItem = screen.getByText('New Tab');
    fireEvent.click(newTabItem.closest('[data-testid="palette-item"]')!);

    expect(onExecute).toHaveBeenCalledWith('tab.new');
  });

  it('test_palette_shows_shortcuts', () => {
    render(<CommandPalette {...defaultProps} />);

    // "Ctrl+T" should be visible as a shortcut badge for "New Tab"
    expect(screen.getByText('Ctrl+T')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+W')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+P')).toBeInTheDocument();
  });

  it('test_palette_shows_categories', () => {
    render(<CommandPalette {...defaultProps} />);

    // Categories should be visible
    expect(screen.getAllByText('Tab').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pane').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Terminal').length).toBeGreaterThan(0);
  });

  it('test_palette_no_results_message', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');

    fireEvent.change(input, { target: { value: 'zzzzz' } });

    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('test_palette_backdrop_click_closes', () => {
    const onClose = vi.fn();
    render(<CommandPalette {...defaultProps} onClose={onClose} />);

    // Click the backdrop (the overlay element)
    const backdrop = screen.getByTestId('palette-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('test_palette_selection_wraps', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type a command...');

    // Arrow Up from first item should wrap to last
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    const items = screen.getAllByTestId('palette-item');
    // Last item should be selected
    expect(items[items.length - 1]).toHaveClass('palette-item-selected');

    // Arrow Down from last should wrap to first
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(items[0]).toHaveClass('palette-item-selected');
  });
});
