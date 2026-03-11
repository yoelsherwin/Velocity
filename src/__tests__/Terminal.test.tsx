import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import Terminal from '../components/Terminal';

describe('Terminal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue('test-session-id');
    mockListen.mockResolvedValue(vi.fn()); // unlisten function
  });

  it('test_terminal_renders_without_crashing', () => {
    render(<Terminal />);
  });

  it('test_terminal_has_output_area', () => {
    render(<Terminal />);
    expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
  });

  it('test_terminal_has_input_field', () => {
    render(<Terminal />);
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument();
  });

  it('test_creates_session_on_mount', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('create_session', {
        shell_type: 'powershell',
        rows: 24,
        cols: 80,
      });
    });
  });

  it('test_sends_input_on_enter', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('create_session', expect.any(Object));
    });

    const input = screen.getByTestId('terminal-input');
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('write_to_session', {
        session_id: 'test-session-id',
        data: 'echo hello\r',
      });
    });
  });

  it('test_clears_input_after_enter', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('create_session', expect.any(Object));
    });

    const input = screen.getByTestId('terminal-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});
