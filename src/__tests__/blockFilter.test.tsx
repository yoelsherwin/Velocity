import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

describe('Block Output Filtering', () => {
  const multiLineBlock: Block = {
    id: 'block-filter-1',
    command: 'ls',
    output: 'file1.txt\nfile2.log\nfile3.txt\nerror.log\nreadme.md',
    timestamp: Date.now(),
    status: 'completed',
    shellType: 'powershell',
  };

  const mockOnRerun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_filter_button_appears_on_hover', () => {
    render(<BlockView block={multiLineBlock} isActive={false} onRerun={mockOnRerun} />);
    // Filter button should be in the block actions (visible on hover via CSS)
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('test_filter_input_opens_on_click', () => {
    render(<BlockView block={multiLineBlock} isActive={false} onRerun={mockOnRerun} />);
    const filterBtn = screen.getByText('Filter');
    fireEvent.click(filterBtn);
    expect(screen.getByTestId('block-filter-input')).toBeInTheDocument();
  });

  it('test_filter_hides_non_matching_lines', () => {
    render(<BlockView block={multiLineBlock} isActive={false} onRerun={mockOnRerun} />);

    // Open filter
    fireEvent.click(screen.getByText('Filter'));
    const input = screen.getByTestId('block-filter-input');

    // Type "log" to filter
    fireEvent.change(input, { target: { value: 'log' } });

    // The output area should only show lines containing "log"
    const output = screen.getByTestId('block-output');
    expect(output).toHaveTextContent('file2.log');
    expect(output).toHaveTextContent('error.log');
    expect(output).not.toHaveTextContent('file1.txt');
    expect(output).not.toHaveTextContent('file3.txt');
    expect(output).not.toHaveTextContent('readme.md');
  });

  it('test_filter_case_insensitive', () => {
    const block: Block = {
      ...multiLineBlock,
      output: 'Error found\nerror again\nERROR loud\nno match here',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);

    fireEvent.click(screen.getByText('Filter'));
    const input = screen.getByTestId('block-filter-input');
    fireEvent.change(input, { target: { value: 'error' } });

    const output = screen.getByTestId('block-output');
    expect(output).toHaveTextContent('Error found');
    expect(output).toHaveTextContent('error again');
    expect(output).toHaveTextContent('ERROR loud');
    expect(output).not.toHaveTextContent('no match here');
  });

  it('test_filter_line_count', () => {
    render(<BlockView block={multiLineBlock} isActive={false} onRerun={mockOnRerun} />);

    fireEvent.click(screen.getByText('Filter'));
    const input = screen.getByTestId('block-filter-input');
    fireEvent.change(input, { target: { value: 'log' } });

    // Should show "2 of 5 lines"
    expect(screen.getByTestId('block-filter-count')).toHaveTextContent('2 of 5 lines');
  });

  it('test_filter_escape_clears', () => {
    render(<BlockView block={multiLineBlock} isActive={false} onRerun={mockOnRerun} />);

    // Open filter and type
    fireEvent.click(screen.getByText('Filter'));
    const input = screen.getByTestId('block-filter-input');
    fireEvent.change(input, { target: { value: 'log' } });

    // Verify filter is active
    expect(screen.getByTestId('block-filter-input')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // Filter input should be gone and all lines visible
    expect(screen.queryByTestId('block-filter-input')).not.toBeInTheDocument();
    const output = screen.getByTestId('block-output');
    expect(output).toHaveTextContent('file1.txt');
    expect(output).toHaveTextContent('readme.md');
  });

  it('test_filter_preserves_ansi', () => {
    const ansiBlock: Block = {
      ...multiLineBlock,
      // ANSI red "error" on line 1, plain line 2
      output: '\x1b[31merror line\x1b[0m\nnormal line',
    };
    render(<BlockView block={ansiBlock} isActive={false} onRerun={mockOnRerun} />);

    fireEvent.click(screen.getByText('Filter'));
    const input = screen.getByTestId('block-filter-input');
    fireEvent.change(input, { target: { value: 'error' } });

    const output = screen.getByTestId('block-output');
    // The filtered output should still contain the styled span with "error line"
    expect(output).toHaveTextContent('error line');
    // The ANSI-styled span should have a color style (rgb format from parser)
    const spans = output.querySelectorAll('span');
    const styledSpan = Array.from(spans).find(s => s.textContent?.includes('error line'));
    expect(styledSpan).toBeTruthy();
    expect(styledSpan!.style.color).toBeTruthy();
  });
});
