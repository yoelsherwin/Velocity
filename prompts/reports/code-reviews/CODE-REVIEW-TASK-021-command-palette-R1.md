# Code Review: TASK-021 Command Palette

**Commit:** `23e812a feat: add command palette with Ctrl+Shift+P`
**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-17
**Round:** R1

---

## Files Reviewed

| File | Type | Lines |
|------|------|-------|
| `src/components/CommandPalette.tsx` | New | 156 |
| `src/lib/fuzzy.ts` | New | 113 |
| `src/lib/commands.ts` | New | 26 |
| `src/components/Terminal.tsx` | Modified | +57 |
| `src/components/layout/TabManager.tsx` | Modified | +63 |
| `src/App.css` | Modified | +133 |
| `src/__tests__/CommandPalette.test.tsx` | New | 154 |
| `src/__tests__/CommandPaletteIntegration.test.tsx` | New | 145 |
| `src/__tests__/fuzzy.test.ts` | New | 73 |

Total: **+920 lines**, 9 files changed

---

## Security Checklist

- [x] **No command injection** -- The palette dispatches typed command IDs (hardcoded strings like `'tab.new'`), not user text. No user input is ever interpolated into shell commands through this feature.
- [x] **Input validation on IPC** -- No new IPC commands or Tauri invocations are introduced. All actions are purely frontend dispatches.
- [x] **PTY output safety** -- The `terminal.copyLastOutput` action correctly uses `stripAnsi()` before writing to clipboard, preventing ANSI escape sequences from leaking to the clipboard.
- [x] **No secret leakage** -- No secrets, API keys, or credentials in the changeset.
- [x] **ANSI parsing safety** -- No new ANSI parsing; existing `stripAnsi` is reused correctly.
- [x] **IPC permissions minimal** -- No new IPC surface added.

---

## Findings

### Critical

None.

### Important

**1. `handleBackdropClick` on overlay is redundant and conflicts with backdrop handler**

- **File:** `src/components/CommandPalette.tsx`, lines 91-98 and 100-110
- **Issue:** The overlay (`palette-overlay`) has `onClick={handleBackdropClick}` which checks `e.target === e.currentTarget`. The backdrop (`palette-backdrop`) has `onClick={onClose}` directly. Because the backdrop is a child of the overlay, clicking the backdrop fires `onClose` from the backdrop *and* the click bubbles up to the overlay's handler. Since `e.target` will be the backdrop (not the overlay), the overlay handler does nothing -- so it works by accident. However, this dual-handler pattern is fragile and confusing. If the DOM structure changes even slightly, it could result in double-close calls or missed close events.
- **Fix:** Choose one dismiss strategy. Either use only the overlay's `handleBackdropClick` (and remove the backdrop's `onClick`), or use only the backdrop's direct `onClick` (and remove the overlay handler). The overlay approach with `e.target === e.currentTarget` is the more standard pattern for modal dialogs.
- **Why:** Prevents subtle bugs if the DOM structure is refactored later.

**2. `velocity:command` custom event reaches ALL Terminal instances, not just the focused one**

