# Task 008: Decoupled Input Editor — Multi-line + Syntax Highlighting

## Context

The current input is a basic `<input type="text">` in `Terminal.tsx` (line ~289-298). It's single-line, has no syntax highlighting, and lacks standard text editing features. Pillar 3 replaces it with a proper command editor.

### Current State
- **`src/components/Terminal.tsx`**: Single `<input>` with `onKeyDown` handler. Enter submits via `submitCommand()`.
- **`src/App.css`**: `.terminal-input-row`, `.terminal-input`, `.terminal-prompt` styles.
- **`src/components/editor/`**: Empty directory with `.gitkeep`.

### What This Task Builds

A dedicated `InputEditor` component that:
1. Supports **multi-line editing** (Shift+Enter for newline, Enter to submit)
2. Provides **syntax highlighting** for shell commands (command name, arguments, flags, strings, pipes)
3. Supports standard **keyboard shortcuts** (Ctrl+A select all, Ctrl+C/V copy/paste, Home/End, arrow keys)
4. Has a **visible line count** that grows as the user types (auto-expanding textarea, not fixed height)

### Design Decisions

**Approach: `<textarea>` with overlay highlighting**

Use a `<textarea>` for input (handles all native text editing, clipboard, selection) with a transparent text color. Overlay a `<pre>` element on top that renders the same text with syntax highlighting. The overlay is pointer-events: none so clicks pass through to the textarea.

This is the simplest approach that gives us multi-line + highlighting without a complex contentEditable implementation or a heavy dependency like CodeMirror/Monaco. It's the same technique used by many lightweight code editors.

```
┌──────────────────────────────────────────┐
│ <pre> (highlighted, pointer-events: none)│  ← Visual layer
│ <textarea> (transparent text, on top)    │  ← Interactive layer
└──────────────────────────────────────────┘
```

**Syntax highlighting approach: simple regex tokenizer**

Shell syntax is relatively simple. A basic tokenizer that identifies:
- **Commands**: First word on each line (before any space)
- **Flags**: Words starting with `-` or `--`
- **Strings**: Quoted text (`"..."` and `'...'`)
- **Pipes/redirects**: `|`, `>`, `>>`, `<`
- **Arguments**: Everything else

Color scheme (Catppuccin Mocha):
- Commands: `#89b4fa` (blue)
- Flags: `#f9e2af` (yellow)
- Strings: `#a6e3a1` (green)
- Pipes/redirects: `#f38ba8` (red/pink)
- Arguments: `#cdd6f4` (default text)

## Requirements

### Frontend (React/TypeScript)

#### 1. Shell syntax tokenizer

Create `src/lib/shell-tokenizer.ts`:

```typescript
export interface Token {
  type: 'command' | 'argument' | 'flag' | 'string' | 'pipe' | 'whitespace';
  value: string;
}

export function tokenize(input: string): Token[] {
    // Split input into tokens:
    // 1. Preserve whitespace as separate tokens (for accurate overlay alignment)
    // 2. First non-whitespace token on each line is a 'command'
    // 3. Tokens starting with - or -- are 'flag'
    // 4. Quoted strings ("..." or '...') are 'string'
    // 5. |, >, >>, < are 'pipe'
    // 6. Everything else is 'argument'
    //
    // Handle multi-line: each line's first token is a command
    // Handle pipes: token after | is also a command
}
```

This is a simple regex/state-machine tokenizer, NOT a full shell parser. It doesn't need to handle escaping, variable expansion, or subshells. Good enough for visual highlighting.

#### 2. InputEditor component

Create `src/components/editor/InputEditor.tsx`:

Props:
```typescript
interface InputEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;  // Called on Enter (without Shift)
  disabled?: boolean;
  shellType: ShellType;
}
```

Structure:
```tsx
<div className="input-editor" data-testid="input-editor">
  <span className="editor-prompt">❯</span>
  <div className="editor-area">
    <pre className="editor-highlight" aria-hidden="true">
      {/* Rendered highlighted tokens */}
    </pre>
    <textarea
      className="editor-textarea"
      data-testid="editor-textarea"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      rows={lineCount}
      disabled={disabled}
      autoFocus
      spellCheck={false}
      autoComplete="off"
    />
  </div>
</div>
```

