# Task 026: Custom Fonts + Size Configuration (P1-U2)

## Context

Velocity's terminal font is hardcoded to `'Cascadia Code', 'Consolas', 'Courier New', monospace` at 14px with 1.4 line-height across all terminal areas. Users can't change the font family, size, or line-height. This task adds configurable terminal font settings.

### What exists now

- **App.css**: All fonts hardcoded. Monospace font repeated in ~8 CSS rules (`.terminal-container`, `.block-output`, `.block-command`, `.editor-textarea`, `.editor-highlight`, `.terminal-grid`, `.search-input`, `.palette-input`). No CSS variables used for fonts.
- **Settings types** (`src/lib/types.ts`): `AppSettings` has only LLM fields (`llm_provider`, `api_key`, `model`, `azure_endpoint`).
- **Rust settings** (`src-tauri/src/settings/mod.rs`): Same — LLM-only `AppSettings` struct.
- **SettingsModal.tsx**: Only LLM provider configuration UI.
- **TerminalGrid.tsx**: Inherits font from `.terminal-grid` CSS class. Row height uses `1.4em`.
- **InputEditor.tsx**: Textarea + highlight overlay must have identical font metrics.

## Requirements

### Overview

Add `font_family`, `font_size`, and `line_height` to the settings system. Apply them globally via CSS custom properties. Add UI controls in the Settings modal.

### Backend (Rust)

#### 1. Extend `AppSettings` (`src-tauri/src/settings/mod.rs`)

Add new optional fields with sensible defaults:

```rust
pub struct AppSettings {
    pub llm_provider: String,
    pub api_key: String,
    pub model: String,
    pub azure_endpoint: Option<String>,
    // New font settings
    pub font_family: Option<String>,   // Default: None (uses CSS default)
    pub font_size: Option<u16>,        // Default: None (uses 14px)
    pub line_height: Option<f32>,      // Default: None (uses 1.4)
}
```

Use `Option` so existing settings files without font fields still deserialize correctly (serde default). When `None`, the frontend uses its CSS defaults.

**Defaults**: `font_family: None`, `font_size: None`, `line_height: None`.

#### 2. Add validation (`src-tauri/src/settings/mod.rs`)

In `validate_settings()`:
- `font_size`: Must be between 8 and 32 (inclusive) if provided.
- `line_height`: Must be between 1.0 and 3.0 if provided.
- `font_family`: Must be non-empty if provided. Max 200 chars (prevent abuse). No validation of whether the font exists — the browser handles fallback.

### Frontend (React/TypeScript)

#### 3. Update `AppSettings` type (`src/lib/types.ts`)

```typescript
export interface AppSettings {
  llm_provider: LlmProviderId;
  api_key: string;
  model: string;
  azure_endpoint?: string;
  font_family?: string;
  font_size?: number;
  line_height?: number;
}
```

#### 4. Convert hardcoded CSS to CSS custom properties (`src/App.css`)

Replace all hardcoded terminal font declarations with CSS variables:

```css
:root {
  --terminal-font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  --terminal-font-size: 14px;
  --terminal-line-height: 1.4;
}
```

Then update all rules that use the monospace font to reference these variables:
- `.terminal-container` → `font-family: var(--terminal-font-family); font-size: var(--terminal-font-size); line-height: var(--terminal-line-height);`
- `.block-output` → same variables
- `.block-command` → same variables
- `.editor-textarea, .editor-highlight` → same variables
- `.terminal-grid` → same variables
- `.terminal-grid-row` → `height: calc(var(--terminal-line-height) * 1em);`
- `.search-input` → `font-family: var(--terminal-font-family);` (keep smaller font-size: 13px)
- `.palette-input` → `font-family: var(--terminal-font-family);`

#### 5. Apply settings to CSS variables on load

Create a utility function or hook that applies font settings to the `:root` CSS variables:

```typescript
function applyFontSettings(settings: AppSettings) {
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
```

Call this:
1. On app startup (in `App.tsx` or `TabManager.tsx`) after loading settings
2. After saving settings in `SettingsModal.tsx` (immediate preview)

#### 6. Add font settings UI to SettingsModal.tsx

