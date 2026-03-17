# Task 020: Find in Terminal Output (Ctrl+Shift+F)

## Context

Velocity currently has no way to search through terminal output. Users viewing blocks with large output (up to 500KB per block, 500 blocks max) need a way to find text. This is P0-3 in the Phase 1 roadmap — a standard terminal feature critical for daily usability.

### What exists now

- **Terminal.tsx** (`src/components/Terminal.tsx`, 463 lines): Manages `Block[]` state. Each block has `.output` (raw text with ANSI codes). Renders blocks via `BlockView`. Uses `useBlockVisibility` hook for IntersectionObserver-based visibility. Has `outputRef` pointing to the scrollable `.terminal-output` div.
- **BlockView.tsx** (`src/components/blocks/BlockView.tsx`, 98 lines): Renders a single block. Accepts `isVisible` prop — if true, renders `<AnsiOutput text={block.output} />`; if false, renders a height-estimated placeholder `<pre>`.
- **AnsiOutput.tsx** (`src/components/AnsiOutput.tsx`, 31 lines): Calls `useIncrementalAnsi(text)` which returns `AnsiSpan[]`. Renders each span as a `<span>` with style props (fg, bg, bold, italic, underline, dim). Wrapped in `React.memo`.
- **ansi.ts** (`src/lib/ansi.ts`, 64 lines): Exports `AnsiSpan` interface, `parseAnsi()`, `stripAnsi()`, `isValidRgb()`. `stripAnsi()` removes SGR sequences and returns plain text.
- **useIncrementalAnsi.ts** (`src/hooks/useIncrementalAnsi.ts`, 91 lines): Incremental ANSI parsing hook. Returns `AnsiSpan[]`. Uses prefix/suffix sampling to detect changes and avoid full reparse.
- **useBlockVisibility.ts** (`src/hooks/useBlockVisibility.ts`, 94 lines): Returns `{ visibleIds: Set<string>, observeBlock }`. Uses IntersectionObserver with 500px rootMargin.
- **TabManager.tsx** (`src/components/layout/TabManager.tsx`, 257 lines): Global keyboard handler for Ctrl+T, Ctrl+W, Ctrl+Shift+Right, Ctrl+Shift+Down, Ctrl+Shift+W. This is where Ctrl+Shift+F should be registered.
- **App.css** (`src/App.css`, 689 lines): All styling. Catppuccin Mocha theme. Relevant colors: text `#cdd6f4`, bg `#1e1e2e`, surface `#313244`, blue `#89b4fa`, yellow `#f9e2af`, peach `#fab387`.

### Key types

```typescript
// src/lib/types.ts
interface Block {
  id: string;
  command: string;
  output: string;        // Raw with ANSI codes
  timestamp: number;
  status: 'running' | 'completed';
  exitCode?: number | null;
  shellType: ShellType;
}

// src/lib/ansi.ts
interface AnsiSpan {
  content: string;
  fg?: string; bg?: string;
  bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean;
}
```

## Requirements

### Overview

A floating search bar (VS Code-style, not a full modal) that searches across all blocks in the current pane. Matches are highlighted in the output. User can navigate between matches with next/prev controls. Entirely frontend — no Rust changes.

### Frontend (React/TypeScript)

#### 1. Search Bar Component (`src/components/SearchBar.tsx`)

A compact floating widget positioned at the **top-right of the `.terminal-output` area** (not the whole window — stays within the pane). Contains:

- **Text input**: Auto-focused on open. Placeholder: "Find in output..."
- **Match counter**: "N of M" (e.g., "3 of 42"). Shows "No results" when query has no matches. Hidden when input is empty.
- **Navigation buttons**: Up arrow (previous match) and down arrow (next match). Disabled when no matches.
- **Close button**: × icon. Also closes on Escape.
- **Case sensitivity toggle**: Button with "Aa" label. Off by default (case-insensitive). Toggled state highlighted with accent color.

