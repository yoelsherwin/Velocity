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

  it('test_incremental_reparse_on_truncation_with_marker', () => {
    // Simulate a large output that will be front-truncated with a marker.
    // The key scenario: output starts large, then gets replaced with
    // "[Truncated]\nXYZ..." — the hook must do a full reparse, not return
    // stale accumulated spans.
    const marker = '[Output truncated \u2014 showing last 500KB]\n';
    const originalContent = 'A'.repeat(1000);
    const truncatedTail = 'XYZ' + 'B'.repeat(500);

    // Phase 1: initial large output
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: originalContent } },
    );

    const phase1Spans = result.current;
    const phase1Content = phase1Spans.map((s) => s.content).join('');
    expect(phase1Content).toBe(originalContent);

    // Phase 2: front-truncation — output is replaced with marker + tail
    const truncatedOutput = marker + truncatedTail;
    rerender({ output: truncatedOutput });

    const phase2Spans = result.current;
    const phase2Content = phase2Spans.map((s) => s.content).join('');

    // Spans must match a fresh parseAnsi of the truncated output
    const freshSpans = parseAnsi(truncatedOutput);
    const freshContent = freshSpans.map((s) => s.content).join('');

    expect(phase2Content).toBe(freshContent);
    expect(phase2Spans.length).toBe(freshSpans.length);
  });

  it('test_incremental_ansi_handles_replacement', () => {
    // Simulate the vt100 emulator sending a full replacement (shorter string)
    // This exercises the full-reparse path triggered by output-replace events
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: 'line1\nline2\nline3' } },
    );

    const initialContent = result.current.map((s) => s.content).join('');
    expect(initialContent).toContain('line1');
    expect(initialContent).toContain('line3');

    // Replace with shorter content (simulating carriage return overwrite)
    rerender({ output: 'overwritten' });

    const replacedContent = result.current.map((s) => s.content).join('');
    expect(replacedContent).toBe('overwritten');
    // The old content should be gone
    expect(replacedContent).not.toContain('line1');
  });

  it('test_incremental_reparse_on_steady_state_truncation', () => {
    // Simulate the steady-state truncation scenario where the marker is already
    // present and repeated truncations produce same-length output with different
    // content. The hook must not return stale cached spans.
    const marker = '[Output truncated \u2014 showing last 500KB]\n';

    // Phase 1: first truncated output
    const tail1 = 'D'.repeat(200) + 'ENDING_ONE';
    const output1 = marker + tail1;
    const { result, rerender } = renderHook(
      ({ output }) => useIncrementalAnsi(output),
      { initialProps: { output: output1 } },
    );

    const phase1Content = result.current.map((s) => s.content).join('');
    expect(phase1Content).toContain('ENDING_ONE');

    // Phase 2: second truncated output — same marker prefix, same length,
    // but different tail content (simulates front-slice + new append)
    const tail2 = 'D'.repeat(200) + 'ENDING_TWO';
    const output2 = marker + tail2;
    // Ensure same length to exercise the same-length-different-suffix path
    expect(output2.length).toBe(output1.length);

    rerender({ output: output2 });

    const phase2Content = result.current.map((s) => s.content).join('');
    expect(phase2Content).toContain('ENDING_TWO');
    expect(phase2Content).not.toContain('ENDING_ONE');

    // Verify it matches a fresh parse
    const freshSpans = parseAnsi(output2);
    const freshContent = freshSpans.map((s) => s.content).join('');
    expect(phase2Content).toBe(freshContent);
  });
});
