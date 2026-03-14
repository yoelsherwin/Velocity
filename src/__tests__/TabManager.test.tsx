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

  it('test_close_tab_calls_closeSession', async () => {
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

    // The second session ID is 'session-2'
    const secondSessionId = 'session-2';

    // Clear mock call history so we can isolate the close call
    mockCloseSession.mockClear();

    // Close the second (active) tab via its close button
    const closeButtons = screen.getAllByTestId(/^tab-close-/);
    await act(async () => {
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    });

    // Terminal unmount should trigger useEffect cleanup which calls closeSession
    await waitFor(() => {
      expect(mockCloseSession).toHaveBeenCalledWith(secondSessionId);
    });

    // Only one tab should remain
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    expect(tabButtons).toHaveLength(1);
  });

  // --- Task 010: Split pane integration tests ---

  it('test_split_pane_creates_two_terminals', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Should start with 1 terminal output area
    let terminals = screen.getAllByTestId('terminal-output');
    expect(terminals).toHaveLength(1);

    // Press Ctrl+Shift+ArrowRight to split the pane horizontally
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Should now have 2 terminal output areas
    await waitFor(() => {
      terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });
  });

  it('test_close_pane_removes_split', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Split the pane
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });

    // Close the focused pane with Ctrl+Shift+W
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'W',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Should be back to 1 terminal
    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(1);
    });
  });

  it('test_ctrl_shift_down_splits_vertically', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Should start with 1 terminal
    let terminals = screen.getAllByTestId('terminal-output');
    expect(terminals).toHaveLength(1);

    // Press Ctrl+Shift+Down to split the pane vertically
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Should now have 2 terminal output areas in a vertical split
    await waitFor(() => {
      terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });

    // Verify it created a vertical split container
    const verticalSplit = document.querySelector('.pane-split-vertical');
    expect(verticalSplit).toBeInTheDocument();
  });

  it('test_close_inactive_tab_preserves_active', async () => {
    let sessionCounter = 0;
    mockCreateSession.mockImplementation(async () => `session-${++sessionCounter}`);

    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    // Create a second tab (becomes active)
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-new-button'));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    const secondSessionId = 'session-2';

    // Switch back to tab 1 (click it)
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    await act(async () => {
      fireEvent.click(tabButtons[0]);
    });

    // Tab 1 should now be active
    expect(tabButtons[0]).toHaveClass('tab-button-active');

    // Clear mock call history to isolate the close call
    mockCloseSession.mockClear();

    // Close tab 2 (the inactive one)
    const closeButtons = screen.getAllByTestId(/^tab-close-/);
    await act(async () => {
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    });

    // closeSession should have been called for tab 2's session
    await waitFor(() => {
      expect(mockCloseSession).toHaveBeenCalledWith(secondSessionId);
    });

    // Tab 1 should still be present and active
    const remainingTabs = screen.getAllByTestId(/^tab-button-/);
    expect(remainingTabs).toHaveLength(1);
    expect(remainingTabs[0]).toHaveClass('tab-button-active');

    // Tab 1's content should still be visible
    const tabPanels = document.querySelectorAll('.tab-panel');
    expect(tabPanels).toHaveLength(1);
    expect(tabPanels[0]).toHaveStyle({ display: 'flex' });

    // Terminal output area should still exist (tab 1 content preserved)
    expect(screen.getByTestId('terminal-output')).toBeInTheDocument();
  });

  // --- Task 014: Per-tab pane focus tests ---

  it('test_focus_preserved_across_tab_switch', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Split the pane in tab 1 so it has 2 panes
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });

    // Get the pane IDs in tab 1; the second pane (new one from split) should be focused
    // after the split auto-focus behavior
    const tab1Panes = document.querySelectorAll('[data-testid^="pane-"]');
    expect(tab1Panes).toHaveLength(2);

    // Click the second pane to ensure it's focused in tab 1
    await act(async () => {
      fireEvent.click(tab1Panes[1]);
    });

    // Verify the second pane has the focused class
    expect(tab1Panes[1]).toHaveClass('pane-focused');
    expect(tab1Panes[0]).not.toHaveClass('pane-focused');

    // Create tab 2 and switch to it
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-new-button'));
    });

    // Tab 2 is now active; switch back to tab 1
    const tabButtons = screen.getAllByTestId(/^tab-button-/);
    await act(async () => {
      fireEvent.click(tabButtons[0]);
    });

    // After switching back to tab 1, pane 2 should still be focused
    const tab1PanesAfter = document.querySelectorAll(
      `[data-testid^="tab-panel-"]:not([style*="display: none"]) [data-testid^="pane-"]`,
    );
    // Find the pane that has the focused class
    const focusedPane = document.querySelector(
      `[data-testid^="tab-panel-"]:not([style*="display: none"]) .pane-focused`,
    );
    expect(focusedPane).not.toBeNull();
    // The focused pane should be the second pane (same one we clicked before switching)
    expect(focusedPane?.getAttribute('data-testid')).toBe(
      tab1Panes[1].getAttribute('data-testid'),
    );
  });

  it('test_split_focuses_new_pane', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Get the initial pane ID
    const initialPane = document.querySelector('[data-testid^="pane-"]');
    expect(initialPane).not.toBeNull();
    const initialPaneTestId = initialPane!.getAttribute('data-testid');

    // Split the pane
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Wait for the split to render
    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });

    // The NEW pane (not the original) should be focused
    const focusedPane = document.querySelector('.pane-focused');
    expect(focusedPane).not.toBeNull();
    // The focused pane should NOT be the original pane
    expect(focusedPane!.getAttribute('data-testid')).not.toBe(initialPaneTestId);
  });

  it('test_close_pane_focuses_sibling', async () => {
    render(<TabManager />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Split the pane to have 2 panes
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(2);
    });

    // Get the pane that is NOT focused (the sibling/original pane)
    const allPanes = document.querySelectorAll('[data-testid^="pane-"]');
    expect(allPanes).toHaveLength(2);

    const unfocusedPane = document.querySelector('[data-testid^="pane-"]:not(.pane-focused)');
    expect(unfocusedPane).not.toBeNull();
    const siblingTestId = unfocusedPane!.getAttribute('data-testid');

    // Close the focused pane with Ctrl+Shift+W
    await act(async () => {
      fireEvent.keyDown(document, {
        key: 'W',
        ctrlKey: true,
        shiftKey: true,
      });
    });

    // Should be back to 1 pane
    await waitFor(() => {
      const terminals = screen.getAllByTestId('terminal-output');
      expect(terminals).toHaveLength(1);
    });

    // The remaining pane should be the sibling and it should be focused
    const remainingPane = document.querySelector('[data-testid^="pane-"]');
    expect(remainingPane).not.toBeNull();
    expect(remainingPane!.getAttribute('data-testid')).toBe(siblingTestId);
    expect(remainingPane).toHaveClass('pane-focused');
  });
});