- **File:** `src/components/Terminal.tsx`, lines 426-480; `src/components/layout/TabManager.tsx`, line 234
- **Issue:** `dispatchToFocusedTerminal` dispatches a `CustomEvent` on `document`, and every mounted `Terminal` component listens for it. In a multi-pane or multi-tab layout, *all* Terminal instances will execute the command (e.g., `terminal.clear` would clear all terminals, not just the focused one). The `blocks` state dependency in the effect also means only the latest re-render's `blocks` snapshot is captured, but the fundamental issue is broadcast semantics on a targeted action.
- **Fix:** Scope the event to the focused pane. Options include: (a) include the `paneId` in the custom event detail and have each Terminal ignore events not targeted at it, (b) use a React context or callback-based approach instead of DOM events, or (c) dispatch the event on a specific DOM element (the focused pane's container) rather than `document`.
- **Why:** Multi-pane is already supported. A command like "Clear Terminal" or "Copy Last Command" executed from the palette should affect only the focused terminal.

**3. `blocks` in the `velocity:command` effect dependency causes excessive re-registration**

- **File:** `src/components/Terminal.tsx`, line 480
- **Issue:** The `useEffect` for `velocity:command` includes `blocks` in its dependency array. Since `blocks` changes on every output event (which can be hundreds of times per second during output streaming), the event listener is torn down and re-registered at an extremely high rate. This is a performance concern *and* risks briefly missing events during the teardown/re-register gap.
- **Fix:** Use a ref for `blocks` (e.g., `const blocksRef = useRef(blocks); blocksRef.current = blocks;`) and access `blocksRef.current` inside the handler. Remove `blocks` from the dependency array.
- **Why:** Prevents unnecessary listener churn during rapid output streaming and eliminates a potential event-miss window.

### Suggestions

**4. `useMemo` dependency array for `results` is incomplete**

- **File:** `src/components/CommandPalette.tsx`, line 36
- **Issue:** `useMemo(() => fuzzyMatch(query, COMMANDS), [query])` -- technically `COMMANDS` is a module-level constant so it will never change, making this safe in practice. However, if `COMMANDS` were ever changed to a prop or state value, this would silently become a stale closure bug. Consider noting this assumption with a comment.
- **Fix:** Add a brief comment: `// COMMANDS is a module-level constant, safe to omit from deps`.
- **Why:** Documentation of intent for future maintainers.

**5. `HighlightedTitle` creates one `<span>` per character**

- **File:** `src/components/CommandPalette.tsx`, lines 10-28
- **Issue:** For a title like "Split Pane Right" (16 chars), this creates 16 `<span>` elements. With 16 commands visible, that is 256 spans just for titles. This is not a blocking issue for the current command count but would scale poorly if the command list grows significantly.
- **Fix:** Group consecutive non-highlighted and highlighted characters into contiguous spans. This is a minor optimization and not urgent at the current scale.
- **Why:** Render efficiency for larger command lists.

**6. The `palette-overlay` z-index (500) is lower than the `settings-overlay` z-index (1000)**

- **File:** `src/App.css`, lines 817 and 465-475
- **Issue:** If both the palette and settings modal are open simultaneously (e.g., user opens palette, executes "Open Settings", and the palette briefly remains), the settings modal will correctly overlay the palette. The current z-index values are consistent with the intended layering. This is correct behavior -- just noting it was verified.
- **Fix:** None needed. Behavior is correct.

**7. `handlePaletteAction` calls `onClose` internally via `handleExecute` in `CommandPalette`**

- **File:** `src/components/CommandPalette.tsx`, lines 58-64
- **Issue:** `handleExecute` calls both `onExecute(commandId)` and `onClose()`. This means the parent's `handlePaletteAction` is called *before* the palette is closed. Since `handlePaletteAction` can trigger state changes (e.g., creating a new tab), and `onClose` sets `paletteOpen(false)`, both state updates will be batched by React 18. This is fine and works correctly. Just noting it was verified.
- **Fix:** None needed.

**8. No ARIA attributes on the palette for accessibility**

- **File:** `src/components/CommandPalette.tsx`
- **Issue:** The command palette dialog has no `role="dialog"`, `aria-label`, `aria-modal`, or `role="listbox"`/`role="option"` attributes on the results list. Screen readers will not recognize this as a searchable list dialog.
- **Fix:** Add `role="dialog"` and `aria-modal="true"` to the `.palette-dialog` div. Add `role="listbox"` to `.palette-results` and `role="option"` with `aria-selected` to each `.palette-item`.
- **Why:** Accessibility compliance; important for a developer tool that should be usable by all developers.

**9. Missing test for Tab key behavior**

- **File:** `src/__tests__/CommandPalette.test.tsx`
- **Issue:** There is no test verifying that the Tab key does not do unexpected things (e.g., move focus out of the palette). Common command palettes trap focus. Currently Tab is not handled and would move focus to the next focusable element in the DOM.
- **Fix:** Consider adding Tab key trapping in the palette (or at minimum, a test documenting the current behavior).
- **Why:** Focus management in modal-like components is important for keyboard-only users.

---

## Test Coverage Assessment

Tests are comprehensive and well-structured:

- **Unit tests (CommandPalette.test.tsx):** 13 tests covering rendering, autofocus, filtering, keyboard navigation (up/down/enter/escape), click execution, shortcuts display, categories display, no-results message, backdrop click, and selection wrapping.
- **Integration tests (CommandPaletteIntegration.test.tsx):** 3 tests covering Ctrl+Shift+P open, toggle, and end-to-end "New Tab" creation through the palette.
- **Fuzzy logic tests (fuzzy.test.ts):** 8 tests covering empty query, exact match, partial match, case insensitivity, no match, keyword match, matched indices, and word-start scoring bonus.

All 295 tests pass (28 test files), including all new tests. The test suite covers the core functionality well.

**Missing coverage:**
- Multi-pane command dispatch (testing that only the focused terminal responds)
- Large command list performance (not critical at 16 commands)

---

## Architecture Assessment

The architecture is clean and well-layered:

1. **`commands.ts`** -- Pure data definition. Command IDs are structured (`category.action`) and self-documenting.
2. **`fuzzy.ts`** -- Pure function, no side effects. Good scoring heuristics (consecutive bonus, word-start bonus, spread penalty, title-length bonus).
3. **`CommandPalette.tsx`** -- Presentational component with proper hook usage. Callbacks are memoized, results are memoized, effects have cleanup.
4. **`TabManager.tsx`** -- Palette action dispatch at the tab/pane layer, with terminal-level actions forwarded via DOM events.
5. **`Terminal.tsx`** -- Receives terminal-level commands via DOM custom events.

The two-tier dispatch (TabManager handles tab/pane actions directly, forwards terminal actions via CustomEvent) is a reasonable approach. The main concern is the broadcast nature of the CustomEvent, which should be scoped per-terminal.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Important | 3 |
| Suggestions | 6 |

**Key important findings:**
1. Redundant/fragile dual click-dismiss handlers on overlay and backdrop
2. Custom event broadcast affects ALL terminals, not just the focused one
3. `blocks` in the velocity:command effect dependency array causes excessive listener churn

**Overall Assessment: NEEDS CHANGES**

The important #2 finding (broadcast to all terminals) is a functional correctness issue in multi-pane layouts, which is a core feature of Velocity. It should be addressed before this is considered production-ready. The other important findings (#1, #3) are not blocking but should be fixed in the same pass.

The overall code quality is high. The component design is clean, hooks are used correctly, type safety is maintained throughout (no `any` types), and test coverage is thorough. The fuzzy matching implementation is solid with sensible scoring heuristics.
