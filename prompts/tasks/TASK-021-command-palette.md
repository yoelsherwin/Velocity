# Task 021: Command Palette (Ctrl+Shift+P)

## Context

Velocity needs a command palette — a fuzzy-search overlay that lets users discover and trigger all available actions and their keyboard shortcuts. This is P0-4 in the Phase 1 roadmap. Every modern IDE and terminal (VS Code, Warp, Hyper) has one. It's the primary discoverability mechanism.

### What exists now

- **TabManager.tsx** (`src/components/layout/TabManager.tsx`, 257 lines): Manages tabs, panes, and global keyboard shortcuts (Ctrl+T, Ctrl+W, Ctrl+Shift+Right, Ctrl+Shift+Down, Ctrl+Shift+W). Has `settingsOpen` state. Renders `TabBar`, `PaneContainer` per tab, and `SettingsModal`.
- **TabBar.tsx** (`src/components/layout/TabBar.tsx`, 65 lines): Tab buttons + new tab (+) + settings gear icon.
- **PaneContainer.tsx** (`src/components/layout/PaneContainer.tsx`, 185 lines): Recursive pane tree rendering. Each leaf renders a `<Terminal />`. Has split/close pane buttons on hover.
- **Terminal.tsx** (`src/components/Terminal.tsx`, 571 lines): Block management, shell switching, search integration, PTY events. Has `useSearch(blocks)` hook and renders `SearchBar`.
- **SearchBar.tsx** (`src/components/SearchBar.tsx`, 138 lines): Floating search widget. Good pattern for the palette's floating UI.
- **SettingsModal.tsx** (`src/components/SettingsModal.tsx`, 203 lines): Full-screen overlay with backdrop at z-index 1000.
- **InputEditor.tsx** (`src/components/editor/InputEditor.tsx`, 118 lines): Editor with `textareaRef` prop for external focus management.
- **BlockView.tsx** (`src/components/blocks/BlockView.tsx`, 99 lines): Copy command, copy output, rerun buttons on hover.
- **App.css** (`src/App.css`, 813 lines): Catppuccin Mocha theme. Z-index levels: pane actions=10, search bar=100, settings overlay=1000.
- **types.ts** (`src/lib/types.ts`, 50 lines): ShellType, Tab, Block, PaneNode, AppSettings, LLM_PROVIDERS.

### Existing keyboard shortcuts

| Shortcut | Action | Defined in |
|----------|--------|-----------|
| Ctrl+T | New tab | TabManager.tsx:183 |
| Ctrl+W | Close tab | TabManager.tsx:188 |
| Ctrl+Shift+Right / Ctrl+\ | Split pane right | TabManager.tsx:194 |
| Ctrl+Shift+Down | Split pane down | TabManager.tsx:203 |
| Ctrl+Shift+W | Close pane | TabManager.tsx:210 |
| Ctrl+Shift+F | Find in output | Terminal.tsx:400 |
| Enter | Submit command | InputEditor.tsx:27 |
| Tab | Accept ghost text / indent | InputEditor.tsx:30 |
| Arrow Up/Down | History navigation | InputEditor.tsx:50,62 |
| Escape | Close search | SearchBar.tsx:42 |
| Enter/F3 | Next search match | SearchBar.tsx:48,54 |
| Shift+Enter/Shift+F3 | Previous search match | SearchBar.tsx:45,51 |

### All user-triggerable actions (18 actions)

**Tab/Pane management:**
1. New Tab (Ctrl+T)
2. Close Tab (Ctrl+W)
3. Split Pane Right (Ctrl+Shift+Right)
4. Split Pane Down (Ctrl+Shift+Down)
5. Close Pane (Ctrl+Shift+W)

**Search:**
6. Find in Output (Ctrl+Shift+F)

**Settings:**
7. Open Settings

**Shell switching:**
8. Switch to PowerShell
9. Switch to CMD
10. Switch to WSL

**Terminal:**
11. Restart Session
12. Toggle AI/CLI Mode

**No existing shortcut (palette-only):**
13. Copy Last Command
14. Copy Last Output
15. Clear Terminal (clear all blocks)
16. Command Palette (Ctrl+Shift+P — self-referential, to re-focus)

## Requirements

### Overview

A VS Code-style command palette: a centered overlay with a text input at the top, a filtered list of commands below, and keyboard navigation. Triggered by Ctrl+Shift+P. Entirely frontend — no Rust changes.

### Frontend (React/TypeScript)