Behavior:
- **Enter** (without Shift): Submit the command via `onSubmit(value)`. Prevent default (no newline).
- **Shift+Enter**: Insert a newline (default textarea behavior).
- **Ctrl+A**: Select all (default behavior, works automatically).
- **Ctrl+C/V/X**: Copy/paste/cut (default behavior).
- **Up/Down arrows**: Move cursor within multi-line text (default behavior). Note: command history browsing is a future feature.
- **Tab**: Insert 2 spaces (prevent default tab focus behavior).
- Auto-expand: textarea `rows` = number of lines in the text (minimum 1).

#### 3. Highlight overlay rendering

Inside `InputEditor`, render the highlighted tokens:

```tsx
const tokens = useMemo(() => tokenize(value), [value]);

<pre className="editor-highlight" aria-hidden="true">
  {tokens.map((token, i) => (
    <span key={i} className={`token-${token.type}`}>
      {token.value}
    </span>
  ))}
  {/* Add a trailing space/newline to match textarea dimensions */}
  {'\n'}
</pre>
```

The overlay `<pre>` must have identical font, font-size, line-height, padding, and word-wrap as the `<textarea>` so they align pixel-perfectly.

#### 4. Integrate into Terminal.tsx

Replace the current `<input>` with `<InputEditor>`:

```tsx
// Remove:
<input className="terminal-input" ... />

// Replace with:
<InputEditor
  value={input}
  onChange={setInput}
  onSubmit={(cmd) => { submitCommand(cmd); setInput(''); }}
  disabled={closed}
  shellType={shellType}
/>
```

Remove the `handleKeyDown` callback from Terminal.tsx — the InputEditor handles Enter/Shift+Enter internally.

#### 5. Styles

Add to `src/App.css`:

```css
.input-editor {
  display: flex;
  padding: 4px 8px;
  border-top: 1px solid #313244;
  background-color: #1e1e2e;
}

.editor-prompt {
  color: #89b4fa;
  margin-right: 8px;
  user-select: none;
  padding-top: 2px;
}

.editor-area {
  flex: 1;
  position: relative;
}

.editor-textarea,
.editor-highlight {
  font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.4;
  padding: 0;
  margin: 0;
  border: none;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: hidden;
}

.editor-textarea {
  position: relative;
  width: 100%;
  resize: none;
  background: transparent;
  color: transparent;  /* Text is invisible — overlay shows colored version */
  caret-color: #cdd6f4;  /* But cursor is visible */
  outline: none;
  z-index: 1;
}

.editor-highlight {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  color: #cdd6f4;
  z-index: 0;
}

/* Token colors — Catppuccin Mocha */
.token-command { color: #89b4fa; }
.token-flag { color: #f9e2af; }
.token-string { color: #a6e3a1; }
.token-pipe { color: #f38ba8; }
.token-argument { color: #cdd6f4; }
.token-whitespace { /* inherits */ }
```

### Backend (Rust)

No Rust changes needed. The input editor is purely frontend.

### IPC Contract

Unchanged. The editor calls the same `submitCommand` flow which calls `writeToSession`.

## Tests (Write These FIRST)

### Tokenizer Tests (`src/__tests__/shell-tokenizer.test.ts`)

