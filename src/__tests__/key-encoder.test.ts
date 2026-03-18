import { describe, it, expect } from 'vitest';
import { encodeKey } from '../lib/key-encoder';

// Helper to create a minimal KeyboardEvent-like object
function makeKey(
  key: string,
  opts: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
  } as KeyboardEvent;
}

describe('encodeKey', () => {
  it('test_key_encoder_regular_chars', () => {
    expect(encodeKey(makeKey('a'))).toBe('a');
    expect(encodeKey(makeKey('Z'))).toBe('Z');
    expect(encodeKey(makeKey('1'))).toBe('1');
    expect(encodeKey(makeKey(' '))).toBe(' ');
    expect(encodeKey(makeKey('/'))).toBe('/');
  });

  it('test_key_encoder_enter', () => {
    expect(encodeKey(makeKey('Enter'))).toBe('\r');
  });

  it('test_key_encoder_backspace', () => {
    expect(encodeKey(makeKey('Backspace'))).toBe('\x7f');
  });

  it('test_key_encoder_tab', () => {
    expect(encodeKey(makeKey('Tab'))).toBe('\t');
  });

  it('test_key_encoder_escape', () => {
    expect(encodeKey(makeKey('Escape'))).toBe('\x1b');
  });

  it('test_key_encoder_arrow_keys', () => {
    expect(encodeKey(makeKey('ArrowUp'))).toBe('\x1b[A');
    expect(encodeKey(makeKey('ArrowDown'))).toBe('\x1b[B');
    expect(encodeKey(makeKey('ArrowRight'))).toBe('\x1b[C');
    expect(encodeKey(makeKey('ArrowLeft'))).toBe('\x1b[D');
  });

  it('test_key_encoder_arrow_keys_application_mode', () => {
    expect(encodeKey(makeKey('ArrowUp'), true)).toBe('\x1bOA');
    expect(encodeKey(makeKey('ArrowDown'), true)).toBe('\x1bOB');
    expect(encodeKey(makeKey('ArrowRight'), true)).toBe('\x1bOC');
    expect(encodeKey(makeKey('ArrowLeft'), true)).toBe('\x1bOD');
  });

  it('test_key_encoder_ctrl_c', () => {
    expect(encodeKey(makeKey('c', { ctrlKey: true }))).toBe('\x03');
  });

  it('test_key_encoder_ctrl_d', () => {
    expect(encodeKey(makeKey('d', { ctrlKey: true }))).toBe('\x04');
  });

  it('test_key_encoder_ctrl_z', () => {
    expect(encodeKey(makeKey('z', { ctrlKey: true }))).toBe('\x1a');
  });

  it('test_key_encoder_ctrl_a', () => {
    expect(encodeKey(makeKey('a', { ctrlKey: true }))).toBe('\x01');
  });

  it('test_key_encoder_navigation_keys', () => {
    expect(encodeKey(makeKey('Home'))).toBe('\x1b[H');
    expect(encodeKey(makeKey('End'))).toBe('\x1b[F');
    expect(encodeKey(makeKey('PageUp'))).toBe('\x1b[5~');
    expect(encodeKey(makeKey('PageDown'))).toBe('\x1b[6~');
    expect(encodeKey(makeKey('Delete'))).toBe('\x1b[3~');
    expect(encodeKey(makeKey('Insert'))).toBe('\x1b[2~');
  });

  it('test_key_encoder_function_keys', () => {
    expect(encodeKey(makeKey('F1'))).toBe('\x1bOP');
    expect(encodeKey(makeKey('F2'))).toBe('\x1bOQ');
    expect(encodeKey(makeKey('F12'))).toBe('\x1b[24~');
  });

  it('test_key_encoder_alt_key', () => {
    expect(encodeKey(makeKey('x', { altKey: true }))).toBe('\x1bx');
  });

  it('test_key_encoder_ignores_modifier_only', () => {
    expect(encodeKey(makeKey('Shift'))).toBeNull();
    expect(encodeKey(makeKey('Control'))).toBeNull();
    expect(encodeKey(makeKey('Alt'))).toBeNull();
    expect(encodeKey(makeKey('Meta'))).toBeNull();
  });
});
