# Task 025: LLM Fallback for Ambiguous Intent Classification (P0-8c)

## Context

Velocity's intent classifier (`classifyIntent()`) determines if user input is a CLI command or natural language. When it can't decide (confidence: `'low'`), it just guesses — `cli` for 1-2 word unknowns, `natural_language` for 3+ word unknowns. The ModeIndicator shows `CLI?` or `AI?` but the system takes no extra action.

P0-8c adds an LLM fallback: when confidence is low, ask the LLM "is this CLI or natural language?" before deciding the execution path. This only fires on Enter (submit), not on every keystroke.

### What exists now

- **intent-classifier.ts** (`src/lib/intent-classifier.ts`, 92 lines): `classifyIntent(input, knownCommands)` returns `{ intent: 'cli' | 'natural_language', confidence: 'high' | 'low' }`. Returns `low` confidence for ambiguous inputs (unknown 1-2 word inputs, or 3+ words without clear CLI/NL signals).

- **llm.ts** (`src/lib/llm.ts`): `translateCommand(input, shellType, cwd)` invokes Rust `translate_command`. Single function, single purpose.

- **Terminal.tsx** (`src/components/Terminal.tsx`): `handleSubmit()` checks `inputMode.intent` — if `natural_language`, calls LLM translate; if `cli`, executes directly. Ignores `confidence` entirely.

- **ModeIndicator.tsx** (`src/components/editor/ModeIndicator.tsx`): Shows `CLI?`/`AI?` for low confidence. Already has the UI signal.

- **Rust LLM module** (`src-tauri/src/llm/mod.rs`): Supports OpenAI, Anthropic, Google, Azure providers. Has `translate_command()` function with a system prompt. Temperature 0.1.

- **Rust commands** (`src-tauri/src/commands/mod.rs`): Has `translate_command` Tauri command.

- **Settings** (`src-tauri/src/settings/mod.rs`): `AppSettings` with `llm_provider`, `api_key`, `model`, `azure_endpoint`.

### Key types

```typescript
// intent-classifier.ts
type InputIntent = 'cli' | 'natural_language';
interface ClassificationResult {
  intent: InputIntent;
  confidence: 'high' | 'low';
}

// llm.ts
async function translateCommand(input: string, shellType: string, cwd: string): Promise<string>
```

## Requirements

### Overview

When the user presses Enter and the intent classifier has low confidence, call the LLM to classify the input before deciding whether to execute it as CLI or translate it as natural language. This is a lightweight LLM call (simpler prompt than translation) that resolves ambiguity.

### Backend (Rust)

#### 1. New LLM function: `classify_intent` (`src-tauri/src/llm/mod.rs`)

```rust
pub struct ClassificationRequest {
    pub input: String,
    pub shell_type: String,
    pub known_commands: Vec<String>,  // Top matches for context
}

pub struct ClassificationResponse {
    pub intent: String,  // "cli" or "natural_language"
}

pub async fn classify_intent(
    settings: &AppSettings,
    request: &ClassificationRequest,
) -> Result<ClassificationResponse, String>
```

**System prompt** (much simpler than translation):
```
You are a terminal input classifier. Determine if the user's input is a CLI command or a natural language request.

Rules:
- Output ONLY "cli" or "natural_language". Nothing else.
- Shell type: {shell_type}
- Known commands on this system include: {top 10 known commands matching first word}
- "cli" means the input is meant to be executed directly as a shell command
- "natural_language" means the input is a question or request in English

Examples:
Input: "git status" → cli
Input: "show me all running processes" → natural_language
Input: "docker compose up -d" → cli
Input: "what ports are open" → natural_language
Input: "netstat -an" → cli
Input: "create a new react project" → natural_language
```

**Temperature**: 0.0 (deterministic — this is a binary classification)
**Max tokens**: 10 (we only need one word)

#### 2. New Tauri command: `classify_intent_llm` (`src-tauri/src/commands/mod.rs`)

```rust
#[tauri::command]
pub async fn classify_intent_llm(
    input: String,
    shell_type: String,
) -> Result<String, String>  // Returns "cli" or "natural_language"
```

- Load settings, build classification request
- Call `llm::classify_intent()`
- Validate response is exactly "cli" or "natural_language"
- If response doesn't parse, default to `"cli"` (safer — don't send to LLM if unsure)
- If no API key configured, return error (caller handles gracefully)

Register in `lib.rs`.

### Frontend (React/TypeScript)

#### 3. New function in llm.ts

```typescript
export async function classifyIntentLLM(
  input: string,
  shellType: string,
): Promise<'cli' | 'natural_language'>
```

Calls `invoke('classify_intent_llm', { input, shellType })`.

#### 4. Update Terminal.tsx `handleSubmit()`

Current flow:
```
Enter → check inputMode.intent → execute CLI or translate NL
```

New flow:
```
Enter → check inputMode.confidence
  → if high: same as before (execute CLI or translate NL)
  → if low: call classifyIntentLLM() to resolve
    → show a brief loading state ("Classifying...")
    → use the LLM result to decide CLI or NL path
    → if LLM call fails (no API key, network error): fall back to heuristic result
```

