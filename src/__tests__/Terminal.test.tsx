import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSession = vi.fn();
const mockWriteToSession = vi.fn();
const mockCloseSession = vi.fn();

vi.mock('../lib/pty', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  writeToSession: (...args: unknown[]) => mockWriteToSession(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
}));

const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import Terminal from '../components/Terminal';

describe('Terminal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue('test-session-id');
    mockListen.mockResolvedValue(vi.fn()); // unlisten function
    mockWriteToSession.mockResolvedValue(undefined);
    mockCloseSession.mockResolvedValue(undefined);
  });

  it('test_terminal_renders_without_crashing', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
  });

  it('test_terminal_has_output_area', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
    expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
  });

  it('test_terminal_has_input_field', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument();
  });

  it('test_creates_session_on_mount', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });
  });

  it('test_sends_input_on_enter', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const input = screen.getByTestId('terminal-input');
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'echo hello\r',
      );
    });
  });

  it('test_clears_input_after_enter', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const input = screen.getByTestId('terminal-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('test_displays_write_error_in_output', async () => {
    mockWriteToSession.mockRejectedValue('PTY write failed');

    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const input = screen.getByTestId('terminal-input');
    fireEvent.change(input, { target: { value: 'bad command' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).toContain('[Write error:');
    });
  });
});
