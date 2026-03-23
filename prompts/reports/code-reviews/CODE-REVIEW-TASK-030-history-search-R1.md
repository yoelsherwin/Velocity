# Code Review: TASK-030 History Search (Ctrl+R)

**Reviewer**: Code Reviewer Agent
**Commit**: `2ea1e4a` — feat: add history search with Ctrl+R
**Round**: R1
**Verdict**: **APPROVE**

---

## Summary

Adds a reverse incremental search (Ctrl+R) for command history, modeled after the standard terminal `reverse-i-search` pattern. A new `HistorySearch` component renders an inline search bar with highlighted matches, cycled via Ctrl+R. The feature integrates into Terminal via a document-level keydown listener and a command palette entry.

## Files Reviewed

| File | Change |
|------|--------|
| `src/components/HistorySearch.tsx` | New component (132 lines) |
| `src/components/Terminal.tsx` | Integration: state, handlers, keyboard listener, command palette case |
| `src/__tests__/HistorySearch.test.tsx` | 11 unit tests |
| `src/lib/commands.ts` | New `history.search` command palette entry |
| `src/App.css` | New `.history-search-*` styles (66 lines) |
| `prompts/STATE.md` | Updated state tracking |

## Findings

### Positive

1. **Clean component isolation.** `HistorySearch` is a pure presentational component with no side effects. All state management is in Terminal. Good separation.

2. **Correct keyboard layering.** The document-level Ctrl+R handler in Terminal checks `historySearchOpen` and returns early when the panel is already open, allowing the HistorySearch component's own `onKeyDown` to handle Ctrl+R cycling. No conflict.

3. **Focus management is correct.** On open: `requestAnimationFrame` auto-focuses the search input. On accept/cancel: `editorRef.current?.focus()` returns focus to the InputEditor textarea. The InputEditor is disabled (`historySearchOpen` is in the disabled prop) preventing keystrokes from leaking into the editor while searching.

4. **Input state preservation.** `savedInputRef` saves the current input on open; cancel restores it. Accept replaces it with the selected command. Clean.

5. **Search algorithm is sound.** `findMatches` iterates from newest to oldest, returns indices in MRU order. `matchIndex` cycles forward through this array. `useMemo` ensures recomputation only when history or query changes.

6. **Highlight rendering.** `HighlightedMatch` correctly finds the first case-insensitive match and wraps it in a `<mark>` tag. Handles no-match and empty-query edge cases.

7. **Good test coverage.** 11 tests covering: basic match, case-insensitive, no match, Ctrl+R cycling, Enter accept, Escape cancel, query reset, open/close toggle, highlight rendering, Enter-with-no-match guard, and hidden-when-closed.

8. **Command palette integration.** `history.search` entry added with `Ctrl+R` shortcut. The `velocity:command` handler correctly opens the panel (with input save).

### Issues

#### Low Severity

**L-1: No "navigate forward" in matches (Ctrl+S convention)**
Standard terminals support Ctrl+S to go forward through matches after Ctrl+R goes backward. Currently Ctrl+R only cycles in one direction (older). The user cannot go back to a newer match once they've passed it, except by retyping the query.

*Recommendation*: Consider adding Ctrl+S for forward navigation in a future iteration. Not blocking.

**L-2: Enter with empty query silently no-ops**
If the user opens history search and presses Enter without typing anything, nothing happens (currentMatch is null). This is correct but slightly surprising -- a user might expect Enter to close the panel. The only way to dismiss is Escape.

*Recommendation*: Acceptable behavior. Matches standard `reverse-i-search` convention where Enter only fires when there's a match.

**L-3: Ctrl+R cycles stop at oldest match (no wrap-around)**
`setMatchIndex((prev) => Math.min(prev + 1, matches.length - 1))` clamps at the end. Standard bash wraps around. Minor UX difference.

*Recommendation*: Personal preference; current behavior is fine. Could add wrap-around later if user feedback warrants it.

**L-4: `currentMatch` can be `undefined` if `matchIndex` exceeds array bounds during state transition**
If `matches` shrinks (e.g., query changes reducing matches) before `matchIndex` resets, `history[matches[matchIndex]]` could be `undefined`. However, `handleQueryChange` always resets `matchIndex` to 0, and `useMemo` recomputes `matches` synchronously with the query state, so in practice this race doesn't occur within React's batched updates.

*Recommendation*: No action needed -- the implementation is safe due to React's synchronous state batching.

### Keyboard Handler Conflict Analysis

| Handler | Key | Scope | Conflict? |
|---------|-----|-------|-----------|
| Terminal Ctrl+R listener | Ctrl+R | document | No -- returns early when `historySearchOpen` is true |
| HistorySearch onKeyDown | Ctrl+R | input element | No -- only fires on the focused search input |
| Terminal Ctrl+Shift+F | Ctrl+Shift+F | document | No -- different modifier |
| Terminal block nav (Ctrl+Up/Down) | Ctrl+Arrow | document | No -- different key |
| InputEditor onKeyDown | various | textarea | No -- textarea is disabled when history search is open |

No conflicts detected. The layered approach (document listener defers to component listener via early return) is correct.

### Focus Management Analysis

| Action | Focus Target | Mechanism | Correct? |
|--------|-------------|-----------|----------|
| Ctrl+R pressed | Search input | `requestAnimationFrame` + `inputRef.current?.focus()` | Yes |
| Enter (accept) | Editor textarea | `editorRef.current?.focus()` | Yes |
| Escape (cancel) | Editor textarea | `editorRef.current?.focus()` | Yes |
| InputEditor disabled | N/A | `disabled={historySearchOpen}` prop | Yes |

Focus flow is correct. No orphaned focus states.

## Verdict: APPROVE

The implementation is clean, well-tested, and correctly integrated. No keyboard conflicts. Focus management is sound. The component follows established patterns in the codebase (similar structure to SearchBar). The three low-severity items are enhancement suggestions, not bugs.
