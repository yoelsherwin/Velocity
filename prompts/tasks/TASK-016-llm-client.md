# Task 016: LLM Provider Client — Multi-Provider Command Translation

## Context

Settings system is complete (TASK-015). Users can configure their LLM provider (OpenAI, Anthropic, Google, Azure) and API key. This task builds the Rust HTTP client that calls the configured API to translate natural language into shell commands.

### Current State
- **`src-tauri/src/settings/mod.rs`**: `AppSettings` with `llm_provider`, `api_key`, `model`, `azure_endpoint`. `load_settings()` reads from disk.
- **`src-tauri/Cargo.toml`**: `reqwest` (with json feature) and `dirs` already added.
- **`src-tauri/src/commands/mod.rs`**: `get_settings`, `save_app_settings` commands. Pattern for `spawn_blocking` + `Arc<Mutex<>>`.

## Requirements

### Backend (Rust)

#### 1. LLM Provider Module

Create `src-tauri/src/llm/mod.rs`:

**System prompt template**:
```
You are a shell command translator. Convert the user's natural language request into a single executable shell command.

Rules:
- Output ONLY the command. No explanations, no markdown, no code fences.
- Target shell: {shell_type} on Windows
- Current working directory: {cwd}
- If the request is ambiguous, make a reasonable assumption.
- If you cannot translate the request, output: ERROR: <reason>

Examples:
User: list all files
Command: dir

User: find typescript files modified this week
Command: Get-ChildItem -Recurse -Filter *.ts | Where-Object {{ $_.LastWriteTime -gt (Get-Date).AddDays(-7) }}

User: show disk usage
Command: Get-PSDrive -PSProvider FileSystem
```

**Provider trait**:
```rust
pub struct TranslationRequest {
    pub prompt: String,         // The natural language input
    pub shell_type: String,     // "powershell", "cmd", "wsl"
    pub cwd: String,            // Current working directory
}

pub struct TranslationResponse {
    pub command: String,        // The translated shell command
}
```

**Multi-provider HTTP client**:

```rust
pub async fn translate_command(
    settings: &AppSettings,
    request: &TranslationRequest,
) -> Result<TranslationResponse, String> {
    if settings.api_key.is_empty() {
        return Err("No API key configured. Open Settings to add one.".to_string());
    }

    let system_prompt = build_system_prompt(&request.shell_type, &request.cwd);
    let user_message = &request.prompt;

    match settings.llm_provider.as_str() {
        "openai" => call_openai(&settings.api_key, &settings.model, &system_prompt, user_message).await,
        "anthropic" => call_anthropic(&settings.api_key, &settings.model, &system_prompt, user_message).await,
        "google" => call_google(&settings.api_key, &settings.model, &system_prompt, user_message).await,
        "azure" => call_azure(&settings.api_key, &settings.model, settings.azure_endpoint.as_deref(), &system_prompt, user_message).await,
        _ => Err(format!("Unknown provider: {}", settings.llm_provider)),
    }
}
```

#### 2. Provider implementations

Each provider function makes an HTTP POST to the respective API:

**OpenAI** (`https://api.openai.com/v1/chat/completions`):
```json
{
  "model": "{model}",
  "messages": [
    {"role": "system", "content": "{system_prompt}"},
    {"role": "user", "content": "{user_message}"}
  ],
  "temperature": 0.1,
  "max_tokens": 500
}
```
Headers: `Authorization: Bearer {api_key}`, `Content-Type: application/json`

**Anthropic** (`https://api.anthropic.com/v1/messages`):
```json
{
  "model": "{model}",
  "system": "{system_prompt}",
  "messages": [{"role": "user", "content": "{user_message}"}],
  "max_tokens": 500,
  "temperature": 0.1
}
```
Headers: `x-api-key: {api_key}`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`

**Google Gemini** (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}`):
```json
{
  "systemInstruction": {"parts": [{"text": "{system_prompt}"}]},
  "contents": [{"parts": [{"text": "{user_message}"}]}],
  "generationConfig": {"temperature": 0.1, "maxOutputTokens": 500}
}
```

**Azure OpenAI** (`{endpoint}/openai/deployments/{model}/chat/completions?api-version=2024-02-01`):
Same body as OpenAI. Headers: `api-key: {api_key}`, `Content-Type: application/json`

#### 3. Response parsing

Each provider returns JSON. Extract the generated text:
- **OpenAI/Azure**: `response.choices[0].message.content`
- **Anthropic**: `response.content[0].text`
- **Google**: `response.candidates[0].content.parts[0].text`

