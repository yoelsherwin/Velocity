# Task 031: Custom Themes (P1-U1)

## Context

Velocity's color scheme is hardcoded Catppuccin Mocha throughout App.css. Users can't change the theme. This task converts all colors to CSS variables and adds a theme selector with several built-in themes.

### What exists now

- **App.css** (~950+ lines): All colors hardcoded. Key colors: bg `#1e1e2e`, surface `#313244`, text `#cdd6f4`, blue `#89b4fa`, green `#a6e3a1`, red `#f38ba8`, yellow `#f9e2af`, muted `#585b70`.
- **Settings system**: Already has `font_family`, `font_size`, `line_height` (from TASK-026). Settings stored in JSON, loaded on startup.
- **SettingsModal.tsx**: Has "Appearance" section for fonts. Can extend with theme picker.
- **CSS variables**: Already has `--terminal-font-family`, `--terminal-font-size`, `--terminal-line-height` from TASK-026.

## Requirements

### Frontend + minimal Rust changes (extend settings).

#### 1. Define theme color variables

Convert ALL hardcoded colors in App.css to CSS custom properties in `:root`:

```css
:root {
  /* Base */
  --bg-base: #1e1e2e;
  --bg-surface: #313244;
  --bg-overlay: #45475a;
  --text-primary: #cdd6f4;
  --text-secondary: #a6adc8;
  --text-muted: #585b70;
  /* Accent */
  --accent-blue: #89b4fa;
  --accent-green: #a6e3a1;
  --accent-red: #f38ba8;
  --accent-yellow: #f9e2af;
  --accent-peach: #fab387;
  /* Syntax */
  --syntax-command: #89b4fa;
  --syntax-flag: #f9e2af;
  --syntax-string: #a6e3a1;
  --syntax-pipe: #f38ba8;
  --syntax-argument: #cdd6f4;
  /* UI */
  --border-color: #313244;
  --scrollbar-thumb: #585b70;
  --selection-bg: rgba(137, 180, 250, 0.3);
}
```

Replace EVERY hardcoded color in App.css with the appropriate variable.

#### 2. Built-in themes (`src/lib/themes.ts`)

Define 4-5 built-in themes:

```typescript
interface Theme {
  id: string;
  name: string;
  colors: Record<string, string>;  // CSS variable name → value
}

const THEMES: Theme[] = [
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', colors: { '--bg-base': '#1e1e2e', ... } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', colors: { '--bg-base': '#eff1f5', ... } },
  { id: 'dracula', name: 'Dracula', colors: { '--bg-base': '#282a36', ... } },
  { id: 'one-dark', name: 'One Dark', colors: { '--bg-base': '#282c34', ... } },
  { id: 'solarized-dark', name: 'Solarized Dark', colors: { '--bg-base': '#002b36', ... } },
];
```

#### 3. Theme application

```typescript
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(theme.colors)) {
    root.style.setProperty(property, value);
  }
}
```

Call on startup and on settings save.

#### 4. Extend settings

Add `theme: string` to AppSettings (Rust + TypeScript). Default: `'catppuccin-mocha'`. Validate theme ID against known theme list.

#### 5. Theme picker in SettingsModal

Add a theme dropdown in the "Appearance" section (above font settings). Show theme name. Apply preview on selection (before save).

#### 6. Register in command palette

Add `theme.select` command that opens settings to the appearance section. Or add individual theme commands (`theme.catppuccin-mocha`, `theme.dracula`, etc.) for quick switching.

## Tests

- [ ] `test_apply_theme_sets_css_variables`: Apply a theme, verify all CSS variables set.
- [ ] `test_theme_data_has_all_required_variables`: Each built-in theme defines all required CSS variable keys.
- [ ] `test_settings_modal_renders_theme_picker`: Theme dropdown appears in settings.
- [ ] `test_theme_setting_persists`: Save theme, reload, verify correct theme applied.
- [ ] `test_default_theme_is_catppuccin_mocha`: No setting → Catppuccin Mocha.
- [ ] `test_invalid_theme_falls_back_to_default`: Unknown theme ID → falls back to default.

### Rust Tests
- [ ] `test_settings_with_theme_deserialize`: Theme field deserializes.
- [ ] `test_settings_without_theme_backward_compat`: Old settings without theme field still load.
- [ ] `test_theme_validation`: Invalid theme ID rejected.

## Acceptance Criteria
- [ ] All hardcoded colors in App.css replaced with CSS variables
- [ ] 4-5 built-in themes available
- [ ] Theme picker in Settings modal
- [ ] Theme applies immediately on selection
- [ ] Theme persists across restarts
- [ ] Backward compatible (old settings files work)
- [ ] All tests pass
- [ ] Commit: `feat: add custom themes with built-in theme library`

## Files to Read First
- `src/App.css` — ALL color values to convert
- `src-tauri/src/settings/mod.rs` — Settings struct to extend
- `src/lib/types.ts` — TypeScript settings type
- `src/components/SettingsModal.tsx` — UI to extend
- `src/lib/font-settings.ts` — Pattern for applying CSS variables
- `src/components/layout/TabManager.tsx` — Startup settings application