**Implementation**:
```typescript
const handleSubmit = useCallback(async (cmd: string) => {
  const trimmed = cmd.trim();
  if (!trimmed) { setInput(''); return; }

  let resolvedIntent = inputMode.intent;

  // LLM fallback for ambiguous classification
  if (inputMode.confidence === 'low') {
    try {
      setAgentLoading(true);
      setAgentError(null);
      resolvedIntent = await classifyIntentLLM(trimmed, shellType);
      // Update the mode indicator to show the resolved intent
      setInputMode({ intent: resolvedIntent, confidence: 'high' });
    } catch {
      // LLM unavailable — use heuristic result
      resolvedIntent = inputMode.intent;
    } finally {
      setAgentLoading(false);
    }
  }

  if (resolvedIntent === 'natural_language') {
    // ... existing NL translation flow
  } else {
    // ... existing CLI execution flow
  }
}, [...]);
```

#### 5. Update loading state

Currently the loading spinner says "Translating...". For the classification step, it should say "Classifying..." briefly, then switch to "Translating..." if it enters the NL path. Use the existing `agentLoading` state but update the label based on the current step.

Add a `classifying` state or change the loading text:
```typescript
const [loadingLabel, setLoadingLabel] = useState<string>('');
// Before classification: setLoadingLabel('Classifying...');
// Before translation: setLoadingLabel('Translating...');
```

### IPC Contract

**New command:**
```
classify_intent_llm(input: String, shell_type: String) -> String
```
Returns `"cli"` or `"natural_language"`.

### Performance Considerations

- The LLM classification call only happens on Enter with low confidence — NOT on every keystroke.
- With max_tokens=10 and a simple prompt, this should be very fast (~200-500ms for OpenAI/Anthropic).
- If the LLM is unavailable (no API key, network error), fall back to the heuristic instantly.
- The translation ID ref pattern (already exists) should be extended to cover classification staleness too.

### Security Considerations

- The user's input text is sent to the LLM for classification — same as the existing translation feature.
- API key handling: reuse existing settings/provider infrastructure.
- Response validation: only accept exact "cli" or "natural_language" — reject anything else.
- Error message sanitization: reuse existing API key redaction.

## Tests (Write These FIRST)

### Rust Unit Tests

- [ ] `test_classify_intent_system_prompt_contains_shell_type`: Verify the prompt includes the shell type.
- [ ] `test_classify_intent_response_parsing_cli`: Response "cli" parsed correctly.
- [ ] `test_classify_intent_response_parsing_nl`: Response "natural_language" parsed correctly.
- [ ] `test_classify_intent_response_parsing_with_whitespace`: Response " cli \n" trimmed and parsed.
- [ ] `test_classify_intent_response_invalid_defaults_to_cli`: Response "maybe" defaults to "cli".

### Frontend Tests (Vitest)

- [ ] `test_submit_low_confidence_calls_llm_classify`: When inputMode has low confidence, handleSubmit calls classifyIntentLLM.
- [ ] `test_submit_high_confidence_skips_llm`: When high confidence, no LLM call — direct execution/translation.
- [ ] `test_submit_llm_classify_failure_uses_heuristic`: When LLM call fails, falls back to heuristic intent.
- [ ] `test_submit_llm_classify_returns_cli_executes`: LLM returns "cli" → command executed directly.
- [ ] `test_submit_llm_classify_returns_nl_translates`: LLM returns "natural_language" → enters translation flow.
- [ ] `test_classifying_loading_label_shown`: During classification, loading label says "Classifying...".
- [ ] `test_translating_loading_label_shown`: During translation, loading label says "Translating...".

### E2E Tests (Playwright)

- [ ] `test_e2e_ambiguous_input_classified`: Type an ambiguous input, press Enter, verify classification occurs (mock or verify loading state appears briefly).

### Test type requirements

| Test Type | This Task |
|-----------|-----------|
| Rust Unit | **REQUIRED** — new LLM function, response parsing |
| Frontend (Vitest) | **REQUIRED** — submit flow changes, loading states |
| E2E (Playwright) | **REQUIRED** — user-visible flow change |

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] New `classify_intent_llm` Tauri command registered and working
- [ ] LLM classification called on Enter when confidence is low
- [ ] LLM classification NOT called on every keystroke (only on submit)
- [ ] If LLM unavailable (no API key), falls back to heuristic gracefully
- [ ] If LLM returns invalid response, defaults to CLI
- [ ] Loading label shows "Classifying..." during classification, "Translating..." during translation
- [ ] Mode indicator updates to show resolved intent after classification
- [ ] High-confidence inputs bypass LLM classification entirely (no regression)
- [ ] Existing translation flow still works (no regression)
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `feat: add LLM fallback for ambiguous intent classification`

## Files to Read First

- `src/lib/intent-classifier.ts` — Current heuristic classifier
- `src/lib/llm.ts` — Current LLM translate function
- `src/components/Terminal.tsx` — handleSubmit flow, loading states
- `src/components/editor/ModeIndicator.tsx` — Mode display
- `src-tauri/src/llm/mod.rs` — LLM client, provider support, system prompts
- `src-tauri/src/commands/mod.rs` — Tauri command patterns
- `src-tauri/src/lib.rs` — Command registration
- `src-tauri/src/settings/mod.rs` — Settings types
