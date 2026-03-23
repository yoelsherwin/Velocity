# Task 030: History Search with Ctrl+R (P1-I2)

## Context

Velocity only has Up/Down arrow history navigation. Power users need Ctrl+R reverse search — type a substring and the most recent matching command appears. This is one of the most-used terminal features (bash, zsh, fish all have it).

### What exists now

- **useCommandHistory.ts** (`src/hooks/useCommandHistory.ts`, ~106 lines): Stores `history: string[]` in state. Has `navigateUp`/`navigateDown` for arrow key navigation. `addCommand(cmd)` appends to history. History is in-memory only (lost on restart).
- **InputEditor.tsx**: Arrow Up/Down calls `onNavigateUp`/`onNavigateDown`. Has `textareaRef` for focus management.
- **Terminal.tsx**: Uses `useCommandHistory()`, passes history navigation callbacks to InputEditor.
- **SearchBar.tsx**: Existing search overlay pattern (floating UI, keyboard handling).

## Requirements

### Frontend only — no Rust changes.

#### 1. History Search Panel (`src/components/HistorySearch.tsx`)

A compact overlay at the bottom of the terminal (above the InputEditor), similar to bash's Ctrl+R:

- **Input**: Text field with placeholder `"Search history..."`. Auto-focused on open.
- **Display**: Shows the best matching command (most recent match) in a highlighted format. The matching substring is bold/highlighted.
- **Navigation**:
  - Typing narrows the search
  - Ctrl+R again (while panel is open) cycles to the next older match
  - Ctrl+S cycles forward (newer match) — optional for MVP
  - Enter accepts the match (closes panel, puts command in InputEditor)
  - Escape cancels (closes panel, restores original input)
- **No results**: Shows "No matching history" when nothing matches.

#### 2. Search Logic

- Case-insensitive substring match against `history` array
- Search from most recent to oldest
- Track `matchIndex` — which match we're currently showing (0 = most recent match)
- Ctrl+R increments matchIndex (older), wrapping is optional
- When query changes, reset matchIndex to 0

#### 3. Integration in Terminal.tsx

- Add `historySearchOpen` state
- Ctrl+R keyboard handler (document-level in Terminal, like Ctrl+Shift+F)
- When history search is open, InputEditor is still visible but disabled/dimmed
- When user accepts a match (Enter), set `input` to the matched command and close
- When user cancels (Escape), restore original input and close

#### 4. Integration in InputEditor.tsx

- When history search panel is open, the InputEditor should show the currently matched command as preview text (or keep showing the original input with the search panel above it)

#### 5. Register in command palette

Add `history.search` command with shortcut `Ctrl+R`.

## Tests

- [ ] `test_history_search_finds_match`: Search "git" in history containing "git commit", "ls", "git push" → shows "git push" (most recent match).
- [ ] `test_history_search_case_insensitive`: Search "GIT" matches "git commit".
- [ ] `test_history_search_no_match`: Search "xyz" with no matches → "No matching history".
- [ ] `test_history_search_ctrl_r_cycles`: First Ctrl+R shows most recent match, second Ctrl+R shows next older match.
- [ ] `test_history_search_enter_accepts`: Enter closes panel and sets input to matched command.
- [ ] `test_history_search_escape_cancels`: Escape closes panel and restores original input.
- [ ] `test_history_search_query_resets_index`: Typing resets to most recent match.
- [ ] `test_ctrl_r_opens_history_search`: Ctrl+R opens the history search panel.
- [ ] `test_history_search_renders_highlight`: Matched substring is highlighted in the displayed command.

## Acceptance Criteria
- [ ] Ctrl+R opens history search panel
- [ ] Typing filters history by substring
- [ ] Most recent match shown first
- [ ] Ctrl+R cycles through older matches
- [ ] Enter accepts, Escape cancels
- [ ] Matched substring highlighted
- [ ] Command registered in palette
- [ ] All tests pass
- [ ] Commit: `feat: add history search with Ctrl+R`

## Files to Read First
- `src/hooks/useCommandHistory.ts` — History storage and navigation
- `src/components/Terminal.tsx` — Input state, keyboard handlers
- `src/components/editor/InputEditor.tsx` — Input handling
- `src/components/SearchBar.tsx` — Overlay pattern reference
- `src/App.css` — Styling patterns
- `src/lib/commands.ts` — Command palette registry
