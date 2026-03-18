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

  it('test_key_encoder_shift_arrow_keys', () => {
    // Shift+ArrowUp = \x1b[1;2A (modifier 2 = 1 + shift)
    expect(encodeKey(makeKey('ArrowUp', { shiftKey: true }))).toBe('\x1b[1;2A');
    expect(encodeKey(makeKey('ArrowDown', { shiftKey: true }))).toBe('\x1b[1;2B');
    expect(encodeKey(makeKey('ArrowRight', { shiftKey: true }))).toBe('\x1b[1;2C');
    expect(encodeKey(makeKey('ArrowLeft', { shiftKey: true }))).toBe('\x1b[1;2D');
  });

  it('test_key_encoder_ctrl_arrow_keys', () => {
    // Ctrl+ArrowUp = \x1b[1;5A (modifier 5 = 1 + ctrl)
    expect(encodeKey(makeKey('ArrowUp', { ctrlKey: true }))).toBe('\x1b[1;5A');
    expect(encodeKey(makeKey('ArrowDown', { ctrlKey: true }))).toBe('\x1b[1;5B');
    expect(encodeKey(makeKey('ArrowRight', { ctrlKey: true }))).toBe('\x1b[1;5C');
    expect(encodeKey(makeKey('ArrowLeft', { ctrlKey: true }))).toBe('\x1b[1;5D');
  });

  it('test_key_encoder_alt_arrow_keys', () => {
    // Alt+ArrowUp = \x1b[1;3A (modifier 3 = 1 + alt)
    expect(encodeKey(makeKey('ArrowUp', { altKey: true }))).toBe('\x1b[1;3A');
    expect(encodeKey(makeKey('ArrowDown', { altKey: true }))).toBe('\x1b[1;3B');
    expect(encodeKey(makeKey('ArrowRight', { altKey: true }))).toBe('\x1b[1;3C');
    expect(encodeKey(makeKey('ArrowLeft', { altKey: true }))).toBe('\x1b[1;3D');
  });

  it('test_key_encoder_shift_ctrl_arrow', () => {
    // Shift+Ctrl+ArrowUp = \x1b[1;6A (modifier 6 = 1 + shift + ctrl)
    expect(encodeKey(makeKey('ArrowUp', { shiftKey: true, ctrlKey: true }))).toBe('\x1b[1;6A');
  });

  it('test_key_encoder_modifier_navigation_keys', () => {
    // Shift+Home = \x1b[1;2H
    expect(encodeKey(makeKey('Home', { shiftKey: true }))).toBe('\x1b[1;2H');
    // Ctrl+End = \x1b[1;5F
    expect(encodeKey(makeKey('End', { ctrlKey: true }))).toBe('\x1b[1;5F');
    // Shift+PageUp = \x1b[5;2~
    expect(encodeKey(makeKey('PageUp', { shiftKey: true }))).toBe('\x1b[5;2~');
    // Shift+Delete = \x1b[3;2~
    expect(encodeKey(makeKey('Delete', { shiftKey: true }))).toBe('\x1b[3;2~');
  });

  it('test_key_encoder_modifier_function_keys', () => {
    // Shift+F1 = \x1b[1;2P
    expect(encodeKey(makeKey('F1', { shiftKey: true }))).toBe('\x1b[1;2P');
    // Ctrl+F5 = \x1b[15;5~
    expect(encodeKey(makeKey('F5', { ctrlKey: true }))).toBe('\x1b[15;5~');
    // Alt+F12 = \x1b[24;3~
    expect(encodeKey(makeKey('F12', { altKey: true }))).toBe('\x1b[24;3~');
  });
});
