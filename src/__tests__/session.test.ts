import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPersistence } from '../hooks/useSessionPersistence';
import { isValidCwdPath } from '../lib/session';
import type { Tab } from '../lib/types';

// Mock the Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { invoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(invoke);

function createTab(overrides?: Partial<Tab>): Tab {
  const id = overrides?.id ?? crypto.randomUUID();
  const paneId = crypto.randomUUID();
  return {
    id,
    title: 'Terminal 1',
    shellType: 'powershell',
    paneRoot: { type: 'leaf', id: paneId },
    focusedPaneId: paneId,
    ...overrides,
  };
}

describe('session persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_session_saved_on_tab_create', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const tab1 = createTab();
    const tab2 = createTab();

    act(() => {
      result.current.requestSave([tab1, tab2], tab1.id);
    });

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_session', expect.objectContaining({
      state: expect.stringContaining('"version":1'),
    }));

    // Verify the saved state has 2 tabs
    const savedState = JSON.parse(mockInvoke.mock.calls[0][1].state);
    expect(savedState.tabs).toHaveLength(2);
  });

  it('test_session_saved_on_tab_close', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const tab1 = createTab();

    act(() => {
      result.current.requestSave([tab1], tab1.id);
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_session', expect.objectContaining({
      state: expect.stringContaining('"version":1'),
    }));

    const savedState = JSON.parse(mockInvoke.mock.calls[0][1].state);
    expect(savedState.tabs).toHaveLength(1);
  });

  it('test_session_restore_creates_tabs', async () => {
    // Test that loadSessionState parses correctly
    const { loadSessionState } = await import('../lib/session');

    const sessionData = {
      version: 1,
      tabs: [
        { id: 't1', title: 'Tab 1', shellType: 'powershell', paneRoot: { type: 'leaf', id: 'p1' }, focusedPaneId: 'p1', panes: [{ id: 'p1', shellType: 'powershell', cwd: 'C:\\', history: [] }] },
        { id: 't2', title: 'Tab 2', shellType: 'cmd', paneRoot: { type: 'leaf', id: 'p2' }, focusedPaneId: 'p2', panes: [{ id: 'p2', shellType: 'cmd', cwd: 'D:\\', history: [] }] },
        { id: 't3', title: 'Tab 3', shellType: 'wsl', paneRoot: { type: 'leaf', id: 'p3' }, focusedPaneId: 'p3', panes: [{ id: 'p3', shellType: 'wsl', cwd: '/home', history: [] }] },
      ],
      activeTabId: 't2',
    };

    mockInvoke.mockResolvedValueOnce(JSON.stringify(sessionData));

    const result = await loadSessionState();
    expect(result).not.toBeNull();
    expect(result!.tabs).toHaveLength(3);
    expect(result!.activeTabId).toBe('t2');
  });

  it('test_session_restore_creates_panes', async () => {
    const { loadSessionState } = await import('../lib/session');

    const sessionData = {
      version: 1,
      tabs: [
        {
          id: 't1', title: 'Tab 1', shellType: 'powershell',
          paneRoot: {
            type: 'split', id: 's1', direction: 'horizontal',
            first: { type: 'leaf', id: 'p1' },
            second: { type: 'leaf', id: 'p2' },
            ratio: 0.5,
          },
          focusedPaneId: 'p1',
          panes: [
            { id: 'p1', shellType: 'powershell', cwd: 'C:\\', history: [] },
            { id: 'p2', shellType: 'powershell', cwd: 'D:\\', history: [] },
          ],
        },
      ],
      activeTabId: 't1',
    };

    mockInvoke.mockResolvedValueOnce(JSON.stringify(sessionData));

    const result = await loadSessionState();
    expect(result).not.toBeNull();
    expect(result!.tabs[0].paneRoot.type).toBe('split');
    if (result!.tabs[0].paneRoot.type === 'split') {
      expect(result!.tabs[0].paneRoot.first.type).toBe('leaf');
      expect(result!.tabs[0].paneRoot.second.type).toBe('leaf');
    }
  });

  it('test_session_restore_fallback', async () => {
    const { loadSessionState } = await import('../lib/session');

    // Missing file → null
    mockInvoke.mockResolvedValueOnce(null);
    const result = await loadSessionState();
    expect(result).toBeNull();
  });

  it('test_session_restore_fallback_invalid_json', async () => {
    const { loadSessionState } = await import('../lib/session');

    // Invalid JSON string
    mockInvoke.mockResolvedValueOnce('NOT VALID JSON');
    const result = await loadSessionState();
    expect(result).toBeNull();
  });

  it('test_session_restore_fallback_wrong_version', async () => {
    const { loadSessionState } = await import('../lib/session');

    const badSession = { version: 99, tabs: [], activeTabId: 'x' };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(badSession));
    const result = await loadSessionState();
    expect(result).toBeNull();
  });

  it('test_save_debounced', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const tab1 = createTab();

    // Rapid changes
    act(() => {
      result.current.requestSave([tab1], tab1.id);
      result.current.requestSave([tab1], tab1.id);
      result.current.requestSave([tab1], tab1.id);
    });

    // Before debounce fires, no save yet
    expect(mockInvoke).not.toHaveBeenCalled();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Only one save call
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('test_saveNow_saves_immediately', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const tab1 = createTab();

    act(() => {
      result.current.saveNow([tab1], tab1.id);
    });

    // Save should happen immediately without waiting for debounce
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('save_session', expect.objectContaining({
      state: expect.stringContaining('"version":1'),
    }));
  });

  it('test_saveNow_cancels_pending_debounce', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const tab1 = createTab();

    act(() => {
      result.current.requestSave([tab1], tab1.id); // starts debounce timer
      result.current.saveNow([tab1], tab1.id); // immediate save, cancels timer
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Advance past debounce - should NOT trigger another save
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('test_pane_data_included_in_save', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const paneId = 'pane-123';
    const tab1 = createTab({
      paneRoot: { type: 'leaf', id: paneId },
      focusedPaneId: paneId,
    });

    act(() => {
      result.current.updatePaneData(paneId, {
        shellType: 'powershell',
        cwd: 'C:\\Users\\test',
        history: ['dir', 'cd ..', 'npm start'],
      });
      result.current.saveNow([tab1], tab1.id);
    });

    const savedState = JSON.parse(mockInvoke.mock.calls[0][1].state);
    expect(savedState.tabs[0].panes[0].cwd).toBe('C:\\Users\\test');
    expect(savedState.tabs[0].panes[0].history).toEqual(['dir', 'cd ..', 'npm start']);
  });

  it('test_history_capped_at_100', () => {
    const { result } = renderHook(() => useSessionPersistence());

    const paneId = 'pane-456';
    const tab1 = createTab({
      paneRoot: { type: 'leaf', id: paneId },
      focusedPaneId: paneId,
    });

    const longHistory = Array.from({ length: 150 }, (_, i) => `cmd-${i}`);

    act(() => {
      result.current.updatePaneData(paneId, {
        shellType: 'powershell',
        cwd: 'C:\\',
        history: longHistory,
      });
      result.current.saveNow([tab1], tab1.id);
    });

    const savedState = JSON.parse(mockInvoke.mock.calls[0][1].state);
    expect(savedState.tabs[0].panes[0].history).toHaveLength(100);
    // Should keep the LAST 100
    expect(savedState.tabs[0].panes[0].history[0]).toBe('cmd-50');
  });
});

