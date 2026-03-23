import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCommandHistory, HistoryEntry } from '../hooks/useCommandHistory';

function makeEntry(command: string): HistoryEntry {
  return { command, timestamp: Date.now(), shellType: 'powershell' };
}

describe('useCommandHistory', () => {
  it('test_addCommand_stores_in_history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
      result.current.addCommand(makeEntry('pwd'));
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0].command).toBe('ls');
    expect(result.current.history[1].command).toBe('pwd');
  });

  it('test_navigateUp_returns_most_recent', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
      result.current.addCommand(makeEntry('pwd'));
    });

    let value: string | null = null;
    act(() => {
      value = result.current.navigateUp();
    });

    expect(value).toBe('pwd');
  });

  it('test_navigateUp_twice_returns_earlier', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
      result.current.addCommand(makeEntry('pwd'));
    });

    let value: string | null = null;
    act(() => {
      result.current.navigateUp(); // pwd
    });
    act(() => {
      value = result.current.navigateUp(); // ls
    });

    expect(value).toBe('ls');
  });

  it('test_navigateUp_at_beginning_returns_null', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
    });

    let value: string | null = null;
    act(() => {
      result.current.navigateUp(); // ls
    });
    act(() => {
      value = result.current.navigateUp(); // past beginning
    });

    expect(value).toBeNull();
  });

  it('test_navigateDown_returns_next', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
      result.current.addCommand(makeEntry('pwd'));
    });

    act(() => {
      result.current.navigateUp(); // pwd
    });
    act(() => {
      result.current.navigateUp(); // ls
    });

    let value: string | null = null;
    act(() => {
      value = result.current.navigateDown(); // pwd
    });

    expect(value).toBe('pwd');
  });

  it('test_navigateDown_past_end_returns_draft', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
    });

    act(() => {
      result.current.setDraft('git');
    });

    act(() => {
      result.current.navigateUp(); // ls
    });

    let value: string | null = null;
    act(() => {
      value = result.current.navigateDown(); // back to draft
    });

    expect(value).toBe('git');
  });

  it('test_reset_clears_index', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
    });

    act(() => {
      result.current.navigateUp(); // ls
    });

    act(() => {
      result.current.reset();
    });

    let value: string | null = null;
    act(() => {
      value = result.current.navigateUp(); // should start from end again
    });

    expect(value).toBe('ls');
  });

  it('test_skip_duplicate_last_command', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand(makeEntry('ls'));
      result.current.addCommand(makeEntry('ls'));
    });

    expect(result.current.history).toHaveLength(1);
  });

  it('test_maxHistory_enforced', () => {
    const { result } = renderHook(() => useCommandHistory(3));

    act(() => {
      result.current.addCommand(makeEntry('a'));
      result.current.addCommand(makeEntry('b'));
      result.current.addCommand(makeEntry('c'));
      result.current.addCommand(makeEntry('d'));
      result.current.addCommand(makeEntry('e'));
    });

    expect(result.current.history).toHaveLength(3);
    // Oldest should be dropped
    expect(result.current.history.map((e) => e.command)).toEqual(['c', 'd', 'e']);
  });
});
