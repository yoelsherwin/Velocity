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

import TabManager from '../components/layout/TabManager';

describe('TabManager', () => {
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
  });

  it('test_starts_with_one_tab', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });
    // Should have exactly one tab button
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);
    // Should have a terminal output area
    expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
  });

  it('test_new_tab_creates_terminal', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Click the new tab button
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-new-button'));
    });

    // Should have 2 tab buttons
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(2);

    // The second tab should be active (have active class)
    expect(tabButtons[1]).toHaveClass('tab-button-active');
  });

  it('test_close_tab_removes_it', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Create a second tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-new-button'));
    });

    let tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(2);

    // Close the second (active) tab
    const closeButtons = screen.getAllByTestId(/^tab-close-/);
    await act(async () => {
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    });

    tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);
  });

  it('test_cannot_close_last_tab', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // With only 1 tab, the close button should not be present
    expect(screen.queryByTestId(/^tab-close-/)).not.toBeInTheDocument();
  });

  it('test_switching_tabs_preserves_terminal', async () => {
    let sessionCounter = 0;
    mockCreateSession.mockImplementation(async () => `session-${++sessionCounter}`);

    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    // Create a second tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-new-button'));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    // Both tab panels should exist in the DOM (display:none for inactive)
    const tabPanels = document.querySelectorAll('.tab-panel');
    expect(tabPanels).toHaveLength(2);

    // The second tab is active, so the first should be hidden
    const tabButtons = screen.getAllByTestId(/^tab-button-/);

    // Switch back to tab 1
    await act(async () => {
      fireEvent.click(tabButtons[0]);
    });

    // Both panels still exist (display: none preserves state)
    const panelsAfterSwitch = document.querySelectorAll('.tab-panel');
    expect(panelsAfterSwitch).toHaveLength(2);

    // The first panel should be visible (display: flex), second hidden
    expect(panelsAfterSwitch[0]).toHaveStyle({ display: 'flex' });
    expect(panelsAfterSwitch[1]).toHaveStyle({ display: 'none' });
  });

  it('test_ctrl_t_creates_new_tab', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Press Ctrl+T
    await act(async () => {
      fireEvent.keyDown(document, { key: 't', ctrlKey: true });
    });

    // Should have 2 tab buttons now
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(2);
  });

  it('test_ctrl_w_closes_active_tab', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Create a second tab via Ctrl+T
    await act(async () => {
      fireEvent.keyDown(document, { key: 't', ctrlKey: true });
    });

    let tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(2);

    // The second tab should be active
    expect(tabButtons[1]).toHaveClass('tab-button-active');

    // Press Ctrl+W to close the active tab
    await act(async () => {
      fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    });

    // Should have only 1 tab remaining
    tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);

    // The remaining tab should be active
    expect(tabButtons[0]).toHaveClass('tab-button-active');
  });
});
