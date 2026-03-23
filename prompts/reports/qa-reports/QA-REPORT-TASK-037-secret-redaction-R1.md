# QA Report: TASK-037 Secret Redaction (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: a481e2b `feat: add automatic secret redaction in terminal output`

## Test Results: ALL PASS

### Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (Vitest) | 507 passed, 0 failed | PASS |

All pre-existing tests continue to pass. No regressions detected.

---

### New Test Coverage

**Unit tests -- `secretRedaction.test.ts` (24 tests)**:

`detectSecrets` (14 tests):
- `test_detects_openai_key` -- sk- prefix with 20+ chars
- `test_detects_aws_key` -- AKIA prefix with 16 uppercase alphanumeric
- `test_detects_github_pat` -- ghp_ prefix with 36 alphanumeric
- `test_detects_slack_token` -- xoxb- pattern
- `test_detects_generic_env_secret` -- API_KEY=value
- `test_detects_env_secret_PASSWORD` -- PASSWORD=value
- `test_detects_env_secret_TOKEN` -- TOKEN=value
- `test_detects_connection_string_password` -- mysql://user:pass@host
- `test_detects_connection_string_postgres` -- postgres://admin:pass@host
- `test_preserves_git_hashes` -- 40-char hex after "commit " not masked
- `test_preserves_git_hashes_at_start_of_line` -- 40-char hex at line start not masked
- `test_preserves_uuids` -- standard UUID format not masked
- `test_preserves_uuids_uppercase` -- uppercase UUID not masked
- `test_detects_multiple_secrets` -- two secrets in one line
- `test_no_false_positive_on_short_values` -- API_KEY=x (1 char) not matched
- `test_github_fine_grained_pat` -- github_pat_ prefix

`buildRedactedSegments` (4 tests):
- `test_no_secrets_returns_single_segment`
- `test_masks_detected_secret` -- verifies mask text, originalValue, secretId
- `test_env_secret_masks_only_value` -- API_KEY= prefix preserved, value masked
- `test_connection_string_masks_only_password` -- only password portion masked

`maskSecrets` (4 tests):
- `test_masks_text_for_clipboard` -- end-to-end mask for copy
- `test_no_secrets_returns_original`
- `test_masks_multiple_secrets`
- `test_copy_output_copies_masked` -- simulates Copy Output behavior

**Hook tests -- `useSecretRedaction.test.ts` (7 tests)**:
- `test_detects_secrets_in_text` -- hook returns hasSecrets=true, masked segments
- `test_no_secrets_in_plain_text` -- hook returns hasSecrets=false
- `test_click_reveals_secret` -- revealSecret adds to revealedIds
- `test_reveal_auto_hides` -- revealed secret hides after REVEAL_DURATION_MS
- `test_reveal_resets_timer_on_repeated_click` -- second click resets the 3s timer
- `test_strips_ansi_before_detection` -- ANSI codes stripped before regex matching
- `test_memoizes_detection` -- segments reference stable across re-renders with same text

**Integration tests -- `secretRedactionIntegration.test.tsx` (7 tests)**:
- `test_renders_masked_secret_in_output` -- BlockView renders masked text, not plaintext secret
- `test_click_reveals_secret` -- clicking masked span shows original value
- `test_reveal_auto_hides` -- secret re-masks after 3 seconds (fake timers)
- `test_copy_output_copies_masked` -- Copy Output button writes masked text to clipboard
- `test_copy_raw_copies_unmasked` -- Copy Raw button writes unmasked text to clipboard
- `test_no_masking_for_clean_output` -- normal output (file1.txt) has no mask text
- `test_git_hashes_not_masked` -- git log output with 40-char SHA not falsely masked

---

### Bug Hunt Results

#### Regex Performance on Large Output: NO ISSUE FOUND

