# Code Review: TASK-033 Sticky Command Header (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: `652f6c0` (feat: add sticky command header on block scroll)
**Verdict**: PASS

---

## Summary

TASK-033 adds sticky positioning to `.block-header` so the command row stays visible while scrolling through long block output. The change is CSS-only (5 properties added) plus a new test file with 3 tests. The implementation is correct and the z-index layering is sound.

---

## Findings

### CR-033-01 [INFO] Multiple sticky headers do not visually stack

Each `.block-header` is sticky relative to its nearest scrollable ancestor (`.terminal-output`, which has `overflow-y: auto`). Because each header lives inside its own `.block-container`, they are scoped to their container's scroll extent. When a block scrolls out of view, its header scrolls away too. Only the currently-visible block's header pins at `top: 0`. This is the correct behavior for the terminal's block-per-command model -- no stacking issue exists.

### CR-033-02 [INFO] z-index layering is correct

The z-index hierarchy is:
- `.block-header`: 10 (sticky, within scroll container)
- `.search-bar`: 100 (sticky, same scroll container)
- `.palette-overlay`: 500 (fixed, covers viewport)
- `.settings-overlay`: 1000 (fixed, covers viewport)

The search bar at z-index 100 correctly renders above sticky headers at z-index 10. The command palette and settings dialogs use `position: fixed` and much higher z-indexes, so they are unaffected. No conflicts.

### CR-033-03 [INFO] Background is opaque -- no content bleed-through

`background-color: var(--bg-base)` resolves to `#1e1e2e`, a fully opaque color. This prevents output text from showing through the pinned header during scroll. Correct.

### CR-033-04 [INFO] Collapse toggle is unaffected

The collapse toggle button sits inside `.block-header`. When the block is collapsed, the output is hidden and there is nothing to scroll, so sticky positioning is inert. When expanded, the toggle remains part of the header and pins correctly. No interaction issues.

### CR-033-05 [INFO] Alt screen mode is unaffected

Alt screen mode replaces the terminal output area entirely. Block headers are not rendered in alt screen mode, so sticky positioning has no effect. No interaction issues.

### CR-033-06 [LOW] Hardcoded rgba in box-shadow

**File**: `src/App.css` (line 168)

The `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2)` uses a hardcoded rgba value. This is consistent with the existing codebase pattern (lines 545, 561, 779, 935, 946 all use hardcoded rgba for shadows/overlays), so this is not a deviation. However, if the project ever moves to a theme variable for shadow color, all of these should be updated together.

**Impact**: None currently. Noted for future theme work.

---

## Tests

- 3 new tests in `src/__tests__/stickyHeader.test.tsx`: verify sticky position, opaque background, and z-index >= 10
- Tests inject `App.css` into jsdom to validate computed styles -- good approach
- All 434 frontend tests pass
- All 11 Rust tests pass

---

## Verdict: PASS

The change is minimal, correct, and well-tested. Sticky positioning is properly scoped to the scroll container, z-index layering has no conflicts with existing UI elements (search bar, command palette, settings), and the opaque background prevents content bleed-through. No functional issues found.