Keyboard shortcuts within the search bar:
- `Enter` or `F3`: Go to next match
- `Shift+Enter` or `Shift+F3`: Go to previous match
- `Escape`: Close search bar, clear all highlights
- `Ctrl+Shift+F`: When search bar is already open, re-focus the input

The search bar should NOT steal focus from the input editor when commands are being typed. Opening the search bar moves focus to the search input. Closing it returns focus to the InputEditor's textarea.

#### 2. Search Logic (`src/hooks/useSearch.ts`)

A custom hook that performs text search across blocks:

```typescript
interface SearchMatch {
  blockId: string;
  startOffset: number;  // char offset in stripped (plain text) output
  length: number;       // match length
}

interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;      // -1 if no matches
  goToNext: () => void;
  goToPrev: () => void;
  goToMatch: (index: number) => void;
  matchesByBlock: Map<string, SearchMatch[]>;  // pre-grouped for rendering
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

function useSearch(blocks: Block[]): UseSearchResult
```

**Search algorithm**:
1. For each block, compute `stripAnsi(block.output)` to get plain text.
2. Find all occurrences of the query in the plain text (case-insensitive by default).
3. Store matches as `{ blockId, startOffset, length }`.
4. Matches are ordered by block index (oldest first), then by position within the block.
5. **Debounce**: Debounce the search computation by 150ms after query changes. The query state updates immediately (for responsive typing), but the match computation is debounced.
6. **Memoization**: Cache `stripAnsi()` results per block — blocks don't change their output unless they're the active block receiving PTY events. Use a `Map<string, { output: string, stripped: string }>` keyed by `block.id` and invalidated when `block.output` changes (compare by reference or length).

#### 3. Match Highlighting in AnsiOutput

Modify `AnsiOutput.tsx` to accept optional highlight ranges:

```typescript
interface AnsiOutputProps {
  text: string;
  highlights?: { startOffset: number; length: number; isCurrent: boolean }[];
}
```

When `highlights` is provided and non-empty:
1. Walk through the `AnsiSpan[]` array, tracking a cumulative character offset.
2. For each span, check if any highlight overlaps with it.
3. If a highlight partially overlaps a span, split the span at the highlight boundaries.
4. Wrap highlighted portions in an additional `<mark>` element (or `<span>` with highlight class).
5. The "current" match (`isCurrent: true`) gets a distinct brighter highlight.

CSS classes:
- `.search-highlight`: Background `rgba(249, 226, 175, 0.3)` (Catppuccin yellow, semi-transparent) for all matches.
- `.search-highlight-current`: Background `rgba(249, 226, 175, 0.7)` for the active match. Add a subtle outline: `outline: 1px solid #f9e2af`.

**Important**: When `highlights` is undefined or empty, AnsiOutput must render exactly as it does today — no extra computation or DOM changes. The `React.memo` wrapper should compare highlights by reference to avoid unnecessary re-renders.

#### 4. Scroll-to-Match

