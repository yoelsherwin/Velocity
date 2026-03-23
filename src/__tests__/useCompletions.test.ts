import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryEntry } from '../hooks/useCommandHistory';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useCompletions } from '../hooks/useCompletions';

function makeEntry(command: string): HistoryEntry {
  return { command, timestamp: Date.now(), shellType: 'powershell' };
}

describe('useCompletions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it('test_history_suggestion_takes_priority', () => {
    // History match shown as ghost text before any Tab press
    const { result } = renderHook(() =>
      useCompletions('git co', 6, [makeEntry('git commit -m fix')], new Set(['git']), 'C:\\'),
    );
    expect(result.current.suggestion).toBe('mmit -m fix');
  });

  it('test_tab_accepts_history_suggestion', () => {
    const { result } = renderHook(() =>
      useCompletions('git co', 6, [makeEntry('git commit -m fix')], new Set(['git']), 'C:\\'),
    );
    // History suggestion exists
    expect(result.current.suggestion).toBe('mmit -m fix');

    // Accept returns the new input value
    let newInput: string | null = null;
    act(() => {
      newInput = result.current.accept();
    });
    expect(newInput).toBe('git commit -m fix');
  });

  it('test_tab_triggers_command_completion', () => {
    // No history match, command position → shows command completions
    const commands = new Set(['git', 'grep', 'go']);
    const { result } = renderHook(() =>
      useCompletions('gr', 2, [], commands, 'C:\\'),
    );

    // No history suggestion
    expect(result.current.suggestion).toBeNull();

    // Trigger completion via cycleNext
    act(() => {
      result.current.cycleNext();
    });

    // Should have command completions
    expect(result.current.completions.length).toBeGreaterThan(0);
    expect(result.current.completions).toContain('grep');
    expect(result.current.suggestion).not.toBeNull();
  });

  it('test_tab_cycles_through_completions', () => {
    const commands = new Set(['git', 'grep', 'go']);
    const { result } = renderHook(() =>
      useCompletions('g', 1, [], commands, 'C:\\'),
    );

    // First cycle triggers completions
    act(() => {
      result.current.cycleNext();
    });

    const firstSuggestion = result.current.suggestion;
    const firstIndex = result.current.completionIndex;

    // Second cycle should advance to next
    act(() => {
      result.current.cycleNext();
    });

    expect(result.current.completionIndex).toBe(firstIndex + 1);
    // Suggestion should be different (if there are multiple completions)
    if (result.current.completions.length > 1) {
      expect(result.current.suggestion).not.toBe(firstSuggestion);
    }
  });

  it('test_completions_reset_on_input_change', () => {
    const commands = new Set(['git', 'grep', 'go']);
    const { result, rerender } = renderHook(
      ({ input, cursor }: { input: string; cursor: number }) =>
        useCompletions(input, cursor, [], commands, 'C:\\'),
      { initialProps: { input: 'g', cursor: 1 } },
    );

    // Trigger completions
    act(() => {
      result.current.cycleNext();
    });

    expect(result.current.completions.length).toBeGreaterThan(0);

    // Change input
    rerender({ input: 'gi', cursor: 2 });

    // Completions should be reset
    expect(result.current.completions).toEqual([]);
    expect(result.current.completionIndex).toBe(-1);
  });

  it('test_empty_completions_returns_null_suggestion', () => {
    const { result } = renderHook(() =>
      useCompletions('xyznotarealcommand', 18, [], new Set(), 'C:\\'),
    );

    // No history match, no completions
    expect(result.current.suggestion).toBeNull();

    // Even after trying to cycle, no completions
    act(() => {
      result.current.cycleNext();
    });

    expect(result.current.completions).toEqual([]);
    expect(result.current.suggestion).toBeNull();
  });

  it('test_completion_replaces_partial', () => {
    const commands = new Set(['git', 'grep']);
    const { result } = renderHook(() =>
      useCompletions('gi', 2, [], commands, 'C:\\'),
    );

    // Trigger command completion
    act(() => {
      result.current.cycleNext();
    });

    // The suggestion should be the remaining part after the partial
    // "gi" -> "git", so suggestion should be "t"
    expect(result.current.suggestion).toBe('t');

    // Accept should return the full new input
    let newInput: string | null = null;
    act(() => {
      newInput = result.current.accept();
    });
    expect(newInput).toBe('git');
  });
});
