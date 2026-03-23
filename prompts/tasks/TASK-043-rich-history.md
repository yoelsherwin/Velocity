# Task 043: Rich History (P1-I1)

## Context
Command history currently stores only the command text. Users can't see which directory a command was run in, what exit code it produced, or what git branch was active. Rich history makes the history search (Ctrl+R) and future history panel much more useful.

## Requirements
### Frontend only (history is in-memory + session file).

1. **Rich history entry type**:
```typescript
interface HistoryEntry {
  command: string;
  timestamp: number;
  exitCode?: number;
  cwd?: string;
  gitBranch?: string;
  shellType: ShellType;
}
```

2. **Update `useCommandHistory`**: Change from `string[]` to `HistoryEntry[]`. The `addCommand` function accepts the full entry. `navigateUp`/`navigateDown` still return command strings for the input editor.

3. **Update history search (Ctrl+R)**: Show rich metadata in the search results — each match displays the command, CWD, exit code, and timestamp. The search still matches against command text only.

4. **Update session restore**: Save/restore `HistoryEntry[]` instead of `string[]`. Backward compatible — if old session has `string[]`, convert to `HistoryEntry[]` with command-only entries.

5. **Populate metadata**: In Terminal.tsx, when adding to history after a command completes, include CWD, exit code, git branch, and shell type from the current state.

## Tests
- [ ] `test_rich_history_stores_metadata`: Adding a command stores exit code, CWD, timestamp.
- [ ] `test_history_navigation_returns_command_string`: Up/Down still returns the command text.
- [ ] `test_history_search_shows_metadata`: History search displays CWD and exit code.
- [ ] `test_backward_compat_string_history`: Old `string[]` history converted to `HistoryEntry[]`.
- [ ] `test_history_entry_serialization`: Rich entries serialize/deserialize for session persistence.

## Files to Read First
- `src/hooks/useCommandHistory.ts` — current history hook
- `src/components/HistorySearch.tsx` — history search UI
- `src/components/Terminal.tsx` — where addCommand is called
- `src/lib/session.ts` — session types for persistence

## Acceptance Criteria
- [ ] History stores command + metadata (timestamp, exitCode, cwd, gitBranch, shellType)
- [ ] History navigation still works (returns command text)
- [ ] History search shows rich metadata
- [ ] Session restore backward compatible
- [ ] All tests pass
- [ ] Commit: `feat: add rich history with exit codes, CWD, and git branch`
