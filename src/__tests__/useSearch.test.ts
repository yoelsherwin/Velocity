import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We will import the hook after implementation
import { useSearch } from '../hooks/useSearch';
import { Block } from '../lib/types';

function makeBlock(id: string, output: string, command = 'test'): Block {
  return {
    id,
    command,
    output,
    timestamp: Date.now(),
    status: 'completed',
    shellType: 'powershell',
  };
}

describe('useSearch hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_search_finds_matches_in_single_block', () => {
    const blocks = [makeBlock('b1', 'hello world hello')];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
    });

    act(() => {
      result.current.setQuery('hello');
    });

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(2);
    expect(result.current.matches[0]).toEqual({
      blockId: 'b1',
      startOffset: 0,
      length: 5,
    });
    expect(result.current.matches[1]).toEqual({
      blockId: 'b1',
      startOffset: 12,
      length: 5,
    });
  });

  it('test_search_case_insensitive_by_default', () => {
    const blocks = [makeBlock('b1', 'Hello HELLO hello')];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(3);
    expect(result.current.caseSensitive).toBe(false);
  });

  it('test_search_case_sensitive_when_enabled', () => {
    const blocks = [makeBlock('b1', 'Hello HELLO hello')];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setCaseSensitive(true);
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(1);
    expect(result.current.matches[0].startOffset).toBe(12);
  });

  it('test_search_strips_ansi_before_matching', () => {
    // ANSI red "hello" followed by normal " world"
    const blocks = [makeBlock('b1', '\x1b[31mhello\x1b[0m world')];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(1);
    // The offset should be 0 in stripped text (not including ANSI codes)
    expect(result.current.matches[0].startOffset).toBe(0);
    expect(result.current.matches[0].length).toBe(5);
  });

  it('test_search_across_multiple_blocks', () => {
    const blocks = [
      makeBlock('b1', 'hello world'),
      makeBlock('b2', 'foo hello bar hello'),
    ];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(3);
    expect(result.current.matches[0].blockId).toBe('b1');
    expect(result.current.matches[1].blockId).toBe('b2');
    expect(result.current.matches[2].blockId).toBe('b2');
  });

  it('test_search_navigation_wraps_around', () => {
    const blocks = [
      makeBlock('b1', 'hello world hello'),
    ];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(2);
    expect(result.current.currentMatchIndex).toBe(0);

    // Navigate to last match
    act(() => {
      result.current.goToNext();
    });
    expect(result.current.currentMatchIndex).toBe(1);

    // Wrap to first
    act(() => {
      result.current.goToNext();
    });
    expect(result.current.currentMatchIndex).toBe(0);

    // Wrap to last (prev from first)
    act(() => {
      result.current.goToPrev();
    });
    expect(result.current.currentMatchIndex).toBe(1);
  });

  it('test_search_empty_query_returns_no_matches', () => {
    const blocks = [makeBlock('b1', 'hello world')];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(0);
    expect(result.current.currentMatchIndex).toBe(-1);
  });

  it('test_search_matches_by_block_groups_correctly', () => {
    const blocks = [
      makeBlock('b1', 'hello hello'),
      makeBlock('b2', 'hello'),
    ];
    const { result } = renderHook(() => useSearch(blocks));

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const byBlock = result.current.matchesByBlock;
    expect(byBlock.get('b1')?.length).toBe(2);
    expect(byBlock.get('b2')?.length).toBe(1);
  });

  it('test_search_updates_on_block_change', () => {
    const blocks1 = [makeBlock('b1', 'hello world')];
    const { result, rerender } = renderHook(
      ({ blocks }) => useSearch(blocks),
      { initialProps: { blocks: blocks1 } },
    );

    act(() => {
      result.current.open();
      result.current.setQuery('hello');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(1);

    // Simulate block output update (new PTY data)
    const blocks2 = [makeBlock('b1', 'hello world hello again')];
    rerender({ blocks: blocks2 });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.matches.length).toBe(2);
  });
});
