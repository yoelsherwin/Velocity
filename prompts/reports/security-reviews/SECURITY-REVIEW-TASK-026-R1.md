# Security Review: TASK-026 Custom Fonts + Size Config (R1)

**Reviewer**: Security Agent
**Date**: 2026-03-23
**Commit range**: `9a5fd58..30a14be`
**Verdict**: PASS (with minor observations)

---

## Scope

TASK-026 adds user-configurable `font_family`, `font_size`, and `line_height` fields to `AppSettings`. The values flow:

1. User input (SettingsModal form) -> React state
2. React state -> Tauri IPC `save_app_settings` command
3. Rust `validate_settings()` -> JSON file on disk
4. On load: JSON file -> Rust `load_settings()` -> Tauri IPC -> React -> `applyFontSettings()` -> CSS custom properties / inline styles

The primary concern is CSS injection via `font_family`, since it reaches `document.documentElement.style.setProperty()` and the inline `style` object of the font preview element.

---

## Findings

### F-01: font_family character allowlist (PASS)

**File**: `src-tauri/src/settings/mod.rs` line 116

```rust
if !family.chars().all(|c| c.is_alphanumeric() || " ,'-._".contains(c)) {
    return Err("Font family contains invalid characters".to_string());
}
```

The allowlist permits only: `[a-zA-Z0-9]`, space, comma, single-quote, hyphen, period, underscore.

