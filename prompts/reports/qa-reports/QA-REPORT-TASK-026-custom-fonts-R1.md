# QA Report: TASK-026 Custom Fonts + Size Config (R1)

**Date**: 2026-03-23
**Commits**: `c6e43ae` (feat), `30a14be` (fix)
**Scope**: Add `font_family`, `font_size`, `line_height` to settings. CSS custom properties replace hardcoded fonts. Settings modal gains Appearance section with live preview. `estimateBlockHeight` reads font metrics from CSS variables.

## 1. Test Results

### Frontend (Vitest)
- **34 test files, 365 tests** -- ALL PASSED
- TASK-026-specific tests:
  - `applyFontSettings.test.ts` -- 2 tests, all passed
    - `test_apply_font_settings_sets_css_variables`
    - `test_apply_font_settings_skips_undefined`
  - `SettingsModal.test.tsx` -- 12 tests (8 pre-existing + 4 new), all passed
    - `test_settings_modal_renders_font_section`
    - `test_settings_modal_saves_font_settings`
    - `test_font_preview_updates_on_input`
    - `test_settings_modal_loads_font_settings`

### Backend (cargo test)
- **113 unit tests, 11 integration tests** -- ALL PASSED (1 ignored, expected)
- TASK-026-specific Rust tests:
  - `test_settings_with_font_fields_deserialize` -- passed
  - `test_settings_without_font_fields_deserialize` -- passed (backward compat)
  - `test_font_size_validation_bounds` -- passed (7 rejected, 8 ok, 32 ok, 33 rejected)
  - `test_line_height_validation_bounds` -- passed (0.9 rejected, 1.0 ok, 3.0 ok, 3.1 rejected)
  - `test_font_family_validation_empty` -- passed
  - `test_font_family_validation_too_long` -- passed (201+ chars rejected)
  - `test_font_family_rejects_css_injection` -- passed (10 dangerous inputs all rejected)
  - `test_font_family_accepts_valid_names` -- passed (5 valid font stacks accepted)

### E2E (Playwright)
- `font-settings.spec.ts` -- 1 test defined (`test_e2e_font_settings_persist`)
- Not executed (requires running Tauri application); test is structurally sound -- sets font size to 18, saves, reloads, verifies CSS variable persisted

## 2. Test Coverage Analysis

### Well-Covered Areas
- **Rust validation**: boundary values for font_size (8-32), line_height (1.0-3.0), font_family (empty, too long, CSS injection)
- **Backward compatibility**: old settings JSON without font fields deserializes correctly via `#[serde(default)]`
- **Frontend CSS application**: `applyFontSettings` sets `:root` CSS variables correctly, skips undefined fields
- **Settings modal UI**: Appearance section renders, font inputs populated from loaded settings, save dispatches font values, preview updates live
- **Security (Rust)**: font_family character allowlist blocks semicolons, braces, angle brackets, parens, backslashes, quotes, colons, slashes, exclamation marks, at-signs

### Coverage Gaps
- **No test for clearing font fields** (reverting to defaults after previously saving custom values)
- **No test for `estimateBlockHeight`** reading dynamic font metrics from CSS variables (the function was updated but has no dedicated test)
- **No test for `applyFontSettings` being called on app startup** (in `TabManager.tsx` useEffect)
- **No test verifying CSS variables propagate to all terminal elements** (`.terminal-container`, `.block-output`, `.block-command`, `.editor-textarea`, `.editor-highlight`, `.terminal-grid`, `.terminal-grid-row`)

## 3. Code-Level Findings

### BUG-01 [Medium]: Cannot revert font settings to defaults without reload

**File**: `src/lib/font-settings.ts` (lines 8-19)

When a user clears the font fields in the settings modal (to revert to CSS defaults), the settings are saved with `undefined`/`null` values. However, `applyFontSettings` only sets CSS properties when values are non-null -- it never removes them. So previous inline styles on `:root` persist until page reload.

**Scenario**: User sets font size to 20, saves. Later clears the field and saves again. The terminal still renders at 20px until the app is restarted.

**Fix**: When a field is `null`/`undefined`, call `root.style.removeProperty(...)` to remove the inline override and let the CSS default from App.css take effect:

```typescript
if (settings.font_family != null) {
  root.style.setProperty('--terminal-font-family', settings.font_family);
} else {
  root.style.removeProperty('--terminal-font-family');
}
```

### BUG-02 [Low]: Font preview lineHeight uses string instead of number

**File**: `src/components/SettingsModal.tsx` (line 166)

```tsx
lineHeight: lineHeight || '1.4',
```

The `lineHeight` value is a string from the input field (e.g., `"1.6"`). When it's empty/falsy, `'1.4'` (string) is used. React inline styles accept either a number or string for `lineHeight`, so this works, but it's inconsistent with the `fontSize` handling on the same line which constructs `${fontSize}px`. Not a functional bug, but worth noting for consistency.