The `detectSecrets` function iterates 7 regex patterns sequentially over the input text. Each pattern uses the `g` flag with `exec()` which is O(n) per pattern. Total cost: O(7n) where n is the text length. The exclusion range check (`findExcludedRanges`) adds two more O(n) passes (UUID and git hash patterns). The `isInExcludedRange` check is O(e) per detected secret where e is the number of excluded ranges -- typically very small.

Memoization in `useSecretRedaction` ensures detection only runs when the text changes, not on every render. For terminal output blocks which are typically under 100KB, this is well within acceptable performance bounds.

**Potential concern**: If a single block accumulates very large output (e.g., a `cat` of a multi-MB file), the regex pass could take tens of milliseconds. However, this is mitigated by the existing output truncation system (scrollback limits). No action needed.

#### False Positives on Git Hashes: NO ISSUE FOUND

The `GIT_HASH_PATTERN` regex correctly identifies 40-char hex strings at word boundaries. These are added to `ExcludedRange` and the `isInExcludedRange` function checks for 50%+ overlap with excluded ranges before suppressing a detection. The test suite covers both "commit SHA" and "SHA at start of line" cases.

Short git hashes (7-8 chars) are too short to match any of the secret patterns (OpenAI needs 20+, AWS needs 16, etc.) so they are naturally excluded.

#### False Positives on UUIDs: NO ISSUE FOUND

UUIDs are detected by `UUID_PATTERN` (8-4-4-4-12 hex with dashes) and excluded. The test covers both lowercase and uppercase UUIDs. The case-insensitive flag (`gi`) is correctly applied.

Note: A UUID without dashes (32 hex chars) would NOT be excluded. This is acceptable -- dashless UUIDs are uncommon in terminal output and 32 hex chars are below the threshold for most secret patterns anyway.

#### Click-to-Reveal Timer Cleanup on Unmount: NO ISSUE FOUND

The `useSecretRedaction` hook (lines 63-68) has a `useEffect` cleanup:

```typescript
useEffect(() => {
  return () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  };
}, []);
```

This correctly iterates all active timers in the `Map` and clears them on unmount. The empty dependency array `[]` ensures cleanup only runs on unmount, not on every render. The `useRef` for the timer map ensures the cleanup closure always has access to the current timers (not a stale snapshot).

The `test_reveal_resets_timer_on_repeated_click` test verifies that clicking a second time before the timer expires correctly replaces the timer (lines 45-47 in the hook clear the existing timer before setting a new one).

---

### Edge Cases Verified

| Scenario | Expected | Actual |
|----------|----------|--------|
| Empty output | No crash, no mask | PASS (no secrets detected on empty string) |
| Output with only ANSI codes | No crash, stripped before detection | PASS (test_strips_ansi_before_detection) |
| Secret at very start of text | Detected and masked | PASS (secretStart=0 handled) |
| Secret at very end of text | Detected and masked | PASS (trailing text slice handled) |
| Multiple secrets adjacent | Both detected, non-overlapping dedup | PASS (test_detects_multiple_secrets) |
| Secret value is 1 char | Not detected (min 2 chars) | PASS (test_no_false_positive_on_short_values) |
| Connection string with special chars in password | Detected up to @ | PASS (regex `[^@\s]{2,}`) |

---

### Accessibility

- Secret mask spans have `role="button"` and `tabIndex={0}` for keyboard accessibility
- `onKeyDown` handler supports Enter and Space for keyboard reveal
- `title` attribute provides hover tooltip explaining behavior
- `:focus-visible` CSS style provides visible focus indicator
- `aria-label` not present on the mask span -- minor a11y gap but `title` provides equivalent information

---

## Summary

| Category | Status |
|----------|--------|
| All tests pass | PASS (507/507) |
| New test coverage | 38 new tests across 3 test files |
| Regex performance | PASS -- O(n) per pattern, memoized |
| False positive handling | PASS -- UUIDs and git hashes excluded |
| Timer cleanup | PASS -- proper cleanup on unmount |
| Edge cases | PASS -- all verified |
| Regressions | NONE |

**Recommendation**: No blocking issues found. Ready to merge.
