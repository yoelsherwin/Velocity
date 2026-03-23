import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import HistorySearch from '../components/HistorySearch';

const defaultProps = {
  history: ['ls', 'git commit -m "init"', 'git push', 'npm test', 'git status'],
  isOpen: true,
  onAccept: vi.fn(),
  onCancel: vi.fn(),
};

describe('HistorySearch Component', () => {
  it('test_history_search_finds_match', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'git' } });

    // Most recent match should be "git status"
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git status');
  });

  it('test_history_search_case_insensitive', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'GIT' } });

    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git status');
  });

  it('test_history_search_no_match', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'xyz' } });

    expect(screen.getByTestId('history-search-no-match')).toHaveTextContent('No matching history');
  });

  it('test_history_search_ctrl_r_cycles', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'git' } });

    // First match is most recent: "git status"
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git status');

    // Ctrl+R cycles to next older match: "git push"
    fireEvent.keyDown(input, { key: 'r', ctrlKey: true });
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git push');

    // Ctrl+R again: "git commit -m "init""
    fireEvent.keyDown(input, { key: 'r', ctrlKey: true });
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git commit -m "init"');
  });

  it('test_history_search_enter_accepts', () => {
    const onAccept = vi.fn();
    render(<HistorySearch {...defaultProps} onAccept={onAccept} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'git' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAccept).toHaveBeenCalledWith('git status');
  });

  it('test_history_search_escape_cancels', () => {
    const onCancel = vi.fn();
    render(<HistorySearch {...defaultProps} onCancel={onCancel} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('test_history_search_query_resets_index', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'git' } });

    // Cycle to older match
    fireEvent.keyDown(input, { key: 'r', ctrlKey: true });
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git push');

    // Change query — should reset to most recent match
    fireEvent.change(input, { target: { value: 'git s' } });
    expect(screen.getByTestId('history-search-match')).toHaveTextContent('git status');
  });

  it('test_ctrl_r_opens_history_search', () => {
    // When closed, nothing renders
    const { container, rerender } = render(<HistorySearch {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');

    // When open, search input renders
    rerender(<HistorySearch {...defaultProps} isOpen={true} />);
    expect(screen.getByPlaceholderText('Search history...')).toBeInTheDocument();
  });

  it('test_history_search_renders_highlight', () => {
    render(<HistorySearch {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'git' } });

    // The match display should contain a highlight span
    const highlight = screen.getByTestId('history-search-highlight');
    expect(highlight).toHaveTextContent('git');
    expect(highlight.tagName).toBe('MARK');
  });

  it('test_history_search_enter_with_no_match_does_not_accept', () => {
    const onAccept = vi.fn();
    render(<HistorySearch {...defaultProps} onAccept={onAccept} />);
    const input = screen.getByPlaceholderText('Search history...');
    fireEvent.change(input, { target: { value: 'xyz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAccept).not.toHaveBeenCalled();
  });

  it('test_history_search_hidden_when_closed', () => {
    const { container } = render(<HistorySearch {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });
});
