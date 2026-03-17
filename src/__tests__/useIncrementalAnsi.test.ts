import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIncrementalAnsi } from '../hooks/useIncrementalAnsi';
import { parseAnsi } from '../lib/ansi';

describe('useIncrementalAnsi', () => {
  it('test_incremental_parse_new_chunk', () => {
    // Initial render with "hello"
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: 'hello' } },
    );

    const initialSpans = result.current;
    expect(initialSpans.length).toBeGreaterThanOrEqual(1);
    const initialContent = initialSpans.map((s) => s.content).join('');
    expect(initialContent).toBe('hello');

    // Rerender with appended text "hello world"
    rerender({ output: 'hello world' });

    const updatedSpans = result.current;
    const updatedContent = updatedSpans.map((s) => s.content).join('');
    expect(updatedContent).toBe('hello world');

    // The span count should have increased (the new " world" chunk adds at least one span)
    expect(updatedSpans.length).toBeGreaterThanOrEqual(initialSpans.length);
  });

  it('test_incremental_parse_full_on_truncation', () => {
    // Start with "abcdef"
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: 'abcdef' } },
    );

    const initialSpans = result.current;
    const initialContent = initialSpans.map((s) => s.content).join('');
    expect(initialContent).toBe('abcdef');

    // Rerender with truncated text "def" (not a prefix match — triggers full reparse)
    rerender({ output: 'def' });

    const updatedSpans = result.current;
    const updatedContent = updatedSpans.map((s) => s.content).join('');
    expect(updatedContent).toBe('def');
  });

  it('test_incremental_parse_no_change', () => {
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: 'hello' } },
    );

    const firstSpans = result.current;

    // Rerender with same text — should return identical reference
    rerender({ output: 'hello' });

    const secondSpans = result.current;
    expect(secondSpans).toBe(firstSpans); // Same reference (no reparse)
  });

  it('test_incremental_parse_preserves_ansi_colors', () => {
    // Red text followed by appended green text
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: '\x1b[31mred\x1b[0m' } },
    );

    const initialSpans = result.current;
    const redSpan = initialSpans.find((s) => s.content === 'red');
    expect(redSpan).toBeDefined();
    expect(redSpan!.fg).toBeDefined();

    // Append green text
    rerender({ output: '\x1b[31mred\x1b[0m\x1b[32mgreen\x1b[0m' });

    const updatedSpans = result.current;
    const allContent = updatedSpans.map((s) => s.content).join('');
    expect(allContent).toContain('red');
    expect(allContent).toContain('green');
  });

  it('test_incremental_parse_handles_empty_string', () => {
    const { result } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: '' } },
    );

    // Empty input should return empty array
    expect(result.current).toEqual([]);
  });
});