This effectively blocks all known CSS injection vectors:
- Semicolons (`;`) -- cannot break out of property
- Curly braces (`{`, `}`) -- cannot inject new rules
- Colons (`:`) -- cannot add new property declarations
- Parentheses (`(`, `)`) -- cannot call `url()` or `expression()`
- Backslash (`\`) -- cannot use CSS escape sequences
- Double-quote (`"`) -- cannot break out of JSON or attribute contexts
- Angle brackets (`<`, `>`) -- cannot inject HTML/script tags
- At-sign (`@`) -- cannot inject `@import` or `@charset`
- Exclamation mark (`!`) -- cannot use `!important`
- Forward slash (`/`) -- cannot use `url()` paths or comments

The test suite (`test_font_family_rejects_css_injection`) confirms rejection of 10 representative attack payloads. This is thorough.

**Assessment**: The allowlist is restrictive and correct. The only special characters allowed (space, comma, single-quote, hyphen, period, underscore) are all legitimate in CSS font-family names and none can be used to escape the property value context.

### F-02: font_family length limit (PASS)

**File**: `src-tauri/src/settings/mod.rs` line 113-114

Maximum 200 characters. Prevents abuse via extremely long values that could cause rendering issues or memory pressure.

### F-03: font_size numeric type safety (PASS)

**File**: `src-tauri/src/settings/mod.rs` line 13, 97-101

- Rust type: `Option<u16>` -- unsigned integer, cannot hold negative or fractional values
- Range: 8-32 inclusive
- Frontend: `type="number"` input with `min=8 max=32 step=1`
- CSS application: `${settings.font_size}px` -- template literal on a number, no injection possible

A `u16` deserialized from JSON cannot contain strings or special characters. The value flows into CSS as `"Npx"` where N is guaranteed to be 8-32. No injection vector exists.

### F-04: line_height numeric type safety (PASS)

**File**: `src-tauri/src/settings/mod.rs` line 15, 103-107

- Rust type: `Option<f32>` -- floating point, only numeric values
- Range: 1.0-3.0 inclusive
- CSS application: `String(settings.line_height)` -- coerces number to string

An `f32` deserialized from JSON is always a finite number after range validation. `String()` on a JS number produces only digits, minus sign, and decimal point. No injection vector exists.

**Note**: There is a theoretical edge case with `NaN` or `Infinity` from JSON deserialization, but serde_json rejects both `NaN` and `Infinity` as invalid JSON, so this is not exploitable.

### F-05: Validation is enforced server-side on save (PASS)

**File**: `src-tauri/src/commands/mod.rs` lines 116-120

```rust
#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    settings::validate_settings(&settings)?;
    settings::save_settings(&settings)
}
```

Validation runs in Rust before any write to disk. A malicious frontend cannot bypass this because the Tauri command boundary enforces the check.

### F-06: No validation on load path (OBSERVATION -- LOW RISK)

**File**: `src-tauri/src/commands/mod.rs` lines 111-114

```rust
#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    settings::load_settings()
}
```

`load_settings()` deserializes from the JSON file without calling `validate_settings()`. If a user (or another process) manually edits `%LOCALAPPDATA%/Velocity/settings.json` to contain a malicious `font_family` value, it would be loaded and passed to the frontend without validation.

**Risk level**: LOW. The attack requires local file system access to the user's own app data directory. An attacker with that level of access already has broader compromise options. Additionally, the frontend uses `setProperty()` on a CSS custom property, which is inherently scoped -- it cannot break out of the property value context even with malicious characters (unlike raw string concatenation into a `<style>` block).

**Recommendation**: Consider adding a `validate_settings()` call in `load_settings()` or `get_settings()`, or at minimum sanitize/ignore invalid font values in `applyFontSettings()` on the frontend. This would provide defense-in-depth.

### F-07: Font preview inline style uses React style object (PASS)

**File**: `src/components/SettingsModal.tsx` lines 163-165

```tsx
fontFamily: fontFamily || "'Cascadia Code', 'Consolas', 'Courier New', monospace",
fontSize: fontSize ? `${fontSize}px` : '14px',
lineHeight: lineHeight || '1.4',
```

The font preview in the modal uses a React `style` object, not raw HTML. React's style handling assigns these as individual DOM style properties (equivalent to `element.style.fontFamily = value`), which cannot break out of the property value context. This is safe even for unvalidated values, since DOM style property assignment does not parse CSS syntax.

**Note**: The `fontFamily` value here comes directly from the React state (user input before save), so it has NOT yet been validated by Rust. However, as stated, the DOM `style.fontFamily` assignment is inherently safe against injection.

### F-08: CSS custom property application (PASS)

**File**: `src/lib/font-settings.ts` lines 10-18

```ts
root.style.setProperty('--terminal-font-family', settings.font_family);
root.style.setProperty('--terminal-font-size', `${settings.font_size}px`);
root.style.setProperty('--terminal-line-height', String(settings.line_height));
```

`CSSStyleDeclaration.setProperty()` sets a single property value. The property name is hardcoded (not user-controlled). The value is treated as a CSS value for that specific property -- it cannot inject new properties, rules, or selectors. This is fundamentally different from (and safer than) string-concatenating into a `<style>` element's `textContent`.

### F-09: Settings file atomic write (PASS)

**File**: `src-tauri/src/settings/mod.rs` lines 60-69

Settings are written atomically (write to `.tmp`, then rename). This prevents corruption from partial writes on crash, which could otherwise produce invalid JSON that might confuse the deserializer.

### F-10: No `unwrap()` on user-derived data (PASS)

All user-derived data in the settings module uses `map_err()` with descriptive error messages. No `unwrap()` calls on user input, consistent with the project's security rules.

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F-01 | font_family character allowlist | -- | PASS |
| F-02 | font_family length limit | -- | PASS |
| F-03 | font_size numeric safety | -- | PASS |
| F-04 | line_height numeric safety | -- | PASS |
| F-05 | Server-side validation on save | -- | PASS |
| F-06 | No validation on load path | LOW | OBSERVATION |
| F-07 | Font preview inline style | -- | PASS |
| F-08 | CSS custom property application | -- | PASS |
| F-09 | Atomic file write | -- | PASS |
| F-10 | No unwrap on user data | -- | PASS |

---

## Verdict: PASS

The implementation is secure. The Rust-side character allowlist for `font_family` is strict and correct, blocking all CSS injection vectors. Numeric types (`u16`, `f32`) with range validation make `font_size` and `line_height` injection-proof. The frontend uses safe DOM APIs (`style.setProperty`, React style objects) that cannot be exploited even with unexpected values.

The one minor observation (F-06) is that `load_settings` does not re-validate, meaning a hand-edited settings file could bypass the allowlist. The practical risk is negligible since the DOM APIs used are inherently injection-safe, but adding validation on load would be good defense-in-depth.
