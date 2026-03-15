# Task 017: Agent Mode UI — Intent Classifier + Command Translation Flow

## Context

Settings system (TASK-015) and LLM client (TASK-016) are complete. Users can configure an LLM provider and API key. The `translate_command` Tauri IPC is ready. This task builds the frontend Agent Mode that wires it all together.

### Current State
- **`src/lib/llm.ts`**: `translateCommand(input, shellType, cwd)` IPC wrapper
- **`src/lib/settings.ts`**: `getSettings()`, `saveSettings()` IPC wrappers
- **`src/components/editor/InputEditor.tsx`**: Multi-line textarea with syntax highlighting, ghost text, arrow history
- **`src/components/Terminal.tsx`**: Manages blocks, session, input. `submitCommand()` sends to PTY. Shell type tracked in state.
- **`src/hooks/useCommandHistory.ts`**, **`src/hooks/useGhostText.ts`**: Existing hooks

### Design

```
User types: # find all typescript files modified this week
            ↓
Intent detected: starts with "#" → Agent Mode
            ↓
Strip "#", show loading spinner in input area
            ↓
Call translateCommand(input, shellType, cwd)
            ↓
LLM returns: Get-ChildItem -Recurse -Filter *.ts | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) }
            ↓
Command replaces input text in the editor (user can see and edit it)
            ↓
User reviews, presses Enter → command executes normally
```

**Never auto-execute.** The translated command always goes into the input editor for review.

## Requirements

### Frontend (React/TypeScript)

#### 1. Intent classifier

Create `src/lib/intent-classifier.ts`:

```typescript
export type InputIntent = 'cli' | 'natural_language';

export function classifyIntent(input: string): InputIntent {
    const trimmed = input.trim();

    // Explicit # trigger — always natural language
    if (trimmed.startsWith('#')) return 'natural_language';

    // Empty or whitespace — treat as CLI (no-op)
    if (!trimmed) return 'cli';

    // Heuristics for CLI detection:
    // - Starts with a known command or path
    // - Contains typical CLI patterns: flags (-x, --flag), pipes (|), redirects (>)
    // - Starts with ./ or ../ or drive letter (C:\)
    // - Contains = (environment variable assignment)

    // If it looks like a sentence (multiple words, no flags/pipes), it's probably NL
    const hasFlags = /\s-{1,2}\w/.test(trimmed);
    const hasPipes = /\|/.test(trimmed);
    const hasRedirects = /[<>]/.test(trimmed);
    const hasPathSeparators = /[/\\]/.test(trimmed);
    const startsWithDot = /^\.{1,2}[/\\]/.test(trimmed);

    // If it has CLI artifacts, treat as CLI
    if (hasFlags || hasPipes || hasRedirects || startsWithDot) return 'cli';

    // Simple heuristic: if it looks like a natural sentence (spaces, no special chars)
    // and has 3+ words, suggest agent mode but don't force it
    const words = trimmed.split(/\s+/);
    if (words.length >= 4 && !hasPathSeparators) return 'natural_language';

    // Default: treat as CLI
    return 'cli';
}

export function stripHashPrefix(input: string): string {
    return input.replace(/^#\s*/, '');
}
```

#### 2. Agent Mode state in Terminal

Add to Terminal.tsx state:

```typescript
const [agentLoading, setAgentLoading] = useState(false);
const [agentError, setAgentError] = useState<string | null>(null);
```

#### 3. Update submit flow in Terminal.tsx

Modify the `onSubmit` handler (called by InputEditor on Enter):

```typescript
const handleSubmit = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) { setInput(''); return; }

    const intent = classifyIntent(trimmed);

    if (intent === 'natural_language') {
        // Agent mode: translate via LLM
        const nlInput = stripHashPrefix(trimmed);
        setAgentLoading(true);
        setAgentError(null);
        try {
            const translated = await translateCommand(nlInput, shellType, 'C:\\'); // TODO: get real CWD
            setInput(translated);  // Put translated command in the editor for review
        } catch (err) {
            setAgentError(String(err));
        } finally {
            setAgentLoading(false);
        }
        return; // Don't execute — user reviews first
    }

    // CLI mode: execute normally
    addCommand(trimmed);
    submitCommand(trimmed);
    setInput('');
}, [shellType, submitCommand, addCommand]);
```

Key flow:
1. User types `# find typescript files` and presses Enter
2. Intent = natural_language → call `translateCommand`
3. Loading spinner shown while waiting
4. LLM returns `Get-ChildItem -Recurse -Filter *.ts`
5. Command placed in input editor (replacing the `#` input)
6. User sees the command, can edit it, then presses Enter again
7. Second Enter → intent = cli → executes normally

#### 4. Loading indicator

When `agentLoading` is true, show a visual indicator in or near the input editor:

```tsx
{agentLoading && (
    <div className="agent-loading" data-testid="agent-loading">
        <span className="agent-spinner">⟳</span>
        Translating...
    </div>
)}
```

Position this above the input editor or as an overlay inside it.

#### 5. Error display

When `agentError` is set, show it below the input:

```tsx
{agentError && (
    <div className="agent-error" data-testid="agent-error">
        {agentError}
    </div>
)}
```

Clear the error when the user starts typing again.

#### 6. Auto-detect hint (optional but nice)

When the classifier detects natural language but the user didn't use `#`, show a subtle hint:

```tsx
// In the input editor area, if intent is 'natural_language' and no # prefix:
{showAgentHint && (
    <div className="agent-hint">
        Press Enter to translate with AI, or prefix with # to force AI mode
    </div>
)}
```

Actually, for MVP simplicity: only trigger agent mode on explicit `#` prefix. Auto-detect can be added later. This avoids confusing the user when they type something that looks like NL but is actually a command.

