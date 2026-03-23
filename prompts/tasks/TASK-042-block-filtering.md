# Task 042: Block Output Filtering (P1-B4)

## Context
Long command outputs are hard to scan. Users need a way to filter block output to show only lines matching a pattern — like `grep` but live in the UI. This is different from Find in Output (which highlights matches across all blocks) — this filters lines within a single block.

## Requirements
### Frontend only.

1. **Filter trigger**: Add a "Filter" button to block actions (alongside Copy, Rerun). Clicking it opens a small inline filter input at the top of the block output.
2. **Filter behavior**: As the user types, only output lines containing the filter text are shown. Non-matching lines are hidden (not removed from data). Case-insensitive.
3. **Line count**: Show "N of M lines" indicator next to the filter input.
4. **Clear filter**: X button or Escape clears the filter and shows all lines again.
5. **Live filtering**: Works on the active/running block too — new output lines are checked against the filter as they arrive.
6. **Implementation**: Apply filtering at the BlockView level. Split `block.output` by newlines, filter, rejoin for display. Use `stripAnsi` for matching but render the original ANSI-styled lines.
7. **Register in palette**: `block.filter` command.

## Tests
- [ ] `test_filter_button_appears_on_hover`: Filter button visible in block actions.
- [ ] `test_filter_input_opens_on_click`: Clicking Filter shows the inline input.
- [ ] `test_filter_hides_non_matching_lines`: Non-matching lines hidden from output.
- [ ] `test_filter_case_insensitive`: "error" matches "Error" and "ERROR".
- [ ] `test_filter_line_count`: Shows "5 of 100 lines" format.
- [ ] `test_filter_escape_clears`: Escape closes filter, all lines shown.
- [ ] `test_filter_preserves_ansi`: Filtered lines retain ANSI colors.

## Files to Read First
- `src/components/blocks/BlockView.tsx` — block rendering, actions
- `src/components/AnsiOutput.tsx` — output rendering
- `src/lib/ansi.ts` — stripAnsi
- `src/App.css` — block styling

## Acceptance Criteria
- [ ] Filter button in block actions
- [ ] Inline filter input with live filtering
- [ ] Line count indicator
- [ ] Escape clears filter
- [ ] Works on running blocks
- [ ] ANSI colors preserved in filtered output
- [ ] All tests pass
- [ ] Commit: `feat: add per-block output line filtering`
