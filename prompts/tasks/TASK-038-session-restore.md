# Task 038: Session Restoration on Restart (P1-W1)

## Context

When the user closes and reopens Velocity, everything is lost — tabs, panes, command history, working directories. This task adds basic session persistence so the app restores its previous layout on startup.

### What exists now

- **TabManager.tsx**: Creates initial tab state on mount. No persistence.
- **Tab type**: `{ id, title, shellType, paneRoot, focusedPaneId }`.
- **Settings system**: JSON-based storage in `{LocalAppData}/Velocity/settings.json`.
- **Command history**: In-memory only, lost on restart.

## Requirements

### Backend (Rust) + Frontend.

#### 1. Session state file

Save session state to `{LocalAppData}/Velocity/session.json` (separate from settings). Contains:
- Tab layout (tab count, order, pane tree structure per tab)
- Shell type per pane
- CWD per pane (best effort — may be stale)
- Command history (last 100 commands per pane)
- Active tab ID

Does NOT contain: running processes, output, blocks (too large to persist).

#### 2. New Rust commands

```rust
#[tauri::command]
pub async fn save_session(state: String) -> Result<(), String>

#[tauri::command]
pub async fn load_session() -> Result<Option<String>, String>
```

Simple JSON string in/out. The frontend serializes/deserializes the session structure.

#### 3. Save triggers

Save session state:
- On tab create/close
- On pane split/close
- On shell switch
- On app close (beforeunload)
- Debounced: max once per 2 seconds to avoid excessive disk I/O

#### 4. Restore on startup

On app mount:
- Load session state
- If valid: recreate tabs and pane layout
- Each pane spawns a new shell session (can't restore running processes)
- Set CWD via shell command (`cd` to saved CWD) as the first command
- Load command history into each pane's history hook
- If invalid/missing: create default single tab (current behavior)

#### 5. Session state type

```typescript
interface SessionState {
  version: 1;
  tabs: SavedTab[];
  activeTabId: string;
}

interface SavedTab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;
  focusedPaneId: string | null;
  panes: SavedPane[];
}

interface SavedPane {
  id: string;
  shellType: ShellType;
  cwd: string;
  history: string[];
}
```

## Tests

### Rust Tests
- [ ] `test_save_session_writes_file`: Save session state, verify file exists.
- [ ] `test_load_session_reads_file`: Save then load, verify round-trip.
- [ ] `test_load_session_missing_file`: No file → returns None.
- [ ] `test_load_session_invalid_json`: Corrupt file → returns None (not error).

### Frontend Tests
- [ ] `test_session_saved_on_tab_create`: Creating a tab triggers save.
- [ ] `test_session_saved_on_tab_close`: Closing a tab triggers save.
- [ ] `test_session_restore_creates_tabs`: Load session with 3 tabs → 3 tabs created.
- [ ] `test_session_restore_creates_panes`: Load session with split panes → pane tree recreated.
- [ ] `test_session_restore_fallback`: Missing session → default single tab.
- [ ] `test_save_debounced`: Rapid changes only trigger one save.

## Acceptance Criteria
- [ ] Tabs/panes layout persisted across restarts
- [ ] Command history persisted per pane (last 100)
- [ ] CWD restored (best effort — cd on startup)
- [ ] Active tab remembered
- [ ] Graceful fallback on corrupt/missing session file
- [ ] Save debounced (max 1 write per 2s)
- [ ] All tests pass
- [ ] Commit: `feat: add session restoration on restart`

## Files to Read First
- `src/components/layout/TabManager.tsx` — Tab/pane state management
- `src/lib/types.ts` — Tab, PaneNode types
- `src-tauri/src/settings/mod.rs` — File storage pattern
- `src/hooks/useCommandHistory.ts` — History hook
- `src/components/Terminal.tsx` — CWD state, session management
