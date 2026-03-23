import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSecretRedaction } from '../hooks/useSecretRedaction';
import { MASK_TEXT, REVEAL_DURATION_MS } from '../lib/secretRedaction';

describe('useSecretRedaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_detects_secrets_in_text', () => {
    const { result } = renderHook(() =>
      useSecretRedaction('API_KEY=mysecretvalue123'),
    );
    expect(result.current.hasSecrets).toBe(true);
    expect(result.current.segments.length).toBe(2);
    expect(result.current.segments[1].text).toBe(MASK_TEXT);
    expect(result.current.segments[1].isSecret).toBe(true);
  });

  it('test_no_secrets_in_plain_text', () => {
    const { result } = renderHook(() =>
      useSecretRedaction('just normal text'),
    );
    expect(result.current.hasSecrets).toBe(false);
    expect(result.current.segments.length).toBe(1);
    expect(result.current.segments[0].isSecret).toBe(false);
  });

  it('test_click_reveals_secret', () => {
    const { result } = renderHook(() =>
      useSecretRedaction('API_KEY=mysecretvalue123'),
    );
    const secretId = result.current.segments[1].secretId!;
    expect(result.current.revealedIds.has(secretId)).toBe(false);

    act(() => {
      result.current.revealSecret(secretId);
    });

    expect(result.current.revealedIds.has(secretId)).toBe(true);
  });

  it('test_reveal_auto_hides', () => {
    const { result } = renderHook(() =>
      useSecretRedaction('API_KEY=mysecretvalue123'),
    );
    const secretId = result.current.segments[1].secretId!;

    act(() => {
      result.current.revealSecret(secretId);
    });
    expect(result.current.revealedIds.has(secretId)).toBe(true);

    // Advance time past the reveal duration
    act(() => {
      vi.advanceTimersByTime(REVEAL_DURATION_MS + 100);
    });

    expect(result.current.revealedIds.has(secretId)).toBe(false);
  });

  it('test_reveal_resets_timer_on_repeated_click', () => {
    const { result } = renderHook(() =>
      useSecretRedaction('API_KEY=mysecretvalue123'),
    );
    const secretId = result.current.segments[1].secretId!;

    act(() => {
      result.current.revealSecret(secretId);
    });

    // Advance 2 seconds, then click again
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.revealedIds.has(secretId)).toBe(true);

    act(() => {
      result.current.revealSecret(secretId);
    });

    // After another 2 seconds (total 4s from first click, 2s from second), still revealed
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.revealedIds.has(secretId)).toBe(true);

    // After full duration from second click, hidden
    act(() => {
      vi.advanceTimersByTime(REVEAL_DURATION_MS);
    });
    expect(result.current.revealedIds.has(secretId)).toBe(false);
  });

  it('test_strips_ansi_before_detection', () => {
    // ANSI-wrapped secret
    const text = '\x1b[31mAPI_KEY=mysecretvalue123\x1b[0m';
    const { result } = renderHook(() => useSecretRedaction(text));
    expect(result.current.hasSecrets).toBe(true);
  });

  it('test_memoizes_detection', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSecretRedaction(text),
      { initialProps: { text: 'API_KEY=secret' } },
    );
    const firstSegments = result.current.segments;

    // Rerender with same text — segments reference should be stable
    rerender({ text: 'API_KEY=secret' });
    expect(result.current.segments).toBe(firstSegments);
  });
});
