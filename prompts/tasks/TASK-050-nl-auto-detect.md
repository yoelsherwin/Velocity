# Task 050: NL Auto-Detection Without # Prefix (P2-6)

## Context
Currently, natural language mode requires a `#` prefix or manual mode toggle. With the LLM fallback (TASK-025) already classifying ambiguous inputs, we can remove the `#` requirement for high-confidence NL detections.

## Requirements
### Frontend only.

1. **Remove # requirement**: The intent classifier already detects NL with high confidence for question words, polite starters, and multi-word natural language. These should go directly to the NL path without needing `#`.
2. **Keep # as override**: `#` prefix still forces NL mode (backward compat). But it's no longer required.
3. **Confidence threshold**: Only auto-route to NL when confidence is `high`. Low confidence still goes through LLM fallback (TASK-025).
4. **User feedback**: When auto-detecting NL, briefly flash the ModeIndicator to draw attention to the mode change.
5. **Settings**: Add `auto_detect_nl` boolean to settings (default: true). Users can disable to require `#` again.
6. **Implementation**: In Terminal.tsx `handleSubmit`, when `inputMode.intent === 'natural_language'` AND `confidence === 'high'` AND no `#` prefix, auto-route to NL translation. The existing flow already handles this — just verify it works without `#`.

Actually — looking at the existing code, the intent classifier already sets `intent: 'natural_language'` with `confidence: 'high'` for clear NL inputs. And `handleSubmit` already routes based on `inputMode.intent`. So this may already work! The `#` prefix just forces the classification. The task is really:

1. Verify the auto-detection works without `#` for clear NL inputs.
2. Add the `auto_detect_nl` setting to opt out.
3. When disabled, require `#` for NL mode (change handleSubmit to check).
4. Add tests.

## Tests
- [ ] `test_nl_auto_detected_without_hash`: Input "show me all files" auto-classified as NL and routed to translation.
- [ ] `test_hash_still_works`: Input "# list processes" still works as NL.
- [ ] `test_cli_not_auto_detected_as_nl`: Input "git status" stays as CLI.
- [ ] `test_auto_detect_disabled_requires_hash`: With setting off, "show me files" executes as CLI.
- [ ] `test_auto_detect_setting_persists`: Setting saves/loads correctly.

### Rust
- [ ] `test_auto_detect_nl_setting_backward_compat`: Old settings deserialize.

## Files to Read First
- `src/lib/intent-classifier.ts` — Classification logic
- `src/components/Terminal.tsx` — handleSubmit flow
- `src-tauri/src/settings/mod.rs` — Settings
- `src/lib/types.ts` — AppSettings

## Acceptance Criteria
- [ ] Clear NL inputs auto-route to translation without #
- [ ] # prefix still works as override
- [ ] Settings toggle to disable auto-detection
- [ ] All tests pass
- [ ] Commit: `feat: enable NL auto-detection without hash prefix`