- [ ] **`test_simple_command`**: `tokenize("ls")` → `[{ type: 'command', value: 'ls' }]`
- [ ] **`test_command_with_argument`**: `tokenize("echo hello")` → command `echo` + whitespace + argument `hello`
- [ ] **`test_command_with_flag`**: `tokenize("ls -la")` → command `ls` + whitespace + flag `-la`
- [ ] **`test_command_with_long_flag`**: `tokenize("npm --version")` → command `npm` + whitespace + flag `--version`
- [ ] **`test_quoted_string_double`**: `tokenize('echo "hello world"')` → command + whitespace + string `"hello world"`
- [ ] **`test_quoted_string_single`**: `tokenize("echo 'hello'")` → command + whitespace + string `'hello'`
- [ ] **`test_pipe`**: `tokenize("ls | grep foo")` → command `ls` + whitespace + pipe `|` + whitespace + command `grep` + whitespace + argument `foo`
- [ ] **`test_redirect`**: `tokenize("echo hi > file.txt")` → command + whitespace + argument + whitespace + pipe `>` + whitespace + argument
- [ ] **`test_multiline`**: `tokenize("echo hello\necho world")` → two lines, each starting with a command
- [ ] **`test_empty_input`**: `tokenize("")` → `[]`
- [ ] **`test_whitespace_preserved`**: `tokenize("echo  hello")` → tokens include whitespace with correct spacing

### InputEditor Component Tests (`src/__tests__/InputEditor.test.tsx`)

- [ ] **`test_renders_textarea`**: Render `<InputEditor>`. Assert textarea with `data-testid="editor-textarea"` exists.
- [ ] **`test_renders_prompt`**: Render `<InputEditor>`. Assert the prompt symbol is visible.
- [ ] **`test_calls_onChange`**: Type "hello" in the textarea. Assert `onChange` was called with "hello".
- [ ] **`test_enter_calls_onSubmit`**: Type "echo hi", press Enter. Assert `onSubmit` was called with "echo hi".
- [ ] **`test_shift_enter_does_not_submit`**: Type "line1", press Shift+Enter, type "line2". Assert `onSubmit` was NOT called. Assert the textarea value contains a newline.
- [ ] **`test_tab_inserts_spaces`**: Press Tab. Assert the textarea value contains "  " (2 spaces), not that focus moved.
- [ ] **`test_disabled_prevents_input`**: Render with `disabled={true}`. Assert textarea is disabled.
- [ ] **`test_syntax_highlighting_renders`**: Render with `value="echo hello"`. Assert a `.token-command` span exists containing "echo".

### Existing Tests
- [ ] All existing Terminal.test.tsx tests must be updated to work with InputEditor instead of the plain `<input>`. The `data-testid="terminal-input"` may need to change to `data-testid="editor-textarea"`, OR keep a `data-testid="terminal-input"` on the InputEditor wrapper for backward compatibility.
- [ ] E2E tests use `data-testid="terminal-input"` — ensure this still works or update the selectors.

## Acceptance Criteria

- [ ] All tests above written and passing
- [ ] `InputEditor` component with textarea + highlight overlay
- [ ] Multi-line support (Shift+Enter for newline, Enter to submit)
- [ ] Syntax highlighting for commands, flags, strings, pipes
- [ ] Tab inserts spaces (not focus change)
- [ ] Auto-expanding textarea (grows with content)
- [ ] Integrated into Terminal.tsx replacing the old `<input>`
- [ ] Pixel-perfect alignment between textarea and highlight overlay
- [ ] Existing Terminal and E2E tests still pass (update selectors if needed)
- [ ] `npm run test` passes
- [ ] `cargo test` passes (unchanged)
- [ ] Manual test: type `echo "hello" | grep -i hello > out.txt` and see colored syntax
- [ ] Manual test: Shift+Enter creates a new line, Enter submits
- [ ] Clean commit: `feat: add decoupled input editor with multi-line and syntax highlighting`

## Security Notes

- The input editor is purely frontend — no new IPC or backend surface.
- User input still flows through the same `submitCommand` → `writeToSession` path.
- The tokenizer is for DISPLAY only — it does not affect what's sent to the shell.

## Files to Read First

- `src/components/Terminal.tsx` — Current input handling (lines ~256-310), `handleKeyDown`, `submitCommand`
- `src/App.css` — Current input styles (`.terminal-input-row`, `.terminal-input`)
- `src/components/editor/` — Empty directory, create files here
- `src/__tests__/Terminal.test.tsx` — Tests that reference the input field (update selectors)
- `e2e/terminal-basic.spec.ts` — E2E tests using `terminal-input` selector
