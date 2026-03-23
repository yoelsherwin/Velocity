# QA Report: TASK-035 AI Error Correction (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: 37bbd0a `feat: add AI-powered error correction suggestions`

## Test Results: ALL PASS

### Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (Vitest) | 451 passed, 0 failed | PASS |
| Rust (cargo test) | 127 unit + 11 integration passed, 0 failed | PASS |

All pre-existing tests continue to pass. No regressions detected.

---

### New Test Coverage

**Rust unit tests (8)**:
- `test_fix_suggestion_prompt_includes_context` -- verifies shell type and CWD in prompt
- `test_fix_response_parsing_valid` -- parses valid JSON correctly
- `test_fix_response_parsing_invalid` -- gracefully handles non-JSON
- `test_fix_response_strips_markdown` -- strips markdown code fences from response
- `test_error_output_truncated` -- truncates 5000-char output to 2000
- `test_error_output_short_not_truncated` -- passes short output unchanged
- `test_fix_user_message_contains_context` -- verifies command, exit code, error output in message
- `test_suggest_fix_fails_without_api_key` -- returns error when API key is empty

**Frontend component tests (8)**:
- `test_error_suggestion_shown_for_failed_command` -- full lifecycle: loading -> suggestion display
- `test_error_suggestion_hidden_for_success` -- no render for exit code 0
- `test_use_button_populates_input` -- Use button calls onUseFix with suggested command
- `test_dismiss_button_hides_suggestion` -- Dismiss hides the component
- `test_suggestion_loading_state` -- loading spinner shown while LLM is in-flight
- `test_no_suggestion_without_api_key` -- no render and no API call when hasApiKey=false
- `test_hides_when_llm_returns_empty_command` -- hides when LLM can't suggest a fix
- `test_hides_silently_on_llm_failure` -- hides without error on network failure

---

## Bug Hunt Results

### Scenario 1: Multiple rapid failures

**Analysis**: When commands fail in quick succession, `mostRecentFailedBlockId` (Terminal.tsx line 93-101) scans from the end of the blocks array and returns only the last failed block. The `isMostRecentFailed` prop ensures only one block shows a suggestion at a time.

The `ErrorSuggestion` component uses a `useEffect` with a cancellation flag (`cancelled`). If a new error suggestion is triggered before the previous LLM call completes, the cleanup function sets `cancelled = true`, preventing the stale response from being applied.

**Verdict**: NO BUG. Only the most recent failure shows a suggestion. Previous in-flight LLM calls are properly cancelled via the cleanup function.

### Scenario 2: Suggestion attached to wrong block

**Analysis**: The `mostRecentFailedBlockId` memo depends on `[blocks]`. When a new block is added (user runs a new command), the memo recomputes. If the new command succeeds (exit code 0) or is still running, the most recent failed block remains the previous one. If the new command fails, it becomes the new most recent.

The `ErrorSuggestion` component is rendered inside `BlockView`, which receives `isMostRecentFailed` as a prop. Only the block whose `id === mostRecentFailedBlockId` gets `isMostRecentFailed=true`.

**Potential concern**: When a new command starts running (no exit code yet), the previously failed block retains its suggestion. When the new command completes, if it succeeds, `mostRecentFailedBlockId` still points to the old failed block (correct). If it fails, `mostRecentFailedBlockId` changes to the new block, and the old block's `ErrorSuggestion` unmounts.

**Verdict**: NO BUG. Block identity is correctly maintained through the block ID system.

### Scenario 3: LLM racing with new commands

**Analysis**: The `ErrorSuggestion` component's `useEffect` dependency array is `[command, exitCode, output, shellType, cwd, hasApiKey]`. If any of these change (e.g., because a new block is now the most recent failed), the effect re-runs with a fresh `cancelled` flag.

However, the `ErrorSuggestion` is rendered per-BlockView and receives the block's own command/output/exitCode. These props are immutable once a block is completed. The only way for them to change would be if the same BlockView received a different block, which doesn't happen because blocks are keyed by `block.id`.

When `isMostRecentFailed` flips from `true` to `false`, the `ErrorSuggestion` unmounts entirely (the conditional in BlockView prevents rendering). The cleanup function fires, setting `cancelled = true`.

**Verdict**: NO BUG. Component lifecycle correctly handles LLM races.

### Scenario 4: Dismiss persistence

**Analysis**: The `dismissed` state is local to the `ErrorSuggestion` component instance. When the user clicks "Dismiss", `setDismissed(true)` hides the component. However, the `useEffect` resets `setDismissed(false)` at the start of each run.

Since the props (command, exitCode, output) are immutable for a completed block, the effect only runs once. After the user dismisses, the state stays dismissed. If the component unmounts and remounts (e.g., scrolling out of and back into the viewport), the `useEffect` would re-fire and the suggestion would reappear.

**Potential concern**: Dismissal is not persisted across BlockView unmount/remount cycles (caused by viewport virtualization via `isVisible`). However, looking at BlockView line 117, the `ErrorSuggestion` is always rendered for the most recent failed block (not gated by `isVisible`). The `isVisible` flag only gates the output `<pre>` rendering, not the `ErrorSuggestion`. So the component stays mounted as long as `isMostRecentFailed` is true.

**Verdict**: NO BUG. Dismiss state persists for the lifetime of the suggestion component. The component only unmounts when a newer failure occurs or the user runs a successful command, at which point the dismiss state is no longer relevant.

### Scenario 5: Empty/whitespace command in failed block

**Analysis**: The `ErrorSuggestion` effect checks `if (exitCode === 0 || !hasApiKey || !command) return;`. The `!command` guard prevents API calls for the welcome block (empty command). A block with only whitespace as a command would pass this check (`"  "` is truthy), but this is acceptable since the shell would have executed it.

**Verdict**: NO BUG. Empty commands are properly guarded.

### Scenario 6: Very large error output

**Analysis**: PTY output is already capped at `OUTPUT_LIMIT_PER_BLOCK = 500_000` characters in Terminal.tsx. The frontend additionally truncates to 2000 chars before IPC, and the Rust backend truncates again to 2000 chars. This means at most 2000 characters are sent to the LLM, well within token limits.

**Verdict**: NO BUG. Multiple layers of truncation protect against oversized payloads.

### Scenario 7: API key configured after mount

**Analysis**: The `hasApiKey` state is set once on mount via `getSettings()`. If the user configures an API key after mount, `hasApiKey` remains `false` until the terminal remounts. This means error suggestions won't appear for failures occurring before remount.

**Verdict**: MINOR UX GAP. Not a bug -- workaround is to switch tabs or restart the session. Noted in code review as F-2.

---

## Summary

All automated tests pass (451 frontend + 138 Rust). No regressions. The bug hunt across seven risk scenarios found no functional issues. The cancellation flag pattern correctly handles rapid failures, the `mostRecentFailedBlockId` memo correctly tracks block identity, and dismiss state persists correctly for the component's lifetime. One minor UX gap noted (API key not reactive to mid-session changes).

**Verdict**: PASS -- ready for merge.
