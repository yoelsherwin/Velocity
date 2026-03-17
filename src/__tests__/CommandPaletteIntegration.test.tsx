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

type ListenerCallback = (event: { payload: unknown }) => void;
const eventListeners: Record<string, ListenerCallback> = {};
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../lib/llm', () => ({
  translateCommand: vi.fn().mockResolvedValue('echo test'),
}));

vi.mock('../lib/cwd', () => ({
  getCwd: vi.fn().mockResolvedValue('C:\\'),
}));

import TabManager from '../components/layout/TabManager';

describe('Command Palette Integration', () => {
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
        return Promise.resolve(['git', 'dir', 'echo', 'npm', 'docker', 'kubectl', 'cd', 'cls', 'find']);
      }
      return Promise.reject(`Unknown command: ${cmd}`);
    });
  });

  it('test_ctrl_shift_p_opens_palette', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Palette should not be in the DOM initially
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();

    // Press Ctrl+Shift+P
    await act(async () => {
      fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
    });

    // Palette should now be visible
    await waitFor(() => {
      expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    });
  });

  it('test_ctrl_shift_p_toggles_palette', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Open palette
    await act(async () => {
      fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    });

    // Press Ctrl+Shift+P again to close
    await act(async () => {
      fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    });
  });

  it('test_palette_executes_new_tab', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Should start with 1 tab
    let tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);

    // Open palette
    await act(async () => {
      fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    });

    // Type "new tab" to filter
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'new tab' } });

    // Press Enter to execute selected command
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // Palette should close
    await waitFor(() => {
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    });

    // A new tab should have been created
    tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(2);
  });
});