#### 1. Command Registry (`src/lib/commands.ts`)

A static registry of all available commands:

```typescript
interface Command {
  id: string;                    // Unique identifier, e.g. 'tab.new'
  title: string;                 // Display text, e.g. 'New Tab'
  shortcut?: string;             // Display shortcut, e.g. 'Ctrl+T'
  category: string;              // Group label, e.g. 'Tab', 'Pane', 'Search', 'Terminal', 'Settings'
  keywords?: string[];           // Additional search terms, e.g. ['create', 'add']
}

const COMMANDS: Command[] = [
  { id: 'tab.new', title: 'New Tab', shortcut: 'Ctrl+T', category: 'Tab' },
  { id: 'tab.close', title: 'Close Tab', shortcut: 'Ctrl+W', category: 'Tab' },
  { id: 'pane.splitRight', title: 'Split Pane Right', shortcut: 'Ctrl+Shift+Right', category: 'Pane' },
  { id: 'pane.splitDown', title: 'Split Pane Down', shortcut: 'Ctrl+Shift+Down', category: 'Pane' },
  { id: 'pane.close', title: 'Close Pane', shortcut: 'Ctrl+Shift+W', category: 'Pane' },
  { id: 'search.find', title: 'Find in Output', shortcut: 'Ctrl+Shift+F', category: 'Search' },
  { id: 'settings.open', title: 'Open Settings', category: 'Settings' },
  { id: 'shell.powershell', title: 'Switch to PowerShell', category: 'Terminal', keywords: ['shell'] },
  { id: 'shell.cmd', title: 'Switch to CMD', category: 'Terminal', keywords: ['shell', 'command prompt'] },
  { id: 'shell.wsl', title: 'Switch to WSL', category: 'Terminal', keywords: ['shell', 'linux', 'ubuntu'] },
  { id: 'terminal.restart', title: 'Restart Session', category: 'Terminal', keywords: ['reset'] },
  { id: 'terminal.toggleMode', title: 'Toggle AI/CLI Mode', category: 'Terminal', keywords: ['agent', 'natural language'] },
  { id: 'terminal.clear', title: 'Clear Terminal', category: 'Terminal', keywords: ['reset', 'clean'] },
  { id: 'terminal.copyLastCommand', title: 'Copy Last Command', category: 'Terminal' },
  { id: 'terminal.copyLastOutput', title: 'Copy Last Output', category: 'Terminal' },
  { id: 'palette.open', title: 'Command Palette', shortcut: 'Ctrl+Shift+P', category: 'General' },
];
```

The registry is static data only — no action callbacks. Actions are dispatched by ID.

#### 2. Command Palette Component (`src/components/CommandPalette.tsx`)

A centered overlay with:

- **Backdrop**: Semi-transparent dark overlay (like SettingsModal but lighter: `rgba(0, 0, 0, 0.3)`). Click outside closes.
- **Dialog**: Positioned at top-center of the window (not vertically centered — top ~20% like VS Code). Max width 500px.
- **Input**: Auto-focused text input with placeholder "Type a command...". The `>` prefix character is displayed before the input (visual only, not in the input value).
- **Results list**: Filtered commands shown below the input. Each item shows:
  - Command title (bold the matched characters for visual fuzzy match feedback)
  - Category label (right-aligned, muted color)
  - Shortcut badge (if exists, right-aligned, monospace, muted)
- **Selection**: Arrow Up/Down moves a highlighted selection. Enter executes the selected command. Mouse click also executes.
- **Empty state**: If the query matches nothing, show "No matching commands".

Keyboard shortcuts within the palette:
- `Arrow Up/Down`: Navigate the filtered list
- `Enter`: Execute selected command and close palette
- `Escape`: Close palette without executing
- `Ctrl+Shift+P`: When palette is already open, close it (toggle behavior)

The palette must render at **z-index 500** — above the search bar (100) but below the settings modal (1000).

#### 3. Fuzzy Match (`src/lib/fuzzy.ts`)

A simple fuzzy matching function:

```typescript
interface FuzzyResult {
  command: Command;
  score: number;           // Higher = better match
  matchedIndices: number[]; // Indices in title that matched (for bold highlighting)
}

function fuzzyMatch(query: string, commands: Command[]): FuzzyResult[]
```

**Algorithm**:
1. If query is empty, return all commands (no filtering) sorted by category.
2. For each command, check if all query characters appear in order in the title (case-insensitive). Also check `keywords` array.
3. Score based on: consecutive matches (bonus), match at word start (bonus), shorter title (bonus).
4. Return sorted by score descending.
5. This is a simple implementation — no need for a library.

