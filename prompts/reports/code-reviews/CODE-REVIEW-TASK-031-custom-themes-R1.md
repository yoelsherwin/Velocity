# Code Review: TASK-031 Custom Themes (R1)

**Reviewer**: Code Review Agent
**Commit**: `f836755` — feat: add custom themes with built-in theme library
**Date**: 2026-03-23
**Verdict**: **NEEDS CHANGES**

---

## Summary

This task introduces a theming system: 5 built-in themes (Catppuccin Mocha, Catppuccin Latte, Dracula, One Dark, Solarized Dark) applied via CSS custom properties. Every hardcoded color in `App.css` is replaced with a `var(--...)` reference. Themes are defined in `src/lib/themes.ts`, selectable from the settings modal and command palette, validated on the Rust side, and persisted in settings.

**Files changed**: 9 (plus 2 new files: `src/lib/themes.ts`, `src/__tests__/themes.test.ts`)

---

## Checklist

| Area | Status | Notes |
|------|--------|-------|
| Hardcoded colors replaced | PASS (with caveats) | See finding F-01 |
| All themes define all CSS variables | PASS | Test enforces this; verified manually |
| Theme application via CSS variables | PASS | `applyTheme` sets on `:root` |
| Backward compatibility | PASS | `theme` is `Option<String>` with `#[serde(default)]`; frontend defaults to `catppuccin-mocha` |
| CSS injection risk | PASS | Themes are built-in only; Rust validates against allowlist |
| Settings modal theme picker | PASS | `<select>` with live preview |
| Rust validation | PASS | `VALID_THEMES` allowlist; tests cover valid/invalid/None |
| Command palette integration | PASS | `theme.select` + per-theme quick-switch commands |
| Test coverage | PASS | 97 lines of theme tests + 3 SettingsModal tests + 8 Rust tests |

---

## Findings

### F-01 [medium] Three `rgba()` values still hardcode Catppuccin Mocha colors

**Files**: `src/App.css` lines 373, 601, 817

```css
/* Line 373 — .tab-close:hover */
background-color: rgba(243, 139, 168, 0.1);   /* hardcoded #f38ba8 at 10% */

/* Line 601 — .settings-error */
background-color: rgba(243, 139, 168, 0.1);   /* hardcoded #f38ba8 at 10% */

/* Line 817 — .search-case-btn-active */
background-color: rgba(137, 180, 250, 0.1);   /* hardcoded #89b4fa at 10% */
```

These are subtle tinted backgrounds derived from accent colors. When switching to e.g. Dracula (red = `#ff5555`, blue = `#8be9fd`), these backgrounds will still show Catppuccin Mocha tints, creating a visual mismatch.

**Fix options**:
1. Add CSS variables `--accent-red-faint`, `--accent-blue-faint` (or a single `--error-bg`, `--active-bg`) to each theme.
2. Or use `color-mix()` if targeting modern WebView2 (e.g., `color-mix(in srgb, var(--accent-red) 10%, transparent)`).

### F-02 [low] `rgba(0,0,0,...)` backdrop/shadow values not parameterized

**Files**: `src/App.css` lines 505, 521, 739, 895, 906

These are `rgba(0, 0, 0, 0.3-0.6)` for modal backdrops and box-shadows. For the light theme (Catppuccin Latte), pure-black overlays at 60% opacity may look too harsh. This is cosmetic and acceptable for R1, but worth noting for a future polish pass.

### F-03 [low] Live preview on theme change without revert on Cancel

**File**: `src/components/SettingsModal.tsx` line 60

`handleThemeChange` calls `applyThemeById` immediately for live preview, which is a nice UX touch. However, if the user changes the theme and then clicks Cancel, the preview persists because the modal's `onClose` does not revert to the previously saved theme.

**Suggested fix**: Capture the original theme on mount and restore it in a cleanup/cancel handler:
```tsx
const [originalTheme] = useState(theme); // captured after load

const handleCancel = () => {
  applyThemeById(originalTheme); // revert preview
  onClose();
};
```

### F-04 [nit] `theme.select` command just opens Settings modal

**File**: `src/components/layout/TabManager.tsx` line 283

The `theme.select` command palette entry opens the full Settings modal rather than focusing on theme selection specifically. This works but is a slightly misleading UX since the user has to scroll to find the theme dropdown. Acceptable for now; a dedicated theme-picker flyout could come later.

### F-05 [nit] `saveSettings` import added but only used in command palette handler

**File**: `src/components/layout/TabManager.tsx` line 8

`saveSettings` was added to the import. The quick-switch handler does a get-then-save pattern:
```ts
getSettings()
  .then((settings) => saveSettings({ ...settings, theme: themeId }))
  .catch(() => { /* ignore save errors */ });
```

This is correct but silently swallows save errors. The user sees the theme change visually but may not realize it wasn't persisted. Acceptable for built-in themes, but a brief toast/console.warn would be more transparent.

---

## Security Assessment

- **CSS injection**: Not a risk. Themes are hardcoded objects in `src/lib/themes.ts`; values are static strings. No user input flows into CSS variable values.
- **Rust validation**: The `VALID_THEMES` allowlist in `src-tauri/src/settings/mod.rs` rejects any theme ID not in the list, preventing arbitrary strings from being persisted.
- **No `unwrap()` on user data**: Confirmed; theme validation uses pattern matching and returns `Err`.

---

## Verdict: **NEEDS CHANGES**

**Blocking**: F-01 (hardcoded rgba accent backgrounds will visually clash on non-Mocha themes).

**Non-blocking**: F-02 through F-05 are low/nit and can be deferred.

Once F-01 is addressed, this is ready to approve. F-03 (cancel revert) is recommended but not blocking.
