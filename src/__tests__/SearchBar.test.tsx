import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import SearchBar from '../components/SearchBar';

const defaultProps = {
  query: '',
  setQuery: vi.fn(),
  caseSensitive: false,
  setCaseSensitive: vi.fn(),
  matchCount: 0,
  currentMatchIndex: -1,
  goToNext: vi.fn(),
  goToPrev: vi.fn(),
  isOpen: true,
  onClose: vi.fn(),
};

describe('SearchBar Component', () => {
  it('test_search_bar_renders_when_open', () => {
    render(<SearchBar {...defaultProps} isOpen={true} />);
    expect(screen.getByPlaceholderText('Find in output...')).toBeInTheDocument();
  });

  it('test_search_bar_hidden_when_closed', () => {
    const { container } = render(<SearchBar {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('test_search_bar_escape_closes', () => {
    const onClose = vi.fn();
    render(<SearchBar {...defaultProps} onClose={onClose} />);

    const input = screen.getByPlaceholderText('Find in output...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('test_search_bar_enter_goes_to_next', () => {
    const goToNext = vi.fn();
    render(<SearchBar {...defaultProps} goToNext={goToNext} />);

    const input = screen.getByPlaceholderText('Find in output...');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(goToNext).toHaveBeenCalledTimes(1);
  });

  it('test_search_bar_shift_enter_goes_to_prev', () => {
    const goToPrev = vi.fn();
    render(<SearchBar {...defaultProps} goToPrev={goToPrev} />);

    const input = screen.getByPlaceholderText('Find in output...');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(goToPrev).toHaveBeenCalledTimes(1);
  });

  it('test_search_bar_displays_match_count', () => {
    render(
      <SearchBar
        {...defaultProps}
        query="hello"
        matchCount={42}
        currentMatchIndex={2}
      />,
    );

    expect(screen.getByText('3 of 42')).toBeInTheDocument();
  });

  it('test_search_bar_shows_no_results', () => {
    render(
      <SearchBar
        {...defaultProps}
        query="nonexistent"
        matchCount={0}
        currentMatchIndex={-1}
      />,
    );

    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('test_search_bar_case_toggle', () => {
    const setCaseSensitive = vi.fn();
    render(
      <SearchBar
        {...defaultProps}
        caseSensitive={false}
        setCaseSensitive={setCaseSensitive}
      />,
    );

    const aaButton = screen.getByText('Aa');
    fireEvent.click(aaButton);

    expect(setCaseSensitive).toHaveBeenCalledWith(true);
  });
});
