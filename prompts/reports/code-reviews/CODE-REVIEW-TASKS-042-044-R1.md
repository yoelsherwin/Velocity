# Code Review: TASK-042 (Block Filtering) + TASK-044 (Command Corrections) -- R1

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commits**: `44e77fc` (TASK-042), `157104a` (TASK-044)
**Test results**: 547/547 tests passed (52 test files; 1 OOM crash in runner, not a test failure)

---

## TASK-042: Block Output Filtering

### What was implemented
- Per-block filter bar with text input, match count, and close button
- Filter button in block actions area
- Lines split on `\n`, matched case-insensitively against `stripAnsi(line)`
- Escape key closes filter bar and restores full output
- ANSI codes preserved in filtered output (filtering strips for matching, keeps original lines)
- CSS styles for filter bar in `App.css`
- 7 tests covering button display, open/close, filtering, case-insensitivity, line count, escape, ANSI preservation

### Findings

#### [MEDIUM] Filter on running blocks uses stale `block.output` split
The `outputLines` memo depends on `block.output`, which updates as new output streams in. This is correct -- the memo will recompute when output changes. However, the `filteredOutput` memo recalculates on every output change while filter is open, which could cause performance issues on high-throughput commands (e.g., `find /`). Consider debouncing the filter recalculation for running blocks.

**File**: `src/components/blocks/BlockView.tsx`, lines 42-57

#### [LOW] `redactedSegments` computed on unfiltered `block.output`
The `useSecretRedaction` hook receives `block.output` but the `<AnsiOutput>` component receives `filteredOutput`. When filtering is active, the redacted segment offsets from the full output will not align with the filtered text. Secrets in filtered output may not be properly masked when the filter removes lines before the secret.

**File**: `src/components/blocks/BlockView.tsx`, line 39 vs line 200

#### [LOW] Filter bar visible even on welcome block
The filter button is rendered in the block-actions area unconditionally (line 233-235). For the welcome block (`block.command === ''`), a filter bar is unlikely useful. Not a bug, but slightly inconsistent with how other actions (Copy Command, Rerun) are hidden for welcome blocks.

#### [NITPICK] `setTimeout` for focus
Using `setTimeout(() => filterInputRef.current?.focus(), 0)` (line 63) is a common pattern but fragile. A `useEffect` watching `filterOpen` would be more React-idiomatic and reliable.

#### [PASS] Line splitting logic
Correctly splits on `\n`, filters against ANSI-stripped text, and rejoins with `\n` to preserve ANSI codes. Case-insensitive matching works properly.

#### [PASS] Escape-to-close
Keyboard handler correctly catches Escape and resets both `filterOpen` and `filterText` state.

#### [PASS] Test coverage
Tests cover the key scenarios: button appears, input opens, filtering works, case-insensitivity, line count display, escape clears, ANSI preservation.

---

## TASK-044: Command Corrections

### What was implemented
- `command-corrections.ts` module with:
  - Damerau-Levenshtein distance (transpositions counted as single edit)
  - `suggestCorrection()` -- finds closest known command within distance <= 2
  - `detectCommonPatterns()` -- regex-based fixes for `cd..`, `cd/`, `ls-la`, `ls-al`
  - `isCommandNotFoundError()` -- pattern matching against error output
  - `getTypoCorrection()` -- orchestrator: patterns first, then Levenshtein
- BlockView integration: typo correction shown instead of AI ErrorSuggestion when available
- `knownCommands` prop threaded from Terminal.tsx
- 13 tests covering distance calculation, correction suggestions, common patterns, UI display, priority over AI

### Findings

#### [MEDIUM] `suggestCorrection` case-sensitivity on `knownCommands.has()` check
Line 61: `knownCommands.has(firstWord)` is case-sensitive, but the Levenshtein comparison at line 68 lowercases both sides. If `knownCommands` contains `"git"` and the user types `"Git"`, it won't match the `has()` check (so it proceeds to suggest), and the Levenshtein distance will be 0, which is then excluded by the `bestDistance > 0` check on line 76. So typing `"Git"` with `"git"` in known commands returns null -- correct but possibly surprising. Consider lowercasing the `has()` check too.

**File**: `src/lib/command-corrections.ts`, line 61

#### [MEDIUM] `NOT_FOUND_PATTERNS` too broad
The pattern `/not found/i` (line 121) will match any output containing "not found" anywhere, including legitimate command output like `"File not found"` or `"Page not found"`. This could trigger false positive typo corrections. The more specific patterns above it are good, but this catch-all is risky.

**File**: `src/lib/command-corrections.ts`, line 121

#### [LOW] `detectCommonPatterns` bypasses error output check
In `getTypoCorrection()`, `detectCommonPatterns` runs before `isCommandNotFoundError()`. This means typing `cd..` will suggest `cd ..` even if the command succeeded (though the caller in BlockView already gates on `exitCode !== 0`). The defense-in-depth is in BlockView, not in the library function. Acceptable but worth documenting.

**File**: `src/lib/command-corrections.ts`, lines 142-144

#### [PASS] Levenshtein distance correctness
The Damerau-Levenshtein implementation is correct. It properly handles:
- Base cases (empty strings)
- Full DP matrix for transposition lookback
- Transposition condition: `a[i-1] === b[j-2] && a[i-2] === b[j-1]`
- Cost of 1 for transposition from `d[i-2][j-2] + 1`

Note: This is the Optimal String Alignment variant (not full Damerau-Levenshtein), which is appropriate here since it doesn't allow a substring to be edited more than once. Fine for typo detection.

#### [PASS] Security -- no injection risk
The correction only replaces the first word of the command with a known command from the `knownCommands` set. The rest of the command (`parts.slice(1)`) is preserved as-is from the user's original input. No new content is synthesized beyond what's in the known commands list. The `onUseFix` callback passes the corrected string to the input editor -- it does not auto-execute. No injection vector.

#### [PASS] Priority over AI
BlockView renders typo correction (`typoCorrection ? ...`) before falling through to `<ErrorSuggestion>`. When a typo correction is found, the AI suggestion is completely skipped. Test `test_typo_overrides_ai_suggestion` verifies this.

#### [PASS] Test coverage
13 tests cover distance calculation, suggestion logic, common patterns, UI rendering, override behavior, and use-button callback.

---

## Summary

| Severity | Count | Tasks |
|----------|-------|-------|
| MEDIUM   | 3     | 042 (1), 044 (2) |
| LOW      | 3     | 042 (2), 044 (1) |
| NITPICK  | 1     | 042 (1) |

### Required fixes before merge
1. **[MEDIUM]** Narrow the `/not found/i` pattern in `NOT_FOUND_PATTERNS` to reduce false positives (e.g., `/(^|\b)command not found/i` or remove the catch-all since the more specific patterns cover real shells).
2. **[MEDIUM]** Consider debouncing filter recalculation for running blocks to avoid performance issues on high-output commands.

### Recommended improvements
3. Fix redacted segment offset mismatch when filter is active.
4. Lowercase the `knownCommands.has()` check in `suggestCorrection` for consistency.
5. Use `useEffect` instead of `setTimeout` for filter input focus.

**Verdict**: Needs minor fixes (2 medium issues should be addressed). Overall implementation is solid with good test coverage.
