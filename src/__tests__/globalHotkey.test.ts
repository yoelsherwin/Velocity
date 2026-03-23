import { describe, it, expect } from 'vitest';
import { COMMANDS } from '../lib/commands';

describe('Global Hotkey - Command Palette', () => {
  it('test_window_toggle_in_palette', () => {
    const toggleCmd = COMMANDS.find((cmd) => cmd.id === 'window.toggle');
    expect(toggleCmd).toBeDefined();
    expect(toggleCmd!.title).toBe('Toggle Window');
    expect(toggleCmd!.category).toBe('Window');
    expect(toggleCmd!.shortcut).toBe('Ctrl+`');
  });

  it('test_window_toggle_has_quake_keywords', () => {
    const toggleCmd = COMMANDS.find((cmd) => cmd.id === 'window.toggle');
    expect(toggleCmd).toBeDefined();
    expect(toggleCmd!.keywords).toContain('quake');
    expect(toggleCmd!.keywords).toContain('summon');
    expect(toggleCmd!.keywords).toContain('hide');
  });
});
