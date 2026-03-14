# Task 010: Split Panes — Vertical and Horizontal Splitting

## Context

Tabs are complete (TASK-009). Each tab renders a single `<Terminal />`. This task adds the ability to split a pane vertically or horizontally, creating a tree of panes where each leaf is an independent terminal session.

### Current State
- **`src/components/layout/TabManager.tsx`**: Each tab renders `<Terminal />` directly in a `tab-panel` div.
- **`src/components/Terminal.tsx`**: Self-contained terminal with session, blocks, input editor.
- **`src/components/layout/`**: Contains `TabBar.tsx` and `TabManager.tsx`.
- **`src/lib/types.ts`**: Has `Tab`, `Block`, `ShellType` types.

### Design

A pane tree where each node is either a **split** (container with two children) or a **leaf** (terminal):

```
Tab
└── PaneNode (root)
    ├── PaneNode (leaf) → Terminal
    └── PaneNode (split: horizontal)
        ├── PaneNode (leaf) → Terminal
        └── PaneNode (leaf) → Terminal
```

Data structure:
```typescript
type PaneNode =
  | { type: 'leaf'; id: string }
  | { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; first: PaneNode; second: PaneNode; ratio: number };
```

- `direction: 'horizontal'` — left | right (side by side)
- `direction: 'vertical'` — top | bottom (stacked)
- `ratio` — float 0-1, how much space the first child gets (default 0.5)

### Visual Layout

```
┌──────────────────────────────────────┐
│ [Tab 1] [Tab 2] [+]                 │
├──────────┬───────────────────────────┤
│          │                           │
│ Terminal │   Terminal                │
│  (pane1) │    (pane2)               │
│          │                           │
│          ├───────────────────────────┤
│          │                           │
│          │   Terminal                │
│          │    (pane3)               │
│          │                           │
└──────────┴───────────────────────────┘
```

### Focus Management

One pane is "focused" at a time. The focused pane:
- Has a visible border accent (`#89b4fa`)
- Receives keyboard input (its InputEditor has focus)
- Is the target for split/close pane operations

## Requirements

### Frontend (React/TypeScript)

#### 1. Pane data types

Add to `src/lib/types.ts`:

```typescript
export type PaneDirection = 'horizontal' | 'vertical';

export type PaneNode =
  | { type: 'leaf'; id: string }
  | { type: 'split'; id: string; direction: PaneDirection; first: PaneNode; second: PaneNode; ratio: number };
```

Update `Tab`:
```typescript
export interface Tab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;  // NEW: root of the pane tree
}
```

#### 2. PaneContainer component

Create `src/components/layout/PaneContainer.tsx`:

A recursive component that renders the pane tree:

```tsx
interface PaneContainerProps {
  node: PaneNode;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: PaneDirection) => void;
  onClosePane: (paneId: string) => void;
}

function PaneContainer({ node, focusedPaneId, onFocusPane, onSplitPane, onClosePane }: PaneContainerProps) {
  if (node.type === 'leaf') {
    return (
      <div
        className={`pane-leaf ${node.id === focusedPaneId ? 'pane-focused' : ''}`}
        onClick={() => onFocusPane(node.id)}
        data-testid={`pane-${node.id}`}
      >
        <Terminal />
        <div className="pane-actions">
          <button onClick={() => onSplitPane(node.id, 'horizontal')} title="Split Right">⎸</button>
          <button onClick={() => onSplitPane(node.id, 'vertical')} title="Split Down">⎯</button>
          <button onClick={() => onClosePane(node.id)} title="Close Pane">✕</button>
        </div>
      </div>
    );
  }

  // Split node
  return (
    <div
      className={`pane-split pane-split-${node.direction}`}
      style={{
        flexDirection: node.direction === 'horizontal' ? 'row' : 'column',
      }}
    >
      <div style={{ flex: node.ratio }}>
        <PaneContainer node={node.first} {...props} />
      </div>
      <div className="pane-divider" />
      <div style={{ flex: 1 - node.ratio }}>
        <PaneContainer node={node.second} {...props} />
      </div>
    </div>
  );
}
```

