# QA Report: TASK-036 Auto Tab Titles (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: a8b8c70 `feat: add auto-updating tab titles`

## Test Results: ALL PASS

### Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (Vitest) | 507 passed, 0 failed | PASS |

All pre-existing tests continue to pass. No regressions detected.

---

### New Test Coverage

**Tab title utility tests (18)**:
- `getBasename` -- Windows path, Unix path, trailing slashes, root path (4 tests)
- `getCommandName` -- multi-word extraction, single-word, leading whitespace (3 tests)
- `truncateTitle` -- short unchanged, long truncated to 20 with ellipsis, exact boundary unchanged (3 tests)
- `computeTabTitle` -- CWD basename when idle, command name while running, long title truncation, null fallback, empty fallback, revert after command completes, command precedence over CWD, long command truncation (8 tests)

---

### Bug Hunt Results

#### Title Flicker: NO BUG FOUND

Potential flicker scenario: when a command completes, `setRunningCommand(null)` is called, then `getCwd().then(setCwd)` is called asynchronously. This means there is a brief window where `runningCommand` is null and `cwd` still holds the old value. The `useEffect` fires and computes a title from the old CWD. When `setCwd` fires with the new CWD, the effect fires again with the updated CWD.

**Assessment**: This is NOT a flicker bug. The old CWD title is still valid -- it represents the directory the user was in before the command ran. The update to the new CWD (if it changed) happens within a single React commit cycle in most cases, and even if it spans two renders, the user sees "command name" -> "old dir" -> "new dir" which is the correct progression. There is no flash of empty or fallback title.

The `if (title)` guard on line 103 of Terminal.tsx prevents emitting an empty title, so the fallback "Terminal N" title is never briefly shown during transitions.

#### Stale Titles After Shell Switch: NO BUG FOUND

When the user switches shells (e.g., PowerShell -> CMD), `handleShellSwitch` calls `resetAndStart(newShell)`. This resets blocks and creates a new session but does NOT clear `runningCommand` or `cwd`.

**Assessment**: This is safe because:
1. `runningCommand` is already `null` by the time the user can interact with the shell selector (commands must complete before the selector is usable in the normal flow).
2. The CWD is re-fetched on mount via the `useEffect` at line 436, which will update `cwd` and trigger a title update.
3. Even if `cwd` briefly holds the old value, it is a valid directory path and produces a valid title.

#### Title During Alt-Screen Mode: NO BUG FOUND

When a program enters alt-screen mode (vim, htop, etc.):
1. `setRunningCommand(command)` is called when the command is submitted.
2. The tab title shows the command name (e.g., "vim").
3. While in alt-screen, `runningCommand` remains set (it is only cleared when a command completes via exit code marker).
4. When the user exits the alt-screen program, the command completes, `setRunningCommand(null)` fires, and the title reverts to the CWD basename.

**Assessment**: Correct behavior. The command name stays visible in the tab title for the entire duration of an alt-screen program.

#### Pane Focus Title Sync: NO BUG FOUND

In a split-pane layout, each pane's Terminal reports its title independently via `onTitleChange`. The `paneTitlesRef` map in TabManager caches titles per pane. When `handleFocusPane` is called, it reads the cached title for the newly focused pane and updates the tab title. When `handleTitleChange` receives a title update from a non-focused pane, it stores the title in the cache but does not update the tab title (the `if (tab.focusedPaneId !== paneId) return tab` guard).

**Assessment**: Correct behavior. Tab title always reflects the focused pane.

#### Tab Close / New Tab: NO BUG FOUND

`handleNewTab` correctly populates `fallbackTitlesRef` with the new tab's default title before adding the tab to state. The `fallbackTitlesRef` for closed tabs is never cleaned up (same observation as code review finding 2), but this has no functional impact.

---

### Edge Cases Verified (via unit tests)

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| CWD is `C:\` (root) | `C:` | `C:` | PASS |
| CWD is null | Fallback title | Fallback title | PASS |
| CWD is empty string | Fallback title | Fallback title | PASS |
| Title exactly 20 chars | Unchanged | Unchanged | PASS |
| Title 21+ chars | Truncated with ellipsis | Truncated with ellipsis | PASS |
| Command with leading spaces | Trimmed, first word extracted | `git` from `  git status` | PASS |
| Running command -> null (completes) | Reverts to CWD | Reverts to CWD | PASS |

---

### Vitest Config Change

The `vitest.config.ts` change adds `.claude/**` to the exclude list. This is a housekeeping fix to prevent Vitest from scanning Claude configuration files. No impact on test coverage.

---

## Summary

All 507 tests pass. No regressions. Bug hunt for title flicker, stale titles after shell switch, and alt-screen title behavior found no issues. The title update lifecycle is correct across all examined scenarios.
