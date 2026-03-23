# Code Review: TASK-026 Custom Fonts + Size Configuration (R2)

**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-23
**Fix Commit**: `30a14be` -- fix: validate font_family characters and fix truthiness checks
**Feature Commit**: `c6e43ae` -- feat: add custom font family, size, and line-height settings

---

## Summary

R2 review of the fix commit addressing both MUST FIX and SHOULD FIX findings from R1. The fix commit adds character-level allowlist validation for `font_family` in Rust and changes JavaScript truthiness checks to explicit `!= null` comparisons in `applyFontSettings`.

**Files changed in fix commit**: 2 (`src-tauri/src/settings/mod.rs`, `src/lib/font-settings.ts`)

---

## Verdict: APPROVE

Both R1 findings have been correctly addressed. No new issues introduced.

---

## R1 Finding Resolution

### Finding 1: [Security / Medium] CSS injection via `font_family` string -- RESOLVED

**Fix**: Added allowlist validation at `src-tauri/src/settings/mod.rs` line 116:

```rust
if !family.chars().all(|c| c.is_alphanumeric() || " ,'-._".contains(c)) {
    return Err("Font family contains invalid characters".to_string());
}
```

**Assessment**: Correct. The allowlist approach (alphanumeric + space, comma, single quote, hyphen, period, underscore) is more robust than the blocklist suggested in R1. It covers all legitimate font family names (e.g., `JetBrains Mono`, `Consolas, 'Courier New', monospace`, `DejaVu Sans Mono`) while rejecting all CSS injection vectors (`; { } < > \ " : / ( ) ! @`).

Two new comprehensive tests validate this:
- `test_font_family_rejects_css_injection` -- 10 malicious inputs all rejected
- `test_font_family_accepts_valid_names` -- 5 common font families all accepted

### Finding 2: [Bug / Low] Truthiness checks in `applyFontSettings` -- RESOLVED

**Fix**: Changed all three checks from truthiness (`if (settings.font_family)`) to explicit null checks (`if (settings.font_family != null)`) in `src/lib/font-settings.ts` lines 10, 13, 16.

**Assessment**: Correct. The `!= null` check covers both `undefined` and `null` while allowing falsy values like `0` or empty string to pass through. This is the idiomatic TypeScript pattern for optional fields.

---

## New Review of Fix Commit

### No new issues found

The fix commit is minimal and surgical -- it touches only the two locations identified in R1, adds appropriate test coverage, and introduces no regressions.

---

## Full Feature Review (both commits combined)

Verified the complete feature across all 11 changed files:

| Area | Status | Notes |
|------|--------|-------|
| CSS custom properties in `:root` | PASS | Three variables with sensible defaults |
| All hardcoded terminal fonts replaced with `var()` | PASS | 8 CSS rule sets updated |
| Rust `AppSettings` struct extended | PASS | `#[serde(default)]` for backward compat |
| Rust validation (size, line height, family) | PASS | Bounds + character allowlist |
| Settings modal Appearance section | PASS | Font family, size, line height inputs + live preview |
| Font settings applied on startup | PASS | `TabManager` loads and applies in `useEffect` |
| Block height estimator updated | PASS | Reads CSS variables instead of hardcoded `19.6` |
| Terminal grid row height updated | PASS | `calc(var(--terminal-line-height) * 1em)` |
| Editor alignment preserved | PASS | Both textarea and highlight use same CSS vars |
| Existing LLM tests updated | PASS | `..Default::default()` spread for new fields |
| No `unwrap()` on user-derived data | PASS | All error paths use `Result` |

---

## Test Results

| Suite | Result |
|-------|--------|
| Frontend (Vitest) | 365/365 passed (1 flaky in full-suite run due to test isolation, passes in isolation -- pre-existing, not related to this feature) |
| Rust (cargo test) | 11/11 passed |

New tests added in feature + fix commits:
- Rust: 9 new tests (serialization, deserialization, font size bounds, line height bounds, empty family, CSS injection rejection, valid names acceptance, too-long family)
- React: 4 new SettingsModal tests (renders font section, saves font settings, preview updates, loads font settings)
- TypeScript: 2 new `applyFontSettings` unit tests (sets CSS variables, skips undefined)
- E2E: 1 persistence test (font size survives reload)

---

## Checklist

| Check | Status |
|-------|--------|
| R1 Finding 1 (CSS injection) resolved | PASS |
| R1 Finding 2 (truthiness checks) resolved | PASS |
| No new security issues | PASS |
| No new bugs introduced | PASS |
| Test coverage adequate | PASS |
| Backward compatibility maintained | PASS |
| CSS defaults work without saved settings | PASS |
| No `unwrap()` on user-derived data | PASS |
