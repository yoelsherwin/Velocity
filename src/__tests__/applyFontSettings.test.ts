import { describe, it, expect, beforeEach } from 'vitest';
import { applyFontSettings } from '../lib/font-settings';

describe('applyFontSettings', () => {
  beforeEach(() => {
    // Reset any inline styles on :root
    document.documentElement.style.removeProperty('--terminal-font-family');
    document.documentElement.style.removeProperty('--terminal-font-size');
    document.documentElement.style.removeProperty('--terminal-line-height');
  });

  it('test_apply_font_settings_sets_css_variables', () => {
    applyFontSettings({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      font_family: 'JetBrains Mono, monospace',
      font_size: 16,
      line_height: 1.6,
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--terminal-font-family')).toBe('JetBrains Mono, monospace');
    expect(root.style.getPropertyValue('--terminal-font-size')).toBe('16px');
    expect(root.style.getPropertyValue('--terminal-line-height')).toBe('1.6');
  });

  it('test_apply_font_settings_skips_undefined', () => {
    // Set some initial values
    const root = document.documentElement;
    root.style.setProperty('--terminal-font-family', 'Initial Font');
    root.style.setProperty('--terminal-font-size', '20px');
    root.style.setProperty('--terminal-line-height', '2.0');

    applyFontSettings({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      // No font fields
    });

    // CSS variables should NOT be overwritten
    expect(root.style.getPropertyValue('--terminal-font-family')).toBe('Initial Font');
    expect(root.style.getPropertyValue('--terminal-font-size')).toBe('20px');
    expect(root.style.getPropertyValue('--terminal-line-height')).toBe('2.0');
  });
});
