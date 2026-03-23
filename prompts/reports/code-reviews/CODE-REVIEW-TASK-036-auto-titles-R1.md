# Code Review: TASK-036 Auto Tab Titles (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: a8b8c70 `feat: add auto-updating tab titles`

## Verdict: PASS (with minor findings)

No blocking issues. The callback threading is correct, title computation is clean and well-tested, and the ref-based approach avoids stale closures.

---

## Architecture Review

### Callback Threading: PASS

The `onTitleChange` callback flows correctly through three layers:

1. **TabManager** defines `handleTitleChange(tabId, paneId, title)` -- stores pane title in `paneTitlesRef` and updates the tab title if the reporting pane is the focused pane.
2. **PaneContainer** receives `onTitleChange?: (paneId: string, title: string) => void` and binds the pane's `node.id` at the leaf level: `(title) => onTitleChange(node.id, title)`. The `tabId` is bound at the TabManager render site: `(paneId, title) => handleTitleChange(tab.id, paneId, title)`.
3. **Terminal** receives `onTitleChange?: (title: string) => void` and calls it from a `useEffect` whenever `cwd` or `runningCommand` changes.

The prop drilling through `SplitPane` is also correct -- `onTitleChange` is threaded through both `first` and `second` children of every split node.

### Stale Closure Prevention: PASS

Terminal.tsx uses a ref pattern to avoid stale closures:

```typescript
const onTitleChangeRef = useRef(onTitleChange);
onTitleChangeRef.current = onTitleChange;
```

The `useEffect` reads from `onTitleChangeRef.current` rather than closing over the `onTitleChange` prop directly. This means the effect's dependency array only includes `[cwd, runningCommand]` and does not re-run when the parent re-renders with a new callback identity. This is the correct pattern.

### Title Computation Logic: PASS

`computeTabTitle` in `src/lib/tab-title.ts` has clear priority:
1. Running command name (first word) -- highest priority
2. CWD basename -- when idle
3. Fallback title -- when neither is available

All branches apply `truncateTitle` (max 20 chars with ellipsis). The `getBasename` function normalizes both `/` and `\` separators, handles trailing slashes, and handles the root path edge case (`C:\` -> `C:`).

### Fallback Title Management: PASS

`fallbackTitlesRef` in TabManager stores the original "Terminal N" label per tab. This is used as a fallback when `computeTabTitle` returns empty. The ref is populated when a tab is created (both for the initial tab and in `handleNewTab`). Since it is a `Map<string, string>` stored in a ref, it does not cause re-renders and persists correctly across the component lifetime.

### Focus-Pane Title Sync: PASS

When `handleFocusPane` is called (user clicks a different pane in a split), the handler looks up the newly focused pane's cached title from `paneTitlesRef` and updates the tab title. This ensures the tab title reflects the focused pane's state even when switching focus between panes in a split layout.

---

## Security Review

### No Security Concerns: PASS

The feature operates entirely within the frontend React layer. No user input is interpolated into shell commands. Title data flows from CWD (Tauri process state) and `runningCommand` (the command string the user already submitted). Neither is passed to any IPC call or executed -- they are only used for display.

---

## Findings

### Finding 1: Inline Arrow Function Creates New Identity on Every Render (LOW)

**File**: `src/components/layout/PaneContainer.tsx`, line 138

```typescript
<Terminal key={node.id} paneId={node.id} onTitleChange={onTitleChange ? (title: string) => onTitleChange(node.id, title) : undefined} />
```

The `(title) => onTitleChange(node.id, title)` arrow function is recreated on every render of `PaneContainer`. This means `Terminal` receives a new `onTitleChange` prop identity on every parent render. However, this is mitigated by the `onTitleChangeRef` pattern in Terminal -- the effect does not depend on the prop identity, so no unnecessary re-renders or effect re-runs occur. Still, wrapping this in `useCallback` or memoizing would be slightly cleaner.

**Severity**: Low -- mitigated by the ref pattern in Terminal.

### Finding 2: `paneTitlesRef` Not Cleaned Up on Pane Close (LOW)

**File**: `src/components/layout/TabManager.tsx`

When a pane is closed via `handleClosePane`, the pane's entry in `paneTitlesRef.current` is never removed. Over time, if a user creates and closes many panes, this map will accumulate stale entries. Since pane IDs are UUIDs, there is no risk of collision, and the memory impact is trivial (a few bytes per entry). But for correctness, a cleanup in `handleClosePane` would be ideal:

```typescript
paneTitlesRef.current.delete(paneId);
```

**Severity**: Low -- no functional impact, minor memory leak.

### Finding 3: Terminal Passes Empty String as Fallback Title (LOW)

**File**: `src/components/Terminal.tsx`, line 102

```typescript
const title = computeTabTitle(cwd, runningCommand, '');
```

The fallback is an empty string. If both `cwd` and `runningCommand` are empty/null, `computeTabTitle` returns `''`, and the `if (title)` check on line 103 prevents calling `onTitleChange`. This means the tab title is never cleared back to the fallback "Terminal N" label from the Terminal side. The fallback is instead managed by `handleTitleChange` in TabManager, which uses `fallbackTitlesRef` to fill in the fallback. This works correctly but the indirection is non-obvious. A comment would help future maintainers.

**Severity**: Low -- works correctly, slightly surprising indirection.

### Finding 4: No Title Update During Alt-Screen Mode (OBSERVATION)

When a program enters alt-screen mode (e.g., `vim`, `htop`), the `runningCommand` state tracks the command that launched it, so the tab title correctly shows the command name (e.g., "vim"). However, if the CWD changes during alt-screen mode (unlikely but possible with some programs), the title will not update until the alt-screen exits and the command completes. This is acceptable behavior for the MVP.

---

## Test Coverage

18 new unit tests in `src/__tests__/tab-title.test.ts` covering:
- `getBasename`: Windows paths, Unix paths, trailing slashes, root path
- `getCommandName`: multi-word, single-word, leading whitespace
- `truncateTitle`: short, long, exact boundary
- `computeTabTitle`: CWD display, running command display, truncation, fallback (null and empty), revert after command, precedence, long command truncation

Test coverage for the pure utility functions is thorough. The integration testing (callback threading through TabManager -> PaneContainer -> Terminal) is covered by the existing component test infrastructure.

---

## Summary

Clean implementation with correct callback threading and proper stale-closure prevention. The title computation is extracted into a well-tested pure utility module. All findings are low severity.
