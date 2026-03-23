# Task 035: AI Error Correction (P1-A2)

## Context

When a command fails (non-zero exit code), users manually figure out what went wrong. An AI-powered suggestion that analyzes the error output and proposes a fix would save significant time. This is a differentiating feature — few terminals offer this.

### What exists now

- **Block type**: Has `exitCode`, `status`, `output`, `command`.
- **LLM module** (`src-tauri/src/llm/mod.rs`): Supports OpenAI, Anthropic, Google, Azure. Has `translate_command()` and `classify_intent()`.
- **Terminal.tsx**: Detects command completion via exit code extraction. Has `agentLoading`/`agentError` states.
- **BlockView.tsx**: Shows exit code badge (green ✓ / red ✗). Has action buttons area.

## Requirements

### Backend (Rust) + Frontend.

#### 1. New LLM function: `suggest_fix` (`src-tauri/src/llm/mod.rs`)

```rust
pub struct FixRequest {
    pub command: String,
    pub exit_code: i32,
    pub error_output: String,  // Last 2000 chars of output
    pub shell_type: String,
    pub cwd: String,
}

pub struct FixResponse {
    pub suggested_command: String,
    pub explanation: String,    // Brief explanation of what went wrong
}
```

**System prompt**:
```
You are a shell command error analyzer. The user ran a command that failed.
Analyze the error and suggest a corrected command.

Rules:
- Output a JSON object with "command" and "explanation" fields
- "command": the corrected shell command to try
- "explanation": one sentence explaining what went wrong (max 100 chars)
- Target shell: {shell_type} on Windows
- Current directory: {cwd}
- If you cannot determine a fix, set command to "" and explain why
```

**Temperature**: 0.3 (slight creativity for fixes)
**Max tokens**: 200

#### 2. New Tauri command: `suggest_fix` (`src-tauri/src/commands/mod.rs`)

```rust
#[tauri::command]
pub async fn suggest_fix(
    command: String,
    exit_code: i32,
    error_output: String,
    shell_type: String,
    cwd: String,
) -> Result<FixSuggestion, String>
```

Register in `lib.rs`.

#### 3. Frontend: Error suggestion UI

When a command fails (non-zero exit code) AND an API key is configured:
- Automatically call `suggest_fix` with the failed command, exit code, and last 2000 chars of output
- Show a suggestion bar below the failed block:
  - "Did you mean: `corrected command`? [explanation] [Use] [Dismiss]"
  - "Use" button puts the corrected command in the InputEditor
  - "Dismiss" hides the suggestion
- Loading state: "Analyzing error..." while LLM is thinking
- If LLM fails or returns empty command, silently hide (no error shown)

#### 4. Integration in Terminal.tsx / BlockView.tsx

- When a block completes with non-zero exit code, trigger the fix suggestion
- Store suggestions per block: `Map<string, FixSuggestion>` or per-block state
- Only suggest for the most recent failed command (don't retroactively suggest for old failures)
- Rate limit: max 1 suggestion request at a time

#### 5. Don't auto-suggest for all failures

- Only suggest when exit code is non-zero AND output contains error-like patterns (stderr indicators, "error", "not found", "denied", etc.) — OR just suggest for all non-zero exits for simplicity in MVP.
- Skip if no API key configured (check settings first).

## Tests

### Rust Unit Tests
- [ ] `test_fix_suggestion_prompt_includes_context`: Prompt contains command, error output, shell type.
- [ ] `test_fix_response_parsing_valid`: Valid JSON response parsed correctly.
- [ ] `test_fix_response_parsing_invalid`: Invalid JSON defaults to empty suggestion.
- [ ] `test_fix_response_strips_markdown`: Response wrapped in code fences is cleaned.
- [ ] `test_error_output_truncated`: Output longer than 2000 chars is truncated to last 2000.

### Frontend Tests
- [ ] `test_error_suggestion_shown_for_failed_command`: Non-zero exit code triggers suggestion UI.
- [ ] `test_error_suggestion_hidden_for_success`: Zero exit code does NOT show suggestion.
- [ ] `test_use_button_populates_input`: Clicking "Use" puts suggested command in editor.
- [ ] `test_dismiss_button_hides_suggestion`: Clicking "Dismiss" removes the suggestion.
- [ ] `test_suggestion_loading_state`: Shows "Analyzing error..." while loading.
- [ ] `test_no_suggestion_without_api_key`: No API key → no suggestion attempt.

## Acceptance Criteria
- [ ] Failed commands automatically trigger AI error analysis
- [ ] Suggestion shows corrected command + explanation
- [ ] "Use" button populates the input editor with the fix
- [ ] "Dismiss" hides the suggestion
- [ ] Loading state shown while analyzing
- [ ] Graceful when LLM unavailable (no API key, network error)
- [ ] Only suggests for most recent failure
- [ ] Error output truncated to 2000 chars for LLM context
- [ ] All tests pass
- [ ] Commit: `feat: add AI-powered error correction suggestions`

## Files to Read First
- `src-tauri/src/llm/mod.rs` — LLM client, provider support
- `src-tauri/src/commands/mod.rs` — Tauri command patterns
- `src/components/Terminal.tsx` — Block completion, exit code detection
- `src/components/blocks/BlockView.tsx` — Block rendering, action buttons
- `src/lib/types.ts` — Block type
- `src/App.css` — Styling patterns
