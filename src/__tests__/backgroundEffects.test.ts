import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the settings IPC
vi.mock('../lib/settings', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  setWindowEffect: vi.fn().mockResolvedValue(undefined),
}));

import { hexToRgba, applyBackgroundEffect } from '../lib/background-effects';
import { setWindowEffect } from '../lib/settings';
import { AppSettings } from '../lib/types';

describe('hexToRgba', () => {
  it('converts hex to rgba with full opacity', () => {
    expect(hexToRgba('#1e1e2e', 1.0)).toBe('rgba(30, 30, 46, 1)');
  });

  it('converts hex to rgba with partial opacity', () => {
    expect(hexToRgba('#1e1e2e', 0.7)).toBe('rgba(30, 30, 46, 0.7)');
  });

  it('handles hex without hash', () => {
    expect(hexToRgba('1e1e2e', 0.5)).toBe('rgba(30, 30, 46, 0.5)');
  });

  it('handles white color', () => {
    expect(hexToRgba('#ffffff', 0.8)).toBe('rgba(255, 255, 255, 0.8)');
  });
});

describe('applyBackgroundEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset inline styles
    document.documentElement.style.removeProperty('--bg-base');
  });

  it('test_css_vars_updated_for_transparent', () => {
    // Set a theme bg-base in style
    document.documentElement.style.setProperty('--bg-base', '#1e1e2e');

    const settings: AppSettings = {
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      background_effect: 'transparent',
      background_opacity: 0.7,
    };
    applyBackgroundEffect(settings);

    const bgBase = document.documentElement.style.getPropertyValue('--bg-base');
    expect(bgBase).toContain('rgba');
    expect(bgBase).toContain('0.7');
  });

  it('removes bg-base override for none effect', () => {
    document.documentElement.style.setProperty('--bg-base', 'rgba(30, 30, 46, 0.5)');

    const settings: AppSettings = {
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      background_effect: 'none',
    };
    applyBackgroundEffect(settings);

    const bgBase = document.documentElement.style.getPropertyValue('--bg-base');
    expect(bgBase).toBe('');
  });

  it('calls setWindowEffect IPC with correct params', () => {
    const settings: AppSettings = {
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      background_effect: 'acrylic',
      background_opacity: 0.85,
    };
    applyBackgroundEffect(settings);

    expect(setWindowEffect).toHaveBeenCalledWith('acrylic', 0.85);
  });

  it('defaults to none/1.0 when fields are undefined', () => {
    const settings: AppSettings = {
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
    };
    applyBackgroundEffect(settings);

    expect(setWindowEffect).toHaveBeenCalledWith('none', 1.0);
  });
});
