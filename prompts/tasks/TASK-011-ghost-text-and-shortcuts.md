# Task 011: Ghost Text Suggestions + Command History Shortcuts

## Context

Pillar 3 sub-tasks 3a (multi-line) and 3b (syntax highlighting) are done. This task adds:
- **3c**: Ghost text suggestions — faded type-ahead completions accepted via Tab
- **3d**: Standard keyboard shortcuts — command history browsing with Up/Down arrows

### Current State
- **`src/components/editor/InputEditor.tsx`**: Textarea + highlight overlay. Tab inserts 2 spaces. Enter submits. Shift+Enter newline. Props: `value`, `onChange`, `onSubmit`, `disabled`.
- **`src/components/Terminal.tsx`**: Manages blocks, session, input state. Passes `value`/`onChange`/`onSubmit` to InputEditor.
- **`src/lib/shell-tokenizer.ts`**: Regex tokenizer for syntax highlighting.

## Requirements

### Frontend (React/TypeScript)

#### 1. Command History

Create `src/hooks/useCommandHistory.ts`:

```typescript
interface UseCommandHistory {
  history: string[];           // Past commands (newest last)
  historyIndex: number | null; // Current position in history (null = not browsing)
  addCommand: (command: string) => void;
  navigateUp: () => string | null;    // Returns previous command or null
  navigateDown: () => string | null;  // Returns next command or null (empty = back to draft)
  reset: () => void;                   // Reset history index (back to draft)
  draft: string;                       // The in-progress text before Up was pressed
  setDraft: (value: string) => void;
}

export function useCommandHistory(maxHistory?: number): UseCommandHistory { ... }
```