**Decision: `#` prefix only for MVP.** The classifier function exists and detects NL, but the submit flow only routes to agent mode when `#` is present. Auto-detect can be enabled in a future task.

#### 7. CWD (Current Working Directory)

The `translateCommand` IPC needs the current working directory. For now, use a hardcoded default or add a Tauri command to get it.

**Simplest approach**: Add a `get_cwd` Tauri command that returns `std::env::current_dir()`:

In `src-tauri/src/commands/mod.rs`:
```rust
#[tauri::command]
pub async fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get CWD: {}", e))
}
```

Register in `lib.rs`. Frontend calls it before `translateCommand`.

Note: This returns the Rust process's CWD, which is the app's launch directory. It's NOT the shell session's CWD (which changes with `cd`). Getting the shell's CWD requires shell integration. For MVP, the app's CWD is a reasonable approximation.

#### 8. InputEditor visual state during loading

When agent mode is loading, the InputEditor should show a visual state:
- Input becomes readonly/disabled
- A subtle spinner or "Translating..." text appears
- The prompt symbol changes (e.g., `❯` → `⟳` or colored differently)

#### 9. Styles

```css
.agent-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    color: #89b4fa;
    font-size: 12px;
}

.agent-spinner {
    animation: spin 1s linear infinite;
    display: inline-block;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.agent-error {
    padding: 4px 8px;
    color: #f38ba8;
    font-size: 12px;
    border-top: 1px solid #313244;
}

.agent-hint {
    padding: 2px 8px;
    color: #585b70;
    font-size: 11px;
}
```

### Backend (Rust)

#### 1. Add `get_cwd` command

As described above. Register in `lib.rs`.

### IPC Contract

Existing:
- `translate_command(input, shell_type, cwd)` → `Result<String, String>` (from TASK-016)

New:
- `get_cwd()` → `Result<String, String>` — returns the app's working directory

## Tests (Write These FIRST)

### Intent Classifier Tests (`src/__tests__/intent-classifier.test.ts`)

- [ ] **`test_hash_prefix_is_natural_language`**: `classifyIntent("# find files")` → `'natural_language'`
- [ ] **`test_hash_with_space`**: `classifyIntent("#find files")` → `'natural_language'`
- [ ] **`test_command_with_flags_is_cli`**: `classifyIntent("ls -la")` → `'cli'`
- [ ] **`test_command_with_pipe_is_cli`**: `classifyIntent("ps | grep node")` → `'cli'`
- [ ] **`test_empty_is_cli`**: `classifyIntent("")` → `'cli'`
- [ ] **`test_simple_command_is_cli`**: `classifyIntent("dir")` → `'cli'`
- [ ] **`test_path_is_cli`**: `classifyIntent("./script.sh")` → `'cli'`
- [ ] **`test_stripHashPrefix`**: `stripHashPrefix("# find files")` → `"find files"`
- [ ] **`test_stripHashPrefix_no_space`**: `stripHashPrefix("#find files")` → `"find files"`

### Terminal Agent Mode Tests (`src/__tests__/Terminal.test.tsx`)

- [ ] **`test_hash_input_triggers_translate`**: Type `# list files`, press Enter. Assert `translateCommand` was called (mock it). Assert input is NOT cleared (command goes into editor for review).
- [ ] **`test_translated_command_populates_input`**: Mock `translateCommand` to return `"dir"`. Type `# list files`, press Enter. After translation, assert input value is `"dir"`.
- [ ] **`test_agent_loading_shown`**: Type `# test`, press Enter. Assert loading indicator is visible while translation is pending.
- [ ] **`test_agent_error_shown`**: Mock `translateCommand` to reject. Type `# test`, press Enter. Assert error message is visible.
- [ ] **`test_normal_command_not_translated`**: Type `dir`, press Enter. Assert `translateCommand` was NOT called. Assert command was submitted normally.

### Rust Unit Tests

- [ ] **`test_get_cwd_returns_string`**: Call `std::env::current_dir()`. Assert it returns Ok with a non-empty string.

### E2E Tests (Playwright)

- [ ] **`test_agent_mode_shows_loading`**: Type `# test`, press Enter. Assert `.agent-loading` or `.agent-error` appears (will show error since no API key configured in test). This proves the agent mode flow is wired up end-to-end.

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] `#` prefix triggers agent mode (LLM translation)
- [ ] Translated command populates input editor (NOT auto-executed)
- [ ] Loading indicator while LLM processes
- [ ] Error display on failure (no API key, network error, etc.)
- [ ] Error clears when user types
- [ ] Normal commands (without `#`) execute as before
- [ ] `get_cwd` Tauri command returns working directory
- [ ] Intent classifier function with heuristics
- [ ] `npm run test` + `cargo test` pass
- [ ] Clean commit: `feat: add agent mode with # trigger and LLM command translation`

## Security Notes

- **Never auto-execute LLM output.** The translated command ALWAYS goes into the input editor for user review.
- The LLM response is treated as untrusted text — it's displayed in the editor (which uses React's safe text rendering), not injected as HTML.
- API keys are handled by the existing settings/LLM client — no new key handling in this task.
- The `get_cwd` command exposes the app's working directory to the frontend. This is not sensitive (the user already sees it in the shell prompt).

## Files to Read First

- `src/components/Terminal.tsx` — Main integration point (submit flow, state)
- `src/components/editor/InputEditor.tsx` — Editor component (loading state)
- `src/lib/llm.ts` — translateCommand IPC wrapper
- `src/lib/settings.ts` — getSettings IPC wrapper
- `src/hooks/useCommandHistory.ts` — History hook (agent translations should NOT be added to history until executed)
- `src/App.css` — Agent mode styles