describe('isValidCwdPath', () => {
  it('accepts normal Windows paths', () => {
    expect(isValidCwdPath('C:\\')).toBe(true);
    expect(isValidCwdPath('C:\\Users\\test\\Documents')).toBe(true);
    expect(isValidCwdPath('D:\\My Projects\\app')).toBe(true);
  });

  it('accepts normal Unix paths', () => {
    expect(isValidCwdPath('/home/user')).toBe(true);
    expect(isValidCwdPath('/usr/local/bin')).toBe(true);
  });

  it('accepts paths with spaces and hyphens', () => {
    expect(isValidCwdPath('C:\\Program Files\\My App')).toBe(true);
    expect(isValidCwdPath('/home/user/my-project')).toBe(true);
  });

  it('rejects paths with semicolons (command chaining)', () => {
    expect(isValidCwdPath('C:\\foo; rm -rf /')).toBe(false);
  });

  it('rejects paths with pipe (command piping)', () => {
    expect(isValidCwdPath('C:\\foo | malicious')).toBe(false);
  });

  it('rejects paths with ampersand (command chaining)', () => {
    expect(isValidCwdPath('C:\\foo & echo pwned')).toBe(false);
  });

  it('rejects paths with backticks (command substitution)', () => {
    expect(isValidCwdPath('C:\\foo`whoami`')).toBe(false);
  });

  it('rejects paths with dollar sign (variable expansion)', () => {
    expect(isValidCwdPath('C:\\$HOME')).toBe(false);
    expect(isValidCwdPath('C:\\$(whoami)')).toBe(false);
  });

  it('rejects paths with parentheses (subshell)', () => {
    expect(isValidCwdPath('C:\\foo(bar)')).toBe(false);
  });

  it('rejects paths with newlines (command injection)', () => {
    expect(isValidCwdPath('C:\\foo\nrm -rf /')).toBe(false);
    expect(isValidCwdPath('C:\\foo\rrm -rf /')).toBe(false);
  });

  it('rejects paths with curly braces', () => {
    expect(isValidCwdPath('C:\\foo{bar}')).toBe(false);
  });

  it('rejects paths with square brackets', () => {
    expect(isValidCwdPath('C:\\foo[0]')).toBe(false);
  });
});
