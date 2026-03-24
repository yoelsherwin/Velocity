import { AppSettings, BackgroundEffect } from './types';
import { setWindowEffect } from './settings';

/**
 * Converts a hex color like "#1e1e2e" to an rgba() string with the given opacity.
 */
function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Applies background transparency CSS variables based on the current settings.
 * When the effect is not "none", --bg-base is converted to an rgba() value
 * using the configured opacity so content behind the window is visible.
 */
export function applyBackgroundEffect(settings: AppSettings): void {
  const effect: BackgroundEffect = settings.background_effect ?? 'none';
  const opacity = settings.background_opacity ?? 1.0;
  const root = document.documentElement;

  if (effect !== 'none') {
    // Read the current --bg-base, which is a hex value set by the theme
    const currentBg =
      getComputedStyle(root).getPropertyValue('--bg-base').trim() || '#1e1e2e';
    root.style.setProperty('--bg-base', hexToRgba(currentBg, opacity));
  } else {
    // Remove inline override so the theme's default hex value takes effect
    root.style.removeProperty('--bg-base');
  }

  // Tell Rust to apply the window-level effect
  setWindowEffect(effect, opacity).catch((err) => {
    console.warn('Failed to set window effect:', err);
  });
}

export { hexToRgba };
