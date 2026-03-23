# Task 039: Text Decorations Rendering (P1-R1)

## Context
SGR codes for bold, italic, underline, strikethrough, and dim are preserved by the ANSI pipeline but not all are fully rendered. AnsiOutput.tsx already handles bold, italic, underline, and dim. This task ensures strikethrough works and verifies all decorations render correctly with the theme system.

## Requirements
### Frontend only.

1. **Strikethrough**: Add `textDecoration: 'line-through'` support. The `vt100` crate and Anser library should already produce this — verify and wire up if missing.
2. **Combined decorations**: Ensure bold+italic, underline+strikethrough, etc. combine correctly (CSS handles this naturally).
3. **Dim + color**: Verify dim (opacity 0.5) works with both foreground colors and theme colors.
4. **Tests**: Add tests for each decoration type rendering correctly.

## Tests
- [ ] `test_strikethrough_renders`: Text with strikethrough SGR gets `text-decoration: line-through`.
- [ ] `test_combined_bold_italic`: Bold+italic text gets both styles.
- [ ] `test_combined_underline_strikethrough`: Both decorations applied via `text-decoration`.
- [ ] `test_dim_with_color`: Dim text with fg color has opacity 0.5 AND the color.
- [ ] `test_all_decorations_combined`: All 5 decorations at once render correctly.

## Files to Read First
- `src/components/AnsiOutput.tsx` — spanStyle function
- `src/lib/ansi.ts` — AnsiSpan type, parseAnsi
- `src/hooks/useIncrementalAnsi.ts` — how spans are produced

## Acceptance Criteria
- [ ] Strikethrough renders correctly
- [ ] All decoration combinations work
- [ ] All tests pass
- [ ] Commit: `feat: add strikethrough and verify all text decoration rendering`
