# Task 032: Block Collapse/Expand (P1-B3)

## Context

Long command outputs take up a lot of vertical space, making it hard to see previous commands. Users need to collapse blocks to show just the command header (with a click-to-expand toggle). This is similar to how Jupyter notebooks collapse cell outputs.

### What exists now

- **BlockView.tsx** (`src/components/blocks/BlockView.tsx`): Renders block header (command, exit code, timestamp) + output area (`<AnsiOutput>`). Has action buttons (copy, rerun) shown on hover.
- **Terminal.tsx**: Manages `blocks` array. Each block has `id`, `command`, `output`, `status`, `exitCode`.
- **Block type**: No `collapsed` field exists.

## Requirements

### Frontend only — no Rust changes.

#### 1. Collapse toggle on block header

Add a small toggle icon (▶ collapsed / ▼ expanded) to the left of the command text in the block header. Clicking it toggles the block's collapsed state.

#### 2. Collapsed state

- Collapsed blocks show only the header (command, exit code, timestamp, action buttons) — NO output.
- The toggle icon rotates/changes to indicate state.
- Collapsed blocks should have a subtle visual indicator (e.g., slightly different background or a "..." indicator).

#### 3. State management

- Track collapsed state per block. Two options:
  - (a) Add `collapsed` field to Block type — simple but mixes UI state with data.
  - (b) Track in a separate `Set<string>` of collapsed block IDs — cleaner separation.

  Use option (b): `collapsedBlocks: Set<string>` state in Terminal.tsx.

#### 4. Keyboard shortcut

- When a block is focused (via Ctrl+Up/Down from TASK-027), pressing Enter or Space toggles collapse.
- This builds on the existing `focusedBlockIndex` state.

#### 5. "Collapse All" / "Expand All" commands

Register in command palette:
- `block.collapseAll` — Collapse all blocks
- `block.expandAll` — Expand all blocks
- `block.toggleCollapse` — Toggle the focused block (if any)

#### 6. Active block never collapsed

The currently running block (status === 'running') should never be collapsed — auto-expand if it was collapsed when a new command starts.

## Tests

- [ ] `test_click_toggle_collapses_block`: Click toggle icon → output hidden.
- [ ] `test_click_toggle_expands_block`: Click toggle on collapsed block → output shown.
- [ ] `test_collapsed_block_hides_output`: Collapsed block does not render AnsiOutput.
- [ ] `test_collapsed_block_shows_header`: Collapsed block still shows command, exit code, timestamp.
- [ ] `test_collapse_all_command`: All blocks collapsed after command.
- [ ] `test_expand_all_command`: All blocks expanded after command.
- [ ] `test_active_block_auto_expands`: Running block is auto-expanded even if previously collapsed.
- [ ] `test_toggle_icon_changes`: Toggle icon is ▼ when expanded, ▶ when collapsed.

## Acceptance Criteria
- [ ] Click toggle collapses/expands block output
- [ ] Collapsed blocks show header only
- [ ] Toggle icon indicates state
- [ ] Collapse All / Expand All in command palette
- [ ] Active block never stays collapsed
- [ ] Enter/Space toggles focused block
- [ ] All tests pass
- [ ] Commit: `feat: add block collapse and expand`

## Files to Read First
- `src/components/blocks/BlockView.tsx` — Block rendering, header, actions
- `src/components/Terminal.tsx` — Block state, focusedBlockIndex
- `src/lib/commands.ts` — Command palette registry
- `src/App.css` — Block styling
