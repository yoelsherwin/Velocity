import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSession = vi.fn();
const mockWriteToSession = vi.fn();
const mockCloseSession = vi.fn();
const mockStartReading = vi.fn();

vi.mock('../lib/pty', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  writeToSession: (...args: unknown[]) => mockWriteToSession(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
  startReading: (...args: unknown[]) => mockStartReading(...args),
}));

// Store event listeners so tests can simulate events
type ListenerCallback = (event: { payload: unknown }) => void;
const eventListeners: Record<string, ListenerCallback> = {};
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import Terminal, { MAX_BLOCKS } from '../components/Terminal';

describe('Terminal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear stored listeners
    Object.keys(eventListeners).forEach((key) => delete eventListeners[key]);

    mockCreateSession.mockResolvedValue('test-session-id');
    mockListen.mockImplementation(
      async (eventName: string, callback: ListenerCallback) => {
        eventListeners[eventName] = callback;
        return vi.fn(); // unlisten function
      },
    );
    mockWriteToSession.mockResolvedValue(undefined);
    mockCloseSession.mockResolvedValue(undefined);
    mockStartReading.mockResolvedValue(undefined);
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

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'echo hello; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }\r',
      );
    });
  });

  it('test_multiline_command_sends_carriage_returns', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    // Simulate a multi-line command (as produced by Shift+Enter)
    fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'line1\rline2\rline3; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }\r',
      );
    });
  });

  it('test_clears_input_after_enter', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('test_displays_write_error_in_output', async () => {
    mockWriteToSession.mockRejectedValue('PTY write failed');

    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'bad command' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).toContain('[Write error:');
    });
  });

  // --- Task 004: Shell selector tests ---

  it('test_shell_selector_renders', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
    expect(screen.getByTestId('shell-btn-powershell')).toBeInTheDocument();
    expect(screen.getByTestId('shell-btn-cmd')).toBeInTheDocument();
    expect(screen.getByTestId('shell-btn-wsl')).toBeInTheDocument();
  });

  it('test_powershell_selected_by_default', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
    const psBtn = screen.getByTestId('shell-btn-powershell');
    expect(psBtn).toHaveAttribute('aria-selected', 'true');
  });

  it('test_creates_session_with_default_shell', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });
  });

  it('test_shell_switch_creates_new_session', async () => {
    mockCreateSession
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2');

    render(<Terminal />);

    // Wait for initial session to be created
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });

    // Click CMD button to switch shell
    const cmdBtn = screen.getByTestId('shell-btn-cmd');
    await act(async () => {
      fireEvent.click(cmdBtn);
    });

    await waitFor(() => {
      expect(mockCloseSession).toHaveBeenCalledWith('session-1');
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('cmd', 24, 80);
    });
  });

  // --- Task 004: Restart tests ---

  it('test_restart_button_appears_on_exit', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Simulate pty:closed event
    await act(async () => {
      const closedCallback = eventListeners['pty:closed:test-session-id'];
      if (closedCallback) {
        closedCallback({ payload: undefined });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('restart-button')).toBeInTheDocument();
    });
  });

  it('test_restart_creates_new_session', async () => {
    mockCreateSession
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2');

    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });

    // Simulate pty:closed event
    await act(async () => {
      const closedCallback = eventListeners['pty:closed:session-1'];
      if (closedCallback) {
        closedCallback({ payload: undefined });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('restart-button')).toBeInTheDocument();
    });

    // Click restart
    await act(async () => {
      fireEvent.click(screen.getByTestId('restart-button'));
    });

    await waitFor(() => {
      // Should create a new session with the same shell type
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      expect(mockCreateSession).toHaveBeenLastCalledWith('powershell', 24, 80);
    });
  });

  it('test_output_clears_on_restart', async () => {
    mockCreateSession
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2');

    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Simulate some output
    await act(async () => {
      const outputCallback = eventListeners['pty:output:session-1'];
      if (outputCallback) {
        outputCallback({ payload: 'some output text' });
      }
    });

    // Verify the output is displayed
    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).toContain('some output text');
    });

    // Simulate pty:closed event
    await act(async () => {
      const closedCallback = eventListeners['pty:closed:session-1'];
      if (closedCallback) {
        closedCallback({ payload: undefined });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('restart-button')).toBeInTheDocument();
    });

    // Click restart
    await act(async () => {
      fireEvent.click(screen.getByTestId('restart-button'));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    // Output should be cleared after restart
    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).not.toContain('some output text');
    });
  });

  // --- Task 005: Block model integration tests ---

  it('test_initial_welcome_block_created', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // There should be at least one block container in the output area
    const outputArea = screen.getByTestId('terminal-output');
    const blocks = outputArea.querySelectorAll('.block-container');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('test_command_creates_new_block', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      // The command text should appear somewhere in the output area
      const outputArea = screen.getByTestId('terminal-output');
      expect(outputArea.textContent).toContain('echo hello');
    });

    // Should have 2 blocks: welcome + the new command block
    await waitFor(() => {
      const outputArea = screen.getByTestId('terminal-output');
      const blocks = outputArea.querySelectorAll('.block-container');
      expect(blocks.length).toBe(2);
    });
  });

  it('test_blocks_limited_to_max', () => {
    // Verify the MAX_BLOCKS constant is exported and has the expected value
    expect(MAX_BLOCKS).toBe(50);
  });

  // --- FIX-011: Empty input should not submit a command ---

  it('test_empty_input_not_submitted', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');

    // Press Enter with empty input
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // writeToSession should NOT have been called
    expect(mockWriteToSession).not.toHaveBeenCalled();

    // Also test whitespace-only input
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // writeToSession should still NOT have been called
    expect(mockWriteToSession).not.toHaveBeenCalled();
  });

  // --- FIX-008: startReading called after listeners registered ---

  it('test_startReading_called_after_listeners_registered', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });

    // startReading should be called with the session ID after listeners are set up
    await waitFor(() => {
      expect(mockStartReading).toHaveBeenCalledWith('test-session-id');
    });

    // Verify the call order: createSession -> listen (3x) -> startReading
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledTimes(3);
    expect(mockStartReading).toHaveBeenCalledTimes(1);

    // startReading must be called AFTER all listen calls
    const listenOrder = mockListen.mock.invocationCallOrder;
    const startReadingOrder = mockStartReading.mock.invocationCallOrder;
    const lastListenCall = Math.max(...listenOrder);
    const firstStartReadingCall = Math.min(...startReadingOrder);
    expect(firstStartReadingCall).toBeGreaterThan(lastListenCall);
  });

  it('test_startReading_called_on_shell_switch', async () => {
    mockCreateSession
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2');

    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith('powershell', 24, 80);
    });

    await waitFor(() => {
      expect(mockStartReading).toHaveBeenCalledWith('session-1');
    });

    // Switch to CMD
    const cmdBtn = screen.getByTestId('shell-btn-cmd');
    await act(async () => {
      fireEvent.click(cmdBtn);
    });

    await waitFor(() => {
      expect(mockStartReading).toHaveBeenCalledWith('session-2');
    });
  });

  // --- FIX-007: StrictMode double-mount cancellation test ---

  // --- Task 011 fix: Integration test for repeated Up arrow history navigation ---

  it('test_up_arrow_twice_shows_first_command', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;

    // Type and submit first command
    fireEvent.change(textarea, { target: { value: 'echo first' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'echo first; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }\r',
      );
    });

    // Type and submit second command
    fireEvent.change(textarea, { target: { value: 'echo second' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'echo second; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }\r',
      );
    });

    // Press Up once — should show "echo second" (most recent)
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(textarea.value).toBe('echo second');
    });

    // Press Up again — should show "echo first" (earlier command)
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(textarea.value).toBe('echo first');
    });
  });

  // --- Task 012: Exit code marker injection tests ---

  it('test_exit_marker_appended_to_command', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'dir' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        expect.stringContaining('VELOCITY_EXIT'),
      );
    });
  });

  it('test_exit_marker_uses_powershell_syntax_by_default', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'dir' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'dir; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }\r',
      );
    });
  });

  it('test_exit_code_parsed_from_output_and_block_completed', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Submit a command to create a new block
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'dir' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalled();
    });

    // Simulate output with exit marker
    await act(async () => {
      const outputCallback = eventListeners['pty:output:test-session-id'];
      if (outputCallback) {
        outputCallback({ payload: 'file1.txt\nVELOCITY_EXIT:0\n' });
      }
    });

    // The marker should be stripped from the displayed output
    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).not.toContain('VELOCITY_EXIT');
    });
  });

  it('test_exit_command_skips_marker', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'exit' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'exit\r',
      );
    });

    // The marker suffix should NOT be present
    const writtenCommand = mockWriteToSession.mock.calls[0][1];
    expect(writtenCommand).not.toContain('VELOCITY_EXIT');
  });

  it('test_exit_with_args_skips_marker', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'exit 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith(
        'test-session-id',
        'exit 1\r',
      );
    });

    // The marker suffix should NOT be present
    const writtenCommand = mockWriteToSession.mock.calls[0][1];
    expect(writtenCommand).not.toContain('VELOCITY_EXIT');
  });

  it('test_exit_code_extracted_when_marker_split_across_chunks', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Submit a command to create a new block
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'dir' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalled();
    });

    // Chunk 1: marker is partially delivered
    await act(async () => {
      const outputCallback = eventListeners['pty:output:test-session-id'];
      if (outputCallback) {
        outputCallback({ payload: 'file1.txt\nVELOCITY_EXI' });
      }
    });

    // After chunk 1, exit code should NOT yet be detected
    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).toContain('file1.txt');
    });

    // Chunk 2: remainder of the marker arrives
    await act(async () => {
      const outputCallback = eventListeners['pty:output:test-session-id'];
      if (outputCallback) {
        outputCallback({ payload: 'T:0\n' });
      }
    });

    // Now the accumulated output should have the full marker, which gets parsed and stripped
    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).not.toContain('VELOCITY_EXIT');
      expect(output.textContent).toContain('file1.txt');
    });
  });

  it('test_startSession_cancels_on_remount', async () => {
    // Simulate StrictMode double-mount: createSession returns different IDs
    // for each call, and the first session should be cleaned up.
    mockCreateSession
      .mockResolvedValueOnce('session-mount-1')
      .mockResolvedValueOnce('session-mount-2');

    const unlistenFns = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    let unlistenIdx = 0;
    mockListen.mockImplementation(
      async (eventName: string, callback: ListenerCallback) => {
        eventListeners[eventName] = callback;
        return unlistenFns[unlistenIdx++] || vi.fn();
      },
    );

    // Render in StrictMode to trigger double-mount
    await act(async () => {
      render(
        <React.StrictMode>
          <Terminal />
        </React.StrictMode>,
      );
    });

    // Wait for session creation to complete
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    // The first session should have been closed (either by the cleanup or
    // by the second startSession's invocation guard)
    await waitFor(() => {
      expect(mockCloseSession).toHaveBeenCalledWith('session-mount-1');
    });

    // Only the second session's listeners should be active
    // Verify listeners are registered for session-mount-2
    expect(eventListeners).toHaveProperty('pty:output:session-mount-2');
    expect(eventListeners).toHaveProperty('pty:error:session-mount-2');
    expect(eventListeners).toHaveProperty('pty:closed:session-mount-2');

    // The second session should still work — simulate output
    await act(async () => {
      const outputCallback = eventListeners['pty:output:session-mount-2'];
      if (outputCallback) {
        outputCallback({ payload: 'PS C:\\> ' });
      }
    });

    await waitFor(() => {
      const output = screen.getByTestId('terminal-output');
      expect(output.textContent).toContain('PS C:\\>');
    });
  });
});
