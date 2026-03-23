# Task 044: Command Corrections (P1-I3)

## Context
When a user mistypes a command (e.g., `gti status`, `npm instal`, `carg build`), the terminal shows an error but offers no help. This task adds a simple heuristic-based "Did you mean?" suggestion for common typos — NO LLM needed (unlike the AI error correction in TASK-035 which analyzes error output).

## Requirements
### Frontend only.

1. **Typo detection**: When a command fails with "not found" / "not recognized" error patterns, check if the first word is a close match to a known command.
2. **Levenshtein distance**: Use edit distance to find the closest known command. Suggest if distance <= 2.
3. **Suggestion UI**: Show below the failed block: "Did you mean: `git status`? [Use]". Reuse the ErrorSuggestion component pattern from TASK-035 but simpler (no LLM call, instant).
4. **Known commands**: Use the existing `knownCommands` set from `useKnownCommands`.
5. **Priority**: This fires BEFORE the AI error correction (TASK-035). If a typo correction is found, show it instead of calling the LLM. If no typo match, fall through to AI error correction.
6. **Common patterns**: Also detect common shell typos like `cd..` → `cd ..`, `ls-la` → `ls -la`.

## Tests
- [ ] `test_levenshtein_distance`: Distance between "git" and "gti" is 1.
- [ ] `test_suggest_closest_command`: "gti" with known commands ["git", "go"] → suggests "git".
- [ ] `test_no_suggestion_for_large_distance`: "xyz" with known commands → no suggestion (distance > 2).
- [ ] `test_typo_correction_shown_in_ui`: Failed command with typo shows correction suggestion.
- [ ] `test_typo_overrides_ai_suggestion`: When typo detected, AI error correction is skipped.
- [ ] `test_common_pattern_cd_no_space`: "cd.." → "cd ..".

## Files to Read First
- `src/components/blocks/BlockView.tsx` — ErrorSuggestion integration
- `src/components/blocks/ErrorSuggestion.tsx` — existing AI suggestion pattern
- `src/hooks/useKnownCommands.ts` — known commands
- `src/components/Terminal.tsx` — command completion detection

## Acceptance Criteria
- [ ] Typo corrections shown instantly (no LLM)
- [ ] Based on Levenshtein distance to known commands
- [ ] Common patterns handled (cd.., ls-la)
- [ ] "Use" button populates input with corrected command
- [ ] Fires before AI error correction
- [ ] All tests pass
- [ ] Commit: `feat: add heuristic command typo corrections`