#### 4. Action Dispatch

The palette needs to execute actions when a command is selected. Since actions are spread across TabManager, Terminal, and PaneContainer, the palette needs a dispatch mechanism.

**Approach**: The palette lives in TabManager (same level as SettingsModal). TabManager already has handlers for tab/pane operations. For Terminal-level actions (shell switch, restart, search, mode toggle, clear, copy), pass a callback down through PaneContainer to the focused Terminal.

```typescript
// In TabManager:
const handlePaletteAction = useCallback((commandId: string) => {
  switch (commandId) {
    case 'tab.new': handleNewTab(); break;
    case 'tab.close': handleCloseTab(); break;
    case 'pane.splitRight': handleSplitPane(activeTabId, focusedPaneId, 'horizontal'); break;
    case 'pane.splitDown': handleSplitPane(activeTabId, focusedPaneId, 'vertical'); break;
    case 'pane.close': handleClosePane(activeTabId, focusedPaneId); break;
    case 'settings.open': setSettingsOpen(true); break;
    case 'palette.open': /* no-op, already open */ break;
    // Terminal-level actions dispatched via ref/callback to focused Terminal
    default: dispatchToFocusedTerminal(commandId); break;
  }
}, [...]);
```

For terminal-level actions, use a callback prop passed through PaneContainer to Terminal. Terminal registers a handler that TabManager can call:

```typescript
// Option A: Callback ref pattern
// TabManager holds a ref to the focused terminal's action handler
// PaneContainer passes it down, Terminal registers itself on focus

// Option B: Custom event
// TabManager dispatches a custom DOM event, Terminal listens for it
// Simpler but less React-idiomatic

// Option C: Lift terminal actions
// Terminal exposes action handlers upward via a ref callback
// TabManager calls them directly
```

Use **Option B (custom event)** for simplicity: `document.dispatchEvent(new CustomEvent('velocity:command', { detail: { commandId } }))`. Terminal listens for this event and handles terminal-level commands. This avoids complex prop threading for a one-way fire-and-forget action.

#### 5. Integration in TabManager.tsx

- Add `paletteOpen` state (boolean).
- Add Ctrl+Shift+P to the global keyboard handler (toggle: open if closed, close if open).
- Render `<CommandPalette>` when `paletteOpen` is true, above PaneContainer.
- Pass `onExecute={handlePaletteAction}` and `onClose={() => setPaletteOpen(false)}`.
- Close search bar when opening palette (if search is open in any terminal).

#### 6. Integration in Terminal.tsx

- Listen for `velocity:command` custom events.
- Handle terminal-level commands: `shell.powershell`, `shell.cmd`, `shell.wsl`, `terminal.restart`, `terminal.toggleMode`, `terminal.clear`, `terminal.copyLastCommand`, `terminal.copyLastOutput`, `search.find`.
- `terminal.clear`: Reset blocks to empty array (or just the welcome block).
- `terminal.copyLastCommand`: Find last block with a non-empty command, copy to clipboard.
- `terminal.copyLastOutput`: Find last block with non-empty output, copy stripped output to clipboard.
- Only the focused terminal should respond. Check if the terminal's pane is focused before handling.

### IPC Contract

**No new IPC commands.** This is entirely a frontend feature.

### Performance Considerations

- The command list is static and small (~16 items). No debouncing needed.
- Fuzzy matching on 16 items is instant.
- The palette unmounts completely when closed (like SearchBar).
- No heavy computation — this is a lightweight UI component.

## Tests (Write These FIRST)

### Frontend Tests (Vitest)

**Fuzzy match tests** (`src/__tests__/fuzzy.test.ts`):
- [ ] `test_fuzzy_empty_query_returns_all_commands`: Empty query returns all commands.
- [ ] `test_fuzzy_exact_match_scores_highest`: Exact title match ("New Tab") scores higher than partial.
- [ ] `test_fuzzy_partial_match`: Query "ntab" matches "New Tab" (n, t, a, b in order).
- [ ] `test_fuzzy_case_insensitive`: Query "new tab" matches "New Tab".
- [ ] `test_fuzzy_no_match_returns_empty`: Query "zzzzz" returns no results.
- [ ] `test_fuzzy_keyword_match`: Query "linux" matches "Switch to WSL" via keywords.
- [ ] `test_fuzzy_matched_indices_correct`: Matched character indices are returned correctly for highlighting.
- [ ] `test_fuzzy_word_start_bonus`: Query "sp" scores "Split Pane Right" higher than "Restart Session" (s and p at word starts vs mid-word).

