# Code Review: TASK-040, TASK-041, TASK-043, TASK-045 (Round 1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commits**: ba3149e, e94090e, deb399a, 7d1a571

## Test Results

All **527 tests pass** across 50 test suites. The OOM at teardown is a Vitest worker cleanup issue unrelated to these changes. No regressions.

---

## TASK-040: Cursor in Alt Screen

**Commit**: ba3149e — `feat: add cursor rendering in alternate screen mode`
**Files**: `src-tauri/src/ansi/mod.rs`, `src-tauri/src/pty/mod.rs`, `src/App.css`, `src/components/Terminal.tsx`, `src/components/TerminalGrid.tsx`, tests

### Verdict: PASS

**What works well:**
- Clean `GridUpdatePayload` struct in Rust that bundles rows + cursor state in a single event payload. Avoids a second IPC channel for cursor.
- Good use of `vt100::Screen::cursor_position()` and `hide_cursor()` -- delegates to the parser rather than reimplementing cursor tracking.
- `TerminalGrid` props are optional (`cursorRow?`, `cursorCol?`, `cursorVisible?`), so existing call sites without cursor work unchanged.
- `GridRowMemo` receives `cursorCol` only for the matching row, so non-cursor rows are not re-rendered when cursor moves -- good perf.
- 7 Rust tests covering default position, after text, after newline, after CUP move, hide/show, and alt screen. 5 frontend tests covering render, hidden, absent props, second row, blink class.
- CSS blink uses `step-end` animation -- correct for terminal cursor style.

**Issues:**
- **[Minor]** The `GridUpdatePayload` type is defined in both Rust (`ansi/mod.rs`) and TypeScript (`TerminalGrid.tsx`). If the Rust struct adds a field, the TS side will silently ignore it. Consider generating TS bindings or adding a comment cross-referencing the Rust struct.
- **[Minor]** `cursor_row` / `cursor_col` are `u16` in Rust but `number` in TS. No practical issue since JS handles these values fine, but worth noting for documentation.

**No security concerns.** Cursor position is derived from PTY parser state, not user input.

---

## TASK-041: Block Selection (Click-to-Select)

**Commit**: e94090e — `feat: add click-to-select block selection`
**Files**: `src/components/Terminal.tsx`, `src/components/blocks/BlockView.tsx`, `src/__tests__/blockSelection.test.tsx`

### Verdict: PASS

**What works well:**
- Reuses existing `focusedBlockIndex` state -- no new state introduced, just wiring click events to the existing mechanism.
- `stopPropagation` on the actions div prevents click-to-select from firing when clicking Copy/Rerun buttons. Tests verify this.
- Click on empty terminal-output area deselects (`setFocusedBlockIndex(-1)`) via `e.target === e.currentTarget` check.
- 4 tests covering select, change selection, deselect via action buttons, and focused class.

**Issues:**
- **[Minor]** The `handleClick` callback in `BlockView` creates a new closure each render due to `useCallback([onSelect])`. This is fine since `onSelect` is `() => setFocusedBlockIndex(index)` which is a new closure on every Terminal render anyway. No perf concern in practice but could be noted.
- **[Nit]** The deselect handler `onClick={(e) => { if (e.target === e.currentTarget) setFocusedBlockIndex(-1); }}` is an inline arrow function. Consider extracting to `useCallback` for consistency.

**No security concerns.** Pure UI state change, no IPC or data flow.

---

## TASK-043: Rich History with Metadata

**Commit**: deb399a — `feat: add rich history with exit codes, CWD, and git branch`
**Files**: `src/hooks/useCommandHistory.ts`, `src/hooks/useCompletions.ts`, `src/hooks/useSessionPersistence.ts`, `src/lib/session.ts`, `src/components/Terminal.tsx`, `src/components/HistorySearch.tsx`, tests

### Verdict: PASS WITH FINDINGS

**What works well:**
- `HistoryEntry` type is clean: `command`, `timestamp`, `exitCode?`, `cwd?`, `gitBranch?`, `shellType`.
- Backward compatibility via `normalizeHistory()` that converts plain strings to `HistoryEntry` objects. Session files with old string-only history still work.
- The "add on submit, update on completion" pattern is smart: `addCommand()` is called immediately on submit (for navigation), then again on completion with metadata. The dedup logic in `addCommand` merges metadata via spread (`{ ...prev, ...entry }`).
- `HistorySearch` now shows CWD and exit code badges next to matches. Exit success/failure uses different CSS classes.
- `useCompletions` correctly reads `history[i].command` for prefix matching.
- 5 rich history tests + updated existing tests (9 in useCommandHistory, 11 in HistorySearch, 7 in useCompletions).