When the current match changes (via next/prev or initial search):
1. The block containing the current match must be scrolled into view in the `.terminal-output` container.
2. The specific highlighted element within the block should be scrolled into view with `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.
3. For off-screen blocks: the block's `isVisible` state is irrelevant — the IntersectionObserver will trigger when we scroll to it, switching it from placeholder to full render. The scroll just needs to target the block container element.

Implementation: Add `data-match-current="true"` attribute to the current match's highlight element. After a state update that changes `currentMatchIndex`, use a `useEffect` to query `.search-highlight-current[data-match-current="true"]` and call `scrollIntoView` on it. If the element isn't in the DOM yet (block was a placeholder), first scroll the block container into view, wait for IntersectionObserver to trigger render, then scroll to the specific match.

#### 5. Integration in Terminal.tsx

- Add the `useSearch(blocks)` hook call.
- Render `<SearchBar>` inside the `.terminal-output` div (positioned absolutely at top-right).
- For each `BlockView`, compute and pass the highlight ranges for that block from `matchesByBlock`.
- Pass highlight ranges through `BlockView` to `AnsiOutput`.

#### 6. Integration in TabManager.tsx

Add Ctrl+Shift+F to the global keyboard handler. This needs to communicate "open search" down to the focused pane's Terminal. Options:
- The simplest approach: Add a `searchOpen` state to TabManager and pass it as a prop through PaneContainer → Terminal. Terminal watches for the prop to transition from false → true and opens its search bar.
- OR: Use a custom event/callback pattern.

Use whichever approach is simplest and consistent with the existing patterns (props flow down from TabManager through PaneContainer).

#### 7. Integration in BlockView.tsx

- Accept new optional prop `highlights?: { startOffset: number; length: number; isCurrent: boolean }[]`.
- Pass to `<AnsiOutput text={block.output} highlights={highlights} />`.
- Only pass highlights when the block actually has matches (avoid creating empty arrays).

### IPC Contract

**No new IPC commands.** This is entirely a frontend feature. The search operates on the `Block.output` strings already in React state.

### Performance Considerations

- **stripAnsi caching**: Computing `stripAnsi()` on 500KB strings is O(n) with regex. Cache the stripped result and only recompute when `block.output` changes.
- **Search debouncing**: 150ms debounce on query input. Don't re-search on every keystroke.
- **Highlight splitting**: The span-splitting logic runs only for visible blocks (blocks where `isVisible` is true). Off-screen blocks show placeholders and skip highlighting entirely.
- **Match limit**: If a query produces more than 10,000 total matches, truncate and show "10,000+ matches" in the counter. Don't try to highlight all of them — only highlight matches in visible blocks.
- **Memo boundaries**: `AnsiOutput` is `React.memo` — ensure highlight prop changes don't cause unnecessary re-renders for blocks without matches.

## Tests (Write These FIRST)

The dev agent MUST write these tests before any implementation code.

### Frontend Tests (Vitest)

**Search hook tests** (`src/__tests__/useSearch.test.ts`):
- [ ] `test_search_finds_matches_in_single_block`: Create blocks with known output, search for a substring, verify match count and positions.
- [ ] `test_search_case_insensitive_by_default`: Search "hello" matches "Hello", "HELLO", "hello".
- [ ] `test_search_case_sensitive_when_enabled`: Toggle case sensitive, "hello" does NOT match "Hello".
- [ ] `test_search_strips_ansi_before_matching`: Block output contains ANSI codes, search matches plain text content, offsets are in stripped text coordinates.
- [ ] `test_search_across_multiple_blocks`: Matches span multiple blocks, ordered by block index then position.
- [ ] `test_search_navigation_wraps_around`: goToNext from last match wraps to first; goToPrev from first wraps to last.
- [ ] `test_search_empty_query_returns_no_matches`: Empty string query produces zero matches.
- [ ] `test_search_matches_by_block_groups_correctly`: `matchesByBlock` map has correct entries per block.
- [ ] `test_search_updates_on_block_change`: When a block's output changes (new PTY data), matches are recomputed.

**AnsiOutput highlight tests** (`src/__tests__/AnsiOutput.test.tsx`):
- [ ] `test_ansi_output_renders_without_highlights`: No `highlights` prop — renders exactly as before (regression check).
- [ ] `test_ansi_output_renders_single_highlight`: One match highlighted, verify `.search-highlight` class in DOM.
- [ ] `test_ansi_output_renders_current_highlight`: Current match has `.search-highlight-current` class and `data-match-current="true"` attribute.
- [ ] `test_ansi_output_highlight_splits_span`: A highlight that starts mid-span correctly splits the span into unhighlighted + highlighted portions.
- [ ] `test_ansi_output_highlight_across_spans`: A highlight that crosses a span boundary correctly highlights portions in both spans.
- [ ] `test_ansi_output_preserves_ansi_styles_in_highlight`: Highlighted text retains its original fg/bg/bold styling.
- [ ] `test_ansi_output_multiple_highlights_in_one_block`: Multiple non-overlapping highlights in the same output.

**SearchBar component tests** (`src/__tests__/SearchBar.test.tsx`):
- [ ] `test_search_bar_renders_when_open`: Component renders input, buttons when `isOpen` is true.
- [ ] `test_search_bar_hidden_when_closed`: Component returns null when `isOpen` is false.
- [ ] `test_search_bar_escape_closes`: Pressing Escape calls the close callback.
- [ ] `test_search_bar_enter_goes_to_next`: Pressing Enter calls goToNext.
- [ ] `test_search_bar_shift_enter_goes_to_prev`: Pressing Shift+Enter calls goToPrev.
- [ ] `test_search_bar_displays_match_count`: Shows "3 of 42" format with correct numbers.
- [ ] `test_search_bar_shows_no_results`: Shows "No results" when query is non-empty but matches is empty.
- [ ] `test_search_bar_case_toggle`: Clicking Aa button toggles caseSensitive callback.

**Integration tests** (`src/__tests__/Terminal.test.tsx` — additions):
- [ ] `test_ctrl_shift_f_opens_search_bar`: Simulate Ctrl+Shift+F, verify SearchBar appears in the DOM.
- [ ] `test_search_highlights_appear_in_block_output`: Open search, type query, verify `.search-highlight` elements appear in block output.
- [ ] `test_escape_closes_search_and_clears_highlights`: Open search, type query, press Escape, verify SearchBar is gone and no highlight elements remain.

### E2E Tests (Playwright)

- [ ] `test_e2e_find_in_output`: Open app, run a command that produces output, press Ctrl+Shift+F, type a search term, verify match counter shows results, press Enter to navigate, press Escape to close.

**Rust tests**: Not required — no Rust changes in this task.

### When is each test type REQUIRED?

| Test Type | Required When | This Task |
|-----------|--------------|-----------|
| Rust Integration | Task touches PTY, IPC, process management, ANSI | **SKIP — frontend-only** |
| Rust Unit | Task adds any Rust logic | **SKIP — frontend-only** |
| Frontend (Vitest) | Task adds/changes UI components or hooks | **REQUIRED** |
| E2E (Playwright) | Task changes what the user sees or interacts with | **REQUIRED** |

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] Ctrl+Shift+F opens search bar in the active pane
- [ ] Typing in search bar highlights all matches across blocks in the pane
- [ ] Match counter shows "N of M" format
- [ ] Enter/F3 navigates to next match; Shift+Enter/Shift+F3 to previous
- [ ] Navigation wraps around (last → first, first → last)
- [ ] Current match is visually distinct from other matches
- [ ] Scrolls to current match (including off-screen blocks)
- [ ] Case sensitivity toggle works
- [ ] Escape closes search bar and clears all highlights
- [ ] Focus returns to InputEditor after closing search
- [ ] Search does not break existing AnsiOutput rendering (no visual regressions)
- [ ] Performance: searching across 50 blocks with moderate output completes within 200ms
- [ ] `npm run test` passes (all existing + new tests)
- [ ] `cargo test` passes (no regressions)
- [ ] Clean commit: `feat: add find-in-output search with Ctrl+Shift+F`

## Files to Read First

- `src/components/Terminal.tsx` — Block state, rendering loop, outputRef
- `src/components/blocks/BlockView.tsx` — Block rendering, isVisible logic
- `src/components/AnsiOutput.tsx` — Span rendering, React.memo
- `src/hooks/useIncrementalAnsi.ts` — How spans are computed
- `src/hooks/useBlockVisibility.ts` — IntersectionObserver pattern
- `src/lib/ansi.ts` — stripAnsi(), AnsiSpan type
- `src/components/layout/TabManager.tsx` — Global keyboard handler
- `src/components/layout/PaneContainer.tsx` — How props flow from TabManager to Terminal
- `src/App.css` — Styling patterns, color scheme
- `src/__tests__/Terminal.test.tsx` — Existing test patterns
- `src/__tests__/AnsiOutput.test.tsx` — Existing AnsiOutput tests
