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

import TabManager from '../components/layout/TabManager';
import { COMMANDS } from '../lib/commands';

describe('Multiple Windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockInvoke.mockResolvedValue(undefined);
  });

  it('test_ctrl_shift_n_creates_window', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Press Ctrl+Shift+N to open a new window
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'N',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Should invoke the create_new_window Tauri command
    expect(mockInvoke).toHaveBeenCalledWith('create_new_window');
  });

  it('test_window_new_in_palette', () => {
    // The command palette should have a "New Window" entry
    const windowNewCommand = COMMANDS.find((cmd) => cmd.id === 'window.new');
    expect(windowNewCommand).toBeDefined();
    expect(windowNewCommand!.title).toBe('New Window');
    expect(windowNewCommand!.shortcut).toBe('Ctrl+Shift+N');
    expect(windowNewCommand!.category).toBe('Window');
  });

  it('test_new_window_independent_state', async () => {
    // Each window renders its own TabManager with independent state.
    // Verify that a fresh TabManager starts with exactly 1 tab.
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);
  });

  it('test_palette_action_creates_window', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Open command palette with Ctrl+Shift+P
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'P',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Type "New Window" to filter
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'New Window' } });

    // Click the "New Window" command
    await waitFor(() => {
      const items = screen.getAllByTestId('palette-item');
      const newWindowItem = items.find((item) => item.textContent?.includes('New Window'));
      expect(newWindowItem).toBeDefined();
      fireEvent.click(newWindowItem!);
    });

    // Should invoke the create_new_window Tauri command
    expect(mockInvoke).toHaveBeenCalledWith('create_new_window');
  });
});
