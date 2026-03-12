import { describe, it, expect } from 'vitest';
import { parseAnsi } from '../lib/ansi';

describe('parseAnsi', () => {
  it('test_parseAnsi_plain_text', () => {
    const result = parseAnsi('hello');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allContent = result.map((s) => s.content).join('');
    expect(allContent).toBe('hello');
    // Plain text should not have fg color
    result.forEach((span) => {
      expect(span.fg).toBeUndefined();
    });
  });

  it('test_parseAnsi_colored_text', () => {
    const result = parseAnsi('\x1b[31mred\x1b[0m');
    // Should have at least one span with content "red"
    const redSpan = result.find((s) => s.content === 'red');
    expect(redSpan).toBeDefined();
    // The red span should have an fg property
    expect(redSpan!.fg).toBeDefined();
  });
});
