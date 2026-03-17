import { describe, it, expect } from 'vitest';
import { parseAnsi, stripAnsi, isValidRgb } from '../lib/ansi';

describe('isValidRgb', () => {
  it('test_isValidRgb_accepts_valid', () => {
    expect(isValidRgb('255, 0, 128')).toBe(true);
    expect(isValidRgb('0,0,0')).toBe(true);
    expect(isValidRgb('255,255,255')).toBe(true);
    expect(isValidRgb('128, 64, 32')).toBe(true);
  });

  it('test_isValidRgb_rejects_invalid', () => {
    expect(isValidRgb('url(evil)')).toBe(false);
    expect(isValidRgb('')).toBe(false);
    expect(isValidRgb('red')).toBe(false);
    expect(isValidRgb('255, 0')).toBe(false);
    expect(isValidRgb('expression(alert(1))')).toBe(false);
    expect(isValidRgb('1,2,3,4')).toBe(false);
  });
});

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

  it('test_parseAnsi_256_color', () => {
    const result = parseAnsi('\x1b[38;5;196mred\x1b[0m');
    const redSpan = result.find((s) => s.content === 'red');
    expect(redSpan).toBeDefined();
    expect(redSpan!.fg).toBeDefined();
  });

  it('test_parseAnsi_truecolor', () => {
    const result = parseAnsi('\x1b[38;2;255;100;0morange\x1b[0m');
    const orangeSpan = result.find((s) => s.content === 'orange');
    expect(orangeSpan).toBeDefined();
    expect(orangeSpan!.fg).toBeDefined();
    expect(orangeSpan!.fg).toContain('255');
  });
});

describe('stripAnsi', () => {
  it('test_stripAnsi_removes_extended_colors', () => {
    expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red');
  });

  it('test_stripAnsi_removes_truecolor', () => {
    expect(stripAnsi('\x1b[38;2;255;100;0morange\x1b[0m')).toBe('orange');
  });
});
