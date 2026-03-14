# Task 009: Tabbed Interface with Independent Sessions

## Context

Currently `App.tsx` renders a single `<Terminal />` component. There is no way to have multiple terminals open. Pillar 4 adds tabbed workspaces where each tab owns an independent shell session.

This task covers sub-tasks 4a (tabbed interface), 4c (focus management), and 4d (independent sessions per tab). Split panes (4b) are deferred to a follow-up task.

### Current State
- **`src/App.tsx`**: Renders `<main className="container"><Terminal /></main>`
- **`src/components/Terminal.tsx`**: Self-contained — manages its own session, blocks, input, shell type. Creates a session on mount, cleans up on unmount.
- **`src/components/layout/`**: Empty directory with `.gitkeep`.
- **`src/lib/types.ts`**: `ShellType`, `Block`, `SessionInfo` types.

### Design

```
┌──────────────────────────────────────────────┐
│ [Tab 1 ✕] [Tab 2 ✕] [Tab 3 ✕] [+]          │  ← TabBar
├──────────────────────────────────────────────┤
│                                              │
│            <Terminal />                      │  ← Active tab's terminal
│                                              │
└──────────────────────────────────────────────┘
```

Key principle: **each tab IS a `<Terminal />` component.** The Terminal component is already self-contained (manages its own session lifecycle, blocks, input). Tabs just mount/unmount Terminal instances.

**BUT** — we don't want to destroy the terminal when switching tabs. The session and output should persist. So we render ALL tab terminals but only SHOW the active one (CSS `display: none` on inactive tabs). This preserves React state and PTY sessions across tab switches.

## Requirements

### Frontend (React/TypeScript)

#### 1. Tab data structure

Add to `src/lib/types.ts`:

```typescript
export interface Tab {
  id: string;
  title: string;       // Display name (e.g., "PowerShell 1", "CMD 2")
  shellType: ShellType; // Initial shell type for this tab
}
```

#### 2. TabBar component

Create `src/components/layout/TabBar.tsx`:

Props:
```typescript
interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}
```

