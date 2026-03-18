import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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

type ListenerCallback = (event: { payload: unknown }) => void;
const eventListeners: Record<string, ListenerCallback> = {};
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('../lib/llm', () => ({
  translateCommand: vi.fn().mockResolvedValue('dir'),
}));

vi.mock('../lib/cwd', () => ({
  getCwd: vi.fn().mockResolvedValue('C:\\Users\\test'),
}));

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import Terminal from '../components/Terminal';

describe('Terminal Alt Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(eventListeners).forEach((key) => delete eventListeners[key]);

    mockCreateSession.mockResolvedValue('test-session-id');
    mockListen.mockImplementation(
      async (eventName: string, callback: ListenerCallback) => {
        eventListeners[eventName] = callback;
        return vi.fn();
      },
    );
    mockWriteToSession.mockResolvedValue(undefined);
    mockCloseSession.mockResolvedValue(undefined);
    mockStartReading.mockResolvedValue(undefined);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_known_commands') {
        return Promise.resolve(['git', 'dir', 'echo']);
      }
      return Promise.reject(`Unknown command: ${cmd}`);
    });
  });

  it('test_terminal_alt_screen_shows_grid', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Initially should show terminal output and input
    expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument();

    // Simulate alt screen enter event
    await act(async () => {
      const altEnterListener = eventListeners['pty:alt-screen-enter:test-session-id'];
      expect(altEnterListener).toBeDefined();
      altEnterListener({ payload: { rows: 24, cols: 80 } });
    });

    // Now the grid should be shown and blocks/input should be hidden
    await waitFor(() => {
      expect(screen.getByTestId('terminal-grid')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('terminal-output')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-input')).not.toBeInTheDocument();
  });

  it('test_terminal_alt_screen_hides_input', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Verify input is present initially
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument();

    // Enter alt screen
    await act(async () => {
      eventListeners['pty:alt-screen-enter:test-session-id']({ payload: { rows: 24, cols: 80 } });
    });

    // InputEditor should be hidden
    await waitFor(() => {
      expect(screen.queryByTestId('terminal-input')).not.toBeInTheDocument();
    });

    // Shell selector should also be hidden
    expect(screen.queryByTestId('shell-selector')).not.toBeInTheDocument();
  });

  it('test_terminal_alt_screen_exit_restores_blocks', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Enter alt screen
    await act(async () => {
      eventListeners['pty:alt-screen-enter:test-session-id']({ payload: { rows: 24, cols: 80 } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-grid')).toBeInTheDocument();
    });

    // Exit alt screen
    await act(async () => {
      eventListeners['pty:alt-screen-exit:test-session-id']({ payload: undefined });
    });

    // Blocks and input should be back
    await waitFor(() => {
      expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
    });
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-grid')).not.toBeInTheDocument();
  });

  it('test_terminal_grid_updates_with_data', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Enter alt screen
    await act(async () => {
      eventListeners['pty:alt-screen-enter:test-session-id']({ payload: { rows: 24, cols: 80 } });
    });

    // Send grid update
    const gridData = [
      {
        cells: [
          { content: 'A', fg: null, bg: null, bold: false, italic: false, underline: false, dim: false },
          { content: 'B', fg: null, bg: null, bold: false, italic: false, underline: false, dim: false },
        ],
      },
    ];

    await act(async () => {
      eventListeners['pty:grid-update:test-session-id']({ payload: gridData });
    });

    // Grid should render with cells
    const grid = screen.getByTestId('terminal-grid');
    const rows = grid.querySelectorAll('.terminal-grid-row');
    expect(rows.length).toBe(1);
    const spans = rows[0].querySelectorAll('span');
    expect(spans[0].textContent).toBe('A');
    expect(spans[1].textContent).toBe('B');
  });

  it('test_terminal_grid_keyboard_sends_to_pty', async () => {
    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Enter alt screen
    await act(async () => {
      eventListeners['pty:alt-screen-enter:test-session-id']({ payload: { rows: 24, cols: 80 } });
    });

    const grid = await waitFor(() => screen.getByTestId('terminal-grid'));

    // Send grid update so grid has content
    const gridData = [
      {
        cells: [
          { content: ' ', fg: null, bg: null, bold: false, italic: false, underline: false, dim: false },
        ],
      },
    ];
    await act(async () => {
      eventListeners['pty:grid-update:test-session-id']({ payload: gridData });
    });

    // Type a key
    await act(async () => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    });

    await waitFor(() => {
      expect(mockWriteToSession).toHaveBeenCalledWith('test-session-id', 'q');
    });
  });
});
