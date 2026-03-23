import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSuggestFix = vi.fn();

vi.mock('../lib/llm', () => ({
  suggestFix: (...args: unknown[]) => mockSuggestFix(...args),
  translateCommand: vi.fn(),
  classifyIntentLLM: vi.fn(),
}));

import ErrorSuggestion from '../components/blocks/ErrorSuggestion';

describe('ErrorSuggestion Component', () => {
  const baseProps = {
    command: 'git push',
    exitCode: 1,
    output: 'fatal: no upstream branch set',
    shellType: 'powershell',
    cwd: 'C:\\Projects',
    hasApiKey: true,
    onUseFix: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_error_suggestion_shown_for_failed_command', async () => {
    mockSuggestFix.mockResolvedValue({
      suggested_command: 'git push --set-upstream origin main',
      explanation: 'No upstream branch was set',
    });

    render(<ErrorSuggestion {...baseProps} />);

    // Should show loading state first
    expect(screen.getByTestId('error-suggestion-loading')).toBeInTheDocument();
    expect(screen.getByText('Analyzing error...')).toBeInTheDocument();

    // Should show suggestion after loading
    await waitFor(() => {
      expect(screen.getByTestId('error-suggestion')).toBeInTheDocument();
    });
    expect(screen.getByTestId('error-suggestion-command')).toHaveTextContent(
      'git push --set-upstream origin main',
    );
    expect(screen.getByText('No upstream branch was set')).toBeInTheDocument();
  });

  it('test_error_suggestion_hidden_for_success', () => {
    const { container } = render(
      <ErrorSuggestion {...baseProps} exitCode={0} />,
    );
    // Should not render anything for exit code 0
    expect(container.innerHTML).toBe('');
    expect(mockSuggestFix).not.toHaveBeenCalled();
  });

  it('test_use_button_populates_input', async () => {
    const onUseFix = vi.fn();
    mockSuggestFix.mockResolvedValue({
      suggested_command: 'npm install',
      explanation: 'Missing dependencies',
    });

    render(<ErrorSuggestion {...baseProps} onUseFix={onUseFix} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-suggestion-use')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('error-suggestion-use'));
    expect(onUseFix).toHaveBeenCalledWith('npm install');
  });

  it('test_dismiss_button_hides_suggestion', async () => {
    mockSuggestFix.mockResolvedValue({
      suggested_command: 'npm install',
      explanation: 'Missing dependencies',
    });

    render(<ErrorSuggestion {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-suggestion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('error-suggestion-dismiss'));

    // After dismiss, suggestion should be hidden
    expect(screen.queryByTestId('error-suggestion')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-suggestion-loading')).not.toBeInTheDocument();
  });

  it('test_suggestion_loading_state', async () => {
    // Create a promise that we can control
    let resolvePromise: (value: unknown) => void;
    mockSuggestFix.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    render(<ErrorSuggestion {...baseProps} />);

    // Should show loading
    expect(screen.getByTestId('error-suggestion-loading')).toBeInTheDocument();
    expect(screen.getByText('Analyzing error...')).toBeInTheDocument();

    // Resolve the promise
    await act(async () => {
      resolvePromise!({
        suggested_command: 'fixed command',
        explanation: 'explanation',
      });
    });

    // Should no longer be loading
    expect(screen.queryByTestId('error-suggestion-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-suggestion')).toBeInTheDocument();
  });

  it('test_no_suggestion_without_api_key', () => {
    const { container } = render(
      <ErrorSuggestion {...baseProps} hasApiKey={false} />,
    );
    // Should not render anything without API key
    expect(container.innerHTML).toBe('');
    expect(mockSuggestFix).not.toHaveBeenCalled();
  });

  it('test_hides_when_llm_returns_empty_command', async () => {
    mockSuggestFix.mockResolvedValue({
      suggested_command: '',
      explanation: 'Cannot determine fix',
    });

    const { container } = render(<ErrorSuggestion {...baseProps} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('error-suggestion-loading')).not.toBeInTheDocument();
    });

    // Should not show suggestion for empty command
    expect(screen.queryByTestId('error-suggestion')).not.toBeInTheDocument();
  });

  it('test_hides_silently_on_llm_failure', async () => {
    mockSuggestFix.mockRejectedValue(new Error('Network error'));

    const { container } = render(<ErrorSuggestion {...baseProps} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('error-suggestion-loading')).not.toBeInTheDocument();
    });

    // Should not show any error or suggestion
    expect(screen.queryByTestId('error-suggestion')).not.toBeInTheDocument();
  });
});