Renders a horizontal bar with:
- Tab buttons showing the tab title, with an `✕` close button on each
- Active tab visually highlighted (bottom border accent, brighter text)
- A `+` button at the end to create a new tab
- Keyboard: no special keyboard nav needed for MVP
- If only 1 tab remains, the `✕` close button is hidden (can't close the last tab)

Styling:
- Dark background matching existing theme (`#1e1e2e`)
- Tab buttons: `#313244` background, `#a6adc8` text
- Active tab: bottom border `#89b4fa`, brighter text `#cdd6f4`
- Close button: small `✕`, appears on hover, `#f38ba8` on hover
- `+` button: same style as tabs but with `+` text

#### 3. TabManager component

Create `src/components/layout/TabManager.tsx`:

This is the top-level layout component that replaces the direct `<Terminal />` in App.tsx.

State:
```typescript
const [tabs, setTabs] = useState<Tab[]>([initialTab]);
const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);
```

Behavior:
- **New tab**: Creates a new `Tab` with a unique ID, default shell type (`powershell`), and auto-generated title (e.g., "PowerShell 1", "PowerShell 2" — increment counter)
- **Close tab**: Removes the tab from the list. If closing the active tab, switch to the previous tab (or next if first). If it's the last tab, don't close (the `✕` button should be hidden anyway).
- **Select tab**: Sets `activeTabId`. The terminal for that tab becomes visible.
- **Initial state**: One tab open with PowerShell.

Rendering:
```tsx
<div className="tab-manager">
  <TabBar
    tabs={tabs}
    activeTabId={activeTabId}
    onSelectTab={setActiveTabId}
    onCloseTab={handleCloseTab}
    onNewTab={handleNewTab}
  />
  <div className="tab-content">
    {tabs.map(tab => (
      <div
        key={tab.id}
        className="tab-panel"
        style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        data-testid={`tab-panel-${tab.id}`}
      >
        <Terminal key={tab.id} />
      </div>
    ))}
  </div>
</div>
```

**Important**: Use `display: none` (not conditional rendering) so that inactive terminals keep their React state, PTY session, and output buffer. When the user switches back, everything is preserved.

#### 4. Update App.tsx

Replace `<Terminal />` with `<TabManager />`:

```tsx
import TabManager from "./components/layout/TabManager";

function App() {
  return (
    <main className="container">
      <TabManager />
    </main>
  );
}
```

#### 5. Tab titles from shell type

When a tab is created, its title should reflect the shell type:
- PowerShell → "PowerShell 1", "PowerShell 2", etc.
- CMD → "CMD 1", etc.
- WSL → "WSL 1", etc.

Use a simple counter per shell type, or just a global counter: "Terminal 1", "Terminal 2".

For MVP, use global counter: "Terminal 1", "Terminal 2", "Terminal 3".

#### 6. Keyboard shortcut: Ctrl+T for new tab

In `TabManager`, add a global `keydown` listener:
- **Ctrl+T**: Create new tab (prevent default browser new-tab behavior)
- **Ctrl+W**: Close active tab (prevent default browser close-tab behavior, but only if more than 1 tab)

#### 7. Styles

Add to `src/App.css`:

```css
.tab-manager {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.tab-bar {
  display: flex;
  align-items: center;
  background-color: #181825;
  border-bottom: 1px solid #313244;
  min-height: 36px;
  overflow-x: auto;
}

.tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #a6adc8;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.tab-button:hover {
  background-color: #313244;
  color: #cdd6f4;
}

.tab-button-active {
  color: #cdd6f4;
  border-bottom-color: #89b4fa;
}

.tab-close {
  /* small × button */
  font-size: 14px;
  line-height: 1;
  color: #6c7086;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
}

.tab-close:hover {
  color: #f38ba8;
  background-color: rgba(243, 139, 168, 0.1);
}

.tab-new {
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: #6c7086;
  font-size: 16px;
  cursor: pointer;
}

.tab-new:hover {
  color: #cdd6f4;
  background-color: #313244;
}

.tab-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.tab-panel {
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
```

### Backend (Rust)

No Rust changes. Each tab's Terminal component creates its own session independently. The `SessionManager` already supports multiple concurrent sessions (up to `MAX_SESSIONS = 20`).

### IPC Contract

Unchanged. Each Terminal instance calls the same `create_session`, `start_reading`, `write_to_session`, `close_session` commands independently.

## Tests (Write These FIRST)

### TabBar Tests (`src/__tests__/TabBar.test.tsx`)

- [ ] **`test_renders_tabs`**: Render `<TabBar>` with 2 tabs. Assert both tab titles are visible.
- [ ] **`test_active_tab_highlighted`**: Render with `activeTabId` set. Assert the active tab has the active class/aria.
- [ ] **`test_click_tab_calls_onSelectTab`**: Click an inactive tab. Assert `onSelectTab` called with the tab's ID.
- [ ] **`test_close_button_calls_onCloseTab`**: Click the `✕` on a tab. Assert `onCloseTab` called with the tab's ID.
- [ ] **`test_close_hidden_on_single_tab`**: Render with 1 tab. Assert no close button visible.
- [ ] **`test_new_tab_button_calls_onNewTab`**: Click the `+` button. Assert `onNewTab` called.

### TabManager Tests (`src/__tests__/TabManager.test.tsx`)

- [ ] **`test_starts_with_one_tab`**: Render `<TabManager>`. Assert one tab exists with a terminal.
- [ ] **`test_new_tab_creates_terminal`**: Click `+`. Assert two tabs exist, second tab is active.
- [ ] **`test_close_tab_removes_it`**: Create 2 tabs, close one. Assert only 1 tab remains.
- [ ] **`test_cannot_close_last_tab`**: With 1 tab, assert close button is not visible.
- [ ] **`test_switching_tabs_preserves_terminal`**: Create 2 tabs, type in tab 1, switch to tab 2, switch back to tab 1. Assert tab 1's content is preserved (this tests the `display: none` approach).
- [ ] **`test_ctrl_t_creates_new_tab`**: Press Ctrl+T. Assert a new tab is created.

## Acceptance Criteria

- [ ] All tests above written and passing
- [ ] `TabBar` component renders tabs with titles, active indicator, close/new buttons
- [ ] `TabManager` manages tab list and active tab state
- [ ] Each tab renders an independent `<Terminal />` instance
- [ ] Switching tabs preserves terminal state (session, blocks, input)
- [ ] New tab opens with PowerShell by default
- [ ] Close tab kills the terminal session (Terminal unmount cleanup)
- [ ] Can't close the last tab
- [ ] Ctrl+T creates new tab, Ctrl+W closes active tab
- [ ] Tab titles auto-increment ("Terminal 1", "Terminal 2", etc.)
- [ ] Existing tests updated for new App structure
- [ ] E2E tests still pass
- [ ] `npm run test` passes
- [ ] `cargo test` passes (unchanged)
- [ ] Manual test: Open 3 tabs, type different commands in each, switch between them — all output preserved
- [ ] Clean commit: `feat: add tabbed interface with independent terminal sessions`

## Security Notes

- No new IPC surface. Each tab's Terminal uses existing commands.
- Tab close triggers Terminal unmount → `closeSession` cleanup (existing pattern).
- Tab IDs use `crypto.randomUUID()` (non-guessable, consistent with block IDs).

## Files to Read First

- `src/App.tsx` — Replace single Terminal with TabManager
- `src/components/Terminal.tsx` — Self-contained terminal (no changes needed)
- `src/components/layout/` — Create TabBar.tsx and TabManager.tsx here
- `src/lib/types.ts` — Add Tab interface
- `src/App.css` — Add tab styles
- `src/__tests__/Terminal.test.tsx` — May need wrapper updates
- `e2e/terminal-basic.spec.ts` — E2E tests may need updates for tab structure
