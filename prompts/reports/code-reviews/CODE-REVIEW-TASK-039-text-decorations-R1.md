# Code Review + QA: TASK-039 Text Decorations (R1)

**Date**: 2026-03-23
**Reviewer**: Claude
**Scope**: Strikethrough support + combined text-decoration handling

## Files Changed

| File | Change |
|------|--------|
| `src/lib/ansi.ts` | Added `strikethrough` to `AnsiSpan` interface; parse SGR 9 via Anser's `'strikethrough'` decoration |
| `src/components/AnsiOutput.tsx` | Refactored `spanStyle` to build a combined `textDecoration` string from underline + strikethrough |
| `src/__tests__/ansi.test.ts` | 2 new tests: strikethrough parsing, combined decorations parsing |
| `src/__tests__/AnsiOutput.test.tsx` | 5 new tests: strikethrough rendering, combined bold+italic, underline+strikethrough, dim+color, all decorations combined |

## Verdict: PASS

The change is small, focused, and correct.

## Correctness

- **`AnsiSpan.strikethrough` field**: Added as `boolean?`, consistent with the existing `bold`, `italic`, `underline`, `dim` fields. No type inconsistency.
- **Parser (`parseAnsi`)**: Correctly checks `decorations.includes('strikethrough')`. Verified that the Anser library does produce `'strikethrough'` in its `decorations` array for SGR code 9 (confirmed in `node_modules/anser/lib/index.js:389`).
- **`spanStyle` refactor**: Builds a `decorations: string[]` array, pushing `'underline'` and/or `'line-through'` as applicable, then joins with space. This is the correct CSS approach -- `textDecoration: "underline line-through"` is valid CSS and renders both decorations simultaneously.
- **Fallback**: When no decorations are present, returns `undefined` (not empty string), which is correct for React's `style` prop.

## Code Quality

- Clean, minimal diff. No unnecessary changes.
- The `spanStyle` refactor from a ternary to an array-based approach is strictly better -- it scales to N decorations without nested ternaries.
- Test names follow the existing `test_snake_case` convention used in this codebase.

## Test Coverage

All 7 new tests pass. Coverage is thorough:

| Test | What it verifies |
|------|-----------------|
| `test_parseAnsi_strikethrough` | Parser correctly sets `strikethrough: true` for SGR 9 |
| `test_parseAnsi_combined_decorations` | Parser handles SGR 1;3;4;9 (bold+italic+underline+strikethrough) |
| `test_strikethrough_renders` | DOM span has `textDecoration` containing `line-through` |
| `test_combined_bold_italic` | fontWeight=bold + fontStyle=italic render together |
| `test_combined_underline_strikethrough` | textDecoration contains both `underline` and `line-through` |
| `test_dim_with_color` | opacity=0.5 + color coexist |
| `test_all_decorations_combined` | All 5 attributes render simultaneously |

## Full Test Suite

All **538 tests pass** across 48 test files. No regressions.

## Security

No concerns. This change only adds a new boolean field to the span type and a CSS value (`line-through`). No user input interpolation, no new IPC surface.

## Nitpicks (non-blocking)

None. The change is clean.

## Summary

Straightforward, well-tested addition of strikethrough support. The `spanStyle` refactor to array-based `textDecoration` building is the right pattern for combining CSS text decorations. No issues found.