**CommandPalette component tests** (`src/__tests__/CommandPalette.test.tsx`):
- [ ] `test_palette_renders_when_open`: Component renders input and command list.
- [ ] `test_palette_autofocuses_input`: Input element is focused on mount.
- [ ] `test_palette_filters_on_type`: Typing in input filters the command list.
- [ ] `test_palette_arrow_down_selects_next`: Arrow Down moves selection to next item.
- [ ] `test_palette_arrow_up_selects_previous`: Arrow Up moves selection to previous item.
- [ ] `test_palette_enter_executes_selected`: Enter key calls onExecute with selected command ID.
- [ ] `test_palette_escape_closes`: Escape key calls onClose without executing.
- [ ] `test_palette_click_executes_command`: Clicking a command item calls onExecute.
- [ ] `test_palette_shows_shortcuts`: Commands with shortcuts display the shortcut badge.
- [ ] `test_palette_shows_categories`: Category labels are displayed for each command.
- [ ] `test_palette_no_results_message`: When query matches nothing, shows "No matching commands".
- [ ] `test_palette_backdrop_click_closes`: Clicking the backdrop (outside dialog) calls onClose.
- [ ] `test_palette_selection_wraps`: Arrow Down from last item wraps to first; Arrow Up from first wraps to last.

**Integration tests** (`src/__tests__/TabManager.test.tsx` or new file):
- [ ] `test_ctrl_shift_p_opens_palette`: Simulate Ctrl+Shift+P, verify CommandPalette appears in DOM.
- [ ] `test_ctrl_shift_p_toggles_palette`: Open with Ctrl+Shift+P, press again to close.
- [ ] `test_palette_executes_new_tab`: Open palette, select "New Tab", verify tab count increases.

### E2E Tests (Playwright)

- [ ] `test_e2e_command_palette`: Open app, press Ctrl+Shift+P, type "new tab", press Enter, verify a new tab appears. Press Ctrl+Shift+P again, type "close", press Enter, verify tab closes.

**Rust tests**: Not required — no Rust changes in this task.

### When is each test type REQUIRED?

| Test Type | Required When | This Task |
|-----------|--------------|-----------|
| Rust Integration | Task touches PTY, IPC, ANSI | **SKIP — frontend-only** |
| Rust Unit | Task adds Rust logic | **SKIP — frontend-only** |
| Frontend (Vitest) | Task adds/changes UI components or hooks | **REQUIRED** |
| E2E (Playwright) | Task changes user-visible behavior | **REQUIRED** |

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] Ctrl+Shift+P opens the command palette overlay
- [ ] Typing filters commands with fuzzy matching
- [ ] Matched characters are visually highlighted in results
- [ ] Arrow Up/Down navigates the list with visible selection highlight
- [ ] Enter executes the selected command and closes the palette
- [ ] Escape closes the palette without executing
- [ ] Clicking a command executes it
- [ ] Clicking the backdrop closes the palette
- [ ] All 16 commands are listed and functional
- [ ] Shortcuts are displayed as badges next to commands
- [ ] Categories are shown for each command
- [ ] "No matching commands" shown when nothing matches
- [ ] Palette renders above search bar but below settings modal (z-index 500)
- [ ] Focus returns to the previously focused element after closing
- [ ] `terminal.clear`, `terminal.copyLastCommand`, `terminal.copyLastOutput` work correctly
- [ ] `npm run test` passes (all existing + new tests)
- [ ] `cargo test` passes (no regressions)
- [ ] Clean commit: `feat: add command palette with Ctrl+Shift+P`

## Files to Read First

- `src/components/layout/TabManager.tsx` — Where the palette lives, global keyboard handler, tab/pane handlers
- `src/components/layout/PaneContainer.tsx` — How props flow from TabManager to Terminal
- `src/components/Terminal.tsx` — Terminal actions, search integration pattern
- `src/components/SearchBar.tsx` — Floating UI pattern reference
- `src/components/SettingsModal.tsx` — Modal overlay pattern reference
- `src/lib/types.ts` — All type definitions
- `src/App.css` — Styling patterns, z-index hierarchy, color scheme
- `src/__tests__/Terminal.test.tsx` — Existing test patterns
- `src/__tests__/SearchBar.test.tsx` — Component test patterns
