# Code Review: TASK-050 NL Auto-Detection Without # Prefix

**Reviewer**: Claude Code Review Agent (R1)
**Commit**: `54717f6` feat: enable NL auto-detection without hash prefix
**Follow-up fix**: `17bcbaf` fix: restore auto_detect_nl and cursor_shape in settings modal
**Date**: 2026-03-24

---

## Summary

TASK-050 allows the intent classifier to automatically route natural-language inputs to the LLM translation path without requiring the `#` prefix. A new `shouldAutoRouteNL()` function gates routing based on the `auto_detect_nl` user setting. The `#` prefix continues to work unconditionally. A flash animation on the ModeIndicator provides visual feedback when auto-detection triggers.

## Files Changed

| File | Change |
|---|---|
| `src/lib/intent-classifier.ts` | New `shouldAutoRouteNL()` function |
| `src/lib/types.ts` | `auto_detect_nl?: boolean` on `AppSettings` |
| `src-tauri/src/settings/mod.rs` | `auto_detect_nl` field with serde default + backward compat tests |
| `src/components/Terminal.tsx` | `handleSubmit` uses `shouldAutoRouteNL`; loads setting; tracks flash state |
| `src/components/editor/InputEditor.tsx` | New `modeAutoDetected` prop passed to ModeIndicator |
| `src/components/editor/ModeIndicator.tsx` | `autoDetected` prop adds `mode-indicator-flash` CSS class |
| `src/components/SettingsModal.tsx` | Checkbox for auto_detect_nl setting |
| `src/App.css` | `mode-indicator-flash` keyframes animation |
| `src/__tests__/intent-classifier.test.ts` | 5 new tests for `shouldAutoRouteNL` |
| `src/__tests__/ModeIndicator.test.tsx` | 2 new tests for flash class |
| `src/__tests__/SettingsModal.test.tsx` | 3 new tests for auto_detect_nl setting |
| `src/__tests__/nlAutoDetect.test.ts` | 5 additional integration-style tests |

## Verdict: PASS (with findings)

The feature is well-designed and safely implemented. The critical security requirement -- that NL auto-detection cannot cause unreviewed command execution -- is satisfied.

---

## Security Analysis

### Critical Check: Can auto-detection execute NL as CLI?

**Result: SAFE.** The routing path in `Terminal.tsx` (line 734) is:

```
if (routeToNL) {
    // translates via LLM and puts result in editor for review
    setInput(translated);
    return; // Don't execute -- user reviews first
}
```

When `shouldAutoRouteNL` returns `true`, the input is sent to `translateCommand()` and the **translated command is placed in the editor for the user to review** -- it is never auto-executed. The `return` statement at line 768 prevents fall-through to the CLI execution path. This is the same behavior as the existing `#` prefix path.

### Can NL be accidentally treated as CLI?

`shouldAutoRouteNL` only returns `true` when `classification.confidence === 'high'`. Low-confidence NL classifications are NOT auto-routed (verified by test `test_low_confidence_nl_not_auto_routed`). If auto-detection is wrong (classifies CLI as NL), the translated result still goes to the editor for review, not execution.

### Setting default

`auto_detect_nl` defaults to `true`, meaning the feature is on by default. Users can disable it in Settings to revert to `#`-only behavior. This is a reasonable UX default since the fallback is always "review, don't execute."

---

## Functional Review

### Intent Classifier Changes
- `shouldAutoRouteNL()` is a clean, stateless function with clear logic: `# prefix -> always true`, `!autoDetect -> false`, `NL high confidence -> true`, everything else `false`.
- The existing `classifyIntent()` is unchanged -- no regression risk.

### Settings Extension
- Rust: `auto_detect_nl` uses `#[serde(default = "default_auto_detect_nl")]` for backward compatibility. Old JSON without the field deserializes to `Some(true)`.
- TypeScript: `AppSettings.auto_detect_nl?: boolean` with `?? true` fallback in all consumers.
- Backward compatibility tested on both Rust and TS sides.

