import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useGhostText } from '../hooks/useGhostText';

describe('useGhostText', () => {
  it('test_suggests_from_history', () => {
    const { result } = renderHook(() =>
      useGhostText('git co', ['git commit -m fix']),
    );
    expect(result.current.suggestion).toBe('mmit -m fix');
  });

  it('test_no_suggestion_for_empty_input', () => {
    const { result } = renderHook(() =>
      useGhostText('', ['ls']),
    );
    expect(result.current.suggestion).toBeNull();
  });

  it('test_no_suggestion_if_no_match', () => {
    const { result } = renderHook(() =>
      useGhostText('xyz', ['ls', 'pwd']),
    );
    expect(result.current.suggestion).toBeNull();
  });

  it('test_most_recent_match_preferred', () => {
    const { result } = renderHook(() =>
      useGhostText('git', ['git status', 'git commit']),
    );
    // Most recent is last in array ("git commit"), so suggestion is " commit"
    expect(result.current.suggestion).toBe(' commit');
  });

  it('test_no_suggestion_for_multiline', () => {
    const { result } = renderHook(() =>
      useGhostText('line1\nline2', ['line1 extra']),
    );
    expect(result.current.suggestion).toBeNull();
  });
});
