# Task 022: Tab/Path Completions

## Context

Velocity has no Tab completion. When users press Tab in the input editor, it either accepts a history-based ghost text suggestion or inserts 2 spaces. Users need file path completions (the most critical) and command completions for daily usability. This is P0-2 in the Phase 1 roadmap.

### What exists now

- **InputEditor.tsx** (`src/components/editor/InputEditor.tsx`, 118 lines): Tab key handler at line 30. If `ghostText` exists, Tab accepts it (`onChange(value + ghostText)`). Otherwise inserts 2 spaces at cursor. Textarea cursor position is tracked via `selectionStart`.
- **useGhostText.ts** (`src/hooks/useGhostText.ts`, 29 lines): Simple hook that searches command history for a prefix match. Returns `{ suggestion: string | null }`. Only works for history — no path or command completions.
- **useKnownCommands.ts** (`src/hooks/useKnownCommands.ts`, 21 lines): Fetches known commands from Rust via `get_known_commands`. Returns `Set<string>`. Used by intent classifier.
- **shell-tokenizer.ts** (`src/lib/shell-tokenizer.ts`, 81 lines): Tokenizes input for syntax highlighting. Token types: `command`, `argument`, `flag`, `string`, `pipe`, `whitespace`. Regex-based. Knows first word is a command, `-x` is a flag, rest are arguments. Tracks `expectCommand` after pipes.
- **intent-classifier.ts** (`src/lib/intent-classifier.ts`, 92 lines): Splits on whitespace, detects CLI signals like flags and paths.
- **Terminal.tsx** (`src/components/Terminal.tsx`, 638 lines): Manages `input` state, calls `useGhostText(input, history)`, passes `suggestion` as `ghostText` prop to InputEditor.
- **cwd.ts** (`src/lib/cwd.ts`, 13 lines): `getCwd()` returns the Rust process's CWD (not the shell's). Acceptable for MVP.
- **commands/mod.rs** (`src-tauri/src/commands/mod.rs`, 226 lines): `get_known_commands()` scans PATH for executables plus builtins. Pattern for adding new commands is established.
- **lib.rs** (`src-tauri/src/lib.rs`, 32 lines): Command registration via `tauri::generate_handler![]`.

### Key types

```typescript
// shell-tokenizer.ts
type TokenType = 'command' | 'argument' | 'flag' | 'string' | 'pipe' | 'whitespace';
interface Token { type: TokenType; value: string; }

// useGhostText.ts — current return type
interface UseGhostText { suggestion: string | null; }
```

## Requirements

### Overview

Fish-style Tab completions using the existing ghost text mechanism. As the user types, ghost text shows the best completion (history first, then path/command). Tab accepts the ghost text. When there are multiple completions and user hasn't typed enough to disambiguate, Tab cycles through them.

### Backend (Rust)

#### New Tauri command: `get_completions`

```rust
#[tauri::command]
pub async fn get_completions(
    partial: String,       // The partial word being completed
    cwd: String,          // Current working directory for path resolution
    context: String,      // "command" or "path" — what kind of completion
) -> Result<Vec<String>, String>
```