### OBSERVATION-01 [Info]: SettingsModal test for save does not assert font fields are `undefined`

**File**: `src/__tests__/SettingsModal.test.tsx` (lines 85-91)

The `test_SettingsModal_save_calls_IPC` test asserts the saved settings object but does not include `font_family`, `font_size`, or `line_height` keys. The assertion passes because those keys are `undefined`. This is fine but the test predates the font fields and was not updated to explicitly verify the font fields are absent.

### OBSERVATION-02 [Info]: `estimateBlockHeight` uses `getComputedStyle` correctly

**File**: `src/hooks/useBlockVisibility.ts` (lines 85-98)

The function was updated to read `--terminal-font-size` and `--terminal-line-height` from computed styles rather than using hardcoded values (14px, 1.4). This correctly picks up both CSS-default and user-customized values. The `parseFloat` calls handle the `px` suffix for font-size and plain numbers for line-height. Falls back to defaults (`14`, `1.4`) if parsing fails. This is well-implemented.

### OBSERVATION-03 [Info]: Atomic write protects settings file

The Rust `save_settings` function writes to a `.tmp` file then renames, preventing corruption if the app crashes mid-write. This is good practice for a file that now carries more fields.

## 4. Task Spec Compliance

| Acceptance Criterion | Status |
|---|---|
| All tests written and passing | PASS |
| `font_family`, `font_size`, `line_height` in AppSettings (Rust + TS) | PASS |
| Old settings files backward-compatible | PASS (tested) |
| CSS custom properties for all terminal font declarations | PASS |
| Settings modal "Appearance" section with font controls | PASS |
| Font changes apply immediately on save | PARTIAL -- applies on save but cannot revert to defaults without reload (BUG-01) |
| Font preview in settings shows sample terminal text | PASS |
| Valid font sizes: 8-32px | PASS |
| Valid line heights: 1.0-3.0 | PASS |
| Terminal grid row height adapts to custom line-height | PASS -- uses `calc(var(--terminal-line-height) * 1em)` |
| InputEditor textarea and highlight overlay aligned | PASS -- both use same CSS variables |
| `npm run test` passes | PASS (365/365) |
| `cargo test` passes | PASS (113+11 all pass) |

## 5. Manual Test Plan

### MT-01: Basic font size change
1. Open Settings (gear icon in tab bar)
2. In "Appearance" section, enter font size `20`
3. Observe preview text updates to 20px
4. Click Save
5. Verify terminal text (output blocks, input editor, block commands) is now 20px
6. **Expected**: All terminal text renders at 20px immediately

### MT-02: Font family change
1. Open Settings
2. Enter font family `"Fira Code", monospace`
3. Observe preview shows the new font (if installed)
4. Save
5. **Expected**: Terminal uses Fira Code; falls back to monospace if not installed

### MT-03: Line height change
1. Open Settings, set line height to `2.0`
2. Save
3. Run a command that produces multi-line output
4. **Expected**: Output lines are spaced wider. Terminal grid rows are also taller.

### MT-04: Backward compatibility
1. Manually edit `%LOCALAPPDATA%\Velocity\settings.json` to remove font fields
2. Restart app
3. **Expected**: App loads without error, uses CSS defaults (14px, 1.4 line-height, Cascadia Code)

### MT-05: Persistence across restart
1. Set font size to 18, save
2. Close and reopen the app
3. **Expected**: Font size 18 is applied on startup. Open settings to confirm field shows "18".

### MT-06: Revert to defaults (currently blocked by BUG-01)
1. Set font size to 20, save
2. Reopen settings, clear font size field, save
3. **Expected**: Font size reverts to 14px default
4. **Actual**: Font size stays at 20px until page reload

### MT-07: Invalid input rejection
1. Open settings, enter font size `5` (below min 8)
2. Save
3. **Expected**: Error message shown, settings not saved

### MT-08: CSS injection prevention
1. Open settings, enter font family `Consolas; background: red`
2. Save
3. **Expected**: Error from Rust validation, settings not saved

### MT-09: Input editor alignment
1. Set a non-default font (e.g., font family `Consolas`, size `18`)
2. Type a multi-word command in the input editor
3. **Expected**: Cursor position matches visible text (textarea and highlight overlay are aligned)

### MT-10: Multi-pane font consistency
1. Split into two panes
2. Change font settings
3. **Expected**: Both panes update immediately to the new font settings

## 6. Verdict

**CONDITIONAL PASS**

All tests pass. The implementation is solid: CSS custom properties correctly replace hardcoded fonts, backward compatibility is maintained via `serde(default)`, the settings UI has a live preview, security validation blocks CSS injection in font names, and `estimateBlockHeight` dynamically reads font metrics.

One medium-severity bug exists: **BUG-01** prevents users from reverting font settings to defaults without reloading the app. The fix is straightforward (add `removeProperty` calls in `applyFontSettings` for null/undefined values). This should be addressed before the feature is considered complete, as it affects the "font changes apply immediately on save" acceptance criterion.