Strip whitespace, remove markdown code fences if present (some models wrap in ``` despite instructions), trim any trailing newlines.

```rust
fn clean_response(raw: &str) -> String {
    let trimmed = raw.trim();
    // Strip markdown code fences if present
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let inner = trimmed
            .strip_prefix("```").unwrap()
            .strip_suffix("```").unwrap()
            .trim();
        // Remove optional language tag on first line
        if let Some(newline_pos) = inner.find('\n') {
            let first_line = &inner[..newline_pos];
            if first_line.chars().all(|c| c.is_alphanumeric() || c == '-') {
                return inner[newline_pos + 1..].trim().to_string();
            }
        }
        return inner.to_string();
    }
    trimmed.to_string()
}
```

#### 4. Tauri command

Add to `src-tauri/src/commands/mod.rs`:

```rust
#[tauri::command]
pub async fn translate_command(
    input: String,
    shell_type: String,
    cwd: String,
) -> Result<String, String> {
    let settings = settings::load_settings()?;
    let request = llm::TranslationRequest {
        prompt: input,
        shell_type,
        cwd,
    };
    let response = llm::translate_command(&settings, &request).await?;
    Ok(response.command)
}
```

Register in `lib.rs`. Note: this command does NOT use `spawn_blocking` because `reqwest` is async — it runs naturally on the Tokio runtime.

#### 5. HTTP client configuration

Use a shared `reqwest::Client` with reasonable defaults:
- Timeout: 30 seconds
- No redirects needed
- User-Agent: "Velocity/0.1"

Create once (lazy_static or OnceCell) and reuse.

#### 6. Wire module

Add `pub mod llm;` to `lib.rs`.

### Frontend (React/TypeScript)

#### 1. IPC wrapper

Add to `src/lib/settings.ts` (or create `src/lib/llm.ts`):

```typescript
export async function translateCommand(
    input: string,
    shellType: string,
    cwd: string,
): Promise<string> {
    return invoke<string>('translate_command', {
        input,
        shellType,
        cwd,
    });
}
```

No UI changes in this task — the Agent Mode UI comes in TASK-017.

### IPC Contract

```
translate_command(input: String, shell_type: String, cwd: String) -> Result<String, String>
```
- `input`: The natural language text from the user
- `shell_type`: "powershell", "cmd", or "wsl"
- `cwd`: Current working directory (will be determined by the frontend or fetched from the PTY)
- Returns: The translated shell command as a string
- Errors: "No API key configured", "Unknown provider", HTTP errors, parse errors

## Tests (Write These FIRST)

### Rust Unit Tests (`src-tauri/src/llm/mod.rs`)

- [ ] **`test_build_system_prompt_powershell`**: `build_system_prompt("powershell", "C:\\Users\\test")` → contains "powershell" and "C:\\Users\\test"
- [ ] **`test_build_system_prompt_cmd`**: Contains "cmd"
- [ ] **`test_clean_response_plain`**: `clean_response("dir /s")` → `"dir /s"`
- [ ] **`test_clean_response_strips_code_fence`**: `clean_response("```\ndir /s\n```")` → `"dir /s"`
- [ ] **`test_clean_response_strips_code_fence_with_lang`**: `clean_response("```powershell\ndir /s\n```")` → `"dir /s"`
- [ ] **`test_clean_response_trims_whitespace`**: `clean_response("  dir /s  \n")` → `"dir /s"`
- [ ] **`test_translate_fails_without_api_key`**: Create settings with empty api_key. Call `translate_command`. Assert error contains "No API key".
- [ ] **`test_translate_fails_with_unknown_provider`**: Settings with provider "invalid". Assert error.

### Frontend Tests (Vitest)

- [ ] **`test_translateCommand_calls_invoke`**: Mock invoke. Call `translateCommand("list files", "powershell", "C:\\")`. Assert invoke called with correct params.

### E2E Tests (Playwright)

Skipped — no UI changes in this task. Agent Mode UI is TASK-017.

### Rust Integration Tests

Skipped — integration tests would require real API keys. The unit tests cover the logic. Manual testing with real keys verifies the HTTP calls.

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] `llm` module with `translate_command` function
- [ ] All 4 providers implemented (OpenAI, Anthropic, Google, Azure)
- [ ] System prompt includes shell type and CWD
- [ ] Response cleaning strips code fences and whitespace
- [ ] `translate_command` Tauri command registered
- [ ] Frontend IPC wrapper for `translateCommand`
- [ ] Error handling: no API key, unknown provider, HTTP errors, parse errors
- [ ] Shared `reqwest::Client` with 30s timeout
- [ ] All existing tests pass
- [ ] Clean commit: `feat: add multi-provider LLM client for command translation`

## Security Notes

- **API keys are read from local settings file** — never hardcoded, never logged.
- **User input is sent to the configured LLM API** — this is the explicit purpose of the feature. The user chose to configure this.
- **LLM responses are NOT executed** — they populate the input editor for review. The user must press Enter to execute.
- **No new IPC surface beyond `translate_command`** — minimal attack surface.
- **HTTP requests use HTTPS** — all provider endpoints are HTTPS.
- **Azure endpoint validation**: must start with `https://`.

## Files to Read First

- `src-tauri/src/settings/mod.rs` — AppSettings struct, load_settings
- `src-tauri/src/commands/mod.rs` — Existing command patterns
- `src-tauri/src/lib.rs` — Module + command registration
- `src-tauri/Cargo.toml` — reqwest already added
- `src/lib/settings.ts` — Existing IPC wrappers for settings
