# Code Review: TASK-032 Block Collapse/Expand (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: `589da48` (feat: add block collapse and expand)
**Verdict**: NEEDS FIXES

---

## Summary

TASK-032 adds block collapse/expand functionality: a toggle button on each block header, collapse-all/expand-all via command palette, keyboard toggle (Enter/Space on focused block), auto-expand for running blocks, and associated CSS/tests. The implementation is generally clean but has two functional bugs and one minor leak.

---

## Findings

### CR-032-01 [HIGH] Search matches in collapsed blocks are invisible

**File**: `src/components/Terminal.tsx` (lines 966-982) + `src/hooks/useSearch.ts`

`useSearch` computes matches across ALL block outputs, including collapsed blocks. When the user navigates to a match inside a collapsed block (via F3 / Enter in SearchBar), the scroll-to-match logic attempts to find a `.search-highlight-current` DOM element that does not exist because `block-output` is not rendered for collapsed blocks. The user sees "3/10" in the match counter but pressing Next jumps over invisible matches with no visual feedback.

**Fix**: Either (a) auto-expand the block containing the current match, or (b) filter collapsed blocks out of the search. Option (a) is better UX since the user expects to see every match.

In Terminal.tsx's `useEffect` for scrolling to current match (line 866-896), when the target block is collapsed, call `setCollapsedBlocks` to expand it before scrolling.

### CR-032-02 [MEDIUM] Enter/Space keydown double-fires alongside InputEditor

**File**: `src/components/Terminal.tsx` (lines 660-669)

The document-level `handleBlockNav` listener intercepts Enter and Space when `focusedBlockIndex >= 0`. Because the InputEditor textarea receives the event first (target phase), then the event bubbles to `document`, both handlers fire: the textarea processes the keystroke (e.g., inserting a space or triggering submit) AND the document handler toggles collapse.

Scenario: User presses Ctrl+Up to navigate to a block (focusedBlockIndex = 2), then presses Space. The textarea inserts a space (resetting focusedBlockIndex to -1 via `handleInputChange`), but in the same event, the document handler also fires `toggleBlockCollapse` because `focusedBlockIndex` was still `>= 0` at the time the event reached `document`.

**Fix**: Check that `document.activeElement` is not the InputEditor textarea before intercepting Enter/Space, OR use `e.target` to skip when the event originates from an input/textarea element:

```typescript
if ((e.key === 'Enter' || e.key === ' ') && focusedBlockIndex >= 0) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') return; // Don't intercept editor keys
  ...
}
```

### CR-032-03 [LOW] Collapsed block IDs leak when blocks are evicted

**File**: `src/components/Terminal.tsx` (line 63)

The `collapsedBlocks` Set accumulates block IDs forever. When `MAX_BLOCKS` (500) causes old blocks to be evicted from the `blocks` array (line 435-437), their IDs remain in the Set. Over a long session this is a slow unbounded memory leak.

**Fix**: After slicing blocks in `setBlocks`, prune `collapsedBlocks` to only contain IDs still present in the blocks array. Alternatively, prune periodically or on collapseAll/expandAll.

### CR-032-04 [LOW] `onToggleCollapse` should be required

**File**: `src/components/blocks/BlockView.tsx` (line 12)

`onToggleCollapse` is typed as optional (`onToggleCollapse?: () => void`) but the collapse toggle button always binds it to `onClick`. Every caller in Terminal.tsx passes it. Making it required would catch potential future omissions at compile time and is more accurate to the actual contract.

---

## Positive Observations

- **Auto-expand for running blocks** (Terminal.tsx lines 967-969): Clean guard that prevents collapse of active running blocks. The `submitCommand` also proactively expands new blocks (lines 441-448).
- **Welcome block exclusion**: Toggle button correctly hidden for welcome blocks (`command === ''`), and `collapseAllBlocks` filters them out.
- **CSS variable refactoring**: Extracting `--accent-red-bg` and `--accent-blue-bg` into named variables across all five themes is a good DRY improvement.
- **Test coverage**: 10 new tests covering toggle click, collapsed rendering, visual indicators, welcome block exclusion, and icon states.
- **Command palette integration**: Three new commands (`block.collapseAll`, `block.expandAll`, `block.toggleCollapse`) properly registered and handled.

---

## Test Results

- **Vitest**: 431 passed, 0 failed (40 test files)
- **Cargo test (unit)**: 117 passed, 0 failed, 1 ignored
- **Cargo test (integration)**: 2 pre-existing failures (`test_real_echo_command`, `test_real_ansi_filter_on_live_output`) -- unrelated to this task (timing-dependent PTY integration tests)

---

## Verdict: NEEDS FIXES

CR-032-01 (search + collapse interaction) is a high-severity UX bug that should be fixed before merge. CR-032-02 (Enter/Space double-fire) is a medium-severity interaction bug. CR-032-03 and CR-032-04 are low priority and can be deferred.
