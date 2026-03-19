# QA Report: TASK-025 LLM Fallback for Ambiguous Intent Classification (R1)

**Date**: 2026-03-19
**Commit**: `9a5fd58`
**Scope**: LLM-based classification when heuristic intent classifier returns low confidence. On Enter, if confidence is low, calls `classify_intent_llm` to ask the LLM "is this CLI or NL?" before deciding the execution path.

## 1. Test Results

### Frontend (Vitest)
- **33 test files, 359 tests** -- ALL PASSED
- TASK-025-specific tests:
  - `llm.test.ts` -- 6 tests (2 pre-existing + 4 new), all passed
    - `test_classifyIntentLLM_calls_invoke_with_correct_params`
    - `test_classifyIntentLLM_returns_natural_language`
    - `test_classifyIntentLLM_defaults_to_cli_for_invalid_response`
    - `test_classifyIntentLLM_propagates_errors`
  - `Terminal.test.tsx` -- 7 new LLM fallback tests, all passed
    - `test_submit_low_confidence_calls_llm_classify`
    - `test_submit_high_confidence_skips_llm`
    - `test_submit_llm_classify_failure_uses_heuristic`
    - `test_submit_llm_classify_returns_cli_executes`
    - `test_submit_llm_classify_returns_nl_translates`
    - `test_classifying_loading_label_shown`
    - `test_translating_loading_label_shown`

### Backend (cargo test)
- **105 unit tests, 11 integration tests** -- ALL PASSED (1 ignored: `test_spawn_powershell_session`, expected)
- TASK-025-specific Rust tests:
  - `test_classify_intent_system_prompt_contains_shell_type` -- passed
  - `test_classify_intent_response_parsing_cli` -- passed
  - `test_classify_intent_response_parsing_nl` -- passed
  - `test_classify_intent_response_parsing_with_whitespace` -- passed
  - `test_classify_intent_response_invalid_defaults_to_cli` -- passed
  - `test_classify_intent_fails_without_api_key` -- passed
  - `test_classification_prompt_contains_known_commands` -- passed
  - `test_classification_prompt_limits_to_10_commands` -- passed

### E2E (Playwright)
- `llm-intent-fallback.spec.ts` -- 1 test defined
- Not executed (requires running application); test is structurally sound and accounts for the no-API-key fallback path

## 2. Test Coverage Analysis

### Well-Covered Areas
- **Frontend IPC layer** (`src/lib/llm.ts`): invoke parameters, return value validation, error propagation, fallback for invalid LLM response
- **Rust classification prompt building**: shell type inclusion, known commands list, 10-command cap
- **Rust response parsing**: exact "cli", exact "natural_language", whitespace handling, invalid-defaults-to-cli
- **Rust API key guard**: missing key returns early error for classification path
- **Terminal integration**: low-confidence triggers LLM call, high-confidence skips it, LLM failure falls back to heuristic, LLM returning "cli" executes, LLM returning "natural_language" triggers translation, loading labels ("Classifying..." vs "Translating...") shown at correct times
- **Stale-request guard**: `translationIdRef` pattern prevents stale LLM results from applying after shell switch/reset

### Coverage Gaps
- **No test for the NL-low-confidence path**: All low-confidence tests use single-word unknown input (`foobar`) which the heuristic classifies as `cli, low`. There is no test for a 3+ word unknown input that produces `natural_language, low` -- the LLM fallback should still fire and potentially override to `cli`.
- **No test for concurrent submit attempts**: The input is disabled during `agentLoading`, but no test verifies this prevents double-submission during the classification window.
- **No backend integration test for classification**: The Rust `classify_intent` function is only tested for error paths (no API key, unknown provider); the HTTP call paths are not tested with a mock server.
- **No test for `known_commands: Vec::new()` in the command handler**: The `classify_intent_llm` Tauri command passes an empty `known_commands` vec. This means the LLM prompt gets "(none provided)" for known commands, reducing classification quality. No test verifies this intentional choice or its impact.
- **No test for race between classification and input change**: If the user types while classification is in-flight (though the input is disabled, accessibility tools or programmatic changes could bypass this), the resolved intent might apply to stale input.

## 3. Bugs Found

### BUG-025-1: Loading State Flickers Between Classification and Translation (LOW)

**Location**: `src/components/Terminal.tsx`, `handleSubmit` lines 448-465

**Description**: When `classifyIntentLLM` returns `"natural_language"`, the `finally` block (line 463) unconditionally calls `setAgentLoading(false)`. Immediately after, the natural_language branch (line 477) calls `setAgentLoading(true)` again. In React 18, state updates inside `async` functions are NOT automatically batched, so this produces a brief visual flicker where the loading indicator disappears and reappears.

**Reproduction**:
1. Configure a valid API key
2. Type an ambiguous input (e.g., `foobar`)
3. Press Enter
4. If LLM returns `natural_language`, observe a brief flash of the loading indicator

**Fix**: Move `setAgentLoading(false)` out of the `finally` block and call it only when the classification resolves to `"cli"` (or on error). Alternatively, skip the `finally` when `resolvedIntent === 'natural_language'` by checking before the finally:

```typescript
} catch {
  resolvedIntent = inputMode.intent;
  setAgentLoading(false);
} // Remove finally block; handle loading state per-branch below
```

### BUG-025-2: Empty `known_commands` Degrades LLM Classification Quality (LOW)

**Location**: `src-tauri/src/commands/mod.rs`, line 161

**Description**: The `classify_intent_llm` Tauri command always passes `known_commands: Vec::new()` to the classification request. The classification prompt then includes "(none provided)" for known commands, meaning the LLM has no context about what executables exist on the system. This reduces classification accuracy for inputs like `kubectl apply` or `terraform plan` where the LLM would benefit from knowing these are valid commands.

