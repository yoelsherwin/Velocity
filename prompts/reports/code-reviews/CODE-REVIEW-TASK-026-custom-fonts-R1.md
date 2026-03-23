# Code Review: TASK-026 Custom Fonts + Size Configuration (R1)

**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-19
**Commit**: `c6e43ae` — feat: add custom font family, size, and line-height settings

---

## Summary

This task adds user-configurable font family, font size, and line height to the terminal. The implementation introduces CSS custom properties (`--terminal-font-family`, `--terminal-font-size`, `--terminal-line-height`) in `:root`, replaces all hardcoded font values in terminal-context CSS with `var()` references, extends the Rust `AppSettings` struct and validation, adds an Appearance section to the Settings modal with a live preview, loads/applies font settings at startup, and updates the block height estimator to read dynamic font metrics.

**Files changed**: 11 (494 additions, 19 deletions)

---

## Verdict: NEEDS CHANGES

One security finding (medium severity) and two minor issues require attention before merge.

---

## Findings

### MUST FIX

#### 1. [Security / Medium] CSS injection via `font_family` string

**File**: `src/lib/font-settings.ts` line 11, `src/components/SettingsModal.tsx` line 164

The `font_family` value is set directly into a CSS custom property and into an inline `fontFamily` style with no sanitization. A malicious or malformed value like:

```
"; } body { display: none } :root { --x: "
```

could break CSS parsing when the custom property is interpolated. While `setProperty` on `style` is safer than raw stylesheet injection (it sets an inline style, which limits the blast radius), the value is also placed directly into the font preview's `fontFamily` inline style, which React does sanitize to some extent.

However, on the Rust side there is no character-level validation. The `font_family` field only checks for empty/length, but does not reject characters like `{`, `}`, `;`, `<`, or `>`.

**Recommendation**: Add Rust-side validation to reject `font_family` values containing `{`, `}`, `;`, `<`, `>`, or `\` characters. A simple allowlist (alphanumeric, spaces, commas, quotes, hyphens, periods) would be more robust:

```rust
if family.chars().any(|c| matches!(c, '{' | '}' | ';' | '<' | '>' | '\\')) {
    return Err("Font family contains invalid characters".to_string());
}
```

---

### SHOULD FIX

#### 2. [Bug / Low] `applyFontSettings` uses truthiness check, silently ignores `font_size: 0`

**File**: `src/lib/font-settings.ts` lines 13-14

The checks `if (settings.font_size)` and `if (settings.line_height)` use JavaScript truthiness. A value of `0` would be silently ignored. While the Rust validation prevents `font_size < 8`, the TypeScript interface has no such constraint. If the frontend ever receives `font_size: 0` (e.g., from a corrupted settings file), it would be silently dropped instead of applied or flagged.

**Recommendation**: Use explicit `undefined`/`null` checks:
```typescript
if (settings.font_size != null) {
    root.style.setProperty('--terminal-font-size', `${settings.font_size}px`);
}
```

#### 3. [Consistency / Low] `estimateBlockHeight` calls `getComputedStyle` on every invocation

**File**: `src/hooks/useBlockVisibility.ts` lines 91-95

`getComputedStyle()` is called every time `estimateBlockHeight` is invoked. For large scrollback buffers this could be called hundreds of times during a single render cycle. The CSS variables change only when the user saves settings, so the computed values could be cached or passed as parameters.

**Recommendation**: This is acceptable for now since the function short-circuits at 50 lines and is only called for placeholder sizing. Consider caching if profiling shows it as a hot path.

---

### OBSERVATIONS (no action required)

#### 4. [Good] Backward compatibility for settings file

The `#[serde(default)]` annotations on the new fields ensure that existing settings files (without font fields) deserialize correctly. The test `test_settings_without_font_fields_deserialize` validates this. Well done.

#### 5. [Good] CSS variable defaults act as fallback

The CSS defaults in `:root` (`--terminal-font-family: 'Cascadia Code', ...`) serve as the base, and `applyFontSettings` only overwrites when values are explicitly set. This means a fresh install works out of the box with no saved font settings.

#### 6. [Good] Block height estimation updated

The `estimateBlockHeight` function now reads CSS custom properties instead of using hardcoded `14 * 1.4`, which keeps the scroll placeholder heights in sync with user font settings.

#### 7. [Good] `.terminal-grid-row` height updated

The `height: 1.4em` was correctly changed to `height: calc(var(--terminal-line-height) * 1em)`, keeping the alternate screen grid rows in sync.

#### 8. [Good] Input editor alignment preserved

The `.editor-textarea` and `.editor-highlight` both use the same CSS variables, so the transparent-textarea-over-highlighted-div technique continues to have pixel-perfect alignment.

#### 9. [Good] Comprehensive test coverage

- Rust: 7 new tests covering serialization, deserialization, and boundary validation for all three font fields.
- React: 4 new unit tests for the settings modal font section.
- `applyFontSettings`: 2 unit tests verifying CSS variable application and skip-when-undefined behavior.
- E2E: 1 persistence test verifying settings survive a page reload.

#### 10. [Nit] Some `.settings-input` and `.palette-input` still use hardcoded `font-size: 14px`

These are UI chrome elements (not terminal output), so they correctly do NOT use `var(--terminal-font-size)`. The terminal font size setting should only affect terminal content, not the settings dialog or command palette UI.

---

## Test Results

| Suite | Result |
|-------|--------|
| Frontend (Vitest) | 365/365 passed |
| Rust (cargo test) | 11/11 passed |

---

## Checklist

| Check | Status |
|-------|--------|
| CSS variables replace all hardcoded terminal fonts | PASS |
| Backward compat for settings without font fields | PASS |
| Input editor alignment preserved | PASS |
| Block height estimation updated for dynamic fonts | PASS |
| Rust validation for font size bounds | PASS |
| Rust validation for line height bounds | PASS |
| Rust validation for font family length | PASS |
| Font family character sanitization | FAIL - needs character validation |
| Settings load on startup | PASS |
| E2E persistence test | PASS (test exists) |
| No `unwrap()` on user-derived data | PASS |

---

## Required Changes for R2

1. Add character-level validation for `font_family` in Rust `validate_settings` to reject CSS-injection characters.
2. Change truthiness checks in `applyFontSettings` to explicit null checks (`!= null`).
