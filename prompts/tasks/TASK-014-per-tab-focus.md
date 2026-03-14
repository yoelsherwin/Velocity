# Task 014: Per-Tab Pane Focus

## Context

Currently `focusedPaneId` is a single global state in TabManager. When switching tabs and back, the pane focus is lost — it doesn't remember which pane was focused in each tab.

### Current State
- **`src/components/layout/TabManager.tsx`**: Has `focusedPaneId` as a single state variable. When switching tabs, the focused pane ID may reference a pane from a different tab.

### Design

Move `focusedPaneId` into the `Tab` object so each tab remembers its focused pane independently.

## Requirements

### Frontend Changes

#### 1. Update Tab type

In `src/lib/types.ts`:
```typescript
export interface Tab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;
  focusedPaneId: string | null;  // NEW: per-tab focus
}
```

Initialize to the root leaf's ID when creating a tab.

#### 2. Update TabManager

Remove the global `focusedPaneId` state and `focusedPaneIdRef`. Instead, read/write the focused pane from the active tab:

```typescript
// Get focused pane for active tab:
const activeTab = tabs.find(t => t.id === activeTabId);
const focusedPaneId = activeTab?.focusedPaneId ?? null;

// Update focused pane:
const handleFocusPane = useCallback((paneId: string) => {
  setTabs(prev => prev.map(t =>
    t.id === activeTabIdRef.current ? { ...t, focusedPaneId: paneId } : t
  ));
}, []);
```

When splitting a pane, auto-focus the new pane. When closing a pane, if the closed pane was focused, focus the sibling.

#### 3. Update keyboard shortcuts

The Ctrl+Shift+W (close pane) and Ctrl+Shift+Right/Down (split) shortcuts need to read `focusedPaneId` from the active tab. Use a ref that stays in sync:

```typescript
const focusedPaneIdRef = useRef<string | null>(null);
// Sync from active tab:
useEffect(() => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  focusedPaneIdRef.current = activeTab?.focusedPaneId ?? null;
}, [tabs, activeTabId]);
```

## Tests (Write These FIRST)

### TabManager Tests (`src/__tests__/TabManager.test.tsx`)
- [ ] **`test_focus_preserved_across_tab_switch`**: Create 2 tabs, each with 2 panes. Focus pane 2 in tab 1. Switch to tab 2, focus pane 1. Switch back to tab 1. Assert pane 2 is still focused.
- [ ] **`test_split_focuses_new_pane`**: Split a pane. Assert the new pane (not the original) is focused.
- [ ] **`test_close_pane_focuses_sibling`**: Have 2 panes, close the focused one. Assert the remaining pane is focused.

## Acceptance Criteria
- [ ] Each tab remembers its own focused pane
- [ ] Switching tabs restores the per-tab focus
- [ ] Split auto-focuses the new pane
- [ ] Close pane focuses the sibling
- [ ] Keyboard shortcuts use per-tab focus
- [ ] All tests pass
- [ ] Clean commit: `feat: per-tab pane focus management`

## Files to Read First
- `src/components/layout/TabManager.tsx` — Refactor focus management
- `src/lib/types.ts` — Add focusedPaneId to Tab
- `src/__tests__/TabManager.test.tsx` — Add focus tests