The comment says "Kept lightweight; the LLM prompt has its own examples" but those examples are hardcoded (`git status`, `docker compose up -d`, `netstat -an`) and do not cover the user's actual system.

**Impact**: The LLM may misclassify valid CLI commands as natural language if it does not recognize the command name, leading to unnecessary translation attempts.

**Fix**: Pass the cached known commands (same ones used for tab completions) to the classification request. The prompt already limits to 10 commands, so the payload is bounded.

### BUG-025-3: Google API Key Exposed in URL Query Parameter (PRE-EXISTING, INFO)

**Location**: `src-tauri/src/llm/mod.rs`, lines 299-302 (classification) and 553-556 (translation)

**Description**: The Google Gemini API key is passed as a URL query parameter (`?key=API_KEY`). This is Google's standard authentication method for this API, so this is not a code defect. However, the key may appear in:
- HTTP proxy/CDN logs
- `reqwest` error messages (mitigated by `sanitize_error`)
- System network diagnostics

This is a pre-existing pattern from TASK-018, not introduced by TASK-025. Noting for completeness.

## 4. Code Quality Assessment

### Positive Observations
- **Clean separation of concerns**: Rust handles LLM API calls and response validation; TypeScript handles UI state and routing logic; IPC bridge is a thin wrapper
- **Defensive defaults**: Invalid LLM response defaults to "cli" at three layers: Rust `parse_classification_response`, Rust `classify_intent_llm` command handler, and TypeScript `classifyIntentLLM` wrapper
- **Stale-request cancellation**: The `translationIdRef` pattern correctly prevents stale results from applying after shell switches or resets
- **Input disabled during loading**: Prevents double-submission during classification
- **Low max_tokens (10)**: Classification requests use `max_tokens: 10` and `temperature: 0.0`, minimizing cost and latency
- **Error handling**: LLM failure gracefully falls back to heuristic result without surfacing an error to the user
- **Code duplication is acceptable**: The four provider classification functions mirror the four translation functions. While there is structural duplication, each provider has unique API shapes, so a shared abstraction would add complexity without significant benefit at this scale.

### Minor Observations
- The `classification` functions and `translation` functions for each provider are nearly identical in structure. A future refactor could extract a generic `call_llm_provider` that accepts the endpoint/auth config and returns a raw string, with callers adding their own post-processing.
- The `classify_intent_llm` command does not pass `cwd` to the LLM, unlike `translate_command`. This is intentional (classification does not need CWD context) and correct.

## 5. Security Review

- **No user input interpolation into shell commands**: The LLM classification result is a fixed string ("cli" or "natural_language") and is validated before use. No injection vector.
- **IPC input validation**: The `classify_intent_llm` command receives `input` and `shell_type` as strings. These are passed to the LLM as user message content, not interpolated into URLs or commands (except `shell_type` in the prompt template, which is safe as it is a display value).
- **API key protection**: All error paths pass through `sanitize_error` which replaces the API key with `[REDACTED]`. The Google URL key-in-query concern is pre-existing and noted above.
- **No `unwrap()` on user-derived data**: All Rust code uses `map_err` / `ok_or` / `ok_or_else` patterns.

## 6. Manual Test Plan

### MTP-025-1: Low-Confidence CLI Input With API Key Configured
1. Open Settings, configure a valid LLM provider and API key
2. Type `foobar` (unknown single word, CLI low confidence)
3. Press Enter
4. **Expected**: "Classifying..." loading appears briefly, then command executes as CLI

### MTP-025-2: Low-Confidence NL Input With API Key Configured
1. Configure a valid API key
2. Type `fix something broken here` (unknown multi-word, NL low confidence)
3. Press Enter
4. **Expected**: "Classifying..." appears, then either executes as CLI or shows "Translating..." and populates a translated command

### MTP-025-3: LLM Fallback Without API Key
1. Ensure no API key is configured (default state)
2. Type `foobar` and press Enter
3. **Expected**: LLM call fails silently, falls back to heuristic, command executes as CLI. No error shown.

### MTP-025-4: High-Confidence Input Bypasses LLM
1. Type `git status` (known command, high confidence CLI)
2. Press Enter
3. **Expected**: Command executes immediately. No "Classifying..." loading appears.

### MTP-025-5: Hash Prefix Still Works
1. Type `# list all files`
2. Press Enter
3. **Expected**: Treated as high-confidence NL (no LLM classification needed), goes straight to translation

### MTP-025-6: Shell Switch During Classification
1. Configure a valid API key with a slow model
2. Type `foobar` and press Enter (triggers classification)
3. Immediately click "CMD" shell tab
4. **Expected**: Classification result is discarded. New session starts cleanly. No stale result applied.

### MTP-025-7: Mode Toggle Override Persists
1. Type `foobar` (CLI low confidence)
2. Click the mode indicator to toggle to NL (mode override)
3. Press Enter
4. **Expected**: Since mode is now NL high confidence (overridden), goes straight to translation. No LLM classification.

## 7. Verdict

**PASS with minor issues.**

The LLM fallback for ambiguous intent classification is well-implemented with proper error handling, stale-request guards, and triple-layer defensive defaults. Test coverage is thorough for the primary flows. The two bugs found are both LOW severity:

- BUG-025-1 (loading flicker) is a cosmetic UX issue that only manifests when the LLM is available and returns "natural_language"
- BUG-025-2 (empty known_commands) is an optimization opportunity that reduces classification accuracy but does not cause incorrect behavior

No blocking issues. No security vulnerabilities introduced. Ship-ready.
