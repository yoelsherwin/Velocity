# Code Review: TASK-035 AI Error Correction (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: 37bbd0a `feat: add AI-powered error correction suggestions`

## Verdict: PASS (with minor findings)

No blocking issues. The implementation is secure, well-structured, and follows established patterns.

---

## Security Review

### LLM Prompt Safety: PASS

The `build_fix_prompt` function interpolates `shell_type` and `cwd` into the system prompt. Both values originate from the application's own state (shell selector and Tauri process CWD), not from direct user text input. The `build_fix_user_message` function includes the user's command and error output in the user message. These are sent to the LLM as structured prompt content, not executed. This is the correct approach -- the LLM needs the error context to suggest a fix.

### Error Output Truncation: PASS

Error output is truncated in two independent layers:

1. **Frontend** (`ErrorSuggestion.tsx` line 37): `output.length > 2000 ? output.slice(-2000) : output` -- truncates before IPC call.
2. **Rust** (`llm/mod.rs` `truncate_error_output`): Caps at `MAX_ERROR_OUTPUT_CHARS = 2000` characters, keeping the tail.

This double truncation is defense-in-depth. The Rust layer protects against a hypothetical direct IPC caller bypassing the frontend.

### Suggested Command Never Auto-Executed: PASS

The "Use" button calls `onUseFix(suggestion.suggested_command)` which flows to `handleUseFix` in Terminal.tsx:

```typescript
const handleUseFix = useCallback((command: string) => {
    setInput(command);
}, []);
```

This only populates the input editor. The user must manually press Enter to execute. The suggested command is never passed to `submitCommand` or `writeToSession` directly. This is the correct security boundary.

### API Key Handling: PASS

Reuses the existing `settings::load_settings()` pattern. The API key is read from the settings file, never logged or sent to the frontend. Error messages use `sanitize_error` to strip API keys from error strings. The `hasApiKey` boolean check on the frontend only stores a boolean, not the key itself.

### IPC Input Validation: PASS

The `suggest_fix` Tauri command accepts typed parameters (`String`, `i32`, `String`, `String`, `String`). The Rust side validates that the API key is non-empty before proceeding. All HTTP errors are sanitized via `sanitize_error`. No `unwrap()` on user-derived data.

---

## Architecture Review

### Rust Side

1. **Code organization**: The new fix suggestion code follows the exact same pattern as the existing `translate_command` feature -- `FixRequest`/`FixResponse` structs, per-provider call functions, shared `clean_response` for JSON extraction. Consistent and maintainable.

2. **All four LLM providers supported**: OpenAI, Anthropic, Google, and Azure each have dedicated `call_*_fix` functions mirroring the existing `call_*_translation` functions. Temperature is set to 0.3 (lower than default, appropriate for deterministic suggestions). `max_tokens: 200` is a reasonable cap for a single command + explanation.

3. **JSON response parsing**: `parse_fix_response` gracefully handles malformed LLM output by returning an empty command with an explanation. This prevents a bad LLM response from crashing or showing garbage.

4. **Error propagation**: The `suggest_fix` function returns `Result<FixResponse, String>`, properly propagated through the Tauri command layer.

### Frontend Side

5. **ErrorSuggestion component**: Clean, self-contained. Uses `useEffect` with a cancellation flag (`cancelled`) to prevent stale updates. The `React.memo` wrapper prevents unnecessary re-renders.

6. **mostRecentFailedBlockId computation**: Uses `useMemo` to scan blocks from the end, returning the ID of the most recently failed block. This ensures only one block shows a suggestion at a time, preventing visual clutter.

7. **BlockView integration**: The `ErrorSuggestion` is only rendered when `isMostRecentFailed && block.exitCode != null && block.exitCode !== 0 && block.status === 'completed' && onUseFix`. This is a thorough guard condition.

8. **hasApiKey state**: Fetched once on mount via `getSettings()`. This avoids re-checking on every failure but means the state won't update if the user adds an API key mid-session without restarting.

### Test Coverage

- **Rust**: 8 new unit tests covering prompt construction, JSON parsing (valid, invalid, markdown-wrapped), truncation (long/short), user message content, and API key validation.
- **Frontend**: 8 new component tests covering success path, exit code 0, use/dismiss buttons, loading state, no API key, empty command, and LLM failure.

---

## Findings

### F-1: Bug Risk -- `truncate_error_output` panics on multi-byte UTF-8 (Severity: Medium)

**Location**: `src-tauri/src/llm/mod.rs`, `truncate_error_output` function

```rust
fn truncate_error_output(output: &str) -> &str {
    if output.len() <= MAX_ERROR_OUTPUT_CHARS {
        output
    } else {
        &output[output.len() - MAX_ERROR_OUTPUT_CHARS..]
    }
}
```

`str.len()` returns byte count, and slicing at an arbitrary byte offset can panic if it lands in the middle of a multi-byte UTF-8 character. PTY output can contain Unicode (e.g., emoji in file paths, non-ASCII error messages).

**Fix**: Use `output.char_indices()` to find a valid character boundary near the target offset, or use `output.chars().rev().take(MAX_ERROR_OUTPUT_CHARS).collect()` (though this allocates).

**Practical risk**: Low in practice because most terminal error output is ASCII, but violates defensive coding principles. The project security rules state "Treat all PTY output as untrusted."

### F-2: Minor -- hasApiKey not reactive to settings changes (Non-blocking)

**Location**: `src/components/Terminal.tsx` lines 424-431

The `hasApiKey` state is fetched once on mount. If the user opens Settings, adds an API key, and then runs a command that fails, the suggestion feature won't activate until the terminal is remounted (e.g., by switching tabs or restarting the session).

**Mitigation**: Could listen for a settings-changed event or re-check on each failure. Non-blocking for R1 as this is an edge case with a simple workaround (restart terminal).

### F-3: Minor -- Duplicated provider call functions (Non-blocking)

**Location**: `src-tauri/src/llm/mod.rs`

The four `call_*_fix` functions are nearly identical to the four `call_*_translation` functions, differing only in temperature and max_tokens. This adds ~200 lines of near-duplicate code. A generic helper function parameterized by temperature/max_tokens/endpoint would reduce duplication.

**Severity**: Low (maintainability, not correctness). Existing pattern in the codebase.

### F-4: Info -- `cwd` fallback in BlockView

**Location**: `src/components/blocks/BlockView.tsx` line 123

```tsx
cwd={cwd || 'C:\\'}
```

The `'C:\\'` fallback is Windows-specific but appropriate since Velocity is a Windows terminal. If WSL support expands in the future, this may need revisiting.

---

## Summary

The implementation is well-architected with proper security boundaries: error output is truncated, the LLM suggestion is display-only (never auto-executed), API keys are handled safely, and all four provider integrations are consistent. The main finding (F-1) is a potential panic on multi-byte UTF-8 truncation that should be addressed. All other findings are non-blocking quality improvements.

**Recommendation**: PASS -- merge-ready after addressing F-1 (UTF-8 safe truncation).