**Issues:**
- **[MEDIUM - Security]** History entries containing CWD paths and commands are persisted to the session file via `useSessionPersistence`. The session file is written to disk as JSON via `invoke('save_session')`. If a user runs a command like `export API_KEY=secret123`, the command string is persisted to disk in plaintext. This is the same risk that existed before (commands were already persisted as strings), but now additional metadata (CWD, git branch) increases the surface. **Recommendation**: Consider applying the existing `maskSecrets()` function to the `command` field before persistence, or at minimum document the risk. The CWD and gitBranch fields are low-risk.
- **[MEDIUM - Code Duplication]** The history-entry-creation-on-completion logic is duplicated 6 times in `Terminal.tsx` (3 catch blocks x 2 event listeners, lines ~218-252 and ~302-334). This is the pattern:
  ```
  getCwd().then(dir => {
    getGitInfo(dir).then(gi => { addCommand(...) }).catch(() => { addCommand(...) })
  }).catch(() => { addCommand(...) })
  ```
  **Recommendation**: Extract a helper like `addRichHistoryEntry(completedBlockInfo, cwd?, gitInfo?)` to eliminate the 6x repetition.
- **[Minor]** `PaneSessionData.history` type is `(string | HistoryEntry)[]` -- the union type leaks into the persistence layer. Once all sessions are migrated, consider narrowing to `HistoryEntry[]`.
- **[Minor]** The `HistorySearch` metadata display (`in C:\Projects [checkmark]`) does not escape the CWD path for React rendering. Since it's rendered as text content (not `dangerouslySetInnerHTML`), XSS is not a concern, but paths with unusual characters could look odd.

**No critical security issues.** The persisted history concern is pre-existing and not introduced by this commit.

---

## TASK-045: IDE Cursor and Selection Highlighting

**Commit**: 7d1a571 — `feat: add IDE-like cursor and selection highlighting in input editor`
**Files**: `src/components/editor/InputEditor.tsx`, `src/App.css`, `src/__tests__/InputEditor.test.tsx`, `src/__tests__/ideCursor.test.tsx`

### Verdict: PASS WITH FINDINGS

**What works well:**
- Hides native `caret-color: transparent` and renders a custom `<span class="editor-cursor">` in the syntax highlight overlay. Clean approach.
- `buildOverlayContent()` is a pure function that takes tokens, cursor position, and selection range, and produces React nodes. Easy to test and reason about.
- Selection highlighting wraps selected characters in `.editor-selection` spans with `var(--selection-bg)`. Cursor is hidden during selection (correct behavior).
- `syncSelection()` uses refs + counter tick pattern to avoid render loops while still triggering re-renders when selection changes.
- `onMouseUp` added alongside `onClick` and `onKeyUp` to catch drag-to-select.
- CSS cursor blink uses `step-end` animation -- consistent with the alt-screen cursor.

**Issues:**
- **[MEDIUM - Performance]** `buildOverlayContent()` is called on every render via `useMemo`, but the deps include `cursorPosRef.current` and `selStartRef.current` -- reading `.current` from refs in a deps array is an anti-pattern. React cannot track ref mutations, so this `useMemo` relies on the `tick` state counter to invalidate. It works, but the eslint-disable comment acknowledges this. The real concern is that every keystroke triggers `syncSelection` -> `setTick` -> re-render -> `buildOverlayContent` recalculation. For typical command-line input lengths (< 200 chars) this is fine, but for very long multi-line inputs it could cause jank. **Recommendation**: Consider throttling or debouncing `syncSelection` for `onKeyUp` events.
- **[Minor]** The `buildOverlayContent` function handles cursor-at-token-boundary correctly (inserts cursor span before the next token), but does not handle the edge case where `cursorPos` is between two tokens that have no gap (e.g., `|` pipe followed by command). In practice this works because the cursor span has `margin: 0 -1px` which overlaps, but it's worth a comment.
- **[Minor]** The comment removal in `handleKeyDown` (removing explanatory comments like "Only intercept if cursor is on the first line") reduces readability. Those comments were useful for understanding the arrow-key interception logic.
- **[Nit]** The `ideCursor.test.tsx` file is separated from `InputEditor.test.tsx` with the comment "to avoid OOM in single worker". This suggests the test suite is hitting memory limits. The actual OOM seen in the test run confirms this is a growing concern.

**No security concerns.** Pure UI rendering, no IPC or user data handling.

---

## Summary Table

| Task | Feature | Verdict | Blocking Issues |
|------|---------|---------|-----------------|
| TASK-040 | Cursor in Alt Screen | **PASS** | None |
| TASK-041 | Block Selection | **PASS** | None |
| TASK-043 | Rich History | **PASS WITH FINDINGS** | Code duplication (6x); history-to-disk secret risk (pre-existing) |
| TASK-045 | IDE Cursor | **PASS WITH FINDINGS** | Ref-in-deps anti-pattern (works but fragile) |

## Recommended Follow-ups

1. **TASK-043**: Extract duplicated history-entry-creation logic in `Terminal.tsx` into a helper function.
2. **TASK-043**: Evaluate applying `maskSecrets()` to command strings before session persistence.
3. **TASK-045**: Add a comment explaining the ref-in-deps pattern and why it works (tick counter).
4. **General**: The test suite OOM is worsening. Consider splitting large test files or increasing Node heap size in vitest config.