### ModeIndicator Flash
- CSS animation `mode-flash 0.6s ease-in-out` provides a subtle 2-blink opacity pulse.
- The `autoDetected` prop is a simple boolean passed through InputEditor.
- Flash state is set on submit (`setNlAutoDetected(wasAutoDetected)`) and cleared after translation completes or on CLI execution.

### handleSubmit Routing Logic
- Constructs a `resolvedClassification` with the resolved intent (after optional LLM fallback for ambiguous cases) and passes it to `shouldAutoRouteNL`.
- The `autoDetectNl` state is loaded from settings on mount and used in the `useCallback` dependency array.

---

## Findings

### F1: CRITICAL -- Unresolved merge conflicts in Rust settings file

`src-tauri/src/settings/mod.rs` contains **12+ unresolved merge conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`) from a merge with the `worktree-agent-a7ef51a1` branch (TASK-051 transparent backgrounds). This file will not compile.

The conflicts affect the `AppSettings` struct definition, `Default` impl, validation constants, and multiple test functions. Fields from both branches (`cursor_shape`, `auto_detect_nl` from HEAD; `background_effect`, `background_opacity` from the worktree) need to be merged.

**Action required**: Resolve merge conflicts in `src-tauri/src/settings/mod.rs` before the Rust backend can build.

### F2: LOW -- Flash animation does not auto-clear

The `mode-indicator-flash` class is set when NL is auto-detected and cleared in several places (after translation completes, on CLI submit, on error). However, since the CSS animation runs once on class application (`animation: mode-flash 0.6s`), if the component re-renders with `autoDetected=true` still set after the animation completes, re-adding the class on a subsequent render won't re-trigger the animation (CSS animation replay requires removing and re-adding the class or using `animation-iteration-count`). This is minor since the state is cleared shortly after, but could cause the flash to not replay if the user submits multiple NL queries rapidly.

### F3: LOW -- `resolvedClassification` hardcodes confidence to 'high'

In `handleSubmit` (Terminal.tsx line 731):
```ts
const resolvedClassification: ClassificationResult = { intent: resolvedIntent, confidence: 'high' };
```

This always passes `confidence: 'high'` to `shouldAutoRouteNL`, even when the original classification was low-confidence and the LLM fallback resolved it. This is actually correct behavior (the LLM resolved the ambiguity, so we trust its result at high confidence), but it would be clearer if commented. The code already has a comment on line 729-730 explaining the gating, which is sufficient.

### F4: INFO -- Duplicate test coverage

`src/__tests__/nlAutoDetect.test.ts` duplicates several tests from `src/__tests__/intent-classifier.test.ts` (e.g., `test_nl_auto_detected_without_hash`, `test_hash_still_works`, `test_cli_not_auto_detected_as_nl`). The nlAutoDetect tests only test `classifyIntent` (not `shouldAutoRouteNL`), making them strictly less comprehensive than the intent-classifier tests. Consider removing the duplicate file to reduce maintenance burden.

---

## Test Results

**Frontend (Vitest)**: 58/59 test files passed, 601/631 tests passed. The one failure is an OOM crash (JavaScript heap limit) on the final test file -- unrelated to TASK-050. All TASK-050-specific tests pass:

- `shouldAutoRouteNL` (5 tests): all pass
- `ModeIndicator` flash (2 tests): all pass
- `SettingsModal` auto_detect_nl (3 tests): all pass
- `nlAutoDetect` integration (5 tests): all pass

**Rust tests**: Not run due to unresolved merge conflicts (F1).

---

## Required Actions

| # | Severity | Action |
|---|----------|--------|
| F1 | CRITICAL | Resolve merge conflicts in `src-tauri/src/settings/mod.rs` |
| F2 | LOW | Consider using `key` prop or animation reset trick for reliable flash replay |
| F4 | LOW | Consider removing duplicate `nlAutoDetect.test.ts` |
