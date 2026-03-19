import { AppSettings } from './types';

/**
 * Applies font settings from AppSettings to :root CSS custom properties.
 * Only sets properties that have explicit values; undefined fields are left unchanged
 * so the CSS defaults in App.css remain in effect.
 */
export function applyFontSettings(settings: AppSettings): void {
  const root = document.documentElement;
  if (settings.font_family) {
    root.style.setProperty('--terminal-font-family', settings.font_family);
  }
  if (settings.font_size) {
    root.style.setProperty('--terminal-font-size', `${settings.font_size}px`);
  }
  if (settings.line_height) {
    root.style.setProperty('--terminal-line-height', String(settings.line_height));
  }
}