Behavior:
- `addCommand(cmd)`: Appends to history, resets index to null, clears draft. Skip duplicates (don't add if same as last command).
- `navigateUp()`: Moves index backward through history. First Up press saves current input as `draft` and returns the most recent command. Returns `null` if at the beginning.
- `navigateDown()`: Moves index forward. If at the end, returns the saved `draft` (restoring what the user was typing). Returns `null` if already past the end.
- `reset()`: Resets index to null. Called when user submits or types new text.
- `maxHistory`: Default 100 commands.

#### 2. Ghost Text Suggestions

Create `src/hooks/useGhostText.ts`:

```typescript
interface UseGhostText {
  suggestion: string | null;  // The suggested completion (or null)
}

export function useGhostText(input: string, history: string[]): UseGhostText { ... }
```

Behavior:
- Searches `history` (most recent first) for commands that start with the current `input`.
- If a match is found, `suggestion` is the REMAINING portion (after the input prefix). E.g., input is `git co`, history contains `git commit -m "fix"`, suggestion is `mmit -m "fix"`.
- If `input` is empty, suggestion is `null`.
- If no match, suggestion is `null`.
- Only match against single-line input (no ghost text for multi-line).

This is a simple history-based completion. No external API calls, no fuzzy matching. Pure frontend logic based on command history.

#### 3. Update InputEditor

Add new props:
```typescript
interface InputEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  ghostText?: string | null;        // NEW: faded suggestion text
  onNavigateUp?: () => string | null;    // NEW: Up arrow handler
  onNavigateDown?: () => string | null;  // NEW: Down arrow handler
}
```

**Ghost text rendering**: After the highlighted tokens in the overlay `<pre>`, render the ghost text as a faded span:
```tsx
<pre className="editor-highlight" aria-hidden="true">
  {/* existing token spans */}
  {ghostText && <span className="ghost-text">{ghostText}</span>}
  {'\n'}
</pre>
```

**Tab behavior change**: If ghost text is visible, Tab ACCEPTS the suggestion (appends it to the value) instead of inserting spaces. If no ghost text, Tab inserts 2 spaces (existing behavior).

```typescript
if (e.key === 'Tab') {
  e.preventDefault();
  if (ghostText) {
    onChange(value + ghostText);  // Accept suggestion
  } else {
    // Insert 2 spaces at cursor (existing behavior)
  }
}
```

**Arrow key handlers**:
```typescript
if (e.key === 'ArrowUp' && !e.shiftKey) {
  // Only intercept if cursor is on the first line
  const textarea = textareaRef.current;
  if (textarea && textarea.selectionStart === textarea.selectionEnd) {
    const textBeforeCursor = value.substring(0, textarea.selectionStart);
    if (!textBeforeCursor.includes('\n')) {
      // Cursor is on the first line — navigate history
      e.preventDefault();
      const prev = onNavigateUp?.();
      if (prev !== null && prev !== undefined) {
        onChange(prev);
      }
    }
  }
}

if (e.key === 'ArrowDown' && !e.shiftKey) {
  // Only intercept if cursor is on the last line
  const textarea = textareaRef.current;
  if (textarea && textarea.selectionStart === textarea.selectionEnd) {
    const textAfterCursor = value.substring(textarea.selectionEnd);
    if (!textAfterCursor.includes('\n')) {
      // Cursor is on the last line — navigate history
      e.preventDefault();
      const next = onNavigateDown?.();
      if (next !== null && next !== undefined) {
        onChange(next);
      }
    }
  }
}
```

The key insight: Up/Down only intercept history browsing when the cursor is on the first/last line respectively. In multi-line mode, Up/Down move the cursor between lines as normal.

#### 4. Update Terminal.tsx

Integrate the history hook and ghost text:

```typescript
const { history, addCommand, navigateUp, navigateDown, reset, draft, setDraft } = useCommandHistory();
const { suggestion } = useGhostText(input, history);

// In onSubmit handler (from InputEditor):
const handleSubmit = (cmd: string) => {
  const trimmed = cmd.trim();
  if (trimmed) {
    addCommand(trimmed);
    submitCommand(trimmed);
  }
  setInput('');
};

// In onChange handler:
const handleInputChange = (newValue: string) => {
  setInput(newValue);
  reset();  // Reset history browsing when user types
};

// Pass to InputEditor:
<InputEditor
  value={input}
  onChange={handleInputChange}
  onSubmit={handleSubmit}
  disabled={closed}
  ghostText={suggestion}
  onNavigateUp={navigateUp}
  onNavigateDown={navigateDown}
/>
```

#### 5. Ghost text styles

```css
.ghost-text {
  color: #585b70;  /* Catppuccin Mocha surface2 — faded */
  pointer-events: none;
  user-select: none;
}
```

#### 6. Per-terminal history

Each Terminal component has its own `useCommandHistory` instance. History is NOT shared across tabs/panes. History is lost when the terminal is destroyed (tab/pane close). This is the simplest approach.

### Backend (Rust)

No Rust changes.

### IPC Contract

Unchanged.

## Tests (Write These FIRST)

### useCommandHistory Tests (`src/__tests__/useCommandHistory.test.ts`)

Use `@testing-library/react` `renderHook` to test the hook.

- [ ] **`test_addCommand_stores_in_history`**: Add "ls", "pwd". Assert `history` is `["ls", "pwd"]`.
- [ ] **`test_navigateUp_returns_most_recent`**: Add "ls", "pwd". Call `navigateUp()`. Assert returns `"pwd"`.
- [ ] **`test_navigateUp_twice_returns_earlier`**: Add "ls", "pwd". Navigate up twice. Assert returns `"ls"`.
- [ ] **`test_navigateUp_at_beginning_returns_null`**: Add "ls". Navigate up once (returns "ls"), navigate up again. Assert returns `null`.
- [ ] **`test_navigateDown_returns_next`**: Add "ls", "pwd". Navigate up twice (at "ls"), navigate down. Assert returns `"pwd"`.
- [ ] **`test_navigateDown_past_end_returns_draft`**: Add "ls". Set draft to "git". Navigate up (returns "ls"), navigate down. Assert returns `"git"` (the draft).
- [ ] **`test_reset_clears_index`**: Add "ls". Navigate up. Call `reset()`. Navigate up again. Assert returns `"ls"` (starts from the end again).
- [ ] **`test_skip_duplicate_last_command`**: Add "ls", "ls". Assert `history.length` is 1.
- [ ] **`test_maxHistory_enforced`**: Create with `maxHistory=3`. Add 5 commands. Assert `history.length` is 3 and oldest are dropped.

### useGhostText Tests (`src/__tests__/useGhostText.test.ts`)

- [ ] **`test_suggests_from_history`**: Input "git co", history `["git commit -m fix"]`. Assert suggestion is `"mmit -m fix"`.
- [ ] **`test_no_suggestion_for_empty_input`**: Input "", history `["ls"]`. Assert suggestion is `null`.
- [ ] **`test_no_suggestion_if_no_match`**: Input "xyz", history `["ls", "pwd"]`. Assert suggestion is `null`.
- [ ] **`test_most_recent_match_preferred`**: Input "git", history `["git status", "git commit"]`. Assert suggestion is `" commit"` (most recent).
- [ ] **`test_no_suggestion_for_multiline`**: Input "line1\nline2", history `["line1 extra"]`. Assert suggestion is `null`.

### InputEditor Tests (`src/__tests__/InputEditor.test.tsx`)

- [ ] **`test_ghost_text_rendered`**: Render with `ghostText="suggestion"`. Assert a `.ghost-text` span exists with "suggestion".
- [ ] **`test_tab_accepts_ghost_text`**: Render with `value="git co"` and `ghostText="mmit"`. Press Tab. Assert `onChange` called with `"git commit"`.
- [ ] **`test_tab_inserts_spaces_without_ghost`**: Render with `value="echo"` and `ghostText={null}`. Press Tab. Assert `onChange` called with `"echo  "`.
- [ ] **`test_up_arrow_calls_onNavigateUp`**: Render with empty value. Press ArrowUp. Assert `onNavigateUp` was called.
- [ ] **`test_down_arrow_calls_onNavigateDown`**: Press ArrowDown. Assert `onNavigateDown` was called.

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] `useCommandHistory` hook with Up/Down navigation, draft preservation, duplicate skip
- [ ] `useGhostText` hook with history-based prefix matching
- [ ] Ghost text rendered as faded text after the input in the highlight overlay
- [ ] Tab accepts ghost text when present, inserts spaces when not
- [ ] Up/Down arrows browse command history (only on first/last line of multi-line)
- [ ] Each terminal has independent history
- [ ] `npm run test` passes
- [ ] `cargo test` passes (unchanged)
- [ ] Manual test: Type `echo hello`, Enter, type `ec` → see faded `ho hello`, press Tab → completes
- [ ] Manual test: Run 3 commands, press Up 3 times → browse through all 3, Down back to draft
- [ ] Clean commit: `feat: add ghost text suggestions and command history navigation`

## Security Notes
- Ghost text is display-only — never sent to the shell until the user explicitly submits.
- Command history is in-memory only, not persisted. Lost on terminal close.
- No new IPC surface.

## Files to Read First
- `src/components/editor/InputEditor.tsx` — Add ghost text rendering + arrow key handlers
- `src/components/Terminal.tsx` — Integrate hooks, pass new props
- `src/hooks/` — Create new hook files here (currently has only `.gitkeep`)
- `src/App.css` — Add ghost-text style