**When `context == "path"`**:
1. If `partial` is empty, list files in `cwd`.
2. If `partial` is a relative path (e.g., `src/comp`), resolve against `cwd` and list matching entries.
3. If `partial` is an absolute path (e.g., `C:\Users\`), list matching entries.
4. For each matching directory, append `\` (or `/` for WSL context). For files, no trailing separator.
5. Return the full completed names (not the entire path — just the replacement for the partial token). E.g., if user typed `src/comp` and there's `src/components/`, return `src/components/`.
6. Sort: directories first (they're more likely to be navigated into), then alphabetically.
7. Limit to 50 results.
8. Handle errors gracefully (permission denied, path doesn't exist → return empty vec).

**When `context == "command"`**:
1. Filter the known commands list by prefix match on `partial`.
2. Case-insensitive on Windows.
3. Return up to 50 matches, sorted alphabetically.

**Security**:
- Validate that `cwd` is a real directory (don't blindly use it).
- Don't follow symlinks outside reasonable boundaries.
- This is a read-only listing operation — no execution.

#### Register the command

Add `commands::get_completions` to `lib.rs` in the `generate_handler![]` macro.

### Frontend (React/TypeScript)

#### 1. Completion Context (`src/lib/completion-context.ts`)

Determine what kind of completion to perform based on cursor position and input:

```typescript
interface CompletionContext {
  type: 'command' | 'path' | 'none';
  partial: string;          // The partial word at cursor (text to complete)
  replaceStart: number;     // Index in input where the partial starts
  replaceEnd: number;       // Index in input where the partial ends (usually cursor pos)
}

function getCompletionContext(input: string, cursorPos: number): CompletionContext
```

**Algorithm**:
1. Use the existing `tokenize()` function from `shell-tokenizer.ts` to get tokens.
2. Map tokens to character positions by walking the token values and tracking cumulative offset.
3. Find which token the cursor is in (or at the end of).
4. If cursor is in a `command` token (first word, or first word after a pipe): type = `'command'`, partial = the token text up to cursor position.
5. If cursor is in an `argument` token: type = `'path'`, partial = the token text up to cursor position.
6. If cursor is in a `flag` token or `whitespace` at the end:
   - If after whitespace at end of input (user just pressed space): type = `'path'`, partial = `''` (list current directory).
   - If in the middle of whitespace: type = `'none'`.
7. If cursor is in a `string` token (quoted): type = `'path'`, partial = unquoted content up to cursor.

#### 2. Refactored Completions Hook (`src/hooks/useCompletions.ts`)

Replace `useGhostText.ts` with a more capable hook:

```typescript
interface UseCompletionsResult {
  suggestion: string | null;        // Ghost text to display (same interface as before)
  completions: string[];            // All available completions for cycling
  completionIndex: number;          // Current index in completions (-1 = history suggestion)
  cycleNext: () => void;            // Move to next completion
  accept: () => string | null;      // Accept current completion, return new input value
  reset: () => void;                // Clear completions (on input change)
}

function useCompletions(
  input: string,
  cursorPos: number,
  history: string[],
  knownCommands: Set<string>,
  cwd: string,
): UseCompletionsResult
```

**Behavior**:
1. **On every input change** (`input` or `cursorPos` changes): Reset completions.
2. **Ghost text (history)**: Same as current `useGhostText` — if input matches a history prefix, show remainder as ghost text. This is the default `suggestion` when no Tab-triggered completions are active.
3. **Tab-triggered completions**: When `cycleNext` is called (via Tab key):
   - If history ghost text is showing, `accept()` accepts it (existing behavior).
   - If no history ghost text, compute `CompletionContext` from input + cursor.
   - If context is `'command'`: filter `knownCommands` synchronously.
   - If context is `'path'`: call `invoke('get_completions', { partial, cwd, context: 'path' })` asynchronously.
   - Store results in `completions`. Show first result as ghost text.
   - Subsequent `cycleNext` calls advance `completionIndex` and update ghost text.
4. **Ghost text format**: The `suggestion` should be the text that would be appended/replaced. If completing `src/comp` → `src/components/`, the suggestion is `onents/` (the remainder after the partial).
5. **Debounce**: Path completions involve IPC — debounce by 100ms. Command completions are synchronous (filter a Set) — no debounce needed.

#### 3. Modified InputEditor.tsx

- **New prop**: `onCursorChange?: (pos: number) => void` — called when cursor position changes (on keyup, click, selection change).
- **Tab handler update**: Instead of directly accepting ghost text, call a new `onTab` callback that the parent (Terminal) handles. This lets Terminal orchestrate between history acceptance and completion cycling.
- **New prop**: `onTab?: () => void` — replaces the inline Tab logic. Terminal decides what happens.
- Keep the 2-space insertion as fallback only when there are no completions AND no ghost text.

#### 4. Modified Terminal.tsx

- Track `cursorPos` state (updated via `onCursorChange` from InputEditor).
- Replace `useGhostText(input, history)` with `useCompletions(input, cursorPos, history, knownCommands, cwd)`.
- Add `cwd` state (fetched on mount via `getCwd()`).
- Handle `onTab` from InputEditor:
  1. If `completions.suggestion` exists from history: accept it (update input).
  2. Else: call `completions.cycleNext()` to trigger/cycle completions.
- Pass `completions.suggestion` as `ghostText` to InputEditor.

### IPC Contract

**New command:**
```
get_completions(partial: String, cwd: String, context: String) -> Vec<String>
```

- `partial`: The partial text being completed (e.g., `"src/comp"`, `"gi"`, `""`).
- `cwd`: Current working directory for resolving relative paths.
- `context`: `"command"` or `"path"`.
- Returns: Array of completion strings (full replacement values, not just suffixes).

### Performance Considerations

- **Path completions**: IPC call. Debounce 100ms. Limit to 50 results from Rust.
- **Command completions**: Synchronous filter of `knownCommands` Set. Instant.
- **History ghost text**: Synchronous prefix search. Instant.
- **Caching**: Cache path completion results for the same `(partial, cwd)` pair. Invalidate on input change.
- **Large directories**: Rust limits to 50 results. Frontend doesn't need to handle thousands of items.

## Tests (Write These FIRST)

### Rust Unit Tests

- [ ] `test_path_completions_lists_directory`: Given a temp dir with files, `get_completions("", dir, "path")` returns file names.
- [ ] `test_path_completions_filters_by_prefix`: Given files `["alpha.txt", "beta.txt"]`, partial `"al"` returns `["alpha.txt"]`.
- [ ] `test_path_completions_directories_have_separator`: Directories have trailing `\` (Windows) in results.
- [ ] `test_path_completions_relative_path`: Partial `"src/comp"` resolves against cwd.
- [ ] `test_path_completions_nonexistent_returns_empty`: Invalid path returns empty vec.
- [ ] `test_path_completions_limited_to_50`: Directory with 100+ entries returns max 50.
- [ ] `test_command_completions_filters_by_prefix`: Known commands filtered by prefix.
- [ ] `test_command_completions_case_insensitive`: `"GIT"` matches `"git"` on Windows.

### Frontend Tests (Vitest)

**Completion context tests** (`src/__tests__/completion-context.test.ts`):
- [ ] `test_context_command_position`: Cursor in first word → type `'command'`.
- [ ] `test_context_argument_position`: Cursor in second word → type `'path'`.
- [ ] `test_context_after_pipe_is_command`: Input `"ls | gr"`, cursor at end → type `'command'`.
- [ ] `test_context_partial_extraction`: Input `"git comm"`, cursor at 8 → partial `"comm"`, replaceStart 4.
- [ ] `test_context_empty_input`: Empty input → type `'command'`, partial `""`.
- [ ] `test_context_whitespace_at_end`: Input `"git "` cursor at 4 → type `'path'`, partial `""`.
- [ ] `test_context_flag_position`: Input `"git -"` cursor at 5 → type `'none'` (don't complete flags for MVP).
- [ ] `test_context_quoted_string`: Input `"cat 'src/f"` cursor at 10 → type `'path'`, partial `"src/f"`.

**Completions hook tests** (`src/__tests__/useCompletions.test.ts`):
- [ ] `test_history_suggestion_takes_priority`: History match shown as ghost text before any Tab press.
- [ ] `test_tab_accepts_history_suggestion`: When history suggestion exists, accept returns updated input.
- [ ] `test_tab_triggers_command_completion`: No history match, command position → shows command completions.
- [ ] `test_tab_cycles_through_completions`: Multiple completions, each cycleNext advances to next.
- [ ] `test_completions_reset_on_input_change`: Changing input clears active completions.
- [ ] `test_empty_completions_returns_null_suggestion`: No matches → suggestion is null.
- [ ] `test_completion_replaces_partial`: Completing `"gi"` with `"git"` produces correct input.

**InputEditor tests** (`src/__tests__/InputEditor.test.tsx` — additions):
- [ ] `test_tab_calls_on_tab_callback`: Tab key calls `onTab` when provided.
- [ ] `test_cursor_change_callback`: Typing/clicking calls `onCursorChange` with position.

**Integration tests** (`src/__tests__/Terminal.test.tsx` — additions):
- [ ] `test_tab_completion_shows_ghost_text`: Type partial command, mock `get_completions` response, press Tab, verify ghost text appears.

### E2E Tests (Playwright)

- [ ] `test_e2e_tab_completion`: Open app, type partial file path, press Tab, verify completion appears in input.

### When is each test type REQUIRED?

| Test Type | Required When | This Task |
|-----------|--------------|-----------|
| Rust Unit | Task adds Rust logic | **REQUIRED** — new `get_completions` command |
| Rust Integration | Task touches PTY/IPC | Skip — completions don't involve PTY |
| Frontend (Vitest) | Task adds/changes UI | **REQUIRED** |
| E2E (Playwright) | Task changes user-visible behavior | **REQUIRED** |

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] Tab in command position completes command names from known commands
- [ ] Tab in argument position completes file/directory paths
- [ ] Directories have trailing separator in completions
- [ ] History ghost text still works (regression check)
- [ ] History suggestion takes priority over Tab completions
- [ ] Tab accepts history ghost text when present
- [ ] Tab cycles through multiple completions when available
- [ ] Completions reset when input changes
- [ ] Path completions work with relative and absolute paths
- [ ] Path completions limited to 50 results
- [ ] No ghost text / 2-space indent when no completions available
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `feat: add tab completions for paths and commands`

## Files to Read First

- `src/components/editor/InputEditor.tsx` — Tab handler, ghost text rendering, cursor position
- `src/hooks/useGhostText.ts` — Current suggestion logic (to be replaced/extended)
- `src/hooks/useKnownCommands.ts` — Known commands fetch pattern
- `src/lib/shell-tokenizer.ts` — Token types and tokenization for cursor context
- `src/components/Terminal.tsx` — Input state, hook orchestration, ghost text integration
- `src/lib/cwd.ts` — CWD fetching
- `src-tauri/src/commands/mod.rs` — Existing Tauri commands pattern, `get_known_commands`
- `src-tauri/src/lib.rs` — Command registration
- `src/__tests__/useGhostText.test.ts` — Existing ghost text test patterns
- `src/__tests__/InputEditor.test.tsx` — Existing InputEditor test patterns
