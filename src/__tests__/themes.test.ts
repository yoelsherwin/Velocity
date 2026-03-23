import { describe, it, expect, beforeEach } from 'vitest';
import {
  THEMES,
  THEME_CSS_VARIABLES,
  DEFAULT_THEME_ID,
  getThemeById,
  isValidThemeId,
  applyTheme,
  applyThemeById,
} from '../lib/themes';

describe('themes', () => {
  beforeEach(() => {
    // Clear all theme CSS variables from :root
    for (const varName of THEME_CSS_VARIABLES) {
      document.documentElement.style.removeProperty(varName);
    }
  });

  it('test_apply_theme_sets_css_variables', () => {
    const theme = getThemeById('catppuccin-mocha');
    applyTheme(theme);

    const root = document.documentElement;
    for (const [property, value] of Object.entries(theme.colors)) {
      expect(root.style.getPropertyValue(property)).toBe(value);
    }
  });

  it('test_theme_data_has_all_required_variables', () => {
    for (const theme of THEMES) {
      for (const varName of THEME_CSS_VARIABLES) {
        expect(
          theme.colors[varName],
          `Theme "${theme.name}" is missing CSS variable "${varName}"`,
        ).toBeDefined();
        expect(
          theme.colors[varName].length,
          `Theme "${theme.name}" has empty value for "${varName}"`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('test_default_theme_is_catppuccin_mocha', () => {
    expect(DEFAULT_THEME_ID).toBe('catppuccin-mocha');
    const defaultTheme = getThemeById(DEFAULT_THEME_ID);
    expect(defaultTheme.id).toBe('catppuccin-mocha');
    expect(defaultTheme.name).toBe('Catppuccin Mocha');
  });

  it('test_invalid_theme_falls_back_to_default', () => {
    const theme = getThemeById('nonexistent-theme');
    expect(theme.id).toBe('catppuccin-mocha');
  });

  it('test_is_valid_theme_id', () => {
    expect(isValidThemeId('catppuccin-mocha')).toBe(true);
    expect(isValidThemeId('dracula')).toBe(true);
    expect(isValidThemeId('one-dark')).toBe(true);
    expect(isValidThemeId('solarized-dark')).toBe(true);
    expect(isValidThemeId('catppuccin-latte')).toBe(true);
    expect(isValidThemeId('nonexistent')).toBe(false);
    expect(isValidThemeId('')).toBe(false);
  });

  it('test_apply_theme_by_id', () => {
    applyThemeById('dracula');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-base')).toBe('#282a36');
  });

  it('test_apply_theme_by_invalid_id_uses_default', () => {
    applyThemeById('invalid-id');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-base')).toBe('#1e1e2e');
  });

  it('test_themes_have_unique_ids', () => {
    const ids = THEMES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('test_at_least_four_themes', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
  });

  it('test_switching_themes_overwrites_previous', () => {
    applyThemeById('catppuccin-mocha');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-base')).toBe('#1e1e2e');

    applyThemeById('dracula');
    expect(root.style.getPropertyValue('--bg-base')).toBe('#282a36');
  });
});