#### 3. Pane tree operations (pure functions)

Create `src/lib/pane-utils.ts`:

```typescript
/** Split a leaf pane into two panes */
export function splitPane(root: PaneNode, paneId: string, direction: PaneDirection): PaneNode { ... }

/** Remove a leaf pane, collapsing its parent split */
export function closePane(root: PaneNode, paneId: string): PaneNode | null { ... }

/** Find a leaf by ID */
export function findPane(root: PaneNode, paneId: string): PaneNode | null { ... }

/** Count leaf panes */
export function countLeaves(root: PaneNode): number { ... }

/** Get all leaf IDs */
export function getLeafIds(root: PaneNode): string[] { ... }
```

`splitPane`: Finds the leaf with `paneId`, replaces it with a split node containing the original leaf and a new leaf.

`closePane`: Finds the leaf with `paneId`, removes it, and collapses the parent split (the sibling becomes the parent's replacement). If it's the last pane, returns `null` (caller decides what to do).

#### 4. Update TabManager

Replace the direct `<Terminal />` rendering with `<PaneContainer />`:

```tsx
// Before:
<Terminal />

// After:
<PaneContainer
  node={tab.paneRoot}
  focusedPaneId={focusedPaneId}
  onFocusPane={handleFocusPane}
  onSplitPane={(paneId, dir) => handleSplitPane(tab.id, paneId, dir)}
  onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
/>
```

TabManager state additions:
- `focusedPaneId: string | null` — tracks which pane is focused (across all tabs)

TabManager handlers:
- `handleSplitPane(tabId, paneId, direction)`: Update the tab's `paneRoot` using `splitPane()`
- `handleClosePane(tabId, paneId)`: Update the tab's `paneRoot` using `closePane()`. If the closed pane was the last in the tab, close the tab itself (or keep one pane).
- `handleFocusPane(paneId)`: Set `focusedPaneId`

Initial tab creation: `paneRoot: { type: 'leaf', id: crypto.randomUUID() }`

#### 5. Keyboard shortcuts

Add to TabManager's keyboard handler:
- **Ctrl+Shift+Right** or **Ctrl+\\**: Split focused pane horizontally (right)
- **Ctrl+Shift+Down** or **Ctrl+-**: Split focused pane vertically (down)
- **Ctrl+Shift+W**: Close focused pane (different from Ctrl+W which closes tab)

#### 6. Focus visual indicator

The focused pane gets a visible left border:
```css
.pane-focused {
  border-left: 2px solid #89b4fa;
}
```

Non-focused panes get no special border.

#### 7. Pane action buttons

Small floating buttons in the top-right corner of each pane, visible on hover:
- Split Right (⎸)
- Split Down (⎯)
- Close Pane (✕)

Close pane button hidden if it's the only pane in the tab.

#### 8. Styles

Add to `src/App.css`:

```css
.pane-leaf {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 200px;
  min-height: 100px;
  border: 1px solid transparent;
}

.pane-focused {
  border-left: 2px solid #89b4fa;
}

.pane-split {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.pane-divider {
  background-color: #313244;
  flex-shrink: 0;
}

.pane-split-horizontal > .pane-divider {
  width: 4px;
  cursor: col-resize;
}

.pane-split-vertical > .pane-divider {
  height: 4px;
  cursor: row-resize;
}

.pane-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 2px;
  z-index: 10;
}

.pane-leaf:hover .pane-actions {
  display: flex;
}

.pane-action-btn {
  padding: 2px 6px;
  border: none;
  border-radius: 3px;
  background: #313244;
  color: #a6adc8;
  font-size: 11px;
  cursor: pointer;
}

.pane-action-btn:hover {
  background: #45475a;
  color: #cdd6f4;
}
```

Note: Draggable divider resizing is deferred — the ratio stays at 0.5 for now. Users can split but not resize. Drag-to-resize can be added as an enhancement.

### Backend (Rust)

No Rust changes. Each pane's Terminal creates its own session independently.

### IPC Contract

Unchanged.

## Tests (Write These FIRST)

### Pane Utility Tests (`src/__tests__/pane-utils.test.ts`)

- [ ] **`test_splitPane_horizontal`**: Start with a single leaf. Split it horizontally. Assert result is a split node with direction `horizontal`, containing the original leaf and a new leaf.
- [ ] **`test_splitPane_vertical`**: Same as above but vertical.
- [ ] **`test_splitPane_nested`**: Split a leaf, then split one of the children. Assert 3 leaves total.
- [ ] **`test_closePane_collapses_parent`**: Create a split with 2 leaves. Close one. Assert the result is a single leaf (the surviving sibling).
- [ ] **`test_closePane_last_returns_null`**: Close the only leaf. Assert returns `null`.
- [ ] **`test_countLeaves`**: Build a tree with 3 leaves. Assert `countLeaves` returns 3.
- [ ] **`test_getLeafIds`**: Build a tree with 3 leaves. Assert `getLeafIds` returns all 3 IDs.
- [ ] **`test_findPane_exists`**: Build a tree, find a leaf by ID. Assert found.
- [ ] **`test_findPane_not_found`**: Search for non-existent ID. Assert null.

### PaneContainer Tests (`src/__tests__/PaneContainer.test.tsx`)

- [ ] **`test_renders_single_leaf`**: Render with a single leaf node. Assert one terminal exists.
- [ ] **`test_renders_split`**: Render with a horizontal split (2 leaves). Assert two terminal areas exist.
- [ ] **`test_focused_pane_has_indicator`**: Render with focusedPaneId set. Assert the focused pane has the `pane-focused` class.
- [ ] **`test_click_pane_calls_onFocusPane`**: Click a pane. Assert `onFocusPane` called with the pane's ID.
- [ ] **`test_split_button_calls_onSplitPane`**: Hover a pane, click split button. Assert `onSplitPane` called.

### TabManager Updates (`src/__tests__/TabManager.test.tsx`)

- [ ] **`test_split_pane_creates_two_terminals`**: Start with 1 tab. Split the pane. Assert 2 terminal areas visible.
- [ ] **`test_close_pane_removes_split`**: Split a pane (2 terminals), close one. Assert back to 1 terminal.

## Acceptance Criteria

- [ ] All tests above written and passing
- [ ] `PaneNode` type and utility functions in `pane-utils.ts`
- [ ] `PaneContainer` component recursively renders pane tree
- [ ] Split pane creates a new terminal in the new pane
- [ ] Close pane removes the pane and collapses the split
- [ ] Focused pane has visual indicator (blue left border)
- [ ] Pane action buttons (split right, split down, close) visible on hover
- [ ] Can't close the last pane in a tab
- [ ] Keyboard shortcuts: Ctrl+Shift+Right (split h), Ctrl+Shift+Down (split v), Ctrl+Shift+W (close pane)
- [ ] Each pane's Terminal is independent (own session, blocks, input)
- [ ] Existing tab tests still pass
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Manual test: Split a pane, type different commands in each, both produce output independently
- [ ] Clean commit: `feat: add split panes with independent terminal sessions per pane`

## Security Notes

- No new IPC surface. Each pane's Terminal uses existing commands.
- Pane IDs use `crypto.randomUUID()`.
- Total panes bounded by MAX_SESSIONS=20 (same as tabs).

## Files to Read First

- `src/components/layout/TabManager.tsx` — Update to use PaneContainer
- `src/components/Terminal.tsx` — Rendered inside each leaf pane (no changes needed)
- `src/lib/types.ts` — Add PaneNode, PaneDirection, update Tab
- `src/components/layout/` — Create PaneContainer.tsx
- `src/App.css` — Add pane styles
- `src/__tests__/TabManager.test.tsx` — Update/extend tests