Add a new "Appearance" section above the LLM section:

**Font Family**: Text input with placeholder showing the default. Let users type any font name or comma-separated stack (e.g., `"JetBrains Mono", "Fira Code", monospace`).

**Font Size**: Number input, min=8, max=32, step=1. Show current default (14).

**Line Height**: Number input, min=1.0, max=3.0, step=0.1. Show current default (1.4).

**Preview**: Show a small preview box below the font settings that renders sample text (e.g., `$ echo "Hello, World!"`) using the current font settings, so users can see the effect before saving.

#### 7. Apply on save

When SettingsModal saves, call `applyFontSettings()` immediately so the change is visible without restarting.

### IPC Contract

No new IPC commands. The existing `get_settings` and `save_app_settings` commands handle the extended `AppSettings` struct via serde.

### Performance Considerations

- CSS variables are applied once and cascade automatically — no per-component overhead.
- Font changes trigger a browser reflow, but this only happens on settings save — not during normal use.
- The `estimateBlockHeight` function in `useBlockVisibility.ts` uses hardcoded `lineHeight = 19.6` (14px * 1.4). This should be updated to read from the CSS variable or accept the line-height as a parameter.

## Tests (Write These FIRST)

### Rust Unit Tests

- [ ] `test_settings_with_font_fields_deserialize`: JSON with font fields deserializes correctly.
- [ ] `test_settings_without_font_fields_deserialize`: Old JSON without font fields still works (backward compat).
- [ ] `test_font_size_validation_bounds`: Size 7 rejected, 8 accepted, 32 accepted, 33 rejected.
- [ ] `test_line_height_validation_bounds`: 0.9 rejected, 1.0 accepted, 3.0 accepted, 3.1 rejected.
- [ ] `test_font_family_validation_empty`: Empty string rejected.
- [ ] `test_font_family_validation_too_long`: 201+ char string rejected.

### Frontend Tests (Vitest)

- [ ] `test_apply_font_settings_sets_css_variables`: Call `applyFontSettings` with custom values, verify CSS variables are set on `:root`.
- [ ] `test_apply_font_settings_skips_undefined`: Call with no font fields, verify CSS variables are NOT overwritten.
- [ ] `test_settings_modal_renders_font_section`: Verify "Appearance" section with font inputs appears.
- [ ] `test_settings_modal_saves_font_settings`: Fill in font fields, click Save, verify the save function is called with font values.
- [ ] `test_font_preview_updates_on_input`: Type in font name, verify preview updates.

### E2E Tests (Playwright)

- [ ] `test_e2e_font_settings_persist`: Open settings, change font size, save, reload app, verify setting persisted.

### Test type requirements

| Test Type | This Task |
|-----------|-----------|
| Rust Unit | **REQUIRED** — settings validation |
| Frontend (Vitest) | **REQUIRED** — CSS variable application, settings UI |
| E2E (Playwright) | **REQUIRED** — persistence and visual change |

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] `font_family`, `font_size`, `line_height` fields in AppSettings (both Rust and TypeScript)
- [ ] Old settings files without font fields still load correctly (backward compat)
- [ ] CSS custom properties used for all terminal font declarations
- [ ] Settings modal has "Appearance" section with font controls
- [ ] Font changes apply immediately on save (no restart needed)
- [ ] Font preview in settings shows sample terminal text
- [ ] Valid font sizes: 8-32px
- [ ] Valid line heights: 1.0-3.0
- [ ] Terminal grid row height adapts to custom line-height
- [ ] InputEditor textarea and highlight overlay remain aligned with custom fonts
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `feat: add custom font family, size, and line-height settings`

## Files to Read First

- `src/App.css` — All font declarations to convert to CSS variables
- `src-tauri/src/settings/mod.rs` — Settings struct, validation, storage
- `src/lib/types.ts` — AppSettings TypeScript type
- `src/components/SettingsModal.tsx` — Settings UI to extend
- `src/hooks/useBlockVisibility.ts` — `estimateBlockHeight` uses hardcoded line-height
- `src/components/TerminalGrid.tsx` — Grid row height depends on line-height
- `src/components/editor/InputEditor.tsx` — Textarea/highlight alignment
