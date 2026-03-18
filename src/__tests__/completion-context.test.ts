import { describe, it, expect } from 'vitest';
import { getCompletionContext } from '../lib/completion-context';

describe('getCompletionContext', () => {
  it('test_context_command_position', () => {
    // Cursor in first word → type 'command'
    const ctx = getCompletionContext('gi', 2);
    expect(ctx.type).toBe('command');
    expect(ctx.partial).toBe('gi');
  });

  it('test_context_argument_position', () => {
    // Cursor in second word → type 'path'
    const ctx = getCompletionContext('git status', 10);
    expect(ctx.type).toBe('path');
    expect(ctx.partial).toBe('status');
  });

  it('test_context_after_pipe_is_command', () => {
    // Input "ls | gr", cursor at end → type 'command'
    const ctx = getCompletionContext('ls | gr', 7);
    expect(ctx.type).toBe('command');
    expect(ctx.partial).toBe('gr');
  });

  it('test_context_partial_extraction', () => {
    // Input "git comm", cursor at 8 → partial "comm", replaceStart 4
    const ctx = getCompletionContext('git comm', 8);
    expect(ctx.partial).toBe('comm');
    expect(ctx.replaceStart).toBe(4);
  });

  it('test_context_empty_input', () => {
    // Empty input → type 'command', partial ""
    const ctx = getCompletionContext('', 0);
    expect(ctx.type).toBe('command');
    expect(ctx.partial).toBe('');
  });

  it('test_context_whitespace_at_end', () => {
    // Input "git " cursor at 4 → type 'path', partial ""
    const ctx = getCompletionContext('git ', 4);
    expect(ctx.type).toBe('path');
    expect(ctx.partial).toBe('');
  });

  it('test_context_flag_position', () => {
    // Input "git -" cursor at 5 → type 'none' (don't complete flags for MVP)
    const ctx = getCompletionContext('git -', 5);
    expect(ctx.type).toBe('none');
  });

  it('test_context_quoted_string', () => {
    // Input "cat 'src/f" cursor at 10 → type 'path', partial "src/f"
    const ctx = getCompletionContext("cat 'src/f", 10);
    expect(ctx.type).toBe('path');
    expect(ctx.partial).toBe('src/f');
  });
});
